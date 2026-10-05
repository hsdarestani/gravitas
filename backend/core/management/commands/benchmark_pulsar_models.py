import json

from django.core.management.base import BaseCommand, CommandError

from core.pulsar_runtime.providers import ModelGateway


CASES = (
    {'id': 'fast-intent', 'tier': 'fast', 'system': 'Return only one token: create_tasks or chat.', 'user': 'Please turn these work items into tasks.', 'expected': 'create_tasks'},
    {'id': 'fast-language', 'tier': 'fast', 'system': 'Return only one token: fa, de, or en.', 'user': 'لطفا این مقاله را خلاصه کن', 'expected': 'fa'},
    {'id': 'fast-risk', 'tier': 'fast', 'system': 'Return only one token: read or write.', 'user': 'Create a new task in the project.', 'expected': 'write'},
    {'id': 'general-grounding', 'tier': 'general', 'system': 'Answer with the supplied fact only. Do not invent anything.', 'user': 'Fact: Project Atlas deadline is 12 October. Question: What is the deadline?', 'expected': '12 october'},
    {'id': 'general-uncertainty', 'tier': 'general', 'system': 'If the context does not answer the question, reply exactly: insufficient context', 'user': 'Context: The course is about research methods. Question: What is the budget?', 'expected': 'insufficient context'},
    {'id': 'general-learning', 'tier': 'general', 'system': 'Give one concise learning hint and include the word evidence.', 'user': 'How should I assess whether a scientific claim is reliable?', 'expected': 'evidence'},
    {'id': 'deep-synthesis', 'tier': 'deep', 'system': 'Synthesize both statements in one sentence and mention replication.', 'user': 'A: Model accuracy is high on one benchmark. B: Independent replication is still missing.', 'expected': 'replication'},
    {'id': 'deep-conflict', 'tier': 'deep', 'system': 'State the conflict explicitly and include the word conflict.', 'user': 'Source A reports an increase. Source B reports a decrease for the same period.', 'expected': 'conflict'},
    {'id': 'deep-plan', 'tier': 'deep', 'system': 'Give a research plan in three numbered steps and include the word sources.', 'user': 'Plan a verification workflow for a disputed scientific claim.', 'expected': 'sources'},
)


class Command(BaseCommand):
    help = 'Benchmark configured Pulsar generative models on representative Gravitas tasks.'

    def add_arguments(self, parser):
        parser.add_argument('--tier', choices=['fast', 'general', 'deep'])
        parser.add_argument('--model', default=None)
        parser.add_argument('--json', action='store_true', dest='as_json')

    def handle(self, *args, **options):
        gateway = ModelGateway()
        if not gateway.configured():
            raise CommandError('Pulsar managed model provider is not configured.')

        selected = [row for row in CASES if not options.get('tier') or row['tier'] == options['tier']]
        rows = []
        for item in selected:
            response = gateway.complete(
                system=item['system'],
                user=item['user'],
                max_tokens=180,
                temperature=0,
                tier=item['tier'],
                model_override=options.get('model'),
            )
            answer = response.text.strip()
            ok = item['expected'].lower() in answer.lower()
            rows.append({
                'id': item['id'],
                'tier': item['tier'],
                'model': response.model,
                'provider': response.provider,
                'ok': ok,
                'latency_ms': response.latency_ms,
                'input_tokens': response.input_tokens,
                'output_tokens': response.output_tokens,
                'estimated_cost_usd': response.estimated_cost_usd,
            })

        correct = sum(int(row['ok']) for row in rows)
        result = {
            'correct': correct,
            'total': len(rows),
            'accuracy': correct / len(rows) if rows else 0,
            'latency_ms_total': sum(row['latency_ms'] for row in rows),
            'estimated_cost_usd': round(sum(row['estimated_cost_usd'] for row in rows), 6),
            'cases': rows,
        }
        if options['as_json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for row in rows:
                self.stdout.write(
                    f"{'PASS' if row['ok'] else 'FAIL'} {row['id']} "
                    f"{row['model']} {row['latency_ms']}ms"
                )
            self.stdout.write(
                f"Accuracy={result['accuracy']:.0%} "
                f"Cost USD={result['estimated_cost_usd']:.6f}"
            )
