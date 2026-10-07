"""Execute the explicitly selected, idempotent delivery plan after deployment.

The plan binds the project created and verified through the signed-in UI.
No accounts, access grants, publications or Telegram messages are created.
"""
import argparse
from io import StringIO
import json
import hashlib
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plan', type=Path, required=True)
parser.add_argument('--source-root', type=Path, required=True)
args = parser.parse_args()
plan = json.loads(args.plan.read_text())
if plan.get('schema') != 1 or plan.get('operation') != 'provision_existing_pulsar_project' or type(plan.get('project_id')) is not int:
    raise ValueError('Unsupported delivery plan')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravitas_backend.settings')
import django
django.setup()
from django.core.management import call_command
from django.conf import settings
from core.models import ResearchProject, KnowledgeResource
from core.platform_models import MindMap
from core.platform_access import can_manage

# A successful plan is one-off. Future deploys do not reactivate an archived
# project or undo changes; a changed plan requires a new checked-in review.
receipt_dir = Path(settings.CORE_UPLOAD_ROOT) / '.operations'
receipt_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
receipt = receipt_dir / (hashlib.sha256(args.plan.read_bytes()).hexdigest() + '.json')
if receipt.exists():
    print('Selected delivery plan already applied; no further production writes.')
    raise SystemExit(0)

project = ResearchProject.objects.select_related('owner').get(pk=plan['project_id'], archived=False)
if project.title != plan['expected_title'] or not project.owner.is_active or not can_manage(project.owner, project):
    raise ValueError('Selected delivery project identity/access changed')
before = set(KnowledgeResource.objects.filter(project=project).values_list('pk', flat=True))
options = dict(actor=project.owner.email, project=project.pk, apply=True, source_root=args.source_root, stdout=StringIO())
call_command('setup_pulsar_research_project', **options)
first = set(KnowledgeResource.objects.filter(project=project).values_list('pk', flat=True))
maps = set(MindMap.objects.filter(project=project).values_list('pk', flat=True))
call_command('setup_pulsar_research_project', **options)
second = set(KnowledgeResource.objects.filter(project=project).values_list('pk', flat=True))
if not before.issubset(first) or first != second or maps != set(MindMap.objects.filter(project=project).values_list('pk', flat=True)):
    raise ValueError('Source provisioning identity/replay check failed')
result = {'operation': plan['operation'], 'project_id': project.pk,
    'source_notes': len(first), 'source_maps': len(maps), 'existing_ids_preserved': True, 'repeat_idempotent': True,
    'canonical_adoption': False, 'live_acceptance_complete': False}
temporary = receipt.with_suffix('.tmp')
with temporary.open('w') as handle:
    json.dump(result, handle); handle.flush(); os.fsync(handle.fileno())
os.chmod(temporary, 0o600)
os.replace(temporary, receipt)
print(json.dumps(result, sort_keys=True))
