import json

from django.core.management.base import BaseCommand, CommandError

from core.pulsar_evalset import EVAL_CASES, summary
from core.pulsar_runtime.decisions import DecisionRouter
from core.pulsar_runtime.skills import SkillRegistry
from core.pulsar_runtime.tools import ToolRegistry


class Command(BaseCommand):
    help = 'Evaluate Pulsar v1 deterministic architecture gates and dataset coverage.'

    def add_arguments(self, parser):
        parser.add_argument('--provider', default='deterministic', choices=['deterministic', 'jev'])
        parser.add_argument('--json', action='store_true', dest='as_json')

    def handle(self, *args, **options):
        provider = options['provider']
        router = DecisionRouter(provider=provider)
        if provider == 'jev' and not router.external_configured():
            raise CommandError('Jev is not configured for the live routing benchmark.')

        skills = SkillRegistry()
        tools = ToolRegistry()
        info = summary()

        route_rows = []
        for item in EVAL_CASES:
            if item['category'] != 'routing':
                continue
            selection = router.select_model(
                skill=skills.resolve(name=item['skill']),
                operation=item['operation'],
                surface=item['surface'],
            )
            route_rows.append({
                'id': item['id'],
                'expected': item['tier'],
                'actual': selection.tier,
                'ok': selection.tier == item['tier'],
                'source': selection.decision_source,
            })

        skill_rows = []
        for item in EVAL_CASES:
            if item['category'] != 'skill':
                continue
            resolved = skills.resolve(
                name=item.get('explicit'),
                surface=item['surface'],
            )
            skill_rows.append({
                'id': item['id'],
                'expected': item['skill'],
                'actual': resolved.name,
                'ok': resolved.name == item['skill'],
            })

        policy_rows = []
        for item in EVAL_CASES:
            if item['category'] != 'policy' or not item.get('tool'):
                continue
            tool = tools.get(item['tool'])
            expected_risk = item.get('risk')
            if expected_risk is None:
                continue
            policy_rows.append({
                'id': item['id'],
                'tool': item['tool'],
                'expected': expected_risk,
                'actual': tool.risk if tool else None,
                'ok': bool(tool and tool.risk == expected_risk),
            })

        category_floor_ok = all(count >= 10 for count in info['categories'].values())
        coverage_ok = 80 <= info['total'] <= 120 and info['ids_unique'] and category_floor_ok
        routing_ok = all(row['ok'] for row in route_rows)
        skills_ok = all(row['ok'] for row in skill_rows)
        policy_ok = all(row['ok'] for row in policy_rows)
        passed = coverage_ok and routing_ok and skills_ok and policy_ok

        result = {
            'passed': passed,
            'provider': provider,
            'dataset': info,
            'gates': {
                'coverage': coverage_ok,
                'routing': routing_ok,
                'skills': skills_ok,
                'tool_risks': policy_ok,
            },
            'metrics': {
                'routing_accuracy': (
                    sum(int(row['ok']) for row in route_rows) / len(route_rows)
                    if route_rows else 0
                ),
                'skill_accuracy': (
                    sum(int(row['ok']) for row in skill_rows) / len(skill_rows)
                    if skill_rows else 0
                ),
                'tool_risk_accuracy': (
                    sum(int(row['ok']) for row in policy_rows) / len(policy_rows)
                    if policy_rows else 0
                ),
            },
            'routing': route_rows,
            'skills': skill_rows,
            'tool_risks': policy_rows,
        }

        if options['as_json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            self.stdout.write(
                f"Pulsar v1 evalset: {info['total']} cases across "
                f"{len(info['categories'])} categories"
            )
            for key, value in result['metrics'].items():
                self.stdout.write(f'{key}: {value:.0%}')
            for key, value in result['gates'].items():
                self.stdout.write(f"{'PASS' if value else 'FAIL'} {key}")

        if not passed:
            raise CommandError('Pulsar v1 deterministic evaluation gates failed.')
        self.stdout.write(self.style.SUCCESS('Pulsar v1 deterministic gates passed.'))
