import json

from django.core.management.base import BaseCommand, CommandError

from core.pulsar_runtime.decisions import DecisionRouter
from core.pulsar_runtime.skills import SkillRegistry


CASES = (
    {'surface': 'telegram', 'skill': 'project_task', 'operation': 'interpret', 'expected': 'fast'},
    {'surface': 'lms', 'skill': 'learning', 'operation': 'tutor', 'expected': 'general'},
    {'surface': 'research', 'skill': 'research', 'operation': 'synthesis', 'expected': 'deep'},
    {'surface': 'core', 'skill': 'project_task', 'operation': 'plan', 'expected': 'general'},
    {'surface': 'research', 'skill': 'research', 'operation': 'compare', 'expected': 'deep'},
)


class Command(BaseCommand):
    help = 'Benchmark Pulsar model-tier decisions against a small routing gate.'

    def add_arguments(self, parser):
        parser.add_argument('--provider', default=None, choices=['deterministic', 'jev'])
        parser.add_argument('--json', action='store_true', dest='as_json')

    def handle(self, *args, **options):
        router = DecisionRouter(provider=options.get('provider'))
        if router.provider == 'jev' and not router.external_configured():
            raise CommandError(
                'Jev is not configured. Set SYSTEM_ONE_API_KEY (or JEV_API_KEY) '
                'and optionally SYSTEM_ONE_BASE_URL.'
            )

        skills = SkillRegistry()
        rows = []
        correct = 0
        for case in CASES:
            selection = router.select_model(
                skill=skills.resolve(name=case['skill']),
                operation=case['operation'],
                surface=case['surface'],
            )
            ok = selection.tier == case['expected']
            correct += int(ok)
            rows.append({
                **case,
                'actual': selection.tier,
                'source': selection.decision_source,
                'model': selection.decision_model,
                'ok': ok,
            })

        route_probe = router.select_tool_route(
            message='Compare research evidence with my open tasks.',
            surface='core',
            primary_skill='project_task',
            tools=[
                {
                    'name': 'research.search',
                    'skill': 'research',
                    'risk': 'r0',
                    'action': 'read',
                    'description': 'Search grounded research knowledge.',
                },
                {
                    'name': 'tasks.read',
                    'skill': 'project_task',
                    'risk': 'r0',
                    'action': 'read',
                    'description': 'Read accessible project tasks.',
                },
            ],
        )

        result = {
            'provider': router.provider,
            'status': router.status(),
            'agent_route_probe': {
                'action': route_probe.action,
                'tool': route_probe.tool,
                'source': route_probe.decision_source,
                'model': route_probe.decision_model,
                'confidence': route_probe.confidence,
            },
            'cases': rows,
            'correct': correct,
            'total': len(rows),
            'accuracy': correct / len(rows),
        }
        if options.get('as_json'):
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for row in rows:
                mark = 'PASS' if row['ok'] else 'FAIL'
                self.stdout.write(
                    f"{mark} {row['skill']}:{row['operation']} "
                    f"expected={row['expected']} actual={row['actual']} source={row['source']}"
                )
            self.stdout.write(
                f"Agent route probe: action={route_probe.action} "
                f"tool={route_probe.tool or '-'} source={route_probe.decision_source}"
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Routing benchmark: {correct}/{len(rows)} ({result['accuracy']:.0%})"
                )
            )
