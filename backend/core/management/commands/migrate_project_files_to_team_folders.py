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
            for resource in resources:
                new_path = nextcloud_bridge.project_storage_path(resource.project, resource.collection, resource.original_name)
                self.stdout.write(f'Would migrate resource={resource.pk} {resource.storage_path} -> {new_path}')
            self.stdout.write(self.style.SUCCESS(f'dry-run matched={len(resources)}'))
            return

        migrated = 0
        for resource in resources:
            project = resource.project
            try:
                nextcloud_bridge.ensure_project_space(project)
                source_identity = nextcloud_bridge.ensure_user(resource.owner)
                destination_identity = source_identity
                new_path = nextcloud_bridge.project_storage_path(project, resource.collection, resource.original_name)
                upstream = cloud.download(source_identity, resource.storage_path)
                digest = hashlib.sha256()
                try:
                    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024) as copied:
                        for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                            if chunk:
                                digest.update(chunk)
                                copied.write(chunk)
                        copied.seek(0)
                        copied.content_type = resource.mime_type or upstream.headers.get('Content-Type', 'application/octet-stream')
                        cloud.upload(destination_identity, new_path, copied)
                finally:
                    upstream.close()

                expected = resource.checksum.removeprefix('sha256:') if resource.checksum else ''
                if expected and digest.hexdigest() != expected:
                    cloud.delete(destination_identity, new_path)
                    raise CommandError(f'Checksum mismatch while migrating resource {resource.pk}')

                old_path = resource.storage_path
                resource.storage_path = new_path
                metadata = dict(resource.metadata or {})
                metadata['nextcloud_team_folder'] = True
                metadata['migrated_from'] = old_path
                resource.metadata = metadata
                resource.save(update_fields=['storage_path', 'metadata', 'updated_at'])
                nextcloud_bridge.sync_resource_acl(resource)
                cloud.delete(source_identity, old_path)
                migrated += 1
                self.stdout.write(f'Migrated resource={resource.pk} -> {new_path}')
            except CommandError:
                raise
            except Exception as exc:
                raise CommandError(f'Could not migrate resource {resource.pk}: {exc}') from exc

        self.stdout.write(self.style.SUCCESS(f'migration complete migrated={migrated}'))
