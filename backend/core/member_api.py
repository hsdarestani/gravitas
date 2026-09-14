from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import effective_modules, module_access
from .layer_models import ActivityEvent, CommunityProfile, ModuleGrant
from .lms_models import CourseEnrollment
from .models import Comment, LabProgress, ProjectMembership, ReaderSavedItem, ResearchProject


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


def _event_json(event):
    return {
        'id': event.pk,
        'layer': event.layer,
        'action': event.action,
        'object_type': event.object_type,
        'object_id': event.object_id,
        'detail': event.detail,
        'created_at': _iso(event.created_at),
    }


@require_http_methods(['GET'])
def member_dashboard(request):
    """Layer 2 account home.

    This endpoint intentionally aggregates references from the other layers
    instead of copying their records. A member sees one account-level picture
    of saved material, public learning paths, discussions, LMS learning and
    research, while the LMS and project ACLs remain authoritative when they
    follow a link into those layers.
    """
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    if not module_access(request.user, ModuleGrant.Module.DASHBOARD):
        return JsonResponse({'ok': False, 'error': 'dashboard_access_required'}, status=403)

    user = request.user
    profile, _ = CommunityProfile.objects.get_or_create(user=user)
    access = effective_modules(user)

    saved_qs = ReaderSavedItem.objects.filter(user=user, relation=ReaderSavedItem.Relation.SAVED)
    following_qs = ReaderSavedItem.objects.filter(user=user, relation=ReaderSavedItem.Relation.FOLLOWING)
    path_qs = LabProgress.objects.filter(user=user, lab_key__startswith=PATH_KEY_PREFIX).order_by('-updated_at')
    comments_qs = Comment.objects.filter(author=user).order_by('-updated_at')

    enrollments = CourseEnrollment.objects.filter(user=user).select_related('course').order_by('-updated_at')
    active_enrollments = enrollments.filter(
        status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.PAUSED]
    )
    completed_enrollments = enrollments.filter(status=CourseEnrollment.Status.COMPLETED)

    projects = ResearchProject.objects.filter(
        Q(owner=user) | Q(memberships__user=user), archived=False
    ).select_related('platform_profile').distinct().order_by('-updated_at')

    events = ActivityEvent.objects.filter(
        Q(subject_user=user) | Q(actor=user)
    ).order_by('-created_at')[:MAX_RECENT]

    next_actions = []
    for progress in path_qs.filter(completed=False)[:3]:
        item = _path_json(progress)
        next_actions.append({
            'kind': 'path',
            'title': item['title'],
            'meta': f"{item['progress_percent']}% complete",
            'href': item['url'],
        })
    for enrollment in active_enrollments[:4]:
        next_actions.append({
            'kind': 'learning',
            'title': enrollment.course.title,
            'meta': f'{enrollment.progress_percent}% complete',
            'href': f'/workspace/learning/courses/{enrollment.course_id}',
        })
    if access.get(ModuleGrant.Module.RESEARCH, {}).get('enabled'):
        for project in projects[:4]:
            next_actions.append({
                'kind': 'research',
                'title': project.title,
                'meta': getattr(getattr(project, 'platform_profile', None), 'status', '') or 'Project',
                'href': f'/workspace/research/projects/{project.pk}',
            })

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
        'discussions': {
            'total': comments_qs.count(),
            'pending': comments_qs.filter(status=Comment.Status.PENDING).count(),
            'published': comments_qs.filter(status=Comment.Status.PUBLISHED).count(),
            'recent': [_comment_json(item) for item in comments_qs[:MAX_RECENT]],
        },
        'learning': {
            'access': bool(access.get(ModuleGrant.Module.LMS, {}).get('enabled')),
            'active': active_enrollments.count(),
            'completed': completed_enrollments.count(),
            'enrollments': [_enrollment_json(item) for item in enrollments[:MAX_RECENT]],
        },
        'research': {
            'access': bool(access.get(ModuleGrant.Module.RESEARCH, {}).get('enabled')),
            'projects': projects.count(),
            'recent': [_project_json(item, user) for item in projects[:MAX_RECENT]],
        },
        'next_actions': next_actions[:8],
        'activity': [_event_json(item) for item in events],
    })
