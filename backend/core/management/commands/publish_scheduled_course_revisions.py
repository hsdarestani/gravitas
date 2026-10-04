import logging

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.lms_api import _apply_course_revision
from core.lms_models import CourseRevision


logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Publish due LMS course revisions that instructors scheduled.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        limit = max(1, min(int(options['limit']), 1000))
        rows = list(
            CourseRevision.objects
            .filter(
                state=CourseRevision.State.SCHEDULED,
                scheduled_for__isnull=False,
                scheduled_for__lte=timezone.now(),
            )
            .select_related('course', 'updated_by')
            .order_by('scheduled_for', 'pk')[:limit]
        )
        published = 0
        failed = 0
        for revision in rows:
            try:
                _apply_course_revision(revision, actor=revision.updated_by)
                published += 1
            except CourseRevision.DoesNotExist:
                continue
            except Exception:
                failed += 1
                logger.exception(
                    'Could not publish scheduled course revision revision_id=%s course_id=%s',
                    revision.pk,
                    revision.course_id,
                )
        self.stdout.write(f'published={published} failed={failed}')
