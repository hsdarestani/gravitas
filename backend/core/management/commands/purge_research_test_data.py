import json
from collections import defaultdict

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from core import cloud
from core.models import (
    Collection,
    KnowledgeActivity,
    KnowledgeResource,
    NextcloudIdentity,
    ResearchProject,
    Tag,
)
from core.platform_models import (
    AccessGrant,
    AccessRequest,
    ContentWorkItem,
    EntityLink,
    MindMap,
    ObjectPolicy,
    ResearchRequest,
    ShareLink,
    WorkspaceProfile,
)
from core.space_fs import ensure_defaults
from core.space_models import NoteSpaceLink, ProjectSpaceLink, SpaceManagedItem, SpaceNode


CONFIRM_PHRASE = 'PURGE-RESEARCH-TEST-DATA'


class Command(BaseCommand):
    help = (
        'Remove production test/demo content from the Research layer while preserving '
        'accounts, product entitlements, workspace shells and Core/LMS data.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Actually delete data. Without this flag the command is a dry run.')
        parser.add_argument('--confirm', default='', help=f'Required with --apply: {CONFIRM_PHRASE}')
        parser.add_argument('--skip-cloud', action='store_true', help='Skip Nextcloud cleanup and only clean the database.')

    def handle(self, *args, **options):
        apply_changes = bool(options['apply'])
        if apply_changes and options['confirm'] != CONFIRM_PHRASE:
            raise CommandError(f'--apply requires --confirm {CONFIRM_PHRASE}')

        research_workspace_ids = list(
            WorkspaceProfile.objects.filter(purpose=WorkspaceProfile.Purpose.RESEARCH)
            .values_list('workspace_id', flat=True)
        )

        projects = ResearchProject.objects.filter(workspace_id__in=research_workspace_ids)
        project_ids = list(projects.values_list('id', flat=True))

        # Editor/Journal notes deliberately live in each user's personal workspace,
        # but are still Research-layer content. Include them explicitly, plus any
        # note physically filed under Space/Research (covers imported/legacy notes).
        research_page_ids = set(
            KnowledgeResource.objects.filter(
                kind=KnowledgeResource.Kind.NOTE,
                metadata__ws_space='research',
            ).values_list('id', flat=True)
        )
        research_page_ids.update(
            NoteSpaceLink.objects.filter(category__nextcloud_path__startswith='Space/Research')
            .values_list('resource_id', flat=True)
        )

        resources = KnowledgeResource.objects.filter(
            Q(workspace_id__in=research_workspace_ids)
            | Q(project_id__in=project_ids)
            | Q(id__in=research_page_ids)
        ).distinct()
        resource_ids = list(resources.values_list('id', flat=True))

        mind_maps = MindMap.objects.filter(
            Q(workspace_id__in=research_workspace_ids) | Q(project_id__in=project_ids)
        ).distinct()
        mind_map_ids = list(mind_maps.values_list('id', flat=True))

        research_requests = ResearchRequest.objects.filter(
            Q(workspace_id__in=research_workspace_ids) | Q(project_id__in=project_ids)
        ).distinct()
        content_items = ContentWorkItem.objects.filter(
            Q(workspace_id__in=research_workspace_ids) | Q(research_project_id__in=project_ids)
        ).distinct()

        collections = Collection.objects.filter(workspace_id__in=research_workspace_ids)
        tags = Tag.objects.filter(workspace_id__in=research_workspace_ids)

        research_space_nodes = SpaceNode.objects.filter(nextcloud_path__startswith='Space/Research')
        owner_ids = set(research_space_nodes.values_list('owner_id', flat=True))
        owner_ids.update(projects.values_list('owner_id', flat=True))
        owner_ids.update(resources.values_list('owner_id', flat=True))

        summary = {
            'mode': 'APPLY' if apply_changes else 'DRY-RUN',
            'research_workspaces': len(research_workspace_ids),
            'projects': len(project_ids),
            'resources_total': len(resource_ids),
            'research_editor_notes': len(research_page_ids),
            'mind_maps': len(mind_map_ids),
            'research_requests': research_requests.count(),
            'research_linked_content_items': content_items.count(),
            'collections': collections.count(),
            'tags': tags.count(),
            'space_nodes_under_research': research_space_nodes.count(),
            'owners_touched': len(owner_ids),
        }
        self.stdout.write(json.dumps(summary, sort_keys=True))

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run only. No rows or cloud files were changed.'))
            return

        cloud_warnings = []
        if not options['skip_cloud']:
            cloud_warnings.extend(self._purge_cloud(project_ids, resource_ids, owner_ids))

        # Generic foreign keys do not cascade at the database level. Remove their
        # policies/shares/links explicitly before the underlying objects disappear.
        targets = []
        for model, ids in (
            (ResearchProject, project_ids),
            (KnowledgeResource, resource_ids),
            (MindMap, mind_map_ids),
        ):
            if ids:
                targets.append((ContentType.objects.get_for_model(model, for_concrete_model=False), ids))

        with transaction.atomic():
            for content_type, ids in targets:
                ObjectPolicy.objects.filter(content_type=content_type, object_id__in=ids).delete()
                AccessGrant.objects.filter(content_type=content_type, object_id__in=ids).delete()
                ShareLink.objects.filter(content_type=content_type, object_id__in=ids).delete()
                AccessRequest.objects.filter(content_type=content_type, object_id__in=ids).delete()
                EntityLink.objects.filter(
                    Q(source_content_type=content_type, source_object_id__in=ids)
                    | Q(target_content_type=content_type, target_object_id__in=ids)
                ).delete()

            # Category-only Space objects are not necessarily attached to a project.
            # Remove those beneath Research before deleting the protected categories.
            SpaceManagedItem.objects.filter(
                Q(project_id__in=project_ids)
                | Q(category__nextcloud_path__startswith='Space/Research')
            ).delete()

            KnowledgeActivity.objects.filter(
                Q(workspace_id__in=research_workspace_ids)
                | Q(project_id__in=project_ids)
                | Q(resource_id__in=resource_ids)
            ).delete()

            research_requests.delete()
            content_items.delete()
            mind_maps.delete()
            resources.delete()
            projects.delete()
            collections.delete()
            tags.delete()

            # Reset only the Research branch of the per-user Space tree. Personal
            # and Learning folders, identities and account settings stay intact.
            SpaceNode.objects.filter(
                owner_id__in=owner_ids,
                nextcloud_path='Space/Research',
            ).delete()

        # Recreate the empty default Research/Projects structure so the UI has a
        # valid target immediately after the purge. Failures here must not undo a
        # successful DB cleanup; the normal sync worker can heal it later.
        users = get_user_model().objects.in_bulk(owner_ids)
        for user in users.values():
            try:
                ensure_defaults(user, sync=not options['skip_cloud'])
            except Exception as exc:  # noqa: BLE001 - cleanup must finish even if cloud is down
                cloud_warnings.append(f'user {user.pk}: could not recreate default Space tree: {exc}')

        self.stdout.write(self.style.SUCCESS('Research test/demo content purged; accounts, access and workspace shells were preserved.'))
        if cloud_warnings:
            self.stdout.write(self.style.WARNING(f'Cloud cleanup completed with {len(cloud_warnings)} warning(s):'))
            for warning in cloud_warnings[:30]:
                self.stdout.write(self.style.WARNING(f'  - {warning}'))
            if len(cloud_warnings) > 30:
                self.stdout.write(self.style.WARNING(f'  - ... {len(cloud_warnings) - 30} more'))

    def _purge_cloud(self, project_ids, resource_ids, owner_ids):
        warnings = []
        identities = {
            row.user_id: row
            for row in NextcloudIdentity.objects.filter(user_id__in=owner_ids)
        }
        paths_by_user = defaultdict(set)

        for row in KnowledgeResource.objects.filter(id__in=resource_ids).values('owner_id', 'storage_path'):
            if row['storage_path']:
                paths_by_user[row['owner_id']].add(row['storage_path'])

        for row in NoteSpaceLink.objects.filter(resource_id__in=resource_ids).values(
            'resource__owner_id', 'note_path', 'attachments_path'
        ):
            user_id = row['resource__owner_id']
            if row['note_path']:
                paths_by_user[user_id].add(row['note_path'])
            if row['attachments_path']:
                paths_by_user[user_id].add(row['attachments_path'])

        for row in ProjectSpaceLink.objects.filter(project_id__in=project_ids).values(
            'user_id', 'folder_path', 'metadata_path'
        ):
            if row['folder_path']:
                paths_by_user[row['user_id']].add(row['folder_path'])
            if row['metadata_path']:
                paths_by_user[row['user_id']].add(row['metadata_path'])

        project_owner = dict(
            ResearchProject.objects.filter(id__in=project_ids).values_list('id', 'owner_id')
        )
        from core.platform_models import ResearchProjectProfile
        for row in ResearchProjectProfile.objects.filter(project_id__in=project_ids).values('project_id', 'nextcloud_root'):
            user_id = project_owner.get(row['project_id'])
            if user_id and row['nextcloud_root']:
                paths_by_user[user_id].add(row['nextcloud_root'])

        # Delete deepest paths first; deleting a folder after its children is
        # harmless and keeps failures isolated to one object.
        for user_id, paths in paths_by_user.items():
            identity = identities.get(user_id)
            if not identity:
                continue
            for path in sorted(paths, key=lambda value: (value.count('/'), len(value)), reverse=True):
                try:
                    cloud.delete(identity, path)
                except Exception as exc:  # noqa: BLE001
                    warnings.append(f'user {user_id}: could not delete {path}: {exc}')

        # Space/Research is fully test/demo state for this purge. Removing the
        # branch also catches unindexed Markdown leftovers; ensure_defaults()
        # recreates the empty canonical branch after the DB transaction.
        for user_id in owner_ids:
            identity = identities.get(user_id)
            if not identity:
                continue
            for path in ('Space/Research', 'Space/Research.md'):
                try:
                    cloud.delete(identity, path)
                except Exception as exc:  # noqa: BLE001
                    warnings.append(f'user {user_id}: could not delete {path}: {exc}')

        # Project Team Folders are independent of a user's DAV tree. Remove
        # matching GRV-* folders so deleted test projects do not remain mounted
        # in native Nextcloud. This is best-effort because older Nextcloud builds
        # can differ in their Group Folders response shape.
        wanted_mounts = {cloud.project_mountpoint(type('ProjectRef', (), {'pk': pk})()) for pk in project_ids}
        if wanted_mounts:
            try:
                for folder in cloud.list_team_folders():
                    mount = folder.get('mount_point') or folder.get('mountPoint')
                    if mount not in wanted_mounts:
                        continue
                    folder_id = folder.get('id') or folder.get('folder_id')
                    if folder_id is None:
                        continue
                    cloud._request(
                        'DELETE',
                        f'{cloud.settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders/{int(folder_id)}',
                        auth=cloud._admin_auth(),
                        expected={200, 204},
                        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
                    )
            except Exception as exc:  # noqa: BLE001
                warnings.append(f'could not remove one or more project Team Folders: {exc}')

        return warnings
