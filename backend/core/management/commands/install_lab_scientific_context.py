"""Idempotent import of licensed source Markdown and computed model runs."""
import gzip
import hashlib
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.lab_knowledge import digest, sections
from core.models import InteractiveLab, LabKnowledgeDocument, LabScenario


class Command(BaseCommand):
    help = 'Import versioned Markdown and the executed scenario atlas, preserving admin edits.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        lab = InteractiveLab.objects.filter(slug='science-universe').first()
        if not lab:
            self.stdout.write('No Science Universe exists; nothing to import.')
            return
        root = Path(__file__).resolve().parents[2] / 'data'
        manifest = json.loads((root / 'lab-knowledge' / 'manifest.json').read_text())
        atlas = json.loads(gzip.decompress((root / 'lab-scenario-atlas.json.gz').read_bytes()))
        deployed_engine = Path(__file__).resolve().parents[3] / 'lab-sources' / 'science-universe' / 'engine.js'
        repo_engine = Path(__file__).resolve().parents[4] / 'lab-sources' / 'science-universe' / 'engine.js'
        engine = deployed_engine if deployed_engine.exists() else repo_engine
        if hashlib.sha256(engine.read_bytes()).hexdigest() != atlas['engine_sha']:
            raise CommandError('Atlas engine mismatch; rebuild it with the exact release engine.')
        if not options['apply']:
            self.stdout.write(f"DRY RUN: {len(manifest['documents'])} documents, {len(atlas['runs'])} executed runs.")
            return
        with transaction.atomic():
            for item in manifest['documents']:
                markdown = (root / 'lab-knowledge' / item['file']).read_text()
                doc = LabKnowledgeDocument.objects.select_for_update().filter(lab=lab, slug=item['slug']).first()
                if doc and doc.content_hash != doc.imported_hash:
                    self.stdout.write('Preserved admin-edited document: ' + doc.slug)
                    continue
                if doc and doc.content_hash == digest(markdown):
                    continue
                if not doc:
                    doc = LabKnowledgeDocument(lab=lab, slug=item['slug'], version=0)
                for field in ('title', 'source_url', 'license', 'kind'):
                    setattr(doc, field, item[field])
                doc.markdown = markdown
                doc.content_hash = doc.imported_hash = digest(markdown)
                doc.sections = sections(markdown)
                doc.version += 1
                doc.save()
            LabScenario.objects.bulk_create([
                LabScenario(lab=lab, engine_sha=row['engine_sha'], signature=row['signature'],
                    family=row['family'], parameters=row['parameters'], design=row['design'],
                    seed=row['seed'], days=row['days'], result=row['result'], trajectory=row['trajectory'])
                for row in atlas['runs']
            ], ignore_conflicts=True, batch_size=100)
        self.stdout.write(self.style.SUCCESS(
            f"Scientific context ready: {lab.knowledge_documents.count()} Markdown documents; "
            f"{lab.scenario_atlas.filter(engine_sha=atlas['engine_sha']).count()} current-engine runs; sampled coverage."))
