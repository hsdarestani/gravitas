import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.models import WorkspaceMembership
from core.platform_runtime_v3 import ensure_platform_workspaces

User = get_user_model()

OPERATING_E2E_EMAIL = re.compile(r'^operating-e2e-\d+-\d+@example\.com$')
OPERATING_E2E_NAME = 'Operating Production E2E'


class Command(BaseCommand):
    help = 'Grant Core member access to one strictly identified Operating production E2E account.'

    def add_arguments(self, parser):
        parser.add_argument('email')

    def handle(self, *args, **options):
        email = (options['email'] or '').strip().lower()
        if not OPERATING_E2E_EMAIL.fullmatch(email):
            raise CommandError('Refusing Core access: email is not an Operating production E2E identity.')

        try:
            user = User.objects.get(email__iexact=email, is_superuser=False, is_staff=False)
        except User.DoesNotExist as exc:
            raise CommandError(f'Operating E2E user not found: {email}') from exc
        except User.MultipleObjectsReturned as exc:
            raise CommandError(f'Multiple users matched Operating E2E email: {email}') from exc

        if (user.first_name or '').strip() != OPERATING_E2E_NAME:
            raise CommandError('Refusing Core access: account name does not match the Operating E2E identity.')
        if not user.is_active:
            raise CommandError('Refusing Core access: Operating E2E account is inactive.')

        core = ensure_platform_workspaces(user)['core']
        membership, created = WorkspaceMembership.objects.update_or_create(
            workspace=core,
            user=user,
            defaults={'role': WorkspaceMembership.Role.MEMBER},
        )
        state = 'created' if created else 'updated'
        self.stdout.write(self.style.SUCCESS(
            f'Core E2E access {state}: user={user.pk} role={membership.role}'
        ))
