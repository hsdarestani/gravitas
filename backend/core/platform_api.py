import json
from datetime import datetime

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_http_methods

from .models import (
    Collection,
    KnowledgeResource,
    Organization,
    OrganizationMembership,
    ProjectMembership,
    ResearchProject,
    Workspace,
    WorkspaceMembership,
)
from .operating_models import Initiative, OperatingTask
from .platform_access import (
    can_edit,
    can_manage,
    can_view,
    content_type_for,
    effective_role,
    grant_role,
    link_allowed_for_project,
    policy_for,
    resolve_target,
)
from .platform_models import (
    AccessGrant,
    AccessRequest,
    ContentWorkItem,
    EntityLink,
    MindMap,
    MindMapEdge,
    MindMapNode,
    ObjectPolicy,
    ProjectApplication,
    ProjectAuditEvent,
    ProjectDeliverable,
    ResearchProjectProfile,
    ResearchRequest,
    ResearcherProfile,
    ShareLink,
    WorkspaceProfile,
)
from .workspace_api import provision_personal_workspace


PROJECT_FOLDERS = (
    '01 Client Input',
    '02 Working',
    '03 Datasets',
    '04 Analysis',
    '05 Deliverables',
    '06 Archive',
)


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _json_date(value):
    return value.isoformat() if value else None


def _list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(',') if item.strip()]
    return []


def _parse_date(value):
    value = str(value or '').strip()
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], '%Y-%m-%d').date()
    except ValueError:
        raise ValueError('invalid_date')


def _parse_datetime(value):
    value = str(value or '').strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('invalid_datetime')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _unique_slug(model, base, *, field='slug', max_length=180):
    root = slugify(base)[:max_length - 10] or 'item'
    candidate = root
    index = 2
    while model.objects.filter(**{field: candidate}).exists():
        candidate = f'{root}-{index}'[:max_length]
        index += 1
    return candidate


def _ensure_workspace_membership(workspace, user, role='member'):
    membership, _ = WorkspaceMembership.objects.get_or_create(
        workspace=workspace,
        user=user,
        defaults={'role': role},
    )
    return membership


def _organization_for(user):
    membership = OrganizationMembership.objects.filter(user=user).select_related('organization').order_by('id').first()
    if membership:
        return membership.organization, membership.role

    existing_team = Workspace.objects.filter(
        memberships__user=user,
        organization__isnull=False,
    ).select_related('organization').first()
    if existing_team:
        org = existing_team.organization
        membership, _ = OrganizationMembership.objects.get_or_create(
            organization=org,
            user=user,
            defaults={'role': OrganizationMembership.Role.MEMBER},
        )
        return org, membership.role

    org = Organization.objects.create(
        name='Gravitas',
        slug=_unique_slug(Organization, f'gravitas-{user.pk}'),
        created_by=user,
    )
    OrganizationMembership.objects.create(
        organization=org,
        user=user,
        role=OrganizationMembership.Role.OWNER,
    )
    return org, OrganizationMembership.Role.OWNER


@transaction.atomic
def ensure_dual_workspaces(user):
    personal = provision_personal_workspace(user)
    WorkspaceProfile.objects.get_or_create(
        workspace=personal,
        defaults={
            'purpose': WorkspaceProfile.Purpose.PERSONAL,
            'description': 'Private research, notes and files.',
            'nextcloud_root': 'Gravitas/My Files',
        },
    )

    org, org_role = _organization_for(user)
    ws_role = WorkspaceMembership.Role.ADMIN if org_role in {'owner', 'admin'} else WorkspaceMembership.Role.MEMBER

    core = Workspace.objects.filter(
        organization=org,
        operating_processes__isnull=False,
    ).distinct().first()
    if not core:
        core = Workspace.objects.filter(
            organization=org,
            platform_profile__purpose=WorkspaceProfile.Purpose.CORE,
        ).first()
    if not core:
        core = Workspace.objects.create(name='Gravitas Core', kind=Workspace.Kind.TEAM, organization=org)
    _ensure_workspace_membership(core, user, ws_role)
    WorkspaceProfile.objects.update_or_create(
        workspace=core,
        defaults={
            'purpose': WorkspaceProfile.Purpose.CORE,
            'description': 'Internal operations, projects, tasks, content and production.',
            'is_default': True,
            'nextcloud_root': 'Gravitas/Core',
        },
    )

    research = Workspace.objects.filter(
        organization=org,
        platform_profile__purpose=WorkspaceProfile.Purpose.RESEARCH,
    ).exclude(pk=core.pk).first()
    if not research:
        research = Workspace.objects.create(name='Gravitas Research', kind=Workspace.Kind.TEAM, organization=org)
    _ensure_workspace_membership(research, user, ws_role)
    WorkspaceProfile.objects.update_or_create(
        workspace=research,
        defaults={
            'purpose': WorkspaceProfile.Purpose.RESEARCH,
            'description': 'Scientific research, client projects, datasets and community collaboration.',
            'is_default': True,
            'nextcloud_root': 'Gravitas/Research',
        },
    )
    return {'personal': personal, 'core': core, 'research': research}


def _workspace_json(workspace):
    profile = getattr(workspace, 'platform_profile', None)
    return {
        'id': workspace.pk,
        'name': workspace.name,
        'kind': workspace.kind,
        'purpose': profile.purpose if profile else ('personal' if workspace.kind == 'personal' else 'team'),
        'description': profile.description if profile else '',
    }


def _project_profile(project):
    profile, _ = ResearchProjectProfile.objects.get_or_create(
        project=project,
        defaults={
            'category': ResearchProjectProfile.Category.INTERNAL,
            'visibility': ResearchProjectProfile.Visibility.PRIVATE,
            'status': ResearchProjectProfile.Status.ACTIVE,
            'nextcloud_root': f'Gravitas/Projects/GRV-{project.pk:06d}',
        },
    )
    if not profile.nextcloud_root:
        profile.nextcloud_root = f'Gravitas/Projects/GRV-{project.pk:06d}'
        profile.save(update_fields=['nextcloud_root', 'updated_at'])
    return profile


def _project_json(project, user=None, *, include_detail=False):
    profile = _project_profile(project)
    data = {
        'id': project.pk,
        'workspace_id': project.workspace_id,
        'title': project.title,
        'description': project.description,
        'owner': project.owner.first_name or project.owner.email,
        'archived': project.archived,
        'category': profile.category,
        'visibility': profile.visibility,
        'status': profile.status,
        'research_question': profile.research_question,
        'client_name': profile.client_name,
        'requester_name': profile.requester_name,
        'confidentiality': profile.confidentiality,
        'deadline': _json_date(profile.deadline),
        'budget': str(profile.budget) if profile.budget is not None else None,
        'currency': profile.currency,
        'compensation_text': profile.compensation_text,
        'required_skills': profile.required_skills,
        'application_open': profile.application_open,
        'public_slug': profile.public_slug,
        'secure_data_room': profile.secure_data_room,
        'allow_public_links': profile.allow_public_links,
        'allow_downloads': profile.allow_downloads,
        'nextcloud_root': profile.nextcloud_root,
        'updated_at': project.updated_at.isoformat(),
    }
    if user and getattr(user, 'is_authenticated', False):
        data['permissions'] = {
            'role': effective_role(user, project),
            'can_view': can_view(user, project),
            'can_edit': can_edit(user, project),
            'can_manage': can_manage(user, project),
        }
    if include_detail:
        data['counts'] = {
            'resources': project.resources.count(),
            'notes': project.resources.filter(kind='note').count(),
            'files': project.resources.filter(kind='file').count(),
            'datasets': project.resources.filter(kind='dataset').count(),
            'deliverables': project.deliverables.count(),
            'applications': project.applications.count(),
        }
    return data


def _content_json(item):
    return {
        'id': item.pk,
        'workspace_id': item.workspace_id,
        'title': item.title,
        'kind': item.kind,
        'status': item.status,
        'owner_id': item.owner_id,
        'owner': (item.owner.first_name or item.owner.email) if item.owner else None,
        'description': item.description,
        'due_date': _json_date(item.due_date),
        'research_project_id': item.research_project_id,
        'research_project_title': item.research_project.title if item.research_project else None,
        'published_url': item.published_url,
        'metadata': item.metadata,
        'updated_at': item.updated_at.isoformat(),
    }


def _request_json(item):
    return {
        'id': item.pk,
        'workspace_id': item.workspace_id,
        'project_id': item.project_id,
        'project_title': item.project.title if item.project else None,
        'content_work_item_id': item.content_work_item_id,
        'source_task_id': item.source_task_id,
        'title': item.title,
        'brief': item.brief,
        'status': item.status,
        'priority': item.priority,
        'due_date': _json_date(item.due_date),
        'assignee_id': item.assignee_id,
        'assignee': (item.assignee.first_name or item.assignee.email) if item.assignee else None,
        'output_summary': item.output_summary,
        'updated_at': item.updated_at.isoformat(),
    }


def _resource_json(item):
    policy = policy_for(item)
    return {
        'id': item.pk,
        'workspace_id': item.workspace_id,
        'project_id': item.project_id,
        'kind': item.kind,
        'title': item.title,
        'description': item.description,
        'original_name': item.original_name,
        'file_size': item.file_size,
        'has_download': bool(item.storage_path),
        'visibility': policy.visibility if policy else 'workspace',
        'updated_at': item.updated_at.isoformat(),
    }


def _audit(project, user, action, obj=None, **detail):
    if not project:
        return
    ProjectAuditEvent.objects.create(
        project=project,
        actor=user if user and getattr(user, 'is_authenticated', False) else None,
        action=action,
        object_type=obj.__class__.__name__ if obj is not None else '',
        object_id=str(getattr(obj, 'pk', '') or ''),
        detail=detail,
    )


@require_http_methods(['GET'])
def platform_bootstrap(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    core = spaces['core']
    research = spaces['research']
    my_tasks = OperatingTask.objects.filter(owner=request.user).exclude(status__in=['done', 'archived']).select_related('initiative')[:8]
    my_research = ResearchProject.objects.filter(
        Q(owner=request.user) | Q(memberships__user=request.user),
        workspace=research,
        archived=False,
    ).distinct()[:8]
    return JsonResponse({
        'ok': True,
        'workspaces': {key: _workspace_json(value) for key, value in spaces.items()},
        'my_work': {
            'task_count': OperatingTask.objects.filter(owner=request.user).exclude(status__in=['done', 'archived']).count(),
            'research_count': my_research.count(),
            'tasks': [{
                'id': item.pk,
                'title': item.title,
                'status': item.status,
                'priority': item.priority,
                'due_date': _json_date(item.due_date),
                'initiative': item.initiative.title,
            } for item in my_tasks],
            'research': [_project_json(item, request.user) for item in my_research],
        },
        'counts': {
            'core_content': core.content_work_items.exclude(status='archived').count(),
            'core_tasks': core.operating_tasks.exclude(status__in=['done', 'archived']).count(),
            'research_projects': research.projects.filter(archived=False).count(),
            'open_research_requests': ResearchRequest.objects.filter(status__in=['open', 'in_progress', 'review']).filter(Q(workspace=core) | Q(project__workspace=research)).count(),
        },
    })


@require_http_methods(['GET'])
def platform_dashboard(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    purpose = request.GET.get('workspace', 'core').strip().lower()
    workspace = spaces.get(purpose)
    if purpose == 'core':
        tasks = OperatingTask.objects.filter(workspace=workspace).select_related('owner', 'initiative', 'project').exclude(status='archived')[:12]
        initiatives = Initiative.objects.filter(workspace=workspace).select_related('owner', 'key_result', 'process').exclude(status='archived')[:8]
        content = ContentWorkItem.objects.filter(workspace=workspace).select_related('owner', 'research_project')[:20]
        requests = ResearchRequest.objects.filter(Q(workspace=workspace) | Q(content_work_item__workspace=workspace)).select_related('project', 'content_work_item', 'assignee')[:12]
        return JsonResponse({
            'ok': True,
            'workspace': _workspace_json(workspace),
            'counts': {
                'tasks': tasks.count(),
                'initiatives': initiatives.count(),
                'content': ContentWorkItem.objects.filter(workspace=workspace).exclude(status='archived').count(),
                'research_waiting': requests.exclude(status__in=['done', 'cancelled']).count(),
            },
            'tasks': [{
                'id': item.pk,
                'title': item.title,
                'owner': item.owner.first_name or item.owner.email,
                'status': item.status,
                'priority': item.priority,
                'due_date': _json_date(item.due_date),
                'initiative': item.initiative.title,
                'project_id': item.project_id,
            } for item in tasks],
            'initiatives': [{
                'id': item.pk,
                'title': item.title,
                'status': item.status,
                'stage': item.stage,
                'priority': item.priority,
                'owner': item.owner.first_name or item.owner.email,
            } for item in initiatives],
            'content': [_content_json(item) for item in content],
            'research_requests': [_request_json(item) for item in requests],
        })

    projects = ResearchProject.objects.filter(workspace=workspace, archived=False).select_related('owner', 'workspace')
    visible_projects = [item for item in projects if can_view(request.user, item)]
    requests = ResearchRequest.objects.filter(project__workspace=workspace).select_related('project', 'assignee')[:12]
    recent_resources = KnowledgeResource.objects.filter(workspace=workspace).select_related('project', 'owner')[:40]
    recent_resources = [item for item in recent_resources if can_view(request.user, item)][:12]
    return JsonResponse({
        'ok': True,
        'workspace': _workspace_json(workspace),
        'counts': {
            'projects': len(visible_projects),
            'client_projects': sum(1 for item in visible_projects if _project_profile(item).category == 'client'),
            'community_projects': sum(1 for item in visible_projects if _project_profile(item).category == 'community'),
            'research_requests': requests.exclude(status__in=['done', 'cancelled']).count(),
        },
        'projects': [_project_json(item, request.user) for item in visible_projects[:12]],
        'research_requests': [_request_json(item) for item in requests],
        'recent_resources': [_resource_json(item) for item in recent_resources],
        'mindmaps': [{
            'id': item.pk,
            'title': item.title,
            'project_id': item.project_id,
            'updated_at': item.updated_at.isoformat(),
        } for item in MindMap.objects.filter(workspace=workspace, owner=request.user)[:8]],
    })


@require_http_methods(['GET', 'POST'])
def platform_projects(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    research = spaces['research']
    if request.method == 'GET':
        qs = ResearchProject.objects.filter(workspace=research, archived=False).select_related('owner', 'workspace')
        category = request.GET.get('category', '').strip()
        if category:
            qs = qs.filter(platform_profile__category=category)
        projects = [item for item in qs if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'projects': [_project_json(item, request.user) for item in projects]})

    data = _body(request)
    title = str(data.get('title', '')).strip()[:220]
    if not title:
        return _error('title_required')
    category = str(data.get('category', 'internal')).strip()
    if category not in ResearchProjectProfile.Category.values:
        return _error('invalid_category')
    visibility = str(data.get('visibility', 'private')).strip()
    if visibility not in ResearchProjectProfile.Visibility.values:
        return _error('invalid_visibility')
    try:
        deadline = _parse_date(data.get('deadline'))
    except ValueError as exc:
        return _error(str(exc))
    with transaction.atomic():
        project = ResearchProject.objects.create(
            workspace=research,
            owner=request.user,
            title=title,
            description=str(data.get('description', '')).strip(),
        )
        ProjectMembership.objects.create(project=project, user=request.user, role=ProjectMembership.Role.OWNER)
        public_slug = None
        if visibility in {'community', 'public'} or bool(data.get('application_open')):
            public_slug = _unique_slug(ResearchProjectProfile, title, field='public_slug', max_length=220)
        profile = ResearchProjectProfile.objects.create(
            project=project,
            category=category,
            visibility=visibility,
            status=str(data.get('status', 'active')) if str(data.get('status', 'active')) in ResearchProjectProfile.Status.values else 'active',
            research_question=str(data.get('research_question', '')).strip(),
            client_name=str(data.get('client_name', '')).strip()[:220],
            requester_name=str(data.get('requester_name', '')).strip()[:220],
            requester_email=str(data.get('requester_email', '')).strip()[:254],
            confidentiality=str(data.get('confidentiality', 'internal')) if str(data.get('confidentiality', 'internal')) in ResearchProjectProfile.Confidentiality.values else 'internal',
            deadline=deadline,
            compensation_text=str(data.get('compensation_text', '')).strip()[:240],
            required_skills=_list(data.get('required_skills')),
            application_open=bool(data.get('application_open')),
            public_slug=public_slug,
            nextcloud_root=f'Gravitas/Projects/GRV-{project.pk:06d}',
            secure_data_room=bool(data.get('secure_data_room')),
            allow_public_links=bool(data.get('allow_public_links')),
            allow_downloads=data.get('allow_downloads') is not False,
        )
        if profile.secure_data_room:
            profile.allow_public_links = bool(data.get('allow_public_links', False))
            profile.save(update_fields=['allow_public_links', 'updated_at'])
        ObjectPolicy.objects.create(
            content_type=content_type_for(project),
            object_id=project.pk,
            visibility=ObjectPolicy.Visibility.PUBLIC if visibility == 'public' else ObjectPolicy.Visibility.WORKSPACE,
            allow_download=profile.allow_downloads,
            allow_reshare=profile.allow_public_links,
            created_by=request.user,
        )
        if category in {'client', 'community'} or profile.secure_data_room:
            for folder_name in PROJECT_FOLDERS:
                Collection.objects.get_or_create(
                    workspace=research,
                    project=project,
                    parent=None,
                    name=folder_name,
                    defaults={'created_by': request.user},
                )
        _audit(project, request.user, 'project_created', project, category=category, visibility=visibility)
    return JsonResponse({'ok': True, 'project': _project_json(project, request.user, include_detail=True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_project_detail(request, project_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.select_related('workspace', 'owner').filter(pk=project_id).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)
    profile = _project_profile(project)
    if request.method == 'GET':
        resources = [item for item in project.resources.select_related('owner', 'project') if can_view(request.user, item)]
        deliverables = [item for item in project.deliverables.select_related('resource', 'created_by') if can_view(request.user, item)]
        data = {
            'ok': True,
            'project': _project_json(project, request.user, include_detail=True),
            'resources': [_resource_json(item) for item in resources[:300]],
            'folders': [{
                'id': item.pk,
                'name': item.name,
                'parent_id': item.parent_id,
            } for item in project.collections.all()],
            'deliverables': [{
                'id': item.pk,
                'title': item.title,
                'description': item.description,
                'status': item.status,
                'resource_id': item.resource_id,
                'client_visible': item.client_visible,
            } for item in deliverables],
            'mindmaps': [{
                'id': item.pk,
                'title': item.title,
                'updated_at': item.updated_at.isoformat(),
            } for item in project.mind_maps.all() if can_view(request.user, item)],
            'members': [{
                'user_id': item.user_id,
                'name': item.user.first_name or item.user.email,
                'email': item.user.email if can_manage(request.user, project) else '',
                'role': item.role,
            } for item in project.memberships.select_related('user')],
        }
        if can_manage(request.user, project):
            data['applications'] = [{
                'id': item.pk,
                'name': item.applicant_name,
                'email': item.applicant_email,
                'message': item.message,
                'skills': item.skills,
                'status': item.status,
                'created_at': item.created_at.isoformat(),
            } for item in project.applications.all()[:100]]
            data['audit'] = [{
                'id': item.pk,
                'action': item.action,
                'actor': (item.actor.first_name or item.actor.email) if item.actor else 'System',
                'object_type': item.object_type,
                'object_id': item.object_id,
                'detail': item.detail,
                'created_at': item.created_at.isoformat(),
            } for item in project.audit_events.select_related('actor')[:100]]
        return JsonResponse(data)

    if not can_manage(request.user, project):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        project.archived = True
        project.save(update_fields=['archived', 'updated_at'])
        _audit(project, request.user, 'project_archived', project)
        return JsonResponse({'ok': True})

    data = _body(request)
    if 'title' in data:
        project.title = str(data['title']).strip()[:220]
        if not project.title:
            return _error('title_required')
    if 'description' in data:
        project.description = str(data['description']).strip()
    for field, values in (
        ('category', ResearchProjectProfile.Category.values),
        ('visibility', ResearchProjectProfile.Visibility.values),
        ('status', ResearchProjectProfile.Status.values),
        ('confidentiality', ResearchProjectProfile.Confidentiality.values),
    ):
        if field in data:
            value = str(data[field]).strip()
            if value not in values:
                return _error(f'invalid_{field}')
            setattr(profile, field, value)
    for field in ('research_question', 'client_name', 'requester_name', 'requester_email', 'compensation_text'):
        if field in data:
            setattr(profile, field, str(data[field]).strip())
    if 'required_skills' in data:
        profile.required_skills = _list(data['required_skills'])
    try:
        if 'deadline' in data:
            profile.deadline = _parse_date(data['deadline'])
        if 'external_access_expires_at' in data:
            profile.external_access_expires_at = _parse_datetime(data['external_access_expires_at'])
    except ValueError as exc:
        return _error(str(exc))
    for field in ('application_open', 'secure_data_room', 'allow_public_links', 'allow_downloads'):
        if field in data:
            setattr(profile, field, bool(data[field]))
    if profile.secure_data_room and 'allow_public_links' not in data:
        profile.allow_public_links = False
    if (profile.visibility in {'community', 'public'} or profile.application_open) and not profile.public_slug:
        profile.public_slug = _unique_slug(ResearchProjectProfile, project.title, field='public_slug', max_length=220)
    project.save()
    profile.save()
    policy = policy_for(project, create=True, created_by=request.user)
    policy.visibility = ObjectPolicy.Visibility.PUBLIC if profile.visibility == 'public' else ObjectPolicy.Visibility.WORKSPACE
    policy.allow_download = profile.allow_downloads
    policy.allow_reshare = profile.allow_public_links
    policy.save()
    _audit(project, request.user, 'project_updated', project)
    return JsonResponse({'ok': True, 'project': _project_json(project, request.user, include_detail=True)})


@require_http_methods(['GET', 'POST'])
def content_work_items(request):
    if response := _auth(request):
        return response
    core = ensure_dual_workspaces(request.user)['core']
    if request.method == 'GET':
        qs = ContentWorkItem.objects.filter(workspace=core).select_related('owner', 'research_project')
        if request.GET.get('status'):
            qs = qs.filter(status=request.GET['status'])
        return JsonResponse({'ok': True, 'items': [_content_json(item) for item in qs[:300]]})
    data = _body(request)
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    kind = str(data.get('kind', 'video'))
    if kind not in ContentWorkItem.Kind.values:
        return _error('invalid_kind')
    try:
        due_date = _parse_date(data.get('due_date'))
    except ValueError as exc:
        return _error(str(exc))
    item = ContentWorkItem.objects.create(
        workspace=core,
        title=title,
        kind=kind,
        status=str(data.get('status', 'idea')) if str(data.get('status', 'idea')) in ContentWorkItem.Status.values else 'idea',
        owner=request.user,
        description=str(data.get('description', '')).strip(),
        due_date=due_date,
        created_by=request.user,
        metadata=data.get('metadata') if isinstance(data.get('metadata'), dict) else {},
    )
    policy_for(item, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.WORKSPACE)
    return JsonResponse({'ok': True, 'item': _content_json(item)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE', 'POST'])
def content_work_detail(request, item_id):
    if response := _auth(request):
        return response
    item = ContentWorkItem.objects.select_related('workspace', 'owner', 'research_project').filter(pk=item_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _content_json(item), 'permissions': {'role': effective_role(request.user, item), 'can_edit': can_edit(request.user, item), 'can_manage': can_manage(request.user, item)}})
    if not can_edit(request.user, item):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        item.status = ContentWorkItem.Status.ARCHIVED
        item.save(update_fields=['status', 'updated_at'])
        return JsonResponse({'ok': True})
    data = _body(request)
    if request.method == 'POST' and data.get('action') == 'request_research':
        spaces = ensure_dual_workspaces(request.user)
        with transaction.atomic():
            project = item.research_project
            if not project:
                project = ResearchProject.objects.create(
                    workspace=spaces['research'],
                    owner=request.user,
                    title=str(data.get('project_title') or item.title)[:220],
                    description=str(data.get('brief') or item.description).strip(),
                )
                ProjectMembership.objects.create(project=project, user=request.user, role=ProjectMembership.Role.OWNER)
                profile = ResearchProjectProfile.objects.create(
                    project=project,
                    category=ResearchProjectProfile.Category.INTERNAL,
                    visibility=ResearchProjectProfile.Visibility.PRIVATE,
                    status=ResearchProjectProfile.Status.ACTIVE,
                    research_question=str(data.get('research_question', '')).strip(),
                    nextcloud_root=f'Gravitas/Projects/GRV-{project.pk:06d}',
                )
                policy_for(project, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.WORKSPACE)
                item.research_project = project
                item.status = ContentWorkItem.Status.RESEARCH
                item.save(update_fields=['research_project', 'status', 'updated_at'])
                EntityLink.objects.get_or_create(
                    source_content_type=content_type_for(item),
                    source_object_id=item.pk,
                    target_content_type=content_type_for(project),
                    target_object_id=project.pk,
                    relation='research_for',
                    defaults={'created_by': request.user},
                )
                _audit(project, request.user, 'linked_from_core_content', item, content_title=item.title)
            research_request = ResearchRequest.objects.create(
                workspace=spaces['research'],
                project=project,
                content_work_item=item,
                requested_by=request.user,
                title=str(data.get('title') or f'Research for {item.title}')[:240],
                brief=str(data.get('brief') or item.description).strip(),
                priority=str(data.get('priority', 'p2'))[:8],
                due_date=_parse_date(data.get('due_date')),
            )
            policy_for(research_request, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.PROJECT)
        return JsonResponse({'ok': True, 'item': _content_json(item), 'project': _project_json(project, request.user), 'research_request': _request_json(research_request)}, status=201)
    if request.method == 'POST':
        return _error('invalid_action')
    if 'title' in data:
        item.title = str(data['title']).strip()[:240]
    if 'description' in data:
        item.description = str(data['description']).strip()
    if 'status' in data and data['status'] in ContentWorkItem.Status.values:
        item.status = data['status']
    if 'kind' in data and data['kind'] in ContentWorkItem.Kind.values:
        item.kind = data['kind']
    try:
        if 'due_date' in data:
            item.due_date = _parse_date(data['due_date'])
    except ValueError as exc:
        return _error(str(exc))
    if 'published_url' in data:
        item.published_url = str(data['published_url']).strip()[:1000]
    item.save()
    return JsonResponse({'ok': True, 'item': _content_json(item)})


@require_http_methods(['GET', 'POST'])
def research_requests(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    if request.method == 'GET':
        qs = ResearchRequest.objects.filter(Q(workspace__in=spaces.values()) | Q(project__workspace=spaces['research'])).select_related('project', 'assignee', 'content_work_item').distinct()
        if request.GET.get('status'):
            qs = qs.filter(status=request.GET['status'])
        items = [item for item in qs if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'items': [_request_json(item) for item in items[:300]]})
    data = _body(request)
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    project = None
    if data.get('project_id'):
        project = ResearchProject.objects.filter(pk=data['project_id']).first()
        if not project or not can_edit(request.user, project):
            return _error('permission_denied', 403)
    item = ResearchRequest.objects.create(
        workspace=project.workspace if project else spaces['research'],
        project=project,
        requested_by=request.user,
        title=title,
        brief=str(data.get('brief', '')).strip(),
        priority=str(data.get('priority', 'p2'))[:8],
        due_date=_parse_date(data.get('due_date')),
    )
    policy_for(item, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.PROJECT if project else ObjectPolicy.Visibility.WORKSPACE)
    _audit(project, request.user, 'research_request_created', item)
    return JsonResponse({'ok': True, 'item': _request_json(item)}, status=201)


@require_http_methods(['GET', 'PATCH'])
def research_request_detail(request, request_id):
    if response := _auth(request):
        return response
    item = ResearchRequest.objects.select_related('project', 'assignee', 'content_work_item').filter(pk=request_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _request_json(item), 'permissions': {'role': effective_role(request.user, item), 'can_edit': can_edit(request.user, item)}})
    if not can_edit(request.user, item):
        return _error('permission_denied', 403)
    data = _body(request)
    if 'status' in data and data['status'] in ResearchRequest.Status.values:
        item.status = data['status']
    if 'brief' in data:
        item.brief = str(data['brief']).strip()
    if 'output_summary' in data:
        item.output_summary = str(data['output_summary']).strip()
    if 'priority' in data:
        item.priority = str(data['priority'])[:8]
    if 'assignee_id' in data:
        user = get_user_model().objects.filter(pk=data['assignee_id']).first() if data['assignee_id'] else None
        if user and item.project and not can_view(user, item.project):
            grant_role(item.project, user, 'edit', granted_by=request.user)
        item.assignee = user
    try:
        if 'due_date' in data:
            item.due_date = _parse_date(data['due_date'])
    except ValueError as exc:
        return _error(str(exc))
    item.save()
    _audit(item.project, request.user, 'research_request_updated', item, status=item.status)
    return JsonResponse({'ok': True, 'item': _request_json(item)})


@require_http_methods(['GET', 'POST'])
def project_deliverables(request, project_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.filter(pk=project_id).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)
    if request.method == 'GET':
        items = [item for item in project.deliverables.select_related('resource') if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'items': [{'id': item.pk, 'title': item.title, 'description': item.description, 'status': item.status, 'resource_id': item.resource_id, 'client_visible': item.client_visible} for item in items]})
    if not can_edit(request.user, project):
        return _error('permission_denied', 403)
    data = _body(request)
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    resource = None
    if data.get('resource_id'):
        resource = KnowledgeResource.objects.filter(pk=data['resource_id'], project=project).first()
        if not resource or not can_view(request.user, resource):
            return _error('invalid_resource')
    item = ProjectDeliverable.objects.create(
        project=project,
        resource=resource,
        title=title,
        description=str(data.get('description', '')).strip(),
        status=str(data.get('status', 'draft')) if str(data.get('status', 'draft')) in ProjectDeliverable.Status.values else 'draft',
        client_visible=bool(data.get('client_visible')),
        created_by=request.user,
    )
    policy_for(item, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.PROJECT)
    _audit(project, request.user, 'deliverable_created', item)
    return JsonResponse({'ok': True, 'item': {'id': item.pk, 'title': item.title, 'status': item.status, 'resource_id': item.resource_id, 'client_visible': item.client_visible}}, status=201)


@require_http_methods(['GET', 'POST', 'DELETE'])
def sharing(request):
    if response := _auth(request):
        return response
    target_type = request.GET.get('type') if request.method == 'GET' else None
    object_id = request.GET.get('id') if request.method == 'GET' else None
    data = _body(request) if request.method != 'GET' else {}
    target_type = target_type or data.get('type')
    object_id = object_id or data.get('id')
    obj = resolve_target(target_type, object_id)
    if not obj or not can_view(request.user, obj):
        return _error('not_found', 404)
    ct = content_type_for(obj)
    if request.method == 'GET':
        policy = policy_for(obj, create=True, created_by=request.user)
        result = {
            'ok': True,
            'type': target_type,
            'id': obj.pk,
            'policy': {'visibility': policy.visibility, 'allow_download': policy.allow_download, 'allow_reshare': policy.allow_reshare},
            'permissions': {'role': effective_role(request.user, obj), 'can_manage': can_manage(request.user, obj)},
        }
        if can_manage(request.user, obj):
            result['grants'] = [{
                'id': grant.pk,
                'user_id': grant.user_id,
                'name': grant.user.first_name or grant.user.email,
                'email': grant.user.email,
                'role': grant.role,
                'expires_at': _json_date(grant.expires_at),
            } for grant in AccessGrant.objects.filter(content_type=ct, object_id=obj.pk).select_related('user')]
            result['links'] = [{
                'id': link.pk,
                'token': str(link.token),
                'role': link.role,
                'allow_download': link.allow_download,
                'active': link.active,
                'expires_at': _json_date(link.expires_at),
                'url': f'/shared/{link.token}',
            } for link in ShareLink.objects.filter(content_type=ct, object_id=obj.pk)]
        return JsonResponse(result)

    if not can_manage(request.user, obj):
        return _error('permission_denied', 403)
    action = str(data.get('action', '')).strip()
    if request.method == 'DELETE':
        action = action or 'revoke'
    if action == 'policy':
        visibility = str(data.get('visibility', 'workspace'))
        if visibility not in ObjectPolicy.Visibility.values:
            return _error('invalid_visibility')
        if visibility in {'link', 'public'} and not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        policy = policy_for(obj, create=True, created_by=request.user)
        policy.visibility = visibility
        if 'allow_download' in data:
            policy.allow_download = bool(data['allow_download'])
        if 'allow_reshare' in data:
            policy.allow_reshare = bool(data['allow_reshare'])
        policy.save()
        _audit(getattr(obj, 'project', None) or (obj if isinstance(obj, ResearchProject) else None), request.user, 'sharing_policy_updated', obj, visibility=visibility)
        return JsonResponse({'ok': True})
    if action == 'grant':
        email = str(data.get('email', '')).strip().lower()
        role = str(data.get('role', 'view')).strip()
        user = get_user_model().objects.filter(email__iexact=email).first()
        if not user:
            return _error('user_not_found', 404)
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
            grant = grant_role(obj, user, role, granted_by=request.user, expires_at=expires_at)
        except ValueError as exc:
            return _error(str(exc))
        project = obj if isinstance(obj, ResearchProject) else getattr(obj, 'project', None)
        if isinstance(obj, ResearchProject):
            project_role = {'manage': 'owner', 'edit': 'editor', 'comment': 'viewer', 'view': 'viewer'}[role]
            ProjectMembership.objects.update_or_create(project=obj, user=user, defaults={'role': project_role})
        _audit(project, request.user, 'access_granted', obj, user_id=user.pk, role=role)
        return JsonResponse({'ok': True, 'grant': {'id': grant.pk, 'user_id': user.pk, 'email': user.email, 'role': grant.role}}, status=201)
    if action == 'link':
        if not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        role = str(data.get('role', 'view'))
        if role not in {'view', 'comment'}:
            return _error('invalid_link_role')
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
        except ValueError as exc:
            return _error(str(exc))
        link = ShareLink.objects.create(
            content_type=ct,
            object_id=obj.pk,
            role=role,
            allow_download=bool(data.get('allow_download')),
            expires_at=expires_at,
            created_by=request.user,
        )
        policy = policy_for(obj, create=True, created_by=request.user)
        if policy.visibility not in {ObjectPolicy.Visibility.PUBLIC, ObjectPolicy.Visibility.LINK}:
            policy.visibility = ObjectPolicy.Visibility.LINK
            policy.save(update_fields=['visibility', 'updated_at'])
        project = obj if isinstance(obj, ResearchProject) else getattr(obj, 'project', None)
        _audit(project, request.user, 'share_link_created', obj, link_id=link.pk)
        return JsonResponse({'ok': True, 'link': {'id': link.pk, 'token': str(link.token), 'url': f'/shared/{link.token}'}}, status=201)
    if action == 'revoke':
        if data.get('grant_id'):
            AccessGrant.objects.filter(pk=data['grant_id'], content_type=ct, object_id=obj.pk).delete()
        if data.get('link_id'):
            ShareLink.objects.filter(pk=data['link_id'], content_type=ct, object_id=obj.pk).update(active=False)
        return JsonResponse({'ok': True})
    return _error('invalid_action')


@require_http_methods(['GET'])
def shared_with_me(request):
    if response := _auth(request):
        return response
    now = timezone.now()
    grants = AccessGrant.objects.filter(user=request.user).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).select_related('content_type', 'granted_by')
    items = []
    for grant in grants:
        obj = grant.content_object
        if not obj:
            continue
        items.append({
            'type': next((key for key, model in __import__('core.platform_access', fromlist=['TARGET_MODELS']).TARGET_MODELS.items() if isinstance(obj, model)), obj.__class__.__name__.lower()),
            'id': obj.pk,
            'title': getattr(obj, 'title', None) or getattr(obj, 'name', str(obj)),
            'role': grant.role,
            'granted_by': (grant.granted_by.first_name or grant.granted_by.email) if grant.granted_by else None,
            'expires_at': _json_date(grant.expires_at),
        })
    return JsonResponse({'ok': True, 'items': items})


@require_http_methods(['GET', 'POST'])
def community_projects(request):
    if request.method == 'GET':
        profiles = ResearchProjectProfile.objects.filter(
            visibility__in=['community', 'public'],
            application_open=True,
            project__archived=False,
        ).select_related('project', 'project__owner')
        return JsonResponse({'ok': True, 'projects': [{
            'id': profile.project_id,
            'slug': profile.public_slug,
            'title': profile.project.title,
            'description': profile.project.description,
            'research_question': profile.research_question,
            'category': profile.category,
            'deadline': _json_date(profile.deadline),
            'required_skills': profile.required_skills,
            'compensation_text': profile.compensation_text,
            'status': profile.status,
        } for profile in profiles]})
    return _error('method_not_allowed', 405)


@require_http_methods(['GET', 'POST'])
def community_project_detail(request, public_slug):
    profile = ResearchProjectProfile.objects.select_related('project', 'project__owner').filter(
        public_slug=public_slug,
        visibility__in=['community', 'public'],
        project__archived=False,
    ).first()
    if not profile:
        return _error('not_found', 404)
    project = profile.project
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'project': {
            'id': project.pk,
            'slug': profile.public_slug,
            'title': project.title,
            'description': project.description,
            'research_question': profile.research_question,
            'deadline': _json_date(profile.deadline),
            'required_skills': profile.required_skills,
            'compensation_text': profile.compensation_text,
            'application_open': profile.application_open,
        }})
    if not profile.application_open:
        return _error('applications_closed', 409)
    data = _body(request)
    user = request.user if request.user.is_authenticated else None
    name = str(data.get('name') or ((user.first_name or user.email) if user else '')).strip()[:220]
    email = str(data.get('email') or (user.email if user else '')).strip().lower()[:254]
    if not name or not email:
        return _error('name_and_email_required')
    if user and ProjectApplication.objects.filter(project=project, applicant_user=user).exists():
        return _error('already_applied', 409)
    application = ProjectApplication.objects.create(
        project=project,
        applicant_user=user,
        applicant_name=name,
        applicant_email=email,
        message=str(data.get('message', '')).strip(),
        skills=_list(data.get('skills')),
        profile_url=str(data.get('profile_url', '')).strip()[:1000],
    )
    _audit(project, user, 'community_application_submitted', application)
    return JsonResponse({'ok': True, 'application': {'id': application.pk, 'status': application.status}}, status=201)


@require_http_methods(['PATCH'])
def project_application_detail(request, project_id, application_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.filter(pk=project_id).first()
    if not project or not can_manage(request.user, project):
        return _error('permission_denied', 403)
    application = ProjectApplication.objects.select_related('applicant_user').filter(pk=application_id, project=project).first()
    if not application:
        return _error('not_found', 404)
    data = _body(request)
    status = str(data.get('status', '')).strip()
    if status not in ProjectApplication.Status.values:
        return _error('invalid_status')
    application.status = status
    application.save(update_fields=['status', 'updated_at'])
    if status == ProjectApplication.Status.ACCEPTED and application.applicant_user:
        ProjectMembership.objects.update_or_create(
            project=project,
            user=application.applicant_user,
            defaults={'role': ProjectMembership.Role.EDITOR},
        )
        grant_role(project, application.applicant_user, 'edit', granted_by=request.user)
    _audit(project, request.user, 'application_updated', application, status=status)
    return JsonResponse({'ok': True, 'application': {'id': application.pk, 'status': application.status}})


@require_http_methods(['GET'])
def researchers(request):
    if response := _auth(request):
        return response
    profiles = ResearcherProfile.objects.filter(is_public=True).select_related('user')
    return JsonResponse({'ok': True, 'researchers': [{
        'user_id': item.user_id,
        'name': item.user.get_full_name() or item.user.email.split('@')[0],
        'headline': item.headline,
        'bio': item.bio,
        'fields': item.fields,
        'skills': item.skills,
        'institution': item.institution,
        'orcid': item.orcid,
        'google_scholar_url': item.google_scholar_url,
        'github_url': item.github_url,
        'languages': item.languages,
        'availability': item.availability,
    } for item in profiles]})


@require_http_methods(['GET', 'PATCH'])
def researcher_me(request):
    if response := _auth(request):
        return response
    profile, _ = ResearcherProfile.objects.get_or_create(user=request.user)
    if request.method == 'PATCH':
        data = _body(request)
        for field in ('headline', 'bio', 'institution', 'orcid', 'google_scholar_url', 'github_url', 'availability'):
            if field in data:
                setattr(profile, field, str(data[field]).strip())
        for field in ('fields', 'skills', 'languages'):
            if field in data:
                setattr(profile, field, _list(data[field]))
        if 'is_public' in data:
            profile.is_public = bool(data['is_public'])
        profile.save()
    return JsonResponse({'ok': True, 'profile': {
        'headline': profile.headline,
        'bio': profile.bio,
        'fields': profile.fields,
        'skills': profile.skills,
        'institution': profile.institution,
        'orcid': profile.orcid,
        'google_scholar_url': profile.google_scholar_url,
        'github_url': profile.github_url,
        'languages': profile.languages,
        'availability': profile.availability,
        'is_public': profile.is_public,
    }})


@require_http_methods(['GET', 'POST'])
def mindmaps(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    if request.method == 'GET':
        qs = MindMap.objects.filter(workspace__in=spaces.values()).select_related('project', 'owner')
        items = [item for item in qs if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'items': [{'id': item.pk, 'title': item.title, 'description': item.description, 'project_id': item.project_id, 'owner': item.owner.first_name or item.owner.email, 'updated_at': item.updated_at.isoformat()} for item in items]})
    data = _body(request)
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    workspace = spaces['research']
    project = None
    if data.get('project_id'):
        project = ResearchProject.objects.filter(pk=data['project_id']).first()
        if not project or not can_edit(request.user, project):
            return _error('permission_denied', 403)
        workspace = project.workspace
    item = MindMap.objects.create(workspace=workspace, project=project, owner=request.user, title=title, description=str(data.get('description', '')).strip())
    policy_for(item, create=True, created_by=request.user, default_visibility=ObjectPolicy.Visibility.PROJECT if project else ObjectPolicy.Visibility.PRIVATE)
    return JsonResponse({'ok': True, 'item': {'id': item.pk, 'title': item.title, 'project_id': item.project_id}}, status=201)


@require_http_methods(['GET', 'PATCH', 'POST', 'DELETE'])
def mindmap_detail(request, map_id):
    if response := _auth(request):
        return response
    item = MindMap.objects.select_related('project', 'workspace', 'owner').filter(pk=map_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': {
            'id': item.pk,
            'title': item.title,
            'description': item.description,
            'project_id': item.project_id,
            'nodes': [{'id': node.pk, 'key': node.key, 'title': node.title, 'body': node.body, 'kind': node.kind, 'x': node.x, 'y': node.y, 'linked_object_id': node.linked_object_id} for node in item.nodes.all()],
            'edges': [{'id': edge.pk, 'source_id': edge.source_id, 'target_id': edge.target_id, 'relation': edge.relation, 'label': edge.label} for edge in item.edges.all()],
            'permissions': {'role': effective_role(request.user, item), 'can_edit': can_edit(request.user, item), 'can_manage': can_manage(request.user, item)},
        }})
    if not can_edit(request.user, item):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        item.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    if request.method == 'PATCH':
        if 'title' in data:
            item.title = str(data['title']).strip()[:240]
        if 'description' in data:
            item.description = str(data['description']).strip()
        item.save()
        return JsonResponse({'ok': True})
    action = str(data.get('action', '')).strip()
    if action == 'node.create':
        key = str(data.get('key') or f'n-{item.nodes.count() + 1}')[:80]
        node = MindMapNode.objects.create(
            mind_map=item,
            key=key,
            title=str(data.get('title', '')).strip()[:240] or 'Untitled node',
            body=str(data.get('body', '')).strip(),
            kind=str(data.get('kind', 'concept')) if str(data.get('kind', 'concept')) in MindMapNode.Kind.values else 'concept',
            x=float(data.get('x', 0) or 0),
            y=float(data.get('y', 0) or 0),
        )
        return JsonResponse({'ok': True, 'node': {'id': node.pk, 'key': node.key, 'title': node.title, 'kind': node.kind, 'x': node.x, 'y': node.y}}, status=201)
    if action == 'node.update':
        node = item.nodes.filter(pk=data.get('node_id')).first()
        if not node:
            return _error('node_not_found', 404)
        for field in ('title', 'body'):
            if field in data:
                setattr(node, field, str(data[field]).strip())
        if 'kind' in data and data['kind'] in MindMapNode.Kind.values:
            node.kind = data['kind']
        for field in ('x', 'y'):
            if field in data:
                setattr(node, field, float(data[field]))
        node.save()
        return JsonResponse({'ok': True})
    if action == 'node.delete':
        item.nodes.filter(pk=data.get('node_id')).delete()
        return JsonResponse({'ok': True})
    if action == 'edge.create':
        source = item.nodes.filter(pk=data.get('source_id')).first()
        target = item.nodes.filter(pk=data.get('target_id')).first()
        if not source or not target or source.pk == target.pk:
            return _error('invalid_edge')
        edge, _ = MindMapEdge.objects.get_or_create(
            mind_map=item,
            source=source,
            target=target,
            relation=str(data.get('relation', 'related'))[:60],
            defaults={'label': str(data.get('label', ''))[:160]},
        )
        return JsonResponse({'ok': True, 'edge': {'id': edge.pk, 'source_id': edge.source_id, 'target_id': edge.target_id, 'relation': edge.relation}}, status=201)
    if action == 'edge.delete':
        item.edges.filter(pk=data.get('edge_id')).delete()
        return JsonResponse({'ok': True})
    return _error('invalid_action')


@require_http_methods(['GET', 'POST', 'DELETE'])
def entity_links(request):
    if response := _auth(request):
        return response
    if request.method == 'GET':
        target_type = request.GET.get('type')
        object_id = request.GET.get('id')
        obj = resolve_target(target_type, object_id)
        if not obj or not can_view(request.user, obj):
            return _error('not_found', 404)
        ct = content_type_for(obj)
        links = EntityLink.objects.filter(Q(source_content_type=ct, source_object_id=obj.pk) | Q(target_content_type=ct, target_object_id=obj.pk)).select_related('source_content_type', 'target_content_type')
        result = []
        for link in links:
            other = link.target_object if link.source_content_type_id == ct.pk and link.source_object_id == obj.pk else link.source_object
            if other and can_view(request.user, other):
                result.append({'id': link.pk, 'relation': link.relation, 'other_type': other.__class__.__name__, 'other_id': other.pk, 'other_title': getattr(other, 'title', None) or getattr(other, 'name', str(other))})
        return JsonResponse({'ok': True, 'items': result})
    data = _body(request)
    source = resolve_target(data.get('source_type'), data.get('source_id'))
    target = resolve_target(data.get('target_type'), data.get('target_id'))
    if not source or not target or not can_edit(request.user, source) or not can_view(request.user, target):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        EntityLink.objects.filter(pk=data.get('link_id')).filter(Q(source_object_id=source.pk) | Q(target_object_id=source.pk)).delete()
        return JsonResponse({'ok': True})
    link, created = EntityLink.objects.get_or_create(
        source_content_type=content_type_for(source),
        source_object_id=source.pk,
        target_content_type=content_type_for(target),
        target_object_id=target.pk,
        relation=str(data.get('relation', 'related'))[:80],
        defaults={'created_by': request.user},
    )
    return JsonResponse({'ok': True, 'link': {'id': link.pk, 'relation': link.relation}}, status=201 if created else 200)


@require_http_methods(['GET'])
def shared_link(request, token):
    now = timezone.now()
    link = ShareLink.objects.select_related('content_type', 'created_by').filter(token=token, active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()
    if not link or not link.content_object:
        return _error('not_found', 404)
    obj = link.content_object
    if isinstance(obj, ResearchProject):
        profile = _project_profile(obj)
        return JsonResponse({'ok': True, 'type': 'project', 'role': link.role, 'allow_download': link.allow_download, 'project': {
            'id': obj.pk,
            'title': obj.title,
            'description': obj.description,
            'research_question': profile.research_question,
            'status': profile.status,
            'deadline': _json_date(profile.deadline),
            'deliverables': [{'id': item.pk, 'title': item.title, 'description': item.description, 'status': item.status, 'resource_id': item.resource_id} for item in obj.deliverables.filter(client_visible=True)],
        }})
    if isinstance(obj, KnowledgeResource):
        return JsonResponse({'ok': True, 'type': 'resource', 'role': link.role, 'allow_download': link.allow_download, 'resource': _resource_json(obj)})
    return JsonResponse({'ok': True, 'type': obj.__class__.__name__.lower(), 'role': link.role, 'allow_download': link.allow_download, 'item': {'id': obj.pk, 'title': getattr(obj, 'title', None) or getattr(obj, 'name', str(obj))}})
