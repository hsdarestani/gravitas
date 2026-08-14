from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied

from .models import Project, ProjectMember, SectionAccess, TeamMember


def member_for(user):
    if not getattr(user, 'is_authenticated', False):
        return None
    try:
        member = user.hq_member
    except TeamMember.DoesNotExist:
        return None
    return member if member.status == TeamMember.Status.ACTIVE else None


def access_level(user, section):
    if getattr(user, 'is_superuser', False):
        return SectionAccess.Level.MANAGE
    member = member_for(user)
    if not member:
        return SectionAccess.Level.NONE
    row = member.section_access.filter(section=section).only('level').first()
    return row.level if row else SectionAccess.Level.NONE


def has_access(user, section, minimum=SectionAccess.Level.VIEW):
    return access_level(user, section) >= int(minimum)


def hq_access(section=SectionAccess.Section.DASHBOARD, minimum=SectionAccess.Level.VIEW):
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return redirect_to_login(request.get_full_path(), login_url='/admin/login/')
            if not has_access(request.user, section, minimum):
                raise PermissionDenied('You do not have access to this HQ section.')
            request.hq_member = member_for(request.user)
            request.hq_access_level = access_level(request.user, section)
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


def visible_projects(user):
    if getattr(user, 'is_superuser', False) or has_access(user, SectionAccess.Section.PROJECTS, SectionAccess.Level.MANAGE):
        return Project.objects.all()
    member = member_for(user)
    if not member:
        return Project.objects.none()
    project_ids = ProjectMember.objects.filter(member=member).values_list('project_id', flat=True)
    owned_ids = Project.objects.filter(owner=member).values_list('id', flat=True)
    return Project.objects.filter(models_q(project_ids, owned_ids)).distinct()


def models_q(project_ids, owned_ids):
    from django.db.models import Q
    return Q(id__in=project_ids) | Q(id__in=owned_ids)


def can_manage_project(user, project):
    if getattr(user, 'is_superuser', False) or has_access(user, SectionAccess.Section.PROJECTS, SectionAccess.Level.MANAGE):
        return True
    member = member_for(user)
    if not member:
        return False
    if project.owner_id == member.id:
        return True
    return ProjectMember.objects.filter(project=project, member=member, can_manage_tasks=True).exists()
