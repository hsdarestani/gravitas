import requests

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Configure the Gravitas+ Telegram bot webhook for task notifications.'

    def handle(self, *args, **options):
        token = settings.GRAVITAS_TELEGRAM_BOT_TOKEN
        secret = settings.GRAVITAS_TELEGRAM_WEBHOOK_SECRET
        if not token or not secret:
            self.stdout.write('Telegram task notifications are not configured; skipping webhook setup.')
            return

        url = f"{settings.PUBLIC_BASE_URL}/api/task-notifications/telegram/webhook/"
        try:
            response = requests.post(
                f"https://api.telegram.org/bot{token}/setWebhook",
                json={
                    'url': url,
                    'secret_token': secret,
                    'allowed_updates': ['message'],
                    'drop_pending_updates': False,
                },
                timeout=15,
            )
        except requests.RequestException:
            raise CommandError('Telegram webhook request failed') from None
        if not response.ok:
            raise CommandError(f'Telegram webhook HTTP {response.status_code}')
        try:
            data = response.json()
        except ValueError:
            raise CommandError('Telegram webhook returned invalid JSON') from None
        if not data.get('ok'):
            raise CommandError(str(data.get('description') or 'Telegram webhook setup failed')[:300])
        self.stdout.write(self.style.SUCCESS(f'Telegram webhook configured: {url}'))
