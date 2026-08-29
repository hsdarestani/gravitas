from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import ProjectMembership, WorkspaceMembership
from .platform_models import AccessGrant, WorkspaceProfile


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


@receiver(post_save, sender=ProjectMembership)
def mirror_project_membership_to_granular_acl(sender, instance, **kwargs):
    """Make project membership usable by every V2 endpoint without broad ACLs."""
    role = {
        ProjectMembership.Role.OWNER: AccessGrant.Role.MANAGE,
        ProjectMembership.Role.EDITOR: AccessGrant.Role.EDIT,
        ProjectMembership.Role.VIEWER: AccessGrant.Role.VIEW,
    }.get(instance.role, AccessGrant.Role.VIEW)
    content_type = ContentType.objects.get_for_model(instance.project, for_concrete_model=False)
    AccessGrant.objects.update_or_create(
        content_type=content_type,
        object_id=instance.project_id,
        user=instance.user,
        defaults={
            'role': role,
            'granted_by': instance.project.owner,
            'expires_at': None,
        },
    )


@receiver(post_delete, sender=ProjectMembership)
def remove_project_membership_grant(sender, instance, **kwargs):
    content_type = ContentType.objects.get_for_model(instance.project, for_concrete_model=False)
    AccessGrant.objects.filter(
        content_type=content_type,
        object_id=instance.project_id,
        user=instance.user,
    ).delete()
