"""Render isolated Discourse configuration for the official discourse_docker launcher."""
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sys

repo = Path(__file__).resolve().parents[2]
spec = spec_from_file_location('forum_pins', repo / 'discourse' / 'render_config.py')
pins = module_from_spec(spec)
spec.loader.exec_module(pins)

HOST = 'forum-staging.graviquest.com'
VOLUME = '/var/lib/graviquest-staging/discourse'
NETWORK = 'graviquest-staging-forum'


def configuration(secret):
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError('Generate an independent staging DiscourseConnect secret')
    return {
        'templates': [
            'templates/postgres.template.yml', 'templates/redis.template.yml',
            'templates/web.template.yml', 'templates/web.ratelimited.template.yml',
        ],
        'expose': ['127.0.0.1:18882:80'],
        'params': {'version': pins.DISCOURSE_COMMIT},
        'docker_args': f'--network={NETWORK} --memory=4g --cpus=2 --log-opt max-size=20m --log-opt max-file=3',
        'env': {
            'LANG': 'en_US.UTF-8',
            'DISCOURSE_HOSTNAME': HOST,
            'DISCOURSE_DEVELOPER_EMAILS': 'forum-admin@example.test',
            'DISCOURSE_NOTIFICATION_EMAIL': 'forum@example.test',
            'DISCOURSE_SMTP_ADDRESS': 'mailpit-staging',
            'DISCOURSE_SMTP_PORT': '1025',
            'DISCOURSE_SMTP_ENABLE_START_TLS': 'false',
            'DISCOURSE_DISCOURSE_CONNECT_URL': 'https://staging.graviquest.com/api/forum/sso/',
            'DISCOURSE_DISCOURSE_CONNECT_SECRET': secret,
            'DISCOURSE_ENABLE_DISCOURSE_CONNECT': 'true',
            'DISCOURSE_ALLOW_INDEX_IN_ROBOTS_TXT': 'false',
        },
        'volumes': [
            {'volume': {'host': VOLUME, 'guest': '/shared'}},
            {'volume': {'host': VOLUME + '/log', 'guest': '/var/log'}},
        ],
    }


if __name__ == '__main__':
    if sys.argv[1:] == ['--launcher-commit']:
        print(pins.DOCKER_COMMIT)
    elif not sys.argv[1:]:
        # Secret input from a local root-owned file through stdin.
        json.dump(configuration(sys.stdin.read().strip()), sys.stdout, indent=2)
        print()
    else:
        raise SystemExit('Usage: discourse.py [--launcher-commit]')
