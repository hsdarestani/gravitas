from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import WorkspaceMembership
from .platform_models import WorkspaceProfile


@receiver(post_save, sender=WorkspaceProfile)
def isolate_research_workspace_from_legacy_acl(sender, instance, **kwargs):
    """Keep V2 research workspaces out of the legacy workspace-wide ACL.

    The original KMS API treats every WorkspaceMembership as permission to read
    the whole workspace. Gravitas V2 instead grants access per research project
    and per object. Removing broad memberships here prevents a legacy endpoint
    from bypassing Private / Specific people policies while the personal KMS and
    Core operating workspace remain backward compatible.
    """
    if instance.purpose == WorkspaceProfile.Purpose.RESEARCH:
        WorkspaceMembership.objects.filter(workspace=instance.workspace).delete()
