"""All existing UI surfaces write the same canonical files after adoption."""
from django.db.models.signals import post_save, pre_delete
from .canonical_projects import SPECS, active, export_object, project_for, suppress, _suppressed, _pending
from .canonical_models import CanonicalFile
from .models import ResearchProject
from django.apps import apps


def saved(sender, instance, raw=False, **kwargs):
    if raw or _suppressed.get():
        return
    pending = _pending.get()
    if pending is not None:
        pending.append(('save', instance.__class__, instance.pk))
    else:
        export_object(instance)


def deleting(sender, instance, **kwargs):
    project = project_for(instance)
    if _suppressed.get() or not active(project):
        return
    pending = _pending.get()
    if pending is not None:
        import copy
        pending.append(('delete', copy.copy(instance)))
        return
    archive_object(instance)


def archive_object(instance):
    project = project_for(instance)
    # Preserve recoverable content and forbid external stale-file resurrection.
    # Canonical file is retained as an archived revision, and UI/index omits it.
    file = export_object(instance)
    if file:
        from . import cloud
        from pathlib import PurePosixPath
        full = cloud.project_mountpoint(project) + '/' + file.path
        archive = f'06_Archive/DeletedCanonical/{file.pk}-{PurePosixPath(file.path).name}'
        cloud.admin_make_folder(cloud.project_mountpoint(project) + '/06_Archive/DeletedCanonical')
        cloud.set_team_folder_acl(cloud.project_mountpoint(project), '06_Archive/DeletedCanonical', cloud.project_group_id(project), {}, 'private')
        response = cloud._request('MOVE', cloud._admin_dav_url(full), auth=cloud._admin_auth(), expected={201, 204, 412},
            headers={'Destination': cloud._admin_dav_url(cloud.project_mountpoint(project) + '/' + archive), 'Overwrite': 'F', 'If-Match': file.etag})
        if response.status_code == 412:
            from .canonical_projects import CanonicalConflict, dav_read
            remote = dav_read(full) or {'content': '', 'etag': ''}
            raise CanonicalConflict(file.path, file.base_content, '', remote['content'], remote['etag'])
        file.deleted = True
        file.path = archive
        file.save(update_fields=['deleted', 'path', 'updated_at'])


def install():
    for name in ('ResearchProject', *SPECS):
        model = apps.get_model('core', name)
        post_save.connect(saved, sender=model, dispatch_uid=f'canonical_save_{name}', weak=False)
        pre_delete.connect(deleting, sender=model, dispatch_uid=f'canonical_delete_{name}', weak=False)


def flush_pending(pending, actor=None):
    seen = set()
    for item in pending:
        if item[0] == 'delete':
            archive_object(item[1])
            continue
        _, model, pk = item
        key = (model, pk)
        if key in seen:
            continue
        seen.add(key)
        obj = model.objects.filter(pk=pk).first()
        if obj:
            export_object(obj, actor)
