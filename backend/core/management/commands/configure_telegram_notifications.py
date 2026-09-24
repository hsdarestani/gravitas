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
        response.raise_for_status()
        data = response.json()
        if not data.get('ok'):
            raise CommandError(str(data.get('description') or 'Telegram webhook setup failed'))
        self.stdout.write(self.style.SUCCESS(f'Telegram webhook configured: {url}'))
