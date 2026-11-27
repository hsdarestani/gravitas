"""Settings for the Workspace V2 team preview on staging.graviquest.com."""

import os
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F403


GRAVIQUEST_STAGING = True
STAGING_HOST = 'staging.graviquest.com'
STAGING_ORIGIN = f'https://{STAGING_HOST}'
STAGING_STATE = Path('/var/lib/gravitas-workspace-staging')


def _required(name):
    value = os.environ.get(name)
    if not value or not value.strip():
        raise ImproperlyConfigured(f'Missing staging configuration: {name}')
    return value


def _staging_url(name, *, public):
    value = _required(name).rstrip('/')
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        raise ImproperlyConfigured(f'Invalid staging Nextcloud URL: {name}') from None
    if public:
        valid = ((url.netloc == STAGING_HOST and url.path == '/nextcloud')
                 or (url.netloc == 'cloud-staging.graviquest.com' and not url.path))
        valid = valid and url.scheme == 'https'
    else:
        valid = url.scheme in ('http', 'https') and (
            url.hostname == 'nextcloud-staging'
            or (url.hostname == '127.0.0.1' and port is not None and port != 8081)
            or (url.scheme == 'https' and url.netloc == 'cloud-staging.graviquest.com')
        )
    if not valid or url.username or url.password or url.query or url.fragment:
        raise ImproperlyConfigured(f'Invalid staging Nextcloud URL: {name}')
    return value


DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': 'gravitas_workspace_staging',
    'USER': 'gravitas_workspace_staging',
    'PASSWORD': _required('GQ_STAGING_DB_PASSWORD'),
    'HOST': _required('GQ_STAGING_DB_HOST'),
    'PORT': os.environ.get('GQ_STAGING_DB_PORT', '5432'),
}}
if DATABASES['default']['HOST'] not in ('127.0.0.1', 'postgres-staging'):
    raise ImproperlyConfigured('Staging PostgreSQL must use the local or isolated staging service.')

SECRET_KEY = _required('GQ_STAGING_SECRET_KEY')
DEBUG = False
ALLOWED_HOSTS = [STAGING_HOST]
CSRF_TRUSTED_ORIGINS = [STAGING_ORIGIN]
PUBLIC_BASE_URL = STAGING_ORIGIN
SESSION_COOKIE_NAME = 'gravitas_staging_sessionid'
CSRF_COOKIE_NAME = 'gravitas_staging_csrftoken'
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_DOMAIN = None
WORKSPACE_STUDIO_ENABLED = os.environ.get('WORKSPACE_STUDIO_ENABLED') == '1'
WORKSPACE_STUDIO_AUTO_TEAM_FOLDERS = WORKSPACE_STUDIO_ENABLED
GRAVITAS_CANONICAL_ADOPTION_ENABLED = WORKSPACE_STUDIO_AUTO_TEAM_FOLDERS

CORE_UPLOAD_ROOT = STAGING_STATE / 'core-uploads'
TOPIC_MEDIA_ROOT = STAGING_STATE / 'topic-media'
LMS_MEDIA_ROOT = STAGING_STATE / 'lms-media'
NEXTCLOUD_INTERNAL_URL = _staging_url('GQ_STAGING_NEXTCLOUD_INTERNAL_URL', public=False)
NEXTCLOUD_PUBLIC_URL = _staging_url('GQ_STAGING_NEXTCLOUD_PUBLIC_URL', public=True)
NEXTCLOUD_ADMIN_USER = _required('GQ_STAGING_NEXTCLOUD_ADMIN_USER')
NEXTCLOUD_ADMIN_PASSWORD = _required('GQ_STAGING_NEXTCLOUD_ADMIN_PASSWORD')
NEXTCLOUD_OIDC_PROVIDER_ID = _required('GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID')
if not NEXTCLOUD_OIDC_PROVIDER_ID.isdecimal() or int(NEXTCLOUD_OIDC_PROVIDER_ID) < 1:
    raise ImproperlyConfigured('Staging Nextcloud requires a numeric OIDC provider ID.')
GRAVITAS_OIDC_ISSUER = f'{STAGING_ORIGIN}/api/oidc'
GRAVITAS_OIDC_CLIENT_ID = 'gravitas-nextcloud-staging'
GRAVITAS_OIDC_CLIENT_SECRET = _required('GQ_STAGING_OIDC_CLIENT_SECRET')
GRAVITAS_OIDC_PRIVATE_KEY_B64 = _required('GQ_STAGING_OIDC_PRIVATE_KEY_B64')

GOOGLE_OAUTH_CLIENT_ID = ''
GOOGLE_OAUTH_CLIENT_SECRET = ''
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
GRAVITAS_TELEGRAM_BOT_TOKEN = ''
GRAVITAS_TELEGRAM_WEBHOOK_SECRET = ''
GRAVITAS_PROJECT_GITHUB_TOKENS = {}

# The QA environment has no permission to send to external providers by default.
GRAVITAS_FORUM_URL = ''
GRAVITAS_DISCOURSE_CONNECT_SECRET = ''
GRAVITAS_DISCOURSE_API_KEY = ''
GRAVITAS_DISCOURSE_API_USERNAME = ''
GRAVITAS_FORUM_MODERATION_TOKEN = ''
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                      'LOCATION': 'gravitas-workspace-staging'}}
MIDDLEWARE = [
    *MIDDLEWARE[:MIDDLEWARE.index('django.contrib.auth.middleware.AuthenticationMiddleware') + 1],
    'gravitas_backend.staging_metadata.staging_release_metadata',
    *MIDDLEWARE[MIDDLEWARE.index('django.contrib.auth.middleware.AuthenticationMiddleware') + 1:],
]
OPENEDX_ENABLED = False
OPENEDX_LMS_URL = ''
OPENEDX_CMS_URL = ''
OPENEDX_CLIENT_ID = ''
OPENEDX_CLIENT_SECRET = ''
CLOUDFLARE_AI_ACCOUNT_ID = ''
CLOUDFLARE_AI_API_TOKEN = ''
PULSAR_OPENAI_API_KEY = ''
PULSAR_ANTHROPIC_API_KEY = ''
PULSAR_GEMINI_API_KEY = ''
PULSAR_EMBEDDING_API_KEY = ''
PULSAR_SEMANTIC_ENABLED = False
GRAVITAS_PRIVATE_PULSAR_MERGE_ENABLED = False
GRAVITAS_PROJECT_DATABASE_ALIASES = {}
GRAVITAS_PROJECT_DATABASE_DATASETS = {}
