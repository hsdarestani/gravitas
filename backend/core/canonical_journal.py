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
        from .canonical_projects import dav_read, dav_write
        journal = self.journals.get(project.pk)
        if not journal:
            root = cloud.project_mountpoint(project)
            folder = '06_Archive/CanonicalTransactions'
            cloud.admin_make_folder(root + '/' + folder)
            cloud.set_team_folder_acl(root, folder, cloud.project_group_id(project), {}, 'private')
            journal = {'path': root + '/' + folder + '/' + str(self.id) + '.json', 'etag': None,
                       'manifest': {'schema': 1, 'batch_id': str(self.id), 'project_id': project.pk,
                                    'state': 'pending', 'operations': []}}
            self.journals[project.pk] = journal
        if any(op['path'] == path for op in journal['manifest']['operations']):
            raise RecoveryRequired('canonical_repeated_file_write_requires_review:' + journal['path'])
        before = dav_read(path)
        if (before['etag'] if before else None) != etag:
            return None
        operation = {'path': path, 'before': before, 'content': content, 'written_etag': None}
        journal['manifest']['operations'].append(operation)
        self.persist(journal)  # Durable BEFORE touching a canonical file.
        result = dav_write(path, content, etag)
        if result is None:
            operation['not_written'] = True
        else:
            operation['written_etag'] = result['etag']
        self.persist(journal)
        return result

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
        batch.finalize()


def guarded_put(project, path, content, etag=None):
    from .canonical_projects import dav_write
    batch = _batch.get()
    return batch.put(project, path, content, etag) if batch else dav_write(path, content, etag)


def dav_delete(path, etag):
    response = cloud._request('DELETE', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={204, 404, 412}, headers={'If-Match': etag})
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
        if not (target == project_root + '/project.md' or target.startswith(project_root + '/' + ROOT + '/')) or '..' in target.split('/'):
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
            current = dav_read(op['path'])
            before = op['before']
            if current == before:
                op['restored'] = True
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
