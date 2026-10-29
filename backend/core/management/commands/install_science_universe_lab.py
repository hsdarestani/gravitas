"""Install the Science Universe authoring bundle as an UNPUBLISHED Lab Studio draft.

The command is idempotent, never alters existing Labs, never publishes, and
never manufactures an administrator account. It can run after each release
until an existing active superuser is available as draft owner.
"""
import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.lab_api import _clean_files, _clean_config
from core.layer_access import record_activity
from core.layer_models import ActivityEvent
from core.models import InteractiveLab, LabRevision


class Command(BaseCommand):
    help = 'Import authored Science Universe source files as a private, versioned Lab Studio draft.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Write the draft to the database.')
        parser.add_argument('--auto-owner', action='store_true', help='Choose an existing active superuser as owner.')
        parser.add_argument('--user', default='', help='Use an existing superuser by email or username.')
        parser.add_argument('--source', default='', help='Override location of the authored source bundle.')

    def handle(self, *args, **options):
        installed_path = Path('/opt/gravitas-backend/lab-sources/science-universe')
        repo_path = Path(__file__).resolve().parents[4] / 'lab-sources' / 'science-universe'
        source = Path(options['source']) if options['source'] else (
            installed_path if installed_path.is_dir() else repo_path
        )
        if not source.is_dir():
            raise CommandError(f'Science Universe source bundle not present: {source}')
        try:
            manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
            files = _clean_files([
                {'name': name, 'content': (source / name).read_text(encoding='utf-8')}
                for name in ('index.html', 'styles.css', 'engine.js', 'app.js')
            ])
            config = _clean_config(manifest['config'])
        except (KeyError, ValueError, OSError) as exc:
            raise CommandError(f'Invalid Science Universe authoring package: {exc}') from exc

        slug = manifest['slug']
        if slug != 'science-universe':
            raise CommandError('Refusing unexpected slug.')
        if InteractiveLab.objects.filter(slug=slug).exists():
            self.stdout.write('science-universe already exists; no changes applied.')
            return

        User = get_user_model()
        user = None
        if options['user']:
            identifier = options['user'].strip()
            user = User.objects.filter(is_superuser=True, is_active=True, email__iexact=identifier).first()
            if not user:
                user = User.objects.filter(
                    is_superuser=True, is_active=True, username__iexact=identifier
                ).first()
            if not user:
                raise CommandError('Supplied owner is not an active superuser.')
        elif options['auto_owner']:
            user = User.objects.filter(is_superuser=True, is_active=True).order_by('pk').first()
            if not user:
                self.stdout.write(self.style.WARNING(
                    'No active superuser exists. Skipping draft installation without creating accounts.'
                ))
                return
        else:
            raise CommandError('Specify --user EMAIL or --auto-owner.')

        if not options['apply']:
            self.stdout.write('DRY RUN: Valid bundle and superuser; no database writes.')
            return

        with transaction.atomic():
            if InteractiveLab.objects.select_for_update().filter(slug=slug).exists():
                self.stdout.write('science-universe already exists; leaving edits untouched.')
                return
            lab = InteractiveLab.objects.create(
                slug=slug,
                title=str(manifest['title'])[:240],
                summary=str(manifest['summary'])[:1200],
                description=str(manifest['description'])[:8000],
                duration_text=str(manifest['duration_text'])[:80],
                topic_slug='',  # Public Topic 01 currently has a naming mismatch.
                files=files, config=config,
                status=InteractiveLab.Status.DRAFT,
                published_version=0, studio_enabled=False,
                created_by=user,
            )
            LabRevision.objects.create(
                lab=lab, version=lab.version, files=lab.files,
                config=lab.config, topic_slug='', actor=user,
            )
            record_activity(
                layer=ActivityEvent.Layer.SHELL,
                action='lab.created',
                actor=user, object_type='lab', object_id=str(lab.pk),
                detail={'version': 1, 'source': 'science-universe-bundle', 'published': False},
            )
        self.stdout.write(self.style.SUCCESS(
            f'Created Lab Studio draft: ID {lab.pk}, slug={lab.slug}, published=False.'
        ))
