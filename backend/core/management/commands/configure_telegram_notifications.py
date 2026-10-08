import requests

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Configure the Gravitas+ Pulsar Telegram bot, commands, and webhook.'

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
                    'allowed_updates': ['message', 'callback_query'],
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

        setup_calls = [
            ('setMyName', {'name': 'Pulsar'}),
            ('setMyShortDescription', {
                'short_description': 'Pulsar · your Gravitas+ AI assistant for tasks, research, and reminders.',
            }),
            ('setMyDescription', {
                'description': (
                    'Pulsar is the Gravitas+ assistant in Telegram. Send tasks naturally, '
                    'let Pulsar suggest the right KR/project/links, and confirm before creation. '
                    'Task reminders continue here too.'
                ),
            }),
            ('setMyCommands', {'commands': [
                {'command': 'new', 'description': 'Create tasks with Pulsar'},
                {'command': 'tasks', 'description': 'Show my open Core tasks'},
                {'command': 'report', 'description': 'Write and review my daily report'},
                {'command': 'reportedit', 'description': 'Correct my pending report proposal'},
                {'command': 'cancel', 'description': 'Cancel the current Pulsar draft'},
                {'command': 'help', 'description': 'How to use Pulsar'},
            ]}),
        ]
        for method, payload in setup_calls:
            try:
                extra = requests.post(
                    f"https://api.telegram.org/bot{token}/{method}",
                    json=payload,
                    timeout=15,
                )
                extra.raise_for_status()
                extra_data = extra.json()
            except (requests.RequestException, ValueError):
                raise CommandError(f'Telegram {method} setup failed') from None
            if not extra_data.get('ok'):
                raise CommandError(str(extra_data.get('description') or f'Telegram {method} failed')[:300])

        self.stdout.write(self.style.SUCCESS(f'Pulsar Telegram webhook configured: {url}'))
