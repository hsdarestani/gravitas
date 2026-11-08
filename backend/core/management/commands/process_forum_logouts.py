from django.core.management.base import BaseCommand
from django.db.models import F
from core.forum import ForumUnavailable, revoke_forum_sessions
from core.forum_models import ForumLogout


class Command(BaseCommand):
    help = 'Retry pending Discourse session revocations; no secrets in output.'

    def handle(self, *args, **options):
        completed = failed = 0
        for row in ForumLogout.objects.select_related('user').order_by('requested_at')[:100]:
            try:
                revoke_forum_sessions(row.user)
            except ForumUnavailable:
                ForumLogout.objects.filter(pk=row.pk).update(attempts=F('attempts') + 1)
                failed += 1
            else:
                # Preserve a newer logout requested while the call was running.
                ForumLogout.objects.filter(pk=row.pk, requested_at=row.requested_at).delete()
                completed += 1
        self.stdout.write(f'Forum logout revocations: completed={completed} pending_retry={failed}')
