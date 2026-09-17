"""Fast read surface for native Nextcloud Notes.

Workspace notes are canonical Gravitas rows. Opening the editor therefore must
not wait for a full remote reconciliation before rendering data that is already
available locally. Explicit/background synchronization continues to use the
existing conflict-safe Notes adapter.
"""

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource
from .nextcloud_notes import _allowed_space, _json, _remote_url, _space, native_notes


@require_http_methods(['GET', 'POST'])
def native_notes_fast(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    # Preserve the existing create + mirror semantics. Only the initial read is
    # local-first so a slow/unreachable Nextcloud can never hold the editor UI.
    if request.method == 'POST':
        return native_notes(request)

    # Compatibility escape hatch for callers that deliberately need a blocking
    # reconcile. The workspace first-paint path never opts into this mode.
    if request.GET.get('sync') in {'1', 'true', 'yes'}:
        return native_notes(request)

    resources = KnowledgeResource.objects.filter(
        owner=request.user,
        kind=KnowledgeResource.Kind.NOTE,
    ).order_by('-updated_at')
    items = [_json(resource) for resource in resources if _allowed_space(request.user, _space(resource))]
    return JsonResponse({
        'ok': True,
        'available': None,
        'sync_deferred': True,
        'native_url': _remote_url(),
        'sync': None,
        'items': items,
    })
