import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder
from core.task_source_migration import validate, apply_plan, digest, task_snapshot
from core.operating_models import OperatingTask


class Command(BaseCommand):
    help = 'Validate a reviewed source-to-live task plan; writes require --apply and its exact digest.'

    def add_arguments(self, parser):
        parser.add_argument('plan')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-plan-sha')
        parser.add_argument('--audit-output')

    def handle(self, *args, **options):
        try:
            plan = json.loads(Path(options['plan']).read_text())
            sha = digest(plan)
            validate(plan)
            if not options['apply']:
                self.stdout.write(json.dumps({'dry_run':True,'plan_sha256':sha,'task_records':len(plan['tasks'])}))
                return
            if options['expected_plan_sha'] != sha or not options['audit_output']:
                raise ValueError('apply_requires_exact_plan_digest_and_private_audit_output')
            audit = Path(options['audit_output'])
            # Reserve a private local audit file before touching database/files.
            with audit.open('x', encoding='utf-8') as output:
                audit.chmod(0o600)
                import os
                output.write(json.dumps({'state':'prepared','plan':plan,'before':[
                    task_snapshot(t) for t in OperatingTask.objects.filter(pk__in=[i['task_id'] for i in plan['tasks'] if i.get('task_id')])
                ]}, cls=DjangoJSONEncoder, ensure_ascii=False))
                output.flush();os.fsync(output.fileno())
                result = apply_plan(plan)
                output.seek(0);output.truncate()
                output.write(json.dumps(result, cls=DjangoJSONEncoder, ensure_ascii=False, indent=2))
                output.flush()
                os.fsync(output.fileno())
            self.stdout.write(json.dumps({k:result[k] for k in ['created','updated','matched','projects_created']}))
        except (ValueError, PermissionError) as exc:
            raise CommandError(str(exc)) from exc
