#!/usr/bin/env python3
"""Run the authenticated Studio against a disposable, loopback-only database."""

import argparse
import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def serve(database, frontend_port, backend_port):
    sys.path.insert(0, str(ROOT / 'backend'))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'gravitas_backend.test_settings'
    # The preview must always run in isolation even from a shell configured
    # for deployment. These values affect this process only.
    os.environ['DJANGO_DEBUG'] = '1'
    os.environ['DJANGO_ALLOWED_HOSTS'] = '127.0.0.1,localhost'
    os.environ['DJANGO_CSRF_TRUSTED_ORIGINS'] = f'http://127.0.0.1:{frontend_port}'
    os.environ['WORKSPACE_STUDIO_ENABLED'] = '1'

    import django
    from django.conf import settings
    settings.DATABASES['default']['NAME'] = database
    # Fixture records must never synchronize to external storage.
    settings.NEXTCLOUD_ADMIN_USER = ''
    settings.NEXTCLOUD_ADMIN_PASSWORD = ''
    settings.NEXTCLOUD_INTERNAL_URL = 'http://127.0.0.1:1'
    settings.NEXTCLOUD_PUBLIC_URL = f'http://127.0.0.1:{frontend_port}/nextcloud'
    settings.PUBLIC_BASE_URL = f'http://127.0.0.1:{frontend_port}'
    django.setup()

    from django.contrib.auth import get_user_model
    from django.core.management import call_command
    from django.utils import timezone

    from core.models import ResearchProject
    from core.operating_models import OperatingMeeting, OperatingTask, WorkStatus
    from core.platform_runtime_v3 import ensure_platform_workspaces

    call_command('migrate', interactive=False, verbosity=0)
    email = 'studio-preview@example.test'
    password = secrets.token_urlsafe(18)
    user = get_user_model().objects.create_user(email, email=email, password=password, first_name='Studio Preview')
    workspaces = ensure_platform_workspaces(user)
    project = ResearchProject.objects.create(workspace=workspaces['research'], owner=user, title='Workspace Studio review')
    previous = None
    for label, status in (
        ('Capture reference views', WorkStatus.DONE),
        ('Review the interface', WorkStatus.ACTIVE),
        ('Confirm acceptance', WorkStatus.READY),
    ):
        previous = OperatingTask.objects.create(
            workspace=workspaces['core'], project=project, title=label,
            owner=user, status=status, definition_of_done='Attach the review evidence.',
            studio_duration_days=2, dependency=previous,
        )
    OperatingMeeting.objects.create(
        workspace=workspaces['core'], owner=user, title='Review session', kind=OperatingMeeting.Kind.WEEKLY,
        scheduled_for=timezone.now(),
    )
    print(f'Workspace Studio  http://127.0.0.1:{frontend_port}/workspace-v2', flush=True)
    print(f'V1 Workspace      http://127.0.0.1:{frontend_port}/workspace', flush=True)
    print(f'Local login       {email}', flush=True)
    print(f'Local password    {password}', flush=True)

    preview = subprocess.Popen(
        ['node', str(ROOT / 'scripts' / 'preview-server.mjs'), '--port', str(frontend_port),
         '--api', f'http://127.0.0.1:{backend_port}'],
        cwd=ROOT,
    )
    try:
        call_command('runserver', f'127.0.0.1:{backend_port}', use_reloader=False)
    finally:
        preview.terminate()
        preview.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--backend-port', type=int, default=8000)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='graviquest-studio-') as directory:
        serve(Path(directory) / 'studio.sqlite3', args.port, args.backend_port)


if __name__ == '__main__':
    main()
