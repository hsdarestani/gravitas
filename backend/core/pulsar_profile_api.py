import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .pulsar_runtime.profiles import snapshot, update_profile
from .pulsar_runtime.skills import SkillRegistry
from .pulsar_runtime.tools import ToolRegistry


@require_http_methods(['GET', 'PATCH'])
def pulsar_memory_profile(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        try:
            update_profile(request.user, data)
        except ValueError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=400)

    profile = snapshot(request.user)
    skills = SkillRegistry()
    tool_registry = ToolRegistry()
    return JsonResponse({
        'ok': True,
        'profile': profile,
        'skills': [{
            'name': skill.name,
            'description': skill.description,
            'enabled': skill.name in set(profile['allowed_skills']),
            'risk_ceiling': skill.risk_ceiling,
            'tools': list(tool_registry.allowed_names(skill_name=skill.name, profile=profile)),
        } for skill in skills.all() if skill.requires_auth],
        'principle': (
            'The memory profile narrows Pulsar capabilities. Live server ACLs remain the hard ceiling '
            'and are rechecked for every read and write.'
        ),
    })
