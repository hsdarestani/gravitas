import json

from django.core.management.base import BaseCommand, CommandError

from core.pulsar_evalset import summary
from core.pulsar_runtime import default_harness
from core.pulsar_runtime.providers import PROVIDER_FACTORIES
from core.pulsar_runtime.trace import emit


REQUIRED_PROVIDERS = {'cloudflare', 'openai', 'anthropic', 'gemini'}


class Command(BaseCommand):
    help = 'Verify the Pulsar Week 1 Core + Harness release contract.'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', dest='as_json')

    def handle(self, *args, **options):
        skills = default_harness.skills
        eval_info = summary()
        provider_names = set(PROVIDER_FACTORIES)
        selection = default_harness.decisions.select_model(
            skill=skills.resolve(surface='telegram'),
            operation='interpret',
            surface='telegram',
        )

        gates = {
            'shared_harness': all(
                hasattr(default_harness, name)
                for name in ('skills', 'tools', 'decisions', 'models')
            ),
            'website_skill': (
                skills.resolve(surface='public').name == 'public'
                and skills.resolve(surface='website').name == 'public'
            ),
            'telegram_skill': skills.resolve(surface='telegram').name == 'project_task',
            'provider_contract': REQUIRED_PROVIDERS.issubset(provider_names),
            'decision_router': selection.tier == 'fast',
            'eval_seed': (
                eval_info['total'] >= 20
                and bool(eval_info['ids_unique'])
            ),
            'trace_contract': callable(emit),
        }
        passed = all(gates.values())
        result = {
            'passed': passed,
            'release': 'Pulsar Week 1 / Core + Harness',
            'gates': gates,
            'eval_cases': eval_info['total'],
            'provider_contracts': sorted(REQUIRED_PROVIDERS),
            'telegram_model_tier': selection.tier,
            'decision_source': selection.decision_source,
        }

        if options['as_json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for name, ok in gates.items():
                self.stdout.write(f"{'PASS' if ok else 'FAIL'} {name}")
            self.stdout.write(
                f"Eval seed: {eval_info['total']} cases; "
                f"Telegram interpret tier: {selection.tier}"
            )

        if not passed:
            raise CommandError('Pulsar Week 1 release contract failed.')
        self.stdout.write(self.style.SUCCESS('Pulsar Week 1 release contract passed.'))
