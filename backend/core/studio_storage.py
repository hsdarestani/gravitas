"""Prepare canonical Nextcloud project folders outside Studio's HTTP requests."""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .canonical_projects import active, adopt_project
from .models import WorkspaceStudioProject

logger = logging.getLogger(__name__)


class StudioStoragePending(Exception):
    code = 'studio_project_storage_pending'


def queue_team_folder(project_id):
    if settings.WORKSPACE_STUDIO_AUTO_TEAM_FOLDERS:
        WorkspaceStudioProject.objects.filter(project_id=project_id, nextcloud_provision_at__isnull=True).update(
            nextcloud_provision_at=timezone.now(),
        )


def require_team_folder_ready(project):
    if (settings.WORKSPACE_STUDIO_AUTO_TEAM_FOLDERS and project and project.pk
            and WorkspaceStudioProject.objects.filter(
                project_id=project.pk, nextcloud_provision_at__isnull=False,
            ).exists()):
        raise StudioStoragePending


@transaction.atomic
def _provision(studio_id, due):
    studio = WorkspaceStudioProject.objects.select_for_update(skip_locked=True, of=('self',)).select_related(
        'project__owner',
    ).filter(pk=studio_id, nextcloud_provision_at__lte=due).first()
    if not studio:
        return False
    if not active(studio.project):
        adopt_project(studio.project, studio.project.owner)
    studio.nextcloud_provision_at = None
    studio.save(update_fields=['nextcloud_provision_at'])
    return True


def provision_next_team_folder():
    if not settings.WORKSPACE_STUDIO_AUTO_TEAM_FOLDERS:
        return 'disabled'
    due = timezone.now()
    studio_id = WorkspaceStudioProject.objects.filter(
        nextcloud_provision_at__lte=due,
    ).order_by('nextcloud_provision_at', 'pk').values_list('pk', flat=True).first()
    if studio_id is None:
        return 'idle'
    try:
        return 'ready' if _provision(studio_id, due) else 'idle'
    except Exception as exc:
        # Retry the same project after rollback. The canonical journal and
        # native mount name are stable across attempts.
        WorkspaceStudioProject.objects.filter(pk=studio_id, nextcloud_provision_at__lte=due).update(
            nextcloud_provision_at=timezone.now() + timedelta(minutes=2),
        )
        logger.warning('Studio Team Folder setup deferred: studio_project=%s reason=%s', studio_id, type(exc).__name__)
        return 'deferred'
