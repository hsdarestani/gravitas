from pathlib import PurePosixPath

from django.utils import timezone

from . import cloud, space_service
from .models import KnowledgeResource
from .space_models import NoteSpacePlacement, ProjectSpacePlacement, SpaceNode
from .workspace_api import provision_personal_workspace


def review_cloud_changes(user, *, confirm=False):
    identity = space_service.ensure_space_root(user)
    note_by_path = {
        p.markdown_path: p for p in NoteSpacePlacement.objects.filter(owner=user).select_related('resource')
    }
    node_by_path = {p.markdown_path: p for p in SpaceNode.objects.filter(owner=user)}
    project_by_path = {
        p.markdown_path: p for p in ProjectSpacePlacement.objects.filter(owner=user).select_related('project')
    }
    changes = []

    for item in space_service.walk_markdown(user):
        path = item['path']
        try:
            text = space_service._read_text(identity, path)
        except cloud.CloudError:
            continue
        digest = space_service._hash(text)

        note = note_by_path.get(path)
        if note:
            if note.sync_hash and digest == note.sync_hash:
                continue
            title, body = space_service.parse_note_markdown(text)
            change = {
                'path': path,
                'type': 'note',
                'action': 'update',
                'title': title,
                'requires_confirmation': True,
                'applied': False,
            }
            if confirm:
                note.resource.title = title
                note.resource.body = body
                note.resource.save(update_fields=['title', 'body', 'updated_at'])
                note.sync_hash = digest
                note.sync_state = SpaceNode.SyncState.SYNCED
                note.last_synced_at = timezone.now()
                note.save(update_fields=['sync_hash', 'sync_state', 'last_synced_at', 'updated_at'])
                change['applied'] = True
            changes.append(change)
            continue

        node = node_by_path.get(path)
        if node:
            if node.sync_hash and digest == node.sync_hash:
                continue
            change = {
                'path': path,
                'type': node.kind,
                'action': 'structural_review',
                'requires_confirmation': True,
                'applied': False,
                'manual_review': True,
            }
            if confirm:
                # Folder names and nesting are filesystem identity. A direct edit
                # to structural Markdown is acknowledged but never silently
                # renames/moves user folders or database objects.
                node.sync_hash = digest
                node.sync_state = SpaceNode.SyncState.CONFLICT
                node.last_synced_at = timezone.now()
                node.save(update_fields=['sync_hash', 'sync_state', 'last_synced_at', 'updated_at'])
                change['applied'] = True
                change['resolution'] = 'marked_for_manual_structure_review'
            changes.append(change)
            continue

        project = project_by_path.get(path)
        if project:
            if project.sync_hash and digest == project.sync_hash:
                continue
            change = {
                'path': path,
                'type': 'project',
                'action': 'structural_review',
                'requires_confirmation': True,
                'applied': False,
                'manual_review': True,
            }
            if confirm:
                project.sync_hash = digest
                project.sync_state = SpaceNode.SyncState.CONFLICT
                project.last_synced_at = timezone.now()
                project.save(update_fields=['sync_hash', 'sync_state', 'last_synced_at', 'updated_at'])
                change['applied'] = True
                change['resolution'] = 'marked_for_manual_structure_review'
            changes.append(change)
            continue

        kind = space_service.markdown_type(text)
        if path == 'Space.md':
            # Space.md is the filesystem root descriptor rather than a database
            # entity, so it is indexed but does not trigger a database mutation.
            continue

        change = {
            'path': path,
            'type': kind,
            'action': 'import' if kind == 'note' else 'external_index',
            'requires_confirmation': kind == 'note',
            'applied': False,
        }
        if confirm and kind == 'note':
            title, body = space_service.parse_note_markdown(text)
            parent_dir = str(PurePosixPath(path).parent)
            node = SpaceNode.objects.filter(owner=user, folder_path=parent_dir).first()
            project_placement = ProjectSpacePlacement.objects.filter(
                owner=user, folder_path=parent_dir
            ).select_related('project').first()
            parent_note = NoteSpacePlacement.objects.filter(owner=user, attachments_path=parent_dir).first()
            workspace = project_placement.project.workspace if project_placement else provision_personal_workspace(user)
            resource = KnowledgeResource.objects.create(
                workspace=workspace,
                project=project_placement.project if project_placement else None,
                owner=user,
                kind=KnowledgeResource.Kind.NOTE,
                title=title,
                body=body,
                metadata={'imported_from_nextcloud': True},
            )
            placement = NoteSpacePlacement.objects.create(
                resource=resource,
                owner=user,
                space_parent=node if not project_placement and not parent_note else None,
                project=project_placement.project if project_placement else None,
                parent_note=parent_note,
                storage_name=PurePosixPath(path).stem,
                markdown_path=path,
                attachments_path=f'{parent_dir}/{PurePosixPath(path).stem}',
                sync_state=SpaceNode.SyncState.SYNCED,
                sync_hash=digest,
                last_synced_at=timezone.now(),
            )
            change.update({'applied': True, 'resource_id': resource.pk, 'placement_id': placement.pk})
        changes.append(change)
    return changes


space_service.review_cloud_changes = review_cloud_changes
