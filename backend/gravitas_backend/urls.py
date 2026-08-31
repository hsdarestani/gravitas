from django.contrib import admin
from django.urls import include, path

from core.ai_mindmap import generate_mindmap_ai
from core.ai_provider_api import ai_provider_detail, ai_providers
from core.content_api import content_page
from core.nextcloud_public_api import nextcloud_client_credentials_canonical
from core.roadmap_okr import roadmap_okr_sync
from core.space_api import space_note, space_notes, space_project, space_sync, space_tree
from core.space_reconcile import reconcile_space_from_nextcloud

urlpatterns = [
    path('admin/', admin.site.urls),
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
    # Keep official Nextcloud clients on the canonical host after the optional
    # cloud.gravitasplus.com migration. This route intentionally precedes the
    # legacy core.urls route with the same URL.
    path('api/platform/nextcloud/client-credentials/', nextcloud_client_credentials_canonical),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
