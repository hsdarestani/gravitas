from django.urls import path

from core.content_api import community_polls, content_detail, content_list, topic_media, topic_poll
from core.core_links_api import task_cross_layer_links
from core.email_verification import account_email_confirm, account_email_resend
from core.kpi import kpi_summary
from core.google_calendar_api import (
    google_calendar_connect,
    google_calendar_disconnect,
    google_calendar_meeting_sync,
    google_calendar_status,
)
from core.reader_library import reader_library
from core.topic_progress import topic_progress
from core.task_notifications import task_notification_settings, telegram_notification_webhook
from core.support_api import admin_ticket_detail, admin_tickets, member_ticket_detail, member_tickets
from core.newsletter_admin_api import admin_newsletter, admin_newsletter_subscriber
from core.lab_api import admin_lab_detail, admin_labs
from core.content_collab_api import content_attachment_download, content_attachments, content_comments
from core.core_assets_api import core_asset_detail, core_asset_download, core_assets
from core.research_calendar_api import research_calendar
from core.member_api import member_dashboard
from core.initiative_planner import initiative_planner
from core.task_reorder_api import reorder_tasks
from core.task_board_api import (
    task_attachment_delete,
    task_attachment_download,
    task_attachments,
    task_board,
    task_board_detail,
    task_board_move,
    task_checklist,
    task_checklist_item,
    task_comments,
    task_history,
)
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
from core.layer_guards import require_core, require_core_admin, require_lms, require_research_or_core
from core.lms_api import (
    lms_assessment_attempt,
    lms_course_detail,
    lms_course_enroll,
    lms_courses,
    lms_lesson_progress,
    lms_me,
)
from core.lms_extended_api import (
    admin_learning_assets,
    admin_lms_analytics,
    admin_lms_meta,
    admin_openedx_status,
    learning_asset_detail,
    learning_asset_download,
    learning_path_detail,
    learning_paths,
    lms_ai_tutor,
    lms_certificate_download,
    lms_course_export,
    lms_event,
    lms_registration_profile,
    zotero_connection,
    zotero_items,
)
from core.lms_advanced_api import (
    admin_course_payments,
    admin_learning_repositories,
    course_checkout,
    course_payment_webhook,
    course_discussion,
    course_discussion_detail,
    course_git,
    course_notebooks,
    learning_integrations,
    literature_recommendations,
    notebook_execute,
    notebook_export,
    personalized_learning_paths,
    pkm_export,
    social_publish,
)
from core.site_admin_api import (
    admin_site_comment_detail,
    admin_site_comments,
    admin_site_content,
    admin_site_content_detail,
    admin_site_media_upload,
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
    auth_google_callback,
    auth_google_start,
    auth_login,
    auth_logout,
    auth_me,
    auth_signup,
    comment_like,
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
    path('content/<slug:slug>/poll/', topic_poll),
    path('content/<slug:slug>/progress/', topic_progress),
    path('community/polls/', community_polls),
    path('content/media/<str:name>/', topic_media),
    path('newsletter/subscribe/', newsletter_subscribe),
    path('newsletter/confirm/', newsletter_confirm),
    path('auth/csrf/', auth_csrf),
    path('auth/signup/', auth_signup),
    path('auth/login/', auth_login),
    path('auth/google/start/', auth_google_start),
    path('auth/google/callback/', auth_google_callback),
    path('calendar/google/connect/', google_calendar_connect),
    path('calendar/google/status/', google_calendar_status),
    path('calendar/google/disconnect/', google_calendar_disconnect),
    path('calendar/google/meetings/<int:meeting_id>/sync/', google_calendar_meeting_sync),
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
    path('community/comments/<slug:content_key>/<int:comment_id>/like/', comment_like),
    path('lab/progress/<slug:lab_key>/', lab_progress),
    path('analytics/kpi/', kpi_summary),
    path('reader/library/', reader_library),
    path('task-notifications/settings/', task_notification_settings),
    path('task-notifications/telegram/webhook/', telegram_notification_webhook),

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
    path('platform/admin/site/media/', admin_site_media_upload),
    path('platform/admin/site/comments/', admin_site_comments),
    path('platform/admin/site/comments/<int:comment_id>/', admin_site_comment_detail),
    path('platform/admin/research/projects/', admin_research_projects),
    path('platform/admin/research/projects/<int:project_id>/', admin_research_project_detail),
    path('platform/admin/lms/enrollments/', admin_lms_enrollments),
    path('platform/admin/lms/enrollments/<int:enrollment_id>/', admin_lms_enrollment_detail),
    path('platform/admin/deck/', deck_status),
    path('platform/admin/deck/sync/', deck_sync_with_access),
    path('platform/admin/newsletter/', admin_newsletter),
    path('platform/admin/newsletter/subscribers/<int:subscriber_id>/', admin_newsletter_subscriber),
    path('platform/admin/tickets/', admin_tickets),
    path('platform/admin/tickets/<int:ticket_id>/', admin_ticket_detail),
    path('platform/admin/labs/', admin_labs),
    path('platform/admin/labs/<int:lab_id>/', admin_lab_detail),
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
    path('platform/nextcloud/', require_research_or_core(nextcloud_status)),
    path('platform/nextcloud/client-credentials/', require_research_or_core(nextcloud_client_credentials)),
    path('platform/nextcloud/notes/', require_research_or_core(native_notes)),
    path('platform/nextcloud/notes/sync/', require_research_or_core(native_notes_sync)),
    path('platform/nextcloud/notes/<int:resource_id>/resolve/', require_research_or_core(native_note_resolve)),
    path('platform/nextcloud/notes/<int:resource_id>/', require_research_or_core(native_note_detail)),
    path('platform/content/', require_core(content_work_items_v3)),
    path('platform/content/<int:item_id>/', require_core(content_work_detail_v3)),
    path('platform/content/<int:item_id>/comments/', content_comments),
    path('platform/content/<int:item_id>/attachments/', content_attachments),
    path('platform/content/<int:item_id>/attachments/<int:attachment_id>/download/', content_attachment_download),
    path('platform/core-assets/', core_assets),
    path('platform/core-assets/<int:asset_id>/', core_asset_detail),
    path('platform/core-assets/<int:asset_id>/download/', core_asset_download),
    path('platform/research-calendar/', require_research_or_core(research_calendar)),
    path('platform/tasks/<int:task_id>/', require_research_or_core(shared_task_detail)),
    path('platform/resources/', require_research_or_core(platform_resources)),
    path('platform/resources/<int:resource_id>/', require_research_or_core(platform_resource_detail)),
    path('platform/files/upload/', require_research_or_core(platform_file_upload)),
    path('platform/files/<int:resource_id>/download/', require_research_or_core(platform_file_download)),
    path('platform/share/', require_research_or_core(sharing_v4)),
    path('platform/shared-with-me/', require_research_or_core(shared_with_me)),
    path('platform/shared/<uuid:token>/', shared_link),
    path('platform/shared/<uuid:token>/download/', shared_file_download),
    path('platform/community/projects/', community_projects),
    path('platform/community/projects/<slug:public_slug>/', community_project_detail),
    path('platform/links/', require_research_or_core(entity_links)),

    path('member/tickets/', member_tickets),
    path('member/tickets/<int:ticket_id>/', member_ticket_detail),

    # Layer 3 — LMS. Catalog reads are public; enrollment/progress APIs enforce
    # learner access and authoring is limited to Core owner/admin accounts.
    path('lms/courses/', lms_courses),
    path('lms/courses/<int:course_id>/', lms_course_detail),
    path('lms/courses/<int:course_id>/enroll/', lms_course_enroll),
    path('lms/me/', lms_me),
    path('lms/lessons/<int:lesson_id>/progress/', lms_lesson_progress),
    path('lms/assessments/<int:assessment_id>/attempt/', lms_assessment_attempt),
    path('lms/courses/<int:course_id>/events/', lms_event),
    path('lms/courses/<int:course_id>/registration-profile/', lms_registration_profile),
    path('lms/courses/<int:course_id>/ai/', lms_ai_tutor),
    path('lms/courses/<int:course_id>/export/<str:fmt>/', lms_course_export),
    path('lms/certificates/<uuid:code>/download/', lms_certificate_download),
    path('lms/sources/zotero/', zotero_connection),
    path('lms/sources/zotero/items/', zotero_items),
    path('lms/assets/<int:asset_id>/', learning_asset_detail),
    path('lms/assets/<int:asset_id>/download/', learning_asset_download),
    path('lms/paths/', learning_paths),
    path('lms/paths/<int:path_id>/', learning_path_detail),
    path('lms/paths/personalize/', personalized_learning_paths),
    path('lms/integrations/', learning_integrations),
    path('lms/courses/<int:course_id>/checkout/', course_checkout),
    path('lms/courses/<int:course_id>/payment-webhook/', course_payment_webhook),
    path('lms/courses/<int:course_id>/discussion/', course_discussion),
    path('lms/courses/<int:course_id>/discussion/<int:message_id>/', course_discussion_detail),
    path('lms/courses/<int:course_id>/literature/', literature_recommendations),
    path('lms/courses/<int:course_id>/notebooks/', course_notebooks),
    path('lms/notebooks/<int:notebook_id>/execute/', notebook_execute),
    path('lms/notebooks/<int:notebook_id>/export/', notebook_export),
    path('lms/courses/<int:course_id>/git/', course_git),
    path('lms/courses/<int:course_id>/publish/', social_publish),
    path('lms/courses/<int:course_id>/pkm/<str:target>/', pkm_export),
    path('platform/admin/lms/meta/', admin_lms_meta),
    path('platform/admin/lms/analytics/', admin_lms_analytics),
    path('platform/admin/lms/openedx/', admin_openedx_status),
    path('platform/admin/lms/payments/', admin_course_payments),
    path('platform/admin/lms/repositories/', admin_learning_repositories),
    path('platform/admin/lms/courses/<int:course_id>/assets/', admin_learning_assets),

    # Layer 5 operating system: internal Gravitas team only. Existing runtime
    # resolution pins every call to the canonical Core workspace.
    path('operating/dashboard/', require_core(operating_dashboard)),
    path('operating/initiative-planner/', require_core_admin(initiative_planner)),
    path('operating/processes/', require_core(processes)),
    path('operating/processes/<int:process_id>/', require_core(process_detail)),
    path('operating/objectives/', require_core(objectives)),
    path('operating/objectives/<int:objective_id>/', require_core(objective_detail)),
    path('operating/key-results/', require_core(key_results)),
    path('operating/key-results/<int:kr_id>/', require_core(key_result_detail)),
    path('operating/initiatives/', require_core_admin(initiatives)),
    path('operating/initiatives/<int:initiative_id>/', require_core_admin(initiative_detail)),
    path('operating/cycles/', require_core(cycles)),
    path('operating/cycles/<int:cycle_id>/', require_core(cycle_detail)),
    path('operating/milestones/', require_core(milestones)),
    path('operating/milestones/<int:milestone_id>/', require_core(milestone_detail)),
    path('operating/work-packages/', require_core(work_packages)),
    path('operating/work-packages/<int:work_package_id>/', require_core(work_package_detail)),
    path('operating/tasks/', require_core(tasks)),
    path('operating/task-board/', require_core(task_board)),
    path('operating/task-board/move/', require_core(task_board_move)),
    path('operating/task-board/<int:task_id>/', require_core(task_board_detail)),
    path('operating/tasks/<int:task_id>/checklist/', require_core(task_checklist)),
    path('operating/tasks/<int:task_id>/checklist/<int:item_id>/', require_core(task_checklist_item)),
    path('operating/tasks/<int:task_id>/comments/', require_core(task_comments)),
    path('operating/tasks/<int:task_id>/attachments/', require_core(task_attachments)),
    path('operating/tasks/<int:task_id>/attachments/<int:attachment_id>/', require_core(task_attachment_delete)),
    path('operating/tasks/<int:task_id>/attachments/<int:attachment_id>/download/', require_core(task_attachment_download)),
    path('operating/tasks/<int:task_id>/history/', require_core(task_history)),
    path('operating/tasks/reorder/', require_core(reorder_tasks)),
    path('operating/tasks/<int:task_id>/links/', require_core(task_cross_layer_links)),
    path('operating/tasks/<int:task_id>/', require_core(task_detail)),
    path('operating/risks/', require_core(risks)),
    path('operating/risks/<int:risk_id>/', require_core(risk_detail)),
    path('operating/meetings/', require_core(meetings)),
    path('operating/meetings/<int:meeting_id>/', require_core(meeting_detail)),

    # Legacy private KMS storage remains for note/learning internals and URL
    # compatibility. It is no longer presented as a sixth product surface.
    path('workspace/dashboard/', require_lms(workspace_dashboard)),
    path('workspace/pages/', require_research_or_core(workspace_pages)),
    path('workspace/pages/<str:page_id>/', require_research_or_core(workspace_page_detail)),
    path('workspace/pages/<str:page_id>/backlinks/', require_research_or_core(workspace_page_backlinks)),
    path('workspace/pages/<str:page_id>/attachments/', require_research_or_core(workspace_page_attachment)),
    path('workspace/projects/', require_research_or_core(projects)),
    path('workspace/projects/<int:project_id>/', require_research_or_core(project_detail)),
    path('workspace/knowledge/', require_research_or_core(resources)),
    path('workspace/knowledge/<int:resource_id>/', require_research_or_core(resource_detail)),
    path('workspace/knowledge/<int:resource_id>/links/', require_research_or_core(knowledge_links)),
    path('workspace/knowledge/<int:resource_id>/links/<int:link_id>/', require_research_or_core(knowledge_link_detail)),
    path('workspace/files/upload/', require_research_or_core(file_upload)),
    path('workspace/files/<int:resource_id>/download/', require_research_or_core(file_download)),
    path('workspace/collections/', require_research_or_core(collections)),
    path('workspace/collections/<int:collection_id>/', require_research_or_core(collection_detail)),
    path('workspace/tags/', require_research_or_core(tags)),
    path('workspace/tags/<int:tag_id>/', require_research_or_core(tag_detail)),
    path('workspace/storage/', require_research_or_core(storage_status)),
]