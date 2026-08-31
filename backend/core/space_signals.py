import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .space_fs import SpaceConflict
from .space_models import ProjectSpaceLink
from .space_moves import sync_note_moveaware, sync_project_moveaware

logger = logging.getLogger(__name__)


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


@receiver(post_save, sender=ResearchProject)
def sync_project_markdown_after_save(sender, instance, **kwargs):
    transaction.on_commit(lambda: _sync_project(instance.pk))


@receiver(post_save, sender=KnowledgeResource)
def sync_note_markdown_after_save(sender, instance, **kwargs):
    if instance.kind == KnowledgeResource.Kind.NOTE:
        transaction.on_commit(lambda: _sync_note(instance.pk))
