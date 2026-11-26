#!/usr/bin/env bash
set -euo pipefail
umask 077

service=gravitas-workspace-staging
revision=8a008862d0ad6f72abd1cba95d368a5b88bc9595
release=/opt/gravitas-workspace-staging/releases/$revision
config=/etc/gravitas-workspace-staging
test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(git -C "$release/source" rev-parse HEAD)" = "$revision"
systemctl is-active --quiet "$service"

enrollment=$(mktemp "$config/team-owner.XXXXXX")
trap 'rm -f "$enrollment"' EXIT
printf 'TEAM_EMAIL_B64=%s\nTEAM_PASSWORD_B64=%s\n' "$TEAM_EMAIL_B64" "$TEAM_PASSWORD_B64" > "$enrollment"
unset TEAM_EMAIL_B64 TEAM_PASSWORD_B64
systemd-run --quiet --wait --pipe --collect --unit "$service-team-owner" \
  -p User=gq-workspace-stage -p "EnvironmentFile=$config/application.env" -p "EnvironmentFile=$enrollment" \
  -p "WorkingDirectory=$release/source/backend" -p MemoryMax=256M -p CPUQuota=50% \
  "$release/venv/bin/python" - <<'PY'
import base64
import os

import django

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q

from core.layer_models import CommunityProfile
from core.models import WorkspaceMembership
from core.platform_runtime_v3 import ensure_platform_workspaces


def supplied(name):
    return base64.b64decode(os.environ[name], validate=True).decode('utf-8')


assert settings.PUBLIC_BASE_URL == 'https://staging.graviquest.com'
assert settings.DATABASES['default']['NAME'] == 'gravitas_workspace_staging'
assert settings.DATABASES['default']['PORT'] == '15432'
email = supplied('TEAM_EMAIL_B64').strip().lower()
password = supplied('TEAM_PASSWORD_B64')
model = get_user_model()

try:
    validate_email(email)
except ValidationError:
    raise SystemExit('stage_team_owner=invalid_email_format') from None
if len(email) > model._meta.get_field('username').max_length or email.endswith('@example.test'):
    raise SystemExit('stage_team_owner=email_unavailable')
try:
    validate_password(password, user=model(username=email, email=email))
except ValidationError as exc:
    reasons = ','.join(sorted({reason.code or 'password_policy' for reason in exc.error_list}))
    raise SystemExit('stage_team_owner=password_invalid reasons=' + reasons) from None

with transaction.atomic():
    match = model.objects.select_for_update().filter(Q(username__iexact=email) | Q(email__iexact=email)).first()
    if match is not None:
        workspace = ensure_platform_workspaces(match)['core']
        if match.is_active and match.check_password(password) and WorkspaceMembership.objects.filter(
            workspace=workspace, user=match, role=WorkspaceMembership.Role.OWNER,
        ).exists():
            print('stage_team_owner=already_provisioned')
            raise SystemExit(0)
        raise SystemExit('stage_team_owner=existing_account_requires_review')

    user = model(username=email, email=email, is_active=True)
    user._verification_handled = True
    user.set_password(password)
    user.save()
    CommunityProfile.objects.update_or_create(user=user, defaults={
        'role': CommunityProfile.Role.TEAM, 'status': CommunityProfile.Status.ACTIVE,
        'email_verification_required': False,
    })
    workspace = ensure_platform_workspaces(user)['core']
    WorkspaceMembership.objects.update_or_create(workspace=workspace, user=user,
                                                  defaults={'role': WorkspaceMembership.Role.OWNER})
print('stage_team_owner=provisioned')
PY
