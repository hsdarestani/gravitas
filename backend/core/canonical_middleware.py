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
from .canonical_projects import CanonicalConflict, refresh_project, refresh_task_scope, _pending
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


def _committed_task_snapshot_read(request):
    """Read confirmed Core task state without a synchronous Nextcloud refresh.

    GET task cards, side panels and Google Calendar status are read-only
    summaries of the already-committed Django projection. Previously each
    endpoint refreshed a canonical Research project over DAV *inside* a DB
    transaction, including unrelated project files for Calendar status.
    This routinely blocked many independent calls for 30-60 seconds.
    Every mutation (PATCH/POST/DELETE) still goes through the canonical
    revision/journal boundary in process_view below. Native document editors
    and explicit project live reads retain their existing sync behavior.
    """
    if request.method not in ('GET', 'HEAD'):
        return False
    path = request.path
    return bool(
        re.fullmatch(r'/api/operating/task-board/\d+/', path)
        or re.fullmatch(
            r'/api/operating/tasks/\d+/(?:history|comments|attachments|checklist|external-links)/'
            r'(?:\d+/(?:download/)?)?', path,
        )
        or re.fullmatch(r'/api/calendar/google/tasks/\d+/status/', path)
        or re.fullmatch(r'/api/platform/tasks/\d+/', path)
    )


def _research_project_panel_snapshot_read(request):
    """Read committed, ACL-scoped Research panel projections without DAV I/O.

    The canonical Research project snapshot already supports an explicit
    read_mode=snapshot. Structured discussions, milestones, tasks, folders,
    research experiments, journals, and managed/allowlisted database panels
    read committed DB state with their own ACL checks. Synchronous full-project
    Nextcloud DAV crawling before these GETs blocks Gunicorn workers and yields
    502/504 for unrelated workspaces. Write and native-document routes retain
    their canonical revision checks; missing data is never fabricated.
    """
    if request.method not in ('GET', 'HEAD'):
        return False
    path = request.path
    # A centralized inventory for DB-backed Research read panels. New
    # projection-only screens belong here rather than inheriting a full DAV
    # project refresh and a 60-second Gunicorn worker timeout.
    return bool(
        re.fullmatch(
            r'/api/platform/projects/\d+/'
            r'(?:discussions|milestones|deliverables|folders|access-candidates|tasks)/',
            path,
        )
        or re.fullmatch(
            r'/api/platform/projects/\d+/tools/'
            r'(?:git(?:/commits)?|private-git/commits|builtin|providers|plugins|status)/',
            path,
        )
        or re.fullmatch(r'/api/platform/projects/\d+/experiments/', path)
        or re.fullmatch(r'/api/platform/projects/\d+/experiments/\d+/journal/', path)
        or re.fullmatch(r'/api/platform/projects/\d+/tools/data/tables/', path)
        or re.fullmatch(r'/api/platform/projects/\d+/tools/data/tables/\d+/rows/', path)
        or re.fullmatch(r'/api/platform/projects/\d+/tools/external/datasets/', path)
        or re.fullmatch(
            r'/api/platform/projects/\d+/tools/external/datasets/[A-Za-z_][A-Za-z0-9_]{0,62}/rows/',
            path,
        )
    )


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
        # Project tool picks are standalone ResearchProjectProfile metadata.
        # Their dedicated PATCH does not write canonical project or permission
        # objects, so a project-wide DAV refresh would only block the request.
        # All other project edits continue through the canonical journal.
        if (request.method == 'PATCH'
                and re.fullmatch(
                    r'/api/platform/projects/\d+/tools/selection/', request.path,
                )):
            return None
        # Core task reads use persisted confirmed state. Never hold a SQL
        # lock while a read-only task popup waits for remote Nextcloud I/O.
        if _committed_task_snapshot_read(request):
            return None
        # Experiment lists and managed dataset reads share the same committed
        # snapshot contract; the caller's object ACL is checked by each view.
        # Keep POST/PATCH/DELETE behind the native canonical write boundary.
        if _research_project_panel_snapshot_read(request):
            return None
        # The project overview immediately reads independent tool status and
        # approved provider catalogs after a selection save. These endpoints
        # already enforce project ACL and read their own database/config state;
        # syncing full Nextcloud project files here would reintroduce stalls.
        if (request.method in ('GET', 'HEAD')
                and re.fullmatch(
                    r'/api/platform/projects/\d+/tools/(?:status|plugins|providers)/',
                    request.path,
                )):
            return None
        if request.method in ('GET', 'HEAD'):
            # Portfolio/cockpit navigation reads the committed projection,
            # just like the global task board. This is an explicit read mode,
            # never a fallback after a failed native refresh. Item reads and
            # every mutation retain their revision checks and journal boundary.
            cockpit_snapshot = (
                request.GET.get('read_mode') == 'snapshot'
                and re.fullmatch(r'/api/platform/projects/\d+/(?:cockpit|schedules|work-time)/', request.path)
            )
            # The folder endpoint already performs a live, caller-scoped DAV
            # listing. Reading every file first adds no listing correctness.
            native_listing = re.fullmatch(r'/api/platform/projects/\d+/structure/', request.path)
            if cockpit_snapshot or native_listing:
                return None
        # Task form PATCHes must acknowledge a *durably committed database write*
        # without holding the HTTP request open for Nextcloud/WebDAV.
        # Only this isolated field-edit operation is queued; changing a task's
        # project still uses the strict synchronous canonical boundary.
        if (request.method == 'PATCH' and
                re.fullmatch(r'/api/operating/task-board/\d+/', request.path)):
            from .operating_models import OperatingTask
            from .canonical_models import CanonicalTaskSyncOutbox
            from django.db.models import F
            from django.utils import timezone
            import json
            import time

            task_id = view_kwargs.get('task_id')
            source_project_id = OperatingTask.objects.filter(pk=task_id).values_list('project_id', flat=True).first()
            if source_project_id and CanonicalProject.objects.filter(
                    project_id=source_project_id, enabled=True).exists():
                try:
                    incoming = json.loads(request.body or b'{}')
                except (ValueError, UnicodeDecodeError):
                    incoming = {}
                if not isinstance(incoming, dict):
                    incoming = {}
                if 'project_id' not in incoming:
                    started = time.monotonic()
                    with transaction.atomic():
                        pending = []
                        token = _pending.set(pending)
                        try:
                            response = view_func(request, *view_args, **view_kwargs)
                            if response.status_code >= 400:
                                transaction.set_rollback(True)
                            else:
                                # Do not queue unknown canonical writes: only the
                                # named task's own save is covered by this boundary.
                                unexpected = [
                                    item for item in pending
                                    if item[0] != 'save' or
                                       item[1].__name__ != 'OperatingTask' or
                                       item[2] != task_id
                                ]
                                if unexpected:
                                    transaction.set_rollback(True)
                                    return JsonResponse({'ok': False, 'error': 'unsupported_canonical_task_edit'}, status=409)
                                CanonicalTaskSyncOutbox.objects.get_or_create(
                                    project_id=source_project_id, task_id=task_id,
                                    defaults={'next_attempt_at': timezone.now()},
                                )
                                CanonicalTaskSyncOutbox.objects.filter(
                                    project_id=source_project_id, task_id=task_id,
                                ).update(
                                    generation=F('generation') + 1,
                                    next_attempt_at=timezone.now(),
                                    state='pending',
                                    last_error='',
                                    attempts=0,
                                )
                                response['X-Canonical-Sync'] = 'pending'
                                # Distinguish confirmed database persistence from
                                # an asynchronously pending native file revision.
                                if response.get('Content-Type', '').startswith('application/json'):
                                    body = json.loads(response.content)
                                    body['canonical_sync'] = 'pending'
                                    response.content = json.dumps(body)
                                response['Server-Timing'] = (
                                    'task_write;dur=%.1f' % ((time.monotonic() - started) * 1000)
                                )
                            return response
                        finally:
                            _pending.reset(token)
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
                        if ('/operating/task-board/' in request.path or
                                re.fullmatch(r'/api/platform/projects/\d+/tasks/\d+/', request.path) or
                                re.fullmatch(
                                    r'/api/operating/tasks/\d+/(?:comments|checklist|attachments|history)/'
                                    r'(?:\d+/(?:download/)?)?',
                                    request.path,
                                )):
                            # Updating one Research task must not refresh every
                            # note, attachment and task in the project over DAV.
                            refresh_task_scope(state.project, request.user, view_kwargs.get('task_id'))
                        else:
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
