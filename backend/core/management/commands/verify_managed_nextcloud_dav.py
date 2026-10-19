"""Read-only proof that an existing managed Nextcloud identity can use DAV.

This command never prints the credential or mutates a remote account. Intended
as a hard post-repair gate in Nextcloud provisioning.
"""
from urllib.parse import quote

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import cloud
from core.models import NextcloudIdentity


class Command(BaseCommand):
    help = 'Check a specified managed Nextcloud identity can authenticate on DAV'

    def add_arguments(self, parser):
        parser.add_argument('--username', required=True)

    def handle(self, *args, **options):
        username = str(options['username'])
        if not username.startswith('gravitas-u-') or not username[len('gravitas-u-'):].isdigit():
            raise CommandError('Only explicitly named managed identities can be verified')
        identity = NextcloudIdentity.objects.filter(username=username).first()
        if identity is None:
            raise CommandError('Managed Nextcloud identity is not recorded in Gravitas')
        try:
            cloud._request(
                'PROPFIND',
                f'{settings.NEXTCLOUD_INTERNAL_URL}/remote.php/dav/files/{quote(username, safe="")}/',
                auth=cloud._auth(identity),
                expected={207},
                headers={'Depth': '0', 'Accept': 'application/xml'},
            )
        except Exception as exc:
            raise CommandError('Managed identity DAV authentication failed') from exc
        self.stdout.write('Managed identity DAV authentication verified')
