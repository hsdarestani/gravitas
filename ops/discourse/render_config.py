"""Render official discourse_docker configuration without printing secrets.

Input is the root-owned JSON environment in /etc/gravitas/forum.json. Docker
binds only loopback; PostgreSQL, Redis and uploads belong to this container and
its own persistent directory. Existing databases and containers are untouched.
"""
import json
import os
import sys
from pathlib import Path

DISCOURSE_COMMIT = 'b79dd84953c57ce6e15cf7d64dde94c794173fbf'  # stable 2026.7.4
DOCKER_COMMIT = '1309ec425ab697996a33b931e309df95c1fbd981'


def configuration(env):
    required = ['DISCOURSE_HOSTNAME', 'DISCOURSE_DEVELOPER_EMAILS', 'DISCOURSE_SMTP_ADDRESS',
                'DISCOURSE_SMTP_USER_NAME', 'DISCOURSE_SMTP_PASSWORD',
                'DISCOURSE_NOTIFICATION_EMAIL', 'GRAVITAS_DISCOURSE_CONNECT_SECRET']
    missing = [k for k in required if not env.get(k)]
    if missing:
        raise ValueError('Missing environment keys: ' + ', '.join(missing))
    values = {k:v for k,v in env.items() if k.startswith('DISCOURSE_')}
    values.update({'LC_ALL':'en_US.UTF-8','LANG':'en_US.UTF-8','UNICORN_WORKERS':2,
                   'UNICORN_SIDEKIQS':1,'DISCOURSE_SIDEKIQ_CONCURRENCY':3,
                   'DISCOURSE_DISCOURSE_CONNECT_SECRET':env['GRAVITAS_DISCOURSE_CONNECT_SECRET'],
                   'DISCOURSE_DISCOURSE_CONNECT_URL':'https://graviquest.com/api/forum/sso/',
                   'DISCOURSE_ENABLE_DISCOURSE_CONNECT':'true'})
    return {
        'templates':['templates/postgres.template.yml','templates/redis.template.yml',
                     'templates/web.template.yml','templates/web.ratelimited.template.yml'],
        'expose':['127.0.0.1:18880:80'],
        'params':{'version':DISCOURSE_COMMIT,'db_shared_buffers':'256MB','db_work_mem':'8MB',
                  'db_synchronous_commit':'on','db_default_text_search_config':'pg_catalog.english'},
        'docker_args':'--memory=3g --cpus=2 --pids-limit=1024 --log-opt max-size=20m --log-opt max-file=3',
        'env':values,
        'volumes':[{'volume':{'host':'/var/discourse/shared/graviquest','guest':'/shared'}},
                   {'volume':{'host':'/var/discourse/shared/graviquest/log/var-log','guest':'/var/log'}}],
    }


if __name__ == '__main__':
    env = json.loads(Path(sys.argv[1]).read_text())
    path = Path(sys.argv[2]); path.write_text(json.dumps(configuration(env), indent=2))
    os.chmod(path, 0o600)
