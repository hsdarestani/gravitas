from .continuity import begin_run, build_continuity_prefix, complete_run, fail_run
from .decisions import DecisionRouter
from .profiles import assert_skill_allowed, snapshot
from .providers import ModelGateway
from .skills import SkillRegistry
from .tools import ToolRegistry
from .trace import emit
from .types import HarnessResult, InvocationContext


class PulsarHarness:
    """Shared runtime for every Pulsar surface.

    User memory/profile narrows capabilities. Live object ACLs are still
    enforced in the context/tool services before any data is read or written.
    """

    def __init__(self, *, skills=None, tools=None, decisions=None, models=None):
        self.skills = skills or SkillRegistry()
        self.tools = tools or ToolRegistry()
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
        actor=None,
    ):
        invocation = InvocationContext.create(
            surface=surface,
            thread_id=thread_id,
            user_id=user_id or (getattr(actor, 'pk', None) if actor else None),
            workspace_id=workspace_id,
            locale=locale,
            metadata=metadata,
        )
        skill_def = self.skills.resolve(name=skill, surface=invocation.surface)
        if skill_def.requires_auth:
            assert_skill_allowed(actor, skill_def.name)
        profile = snapshot(actor)
        effective_thread_id = thread_id
        if (
            not effective_thread_id
            and actor is not None
            and getattr(actor, 'is_authenticated', False)
        ):
            effective_thread_id = 'primary'
        run = None
        continuity_prefix = ''
        if effective_thread_id:
            run_metadata = dict(metadata or {})
            if workspace_id not in (None, ''):
                run_metadata.setdefault('workspace_id', workspace_id)
            turn_input = str(run_metadata.get('turn_input') or user)
            _, run, history, memories = begin_run(
                actor,
                run_id=invocation.run_id,
                thread_key=effective_thread_id,
                surface=invocation.surface,
                skill=skill_def.name,
                input_text=turn_input,
                metadata=run_metadata,
            )
            continuity_prefix = build_continuity_prefix(history, memories)

        allowed_tools = self.tools.allowed_names(
            skill_name=skill_def.name,
            profile=profile,
        )
        emit(
            'run.started',
            invocation,
            skill=skill_def.name,
            operation=operation,
            profile_version=profile.get('version'),
            allowed_tools=list(allowed_tools),
        )

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
            effective_user = (
                continuity_prefix + '\n\nCurrent turn:\n' + str(user)
                if continuity_prefix
                else user
            )
            response = self.models.complete(
                system=system,
                user=effective_user,
                max_tokens=max_tokens,
                temperature=temperature,
                tier=selection.tier,
            )
        except Exception as exc:
            fail_run(run, exc)
            emit(
                'run.failed',
                invocation,
                skill=skill_def.name,
                model_tier=selection.tier,
                error=exc.__class__.__name__,
            )
            raise

        complete_run(
            run,
            output_text=response.text,
            provider=response.provider,
            model=response.model,
            metadata={
                'model_tier': selection.tier,
                'decision_source': selection.decision_source,
            },
        )
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
            tools=allowed_tools,
            profile_version=int(profile.get('version') or 0),
        )
