"""Versioned, fail-closed upgrade of the existing *published* Science Universe.

Do not create a second Lab, replace unrelated author files, or overwrite
an unpublished editor draft. Upgrade only a reviewed published source; preserve independently edited drafts without altering them.
"""
import hashlib
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.lab_api import _clean_files
from core.models import InteractiveLab, LabRevision

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEPLOYED_SOURCE = BACKEND_ROOT / 'lab-sources' / 'science-universe'
REPO_SOURCE = BACKEND_ROOT.parent / 'lab-sources' / 'science-universe'
ROOT = DEPLOYED_SOURCE if DEPLOYED_SOURCE.is_dir() else REPO_SOURCE
# Each accepted source hash is a reviewed historical version, never an
# arbitrary author edit. v1 → v2 → rationale-aware v3; fail closed otherwise.
EXPECTED = {
    'engine.js': (
        'f2627ceecdd1428bf051a939da9d26d7716bd113',
        '2b6d9971ef8062ed090e59453145467853e1b449',
        '043cab64a70c8289959388faf2530c8b911abb6b',
        '5a2fdf34fe6c2597d505542db3b85aa967a20e47',
    ),
    'index.html': (
        '5038d45dd17f0f7b98ffa6abed8610d91e661262',
        '365dcad3f06dd9dd00d7c6cdefaa3b98d30767e9',
        'c7d602c7b95ccbbd73719bb72e7fcf53bf1245df',
        '2e73d57d60bfedccfeb68aad3e3c28b663a5367f',
        '7b5efba1196ba6d29b26b434242b57e69ee2de96',
        'bf9d933fc18d7f75fdbe6b4addc7a86b71f54d91',
    ),
    'app.js': (
        '29a285509bf24ea3d80454abecdf4213b0f76179',
        'ffd567910b76325be6df3af6138d6b18476e4af1',
        'b775404423e54f25c88bd6bed5952967b4b4a1ab',
        '87b0a516bcd6874d69ddfd97e9cc89c83f0e6ac3',
        '79d1033aabb9db04bb708f091ee96da66e0f4c67',
        '39582357f5ff293bffbc6bdf4b5ec84699884c7b',
    ),
    'styles.css': (
        'fc2cc1d89626d6b39abc1dc0b7956440f303aa78',
        'f416f2e88bd105790947f645c069f352c022a441',
        'd596fe5bc916293b065a43425f0318aed8e1b3d5',
        'd4f36c09c559ed29fd30b20a192dd36562f8569b',
        '4e64baa30b107d8f85fcb97bf01dcf49a6a88087',
        '1dbc4ba0183045d34bfb23ef5458b1cffd451e57',
    ),
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
        if check_baseline and old_hash not in (*EXPECTED[name], new_hash):
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
            raise CommandError('Source is not the reviewed science engine')

        with transaction.atomic():
            lab = InteractiveLab.objects.select_for_update().filter(
                slug='science-universe',
                status=InteractiveLab.Status.PUBLISHED,
                studio_enabled=True
            ).first()
            if not lab:
                raise CommandError('Published Science Universe not found; refusing automatic creation.')
            # Strictly refuse edits to an unknown LIVE file. The published
            # revision must match one of our reviewed Git blob hashes.
            try:
                updated_published = upgrade_file_set(lab.published_files, replacements)
            except ValueError as exc:
                raise CommandError(
                    'Published Lab source has independent edits; refusing overwrite: ' + str(exc)
                ) from exc
            # The Lab Studio author draft is deliberately distinct from the
            # public snapshot. Preserve any independent *draft* work untouched.
            # This project-owned release updates the verified published version
            # without replacing or trying to merge edits not reviewed here.
            preserved_draft = False
            try:
                updated_draft = upgrade_file_set(lab.files, replacements)
            except ValueError as exc:
                if not str(exc).startswith('author_modified_'):
                    raise CommandError('Invalid author draft: ' + str(exc)) from exc
                preserved_draft = True
                updated_draft = lab.files
                self.stdout.write(self.style.WARNING(
                    'Independent author draft detected and preserved without changes: ' + str(exc)
                ))
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
            if preserved_draft:
                self.stdout.write(self.style.WARNING(
                    'The public Lab is updated; author draft remains different. '
                    'A later manual publish from Lab Studio may replace this release.'
                ))
            self.stdout.write(self.style.SUCCESS(
                'Published Science Universe reviewed upgrade IN PLACE, version ' + str(next_version)
            ))
