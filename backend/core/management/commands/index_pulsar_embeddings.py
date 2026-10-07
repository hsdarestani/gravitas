from django.core.management.base import BaseCommand, CommandError

from core.models import KnowledgeResource
from core.pulsar_runtime.errors import PulsarError
from core.pulsar_runtime.semantic import EmbeddingGateway, index_resource


class Command(BaseCommand):
    help = 'Build or refresh the portable Pulsar semantic index for knowledge resources.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=500)
        parser.add_argument('--project-id', type=int)
        parser.add_argument('--force', action='store_true')

    def handle(self, *args, **options):
        gateway = EmbeddingGateway()
        if not gateway.configured():
            raise CommandError('Pulsar embedding provider is not configured.')

        limit = max(1, min(int(options.get('limit') or 500), 5000))
        qs = KnowledgeResource.objects.order_by('-updated_at')
        if options.get('project_id'):
            qs = qs.filter(project_id=options['project_id'])

        indexed = unchanged = skipped = failed = 0
        for resource in qs[:limit]:
            try:
                row, changed = index_resource(
                    resource,
                    gateway=gateway,
                    force=options.get('force') is True,
                )
            except PulsarError as exc:
                failed += 1
                self.stderr.write(
                    f'FAILED resource={resource.pk} error={exc}'
                )
                continue
            if row is None:
                skipped += 1
            elif changed:
                indexed += 1
            else:
                unchanged += 1

        self.stdout.write(
            f'Pulsar semantic index model={gateway.model} '
            f'indexed={indexed} unchanged={unchanged} '
            f'skipped={skipped} failed={failed}'
        )
        if failed:
            raise CommandError(
                f'Pulsar semantic indexing completed with {failed} failure(s).'
            )
