#!/usr/bin/env bash
set -euo pipefail
umask 077

service=gravitas-workspace-staging
config=/etc/gravitas-workspace-staging
stage_root=/opt/gravitas-workspace-staging/releases
test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(systemctl show "$service" -p FragmentPath --value)" = "/etc/systemd/system/$service.service"
systemctl is-active --quiet "$service"
working=$(systemctl show "$service" -p WorkingDirectory --value)
runtime=$(sed -n 's|^ExecStart=\(/opt/gravitas-workspace-staging/releases/[0-9a-f]\{40\}/venv\)/bin/gunicorn --bind 127\.0\.0\.1:18000 .*|\1|p' "/etc/systemd/system/$service.service")
[[ "$working" =~ ^$stage_root/[0-9a-f]{40}/source/backend$ ]]
[[ "$runtime" =~ ^$stage_root/[0-9a-f]{40}/venv$ ]]
grep -Fxq 'DJANGO_SETTINGS_MODULE=gravitas_backend.workspace_staging_settings' "$config/application.env"

reset=$(mktemp "$config/team-owner-reset.XXXXXX")
trap 'rm -f "$reset"' EXIT
printf 'TEAM_EMAIL_B64=%s\nTEAM_PASSWORD_B64=%s\n' "$TEAM_EMAIL_B64" "$TEAM_PASSWORD_B64" > "$reset"
unset TEAM_EMAIL_B64 TEAM_PASSWORD_B64

systemd-run --quiet --wait --pipe --collect --unit "$service-team-owner-reset" \
  -p User=gq-workspace-stage -p "EnvironmentFile=$config/application.env" -p "EnvironmentFile=$reset" \
  -p "WorkingDirectory=$working" -p MemoryMax=256M -p CPUQuota=50% \
  "$runtime/bin/python" - <<'PY'
import base64
import os

import django
import requests

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction

from core.platform_models import WorkspaceProfile
from core.platform_runtime_v3 import _canonical_workspace, core_role

origin = 'https://staging.graviquest.com'
database = settings.DATABASES['default']
if (
    settings.PUBLIC_BASE_URL != origin
    or database['NAME'] != 'gravitas_workspace_staging'
    or str(database['PORT']) != '15432'
    or database['HOST'] != '127.0.0.1'
    or settings.SESSION_COOKIE_NAME != 'gravitas_staging_sessionid'
):
    raise SystemExit('stage_password_reset=unexpected_environment')

email = base64.b64decode(os.environ.pop('TEAM_EMAIL_B64'), validate=True).decode('utf-8').strip().lower()
password = base64.b64decode(os.environ.pop('TEAM_PASSWORD_B64'), validate=True).decode('utf-8')
if not email or email.endswith('@example.test') or not password:
    raise SystemExit('stage_password_reset=invalid_secret_input')

users = get_user_model().objects
with transaction.atomic():
    owner = users.select_for_update().filter(username=email, email__iexact=email, is_active=True,
                                               is_staff=False, is_superuser=False).first()
    core = _canonical_workspace(WorkspaceProfile.Purpose.CORE)
    if owner is None or core is None or core_role(owner, core) != 'owner':
        raise SystemExit('stage_password_reset=existing_named_core_owner_required')
    try:
        validate_password(password, owner)
    except ValidationError as exc:
        reasons = ','.join(sorted({reason.code or 'password_policy' for reason in exc.error_list}))
        raise SystemExit('stage_password_reset=password_invalid reasons=' + reasons) from None

    if not owner.check_password(password):
        owner.set_password(password)
        owner.save(update_fields=['password'])
        print('stage_password_reset=updated', flush=True)
    else:
        print('stage_password_reset=already_current', flush=True)

phase = 'csrf'
try:
    with requests.Session() as session:
        session.trust_env = False
        csrf = session.get(origin + '/api/auth/csrf/', timeout=15, allow_redirects=False)
        token = session.cookies.get(settings.CSRF_COOKIE_NAME)
        if csrf.status_code != 200 or not token:
            raise SystemExit('stage_owner_sign_in=csrf_unavailable')
        phase = 'login'
        signin = session.post(
            origin + '/api/auth/login/',
            json={'email': email, 'password': password, 'keep': False},
            headers={'Origin': origin, 'X-CSRFToken': token}, timeout=15, allow_redirects=False,
        )
        if signin.status_code != 200 or not signin.json().get('ok'):
            raise SystemExit(f'stage_owner_sign_in=login_http_{signin.status_code}')
        phase = 'owner_access'
        state = session.get(origin + '/api/workspace-v2/state/', timeout=20, allow_redirects=False)
        actor = state.json().get('actor', {}) if state.status_code == 200 else {}
        if actor.get('id') != owner.pk or actor.get('role') != 'owner':
            raise SystemExit(f'stage_owner_sign_in=owner_access_http_{state.status_code}')
        print('stage_owner_sign_in=verified')
        phase = 'logout'
        token = session.cookies.get(settings.CSRF_COOKIE_NAME)
        session.post(origin + '/api/auth/logout/', headers={'Origin': origin, 'X-CSRFToken': token},
                     timeout=10, allow_redirects=False)
except (requests.RequestException, ValueError):
    raise SystemExit('stage_owner_sign_in=verification_error phase=' + phase) from None
PY
