"""Authenticated release provenance for the isolated staging origin."""
import json
import re
from pathlib import Path

from django.http import JsonResponse


PAYMENT_PATH = re.compile(r'/api/lms/courses/[0-9]+/(?:checkout|payment-webhook)/')


def staging_release_metadata(get_response):
    def middleware(request):
        if PAYMENT_PATH.fullmatch(request.path):
            response = JsonResponse({'error': 'staging_payment_sandbox_unavailable'}, status=503)
            response['Cache-Control'] = 'private, no-store'
        elif request.path == '/api/staging/release/':
            if request.method != 'GET':
                response = JsonResponse({'error': 'method_not_allowed'}, status=405)
            elif not request.user.is_authenticated:
                response = JsonResponse({'error': 'authentication_required'}, status=401)
            else:
                from core.platform_runtime_v3 import core_access

                if not core_access(request.user):
                    response = JsonResponse({'error': 'core_workspace_required'}, status=403)
                else:
                    try:
                        data = json.loads(Path('/var/lib/gravitas-workspace-staging/release.json').read_text())
                        if not re.fullmatch(r'[a-f0-9]{40}', data['revision']):
                            raise ValueError('invalid revision')
                        response = JsonResponse({
                            'environment': 'staging',
                            **{key: data[key] for key in ('revision', 'ref', 'run_id', 'deployed_at', 'status')},
                        })
                    except (OSError, ValueError, KeyError, TypeError):
                        response = JsonResponse({'environment': 'staging', 'status': 'unavailable'}, status=503)
        else:
            response = get_response(request)
        response['X-GraviQuest-Environment'] = 'staging'
        response['X-Robots-Tag'] = 'noindex, nofollow'
        if request.path == '/api/staging/release/':
            response['Cache-Control'] = 'private, no-store'
        return response
    return middleware
