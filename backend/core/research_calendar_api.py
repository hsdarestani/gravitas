from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .models import ResearchProject
from .operating_models import OperatingTask
from .platform_models import ResearchRequest


@require_GET
def research_calendar(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    projects = ResearchProject.objects.filter(
        Q(owner=request.user) | Q(memberships__user=request.user),
        archived=False,
    ).distinct()
    project_map = {item.pk: item.title for item in projects.only('id', 'title')}
    ids = list(project_map)
    tasks = OperatingTask.objects.filter(project_id__in=ids, due_date__isnull=False).only(
        'id', 'project_id', 'title', 'status', 'due_date'
    )
    requests = ResearchRequest.objects.filter(project_id__in=ids, due_date__isnull=False).only(
        'id', 'project_id', 'title', 'status', 'due_date'
    )
    events = [{
        'id': f'task-{item.pk}',
        'project_id': item.project_id,
        'project': project_map.get(item.project_id, ''),
        'title': item.title,
        'status': item.status,
        'due_date': item.due_date.isoformat(),
        'kind': 'Task',
    } for item in tasks]
    events.extend({
        'id': f'request-{item.pk}',
        'project_id': item.project_id,
        'project': project_map.get(item.project_id, ''),
        'title': item.title,
        'status': item.status,
        'due_date': item.due_date.isoformat(),
        'kind': 'Request',
    } for item in requests)
    events.sort(key=lambda row: (row['due_date'], row['project'], row['title']))
    return JsonResponse({'ok': True, 'events': events, 'project_count': len(ids)})
