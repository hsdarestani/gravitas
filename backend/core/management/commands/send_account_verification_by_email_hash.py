from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.email_verification import is_email_verified, send_account_verification
from core.management.commands.provision_core_member_by_email_hash import normalized_email_hash

User = get_user_model()


def _safe_delivery_error(exc):
    parts = [exc.__class__.__name__]
    smtp_code = getattr(exc, 'smtp_code', None)
    if smtp_code is not None:
        try:
            parts.append(f'smtp_code={int(smtp_code)}')
        except (TypeError, ValueError):
            parts.append('smtp_code=unknown')
    reason = getattr(exc, 'reason', None)
    if reason is not None:
        parts.append(f'reason_type={reason.__class__.__name__}')
    return ' '.join(parts)


class Command(BaseCommand):
    help = 'Send an account verification email to an existing user selected by normalized-email SHA-256.'

    def add_arguments(self, parser):
        parser.add_argument('--email-sha256', required=True)

    def handle(self, *args, **options):
        target_hash = str(options['email_sha256'] or '').strip().lower()
        if len(target_hash) != 64 or any(ch not in '0123456789abcdef' for ch in target_hash):
            raise CommandError('email-sha256 must be a lowercase SHA-256 hex digest.')

        matches = [
            user for user in User.objects.exclude(email='').order_by('pk')
            if normalized_email_hash(user.email) == target_hash
        ]
        if not matches:
            raise CommandError('No registered Gravitas account matched the requested email hash.')
        if len(matches) != 1:
            raise CommandError('Multiple registered Gravitas accounts matched the requested email hash.')

        user = matches[0]
        if is_email_verified(user):
            self.stdout.write(self.style.SUCCESS(
                f'account verification already complete user_id={user.pk}'
            ))
            return

        try:
            sent = send_account_verification(user)
        except Exception as exc:
            diagnostic = _safe_delivery_error(exc)
            raise CommandError(
                f'account verification email delivery failed user_id={user.pk} {diagnostic}'
            ) from exc

        if not sent:
            raise CommandError(
                f'account verification email backend returned no delivery user_id={user.pk}'
            )

        self.stdout.write(self.style.SUCCESS(
            f'account verification email sent user_id={user.pk}'
        ))
