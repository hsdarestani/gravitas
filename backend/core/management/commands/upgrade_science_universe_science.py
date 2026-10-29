"""Versioned, fail-closed upgrade of the existing *published* Science Universe.

Do not create a second Lab, replace unrelated author files, or overwrite
an unpublished editor draft. Only upgrade if both published/draft source
blobs equal the reviewed v1 source or the already-upgraded v2 source.
"""
import hashlib
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.lab_api import _clean_files
from core.models import InteractiveLab, LabRevision

ROOT = Path(__file__).resolve().parents[3] / 'lab-sources' / 'science-universe'
EXPECTED = {
    'engine.js': '2b6d9971ef8062ed090e59453145467853e1b449',
    'index.html': '2e73d57d60bfedccfeb68aad3e3c28b663a5367f',
    'app.js': '87b0a516bcd6874d69ddfd97e9cc89c83f0e6ac3',
    'styles.css': 'd4f36c09c559ed29fd30b20a192dd36562f8569b',
}
NAMES = tuple(EXPECTED)


def blob_sha(content):
    raw = content.encode('utf-8')
    return hashlib.sha1(b'blob ' + str(len(raw)).encode('ascii') + b'\0' + raw).hexdigest()


def upgrade_file_set(files, replacements, check_baseline=True):
    if not isinstance(files, list):
        raise ValueError('invalid_existing_files')
    found = {item.get('name'): item for item in files if isinstance(item, dict)}
    if any(name not in found for name in NAMES):
        raise ValueError('source_file_missing')
    edited = []
    for row in files:
        if not isinstance(row, dict):
            raise ValueError('invalid_file_record')
        name = row.get('name')
        if name not in NAMES:
            edited.append(row)
            continue
        existing = row.get('content')
        if not isinstance(existing, str):
            raise ValueError('invalid_existing_source')
        old_hash = blob_sha(existing)
        new_hash = blob_sha(replacements[name])
        if check_baseline and old_hash not in (EXPECTED[name], new_hash):
            raise ValueError('author_modified_' + name)
        edited.append({**row, 'content': replacements[name]})
    return _clean_files(edited)


class Command(BaseCommand):
    help = 'Safely apply reviewed science equations directly to the existing Science Universe Lab.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Apply only when exact v1 baseline is present')

    def handle(self, *args, **options):
        try:
            replacements = {
                name: (ROOT / name).read_text(encoding='utf-8')
                for name in NAMES
            }
        except OSError as exc:
            raise CommandError('Missing science model source: ' + str(exc)) from exc
        if 'SCIENCE-MODEL v2' not in replacements['engine.js']:
            raise CommandError('Source is not the approved science v2 engine')

        with transaction.atomic():
            lab = InteractiveLab.objects.select_for_update().filter(
                slug='science-universe',
                status=InteractiveLab.Status.PUBLISHED,
                studio_enabled=True
            ).first()
            if not lab:
                raise CommandError('Published Science Universe not found; refusing automatic creation.')
            try:
                updated_published = upgrade_file_set(lab.published_files, replacements)
                updated_draft = upgrade_file_set(lab.files, replacements)
            except ValueError as exc:
                raise CommandError(
                    'Existing Lab files have independent edits; preserving them: ' + str(exc)
                ) from exc
            same_published = updated_published == lab.published_files
            same_draft = updated_draft == lab.files
            if same_published and same_draft:
                self.stdout.write('Science Universe v2 already installed. No changes.')
                return
            if not options['apply']:
                self.stdout.write('DRY RUN: Science v2 fits existing sources; no DB writes.')
                return
            next_version = lab.version + 1
            LabRevision.objects.create(
                lab=lab, version=next_version, files=updated_draft,
                config=lab.config, topic_slug=lab.topic_slug, actor=None
            )
            lab.files = updated_draft
            lab.published_files = updated_published
            lab.version = next_version
            lab.published_version = next_version
            lab.save(update_fields=['files','published_files','version','published_version','updated_at'])
            self.stdout.write(self.style.SUCCESS(
                'Published Science Universe upgraded IN PLACE, version ' + str(next_version)
            ))
