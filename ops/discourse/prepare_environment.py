"""Reuse operator mail configuration locally. Never output credential values."""
import json
import os
import secrets
import shlex
from email.utils import parseaddr
from pathlib import Path


def load_env(path):
    result = {}
    if not path.exists():
        return result
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        parts = shlex.split(value, comments=False)
        result[key.strip()] = parts[0] if len(parts) == 1 else value.strip()
    return result


def prepare(path, backend_path, admin_emails):
    if path.exists():
        return json.loads(path.read_text())
    source = load_env(backend_path)
    if not source.get('EMAIL_HOST_PASSWORD'):
        raise ValueError('Existing SMTP password is not configured; supply operator mail configuration.')
    port = int(source.get('EMAIL_PORT', '465'))
    notification = parseaddr(source.get('DEFAULT_FROM_EMAIL', source.get('EMAIL_HOST_USER', 'webmaster@gravitasplus.com')))[1]
    result = {
        'DISCOURSE_HOSTNAME':'forum.graviquest.com',
        'DISCOURSE_DEVELOPER_EMAILS':','.join(admin_emails),
        'DISCOURSE_SMTP_ADDRESS':source.get('EMAIL_HOST','smtp.strato.de'),
        'DISCOURSE_SMTP_PORT':port,
        'DISCOURSE_SMTP_USER_NAME':source.get('EMAIL_HOST_USER','webmaster@gravitasplus.com'),
        'DISCOURSE_SMTP_PASSWORD':source['EMAIL_HOST_PASSWORD'],
        'DISCOURSE_SMTP_FORCE_TLS':str(port == 465).lower(),
        'DISCOURSE_SMTP_ENABLE_START_TLS':str(port != 465).lower(),
        'DISCOURSE_SMTP_OPENSSL_VERIFY_MODE':'peer',
        'DISCOURSE_NOTIFICATION_EMAIL':notification,
        'GRAVITAS_DISCOURSE_CONNECT_SECRET':secrets.token_hex(48),
    }
    path.write_text(json.dumps(result, indent=2)); os.chmod(path, 0o600)
    return result


if __name__ == '__main__':
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    admins = list(get_user_model().objects.filter(is_superuser=True, is_active=True).exclude(email='').values_list('email', flat=True))
    if not admins:
        raise ValueError('No existing active GraviQuest administrator email is configured.')
    prepare(Path('/etc/gravitas/forum.json'), Path('/etc/gravitas/backend.env'), admins)
    print('Forum environment prepared; no existing credentials changed.')
