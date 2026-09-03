import logging
import queue
import threading

from django.db import close_old_connections, transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .space_fs import SpaceConflict
from .space_models import ProjectSpaceLink
from .space_moves import sync_note_moveaware, sync_project_moveaware

logger = logging.getLogger(__name__)

# Saving a note must not wait for multiple WebDAV round trips. A small daemon
# worker keeps Space/Nextcloud synchronization eventual while the API can return
# as soon as the database commit succeeds. The bounded queue also prevents a
# burst of edits from creating an unbounded number of threads.
_NOTE_SYNC_QUEUE = queue.Queue(maxsize=256)
_NOTE_SYNC_WORKER_STARTED = False
_NOTE_SYNC_WORKER_LOCK = threading.Lock()


def _sync_project(project_id):
    project = ResearchProject.objects.select_related('owner', 'workspace').filter(pk=project_id).first()
    if not project:
        return
    users = {project.owner_id: project.owner}
    for link in ProjectSpaceLink.objects.filter(project=project).select_related('user'):
        users[link.user_id] = link.user
    for user in users.values():
        try:
            sync_project_moveaware(project, user)
        except SpaceConflict:
            logger.info(
                'Project %s Space copy for user %s has a Nextcloud metadata conflict; confirmation required',
                project_id, user.pk,
            )
        except (cloud.CloudError, ValueError):
            logger.exception('Project %s Space sync for user %s deferred', project_id, user.pk)


def _sync_note(resource_id):
    resource = KnowledgeResource.objects.select_related('owner', 'project').filter(pk=resource_id, kind='note').first()
    if not resource:
        return
    try:
        sync_note_moveaware(resource)
    except SpaceConflict:
        logger.info('Note %s has a Nextcloud metadata conflict; user confirmation required', resource_id)
    except (cloud.CloudError, ValueError):
        logger.exception('Note %s Space sync deferred', resource_id)


def _note_sync_worker():
    while True:
        resource_id = _NOTE_SYNC_QUEUE.get()
        try:
            # Django database connections are thread-local. Reset them before
            # and after every job so long-lived workers never reuse stale state.
            close_old_connections()
            _sync_note(resource_id)
        except Exception:
            logger.exception('Unexpected background Space sync failure for note %s', resource_id)
        finally:
            close_old_connections()
            _NOTE_SYNC_QUEUE.task_done()


def _ensure_note_sync_worker():
    global _NOTE_SYNC_WORKER_STARTED
    if _NOTE_SYNC_WORKER_STARTED:
        return
    with _NOTE_SYNC_WORKER_LOCK:
        if _NOTE_SYNC_WORKER_STARTED:
            return
        worker = threading.Thread(
            target=_note_sync_worker,
            name='gravitas-note-space-sync',
            daemon=True,
        )
        worker.start()
        _NOTE_SYNC_WORKER_STARTED = True


def _queue_note_sync(resource_id):
    _ensure_note_sync_worker()
    try:
        _NOTE_SYNC_QUEUE.put_nowait(resource_id)
    except queue.Full:
        # The database save remains authoritative. The regular Space sync action
        # will pick the note up later instead of making the user's save request
        # block or fail because the remote synchronization queue is saturated.
        logger.warning('Background Space sync queue full; note %s remains pending', resource_id)


@receiver(post_save, sender=ResearchProject)
def sync_project_markdown_after_save(sender, instance, **kwargs):
    transaction.on_commit(lambda: _sync_project(instance.pk))


@receiver(post_save, sender=KnowledgeResource)
def sync_note_markdown_after_save(sender, instance, **kwargs):
    if instance.kind == KnowledgeResource.Kind.NOTE:
        transaction.on_commit(lambda: _queue_note_sync(instance.pk))
