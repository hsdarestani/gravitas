import json
import logging

import requests
from django.conf import settings


logger = logging.getLogger(__name__)


class PulsarError(Exception):
    pass


def configured():
    return bool(
        str(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') or '').strip()
        and str(getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '') or '').strip()
    )


def complete(*, system, user, max_tokens=900, temperature=0.2):
    account_id = str(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') or '').strip()
    token = str(getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '') or '').strip()
    model = str(
        getattr(settings, 'CLOUDFLARE_AI_MODEL', '')
        or '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    ).strip()
    timeout = int(getattr(settings, 'CLOUDFLARE_AI_TIMEOUT', 45) or 45)
    if not account_id or not token:
        raise PulsarError('cloudflare_ai_not_configured')

    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}'
    try:
        response = requests.post(
            endpoint,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
            },
            json={
                'messages': [
                    {'role': 'system', 'content': str(system)},
                    {'role': 'user', 'content': str(user)},
                ],
                'max_tokens': int(max_tokens),
                'temperature': float(temperature),
            },
            timeout=(8, max(15, timeout)),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning('Pulsar Cloudflare request failed: %s', exc)
        raise PulsarError('cloudflare_ai_failed') from exc

    if payload.get('success') is False:
        logger.warning('Pulsar Cloudflare error payload: %s', payload.get('errors'))
        raise PulsarError('cloudflare_ai_failed')

    result = payload.get('result')
    if isinstance(result, dict):
        answer = result.get('response') or result.get('text') or result.get('answer')
    else:
        answer = result
    answer = str(answer or '').strip()
    if not answer:
        raise PulsarError('cloudflare_ai_empty')
    return answer


PLATFORM_CONTEXT = """Gravitas+ is a connected research and learning platform.
Public: Topics combine video, essays, sources, timelines, simulations, viewpoints and discussion.
Dashboard: a member sees saved material, discussions, progress, learning and research in one account.
Learning/LMS: course catalog, enrolled courses, certificates, progress and a saved Library.
Research: projects, milestones, tasks, notes, sources, datasets, files, mind maps, discussions, experiments, activity and search.
Core: authorized team members coordinate operating work, content, research administration, tasks, links and activity.
Knowledge/Space: research notes and files stay connected to projects and can synchronize with private cloud storage.
Pulsar is the Gravitas+ assistant. It should be concise, transparent about uncertainty and never invent private data or capabilities."""
