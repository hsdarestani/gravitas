from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .layer_models import CommunityProfile, ModuleGrant


@receiver(post_save, sender=get_user_model(), dispatch_uid='gravitas_five_layer_user_defaults')
def provision_five_layer_identity(sender, instance, created, **kwargs):
    """Keep account creation boring: Layer 2 is always available by default.

    LMS, Research and Core are intentionally *not* granted here. They are
    independent entitlements and must come from enrollment, project access or
    an administrator/team decision.
    """
    if not instance.pk:
        return
    CommunityProfile.objects.get_or_create(user=instance)
    ModuleGrant.objects.get_or_create(
        user=instance,
        module=ModuleGrant.Module.DASHBOARD,
        defaults={
            'enabled': True,
            'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
            'source': ModuleGrant.Source.SYSTEM,
        },
    )
