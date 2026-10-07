from copy import deepcopy

from .errors import PulsarPermissionError


DEFAULT_ALLOWED_SKILLS = ('learning', 'research', 'project_task')
DEFAULT_PERMISSION_SCOPE = {
    'learning': {'read': True, 'write_interactions': 'approval'},
    'research': {'read': True, 'write': 'approval'},
    'project_task': {'read': True, 'write': 'approval'},
}
DEFAULT_APPROVALS = {
    'r0': 'auto',
    'r1': 'auto',
    'r2': 'approval',
    'r3': 'explicit',
}


def _model():
    from core.models import PulsarUserMemoryProfile
    return PulsarUserMemoryProfile


def ensure_profile(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    model = _model()
    profile, _ = model.objects.get_or_create(
        user=user,
        defaults={
            'allowed_skills': list(DEFAULT_ALLOWED_SKILLS),
            'permission_scope': deepcopy(DEFAULT_PERMISSION_SCOPE),
            'approval_defaults': deepcopy(DEFAULT_APPROVALS),
            'preferences': {},
        },
    )
    return profile


def snapshot(user):
    profile = ensure_profile(user)
    if profile is None:
        return {
            'user_id': None,
            'version': 0,
            'allowed_skills': ['public', 'general'],
            'permission_scope': {},
            'approval_defaults': {},
            'preferences': {},
        }
    return {
        'user_id': profile.user_id,
        'version': profile.version,
        'allowed_skills': list(profile.allowed_skills or []),
        'permission_scope': dict(profile.permission_scope or {}),
        'approval_defaults': dict(profile.approval_defaults or {}),
        'preferences': dict(profile.preferences or {}),
    }


def assert_skill_allowed(user, skill_name):
    skill_name = str(skill_name or '').strip().lower()
    if skill_name in {'public', 'general'}:
        return
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    profile = ensure_profile(user)
    allowed = {str(value).strip().lower() for value in (profile.allowed_skills or [])}
    if skill_name not in allowed:
        raise PulsarPermissionError(f'pulsar_skill_not_allowed:{skill_name}')


def update_profile(user, data):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    data = data if isinstance(data, dict) else {}
    profile = ensure_profile(user)

    if 'allowed_skills' in data:
        raw = data.get('allowed_skills')
        if not isinstance(raw, list):
            raise ValueError('allowed_skills_must_be_list')
        valid = set(DEFAULT_ALLOWED_SKILLS)
        values = []
        for value in raw:
            name = str(value or '').strip().lower()
            if not name or name not in valid:
                raise ValueError(f'invalid_skill:{name or "empty"}')
            if name not in values:
                values.append(name)
        profile.allowed_skills = values

    if 'permission_scope' in data:
        value = data.get('permission_scope')
        if not isinstance(value, dict):
            raise ValueError('permission_scope_must_be_object')
        clean = {}
        for skill, scope in value.items():
            name = str(skill or '').strip().lower()
            if name not in set(DEFAULT_ALLOWED_SKILLS):
                raise ValueError(f'invalid_permission_skill:{name}')
            if not isinstance(scope, dict):
                raise ValueError(f'invalid_permission_scope:{name}')
            clean[name] = dict(scope)
        profile.permission_scope = clean

    if 'approval_defaults' in data:
        value = data.get('approval_defaults')
        if not isinstance(value, dict):
            raise ValueError('approval_defaults_must_be_object')
        allowed = {'auto', 'approval', 'explicit', 'deny'}
        clean = {}
        for level in ('r0', 'r1', 'r2', 'r3'):
            if level not in value:
                continue
            mode = str(value[level] or '').strip().lower()
            if mode not in allowed:
                raise ValueError(f'invalid_approval_mode:{level}')
            clean[level] = mode
        profile.approval_defaults = clean

    if 'preferences' in data:
        value = data.get('preferences')
        if not isinstance(value, dict):
            raise ValueError('preferences_must_be_object')
        profile.preferences = dict(value)

    profile.version = int(profile.version or 0) + 1
    profile.save(update_fields=[
        'allowed_skills',
        'permission_scope',
        'approval_defaults',
        'preferences',
        'version',
        'updated_at',
    ])
    return profile
