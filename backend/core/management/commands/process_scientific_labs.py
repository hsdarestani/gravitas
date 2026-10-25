"""Dedicated bounded worker. Run via the isolated systemd timer, not Gunicorn."""
import fcntl
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.scientific_lab_models import ScientificLabRun
from core.scientific_lab_runner import execute


class Command(BaseCommand):
    help = 'Process at most one scientific run; at most one worker on this host.'

    def handle(self, *args, **options):
        if not getattr(settings, 'SCIENTIFIC_LAB_ENABLED', False):
            self.stdout.write('Scientific lab disabled')
            return
        # Host lock plus atomic row claims. Deployment intentionally supports one worker host.
        with open('/tmp/gravitas-scientific-lab-worker.lock', 'a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            ScientificLabRun.objects.filter(state__in=['running', 'cancel_requested'], updated_at__lt=timezone.now()-timedelta(minutes=30)).update(state='interrupted', error='worker_interrupted_no_automatic_retry')
            run = ScientificLabRun.objects.filter(state='queued').order_by('created_at').first()
            if run:
                execute(run.pk)
                self.stdout.write(str(run.pk))
