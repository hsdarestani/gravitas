from django.conf import settings
from django.db import models


class OIDCAuthorizationCode(models.Model):
    code_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_oidc_codes')
    client_id = models.CharField(max_length=160)
    redirect_uri = models.URLField(max_length=600)
    scope = models.CharField(max_length=300, default='openid email profile')
    nonce = models.CharField(max_length=300, blank=True)
    code_challenge = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['expires_at'])]


class OIDCAccessToken(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_oidc_tokens')
    client_id = models.CharField(max_length=160)
    scope = models.CharField(max_length=300, default='openid email profile')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=['expires_at'])]
