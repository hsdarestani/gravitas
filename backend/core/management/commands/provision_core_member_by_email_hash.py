import hashlib

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.email_verification import is_email_verified, send_account_verification
from core.models import WorkspaceMembership
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_assignment import reconcile_workspace_roadmap_assignments
from core.workspace_api import provision_personal_workspace

User = get_user_model()


def normalized_email_hash(value):
    normalized = (value or '').strip().lower()
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


class Command(BaseCommand):
    help = 'Find an existing user by SHA-256 of normalized email, add Core membership and reconcile Roadmap ownership.'

    def add_arguments(self, parser):
        parser.add_argument('--email-sha256', required=True)
        parser.add_argument('--name', required=True)
        parser.add_argument('--role', default=WorkspaceMembership.Role.MEMBER)
        parser.add_argument('--send-verification', action='store_true')

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
        if user.is_superuser:
            raise CommandError('Refusing to mutate a superuser through Core member provisioning.')

        name = str(options['name'] or '').strip()[:150]
        role = str(options['role'] or '').strip().lower()
        allowed_roles = {WorkspaceMembership.Role.ADMIN, WorkspaceMembership.Role.MEMBER}
        if role not in allowed_roles:
            raise CommandError('role must be admin or member.')

        with transaction.atomic():
            changed_fields = []
            if name and user.first_name != name:
                user.first_name = name
                changed_fields.append('first_name')
            if not user.is_active:
                user.is_active = True
                changed_fields.append('is_active')
            if changed_fields:
                user.save(update_fields=changed_fields)

            provision_personal_workspace(user)
            core = ensure_platform_workspaces(user)['core']
            membership, membership_created = WorkspaceMembership.objects.update_or_create(
                workspace=core,
                user=user,
                defaults={'role': role},
            )

        assignment = reconcile_workspace_roadmap_assignments(core)

        verification_sent = False
        already_verified = is_email_verified(user)
        if options['send_verification'] and not already_verified:
            try:
                verification_sent = send_account_verification(user)
            except Exception as exc:
                raise CommandError('Core access updated, but account verification email delivery failed.') from exc

        unresolved = ','.join(assignment.get('unresolved_roles') or []) or 'none'
        self.stdout.write(self.style.SUCCESS(
            'core member provisioned '
            f'user_id={user.pk} '
            f'membership_created={str(membership_created).lower()} '
            f'role={membership.role} '
            f'assignment_updates={assignment.get("assignment_updates", 0)} '
            f'blocked_role_tasks={assignment.get("blocked_role_tasks", 0)} '
            f'unresolved_roles={unresolved} '
            f'email_verified={str(already_verified).lower()} '
            f'verification_sent={str(verification_sent).lower()}'
        ))
