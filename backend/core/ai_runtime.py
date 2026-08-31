import contextvars
import json

from . import mindmap_ai
from .ai_providers import AIProviderAccount, AIProviderError, default_provider, generate_mindmap_graph


_current_user = contextvars.ContextVar('gravitas_ai_user', default=None)
_current_provider_id = contextvars.ContextVar('gravitas_ai_provider_id', default=None)
_original_cloudflare_graph = mindmap_ai._cloudflare_graph
_installed = False


def _routed_graph(prompt, *, max_nodes):
    user = _current_user.get()
    if user is None:
        return _original_cloudflare_graph(prompt, max_nodes=max_nodes)
    provider_id = _current_provider_id.get()
    try:
        account = None
        if provider_id:
            account = AIProviderAccount.objects.filter(pk=provider_id, user=user, enabled=True).first()
        account = account or default_provider(user)
        if account.provider == AIProviderAccount.Provider.GRAVITAS:
            return _original_cloudflare_graph(prompt, max_nodes=max_nodes)
        return generate_mindmap_graph(user, prompt, max_nodes=max_nodes, provider_id=provider_id)
    except AIProviderError as exc:
        raise RuntimeError(str(exc)) from exc


def install_ai_runtime():
    global _installed
    if _installed:
        return
    mindmap_ai._cloudflare_graph = _routed_graph
    _installed = True


def generate_mindmap_ai_routed(request, map_id):
    install_ai_runtime()
    provider_id = None
    try:
        payload = json.loads(request.body or '{}')
        if payload.get('provider_id'):
            provider_id = int(payload['provider_id'])
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
        provider_id = None
    user_token = _current_user.set(request.user if request.user.is_authenticated else None)
    provider_token = _current_provider_id.set(provider_id)
    try:
        return mindmap_ai.generate_mindmap_ai(request, map_id)
    finally:
        _current_provider_id.reset(provider_token)
        _current_user.reset(user_token)
