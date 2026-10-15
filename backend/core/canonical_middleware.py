"""Guard adopted project projections at the API boundary, including legacy APIs.

DB writes roll back if a canonical file save conflicts. Requests refresh the
permitted file projections first. Cloud failure is visible; an adopted project
never silently falls back to independent database content. Service writes from
jobs use the same signals; callers must use transaction.atomic for operations
spanning multiple projections.
"""
import re
from django.core.exceptions import ValidationError, ImproperlyConfigured
from django.db import transaction
from django.http import JsonResponse
from . import cloud
from .canonical_projects import CanonicalConflict, refresh_project, _pending
from .canonical_models import CanonicalProject
from .platform_access import can_view
from .canonical_journal import write_batch, commit_witness



def project_scope_for(request, kwargs):
    """Only refresh projects this request actually addresses.

    Previously any GET of /notes, /tasks or the command palette refreshed
    *every* canonical project and its *every* file over Nextcloud DAV while
    holding the database transaction open. This can exceed the Gunicorn worker
    timeout, and a single slow Nextcloud request blocks unrelated screens.
    """
    from .models import KnowledgeResource
    from .operating_models import OperatingTask

    values = set()

    def add(value):
        try:
            if value not in (None, '') and int(value) > 0:
                values.add(int(value))
        except (ValueError, TypeError, OverflowError):
            pass

    for key in ('project_id', 'research_project_id'):
        add(kwargs.get(key))
    for key in ('project', 'project_id'):
        add(request.GET.get(key))
    if kwargs.get('resource_id'):
        add(KnowledgeResource.objects.filter(pk=kwargs['resource_id'])
            .values_list('project_id', flat=True).first())
    if kwargs.get('task_id'):
        add(OperatingTask.objects.filter(pk=kwargs['task_id'])
            .values_list('project_id', flat=True).first())

    # A create/move may name its project only in JSON. Read at most 256 KiB,
    # and do not parse multipart uploads or unrelated large requests.
    if request.method not in ('GET', 'HEAD') and (request.content_type or '').startswith('application/json'):
        try:
            declared_size = int(request.META.get('CONTENT_LENGTH') or '0')
        except (ValueError, TypeError):
            declared_size = 262145
        if 0 <= declared_size <= 262144:
            try:
                import json
                payload = json.loads(request.body or b'{}')
            except (ValueError, UnicodeDecodeError):
                payload = {}
            if isinstance(payload, dict):
                add(payload.get('project_id'))
                add(payload.get('research_project_id'))
    return values


class CanonicalProjectMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if not request.path.startswith('/api/') or not request.user.is_authenticated:
            return None
        # Do not query every project for unrelated auth/LMS/notification reads.
        relevant = any(token in request.path for token in ('projects/', 'resources/', 'mindmaps/', 'work-reports', 'notes/', 'pages/', 'tasks/', 'task-board/', 'assistant/', 'pulsar/', 'platform/share/', 'platform/folders/'))
        if not relevant:
            return None
        project_ids = project_scope_for(request, view_kwargs)
        if not project_ids and request.method in ('GET', 'HEAD', 'OPTIONS'):
            # A global list is a database snapshot, not an implicit full
            # Nextcloud crawl.
            return None
        # Unscoped writes still get a journal/write_batch transaction: signals
        # can guard a canonical object even when its project was not in the
        # route. We simply skip the remote refresh of unrelated projects.
        try:
            with write_batch() as batch, transaction.atomic():
                states = (
                    CanonicalProject.objects.select_for_update()
                    .filter(enabled=True, project_id__in=project_ids)
                    .select_related('project')
                )
                for state in states:
                    if can_view(request.user, state.project):
                        refresh_project(state.project, request.user)
                pending = []
                token = _pending.set(pending)
                try:
                    response = view_func(request, *view_args, **view_kwargs)
                    if response.status_code >= 400:
                        transaction.set_rollback(True)
                    else:
                        from .canonical_signals import flush_pending
                        flush_pending(pending, request.user)
                        commit_witness(batch)
                    return response
                finally:
                    _pending.reset(token)
        except CanonicalConflict as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_file_conflict', 'conflict': exc.detail}, status=409)
        except (cloud.CloudError, ImproperlyConfigured) as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_storage_unavailable', 'detail': str(exc)}, status=503)
        except (ValueError, ValidationError) as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_file_invalid', 'detail': str(exc)}, status=409)
