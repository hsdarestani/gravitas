"""Private DAV write-ahead journal plus a transactional database commit witness.

Recovery never guesses after an ambiguous network failure. It conditionally
restores only an exact ETag recorded after our write; external changes require
review. Journals survive a database rollback or worker crash.
"""
import contextvars
import json
import uuid
from functools import wraps
from contextlib import contextmanager
from urllib.parse import unquote
from xml.etree import ElementTree
from .canonical_models import CanonicalWriteCommit
from . import cloud
from django.db import transaction

_batch = contextvars.ContextVar('canonical_write_batch', default=None)


class RecoveryRequired(cloud.CloudError):
    pass


class WriteBatch:
    def __init__(self):
        self.id = uuid.uuid4()
        self.journals = {}

    def persist(self, journal):
        from .canonical_projects import dav_write
        content = json.dumps(journal['manifest'], ensure_ascii=False)
        result = dav_write(journal['path'], content, journal['etag'])
        if not result:
            raise RecoveryRequired('canonical_journal_changed:' + journal['path'])
        journal['etag'] = result['etag']

    def put(self, project, path, content, etag):
        return self.mutate(project, path, content, etag, 'put')

    def delete(self, project, path, etag):
        return self.mutate(project, path, None, etag, 'delete')

    def mutate(self, project, path, content, etag, kind):
        from .canonical_projects import dav_read, dav_write
        before = dav_read(path)
        if (before['etag'] if before else None) != etag:
            return None
        journal = self.journal(project)
        if any(op['path'] == path and op.get('kind') != 'acl' for op in journal['manifest']['operations']):
            raise RecoveryRequired('canonical_repeated_file_write_requires_review:' + journal['path'])
        operation = {'kind': kind, 'path': path, 'before': before, 'content': content, 'written_etag': None}
        journal['manifest']['operations'].append(operation)
        self.persist(journal)
        result = dav_delete(path, etag) if kind == 'delete' else dav_write(path, content, etag)
        if result is None or result is False:
            operation['not_written'] = True
        elif kind == 'delete':
            operation['deleted'] = True
        else:
            operation['written_etag'] = result['etag']
        self.persist(journal)
        return result

    def acl(self, project, path, rules):
        from .canonical_acl import read_acl, write_acl, normalize
        before = read_acl(path)
        rules = normalize(rules)
        if before['rules'] == rules:
            return before
        journal = self.journal(project)
        if any(op['path'] == path and op.get('kind') == 'acl' for op in journal['manifest']['operations']):
            raise RecoveryRequired('canonical_repeated_acl_change_requires_review')
        op = {'kind': 'acl', 'path': path, 'before': before, 'rules': rules, 'written': None}
        journal['manifest']['operations'].append(op)
        self.persist(journal)
        # Persisting a descendant journal changes the project root ETag.
        # Refresh that ETag only while the observed permissions still match.
        current = read_acl(path)
        if current['rules'] != before['rules']:
            op['not_written'] = True
            self.persist(journal)
            raise RecoveryRequired('canonical_acl_changed')
        result = write_acl(path, rules, current)
        if result is None:
            op['not_written'] = True
        else:
            op['written'] = result
        self.persist(journal)
        if result is None:
            raise RecoveryRequired('canonical_acl_changed')
        return result

    def journal(self, project):
        journal = self.journals.get(project.pk)
        if not journal:
            root = cloud.project_mountpoint(project)
            folder = '06_Archive/CanonicalTransactions'
            cloud.admin_make_folder(root + '/' + folder)
            from .canonical_acl import protect_service_folder
            protect_service_folder(project, folder)
            journal = {'path': root + '/' + folder + '/' + str(self.id) + '.json', 'etag': None,
                       'manifest': {'schema': 1, 'batch_id': str(self.id), 'project_id': project.pk,
                                    'state': 'pending', 'operations': []}}
            self.journals[project.pk] = journal
        return journal

    def finalize(self):
        # This runs after the outer DB atomic block, including its commit.
        for journal in self.journals.values():
            recover_journal(journal['path'])


@contextmanager
def write_batch():
    existing = _batch.get()
    if existing:
        yield existing
        return
    batch = WriteBatch()
    token = _batch.set(batch)
    try:
        yield batch
    finally:
        _batch.reset(token)
        # A caller may already own a larger transaction. Its witness is not
        # durable yet: never mark a journal committed before that transaction
        # commits. On rollback the pending journal is recovered on next access.
        if transaction.get_connection().in_atomic_block:
            transaction.on_commit(batch.finalize)
        else:
            batch.finalize()


def guarded_put(project, path, content, etag=None):
    batch = _batch.get()
    if not batch:
        raise RecoveryRequired('canonical_write_requires_transaction')
    return batch.put(project, path, content, etag)


@contextmanager
def canonical_operation(actor=None):
    """Jobs/commands use this boundary around model and policy edits together."""
    from .canonical_projects import _pending
    if _pending.get() is not None:
        yield
        return
    with write_batch() as batch, transaction.atomic():
        pending = []
        token = _pending.set(pending)
        try:
            yield
            from .canonical_signals import flush_pending
            flush_pending(pending, actor)
            commit_witness(batch)
        finally:
            _pending.reset(token)


def guarded_delete(project, path, etag):
    batch = _batch.get()
    if not batch:
        raise RecoveryRequired('canonical_delete_requires_transaction')
    return batch.delete(project, path, etag)


def dav_delete(path, etag):
    response = cloud._request('DELETE', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={204, 404, 412}, headers={'Accept-Encoding': 'identity', 'If-Match': etag})
    return response.status_code != 412


def commit_witness(batch):
    if batch.journals:
        CanonicalWriteCommit.objects.get_or_create(pk=batch.id)


def journal_transaction(func):
    @wraps(func)
    def guarded(*args, **kwargs):
        with write_batch() as batch, transaction.atomic():
            result = func(*args, **kwargs)
            commit_witness(batch)
            return result
    return guarded


def recover_project(project):
    """Call while holding the CanonicalProject DB row lock, before projections."""
    folder = cloud.project_mountpoint(project) + '/06_Archive/CanonicalTransactions'
    response = cloud._request('PROPFIND', cloud._admin_dav_url(folder), auth=cloud._admin_auth(),
                              expected={207, 404}, headers={'Depth': '1'})
    if response.status_code == 404:
        return
    root = ElementTree.fromstring(response.content)
    for item in root.findall('{DAV:}response'):
        name = unquote(item.findtext('{DAV:}href') or '').rstrip('/').rsplit('/', 1)[-1]
        if not name.endswith('.json'):
            continue
        try:
            ident = uuid.UUID(name[:-5])
        except ValueError:
            continue
        recover_journal(folder + '/' + str(ident) + '.json')


def recover_journal(path):
    from .canonical_projects import dav_read, dav_write
    remote = dav_read(path)
    if not remote:
        raise RecoveryRequired('canonical_journal_missing:' + path)
    manifest = json.loads(remote['content'])
    suffix = '/06_Archive/CanonicalTransactions/'
    if suffix not in path or path.count(suffix) != 1:
        raise RecoveryRequired('canonical_journal_path_invalid')
    project_root, filename = path.split(suffix)
    if filename != str(uuid.UUID(manifest.get('batch_id', ''))) + '.json':
        raise RecoveryRequired('canonical_journal_identity_invalid')
    if manifest.get('schema') != 1 or manifest.get('state') not in {'pending', 'committed', 'rolled_back'}:
        raise RecoveryRequired('canonical_journal_schema:' + path)
    from .canonical_projects import ROOT
    for op in manifest.get('operations', []):
        target = op.get('path', '')
        allowed = (target == project_root or target.startswith(project_root + '/')) if op.get('kind') == 'acl' else (target == project_root + '/project.md' or target.startswith(project_root + '/' + ROOT + '/'))
        if not allowed or '..' in target.split('/') or target.startswith(project_root + '/06_Archive/CanonicalTransactions'):
            raise RecoveryRequired('canonical_journal_target_invalid:' + path)
    if manifest['state'] in {'committed', 'rolled_back'}:
        return manifest['state']
    if CanonicalWriteCommit.objects.filter(pk=manifest['batch_id']).exists():
        manifest['state'] = 'committed'
    else:
        # Restore in reverse order, retaining checkpoints for restart/replay.
        for op in reversed(manifest['operations']):
            if op.get('restored') or op.get('not_written'):
                continue
            if op.get('kind') == 'acl':
                from .canonical_acl import read_acl, write_acl
                current = read_acl(op['path'])
                if current['rules'] == op['before']['rules']:
                    op['restored'] = True
                elif not op.get('written') or current['rules'] != op['written']['rules']:
                    raise RecoveryRequired('canonical_acl_recovery_review_required:' + path)
                else:
                    if not write_acl(op['path'], op['before']['rules'], current):
                        raise RecoveryRequired('canonical_acl_recovery_conflict:' + path)
                    op['restored'] = True
                saved = dav_write(path, json.dumps(manifest, ensure_ascii=False), remote['etag'])
                if not saved:
                    raise RecoveryRequired('canonical_journal_changed:' + path)
                remote = saved
                continue
            current = dav_read(op['path'])
            before = op['before']
            if current == before:
                op['restored'] = True
                continue
            if op.get('kind') == 'delete':
                if current or not op.get('deleted') or not before:
                    raise RecoveryRequired('canonical_recovery_review_required:' + path)
                if not dav_write(op['path'], before['content'], None):
                    raise RecoveryRequired('canonical_recovery_conflict:' + path)
                op['restored'] = True
                saved = dav_write(path, json.dumps(manifest, ensure_ascii=False), remote['etag'])
                if not saved:
                    raise RecoveryRequired('canonical_journal_changed:' + path)
                remote = saved
                continue
            if not current or not op['written_etag'] or current['etag'] != op['written_etag']:
                raise RecoveryRequired('canonical_recovery_review_required:' + path)
            if before:
                result = dav_write(op['path'], before['content'], current['etag'])
                if not result:
                    raise RecoveryRequired('canonical_recovery_conflict:' + path)
            else:
                if not dav_delete(op['path'], current['etag']):
                    raise RecoveryRequired('canonical_recovery_conflict:' + path)
            op['restored'] = True
            saved = dav_write(path, json.dumps(manifest, ensure_ascii=False), remote['etag'])
            if not saved:
                raise RecoveryRequired('canonical_journal_changed:' + path)
            remote = saved
        manifest['state'] = 'rolled_back'
    if not dav_write(path, json.dumps(manifest, ensure_ascii=False), remote['etag']):
        raise RecoveryRequired('canonical_journal_changed:' + path)
    return manifest['state']
