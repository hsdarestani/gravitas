"""Replace imported placeholder task copy with title-specific, testable scope.

Only the exact import placeholders are eligible. This migration does not infer
completion, deadlines, owner, or source provenance. It never changes manually
edited copy, and queues canonical projects for conflict-aware Nextcloud sync.
"""
import re

from django.db import migrations
from django.db.models import F
from django.utils import timezone


ORIGINAL_DOD = (
    'The original documented deliverable is preserved with its source reference. '
    'Source-reported completion does not establish production acceptance.'
)
ORIGINAL_DESCRIPTION_PREFIX = 'Historical team task imported from the linked Google Docs record.'

# Patterns are intentionally domain-based instead of embedding private team
# task titles or snapshots in this public repository. First match wins.
RULES = [
    (r'production uptime|monitoring and provisioning|incident|outage',
     'Investigate availability, monitoring coverage and provisioning failures in the production environment. Identify observed failure modes, root causes, corrective actions and residual operational risks.',
     'A dated incident analysis records the evidence, reproducible failure conditions, root causes or remaining unknowns, implemented fixes, and verification through relevant health checks or logs.'),
    (r'notes.*synchroni[sz]|synchroni[sz].*notes|conflict handling',
     'Validate note synchronization between GraviQuest and its canonical storage, including concurrent edits, retries, reconnection and conflict handling without silently losing changes.',
     'Create, update and conflict scenarios are exercised in both directions; outcomes, conflict handling, error states and evidence of retained content are documented.'),
    (r'asset versioning|cache management|cache invalidation',
     'Review asset versioning and client-side cache behavior so new deployments reliably load the intended files without leaving stale or mismatched resources.',
     'Version changes, cache invalidation and fresh/repeat-load behavior are tested and documented; stale-content regressions have reproducible checks.'),
    (r'telegram.*report|daily report.*telegram|telegram assistant',
     'Define and validate the Telegram assistant workflow for daily work reporting, including message intake, task association, confirmation and error handling.',
     'A representative daily report can be submitted and traced to the intended project or task; confirmations, authorization checks and failure scenarios are documented.'),
    (r'chat.*pulsar|pulsar.*integration',
     'Assess and implement the integration of conversational assistance into the workspace, including context handoff, user access and continuity of interaction.',
     'The relevant chat entry points, context transfer, permission boundaries and failure states are tested with documented results and identified follow-up issues.'),
    (r'social media|digital marketing|advertis|marketing automation',
     'Research and map the social media or digital marketing workflow, separating content planning, production, publication, analytics and opportunities for automation.',
     'The scoped workflow, inputs, outputs, candidate tools, automation boundaries and prioritized next steps are documented in a reviewable R&D deliverable.'),
    (r'scenario.*video|video.*scenario|storyboard|approaches for video',
     'Research narrative and production approaches for the planned video, compare viable scenarios, and develop a coherent recommendation for the creative direction.',
     'A written scenario or storyboard and a comparison of considered approaches are available, with selection rationale and concrete next production steps.'),
    (r'video.*production|video.*final|final.*video|animation.*video|narrat',
     'Advance the scoped video deliverable through the required scripting, animation, editing and review activities while retaining the applicable creative decisions.',
     'The relevant version of the video or its production artifact is shared in a reviewable format, with visual/audio quality checks and outstanding feedback recorded.'),
    (r'personas?.*scenario|scenario.*personas?',
     'Define representative scenarios for the identified audience personas, covering their motivation, entry point, key decisions and expected outcomes.',
     'Each scoped persona has a documented scenario with trigger, goals, actions and outcome, and the scenarios are reviewed for consistency with product requirements.'),
    (r'personas?',
     'Research and document the priority audience personas, including their goals, constraints, motivations and relevant interactions with the platform.',
     'A persona set is available with evidence or stated assumptions, differentiated goals and key needs, and clear implications for content or interface decisions.'),
    (r'user journey|journey for each|audience journeys?',
     'Map end-to-end user journeys for the intended audience, identifying entry points, critical steps, friction points and successful outcomes.',
     'Each scoped journey is documented as a reviewable flow with actors, touchpoints, decisions, pain points and a target outcome.'),
    (r'ux flow problems?|ux issues?|website ux flow',
     'Inspect the relevant website or workspace user flows, document usability and navigation problems, and translate findings into actionable engineering requirements.',
     'Issues have reproducible steps, affected screens, expected behavior and severity; a reviewed issue list or verified fixes are linked to the task.'),
    (r'funding|research intelligence',
     'Review research intelligence and relevant funding opportunities, assess their applicability and organize findings into an actionable evaluation or outreach pipeline.',
     'Sources, eligibility considerations, shortlisted opportunities and rationale are documented; limitations or blockers are explicitly recorded.'),
    (r'brand name|brand rename|naming|name exploration',
     'Assess and implement the relevant brand naming decision consistently across identified interface, content and communication touchpoints.',
     'The naming decision or rename inventory is documented; affected touchpoints and remaining exceptions are reviewed, with representative before-and-after evidence.'),
    (r'logo|visual identity|brand identity',
     'Develop or update the brand identity assets according to the approved direction, including consistency across intended surfaces and delivery formats.',
     'Required brand assets and usage references are delivered in suitable formats; consistency and legibility are reviewed at representative sizes.'),
    (r'mascot|characters?|character assets',
     'Develop and organize the character or mascot design assets for the intended visual and production use cases, preserving editability and naming consistency.',
     'The scoped character assets are available in their specified delivery formats, with previews, editable source files when applicable and an asset inventory.'),
    (r'\bsvg\b|brand asset delivery',
     'Prepare final production assets in SVG or other required design formats and organize the files for reuse across the website and product.',
     'Final files are supplied, open correctly, retain intended visual quality and naming, and are linked from the task for team access.'),
    (r'avatar crop|profile image',
     'Improve profile image selection, cropping, preview and saved-avatar behavior across the intended devices and account surfaces.',
     'Image selection, crop preview, persistence and fallback behavior are validated with representative image sizes and mobile/desktop views.'),
    (r'topic rail',
     'Review and refine the topic navigation rail to improve discoverability, state clarity, responsiveness and navigation consistency.',
     'The revised rail is usable at relevant viewport sizes, navigation actions resolve correctly and selected/empty/overflow states are reviewed.'),
    (r'reader library.*seen|seen state',
     'Define and verify read/seen-state behavior for saved reader content, including persistence, synchronization and how state changes appear in the interface.',
     'Seen/unseen transitions persist as intended across reloads and supported devices; list indicators and edge cases are checked.'),
    (r'reader library',
     'Improve the reader library experience for discovering, saving, organizing and returning to research content with clear navigation and meaningful states.',
     'The scoped library flows are reviewable, including saved-item retrieval, filtering or organization, empty states and access boundaries.'),
    (r'chart kit|dashboard charts?',
     'Design or implement reusable dashboard chart components with consistent data formatting, legends, loading states and responsive behavior.',
     'Chart components render representative datasets accurately, including zero/empty states, labels, scaling and responsive layouts, with examples available for review.'),
    (r'dashboard.*redesign|dashboard.*visual',
     'Review the dashboard information hierarchy and refine layout, visual hierarchy and interaction patterns for key project and planning indicators.',
     'Representative dashboard screens show the agreed hierarchy and visual treatment; readability and behavior are reviewed on desktop and mobile.'),
    (r'quiz|learner assessment',
     'Review and improve the learner assessment flow, including question presentation, answers, feedback, completion and progress states.',
     'A representative quiz can be completed end to end with correct state transitions, feedback, accessibility checks and responsive rendering.'),
    (r'course cover',
     'Improve course cover selection, upload, preview and presentation across the learning interface and management flow.',
     'A course cover can be supplied, saved and displayed reliably; aspect ratio, fallback and responsive behavior are tested.'),
    (r'learning and course|course experience|learner experience',
     'Review the learning and course journey from discovery to lesson progression, identifying and improving usability, navigation and completion feedback.',
     'The scoped learner flows are demonstrated with representative course content, working navigation, progress states and documented acceptance checks.'),
    (r'date and time picker|date.*picker|time.*picker',
     'Standardize date and time input behavior across workspace forms, including format clarity, validation, keyboard use and mobile interactions.',
     'Date and time inputs handle valid, invalid and empty values consistently, with correct formatting, focus behavior and mobile/desktop checks.'),
    (r'dropdown',
     'Standardize dropdown and select controls across the workspace, including keyboard navigation, search or filtering, layering and mobile behavior.',
     'Dropdown controls operate correctly in representative forms, with focus management, selected/empty states and overflow handling verified.'),
    (r'buttons?.*forms?|forms?.*buttons?|file input',
     'Refine form controls, buttons and file-input affordances to align visual states, usability, validation and interaction behavior across the design system.',
     'Representative controls support default, focus, error, disabled and loading states; keyboard and mobile interaction checks are documented.'),
    (r'form and textarea|textarea',
     'Improve the workspace form and text-entry experience, focusing on readable labels, validation, field sizing and reliable save interactions.',
     'Forms and textareas preserve entered values, show meaningful validation and feedback, and work at representative desktop and mobile sizes.'),
    (r'navigation.*dock|dock.*notes',
     'Unify the workspace navigation, dock and note entry points so users can move between modules without losing task context or work in progress.',
     'Navigation and note entry points work in representative flows; active states, return paths, responsive layouts and persistence are checked.'),
    (r'workspace navigation|navigation',
     'Review and refine the workspace navigation model so primary destinations, active states and return paths remain understandable across devices.',
     'Primary navigation flows are tested on desktop and mobile, including active state, back navigation, overflow and permission-dependent entries.'),
    (r'workspace routing|module architecture',
     'Assess the workspace routing and module structure, identify coupling or broken transitions, and implement a maintainable navigation architecture.',
     'Relevant routes load correctly on direct entry and refresh; module transitions, browser history and regression coverage are documented.'),
    (r'core tasks?|task board|project management|work reports?|in.app notifications',
     'Review the Core execution workflows for creating, assigning, updating and tracking work, including visibility, notifications and task/project relationships.',
     'Representative task and reporting workflows are tested end to end; state transitions, ownership, save feedback and notification behavior are verified.'),
    (r'knowledge management|research.*workspace|notes.*integration',
     'Review how research notes and knowledge resources are organized, linked and surfaced across workspaces, with attention to permissions and continuity.',
     'The scoped knowledge flows are demonstrated with real sample content; linking, retrieval, editing rights and consistency are validated.'),
    (r'platform admin',
     'Improve administrative workspace workflows and information hierarchy, ensuring core management actions are discoverable and permission-appropriate.',
     'Representative admin actions are usable and tested for appropriate roles, with clear success/error states and responsive views.'),
    (r'website.*separation|workspace.*separation',
     'Clarify and implement the separation between public website pages and authenticated workspace surfaces, including navigation and access behavior.',
     'Public and workspace entry points, login redirects, access boundaries and representative route transitions are verified.'),
    (r'homepage hero|landing experience|community hero',
     'Refine the homepage or community landing experience, focusing on messaging hierarchy, readability, responsive layout and primary navigation actions.',
     'The hero content and primary actions render correctly across representative screen sizes, with approved copy and visual QA evidence.'),
    (r'public website|homepage|website',
     'Review the public website experience, including page hierarchy, content clarity, internal navigation and responsiveness for target audiences.',
     'Relevant pages and user paths have been reviewed, with documented corrections or tracked outstanding issues and responsive QA evidence.'),
    (r'production and deployment|deployment improvements?|release validation',
     'Review release and deployment reliability, identify operational failures and improve validation, rollback readiness and post-deployment checks.',
     'Deployment steps and failure scenarios are documented; relevant automated or manual checks and a rollback path have been verified.'),
    (r'testing and integration|integration improvements?|quality assurance|\bqa\b',
     'Plan and carry out integration and regression checks for the scoped product area, covering expected behavior, known risks and user-visible failure states.',
     'The test matrix, executed results, defects and retest outcomes are recorded, with unresolved risks explicitly listed.'),
    (r'performance|slow|latency',
     'Measure and improve performance in the scoped workspace or service flows, identifying slow operations and validating the impact of changes.',
     'Baseline and after-change measurements for representative flows are documented; regressions and unresolved bottlenecks are tracked.'),
    (r'ui and responsive|responsive improvements?|workspace redesign|ui refactor',
     'Review and improve relevant workspace screens for clarity, consistency, responsiveness and efficient completion of key user actions.',
     'The affected screens and states are documented; desktop/mobile interaction, layout and accessibility checks are performed with reviewable evidence.'),
    (r'color system|design system|typography',
     'Consolidate reusable visual patterns, typography, color semantics and component behavior into a consistent product design system.',
     'Component usage rules and representative screens are documented; typography, semantic colors and responsive behavior are reviewed for consistency.'),
    (r'architecture and ux|platform architecture',
     'Assess platform information architecture and main user flows, document structural choices and identify UX gaps affecting real workflows.',
     'An architecture and UX review is recorded with diagrams or flow documentation, decisions, identified issues and recommended follow-up actions.'),
    (r'project decisions|production rules|continuity between sessions|documented decisions',
     'Capture project decisions, recurring production rules and rationale in a durable format so future sessions can continue without losing context.',
     'A structured decision log records the decision, rationale, applicability and source or owner; the team can locate and use the documented production rules.'),
    (r'documentation finali[sz]ation|documentation',
     'Consolidate and finalize the relevant workspace or project documentation, resolving outdated guidance and making the current decisions easy to locate.',
     'Documentation is updated, internally consistent and linked to the intended project area, with unresolved questions explicitly identified.'),
    (r'research|r&d|investigat',
     'Investigate the defined topic using available evidence, compare feasible approaches and document conclusions, assumptions and next steps.',
     'A reviewable research note or investigation report records sources, evaluated options, conclusions, open questions and recommended actions.'),
]

def copy_for_title(title):
    """Return conservative scope and DoD, or None for unclassified work."""
    normalized = ' '.join(str(title or '').split()).lower()
    for pattern, description, done in RULES:
        if re.search(pattern, normalized, re.IGNORECASE):
            return description, done
    return None


def repair(apps, schema_editor):
    Task = apps.get_model('core', 'OperatingTask')
    CanonicalProject = apps.get_model('core', 'CanonicalProject')
    Outbox = apps.get_model('core', 'CanonicalTaskSyncOutbox')
    alias = schema_editor.connection.alias
    candidates = Task.objects.using(alias).exclude(source_key__isnull=True).exclude(source_key='').filter(
        definition_of_done=ORIGINAL_DOD
    ) | Task.objects.using(alias).exclude(source_key__isnull=True).exclude(source_key='').filter(
        description__startswith=ORIGINAL_DESCRIPTION_PREFIX
    )
    # DISTINCT and deterministic order; no state/owner/date changes.
    for task in candidates.order_by('pk').distinct().iterator(chunk_size=100):
        proposed = copy_for_title(task.title)
        if proposed is None:
            continue
        description, done = proposed
        updates = {}
        if (task.description or '').startswith(ORIGINAL_DESCRIPTION_PREFIX):
            updates['description'] = description
        if (task.definition_of_done or '').strip() == ORIGINAL_DOD:
            updates['definition_of_done'] = done
        if not updates:
            continue
        now = timezone.now()
        updates['updated_at'] = now
        # Optimistic guard: do not overwrite a concurrent member edit.
        changed = Task.objects.using(alias).filter(
            pk=task.pk, updated_at=task.updated_at
        ).update(**updates)
        if not changed or not task.project_id:
            continue
        if not CanonicalProject.objects.using(alias).filter(
            project_id=task.project_id, enabled=True
        ).exists():
            continue
        job, created = Outbox.objects.using(alias).get_or_create(
            project_id=task.project_id, task_id=task.pk,
            defaults={'generation': 1, 'next_attempt_at': now, 'state': 'pending'},
        )
        if not created:
            Outbox.objects.using(alias).filter(pk=job.pk).update(
                generation=F('generation') + 1, next_attempt_at=now,
                state='pending', attempts=0, last_error='',
            )


class Migration(migrations.Migration):
    dependencies = [('core', '0077_canonical_task_sync_outbox')]
    operations = [migrations.RunPython(repair, reverse_code=migrations.RunPython.noop)]
