import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _csv_env(name, default):
    value = os.environ.get(name, '')
    if not value.strip():
        return list(default)
    return [item.strip() for item in value.split(',') if item.strip()]


SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'change-me-in-production')
DEBUG = os.environ.get('DJANGO_DEBUG', '0') == '1'
ALLOWED_HOSTS = _csv_env(
    'DJANGO_ALLOWED_HOSTS',
    ['gravitasplus.com', 'www.gravitasplus.com', '127.0.0.1', 'localhost'],
)
CSRF_TRUSTED_ORIGINS = _csv_env(
    'DJANGO_CSRF_TRUSTED_ORIGINS',
    ['https://gravitasplus.com', 'https://www.gravitasplus.com'],
)

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'core',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'gravitas_backend.urls'
WSGI_APPLICATION = 'gravitas_backend.wsgi.application'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DJANGO_DB_NAME', 'gravitas'),
        'USER': os.environ.get('DJANGO_DB_USER', 'gravitas'),
        'PASSWORD': os.environ.get('DJANGO_DB_PASSWORD', ''),
        'HOST': os.environ.get('DJANGO_DB_HOST', ''),
        'PORT': os.environ.get('DJANGO_DB_PORT', ''),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LANGUAGE_CODE = os.environ.get('DJANGO_LANGUAGE_CODE', 'en-us')
TIME_ZONE = os.environ.get('DJANGO_TIME_ZONE', 'UTC')
USE_I18N = True
USE_TZ = True
STATIC_URL = '/django-static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    }
}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_SECURE_HSTS_SECONDS', '31536000')) if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_NAME = os.environ.get('DJANGO_SESSION_COOKIE_NAME', 'sessionid')
CSRF_COOKIE_NAME = os.environ.get('DJANGO_CSRF_COOKIE_NAME', 'csrftoken')

EMAIL_BACKEND = os.environ.get(
    'DJANGO_EMAIL_BACKEND',
    'django.core.mail.backends.smtp.EmailBackend',
)
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.strato.de')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '465'))
EMAIL_USE_SSL = os.environ.get('EMAIL_USE_SSL', '1') == '1'
EMAIL_USE_TLS = False
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', 'webmaster@gravitasplus.com')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Gravitas+ <webmaster@gravitasplus.com>')
SERVER_EMAIL = DEFAULT_FROM_EMAIL
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', 'https://gravitasplus.com').rstrip('/')
PASSWORD_RESET_TIMEOUT = int(os.environ.get('PASSWORD_RESET_TIMEOUT', '3600'))

GRAVITAS_DEFAULT_QUOTA_BYTES = int(os.environ.get('GRAVITAS_DEFAULT_QUOTA_BYTES', str(5 * 1024 ** 3)))
GRAVITAS_MAX_UPLOAD_BYTES = int(os.environ.get('GRAVITAS_MAX_UPLOAD_BYTES', str(250 * 1024 ** 2)))
DATA_UPLOAD_MAX_MEMORY_SIZE = GRAVITAS_MAX_UPLOAD_BYTES + (1024 * 1024)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
NEXTCLOUD_INTERNAL_URL = os.environ.get('NEXTCLOUD_INTERNAL_URL', 'http://127.0.0.1:8081').rstrip('/')
NEXTCLOUD_ADMIN_USER = os.environ.get('NEXTCLOUD_ADMIN_USER', '')
NEXTCLOUD_ADMIN_PASSWORD = os.environ.get('NEXTCLOUD_ADMIN_PASSWORD', '')
NEXTCLOUD_CONNECT_TIMEOUT = int(os.environ.get('NEXTCLOUD_CONNECT_TIMEOUT', '5'))
NEXTCLOUD_READ_TIMEOUT = int(os.environ.get('NEXTCLOUD_READ_TIMEOUT', '300'))

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'production': {
            'format': '{asctime} {levelname} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'production',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO'),
    },
    'loggers': {
        'django.request': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'django.security': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
    },
}
