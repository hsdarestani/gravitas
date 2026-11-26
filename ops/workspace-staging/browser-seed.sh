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

test_data=$(mktemp "$config/browser-qa.XXXXXX")
trap 'rm -f "$test_data"' EXIT
for value in "$QA_OWNER_PASSWORD" "$QA_MEMBER_PASSWORD" "$QA_RESEARCH_PASSWORD"; do
  [[ "$value" =~ ^[0-9a-f]{64}$ ]]
done
printf 'QA_OWNER_PASSWORD=%s\nQA_MEMBER_PASSWORD=%s\nQA_RESEARCH_PASSWORD=%s\n' \
  "$QA_OWNER_PASSWORD" "$QA_MEMBER_PASSWORD" "$QA_RESEARCH_PASSWORD" > "$test_data"
unset QA_OWNER_PASSWORD QA_MEMBER_PASSWORD QA_RESEARCH_PASSWORD
systemd-run --quiet --wait --pipe --collect --unit "$service-browser-seed" \
  -p User=gq-workspace-stage -p "EnvironmentFile=$config/application.env" -p "EnvironmentFile=$test_data" \
  -p "WorkingDirectory=$release/source/backend" -p MemoryMax=256M -p CPUQuota=50% \
  "$release/venv/bin/python" - <<'PY'
import os
import django

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from core.canonical_models import CanonicalProject

assert settings.PUBLIC_BASE_URL == 'https://staging.graviquest.com'
assert settings.DATABASES['default']['NAME'] == 'gravitas_workspace_staging'
assert settings.DATABASES['default']['PORT'] == '15432'

with transaction.atomic():
    fixtures = {}
    for role in ('owner', 'member', 'research'):
        user = get_user_model().objects.get(username=f'workspace-staging-qa-{role}@example.test')
        user.set_password(os.environ['QA_' + role.upper() + '_PASSWORD'])
        user.save(update_fields=['password'])
        fixtures[role] = user
    adopted_project = CanonicalProject.objects.filter(
        enabled=True, project__archived=False, project__owner=fixtures['owner'],
        project__title__startswith='Staging QA ',
    ).latest('id')

print(adopted_project.project_id)
PY
