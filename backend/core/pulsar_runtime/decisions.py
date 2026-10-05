import logging
from uuid import uuid4

import requests
from django.conf import settings

from .types import ModelSelection


logger = logging.getLogger(__name__)

FAST_OPERATIONS = {
    'classify', 'decision', 'done_check', 'extract', 'intent', 'interpret',
    'risk', 'route', 'routing', 'approval', 'date',
}
DEEP_OPERATIONS = {'deep', 'research', 'synthesis', 'complex_planning'}
JEV_PROVIDERS = {'jev', 'system-one', 'system_one', 'systemone'}


class DecisionRouter:
    """Bounded decision layer for deterministic logic or Jev/System One.

    The default remains deterministic. When PULSAR_DECISION_PROVIDER=jev and
    a System One key is configured, model-tier routing uses Jev's typed Choice
    primitive. Any timeout, malformed answer or low-confidence integration
    failure falls back to deterministic routing instead of blocking Pulsar.
    """

    def __init__(
        self,
        provider=None,
        model=None,
        *,
        base_url=None,
        api_key=None,
        timeout=None,
    ):
        self.provider = str(
            provider
            if provider is not None
            else getattr(settings, 'PULSAR_DECISION_PROVIDER', 'deterministic')
        ).strip().lower() or 'deterministic'
        self.model = str(
            model
            if model is not None
            else getattr(settings, 'PULSAR_DECISION_MODEL', '')
        ).strip() or 'jev-latest'
        self.base_url = str(
            base_url
            if base_url is not None
            else getattr(settings, 'SYSTEM_ONE_BASE_URL', 'https://system-one.dev/v1')
        ).strip().rstrip('/')
        self.api_key = str(
            api_key
            if api_key is not None
            else getattr(settings, 'SYSTEM_ONE_API_KEY', '')
        ).strip()
        self.timeout = int(
            timeout
            if timeout is not None
            else getattr(settings, 'PULSAR_DECISION_TIMEOUT', 12)
        )

    def _deterministic(self, *, skill, operation='chat', surface='unknown', source='deterministic'):
        operation = str(operation or 'chat').strip().lower()
        if operation in FAST_OPERATIONS:
            tier = 'fast'
            reason = f'bounded:{operation}'
        elif operation in DEEP_OPERATIONS or (
            skill.name == 'research' and operation in {'plan', 'compare'}
        ):
            tier = 'deep'
            reason = f'deep:{skill.name}:{operation}'
        else:
            tier = 'general'
            reason = f'default:{skill.name}:{surface}'
        return ModelSelection(
            tier=tier,
            reason=reason,
            decision_source=source,
            decision_model=self.model if self.provider in JEV_PROVIDERS else None,
        )

    def external_configured(self):
        return bool(
            self.provider in JEV_PROVIDERS
            and self.base_url
            and self.api_key
        )

    def evaluate(self, *, state, questions, idempotency_key=None):
        if not self.external_configured():
            raise RuntimeError('system_one_not_configured')
        response = requests.post(
            f'{self.base_url}/systemone',
            headers={
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotency_key or uuid4().hex,
            },
            json={
                'model': self.model,
                'state': state,
                'questions': questions,
            },
            timeout=(5, max(5, self.timeout)),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get('answers'), dict):
            raise ValueError('invalid_system_one_response')
        return payload

    def _jev_model_selection(self, *, skill, operation, surface):
        payload = self.evaluate(
            state={
                'skill': skill.name,
                'operation': str(operation or 'chat'),
                'surface': str(surface or 'unknown'),
                'risk_ceiling': skill.risk_ceiling,
                'capabilities': list(skill.capabilities),
            },
            questions={
                'model_tier': {
                    'type': 'choice',
                    'instructions': (
                        'Choose the minimum model tier that is likely to complete this Gravitas Pulsar '
                        'operation reliably. Prefer cheaper/faster tiers when capability is sufficient.'
                    ),
                    'criteria': {
                        'fast': 'Bounded routing, extraction, classification, date parsing or simple typed decisions.',
                        'general': 'Normal tutoring, chat, planning or tool-use reasoning with moderate complexity.',
                        'deep': 'Multi-source research synthesis, complex planning, comparison or high-reasoning work.',
                    },
                },
            },
        )
        answer = (payload.get('answers') or {}).get('model_tier') or {}
        choice = str(answer.get('choice') or '').strip().lower()
        if choice not in {'fast', 'general', 'deep'}:
            raise ValueError('invalid_system_one_model_tier')
        confidence = answer.get('confidence')
        confidence_text = f':confidence={confidence}' if confidence is not None else ''
        return ModelSelection(
            tier=choice,
            reason=f'jev:typed_choice{confidence_text}',
            decision_source='jev',
            decision_model=str(payload.get('model') or self.model),
        )

    def select_model(self, *, skill, operation='chat', surface='unknown'):
        if self.provider in JEV_PROVIDERS:
            if self.external_configured():
                try:
                    return self._jev_model_selection(
                        skill=skill,
                        operation=operation,
                        surface=surface,
                    )
                except (requests.RequestException, ValueError, RuntimeError) as exc:
                    logger.warning('Pulsar Jev decision failed; using deterministic fallback: %s', exc)
                    return self._deterministic(
                        skill=skill,
                        operation=operation,
                        surface=surface,
                        source='jev:fallback',
                    )
            return self._deterministic(
                skill=skill,
                operation=operation,
                surface=surface,
                source='jev:contract-fallback',
            )
        return self._deterministic(
            skill=skill,
            operation=operation,
            surface=surface,
        )

    def status(self):
        return {
            'provider': self.provider,
            'model': self.model,
            'external_active': self.external_configured(),
            'base_url': self.base_url if self.provider in JEV_PROVIDERS else None,
        }
