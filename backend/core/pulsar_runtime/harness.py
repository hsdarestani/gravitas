from .decisions import DecisionRouter
from .providers import ModelGateway
from .skills import SkillRegistry
from .trace import emit
from .types import HarnessResult, InvocationContext


class PulsarHarness:
    """Shared runtime for every Pulsar surface."""

    def __init__(self, *, skills=None, decisions=None, models=None):
        self.skills = skills or SkillRegistry()
        self.decisions = decisions or DecisionRouter()
        self.models = models or ModelGateway()

    def configured(self):
        return self.models.configured()

    def run_text(
        self,
        *,
        system,
        user,
        max_tokens=900,
        temperature=0.2,
        surface='unknown',
        skill=None,
        operation='chat',
        thread_id=None,
        user_id=None,
        workspace_id=None,
        locale=None,
        metadata=None,
    ):
        invocation = InvocationContext.create(
            surface=surface,
            thread_id=thread_id,
            user_id=user_id,
            workspace_id=workspace_id,
            locale=locale,
            metadata=metadata,
        )
        skill_def = self.skills.resolve(name=skill, surface=invocation.surface)
        emit('run.started', invocation, skill=skill_def.name, operation=operation)

        selection = self.decisions.select_model(
            skill=skill_def,
            operation=operation,
            surface=invocation.surface,
        )
        emit(
            'decision.model_tier',
            invocation,
            skill=skill_def.name,
            model_tier=selection.tier,
            reason=selection.reason,
            decision_source=selection.decision_source,
            decision_model=selection.decision_model,
        )

        try:
            response = self.models.complete(
                system=system,
                user=user,
                max_tokens=max_tokens,
                temperature=temperature,
                tier=selection.tier,
            )
        except Exception as exc:
            emit(
                'run.failed',
                invocation,
                skill=skill_def.name,
                model_tier=selection.tier,
                error=exc.__class__.__name__,
            )
            raise

        emit(
            'run.completed',
            invocation,
            skill=skill_def.name,
            model_tier=selection.tier,
            provider=response.provider,
            model=response.model,
            latency_ms=response.latency_ms,
        )
        return HarnessResult(
            text=response.text,
            provider=response.provider,
            model=response.model,
            model_tier=selection.tier,
            skill=skill_def.name,
            run_id=invocation.run_id,
            decision_source=selection.decision_source,
        )
