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


class CanonicalProjectMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if not request.path.startswith('/api/') or not request.user.is_authenticated:
            return None
        # Do not query every project for unrelated auth/LMS/notification reads.
        relevant = any(token in request.path for token in ('projects/', 'resources/', 'mindmaps/', 'work-reports', 'notes/', 'pages/', 'tasks/', 'assistant/', 'pulsar/'))
        if not relevant:
            return None
        try:
            with transaction.atomic():
                states = CanonicalProject.objects.filter(enabled=True).select_related('project')
                project_id = view_kwargs.get('project_id') or request.GET.get('project')
                if project_id:
                    states = states.filter(project_id=project_id)
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
                    return response
                finally:
                    _pending.reset(token)
        except CanonicalConflict as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_file_conflict', 'conflict': exc.detail}, status=409)
        except (cloud.CloudError, ImproperlyConfigured) as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_storage_unavailable', 'detail': str(exc)}, status=503)
        except (ValueError, ValidationError) as exc:
            return JsonResponse({'ok': False, 'error': 'canonical_file_invalid', 'detail': str(exc)}, status=409)
