import hashlib
import tempfile

from django.core.management.base import BaseCommand, CommandError

from core import cloud, nextcloud_bridge
from core.models import KnowledgeResource


class Command(BaseCommand):
    help = 'Move legacy per-user research project files into native Nextcloud Team Folders.'

    def add_arguments(self, parser):
        parser.add_argument('--project-id', type=int)
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--limit', type=int, default=0)
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Print resource paths. Do not use this in public CI logs.',
        )

    def handle(self, *args, **options):
        qs = KnowledgeResource.objects.filter(
            project__isnull=False,
            storage_path__gt='',
            kind__in=[KnowledgeResource.Kind.FILE, KnowledgeResource.Kind.DATASET],
        ).select_related('project', 'project__owner', 'owner', 'collection').order_by('pk')
        if options['project_id']:
            qs = qs.filter(project_id=options['project_id'])

        resources = []
        for resource in qs:
            mount = cloud.project_mountpoint(resource.project)
            clean = resource.storage_path.strip('/')
            if clean == mount or clean.startswith(mount + '/'):
                continue
            resources.append(resource)
            if options['limit'] and len(resources) >= options['limit']:
                break

        if options['dry_run']:
            if options['verbose']:
                for resource in resources:
                    new_path = nextcloud_bridge.project_storage_path(
                        resource.project,
                        resource.collection,
                        resource.original_name,
                    )
                    self.stdout.write(
                        f'Would migrate resource={resource.pk} project={resource.project_id} '
                        f'{resource.storage_path} -> {new_path}'
                    )
            self.stdout.write(self.style.SUCCESS(f'dry-run matched={len(resources)}'))
            return

        migrated = 0
        for resource in resources:
            project = resource.project
            destination_identity = None
            new_path = None
            uploaded = False
            old_path = resource.storage_path
            try:
                nextcloud_bridge.ensure_project_space(project)
                source_identity = nextcloud_bridge.ensure_user(resource.owner)
                # The project owner is guaranteed to retain native Team Folder
                # access even if the original uploader has since left the project.
                destination_identity = nextcloud_bridge.ensure_user(project.owner)
                new_path = nextcloud_bridge.project_storage_path(
                    project,
                    resource.collection,
                    resource.original_name,
                )

                # Never overwrite a native file during migration. A pre-existing
                # destination may be a researcher-created file or residue from an
                # interrupted attempt and must be inspected explicitly.
                if cloud.path_exists(destination_identity, new_path):
                    raise CommandError(
                        f'Destination already exists for resource {resource.pk}'
                    )

                upstream = cloud.download(source_identity, old_path)
                digest = hashlib.sha256()
                try:
                    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024) as copied:
                        for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                            if chunk:
                                digest.update(chunk)
                                copied.write(chunk)
                        copied.seek(0)
                        copied.content_type = (
                            resource.mime_type
                            or upstream.headers.get('Content-Type', 'application/octet-stream')
                        )
                        cloud.upload(destination_identity, new_path, copied)
                        uploaded = True
                finally:
                    upstream.close()

                expected = resource.checksum.removeprefix('sha256:') if resource.checksum else ''
                if expected and digest.hexdigest() != expected:
                    cloud.delete(destination_identity, new_path)
                    uploaded = False
                    raise CommandError(f'Checksum mismatch while migrating resource {resource.pk}')

                resource.storage_path = new_path
                metadata = dict(resource.metadata or {})
                metadata['nextcloud_team_folder'] = True
                metadata['migrated_from'] = old_path
                resource.metadata = metadata
                resource.save(update_fields=['storage_path', 'metadata', 'updated_at'])

                try:
                    nextcloud_bridge.sync_resource_acl(resource)
                except Exception:
                    # Fully restore the legacy pointer before surfacing the error.
                    # Best-effort removal of the copied destination keeps retries
                    # idempotent; the original source is never deleted on failure.
                    resource.storage_path = old_path
                    metadata = dict(resource.metadata or {})
                    metadata.pop('nextcloud_team_folder', None)
                    metadata.pop('migrated_from', None)
                    resource.metadata = metadata
                    resource.save(update_fields=['storage_path', 'metadata', 'updated_at'])
                    if uploaded and destination_identity and new_path:
                        try:
                            cloud.delete(destination_identity, new_path)
                            uploaded = False
                        except cloud.CloudError:
                            pass
                    raise

                cloud.delete(source_identity, old_path)
                migrated += 1
                if options['verbose']:
                    self.stdout.write(f'Migrated resource={resource.pk} -> {new_path}')
            except CommandError:
                raise
            except Exception as exc:
                raise CommandError(f'Could not migrate resource {resource.pk}: {exc}') from exc

        self.stdout.write(self.style.SUCCESS(f'migration complete migrated={migrated}'))
