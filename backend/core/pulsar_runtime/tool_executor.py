import json
from dataclasses import dataclass, field
from typing import Any, Dict, List

from django.utils.dateparse import parse_datetime

from .context import PulsarContextEngine
from .errors import PulsarPermissionError
from .policy import ActionPolicy
from .tools import ToolRegistry


@dataclass
class ToolExecutionResult:
    tool: str
    content: str = ''
    data: Dict[str, Any] = field(default_factory=dict)
    sources: List[Dict[str, Any]] = field(default_factory=list)


class PulsarToolExecutor:
    """Executes a deliberately small set of high-level Pulsar tools.

    Live object ACLs are checked inside the underlying services. The model never
    receives direct database access and unsupported tools are not advertised to
    the agent planner.
    """

    SUPPORTED = {
        'lms.read',
        'learning.notes',
        'learning.reminders',
        'research.read',
        'research.search',
        'research.reminders',
        'files.read',
        'projects.read',
        'tasks.read',
        'tasks.draft',
        'project.reminders',
    }

    def __init__(self, *, tools=None, policy=None, context=None):
        self.tools = tools or ToolRegistry()
        self.policy = policy or ActionPolicy(self.tools)
        self.context = context or PulsarContextEngine()

    def supported_names(self, *, skill_name, profile):
        allowed = self.tools.allowed_names(skill_name=skill_name, profile=profile)
        return tuple(name for name in allowed if name in self.SUPPORTED)

    def execute(self, actor, tool_name, args=None, *, confirmed=False):
        args = dict(args or {})
        args.setdefault('_tool', tool_name)
        self.policy.decide(actor, tool_name, confirmed=confirmed)
        handler = {
            'lms.read': self._lms_read,
            'learning.notes': self._learning_notes,
            'learning.reminders': self._reminder,
            'research.read': self._research_read,
            'research.search': self._research_read,
            'research.reminders': self._reminder,
            'files.read': self._files_read,
            'projects.read': self._project_read,
            'tasks.read': self._tasks_read,
            'tasks.draft': self._task_draft,
            'project.reminders': self._reminder,
        }.get(tool_name)
        if handler is None:
            raise PulsarPermissionError(f'pulsar_tool_not_executable:{tool_name}')
        return handler(actor, args)

    def _course_lesson(self, actor, args):
        from core.lms_models import Course, Lesson

        course_id = args.get('course_id')
        try:
            course_id = int(course_id)
        except (TypeError, ValueError):
            raise PulsarPermissionError('course_id_required')
        course = Course.objects.filter(pk=course_id).first()
        if not course:
            raise PulsarPermissionError('course_not_found')

        lesson = None
        if args.get('lesson_id') not in (None, ''):
            try:
                lesson_id = int(args.get('lesson_id'))
            except (TypeError, ValueError):
                raise PulsarPermissionError('invalid_lesson_id')
            lesson = Lesson.objects.select_related('module__course').filter(pk=lesson_id).first()
            if not lesson or lesson.module.course_id != course.pk:
                raise PulsarPermissionError('lesson_course_mismatch')
        return course, lesson

    def _lms_read(self, actor, args):
        course, lesson = self._course_lesson(actor, args)
        package = self.context.learning(
            actor,
            course,
            lesson=lesson,
            question=str(args.get('query') or ''),
        )
        return ToolExecutionResult(
            tool='lms.read',
            content=package.text,
            data=package.metadata,
            sources=package.sources,
        )

    def _learning_notes(self, actor, args):
        from core.lms_models import CourseEnrollment, LearningInteraction

        course, lesson = self._course_lesson(actor, args)
        enrollment = CourseEnrollment.objects.filter(
            user=actor,
            course=course,
            status__in=[
                CourseEnrollment.Status.ACTIVE,
                CourseEnrollment.Status.PAUSED,
                CourseEnrollment.Status.COMPLETED,
            ],
        ).first()
        if not enrollment:
            raise PulsarPermissionError('course_enrollment_required')

        kind = str(args.get('kind') or LearningInteraction.Kind.NOTE).strip().lower()
        if kind not in LearningInteraction.Kind.values:
            raise PulsarPermissionError('invalid_learning_interaction_kind')
        body = str(args.get('body') or '').strip()[:8000]
        quote = str(args.get('quote') or '').strip()[:8000]
        if not body and not quote:
            raise PulsarPermissionError('learning_interaction_content_required')

        due_at = None
        if args.get('due_at'):
            due_at = parse_datetime(str(args.get('due_at')))
            if due_at is None:
                raise PulsarPermissionError('invalid_learning_interaction_due_at')

        row = LearningInteraction.objects.create(
            user=actor,
            enrollment=enrollment,
            lesson=lesson,
            kind=kind,
            section_key=str(args.get('section_key') or '')[:240],
            quote=quote,
            body=body,
            anchor=args.get('anchor') if isinstance(args.get('anchor'), dict) else {},
            due_at=due_at,
        )
        return ToolExecutionResult(
            tool='learning.notes',
            content=f'Learning interaction created: {row.kind} #{row.pk}',
            data={
                'id': row.pk,
                'kind': row.kind,
                'course_id': course.pk,
                'lesson_id': lesson.pk if lesson else None,
                'due_at': row.due_at.isoformat() if row.due_at else None,
            },
        )

    def _research_read(self, actor, args):
        package = self.context.workspace(
            actor,
            str(args.get('query') or ''),
            project_id=args.get('project_id'),
            skill='research',
            max_resources=min(max(int(args.get('limit') or 8), 1), 12),
        )
        return ToolExecutionResult(
            tool='research.search' if args.get('_tool') == 'research.search' else 'research.read',
            content=package.text,
            data=package.metadata,
            sources=package.sources,
        )

    def _files_read(self, actor, args):
        from core.models import KnowledgeResource
        from core.platform_access import can_view

        if args.get('resource_id') in (None, ''):
            package = self.context.workspace(
                actor,
                str(args.get('query') or ''),
                project_id=args.get('project_id'),
                skill='research',
                max_resources=6,
            )
            return ToolExecutionResult(
                tool='files.read',
                content=package.text,
                data=package.metadata,
                sources=package.sources,
            )

        try:
            resource_id = int(args.get('resource_id'))
        except (TypeError, ValueError):
            raise PulsarPermissionError('invalid_resource_id')
        resource = KnowledgeResource.objects.filter(pk=resource_id).first()
        if not resource or not can_view(actor, resource):
            raise PulsarPermissionError('resource_access_required')
        text = str(resource.body or resource.description or '').strip()
        return ToolExecutionResult(
            tool='files.read',
            content=f'{resource.title}\n{text[:12000]}',
            data={'resource_id': resource.pk, 'kind': resource.kind},
            sources=[{
                'id': str(resource.pk),
                'title': resource.title,
                'kind': resource.kind,
                'href': f'/api/platform/resources/{resource.pk}/',
            }],
        )

    def _project_read(self, actor, args):
        package = self.context.workspace(
            actor,
            str(args.get('query') or ''),
            project_id=args.get('project_id'),
            skill='project_task',
            max_resources=min(max(int(args.get('limit') or 8), 1), 12),
        )
        return ToolExecutionResult(
            tool='projects.read',
            content=package.text,
            data=package.metadata,
            sources=package.sources,
        )

    def _tasks_read(self, actor, args):
        from core.operating_models import OperatingTask, WorkStatus
        from core.platform_access import can_view

        qs = (
            OperatingTask.objects
            .exclude(status=WorkStatus.ARCHIVED)
            .select_related('owner', 'project')
            .order_by('due_date', 'id')
        )
        if args.get('project_id') not in (None, ''):
            try:
                qs = qs.filter(project_id=int(args.get('project_id')))
            except (TypeError, ValueError):
                raise PulsarPermissionError('invalid_project_id')
        if args.get('mine') is True:
            qs = qs.filter(owner=actor)

        rows = []
        for task in qs[:120]:
            if not can_view(actor, task):
                continue
            rows.append({
                'id': task.pk,
                'title': task.title,
                'status': task.status,
                'priority': task.priority,
                'due_date': task.due_date.isoformat() if task.due_date else None,
                'owner': (
                    task.owner.get_full_name()
                    or task.owner.email
                    or task.owner.get_username()
                ) if task.owner_id else None,
                'project_id': task.project_id,
            })
            if len(rows) >= min(max(int(args.get('limit') or 20), 1), 40):
                break

        return ToolExecutionResult(
            tool='tasks.read',
            content=json.dumps(rows, ensure_ascii=False),
            data={'tasks': rows, 'count': len(rows)},
        )


    def _reminder(self, actor, args):
        from django.utils import timezone
        from django.utils.dateparse import parse_datetime

        from .scheduler import schedule_reminder

        due_at = parse_datetime(str(args.get('due_at') or '').strip())
        if due_at is None:
            raise PulsarPermissionError('valid_reminder_due_at_required')
        if timezone.is_naive(due_at):
            due_at = timezone.make_aware(
                due_at,
                timezone.get_current_timezone(),
            )
        tool_name = str(args.get('_tool') or '')
        skill = {
            'learning.reminders': 'learning',
            'research.reminders': 'research',
            'project.reminders': 'project_task',
        }.get(tool_name)
        if not skill:
            raise PulsarPermissionError('invalid_reminder_tool')
        message = str(args.get('message') or '').strip()
        if not message:
            raise PulsarPermissionError('reminder_message_required')
        run = schedule_reminder(
            actor,
            message=message,
            due_at=due_at,
            title=str(args.get('title') or 'Pulsar reminder'),
            thread_key=str(args.get('thread_id') or 'primary')[:160],
            surface=str(args.get('surface') or 'core')[:32],
            skill=skill,
            metadata={
                key: value
                for key, value in args.items()
                if key in {
                    'project_id',
                    'course_id',
                    'lesson_id',
                    'workspace_id',
                }
            },
        )
        return ToolExecutionResult(
            tool=tool_name,
            content=(
                f'Reminder scheduled for {run.wait_until.isoformat()}: '
                f'{message[:500]}'
            ),
            data={
                'run_id': run.run_id,
                'status': run.status,
                'wait_until': run.wait_until.isoformat(),
                'thread_key': run.thread.thread_key,
            },
        )

    def _task_draft(self, actor, args):
        title = ' '.join(str(args.get('title') or '').split()).strip()[:240]
        if not title:
            raise PulsarPermissionError('task_title_required')
        draft = {
            'title': title,
            'description': str(args.get('description') or '').strip()[:6000],
            'definition_of_done': str(args.get('definition_of_done') or '').strip()[:4000],
            'priority': str(args.get('priority') or 'p2').lower(),
            'due_date': str(args.get('due_date') or '').strip() or None,
            'project_id': args.get('project_id'),
            'owner_id': args.get('owner_id') or getattr(actor, 'pk', None),
        }
        if draft['priority'] not in {'p0', 'p1', 'p2', 'p3'}:
            draft['priority'] = 'p2'
        return ToolExecutionResult(
            tool='tasks.draft',
            content=json.dumps(draft, ensure_ascii=False),
            data={'draft': draft},
        )
