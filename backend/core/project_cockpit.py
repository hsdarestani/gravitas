from functools import reduce
from operator import or_

from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import KnowledgeActivity, KnowledgeResource, ResearchProject
from .operating_models import OperatingTask
from .platform_access import can_edit, can_manage, can_view, content_type_for, effective_role
from .platform_api import _auth, _project_json, _request_json, _resource_json
from .platform_models import (
    EntityLink,
    MindMap,
    ProjectAuditEvent,
    ProjectDeliverable,
    ResearchRequest,
)


RELATION_LABELS = {
    'related': 'Related to',
    'supports': 'Supports',
    'uses': 'Uses',
    'derived_from': 'Derived from',
    'evidence_for': 'Evidence for',
    'contradicts': 'Contradicts',
    'produces': 'Produces',
    'reviews': 'Reviews',
    'answers': 'Answers',
    'depends_on': 'Depends on',
}


def _person(user):
    if not user:
        return 'System'
    return user.get_full_name() or user.first_name or user.email


def _task_json(item, user):
    return {
        'id': item.pk,
        'type': 'task',
        'title': item.title,
        'description': item.description,
        'status': item.status,
        'priority': item.priority,
        'due_date': item.due_date.isoformat() if item.due_date else None,
        'definition_of_done': item.definition_of_done,
        'owner': _person(item.owner),
        'owner_id': item.owner_id,
        'initiative': item.initiative.title if item.initiative else None,
        'role': effective_role(user, item),
        'can_edit': can_edit(user, item),
        'can_manage': can_manage(user, item),
        'updated_at': item.updated_at.isoformat(),
    }


def _deliverable_json(item, user):
    return {
        'id': item.pk,
        'type': 'deliverable',
        'title': item.title,
        'description': item.description,
        'status': item.status,
        'resource_id': item.resource_id,
        'client_visible': item.client_visible,
        'role': effective_role(user, item),
        'can_edit': can_edit(user, item),
        'can_manage': can_manage(user, item),
        'updated_at': item.updated_at.isoformat(),
    }


def _mindmap_json(item, user):
    return {
        'id': item.pk,
        'type': 'mindmap',
        'title': item.title,
        'description': item.description,
        'node_count': item.nodes.count(),
        'edge_count': item.edges.count(),
        'role': effective_role(user, item),
        'can_edit': can_edit(user, item),
        'can_manage': can_manage(user, item),
        'updated_at': item.updated_at.isoformat(),
    }


def _linkable_record(obj, target_type, *, kind=None, status=None):
    return {
        'type': target_type,
        'id': obj.pk,
        'title': getattr(obj, 'title', None) or getattr(obj, 'name', str(obj)),
        'kind': kind or target_type,
        'status': status,
    }


def _safe_audit_detail(detail):
    if not isinstance(detail, dict):
        return {}
    allowed = {
        'status', 'title', 'category', 'visibility', 'content_title', 'role',
        'kind', 'client_visible', 'user_id', 'link_id', 'folder_name',
    }
    return {key: value for key, value in detail.items() if key in allowed}


def _activity(project, user, limit=60):
    events = []
    for item in ProjectAuditEvent.objects.filter(project=project).select_related('actor')[:limit]:
        events.append({
            'id': f'audit-{item.pk}',
            'source': 'audit',
            'action': item.action,
            'actor': _person(item.actor),
            'actor_id': item.actor_id,
            'object_type': item.object_type,
            'object_id': item.object_id,
            'detail': _safe_audit_detail(item.detail),
            'created_at': item.created_at.isoformat(),
        })
    for item in KnowledgeActivity.objects.filter(project=project).select_related('actor', 'resource')[:limit]:
        if item.resource_id and not can_view(user, item.resource):
            continue
        events.append({
            'id': f'knowledge-{item.pk}',
            'source': 'knowledge',
            'action': item.action,
            'actor': _person(item.actor),
            'actor_id': item.actor_id,
            'object_type': 'KnowledgeResource' if item.resource_id else 'ResearchProject',
            'object_id': str(item.resource_id or project.pk),
            'detail': _safe_audit_detail(item.detail),
            'created_at': item.created_at.isoformat(),
        })
    events.sort(key=lambda row: row['created_at'], reverse=True)
    return events[:limit]


def _connections(objects):
    registry = {}
    by_type = {}
    for obj, target_type, kind, status in objects:
        ct = content_type_for(obj)
        key = (ct.pk, obj.pk)
        registry[key] = _linkable_record(obj, target_type, kind=kind, status=status)
        by_type.setdefault(ct.pk, set()).add(obj.pk)

    if not registry:
        return [], []

    clauses = []
    for ct_id, ids in by_type.items():
        clauses.append(Q(source_content_type_id=ct_id, source_object_id__in=ids))
        clauses.append(Q(target_content_type_id=ct_id, target_object_id__in=ids))
    qs = EntityLink.objects.filter(reduce(or_, clauses)).select_related(
        'source_content_type', 'target_content_type', 'created_by'
    )[:1200]
    links = []
    for link in qs:
        source = registry.get((link.source_content_type_id, link.source_object_id))
        target = registry.get((link.target_content_type_id, link.target_object_id))
        if not source or not target:
            continue
        links.append({
            'id': link.pk,
            'relation': link.relation,
            'relation_label': RELATION_LABELS.get(link.relation, link.relation.replace('_', ' ').title()),
            'source': source,
            'target': target,
            'created_by': _person(link.created_by) if link.created_by_id else 'System',
            'created_at': link.created_at.isoformat(),
        })
    links.sort(key=lambda row: row['created_at'], reverse=True)
    linkable = sorted(registry.values(), key=lambda row: (row['kind'], row['title'].lower()))
    return links[:500], linkable


@require_http_methods(['GET'])
def project_cockpit(request, project_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.select_related('workspace', 'owner').filter(
        pk=project_id, archived=False
    ).first()
    if not project or not can_view(request.user, project):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)

    resources = [
        item for item in project.resources.select_related('owner', 'collection', 'project')
        if can_view(request.user, item)
    ]
    deliverables = [
        item for item in project.deliverables.select_related('resource', 'created_by')
        if can_view(request.user, item)
    ]
    mindmaps = [
        item for item in project.mind_maps.prefetch_related('nodes', 'edges')
        if can_view(request.user, item)
    ]
    research_requests = [
        item for item in ResearchRequest.objects.filter(project=project).select_related('assignee', 'content_work_item')
        if can_view(request.user, item)
    ]
    tasks = [
        item for item in OperatingTask.objects.filter(project=project).select_related('owner', 'initiative')
        if can_view(request.user, item)
    ]

    connection_objects = [(project, 'project', 'project', getattr(project, 'status', None))]
    connection_objects += [(item, 'resource', item.kind, None) for item in resources]
    connection_objects += [(item, 'deliverable', 'deliverable', item.status) for item in deliverables]
    connection_objects += [(item, 'mindmap', 'mindmap', None) for item in mindmaps]
    connection_objects += [(item, 'research-request', 'research request', item.status) for item in research_requests]
    connection_objects += [(item, 'task', 'task', item.status) for item in tasks]
    links, linkable = _connections(connection_objects)

    today = timezone.localdate()
    overdue_tasks = sum(1 for item in tasks if item.due_date and item.due_date < today and item.status not in {'done', 'archived'})
    overdue_requests = sum(1 for item in research_requests if item.due_date and item.due_date < today and item.status not in {'done', 'cancelled'})
    blocked_tasks = sum(1 for item in tasks if item.status == 'blocked')
    open_requests = sum(1 for item in research_requests if item.status not in {'done', 'cancelled'})

    members = [{
        'user_id': membership.user_id,
        'name': _person(membership.user),
        'email': membership.user.email if can_manage(request.user, project) else '',
        'role': membership.role,
        'initials': ''.join(part[:1].upper() for part in _person(membership.user).split()[:2]) or 'R',
    } for membership in project.memberships.select_related('user').order_by('role', 'user__first_name', 'user__email')]

    counts = {
        'notes': sum(1 for item in resources if item.kind == KnowledgeResource.Kind.NOTE),
        'files': sum(1 for item in resources if item.kind == KnowledgeResource.Kind.FILE),
        'datasets': sum(1 for item in resources if item.kind == KnowledgeResource.Kind.DATASET),
        'papers': sum(1 for item in resources if item.kind == KnowledgeResource.Kind.PAPER),
        'deliverables': len(deliverables),
        'mindmaps': len(mindmaps),
        'members': len(members),
        'connections': len(links),
        'tasks': len(tasks),
        'research_requests': len(research_requests),
    }

    return JsonResponse({
        'ok': True,
        'project': _project_json(project, request.user, include_detail=True),
        'counts': counts,
        'attention': {
            'overdue_tasks': overdue_tasks,
            'overdue_requests': overdue_requests,
            'blocked_tasks': blocked_tasks,
            'open_requests': open_requests,
        },
        'members': members,
        'resources': [_resource_json(item) | {
            'collection_id': item.collection_id,
            'owner': _person(item.owner),
            'source_url': item.source_url,
            'kind_label': item.get_kind_display(),
        } for item in resources],
        'deliverables': [_deliverable_json(item, request.user) for item in deliverables],
        'mindmaps': [_mindmap_json(item, request.user) for item in mindmaps],
        'research_requests': [_request_json(item) | {
            'type': 'research-request',
            'can_edit': can_edit(request.user, item),
            'can_manage': can_manage(request.user, item),
        } for item in research_requests],
        'tasks': [_task_json(item, request.user) for item in tasks],
        'connections': links,
        'linkable': linkable,
        'activity': _activity(project, request.user),
        'relations': [{'value': key, 'label': label} for key, label in RELATION_LABELS.items()],
    })
