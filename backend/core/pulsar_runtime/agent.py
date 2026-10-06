import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from django.utils import timezone

from .continuity import get_thread, normalize_thread_key
from .errors import PulsarApprovalRequired, PulsarError, PulsarPermissionError
from .harness import PulsarHarness
from .profiles import assert_skill_allowed, snapshot
from .skills import SkillRegistry
from .tool_executor import PulsarToolExecutor, ToolExecutionResult


TOOL_ARGUMENT_HINTS = {
    'learning.reminders': {
        'message': 'string, required',
        'title': 'string, optional',
        'due_at': 'ISO datetime, required',
        'course_id': 'integer, optional',
        'lesson_id': 'integer, optional',
    },
    'research.reminders': {
        'message': 'string, required',
        'title': 'string, optional',
        'due_at': 'ISO datetime, required',
        'project_id': 'integer, optional',
    },
    'project.reminders': {
        'message': 'string, required',
        'title': 'string, optional',
        'due_at': 'ISO datetime, required',
        'project_id': 'integer, optional',
    },
    'lms.read': {
        'course_id': 'integer, required',
        'lesson_id': 'integer, optional',
        'query': 'string',
    },
    'learning.notes': {
        'course_id': 'integer, required',
        'lesson_id': 'integer, optional',
        'kind': 'note|highlight|bookmark|reminder|task',
        'body': 'string',
        'quote': 'string, optional',
        'section_key': 'string, optional',
        'due_at': 'ISO datetime, optional',
    },
    'research.read': {
        'project_id': 'integer, optional',
        'query': 'string',
        'limit': 'integer 1..12',
    },
    'research.search': {
        'project_id': 'integer, optional',
        'query': 'string',
        'limit': 'integer 1..12',
    },
    'files.read': {
        'resource_id': 'integer, optional',
        'project_id': 'integer, optional',
        'query': 'string, optional',
    },
    'projects.read': {
        'project_id': 'integer, optional',
        'query': 'string',
        'limit': 'integer 1..12',
    },
    'tasks.read': {
        'project_id': 'integer, optional',
        'mine': 'boolean, optional',
        'limit': 'integer 1..40',
    },
    'tasks.draft': {
        'title': 'string, required',
        'description': 'string, optional',
        'definition_of_done': 'string, optional',
        'priority': 'p0|p1|p2|p3',
        'due_date': 'YYYY-MM-DD, optional',
        'project_id': 'integer, optional',
        'key_result_id': 'integer, optional',
        'dependency_id': 'integer, optional',
        'owner_id': 'integer, optional',
    },
    'tasks.create': {
        'title': 'string, required',
        'description': 'string, optional',
        'definition_of_done': 'string, optional',
        'priority': 'p0|p1|p2|p3',
        'due_date': 'YYYY-MM-DD, required',
        'key_result_id': 'integer, required',
        'project_id': 'integer, optional',
        'dependency_id': 'integer, optional',
        'owner_id': 'integer, optional',
    },
}


MAX_TOOL_STEPS = 4
CROSS_SKILL_SURFACES = {'core', 'projects', 'research', 'lms', 'learning', 'telegram'}


@dataclass
class AgentOutcome:
    status: str
    reply: str = ''
    run_id: Optional[str] = None
    tool: Optional[str] = None
    tool_args: Dict[str, Any] = field(default_factory=dict)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)
    approval_required: bool = False


def _json_object(value):
    raw = str(value or '').strip()
    fence = chr(96) * 3
    if raw.startswith(fence):
        lines = raw.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith(fence):
            lines = lines[:-1]
        raw = '\n'.join(lines).strip()
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        start, end = raw.find('{'), raw.rfind('}')
        if start < 0 or end <= start:
            raise PulsarError('pulsar_agent_invalid_plan')
        try:
            parsed = json.loads(raw[start:end + 1])
        except ValueError as exc:
            raise PulsarError('pulsar_agent_invalid_plan') from exc
    if not isinstance(parsed, dict):
        raise PulsarError('pulsar_agent_invalid_plan')
    return parsed


def _safe_metadata(metadata):
    metadata = metadata if isinstance(metadata, dict) else {}
    result = {}
    for key in (
        'project_id', 'course_id', 'lesson_id', 'resource_id',
        'workspace_id', 'section_key', 'key_result_id',
        'dependency_id', 'owner_id',
    ):
        value = metadata.get(key)
        if value not in (None, ''):
            result[key] = value
    return result


def _tool_trace(results):
    rows = []
    for result in list(results or [])[:MAX_TOOL_STEPS]:
        rows.append({
            'tool': str(getattr(result, 'tool', '') or ''),
            'content': str(getattr(result, 'content', '') or '')[:6000],
            'data': getattr(result, 'data', {}) if isinstance(getattr(result, 'data', {}), dict) else {},
            'sources': list(getattr(result, 'sources', []) or [])[:8],
        })
    return rows


def _json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _restore_tool_results(rows):
    results = []
    for row in list(rows or [])[:MAX_TOOL_STEPS]:
        if not isinstance(row, dict):
            continue
        results.append(ToolExecutionResult(
            tool=str(row.get('tool') or ''),
            content=str(row.get('content') or ''),
            data=row.get('data') if isinstance(row.get('data'), dict) else {},
            sources=row.get('sources') if isinstance(row.get('sources'), list) else [],
        ))
    return results


class PulsarAgent:
    """Controlled bounded agent loop shared by authenticated Gravitas surfaces.

    Pulsar may chain a small number of observable tool calls when a request needs
    multiple retrieval steps. The server enforces a hard step ceiling, blocks
    duplicate tool calls, and keeps every side effect behind ActionPolicy and
    server-side pending approvals.
    """

    def __init__(self, *, harness=None, skills=None, executor=None, decisions=None):
        self.harness = harness or PulsarHarness()
        self.skills = skills or SkillRegistry()
        self.executor = executor or PulsarToolExecutor()
        self.decisions = decisions or getattr(self.harness, 'decisions', None)

    def _thread(self, actor, thread_id, *, surface, skill):
        return get_thread(
            actor,
            normalize_thread_key(thread_id or 'primary'),
            surface=surface,
            skill=skill,
        )

    def _pending(self, thread):
        if thread is None:
            return None
        state = thread.state if isinstance(thread.state, dict) else {}
        value = state.get('pending_tool')
        return value if isinstance(value, dict) else None

    def _set_pending(
        self,
        thread,
        *,
        tool,
        args,
        message,
        primary_skill,
        tool_results=None,
        decision_trace=None,
    ):
        if thread is None:
            return
        state = dict(thread.state or {})
        state['pending_tool'] = {
            'tool': tool,
            'args': dict(args or {}),
            'message': str(message or '')[:6000],
            'primary_skill': str(primary_skill or '')[:64],
            'completed_tools': _json_safe(_tool_trace(tool_results)),
            'decision_trace': _json_safe(decision_trace or []),
            'created_at': timezone.now().isoformat(),
        }
        thread.state = state
        thread.status = thread.Status.WAITING
        thread.save(update_fields=['state', 'status', 'updated_at'])

    def _clear_pending(self, thread):
        if thread is None:
            return
        state = dict(thread.state or {})
        if 'pending_tool' in state:
            state.pop('pending_tool', None)
            thread.state = state
            thread.status = thread.Status.ACTIVE
            thread.save(update_fields=['state', 'status', 'updated_at'])

    def _tool_catalog(self, names):
        rows = []
        for name in names:
            definition = self.executor.tools.get(name)
            if not definition:
                continue
            rows.append({
                'name': definition.name,
                'skill': definition.skill,
                'description': definition.description,
                'risk': definition.risk,
                'action': definition.action,
                'arguments': TOOL_ARGUMENT_HINTS.get(name, {}),
            })
        return rows

    def _orchestration_skills(
        self,
        actor,
        *,
        primary_skill,
        surface,
        explicit_skill,
    ):
        if explicit_skill or str(surface or '').strip().lower() not in CROSS_SKILL_SURFACES:
            return (primary_skill,)

        profile = snapshot(actor)
        allowed = {
            str(name or '').strip().lower()
            for name in (profile.get('allowed_skills') or [])
        }
        ordered = []
        if primary_skill in allowed:
            ordered.append(primary_skill)
        for skill in self.skills.all():
            if skill.name in allowed and skill.name not in ordered:
                ordered.append(skill.name)
        return tuple(ordered or (primary_skill,))

    def _plan(
        self,
        actor,
        *,
        message,
        surface,
        skill_name,
        skill_names,
        thread_id,
        metadata,
        tool_results=None,
    ):
        profile = snapshot(actor)
        names = self.executor.supported_names_for_skills(
            skill_names=skill_names,
            profile=profile,
        )
        if not names:
            return {'action': 'answer'}, ()

        catalog = self._tool_catalog(names)
        route = None
        if self.decisions is not None and hasattr(self.decisions, 'select_tool_route'):
            route = self.decisions.select_tool_route(
                message=message,
                surface=surface,
                primary_skill=skill_name,
                tools=catalog,
                completed_tools=_tool_trace(tool_results),
            )

        route_record = {
            'route_action': str(getattr(route, 'action', 'planner') or 'planner'),
            'route_tool': getattr(route, 'tool', None),
            'route_source': str(
                getattr(route, 'decision_source', 'planner') or 'planner'
            ),
            'route_model': getattr(route, 'decision_model', None),
            'route_reason': str(getattr(route, 'reason', '') or ''),
            'route_confidence': getattr(route, 'confidence', None),
        }
        if route_record['route_action'] == 'answer':
            return {
                'action': 'answer',
                '_decision': {
                    **route_record,
                    'planner_action': 'skipped',
                    'planner_tool': None,
                },
            }, names

        selected_tool = (
            str(route_record['route_tool'] or '').strip()
            if route_record['route_action'] == 'tool'
            else ''
        )
        if selected_tool:
            if selected_tool not in set(names):
                raise PulsarPermissionError(
                    f'pulsar_decision_tool_not_allowed:{selected_tool}'
                )
            names = (selected_tool,)
            catalog = self._tool_catalog(names)

        system = (
            'You are the planning step of Pulsar, the Gravitas+ multi-capability agent. '
            'Choose exactly one next action and return ONLY JSON. '
            'Use {"action":"answer"} when enough evidence has been retrieved. '
            'Otherwise use {"action":"tool","tool":"exact.name","args":{...}}. '
            'The server may call you again after a tool result, but enforces a hard bounded step limit. '
            'Tools may belong to different skills. Choose across them only when the user request needs it. '
            'Only choose a listed tool. Never invent IDs. Reuse IDs supplied in Context IDs. '
            'Never repeat a tool with the same arguments when that result is already present. '
            'Do not choose a write tool unless the user explicitly asked for that side effect. '
            'Write tools still require server-side approval. '
            'Do not answer the user in this planning step.'
        )
        planning = self.harness.run_text(
            system=system,
            user=(
                'Available skills:\n'
                + json.dumps(list(skill_names), ensure_ascii=False)
                + '\nAvailable tools:\n'
                + json.dumps(catalog, ensure_ascii=False)
                + '\nDecision layer route:\n'
                + json.dumps(route_record, ensure_ascii=False, default=str)
                + '\nContext IDs:\n'
                + json.dumps(_safe_metadata(metadata), ensure_ascii=False)
                + '\nCurrent time:\n'
                + timezone.localtime().isoformat()
                + '\nTool results already retrieved:\n'
                + json.dumps(_tool_trace(tool_results), ensure_ascii=False, default=str)
                + '\nUser request:\n'
                + str(message or '')[:8000]
            ),
            max_tokens=500,
            temperature=0,
            surface=surface,
            skill=skill_name,
            operation='route',
            thread_id=thread_id,
            actor=actor,
            metadata={'continuity': False},
        )
        plan = _json_object(planning.text)
        action = str(plan.get('action') or 'answer').strip().lower()
        if action != 'tool':
            return {
                'action': 'answer',
                '_decision': {
                    **route_record,
                    'planner_action': 'answer',
                    'planner_tool': None,
                },
            }, names

        tool = str(plan.get('tool') or '').strip()
        if selected_tool and tool != selected_tool:
            raise PulsarPermissionError(
                f'pulsar_planner_route_mismatch:{tool}:{selected_tool}'
            )
        if tool not in set(names):
            raise PulsarPermissionError(f'pulsar_planner_tool_not_allowed:{tool}')
        args = plan.get('args')
        if not isinstance(args, dict):
            args = {}
        for key, value in _safe_metadata(metadata).items():
            args.setdefault(key, value)
        return {
            'action': 'tool',
            'tool': tool,
            'args': args,
            '_decision': {
                **route_record,
                'planner_action': 'tool',
                'planner_tool': tool,
            },
        }, names

    def _final_answer(
        self,
        actor,
        *,
        message,
        surface,
        skill_name,
        thread_id,
        metadata,
        tool_results=None,
        decision_trace=None,
    ):
        tool_results = list(tool_results or [])
        decision_trace = list(decision_trace or [])
        if not tool_results:
            system = (
                'You are Pulsar, the Gravitas+ learning and research assistant. '
                'Answer in the user language. Be concise, useful and transparent about uncertainty. '
                'Do not claim access to data that was not provided or retrieved.'
            )
            user_text = str(message or '')[:12000]
            sources = []
            tool_name = None
            data = {}
        else:
            system = (
                'You are Pulsar, the Gravitas+ learning and research assistant. '
                'Answer the original request using all retrieved tool results as grounded context. '
                'Live Gravitas data is authoritative over memory. '
                'Do not invent facts outside the retrieved results. '
                'When useful, reference supplied sources by title.'
            )
            trace = _tool_trace(tool_results)
            user_text = (
                f'Original request:\n{str(message or "")[:6000]}\n\n'
                f'Retrieved tool results:\n'
                f'{json.dumps(trace, ensure_ascii=False, default=str)[:24000]}'
            )
            sources = []
            seen_sources = set()
            for row in tool_results:
                for source in list(getattr(row, 'sources', []) or []):
                    if not isinstance(source, dict):
                        continue
                    marker = (
                        str(source.get('id') or ''),
                        str(source.get('title') or ''),
                        str(source.get('href') or ''),
                    )
                    if marker in seen_sources:
                        continue
                    seen_sources.add(marker)
                    sources.append(source)
                    if len(sources) >= 20:
                        break
                if len(sources) >= 20:
                    break
            last = tool_results[-1]
            tool_name = last.tool
            data = dict(last.data or {}) if isinstance(last.data, dict) else {}
            if len(tool_results) > 1:
                data['tool_trace'] = [
                    {
                        'tool': row['tool'],
                        'sources': row['sources'],
                    }
                    for row in trace
                ]

        if tool_results:
            skills_used = []
            for row in tool_results:
                definition = self.executor.tools.get(
                    str(getattr(row, 'tool', '') or '')
                )
                if definition and definition.skill not in skills_used:
                    skills_used.append(definition.skill)
            if skills_used:
                data['skills_used'] = skills_used
        if decision_trace:
            data['decision_trace'] = _json_safe(decision_trace)

        result = self.harness.run_text(
            system=system,
            user=user_text,
            max_tokens=1200,
            temperature=0.15,
            surface=surface,
            skill=skill_name,
            operation='answer',
            thread_id=thread_id,
            actor=actor,
            metadata={
                **_safe_metadata(metadata),
                'turn_input': str(message or '')[:6000],
            },
        )
        return AgentOutcome(
            status='completed',
            reply=result.text,
            run_id=result.run_id,
            tool=tool_name,
            sources=sources,
            data=data,
        )

    def run(
        self,
        actor,
        message,
        *,
        surface='core',
        skill=None,
        thread_id='primary',
        metadata=None,
        confirm=False,
        cancel=False,
    ):
        if not actor or not getattr(actor, 'is_authenticated', False):
            raise PulsarPermissionError('pulsar_authentication_required')

        explicit_skill = bool(str(skill or '').strip())
        skill_def = self.skills.resolve(name=skill, surface=surface)
        assert_skill_allowed(actor, skill_def.name)
        orchestration_skills = self._orchestration_skills(
            actor,
            primary_skill=skill_def.name,
            surface=surface,
            explicit_skill=explicit_skill,
        )
        for allowed_skill in orchestration_skills:
            assert_skill_allowed(actor, allowed_skill)
        metadata = dict(metadata or {})
        thread = self._thread(
            actor,
            thread_id,
            surface=surface,
            skill=skill_def.name,
        )

        if cancel:
            self._clear_pending(thread)
            return AgentOutcome(status='cancelled', reply='Cancelled.')

        pending = self._pending(thread)
        if confirm:
            if not pending:
                return AgentOutcome(
                    status='no_pending_approval',
                    reply='There is no pending Pulsar action to approve.',
                )
            tool = str(pending.get('tool') or '')
            args = pending.get('args') if isinstance(pending.get('args'), dict) else {}
            original = str(pending.get('message') or message or '')
            prior_results = _restore_tool_results(pending.get('completed_tools'))
            prior_decisions = list(pending.get('decision_trace') or [])
            definition = self.executor.tools.get(tool)
            if definition is None:
                self._clear_pending(thread)
                raise PulsarPermissionError('pending_pulsar_tool_unknown')
            assert_skill_allowed(actor, definition.skill)
            result = self.executor.execute(
                actor,
                tool,
                args,
                confirmed=True,
            )
            self._clear_pending(thread)
            return self._final_answer(
                actor,
                message=original,
                surface=surface,
                skill_name=str(pending.get('primary_skill') or definition.skill),
                thread_id=thread_id,
                metadata=metadata,
                tool_results=[*prior_results, result],
                decision_trace=[
                    *prior_decisions,
                    {
                        'route_action': 'approved_tool',
                        'route_tool': tool,
                        'route_source': 'user_confirmation',
                        'route_model': None,
                        'route_reason': 'explicit_approval',
                        'route_confidence': None,
                        'planner_action': 'tool',
                        'planner_tool': tool,
                    },
                ],
            )

        tool_results = []
        decision_trace = []
        seen_calls = set()
        for _step in range(MAX_TOOL_STEPS):
            try:
                plan, _ = self._plan(
                    actor,
                    message=message,
                    surface=surface,
                    skill_name=skill_def.name,
                    skill_names=orchestration_skills,
                    thread_id=thread_id,
                    metadata=metadata,
                    tool_results=tool_results,
                )
            except PulsarPermissionError:
                raise
            except PulsarError as exc:
                plan = {
                    'action': 'answer',
                    '_decision': {
                        'route_action': 'fallback_answer',
                        'route_tool': None,
                        'route_source': 'planner_error',
                        'route_model': None,
                        'route_reason': exc.__class__.__name__,
                        'route_confidence': None,
                        'planner_action': 'error',
                        'planner_tool': None,
                    },
                }

            if isinstance(plan.get('_decision'), dict):
                decision_trace.append({
                    'step': len(decision_trace) + 1,
                    **plan['_decision'],
                })

            if plan.get('action') != 'tool':
                return self._final_answer(
                    actor,
                    message=message,
                    surface=surface,
                    skill_name=skill_def.name,
                    thread_id=thread_id,
                    metadata=metadata,
                    tool_results=tool_results,
                    decision_trace=decision_trace,
                )

            tool = plan['tool']
            args = plan.get('args') or {}
            call_signature = json.dumps(
                [tool, args],
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            if call_signature in seen_calls:
                return self._final_answer(
                    actor,
                    message=message,
                    surface=surface,
                    skill_name=skill_def.name,
                    thread_id=thread_id,
                    metadata=metadata,
                    tool_results=tool_results,
                    decision_trace=decision_trace,
                )
            seen_calls.add(call_signature)

            try:
                result = self.executor.execute(actor, tool, args, confirmed=False)
            except PulsarApprovalRequired:
                self._set_pending(
                    thread,
                    tool=tool,
                    args=args,
                    message=message,
                    primary_skill=skill_def.name,
                    tool_results=tool_results,
                    decision_trace=decision_trace,
                )
                definition = self.executor.tools.get(tool)
                return AgentOutcome(
                    status='approval_required',
                    reply=f'Approval required before Pulsar can execute {tool}.',
                    tool=tool,
                    tool_args=args,
                    approval_required=True,
                    data={
                        'risk': definition.risk if definition else None,
                        'description': definition.description if definition else '',
                        'completed_read_steps': len(tool_results),
                        'decision_trace': _json_safe(decision_trace),
                    },
                )

            tool_results.append(result)

        return self._final_answer(
            actor,
            message=message,
            surface=surface,
            skill_name=skill_def.name,
            thread_id=thread_id,
            metadata=metadata,
            tool_results=tool_results,
            decision_trace=decision_trace,
        )
