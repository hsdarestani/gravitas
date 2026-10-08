"""Create a disposable verification fixture through the real signup service.

Mail is captured only in this isolated process. The web service retains its
normal verification requirements and production email configuration.
"""
import json
import os
import re
import sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravitas_backend.settings')
import django
django.setup()
from django.core import mail
from django.test import RequestFactory, override_settings
from core.views import auth_signup

payload = json.load(sys.stdin)
email = str(payload.get('email', ''))
if not re.fullmatch(r'(?:auth-e2e|workspace-[ab]|browser-e2e|operating-e2e)-[0-9]+-[0-9]+@example\.com', email):
    raise ValueError('Only a run/attempt-scoped disposable E2E identity is allowed')
if set(payload) != {'email', 'password'} or len(payload['password']) < 20:
    raise ValueError('Invalid disposable identity request')
with override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
    request = RequestFactory().post('/api/auth/signup/', json.dumps({**payload, 'name': 'Operating Production E2E' if email.startswith('operating-e2e-') else 'Disposable production verification'}), content_type='application/json')
    response = auth_signup(request)
    if response.status_code != 201 or not json.loads(response.content).get('pending_confirmation'):
        error = json.loads(response.content).get('error', 'unexpected_response')
        raise RuntimeError(f'Disposable signup failed: status={response.status_code}, error={error}')
    links = [line for message in mail.outbox for line in message.body.splitlines() if '/api/auth/email-confirm/?token=' in line]
    if len(links) != 1:
        raise RuntimeError('Expected one actual signup confirmation message')
    print(json.dumps({'verification_url': links[0]}))
