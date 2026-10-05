import json
import math

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import PulsarRun


def percentile(values, q):
    values = sorted(values)
    if not values:
        return 0
    index = max(0, min(len(values) - 1, math.ceil(q * len(values)) - 1))
    return values[index]


class Command(BaseCommand):
    help = 'Report recent Pulsar run quality, latency, token and cost telemetry.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=500)
        parser.add_argument('--json', action='store_true', dest='as_json')

    def handle(self, *args, **options):
        limit = max(1, min(int(options['limit'] or 500), 5000))
        rows = list(PulsarRun.objects.order_by('-created_at')[:limit])
        completed = [row for row in rows if row.status == PulsarRun.Status.COMPLETED]
        failed = [row for row in rows if row.status == PulsarRun.Status.FAILED]

        latencies = []
        input_tokens = 0
        output_tokens = 0
        cost = 0.0
        for row in completed:
            state = row.state if isinstance(row.state, dict) else {}
            try:
                latencies.append(int(state.get('latency_ms') or 0))
            except (TypeError, ValueError):
                pass
            try:
                input_tokens += int(state.get('input_tokens') or 0)
                output_tokens += int(state.get('output_tokens') or 0)
                cost += float(state.get('estimated_cost_usd') or 0)
            except (TypeError, ValueError):
                continue

        total_terminal = len(completed) + len(failed)
        result = {
            'generated_at': timezone.now().isoformat(),
            'sample_size': len(rows),
            'completed': len(completed),
            'failed': len(failed),
            'success_rate': (
                len(completed) / total_terminal
                if total_terminal else None
            ),
            'latency_ms': {
                'p50': percentile(latencies, 0.50),
                'p95': percentile(latencies, 0.95),
            },
            'tokens': {
                'input': input_tokens,
                'output': output_tokens,
            },
            'estimated_cost_usd': round(cost, 6),
            'estimated_cost_per_completed_task_usd': (
                round(cost / len(completed), 6)
                if completed else None
            ),
        }

        if options['as_json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
            return
        self.stdout.write(
            f"Runs={result['sample_size']} completed={result['completed']} "
            f"failed={result['failed']} success_rate={result['success_rate']}"
        )
        self.stdout.write(
            f"Latency p50={result['latency_ms']['p50']}ms "
            f"p95={result['latency_ms']['p95']}ms"
        )
        self.stdout.write(
            f"Tokens in={input_tokens} out={output_tokens} "
            f"estimated_cost_usd={result['estimated_cost_usd']}"
        )
