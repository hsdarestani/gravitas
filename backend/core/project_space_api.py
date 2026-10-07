"""Research project creation with canonical Space placement.

The historical platform/projects endpoint remains the reader and backwards-
compatible creator. When a workspace client supplies ``space_category_id`` we
create the project and its ProjectSpaceLink in the same transaction, so the
post-commit Nextcloud mirror worker sees the intended parent category on its
first pass instead of briefly creating a project in the default folder.
"""

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import platform_api
from .models import Collection, ProjectMembership, ResearchProject
from .platform_access import content_type_for
from .platform_models import ObjectPolicy, ResearchProjectProfile
from .space_fs import filesystem_name
from .space_models import ProjectSpaceLink, SpaceNode


@require_http_methods(['GET', 'POST'])
def platform_projects_with_space(request):
    if request.method == 'GET':
        return platform_api.platform_projects(request)
    if response := platform_api._auth(request):
        return response

    data = platform_api._body(request)
    category_id = data.get('space_category_id')
    if category_id in (None, ''):
        # Preserve API compatibility for integrations that have not adopted the
        # Space filesystem yet.
        return platform_api.platform_projects(request)

    space_category = SpaceNode.objects.filter(
        pk=category_id,
        owner=request.user,
        kind=SpaceNode.Kind.CATEGORY,
    ).first()
    if not space_category:
        return platform_api._error('invalid_space_category')

    spaces = platform_api.ensure_dual_workspaces(request.user)
    research = spaces['research']
    title = str(data.get('title', '')).strip()[:220]
    if not title:
        return platform_api._error('title_required')

    category = str(data.get('category', 'internal')).strip()
    if category not in ResearchProjectProfile.Category.values:
        return platform_api._error('invalid_category')
    visibility = str(data.get('visibility', 'private')).strip()
    if visibility not in ResearchProjectProfile.Visibility.values:
        return platform_api._error('invalid_visibility')
    try:
        deadline = platform_api._parse_date(data.get('deadline'))
    except ValueError as exc:
        return platform_api._error(str(exc))

    with transaction.atomic():
        project = ResearchProject.objects.create(
            workspace=research,
            owner=request.user,
            title=title,
            description=str(data.get('description', '')).strip(),
        )
        ProjectMembership.objects.create(
            project=project,
            user=request.user,
            role=ProjectMembership.Role.OWNER,
        )

        public_slug = None
        if visibility in {'community', 'public'} or bool(data.get('application_open')):
            public_slug = platform_api._unique_slug(
                ResearchProjectProfile,
                title,
                field='public_slug',
                max_length=220,
            )
        profile = ResearchProjectProfile.objects.create(
            project=project,
            category=category,
            visibility=visibility,
            status=(
                str(data.get('status', 'active'))
                if str(data.get('status', 'active')) in ResearchProjectProfile.Status.values
                else 'active'
            ),
            research_question=str(data.get('research_question', '')).strip(),
            client_name=str(data.get('client_name', '')).strip()[:220],
            requester_name=str(data.get('requester_name', '')).strip()[:220],
            requester_email=str(data.get('requester_email', '')).strip()[:254],
            confidentiality=(
                str(data.get('confidentiality', 'internal'))
                if str(data.get('confidentiality', 'internal')) in ResearchProjectProfile.Confidentiality.values
                else 'internal'
            ),
            deadline=deadline,
            compensation_text=str(data.get('compensation_text', '')).strip()[:240],
            required_skills=platform_api._list(data.get('required_skills')),
            application_open=bool(data.get('application_open')),
            public_slug=public_slug,
            # Kept for backwards compatibility. Native collaborative storage is
            # the stable Team Folder; the personal Space path is represented by
            # ProjectSpaceLink below.
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
            visibility=(
                ObjectPolicy.Visibility.PUBLIC
                if visibility == 'public'
                else ObjectPolicy.Visibility.WORKSPACE
            ),
            allow_download=profile.allow_downloads,
            allow_reshare=profile.allow_public_links,
            created_by=request.user,
        )

        # PROJECT_FOLDERS is intentionally read at request time. CoreConfig
        # disables the old fixed folder seeding in production, while retaining
        # compatibility for deployments that explicitly opt into it.
        if category in {'client', 'community'} or profile.secure_data_room:
            for folder_name in platform_api.PROJECT_FOLDERS:
                Collection.objects.get_or_create(
                    workspace=research,
                    project=project,
                    parent=None,
                    name=folder_name,
                    defaults={'created_by': request.user},
                )

        filesystem = filesystem_name(project.title)
        link = ProjectSpaceLink.objects.create(
            project=project,
            user=request.user,
            category=space_category,
            folder_path=f'{space_category.nextcloud_path}/{filesystem}',
            metadata_path=f'{space_category.nextcloud_path}/{filesystem}.md',
            sync_state='pending',
        )
        platform_api._audit(
            project,
            request.user,
            'project_created',
            project,
            category=category,
            visibility=visibility,
            space_category_id=space_category.pk,
            space_path=link.folder_path,
        )

    payload = platform_api._project_json(project, request.user, include_detail=True)
    payload['space_placement'] = {
        'category_id': space_category.pk,
        'category_title': space_category.title,
        'folder_path': link.folder_path,
        'metadata_path': link.metadata_path,
        'sync_state': link.sync_state,
    }
    return JsonResponse({'ok': True, 'project': payload}, status=201)
