"""Check the effective target before running any Django release operation."""
import django

django.setup()

from django.conf import settings

database = settings.DATABASES['default']
target = (database['NAME'], database['USER'], database['HOST'], str(database['PORT']))
if (
    settings.PUBLIC_BASE_URL != 'https://staging.graviquest.com'
    or target != ('gravitas_workspace_staging', 'gravitas_workspace_staging', '127.0.0.1', '15432')
    or settings.NEXTCLOUD_INTERNAL_URL != 'http://127.0.0.1:18081'
    or settings.NEXTCLOUD_PUBLIC_URL != 'https://staging.graviquest.com/nextcloud'
    or settings.SESSION_COOKIE_NAME != 'gravitas_staging_sessionid'
    or settings.EMAIL_BACKEND != 'django.core.mail.backends.locmem.EmailBackend'
    or settings.GRAVITAS_FORUM_URL
    or settings.GRAVITAS_TELEGRAM_BOT_TOKEN
    or settings.OPENEDX_ENABLED
    or any(getattr(settings, key, '') for key in (
        'CLOUDFLARE_AI_API_TOKEN', 'PULSAR_OPENAI_API_KEY', 'PULSAR_ANTHROPIC_API_KEY',
        'PULSAR_GEMINI_API_KEY', 'PULSAR_EMBEDDING_API_KEY',
    ))
):
    raise SystemExit('staging target or integration guard failed')
