from django.contrib import admin
from django.urls import include, path

from core.ai_mindmap import generate_mindmap_ai
from core.annotation_api import annotation_detail, annotations
from core.assistant_api import assistant_ask
from core.ai_provider_api import ai_provider_detail, ai_providers
from core.content_api import content_page
from core.kms_api import kms_state
from core.layer_guards import require_core, require_lms, require_research_or_core
from core.legacy_folder_cleanup import project_legacy_folders
from core.nextcloud_notes_fast_api import native_notes_fast
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
from core.pulsar_api import public_pulsar_ask
from core.lab_api import public_lab_detail, public_labs, run_lab_file
from core.project_space_api import platform_projects_with_space
from core.research_deliverable_api import project_deliverable_detail
from core.research_intelligence_api import research_intelligence, research_intelligence_saved
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
from core.structural_access_api import (
    platform_dashboard_acl_safe,
    platform_file_upload_strict,
    platform_project_detail_acl_safe,
    project_application_detail_synced,
    project_nextcloud_sync_manage,
    research_request_detail_synced,
)
from core.shared_service_access import (
    entity_links_layer_safe,
    platform_file_download_layer_safe,
    platform_resource_detail_layer_safe,
    platform_resources_layer_safe,
    shared_file_download_core_safe,
    shared_link_core_safe,
    shared_task_detail_layer_safe,
    shared_with_me_layer_safe,
)
from core.sharing_consistency_api import sharing_v5
from core.workspace_pages_api import workspace_page_detail, workspace_pages

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/oidc/.well-known/openid-configuration', oidc_discovery),
    path('api/oidc/authorize/', oidc_authorize),
    path('api/oidc/token/', oidc_token),
    path('api/oidc/jwks/', oidc_jwks),
    path('api/oidc/userinfo/', oidc_userinfo),
    path('api/operating/roadmap-sync/', roadmap_okr_sync),
    path('api/platform/mindmaps/<int:map_id>/ai/', require_research_or_core(generate_mindmap_ai)),
    path('api/labs/', public_labs),
    path('api/labs/<slug:slug>/', public_lab_detail),
    path('lab-run/<slug:slug>/', run_lab_file),
    path('lab-run/<slug:slug>/<path:file_path>', run_lab_file),
    path('api/platform/ai/providers/', ai_providers),
    path('api/platform/ai/ask/', assistant_ask),
    path('api/pulsar/ask/', public_pulsar_ask),
    path('api/platform/ai/providers/<int:provider_id>/', ai_provider_detail),
    path('api/platform/space/tree/', require_research_or_core(space_tree)),
    path('api/platform/space/nodes/<int:node_id>/', require_research_or_core(space_node_detail)),
    path('api/platform/space/projects/<int:project_id>/', require_research_or_core(space_project_full)),
    path('api/platform/space/notes/', require_research_or_core(space_notes_full)),
    path('api/platform/space/notes/<int:resource_id>/', require_research_or_core(space_note_full)),
    path('api/platform/space/items/', require_research_or_core(space_items)),
    path('api/platform/space/items/<int:item_id>/', require_research_or_core(space_item_detail)),
    path('api/platform/space/sync/', require_research_or_core(space_sync_full)),
    path('api/platform/space/reconcile/', require_research_or_core(reconcile_space_complete)),
    path('api/platform/pages/', require_research_or_core(workspace_pages)),
    path('api/platform/pages/<str:page_id>/', require_research_or_core(workspace_page_detail)),
    path('api/platform/kms/state/', require_lms(kms_state)),
    # Space-aware project creation is canonical for the workspace UI. Existing
    # integrations that omit space_category_id are delegated unchanged to the
    # legacy platform creator.
    path('api/platform/projects/', require_research_or_core(platform_projects_with_space)),
    # Threaded document annotations are separate from general project
    # discussion and inherit the project's Research/Core product gate.
    path('api/platform/annotations/', require_research_or_core(annotations)),
    path('api/platform/annotations/<int:annotation_id>/', require_research_or_core(annotation_detail)),
    # Safe cleanup for the six fixed folders created by older Gravitas builds.
    # This route precedes core.urls so it remains canonical even as the legacy
    # project API surface evolves.
    path('api/platform/projects/<int:project_id>/legacy-folders/', project_legacy_folders),
    # These canonical wrappers intentionally precede the legacy core.urls
    # routes with the same URLs.
    path('api/platform/nextcloud/', require_research_or_core(nextcloud_status_canonical)),
    path('api/platform/nextcloud/client-credentials/', require_research_or_core(nextcloud_client_credentials_canonical)),
    path('api/platform/nextcloud/sso/', require_research_or_core(nextcloud_sso)),
    # Notes first paint is local-only. The existing sync endpoint still performs
    # the full conflict-safe reconciliation after the page has rendered.
    path('api/platform/nextcloud/notes/', require_research_or_core(native_notes_fast)),
    path('api/platform/dashboard/', platform_dashboard_acl_safe),
    path('api/platform/research-intelligence/', require_core(research_intelligence)),
    path('api/platform/research-intelligence/saved/', require_core(research_intelligence_saved)),
    path('api/platform/projects/<int:project_id>/', platform_project_detail_acl_safe),
    path('api/platform/links/', entity_links_layer_safe),
    path('api/platform/share/', sharing_v5),
    # Shared-service routes need both object ACL and product-layer entitlement.
    # A stale direct grant must not manufacture Core access, while a task that
    # physically lives in Core but belongs to a Research project stays a
    # Research object for entitlement purposes.
    path('api/platform/resources/', platform_resources_layer_safe),
    path('api/platform/resources/<int:resource_id>/', platform_resource_detail_layer_safe),
    path('api/platform/files/<int:resource_id>/download/', platform_file_download_layer_safe),
    path('api/platform/tasks/<int:task_id>/', shared_task_detail_layer_safe),
    path('api/platform/shared-with-me/', shared_with_me_layer_safe),
    # Close historical Layer-5 public links without breaking legitimate
    # Research/client share links.
    path('api/platform/shared/<uuid:token>/', shared_link_core_safe),
    path('api/platform/shared/<uuid:token>/download/', shared_file_download_core_safe),
    path('api/platform/projects/<int:project_id>/cockpit/', require_research_or_core(project_cockpit)),
    # Research milestones share the canonical Core operating objects, but the
    # Research surface owns their project ACL and mutation controls.
    path('api/platform/projects/<int:project_id>/milestones/', require_research_or_core(project_milestones)),
    path('api/platform/projects/<int:project_id>/milestones/<int:milestone_id>/', require_research_or_core(project_milestone_detail)),
    path('api/platform/projects/<int:project_id>/deliverables/<int:deliverable_id>/', require_research_or_core(project_deliverable_detail)),
    # Structural access guards: explicit invalid workspace ids must not fall
    # back to Personal, ACL reconciliation is manager-only, and project access
    # changes must stay synchronized with native Nextcloud membership.
    path('api/platform/files/upload/', platform_file_upload_strict),
    path('api/platform/projects/<int:project_id>/nextcloud/sync/', project_nextcloud_sync_manage),
    path('api/platform/research-requests/<int:request_id>/', research_request_detail_synced),
    path('api/platform/projects/<int:project_id>/applications/<int:application_id>/', project_application_detail_synced),
    # Bridge Core planning to the separate canonical Research workspace. These
    # routes intentionally shadow the legacy operating endpoints in core.urls.
    path('api/operating/dashboard/', require_core(operating_dashboard)),
    path('api/operating/milestones/', require_core(milestones)),
    path('api/operating/work-packages/', require_core(work_packages)),
    path('api/operating/tasks/', require_core(tasks)),
    path('api/operating/risks/', require_core(risks)),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
