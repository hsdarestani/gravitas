"""All existing UI surfaces write the same canonical files after adoption."""
from django.db.models.signals import post_save, pre_delete, pre_save
from .canonical_projects import SPECS, active, export_object, project_for, suppress, _suppressed, _pending
from .canonical_models import CanonicalFile
from .models import ResearchProject
from django.apps import apps


def writing(sender, instance, raw=False, **kwargs):
    if raw or _suppressed.get() or _pending.get() is not None:
        return
    if active(project_for(instance)):
        from .canonical_journal import _batch, RecoveryRequired
        if _batch.get() is None:
            # Reject BEFORE the SQL write, rather than let a background save
            # commit independent content and then fail during remote export.
            raise RecoveryRequired('use_canonical_operation_for_project_write')


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
    if isinstance(instance, ResearchProject):
        # Project archival is the supported reversible operation. Hard deletion
        # would also destroy revision and permission records needed for recovery.
        from .canonical_journal import RecoveryRequired
        raise RecoveryRequired('canonical_project_requires_archival')
    pending = _pending.get()
    if pending is not None:
        import copy
        pending.append(('delete', copy.copy(instance)))
        return
    archive_object(instance)


def archive_object(instance):
    project = project_for(instance)
    # The private durable journal retains the content through rollback/crash;
    # the revision cache and tombstone retain the existing object identity.
    file = CanonicalFile.objects.select_for_update().filter(project=project,
        object_type=instance.__class__.__name__, object_id=instance.pk, deleted=False).first()
    if file:
        from . import cloud
        from .canonical_projects import CanonicalConflict, dav_read, cache
        from .canonical_journal import guarded_delete
        full = cloud.project_mountpoint(project) + '/' + file.path
        remote = dav_read(full)
        if not remote or remote['etag'] != file.etag:
            remote = remote or {'content': '', 'etag': ''}
            raise CanonicalConflict(file.path, file.base_content, '', remote['content'], remote['etag'])
        cache(file, remote, source='before_delete')
        if not guarded_delete(project, full, remote['etag']):
            latest = dav_read(full) or {'content': '', 'etag': ''}
            raise CanonicalConflict(file.path, remote['content'], '', latest['content'], latest['etag'])
        file.deleted = True
        file.save(update_fields=['deleted', 'updated_at'])


def install():
    for name in ('ResearchProject', *SPECS):
        model = apps.get_model('core', name)
        pre_save.connect(writing, sender=model, dispatch_uid=f'canonical_pre_save_{name}', weak=False)
        post_save.connect(saved, sender=model, dispatch_uid=f'canonical_save_{name}', weak=False)
        pre_delete.connect(deleting, sender=model, dispatch_uid=f'canonical_delete_{name}', weak=False)


def flush_pending(pending, actor=None):
    seen = set()
    deleted = {(item[1].__class__, item[1].pk) for item in pending if item[0] == 'delete'}
    for item in pending:
        if item[0] == 'delete':
            archive_object(item[1])
            continue
        _, model, pk = item
        key = (model, pk)
        if key in seen or key in deleted:
            continue
        seen.add(key)
        obj = model.objects.filter(pk=pk).first()
        if obj:
            export_object(obj, actor)
