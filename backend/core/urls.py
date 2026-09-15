from django.urls import path

from core.content_api import content_detail, content_list
from core.core_links_api import task_cross_layer_links
from core.email_verification import account_email_confirm, account_email_resend
from core.kpi import kpi_summary
from core.reader_library import reader_library
from core.member_api import member_dashboard
from core.initiative_planner import initiative_planner
from core.task_reorder_api import reorder_tasks
from core.workspace_pages_api import (
    workspace_page_attachment,
    workspace_page_backlinks,
    workspace_page_detail,
    workspace_pages,
)
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
)
from core.project_cockpit import project_access_candidates, project_cockpit
from core.research_project_tools import (
    project_discussion_detail,
    project_discussions,
    project_experiment_detail,
    project_experiments,
    project_milestones,
)
from core.research_task_api import project_tasks as research_project_tasks
from core.nextcloud_api import (
    nextcloud_client_credentials,
    nextcloud_status,
    project_folder_detail,
    project_folders,
    project_nextcloud_sync,
    sharing_v4,
)
from core.nextcloud_deck import deck_status
from core.nextcloud_deck_access import deck_sync_with_access
from core.nextcloud_notes import (
    native_note_detail,
    native_note_resolve,
    native_notes,
    native_notes_sync,
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

from core.layer_admin_api import (
    platform_admin_activity,
    platform_admin_overview,
    platform_admin_user_detail,
    platform_admin_users,
)
from core.platform_admin_extended import (
    admin_lms_enrollment_detail,
    admin_lms_enrollments,
    admin_research_project_detail,
    admin_research_projects,
)
from core.layer_guards import require_research_or_core
from core.lms_api import (
    lms_assessment_attempt,
    lms_course_detail,
    lms_course_enroll,
    lms_courses,
    lms_lesson_progress,
    lms_me,
)
from core.site_admin_api import (
    admin_site_comment_detail,
    admin_site_comments,
    admin_site_content,
    admin_site_content_detail,
)
from core.platform_objects_api import shared_task_detail
from core.platform_resources_api import (
    platform_file_download,
    platform_file_upload,
    platform_resource_detail,
    platform_resources,
    shared_file_download,
)
from core.team_api import core_team, core_team_member, core_team_password_reset
from core.team_storage_api import team_storage, team_storage_user
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
    password_change,
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
    path('auth/email-confirm/', account_email_confirm),
    path('auth/email-confirm/resend/', account_email_resend),
    path('auth/password-change/', password_change),
    path('auth/password-reset/', password_reset_request),
    path('auth/password-reset/confirm/', password_reset_confirm),
    path('community/comments/<slug:content_key>/', comments),
    path('lab/progress/<slug:lab_key>/', lab_progress),
    path('analytics/kpi/', kpi_summary),
    path('reader/library/', reader_library),

    # Five-layer bootstrap and Layer 2 account home.
    path('platform/bootstrap/', platform_bootstrap_v3),
    path('platform/dashboard/', platform_dashboard_v3),
    path('member/dashboard/', member_dashboard),

    # Layer 5 control plane. These routes are deliberately separate from the
    # participant APIs below: Core administrators can operate every layer
    # without receiving a fake Learner or Researcher identity.
    path('platform/admin/overview/', platform_admin_overview),
    path('platform/admin/users/', platform_admin_users),
    path('platform/admin/users/<int:user_id>/', platform_admin_user_detail),
    path('platform/admin/activity/', platform_admin_activity),
    path('platform/admin/site/content/', admin_site_content),
    path('platform/admin/site/content/<int:item_id>/', admin_site_content_detail),
    path('platform/admin/site/comments/', admin_site_comments),
    path('platform/admin/site/comments/<int:comment_id>/', admin_site_comment_detail),
    path('platform/admin/research/projects/', admin_research_projects),
    path('platform/admin/research/projects/<int:project_id>/', admin_research_project_detail),
    path('platform/admin/lms/enrollments/', admin_lms_enrollments),
    path('platform/admin/lms/enrollments/<int:enrollment_id>/', admin_lms_enrollment_detail),
    path('platform/admin/deck/', deck_status),
    path('platform/admin/deck/sync/', deck_sync_with_access),
    path('platform/team/', core_team),
    path('platform/team/storage/', team_storage),
    path('platform/team/<int:user_id>/', core_team_member),
    path('platform/team/<int:user_id>/password-reset/', core_team_password_reset),
    path('platform/team/<int:user_id>/storage/', team_storage_user),

    # Layer 4. A Research participant may enter directly. Layer 5 may also
    # operate these endpoints as the control plane without being labelled a
    # Research participant. The existing object/project ACL remains final.
    path('platform/projects/', require_research_or_core(platform_projects)),
    path('platform/projects/<int:project_id>/', require_research_or_core(platform_project_detail)),
    path('platform/projects/<int:project_id>/cockpit/', require_research_or_core(project_cockpit)),
    path('platform/projects/<int:project_id>/tasks/', require_research_or_core(research_project_tasks)),
    path('platform/projects/<int:project_id>/access-candidates/', require_research_or_core(project_access_candidates)),
    path('platform/projects/<int:project_id>/milestones/', require_research_or_core(project_milestones)),
    path('platform/projects/<int:project_id>/experiments/', require_research_or_core(project_experiments)),
    path('platform/projects/<int:project_id>/experiments/<int:experiment_id>/', require_research_or_core(project_experiment_detail)),
    path('platform/projects/<int:project_id>/discussions/', require_research_or_core(project_discussions)),
    path('platform/projects/<int:project_id>/discussions/<int:message_id>/', require_research_or_core(project_discussion_detail)),
    path('platform/projects/<int:project_id>/deliverables/', require_research_or_core(project_deliverables)),
    path('platform/projects/<int:project_id>/applications/<int:application_id>/', require_research_or_core(project_application_detail)),
    path('platform/projects/<int:project_id>/folders/', require_research_or_core(project_folders)),
    path('platform/projects/<int:project_id>/folders/<int:collection_id>/', require_research_or_core(project_folder_detail)),
    path('platform/projects/<int:project_id>/nextcloud/sync/', require_research_or_core(project_nextcloud_sync)),
    path('platform/research-requests/', require_research_or_core(research_requests)),
    path('platform/research-requests/<int:request_id>/', require_research_or_core(research_request_detail)),
    path('platform/researchers/', require_research_or_core(researchers)),
    path('platform/researchers/me/', require_research_or_core(researcher_me)),
    path('platform/mindmaps/', require_research_or_core(mindmaps)),
    path('platform/mindmaps/<int:map_id>/', require_research_or_core(mindmap_detail)),

    # Shared platform services. Their own ACL checks decide which object is
    # visible because the same resource/file can be linked from more than one
    # product layer.
    path('platform/nextcloud/', nextcloud_status),
    path('platform/nextcloud/client-credentials/', nextcloud_client_credentials),
    path('platform/nextcloud/notes/', native_notes),
    path('platform/nextcloud/notes/sync/', native_notes_sync),
    path('platform/nextcloud/notes/<int:resource_id>/resolve/', native_note_resolve),
    path('platform/nextcloud/notes/<int:resource_id>/', native_note_detail),
    path('platform/content/', content_work_items_v3),
    path('platform/content/<int:item_id>/', content_work_detail_v3),
    path('platform/tasks/<int:task_id>/', shared_task_detail),
    path('platform/resources/', platform_resources),
    path('platform/resources/<int:resource_id>/', platform_resource_detail),
    path('platform/files/upload/', platform_file_upload),
    path('platform/files/<int:resource_id>/download/', platform_file_download),
    path('platform/share/', sharing_v4),
    path('platform/shared-with-me/', shared_with_me),
    path('platform/shared/<uuid:token>/', shared_link),
    path('platform/shared/<uuid:token>/download/', shared_file_download),
    path('platform/community/projects/', community_projects),
    path('platform/community/projects/<slug:public_slug>/', community_project_detail),
    path('platform/links/', entity_links),

    # Layer 3 — LMS. Catalog reads are public; enrollment/progress APIs enforce
    # learner access and authoring is limited to Core owner/admin accounts.
    path('lms/courses/', lms_courses),
    path('lms/courses/<int:course_id>/', lms_course_detail),
    path('lms/courses/<int:course_id>/enroll/', lms_course_enroll),
    path('lms/me/', lms_me),
    path('lms/lessons/<int:lesson_id>/progress/', lms_lesson_progress),
    path('lms/assessments/<int:assessment_id>/attempt/', lms_assessment_attempt),

    # Layer 5 operating system: internal Gravitas team only. Existing runtime
    # resolution pins every call to the canonical Core workspace.
    path('operating/dashboard/', operating_dashboard),
    path('operating/initiative-planner/', initiative_planner),
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
    path('operating/tasks/reorder/', reorder_tasks),
    path('operating/tasks/<int:task_id>/links/', task_cross_layer_links),
    path('operating/tasks/<int:task_id>/', task_detail),
    path('operating/risks/', risks),
    path('operating/risks/<int:risk_id>/', risk_detail),
    path('operating/meetings/', meetings),
    path('operating/meetings/<int:meeting_id>/', meeting_detail),

    # Legacy private KMS storage remains for note/learning internals and URL
    # compatibility. It is no longer presented as a sixth product surface.
    path('workspace/dashboard/', workspace_dashboard),
    path('workspace/pages/', workspace_pages),
    path('workspace/pages/<str:page_id>/', workspace_page_detail),
    path('workspace/pages/<str:page_id>/backlinks/', workspace_page_backlinks),
    path('workspace/pages/<str:page_id>/attachments/', workspace_page_attachment),
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