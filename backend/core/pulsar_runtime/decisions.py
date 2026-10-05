from django.conf import settings

from .types import ModelSelection


FAST_OPERATIONS = {
    'classify', 'decision', 'done_check', 'extract', 'intent', 'interpret',
    'risk', 'route', 'routing', 'approval', 'date',
}
DEEP_OPERATIONS = {'deep', 'research', 'synthesis', 'complex_planning'}


class DecisionRouter:
    """Decision boundary for Jev/System One or similar models.

    v0.1 keeps deterministic routing active until an external decision backend
    passes the Pulsar eval set. The provider/model settings are contract points,
    not an implicit trust of an untested model.
    """

    def __init__(self, provider=None, model=None):
        self.provider = str(
            provider
            if provider is not None
            else getattr(settings, 'PULSAR_DECISION_PROVIDER', 'deterministic')
        ).strip().lower() or 'deterministic'
        self.model = str(
            model
            if model is not None
            else getattr(settings, 'PULSAR_DECISION_MODEL', '')
        ).strip() or None

    def select_model(self, *, skill, operation='chat', surface='unknown'):
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

        source = (
            'deterministic'
            if self.provider == 'deterministic'
            else f'{self.provider}:contract-fallback'
        )
        return ModelSelection(
            tier=tier,
            reason=reason,
            decision_source=source,
            decision_model=self.model,
        )

    def status(self):
        return {
            'provider': self.provider,
            'model': self.model,
            'external_active': False,
        }
