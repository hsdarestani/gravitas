"""Project tool catalog and validation.

Selecting a tool records an intention, not a live external connection. Never
accept credentials here or claim that a database, Git remote or compute service
has been provisioned. Future plugin providers can extend the server catalog
without changing the project-create payload.
"""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods


CATALOG = (
    {"id": "git", "name": "Git", "description": "Repository and version history", "group": "core"},
    {"id": "database", "name": "Database", "description": "Project datasets and queries", "group": "core"},
    {"id": "lab_journal", "name": "Lab Journal", "description": "Experiments, protocols and results", "group": "core"},
    {"id": "data_analysis", "name": "Data Analysis", "description": "Notebooks and analysis tools", "group": "advanced"},
    {"id": "compute", "name": "Compute", "description": "Private compute resources", "group": "advanced"},
    {"id": "machine_learning", "name": "Machine Learning", "description": "Models and training tools", "group": "advanced"},
)
ALLOWED_IDS = frozenset(item["id"] for item in CATALOG)


def validate_project_tools(data):
    """Return validated selections; reject malformed or unknown tool IDs.

    Keep free-text *requests* separate from installed/selected integrations.
    This prevents arbitrary strings from being interpreted as executable plugin
    identifiers or as provider credentials.
    """
    selected = data.get("selected_integrations", [])
    requested = data.get("requested_plugins", [])
    if not isinstance(selected, list) or len(selected) > len(CATALOG):
        raise ValueError("invalid_selected_integrations")
    if any(not isinstance(v, str) or v not in ALLOWED_IDS for v in selected):
        raise ValueError("invalid_selected_integrations")
    if len(set(selected)) != len(selected):
        raise ValueError("duplicate_selected_integrations")
    if not isinstance(requested, list) or len(requested) > 8:
        raise ValueError("invalid_requested_plugins")
    if any(not isinstance(v, str) or not v.strip() or len(v.strip()) > 80 for v in requested):
        raise ValueError("invalid_requested_plugins")
    cleaned = [v.strip() for v in requested]
    if len({v.casefold() for v in cleaned}) != len(cleaned):
        raise ValueError("duplicate_requested_plugins")
    return selected, cleaned


@require_http_methods(["GET"])
def project_integration_catalog(request):
    from .platform_api import _auth
    if response := _auth(request):
        return response
    return JsonResponse({
        "ok": True,
        "integrations": [{**item, "connection_state": "setup_required"} for item in CATALOG],
        "note": "Selections are saved with the project. External tools require separate secure setup.",
    })
