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
    """Research product entry for researchers *or* the internal control plane.

    Layer 5 must be able to create/manage Layer 4 objects without pretending
    that the administrator is a Research participant.  Core access is checked
    independently and the existing project/object ACL still runs inside the
    endpoint. This preserves the user's rule that LMS/Research entitlements
    are independent while keeping Core capable of administering every layer.
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
        return JsonResponse({'ok': False, 'error': 'research_access_required'}, status=403)
    return wrapped


require_dashboard = require_module(ModuleGrant.Module.DASHBOARD)
require_lms = require_module(ModuleGrant.Module.LMS)
require_research = require_module(ModuleGrant.Module.RESEARCH)
require_core = require_module(ModuleGrant.Module.CORE)
