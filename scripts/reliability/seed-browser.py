"""Create an isolated local browser fixture; explicitly refuse production settings."""
import json
import os
from pathlib import Path

assert os.environ.get('DJANGO_SETTINGS_MODULE') == 'gravitas_backend.test_settings'
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from core.models import ResearchProject, ProjectMembership
from core.platform_models import ResearchProjectProfile
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.operating_models import OperatingTask

assert settings.DATABASES['default']['ENGINE'] == 'django.db.backends.sqlite3'
user, _ = get_user_model().objects.get_or_create(username='workspace-reliability-local', defaults={
    'email': 'workspace-reliability@example.test', 'is_staff': True, 'is_superuser': True,
})
spaces = ensure_platform_workspaces(user)
project, _ = ResearchProject.objects.get_or_create(workspace=spaces['research'], owner=user,
    title='Workspace reliability browser fixture')
ResearchProjectProfile.objects.get_or_create(project=project)
ProjectMembership.objects.get_or_create(project=project, user=user, defaults={'role': 'owner'})
task, _ = OperatingTask.objects.get_or_create(workspace=spaces['core'], project=project, owner=user,
    title='Reliability task fixture', defaults={'definition_of_done': 'Browser save survives reload.', 'due_date': '2026-12-31'})
client = Client(HTTP_HOST='localhost')
client.force_login(user)
Path(os.environ['E2E_FIXTURE']).write_text(json.dumps({
    'project_id': project.pk, 'task_id': task.pk,
    'cookies': [{'name': k, 'value': v.value, 'domain': '127.0.0.1', 'path': '/', 'secure': False, 'httpOnly': k == 'sessionid'}
                for k, v in client.cookies.items()],
}))
print('Isolated local browser fixture ready')
