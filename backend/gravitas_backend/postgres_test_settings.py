"""Opt-in CI settings for real row-lock/concurrent-editor regression coverage."""
import os
from .test_settings import *  # noqa: F401,F403

DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': os.environ.get('TEST_POSTGRES_DB', 'gravitas_test'),
    'USER': os.environ.get('TEST_POSTGRES_USER', 'postgres'),
    'PASSWORD': os.environ['TEST_POSTGRES_PASSWORD'],
    'HOST': '127.0.0.1', 'PORT': os.environ.get('TEST_POSTGRES_PORT', '5432'),
}}
