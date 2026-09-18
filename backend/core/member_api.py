from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import effective_modules, module_access
from .layer_models import CommunityProfile, ModuleGrant
from .lms_models import CourseEnrollment
from .models import (
    Comment,
    LabProgress,
    ProjectMembership,
    ReaderSavedItem,
    ResearchProject,
    SupportTicket,
    TopicProgress,
)
from .topic_progress import progress_json


MAX_RECENT = 12
PATH_KEY_PREFIX = 'path-'


def _iso(value):
    return value.isoformat() if value else None


def _saved_json(item):
    return {
        'relation': item.relation,
        'kind': item.kind,
        'item_key': item.item_key,
        'url': item.url,
        'title': item.title,
        'summary': item.summary,
        'meta': item.meta,
        'saved_at': _iso(item.created_at),
    }


def _path_json(progress):
    state = progress.state if isinstance(progress.state, dict) else {}
    done = [step for step in state.get('done', []) if isinstance(step, str)]
    total = state.get('total')
    total = total if isinstance(total, int) and total > 0 else len(done)
    percent = 0 if total <= 0 else min(100, round((len(done) / total) * 100, 1))
    return {
        'item_key': progress.lab_key,
        'title': state.get('title') or progress.lab_key.replace('-', ' ').title(),
        'url': state.get('url') or f'/{progress.lab_key}.html',
        'done_count': len(done),
        'total': total,
        'progress_percent': percent,
        'completed': bool(progress.completed),
        'updated_at': _iso(progress.updated_at),
    }


def _comment_json(comment):
    return {
        'id': comment.pk,
        'content_key': comment.content_key,
        'parent_id': comment.parent_id,
        'body': comment.body,
        'status': comment.status,
        'created_at': _iso(comment.created_at),
        'updated_at': _iso(comment.updated_at),
    }


def _enrollment_json(enrollment):
    certificate = None
    try:
        certificate_row = enrollment.certificate
    except Exception:
        certificate_row = None
    if certificate_row:
        certificate = {
            'code': str(certificate_row.code),
            'issued_at': _iso(certificate_row.issued_at),
            'valid': certificate_row.revoked_at is None,
        }
    return {
        'id': enrollment.pk,
        'course_id': enrollment.course_id,
        'course_title': enrollment.course.title,
        'course_summary': enrollment.course.summary,
        'status': enrollment.status,
        'access_source': enrollment.access_source,
        'progress_percent': str(enrollment.progress_percent),
        'enrolled_at': _iso(enrollment.enrolled_at),
        'completed_at': _iso(enrollment.completed_at),
        'updated_at': _iso(enrollment.updated_at),
        'certificate': certificate,
    }


def _project_json(project, user):
    membership = ProjectMembership.objects.filter(project=project, user=user).first()
    profile = getattr(project, 'platform_profile', None)
    return {
        'id': project.pk,
        'title': project.title,
        'description': project.description,
        'role': 'owner' if project.owner_id == user.pk else (membership.role if membership else 'viewer'),
        'status': getattr(profile, 'status', ''),
        'category': getattr(profile, 'category', ''),
        'visibility': getattr(profile, 'visibility', ''),
        'deadline': profile.deadline.isoformat() if profile and profile.deadline else None,
        'secure_data_room': bool(getattr(profile, 'secure_data_room', False)),
        'updated_at': _iso(project.updated_at),
    }


def _recent_activity(user, comments, enrollments, projects, topic_progress, *, lms_access, research_access):
    """Member-facing history is personal product activity, never audit/security logs."""
    events = []
    for item in comments[:MAX_RECENT]:
        events.append({
            '_at': item.created_at,
            'kind': 'comment',
            'title': 'Discussion comment',
            'meta': item.content_key.replace('-', ' ').title(),
            'href': f'/topic.html?slug={item.content_key}#talk',
        })
    for item in topic_progress[:MAX_RECENT]:
        p = progress_json(item.topic, item)
        events.append({
            '_at': item.updated_at,
            'kind': 'topic',
            'title': item.topic.title,
            'meta': f"{p['done_count']} of {p['total']} topic activities",
            'href': p['url'],
        })
    if lms_access:
        for item in enrollments[:MAX_RECENT]:
            events.append({
                '_at': item.updated_at,
                'kind': 'learning',
                'title': item.course.title,
                'meta': f'{item.progress_percent}% complete',
                'href': f'/workspace/learning/courses/{item.course_id}',
            })
    if research_access:
        for item in projects[:MAX_RECENT]:
            events.append({
                '_at': item.updated_at,
                'kind': 'research',
                'title': item.title,
                'meta': 'Research project',
                'href': f'/workspace/research/projects/{item.pk}',
            })
    events.sort(key=lambda event: event['_at'], reverse=True)
    return [{
        'kind': event['kind'],
        'title': event['title'],
        'meta': event['meta'],
        'href': event['href'],
        'created_at': _iso(event['_at']),
    } for event in events[:MAX_RECENT]]


@require_http_methods(['GET'])
def member_dashboard(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    if not module_access(request.user, ModuleGrant.Module.DASHBOARD):
        return JsonResponse({'ok': False, 'error': 'dashboard_access_required'}, status=403)

    user = request.user
    profile, _ = CommunityProfile.objects.get_or_create(user=user)
    access = effective_modules(user)
    lms_access = bool(access.get(ModuleGrant.Module.LMS, {}).get('enabled'))
    research_access = bool(access.get(ModuleGrant.Module.RESEARCH, {}).get('enabled'))

    saved_qs = ReaderSavedItem.objects.filter(user=user, relation=ReaderSavedItem.Relation.SAVED)
    following_qs = ReaderSavedItem.objects.filter(user=user, relation=ReaderSavedItem.Relation.FOLLOWING)
    path_qs = LabProgress.objects.filter(user=user, lab_key__startswith=PATH_KEY_PREFIX).order_by('-updated_at')
    comments_qs = Comment.objects.filter(author=user).order_by('-updated_at')
    topic_qs = TopicProgress.objects.filter(user=user).select_related('topic').order_by('-updated_at')

    if lms_access:
        enrollments = CourseEnrollment.objects.filter(user=user).select_related('course').order_by('-updated_at')
        active_enrollments = enrollments.filter(
            status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.PAUSED]
        )
        completed_enrollments = enrollments.filter(status=CourseEnrollment.Status.COMPLETED)
    else:
        enrollments = CourseEnrollment.objects.none()
        active_enrollments = CourseEnrollment.objects.none()
        completed_enrollments = CourseEnrollment.objects.none()

    if research_access:
        projects = ResearchProject.objects.filter(
            Q(owner=user) | Q(memberships__user=user), archived=False
        ).select_related('platform_profile').distinct().order_by('-updated_at')
    else:
        projects = ResearchProject.objects.none()

    next_actions = []
    for progress in path_qs.filter(completed=False)[:3]:
        item = _path_json(progress)
        next_actions.append({
            'kind': 'path', 'title': item['title'],
            'meta': f"{item['progress_percent']}% complete", 'href': item['url'],
        })
    if lms_access:
        for enrollment in active_enrollments[:4]:
            next_actions.append({
                'kind': 'learning', 'title': enrollment.course.title,
                'meta': f'{enrollment.progress_percent}% complete',
                'href': f'/workspace/learning/courses/{enrollment.course_id}',
            })
    if research_access:
        for project in projects[:4]:
            next_actions.append({
                'kind': 'research', 'title': project.title,
                'meta': getattr(getattr(project, 'platform_profile', None), 'status', '') or 'Project',
                'href': f'/workspace/research/projects/{project.pk}',
            })

    topic_items = [progress_json(item.topic, item) for item in topic_qs[:MAX_RECENT]]
    activity = _recent_activity(
        user, comments_qs, enrollments, projects, topic_qs,
        lms_access=lms_access, research_access=research_access,
    )

    return JsonResponse({
        'ok': True,
        'member': {
            'id': user.pk,
            'email': user.email,
            'name': user.get_full_name() or user.get_username() or user.email,
            'community_role': profile.role,
            'community_status': profile.status,
            'access': access,
        },
        'library': {
            'saved_count': saved_qs.count(),
            'following_count': following_qs.count(),
            'recent_saved': [_saved_json(item) for item in saved_qs.order_by('-updated_at')[:MAX_RECENT]],
            'following': [_saved_json(item) for item in following_qs.order_by('-updated_at')[:MAX_RECENT]],
        },
        'public_paths': {
            'total': path_qs.count(),
            'completed': path_qs.filter(completed=True).count(),
            'in_progress': path_qs.filter(completed=False).count(),
            'items': [_path_json(item) for item in path_qs[:MAX_RECENT]],
        },
        'topic_progress': {
            'total': topic_qs.count(),
            'completed': sum(1 for item in topic_items if item['completed']),
            'items': topic_items,
        },
        'discussions': {
            'total': comments_qs.count(),
            'pending': comments_qs.filter(status=Comment.Status.PENDING).count(),
            'published': comments_qs.filter(status=Comment.Status.PUBLISHED).count(),
            'recent': [_comment_json(item) for item in comments_qs[:MAX_RECENT]],
        },
        'learning': {
            'access': lms_access,
            'active': active_enrollments.count() if lms_access else 0,
            'completed': completed_enrollments.count() if lms_access else 0,
            'enrollments': [_enrollment_json(item) for item in enrollments[:MAX_RECENT]] if lms_access else [],
        },
        'research': {
            'access': research_access,
            'projects': projects.count() if research_access else 0,
            'recent': [_project_json(item, user) for item in projects[:MAX_RECENT]] if research_access else [],
        },
        'support': {
            'open': SupportTicket.objects.filter(
                user=user,
                status__in=[
                    SupportTicket.Status.OPEN,
                    SupportTicket.Status.WAITING_MEMBER,
                    SupportTicket.Status.WAITING_TEAM,
                ],
            ).count(),
        },
        'next_actions': next_actions[:8],
        'activity': activity,
    })
