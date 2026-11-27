"""Create repeatable synthetic staging drafts for three publishing workflows."""

from datetime import timedelta
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.lms_models import Course, CourseModule, Lesson
from core.models import ContentItem, InteractiveLab
from core.platform_runtime_v3 import core_role


class Command(BaseCommand):
    help = 'Create or selectively remove untouched staging Topic, Lab and course drafts.'

    def add_arguments(self, parser):
        parser.add_argument('cohort', help='A unique lowercase QA slug, such as qa-005')
        parser.add_argument('--owner', required=True, help='Email of an existing active staging Core administrator')
        parser.add_argument('--remove', action='store_true', help='Remove matching untouched synthetic drafts only')

    @transaction.atomic
    def handle(self, *args, **options):
        if not getattr(settings, 'GRAVIQUEST_STAGING', False) or (
            settings.PUBLIC_BASE_URL != 'https://staging.graviquest.com'
            or settings.DATABASES['default']['NAME'] != 'gravitas_workspace_staging'
        ):
            raise CommandError('The isolated staging settings and database are required.')
        cohort = options['cohort']
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', cohort) or len(cohort) > 40:
            raise CommandError('Use a lower-case QA slug of up to 40 characters.')
        actor = get_user_model().objects.filter(email__iexact=options['owner'], is_active=True).first()
        if not actor or core_role(actor) not in ('owner', 'admin'):
            raise CommandError('An active Core owner or administrator is required.')

        slug = f'synthetic-staging-{cohort}'
        summary = 'Synthetic staging fixture for ' + cohort
        markdown = 'A synthetic example for checking the staging publishing flow.'
        lab_files = [{'name': 'index.html', 'content':
                      '<!doctype html><html lang="en"><title>Staging test Lab</title>'
                      '<main><h1>Staging test Lab</h1><p>Synthetic simulation input.</p></main></html>'}]
        expected = (
            (ContentItem, dict(title='Synthetic QA Topic', summary=summary, body=markdown,
                               status=ContentItem.Status.DRAFT, kind=ContentItem.Kind.TOPIC)),
            (InteractiveLab, dict(title='Synthetic QA Lab', summary=summary, files=lab_files,
                                  status=InteractiveLab.Status.DRAFT, studio_enabled=True, created_by=actor)),
            (Course, dict(title='Synthetic QA Course', summary=summary, description=markdown,
                          status=Course.Status.DRAFT, created_by=actor, provider=Course.Provider.NATIVE)),
        )
        messages = []
        for model, fields in expected:
            if not options['remove']:
                item, created = model.objects.get_or_create(slug=slug, defaults=fields)
                if item.summary != summary:
                    raise CommandError('A record outside this fixture owns the requested slug.')
                if model is Course and created:
                    module = CourseModule.objects.create(course=item, title='Synthetic module')
                    Lesson.objects.create(module=module, title='Synthetic lesson', body=markdown)
                messages.append(f'{model.__name__}: {item.pk} {slug} {"created" if created else "retained"}')
                continue
            item = model.objects.select_for_update().filter(slug=slug).first()
            if not item:
                continue
            if any(getattr(item, key) != value for key, value in fields.items()):
                raise CommandError('A draft was edited or published. Preserve it and use its normal archive controls.')
            if item.updated_at - item.created_at > timedelta(seconds=1):
                raise CommandError('A draft has been edited. Preserve it and use its normal archive controls.')
            if model is Course:
                modules = list(item.modules.all())
                lessons = list(modules[0].lessons.values_list('title', 'body')) if len(modules) == 1 else []
                if (not lessons or lessons != [('Synthetic lesson', markdown)] or modules[0].title != 'Synthetic module'
                        or item.enrollments.exists() or item.revisions.exists()):
                    raise CommandError('The course has other content or activity and must be preserved.')
            if model is ContentItem and item.translations.exists():
                raise CommandError('The Topic has translations and must be preserved.')
            if model is InteractiveLab and (item.revisions.exists() or item.published_version):
                raise CommandError('The Lab has revision history and must be preserved.')
            item.delete()
            messages.append(f'{model.__name__}: removed untouched fixture {slug}')
        self.stdout.write('\n'.join(messages))
