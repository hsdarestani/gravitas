from functools import wraps

from django.http import JsonResponse

from .layer_access import module_access
from .layer_models import ModuleGrant


def require_module(module):
    """Require an enabled product layer before entering a view.

    This is deliberately separate from object ACLs. Passing the layer gate
    only means the user may enter that product surface; each project, file or
    note must still pass its existing per-object authorization.
    """
    if module not in ModuleGrant.Module.values:
        raise ValueError('invalid_module')

    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
            if not module_access(request.user, module):
                return JsonResponse(
                    {'ok': False, 'error': f'{module}_access_required'},
                    status=403,
                )
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


def require_research_or_core(view):
    """Research product entry for participants or the internal control plane.

    A Core administrator may operate Layer 4 without being labelled a
    Researcher. An explicit disabled Research grant still blocks a participant
    path. For direct project URLs with *no configured Research grant*, however,
    the underlying object ACL is allowed to answer: an unrelated account then
    receives the same 404 it always received instead of revealing that a
    private project exists. Real project participants already resolve to
    Research access through their project relationship.
    """
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
        if module_access(request.user, ModuleGrant.Module.RESEARCH):
            return view(request, *args, **kwargs)

        # Import lazily to avoid layer_guards <-> platform_runtime_v3 import
        # cycles during Django app loading.
        from .platform_runtime_v3 import core_access, ensure_platform_workspaces

        spaces = ensure_platform_workspaces(request.user)
        if core_access(request.user, spaces['core']):
            return view(request, *args, **kwargs)

        explicit = ModuleGrant.objects.filter(
            user=request.user,
            module=ModuleGrant.Module.RESEARCH,
        ).first()
        if explicit is None and kwargs.get('project_id') is not None:
            # Let can_view/can_edit inside the endpoint produce a non-leaking
            # 404/403. This is not a layer bypass: an explicitly suspended
            # account never reaches this branch.
            return view(request, *args, **kwargs)

        return JsonResponse({'ok': False, 'error': 'research_access_required'}, status=403)
    return wrapped


require_dashboard = require_module(ModuleGrant.Module.DASHBOARD)
require_lms = require_module(ModuleGrant.Module.LMS)
require_research = require_module(ModuleGrant.Module.RESEARCH)
require_core = require_module(ModuleGrant.Module.CORE)


def require_core_admin(view):
    """Require an actual Core owner/admin, not merely Layer-5 membership."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
        from .platform_runtime_v3 import core_role, ensure_platform_workspaces
        spaces = ensure_platform_workspaces(request.user)
        if core_role(request.user, spaces['core']) not in {'owner', 'admin'}:
            return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
        return view(request, *args, **kwargs)
    return wrapped
