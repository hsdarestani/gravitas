from django.contrib import admin
from django.urls import include, path

from core.ai_mindmap import generate_mindmap_ai
from core.assistant_api import assistant_ask
from core.ai_provider_api import ai_provider_detail, ai_providers
from core.content_api import content_page
from core.kms_api import kms_state
from core.legacy_folder_cleanup import project_legacy_folders
from core.nextcloud_public_api import nextcloud_client_credentials_canonical, nextcloud_status_canonical
from core.oidc_provider import (
    nextcloud_sso,
    oidc_authorize,
    oidc_discovery,
    oidc_jwks,
    oidc_token,
    oidc_userinfo,
)
from core.operating_api_v4 import operating_dashboard, milestones, risks, tasks, work_packages
from core.project_cockpit_v2 import project_cockpit
from core.research_deliverable_api import project_deliverable_detail
from core.research_milestone_api import project_milestone_detail, project_milestones
from core.roadmap_okr import roadmap_okr_sync
from core.space_api import space_tree
from core.space_full_api import (
    space_item_detail,
    space_items,
    space_node_detail,
    space_note_full,
    space_notes_full,
    space_project_full,
    space_sync_full,
)
from core.space_reconcile_full import reconcile_space_complete
from core.workspace_pages_api import workspace_page_detail, workspace_pages

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
    path('api/platform/ai/ask/', assistant_ask),
    path('api/platform/ai/providers/<int:provider_id>/', ai_provider_detail),
    path('api/platform/space/tree/', space_tree),
    path('api/platform/space/nodes/<int:node_id>/', space_node_detail),
    path('api/platform/space/projects/<int:project_id>/', space_project_full),
    path('api/platform/space/notes/', space_notes_full),
    path('api/platform/space/notes/<int:resource_id>/', space_note_full),
    path('api/platform/space/items/', space_items),
    path('api/platform/space/items/<int:item_id>/', space_item_detail),
    path('api/platform/space/sync/', space_sync_full),
    path('api/platform/space/reconcile/', reconcile_space_complete),
    path('api/platform/pages/', workspace_pages),
    path('api/platform/pages/<str:page_id>/', workspace_page_detail),
    path('api/platform/kms/state/', kms_state),
    # Safe cleanup for the six fixed folders created by older Gravitas builds.
    # This route precedes core.urls so it remains canonical even as the legacy
    # project API surface evolves.
    path('api/platform/projects/<int:project_id>/legacy-folders/', project_legacy_folders),
    # These canonical wrappers intentionally precede the legacy core.urls
    # routes with the same URLs.
    path('api/platform/nextcloud/', nextcloud_status_canonical),
    path('api/platform/nextcloud/client-credentials/', nextcloud_client_credentials_canonical),
    path('api/platform/nextcloud/sso/', nextcloud_sso),
    path('api/platform/projects/<int:project_id>/cockpit/', project_cockpit),
    # Research milestones share the canonical Core operating objects, but the
    # Research surface owns their project ACL and mutation controls.
    path('api/platform/projects/<int:project_id>/milestones/', project_milestones),
    path('api/platform/projects/<int:project_id>/milestones/<int:milestone_id>/', project_milestone_detail),
    path('api/platform/projects/<int:project_id>/deliverables/<int:deliverable_id>/', project_deliverable_detail),
    # Bridge Core planning to the separate canonical Research workspace. These
    # routes intentionally shadow the legacy operating endpoints in core.urls.
    path('api/operating/dashboard/', operating_dashboard),
    path('api/operating/milestones/', milestones),
    path('api/operating/work-packages/', work_packages),
    path('api/operating/tasks/', tasks),
    path('api/operating/risks/', risks),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
