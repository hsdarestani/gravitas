from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import WorkspaceMembership
from .platform_models import WorkspaceProfile


def _reconcile(workspace_id):
    def run():
        try:
            profile = (
                WorkspaceProfile.objects.filter(
                    workspace_id=workspace_id,
                    purpose=WorkspaceProfile.Purpose.CORE,
                )
                .select_related('workspace')
                .first()
            )
            if not profile:
                return
            from .roadmap_assignment import reconcile_workspace_roadmap_assignments
            reconcile_workspace_roadmap_assignments(profile.workspace)
        except Exception:
            # Team access mutations must never fail because execution reconciliation is unavailable.
            return

    transaction.on_commit(run)


@receiver(post_save, sender=WorkspaceMembership)
@receiver(post_delete, sender=WorkspaceMembership)
def reconcile_after_core_membership_change(sender, instance, **kwargs):
    try:
        if instance.workspace.platform_profile.purpose != WorkspaceProfile.Purpose.CORE:
            return
    except Exception:
        return
    _reconcile(instance.workspace_id)


@receiver(post_save, sender=get_user_model())
def reconcile_after_core_user_identity_change(sender, instance, **kwargs):
    workspace_ids = list(
        WorkspaceMembership.objects.filter(
            user=instance,
            workspace__platform_profile__purpose=WorkspaceProfile.Purpose.CORE,
        ).values_list('workspace_id', flat=True)
    )
    for workspace_id in workspace_ids:
        _reconcile(workspace_id)
