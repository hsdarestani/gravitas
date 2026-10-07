import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection
from django.db.models import Q
from django.utils.html import strip_tags

from .errors import PulsarPermissionError
from .profiles import assert_skill_allowed, snapshot
from .semantic import semantic_candidates, semantic_scores


@dataclass
class ContextPackage:
    text: str = ''
    sources: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


def _terms(question):
    return {
        value.lower()
        for value in re.findall(r"[\w'-]{3,}", str(question or ''), flags=re.UNICODE)
        if value.lower() not in {
            'about', 'from', 'have', 'that', 'these', 'this',
            'what', 'when', 'where', 'which', 'with', 'your',
        }
    }


def _resource_text(resource):
    body = re.sub(r'\s+', ' ', str(resource.body or '')).strip()
    description = re.sub(r'\s+', ' ', str(resource.description or '')).strip()
    return body or description

def _asks_for_own_tasks(question):
    value = str(question or '').strip().lower()
    if not value:
        return False
    patterns = (
        r'\bmy\b',
        r'\bmine\b',
        r'\bassigned\s+to\s+me\b',
        r'\bfor\s+me\b',
        r'\bmein(?:e|en|er|es|em)?\b',
        r'\bmir\s+zugewiesen\b',
        r'کارهای\s+من',
        r'تسک(?:‌|\s)*های\s+من',
        r'وظایف\s+من',
        r'به\s+من\s+اختصاص',
    )
    return any(re.search(pattern, value, flags=re.UNICODE) for pattern in patterns)


def _candidate_resources(queryset, question, *, limit):
    """Lexical pre-ranking in PostgreSQL with a portable fallback for tests."""
    question = str(question or '').strip()
    if connection.vendor == 'postgresql' and question:
        vector = (
            SearchVector('title', weight='A', config='simple')
            + SearchVector('description', weight='B', config='simple')
            + SearchVector('body', weight='C', config='simple')
        )
        query = SearchQuery(question, search_type='websearch', config='simple')
        return list(
            queryset
            .annotate(_pulsar_rank=SearchRank(vector, query))
            .filter(_pulsar_rank__gt=0)
            .order_by('-_pulsar_rank', '-updated_at')[:limit]
        )
    return list(queryset.order_by('-updated_at')[:limit])




def _hybrid_candidates(queryset, question, *, limit):
    lexical = _candidate_resources(queryset, question, limit=limit)
    semantic = semantic_candidates(queryset, limit=max(limit, 300))
    rows = []
    seen = set()
    for resource in list(lexical) + list(semantic):
        if resource.pk in seen:
            continue
        seen.add(resource.pk)
        rows.append(resource)
    return rows


def _rank_resources(resources, question, terms, can_view):
    prepared = []
    for resource in resources:
        if not can_view(resource):
            continue
        text = _resource_text(resource)
        prepared.append((resource, text))

    scores = semantic_scores(
        [resource for resource, _ in prepared],
        question,
    )
    minimum = float(getattr(settings, 'PULSAR_SEMANTIC_MIN_SCORE', 0.25) or 0.25)
    ranked = []
    for resource, text in prepared:
        haystack = f'{resource.title}\n{text}'.lower()
        lexical = sum(
            3 if term in resource.title.lower() else 1
            for term in terms
            if term in haystack
        )
        semantic = max(0.0, float(scores.get(resource.pk) or 0.0))
        if not terms and not semantic:
            lexical = 1
        if lexical or semantic >= minimum:
            combined = float(lexical) + (semantic * 4.0)
            ranked.append((combined, semantic, resource, text))
    ranked.sort(
        key=lambda row: (
            -row[0],
            -row[1],
            -row[2].updated_at.timestamp(),
        )
    )
    return ranked, bool(scores)


class PulsarContextEngine:
    """Build just-in-time context while live ACLs remain authoritative."""

    def workspace(self, user, question, *, project_id=None, skill='research', max_resources=8):
        from core.lms_models import CourseEnrollment, LearningInteraction
        from core.models import KnowledgeResource, ResearchProject
        from core.operating_models import OperatingTask, WorkStatus
        from core.platform_access import can_view

        assert_skill_allowed(user, skill)
        profile = snapshot(user)
        terms = _terms(question)
        blocks = []
        sources = []
        semantic_used = False

        if project_id not in (None, ''):
            try:
                project_id = int(project_id)
            except (TypeError, ValueError):
                raise PulsarPermissionError('invalid_project_id')
            project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
            if not project or not can_view(user, project):
                raise PulsarPermissionError('project_access_required')

            from core.canonical_projects import refresh_project
            refresh_project(project, user)
            project.refresh_from_db()

            blocks.append(
                f'Project: {project.title}\nDescription: {str(project.description or "")[:2200]}'
            )
            sources.append({
                'id': str(project.pk),
                'title': project.title,
                'kind': 'project',
                'href': f'/workspace/research/projects/{project.pk}',
            })

            candidates = _hybrid_candidates(
                KnowledgeResource.objects
                .filter(project=project)
                .select_related('project', 'workspace'),
                question,
                limit=120,
            )
            ranked, project_semantic_used = _rank_resources(
                candidates,
                question,
                terms,
                lambda resource: can_view(user, resource),
            )
            semantic_used = semantic_used or project_semantic_used
            for _, _, resource, text in ranked[:max_resources]:
                blocks.append(f'Resource: {resource.title}\n{text[:3000]}')
                sources.append({
                    'id': str(resource.pk),
                    'title': resource.title,
                    'kind': f'project_{resource.kind}',
                    'href': f'/workspace/research/projects/{project.pk}',
                })

            tasks = (
                OperatingTask.objects
                .filter(project=project)
                .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
                .select_related('owner')
                .order_by('due_date', 'id')[:20]
            )
            if tasks:
                task_rows = []
                for task in tasks:
                    if not can_view(user, task):
                        continue
                    owner = (
                        task.owner.get_full_name() or task.owner.email
                        if task.owner_id else 'Unassigned'
                    )
                    task_rows.append(
                        f'- {task.title} | owner={owner} | due={task.due_date or "—"} | status={task.status}'
                    )
                if task_rows:
                    blocks.append('Open project tasks:\n' + '\n'.join(task_rows))
            from core.research_models import ProjectDiscussionMessage, ResearchExperiment
            from core.platform_models import MindMap
            for name, queryset, fields in (
                ('Discussion', ProjectDiscussionMessage.objects.filter(project=project), ('body', 'resolved')),
                ('Experiment', ResearchExperiment.objects.filter(project=project), ('title', 'hypothesis', 'result_summary', 'status')),
                ('Mind map', MindMap.objects.filter(project=project), ('title', 'description')),
            ):
                for item in queryset.order_by('-pk')[:12]:
                    boundary = item if name == 'Mind map' else project
                    if not can_view(user, boundary):
                        continue
                    blocks.append(name + ': ' + ' | '.join(str(getattr(item, field, ''))[:1200] for field in fields))
                    if name == 'Mind map':
                        blocks.append('Nodes: ' + '; '.join(f'{n.title}: {n.body[:400]}' for n in item.nodes.all()[:30]))
                    sources.append({'id': str(item.pk), 'title': getattr(item, 'title', name), 'kind': name.lower(), 'href': f'/workspace/research/projects/{project.pk}'})
        else:
            candidates = _hybrid_candidates(
                KnowledgeResource.objects
                .filter(
                    Q(owner=user)
                    | Q(workspace__owner=user)
                    | Q(workspace__memberships__user=user),
                    kind=KnowledgeResource.Kind.NOTE,
                )
                .distinct(),
                question,
                limit=250,
            )
            ranked, workspace_semantic_used = _rank_resources(
                candidates,
                question,
                terms,
                lambda resource: can_view(user, resource),
            )
            semantic_used = semantic_used or workspace_semantic_used
            for _, _, resource, text in ranked[:max_resources]:
                blocks.append(f'Workspace note: {resource.title}\n{text[:2200]}')
                sources.append({
                    'id': str(resource.pk),
                    'title': resource.title,
                    'kind': 'workspace_note',
                    'href': f'/workspace/page/{resource.pk}',
                })

            if skill == 'project_task':
                own_tasks_only = _asks_for_own_tasks(question)
                task_candidates = (
                    OperatingTask.objects
                    .filter(
                        Q(owner=user)
                        | Q(workspace__owner=user)
                        | Q(workspace__memberships__user=user)
                    )
                    .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
                    .select_related(
                        'owner',
                        'project',
                        'initiative__key_result__objective',
                    )
                    .distinct()
                    .order_by('due_date', 'priority', 'id')[:60]
                )
                task_rows = []
                for task in task_candidates:
                    if not can_view(user, task):
                        continue
                    if own_tasks_only and task.owner_id != user.pk:
                        continue
                    owner = (
                        task.owner.get_full_name() or task.owner.email
                        if task.owner_id else 'Unassigned'
                    )
                    project_title = task.project.title if task.project_id else 'Core'
                    kr = task.initiative.key_result
                    assignment = (
                        'assigned_to_current_user'
                        if task.owner_id == user.pk
                        else 'assigned_to_other_team_member'
                    )
                    task_rows.append(
                        f'- [{task.pk}] {task.title} | owner={owner} | assignment={assignment} | '
                        f'project={project_title} | kr={kr.title} | '
                        f'due={task.due_date or "—"} | status={task.status}'
                    )
                    sources.append({
                        'id': str(task.pk),
                        'title': task.title,
                        'kind': 'core_task',
                        'href': '/workspace/core/tasks',
                    })
                    if len(task_rows) >= 20:
                        break
                if task_rows:
                    heading = (
                        'Tasks assigned to the current user:'
                        if own_tasks_only
                        else 'Visible open Core tasks:'
                    )
                    blocks.append(heading + '\n' + '\n'.join(task_rows))

            if skill == 'learning':
                enrollments = (
                    CourseEnrollment.objects
                    .filter(
                        user=user,
                        status__in=[
                            CourseEnrollment.Status.ACTIVE,
                            CourseEnrollment.Status.PAUSED,
                            CourseEnrollment.Status.COMPLETED,
                        ],
                    )
                    .select_related('course')
                    .order_by('-updated_at')[:12]
                )
                learning_rows = []
                enrollment_ids = []
                for enrollment in enrollments:
                    course = enrollment.course
                    learning_rows.append(
                        f'- course={course.title} | course_id={course.pk} | '
                        f'progress={enrollment.progress_percent}% | status={enrollment.status}'
                    )
                    enrollment_ids.append(enrollment.pk)
                    sources.append({
                        'id': str(course.pk),
                        'title': course.title,
                        'kind': 'course',
                        'href': f'/workspace/learning/courses/{course.pk}',
                    })
                if learning_rows:
                    blocks.append(
                        'Current learner course progress:\n' + '\n'.join(learning_rows)
                    )

                if enrollment_ids:
                    interactions = (
                        LearningInteraction.objects
                        .filter(user=user, enrollment_id__in=enrollment_ids)
                        .select_related('enrollment__course', 'lesson')
                        .order_by('-updated_at')[:12]
                    )
                    interaction_rows = []
                    for item in interactions:
                        text = (item.body or item.quote or '').strip()
                        if not text:
                            continue
                        label = (
                            item.lesson.title
                            if item.lesson_id
                            else item.enrollment.course.title
                        )
                        interaction_rows.append(
                            f'- {item.kind} @ {label}: {text[:700]}'
                        )
                    if interaction_rows:
                        blocks.append(
                            'Recent learner notes/highlights/reminders:\n'
                            + '\n'.join(interaction_rows)
                        )

            try:
                from core.lms_interaction_api import pulsar_workspace_project_context
                granted_text, granted_sources = pulsar_workspace_project_context(user)
            except Exception:
                granted_text, granted_sources = '', []
            if granted_text:
                blocks.append('Explicitly granted project context:\n' + granted_text)
                sources.extend(granted_sources)

        return ContextPackage(
            text='\n\n---\n\n'.join(value for value in blocks if value),
            sources=sources,
            metadata={
                'profile': profile,
                'project_id': project_id,
                'resource_count': len(sources),
                'retrieval_mode': (
                    'structured+postgres_fts+semantic+scoped_memory'
                    if semantic_used and connection.vendor == 'postgresql'
                    else (
                        'structured+portable_lexical+semantic+scoped_memory'
                        if semantic_used
                        else (
                            'structured+postgres_fts+scoped_memory'
                            if connection.vendor == 'postgresql'
                            else 'structured+portable_lexical+scoped_memory'
                        )
                    )
                ),
                'semantic_used': semantic_used,
            },
        )

    def learning(self, user, course, *, lesson=None, question='', max_interactions=8):
        assert_skill_allowed(user, 'learning')
        from core.lms_interaction_api import pulsar_project_context
        from core.lms_models import CourseEnrollment, LearningInteraction

        enrollment = CourseEnrollment.objects.filter(
            user=user,
            course=course,
            status__in=[
                CourseEnrollment.Status.ACTIVE,
                CourseEnrollment.Status.PAUSED,
                CourseEnrollment.Status.COMPLETED,
            ],
        ).first()
        if not enrollment:
            raise PulsarPermissionError('course_enrollment_required')

        blocks = [
            f'Course: {course.title}',
            f'Course summary: {str(course.summary or course.description or "")[:3000]}',
            f'Learner progress: {enrollment.progress_percent}%',
        ]
        sources = [{
            'id': str(course.pk),
            'title': course.title,
            'kind': 'course',
            'href': f'/workspace/learning/courses/{course.pk}',
        }]

        if lesson is not None:
            if lesson.module.course_id != course.pk:
                raise PulsarPermissionError('lesson_course_mismatch')
            lesson_text = strip_tags(lesson.body or '').strip()[:12000]
            blocks.append(
                f'Lesson: {lesson.title}\nLesson summary: {str(lesson.summary or "")[:1600]}'
                + (f'\nLesson material:\n{lesson_text}' if lesson_text else '')
            )
            sources.append({
                'id': str(lesson.pk),
                'title': lesson.title,
                'kind': 'lesson',
                'href': f'/workspace/learning/courses/{course.pk}',
            })

        interactions = (
            LearningInteraction.objects
            .filter(user=user, enrollment=enrollment)
            .select_related('lesson')
            .order_by('-updated_at')[:max_interactions]
        )
        rows = []
        for item in interactions:
            if item.body or item.quote:
                label = item.lesson.title if item.lesson_id else course.title
                rows.append(
                    f'- {item.kind} @ {label}: {(item.body or item.quote).strip()[:900]}'
                )
        if rows:
            blocks.append('Learner notes/highlights/reminders:\n' + '\n'.join(rows))

        project_text, project_sources = pulsar_project_context(user, course)
        if project_text:
            blocks.append('User-approved project context:\n' + project_text)
            sources.extend(project_sources)

        return ContextPackage(
            text='\n'.join(value for value in blocks if value),
            sources=sources,
            metadata={
                'profile': snapshot(user),
                'course_id': course.pk,
                'lesson_id': lesson.pk if lesson else None,
                'project_source_count': len(project_sources),
                'question_terms': sorted(_terms(question))[:20],
            },
        )
