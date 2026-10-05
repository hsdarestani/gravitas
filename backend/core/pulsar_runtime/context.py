import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from django.db.models import Q
from django.utils.html import strip_tags

from .errors import PulsarPermissionError
from .profiles import assert_skill_allowed, snapshot


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


class PulsarContextEngine:
    """Build just-in-time context while live ACLs remain authoritative."""

    def workspace(self, user, question, *, project_id=None, skill='research', max_resources=8):
        from core.models import KnowledgeResource, ResearchProject
        from core.operating_models import OperatingTask, WorkStatus
        from core.platform_access import can_view

        assert_skill_allowed(user, skill)
        profile = snapshot(user)
        terms = _terms(question)
        blocks = []
        sources = []

        if project_id not in (None, ''):
            try:
                project_id = int(project_id)
            except (TypeError, ValueError):
                raise PulsarPermissionError('invalid_project_id')
            project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
            if not project or not can_view(user, project):
                raise PulsarPermissionError('project_access_required')

            blocks.append(
                f'Project: {project.title}\nDescription: {str(project.description or "")[:2200]}'
            )
            sources.append({
                'id': str(project.pk),
                'title': project.title,
                'kind': 'project',
                'href': f'/workspace/research/projects/{project.pk}',
            })

            candidates = (
                KnowledgeResource.objects
                .filter(project=project)
                .select_related('project', 'workspace')
                .order_by('-updated_at')[:120]
            )
            ranked = []
            for resource in candidates:
                if not can_view(user, resource):
                    continue
                text = _resource_text(resource)
                haystack = f'{resource.title}\n{text}'.lower()
                score = sum(3 if term in resource.title.lower() else 1 for term in terms if term in haystack)
                if not terms:
                    score = 1
                if score:
                    ranked.append((score, resource, text))
            ranked.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp()))
            for _, resource, text in ranked[:max_resources]:
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
        else:
            candidates = (
                KnowledgeResource.objects
                .filter(
                    Q(owner=user)
                    | Q(workspace__owner=user)
                    | Q(workspace__memberships__user=user),
                    kind=KnowledgeResource.Kind.NOTE,
                )
                .distinct()
                .order_by('-updated_at')[:250]
            )
            ranked = []
            for resource in candidates:
                if not can_view(user, resource):
                    continue
                text = _resource_text(resource)
                haystack = f'{resource.title}\n{text}'.lower()
                score = sum(3 if term in resource.title.lower() else 1 for term in terms if term in haystack)
                if score:
                    ranked.append((score, resource, text))
            ranked.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp()))
            for _, resource, text in ranked[:max_resources]:
                blocks.append(f'Workspace note: {resource.title}\n{text[:2200]}')
                sources.append({
                    'id': str(resource.pk),
                    'title': resource.title,
                    'kind': 'workspace_note',
                    'href': f'/workspace/page/{resource.pk}',
                })

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
