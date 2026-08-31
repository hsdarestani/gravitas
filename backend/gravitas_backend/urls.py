from django.contrib import admin
from django.urls import include, path

from core.ai_mindmap import generate_mindmap_ai
from core.ai_provider_api import ai_provider_detail, ai_providers
from core.content_api import content_page
from core.nextcloud_public_api import nextcloud_client_credentials_canonical, nextcloud_status_canonical
from core.oidc_provider import (
    nextcloud_sso,
    oidc_authorize,
    oidc_discovery,
    oidc_jwks,
    oidc_token,
    oidc_userinfo,
)
from core.roadmap_okr import roadmap_okr_sync
from core.space_api import space_note, space_notes, space_project, space_sync, space_tree
from core.space_reconcile import reconcile_space_from_nextcloud

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/oidc/.well-known/openid-configuration', oidc_discovery),
    path('api/oidc/authorize/', oidc_authorize),
    path('api/oidc/token/', oidc_token),
    path('api/oidc/jwks/', oidc_jwks),
    path('api/oidc/userinfo/', oidc_userinfo),
    path('api/operating/roadmap-sync/', roadmap_okr_sync),
    path('api/platform/mindmaps/<int:map_id>/ai/', generate_mindmap_ai),
    path('api/platform/ai/providers/', ai_providers),
    path('api/platform/ai/providers/<int:provider_id>/', ai_provider_detail),
    path('api/platform/space/tree/', space_tree),
    path('api/platform/space/projects/<int:project_id>/', space_project),
    path('api/platform/space/notes/', space_notes),
    path('api/platform/space/notes/<int:resource_id>/', space_note),
    path('api/platform/space/sync/', space_sync),
    path('api/platform/space/reconcile/', reconcile_space_from_nextcloud),
    # These canonical wrappers intentionally precede the legacy core.urls
    # routes with the same URLs.
    path('api/platform/nextcloud/', nextcloud_status_canonical),
    path('api/platform/nextcloud/client-credentials/', nextcloud_client_credentials_canonical),
    path('api/platform/nextcloud/sso/', nextcloud_sso),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
