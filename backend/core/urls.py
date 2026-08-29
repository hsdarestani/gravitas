from django.urls import path

from core.content_api import content_detail, content_list
from core.kpi import kpi_summary
from core.operating_api import (
    cycle_detail,
    cycles,
    key_result_detail,
    key_results,
    meeting_detail,
    meetings,
    milestone_detail,
    milestones,
    objective_detail,
    objectives,
    process_detail,
    processes,
)
from core.operating_api_v2 import (
    initiative_detail,
    initiatives,
    risk_detail,
    risks,
    task_detail,
    tasks,
    work_package_detail,
    work_packages,
)
from core.operating_api_v3 import operating_dashboard
from core.platform_api import (
    community_project_detail,
    community_projects,
    entity_links,
    mindmap_detail,
    mindmaps,
    platform_project_detail,
    platform_projects,
    project_application_detail,
    project_deliverables,
    researcher_me,
    researchers,
    research_request_detail,
    research_requests,
    shared_link,
    shared_with_me,
    sharing,
)
from core.platform_runtime_v3 import (
    content_work_detail_v3,
    content_work_items_v3,
    install_runtime,
    platform_bootstrap_v3,
    platform_dashboard_v3,
)

# Install canonical workspace resolution before the remaining V2 modules import
# their workspace helper. Core is explicit internal membership; Research is the
# shared project/object ACL context.
install_runtime()

from core.platform_objects_api import shared_task_detail
from core.platform_resources_api import (
    platform_file_download,
    platform_file_upload,
    platform_resource_detail,
    platform_resources,
    shared_file_download,
)
from core.workspace_api import (
    collection_detail,
    collections,
    file_download,
    file_upload,
    project_detail,
    projects,
    resource_detail,
    resources,
    knowledge_link_detail,
    knowledge_links,
    storage_status,
    tag_detail,
    tags,
    workspace_dashboard,
)
from core.views import (
    auth_csrf,
    auth_delete,
    auth_export,
    auth_login,
    auth_logout,
    auth_me,
    auth_signup,
    comments,
    health,
    lab_progress,
    newsletter_confirm,
    newsletter_subscribe,
    password_reset_confirm,
    password_reset_request,
)

urlpatterns = [
    path('health/', health),
    path('content/', content_list),
    path('content/<slug:slug>/', content_detail),
    path('newsletter/subscribe/', newsletter_subscribe),
    path('newsletter/confirm/', newsletter_confirm),
    path('auth/csrf/', auth_csrf),
    path('auth/signup/', auth_signup),
    path('auth/login/', auth_login),
    path('auth/logout/', auth_logout),
    path('auth/me/', auth_me),
    path('auth/export/', auth_export),
    path('auth/delete/', auth_delete),
    path('auth/password-reset/', password_reset_request),
    path('auth/password-reset/confirm/', password_reset_confirm),
    path('community/comments/<slug:content_key>/', comments),
    path('lab/progress/<slug:lab_key>/', lab_progress),
    path('analytics/kpi/', kpi_summary),

    # Gravitas V3 shell: Home + two real workspaces.
    path('platform/bootstrap/', platform_bootstrap_v3),
    path('platform/dashboard/', platform_dashboard_v3),
    path('platform/projects/', platform_projects),
    path('platform/projects/<int:project_id>/', platform_project_detail),
    path('platform/projects/<int:project_id>/deliverables/', project_deliverables),
    path('platform/projects/<int:project_id>/applications/<int:application_id>/', project_application_detail),
    path('platform/content/', content_work_items_v3),
    path('platform/content/<int:item_id>/', content_work_detail_v3),
    path('platform/research-requests/', research_requests),
    path('platform/research-requests/<int:request_id>/', research_request_detail),
    path('platform/tasks/<int:task_id>/', shared_task_detail),
    path('platform/resources/', platform_resources),
    path('platform/resources/<int:resource_id>/', platform_resource_detail),
    path('platform/files/upload/', platform_file_upload),
    path('platform/files/<int:resource_id>/download/', platform_file_download),
    path('platform/share/', sharing),
    path('platform/shared-with-me/', shared_with_me),
    path('platform/shared/<uuid:token>/', shared_link),
    path('platform/shared/<uuid:token>/download/', shared_file_download),
    path('platform/community/projects/', community_projects),
    path('platform/community/projects/<slug:public_slug>/', community_project_detail),
    path('platform/researchers/', researchers),
    path('platform/researchers/me/', researcher_me),
    path('platform/mindmaps/', mindmaps),
    path('platform/mindmaps/<int:map_id>/', mindmap_detail),
    path('platform/links/', entity_links),

    # Core Operating Workspace: internal Gravitas team only. The V3 runtime
    # resolves every operating request to the canonical Core workspace.
    path('operating/dashboard/', operating_dashboard),
    path('operating/processes/', processes),
    path('operating/processes/<int:process_id>/', process_detail),
    path('operating/objectives/', objectives),
    path('operating/objectives/<int:objective_id>/', objective_detail),
    path('operating/key-results/', key_results),
    path('operating/key-results/<int:kr_id>/', key_result_detail),
    path('operating/initiatives/', initiatives),
    path('operating/initiatives/<int:initiative_id>/', initiative_detail),
    path('operating/cycles/', cycles),
    path('operating/cycles/<int:cycle_id>/', cycle_detail),
    path('operating/milestones/', milestones),
    path('operating/milestones/<int:milestone_id>/', milestone_detail),
    path('operating/work-packages/', work_packages),
    path('operating/work-packages/<int:work_package_id>/', work_package_detail),
    path('operating/tasks/', tasks),
    path('operating/tasks/<int:task_id>/', task_detail),
    path('operating/risks/', risks),
    path('operating/risks/<int:risk_id>/', risk_detail),
    path('operating/meetings/', meetings),
    path('operating/meetings/<int:meeting_id>/', meeting_detail),

    # Legacy personal KMS APIs stay available for private-scope data and
    # backward compatibility, but V3 no longer presents them as a workspace.
    path('workspace/dashboard/', workspace_dashboard),
    path('workspace/projects/', projects),
    path('workspace/projects/<int:project_id>/', project_detail),
    path('workspace/knowledge/', resources),
    path('workspace/knowledge/<int:resource_id>/', resource_detail),
    path('workspace/knowledge/<int:resource_id>/links/', knowledge_links),
    path('workspace/knowledge/<int:resource_id>/links/<int:link_id>/', knowledge_link_detail),
    path('workspace/files/upload/', file_upload),
    path('workspace/files/<int:resource_id>/download/', file_download),
    path('workspace/collections/', collections),
    path('workspace/collections/<int:collection_id>/', collection_detail),
    path('workspace/tags/', tags),
    path('workspace/tags/<int:tag_id>/', tag_detail),
    path('workspace/storage/', storage_status),
]
