"""Repair remaining imported historical task copy without manufacturing acceptance.

This migration targets exact import boilerplate only, across every task status.
Descriptions are scope statements grounded in the title and technical domain.
Definitions of Done describe independently checkable evidence; they do NOT turn
source-reported Done into production acceptance. No private task title is baked
into this public code.
"""
import re
from django.db import migrations
from django.db.models import F
from django.utils import timezone

LEGACY_DESCRIPTION = "Historical team task imported from the linked Google Docs record."
LEGACY_DOD = (
    "The original documented deliverable is preserved with its source reference. "
    "Source-reported completion does not establish production acceptance."
)

# Prioritized domain rules: context, independently checkable acceptance.
CONTEXTS = [
    (r'checkpoint|backup.restore|resume.*runtime|pre.deployment',
     "Review recovery and deployment safety, including checkpoint consistency, service recovery and rollback paths.",
     "Checkpoint and recovery behavior are evidenced by logs or a test run, with data-integrity checks and failure or rollback observations."),
    (r'domain.*migration|brand.*migration|dns|ssl|redirect.*domain|authentication callbacks',
     "Coordinate domain and application migration across DNS, TLS, public routes, authentication callbacks and downstream integrations.",
     "The required domains and redirects resolve correctly; TLS, login callbacks, API endpoints and external integrations have documented verification results."),
    (r'authorization|permissions?|secure project|access.grant|sso|identity',
     "Validate authorization and identity boundaries for the specified capability without expanding access to unintended users or projects.",
     "Relevant user roles and restricted-access scenarios are tested, including expected denial, authorized access and preserved data."),
    (r'nextcloud|native data synchron|shared files|media.*folders|file.*version',
     "Implement or validate integration with canonical file storage, including folder structure, native permissions, versioning and synchronization.",
     "Representative files or objects can be created, retrieved and reconciled without loss; permission checks, link resolution and conflict scenarios are recorded."),
    (r'\broadmap\b|\bsprint\b|team coordination|assign team|handoffs|delivery goals',
     "Define or maintain a traceable project plan with ownership, milestones, dependencies and decisions that teams can act on.",
     "The relevant plan or coordination record identifies owners, deliverables, dependencies, review points and any unresolved decisions."),
    (r'five.layer|platform architecture|accounts and workspace|project views|task hierarchy',
     "Build or refine the connected platform structure and user workflows while keeping project, account and task relationships coherent.",
     "The scoped structure is represented in working screens or documented architecture; primary navigation, persistence and relationship checks are verified."),
    (r'\blms\b|open edx|instructor|course|lesson|learning|quiz|assessment',
     "Deliver the scoped learning or course-management behavior from administrative setup through learner-facing use and progress tracking.",
     "Representative course or lesson workflows, data persistence, progress states and permission-dependent actions are tested with reviewable evidence."),
    (r'evidence map|fact.check|scientific sources|case studies|publication structure',
     "Organize research evidence and content production so claims, supporting sources and publication decisions remain traceable.",
     "A reviewable evidence or content structure lists source links, rationale, unresolved claims and the next editorial action."),
    (r'agent framework|ai core|context and skills|model gateway|retrieval|decision routing|multi.step|assistant.*acceptance|pulsar ai|memory',
     "Develop or validate the AI-assistant architecture, context use, retrieval or multi-step execution for the relevant workspace functions.",
     "Representative requests are exercised end to end; expected tool/data access, error handling, context isolation and evaluation results are documented."),
    (r'telegram|daily team reporting|reporting corrections|management overview',
     "Implement or validate team-report submission, confirmation, corrections and traceability between messages and the relevant work records.",
     "Submission and correction scenarios preserve the intended task/project association, provide clear acknowledgement and retain accessible history."),
    (r'vpn|server infrastructure|github deployment|platform release|production override|bridge scripts?',
     "Improve operational reliability of the scoped infrastructure or release process while preserving existing production access and configuration.",
     "Configuration changes, test or release logs, affected service checks and rollback considerations are documented."),
    (r'api route|query.string|api coverage|route coverage',
     "Align API coverage or routing checks with the real URL and query-parameter contract used by clients.",
     "Route tests cover representative paths and query strings, with expected request/response behavior and no false missing-route results."),
    (r'javascript transfer|css.*transfer|gzip|size budget',
     "Measure and enforce practical JavaScript and CSS payload budgets using the deployed asset size and transfer behavior.",
     "Budget checks use the defined compressed-size metric and flag oversized assets consistently, with reference measurements."),
    (r'assets?.*version|release token|cache token|service.worker cache|cache.*assets?|font subsets|self.host',
     "Keep released assets and client-side caches consistent across deployments, including file versions and font or script references.",
     "A clean load and post-release reload resolve the intended asset versions; cache keys and referenced file paths are verified."),
    (r'obsolete|legacy.*remove|remove.*unused|redundant.*remove|remove.*duplicate|retire',
     "Remove the scoped obsolete implementation and its references without breaking current workspace routes or supported workflows.",
     "The obsolete files or paths are absent, active callers use the replacement, and relevant regression checks still pass."),
    (r'router|redirect|routes?|route selection|page selection|first paint',
     "Refine navigation and routing, including direct links, refresh, redirects and boundaries between public pages and workspace modules.",
     "Representative routes load correctly on direct navigation and refresh; redirects, browser history and access boundaries are checked."),
    (r'knowledge base|recall|sources, paths|account state|user.configurable.*sources',
     "Connect knowledge or content sources to the correct signed-in account state and ensure retrieval, settings and persistence are consistent.",
     "Settings and content persist across reloads, account boundaries are respected, and representative source or retrieval scenarios are verified."),
    (r'sync.*note|note.*sync|stale note|race conditions.*note|note.*reconciliation',
     "Protect notes from stale metadata, concurrent updates and synchronization races between the application and canonical storage.",
     "Concurrent edit or move cases are exercised; the latest intended state remains accessible and conflicts or failures are clearly recorded."),
    (r'notes?.*folder|folders?.*notes|block editing|note menus|markdown block|backlinks|notes? the primary|page.editor',
     "Develop the Notes workflow for writing, moving, linking and retrieving content while preserving folder organization and edit state.",
     "Representative notes can be created, edited, organized and revisited; metadata, links and changes persist through reload and sync."),
    (r'saved.item|reader.*library|guest.library|guest.to.account|seen_at|mark.*seen|untick|reading.path',
     "Implement the scoped saved-content and reading-progress behavior, including guest adoption, seen state and account-backed persistence.",
     "Saved and seen state, guest-to-account transitions and progress updates behave as specified without unwanted overwrites or duplicates."),
    (r'task.board|task tree|subtasks|task.project views|tree, board|graph view|task creation|task status',
     "Improve task execution views and controls, ensuring task hierarchy, ownership, statuses and planning links remain coherent.",
     "Create, edit, move and navigation workflows work on representative tasks; hierarchy and status data persist and display consistently."),
    (r'mentions|notifications|workspace dock|dock on notifications',
     "Implement or refine task notifications and workspace dock navigation, including event visibility, read state and permission checks.",
     "Relevant events arrive in the intended view, navigation opens the correct context, and unauthorized or duplicate notifications are avoided."),
    (r'charts?|gauges?|progress rings?|series|tile.rendering|dashboard',
     "Improve dashboard visualization primitives and data presentation, including shared components, empty values and responsive rendering.",
     "Charts or gauges represent sample and zero-value data correctly; legends, alignment, imports and responsive states are verified."),
    (r'color tokens|semantic color|critical red|accent gradient|surface tints|contrast|hover states',
     "Apply consistent semantic visual tokens, contrast and interactive states so warnings, surfaces and controls are distinguishable.",
     "Representative light/dark surfaces and status states follow the intended color semantics, meet readability expectations and avoid decorative error coloring."),
    (r'typography|literata|italic.*hero|hero.*keywords|font',
     "Refine typography choices and font delivery for readability, brand coherence and reliable rendering on supported devices.",
     "Font weights and styles, fallback behavior, layout impact and key reading or headline examples are reviewed at target screen widths."),
    (r'hero|landing.page|homepage|join.role|grid textures|many.body orbit|depth.*background',
     "Refine the public-facing visual experience and motion or background details without obscuring core content or interactions.",
     "Visual results are reviewable at representative viewport sizes; copy, contrast, performance and interactive versus decorative affordances are checked."),
    (r'video aspect|trail content|scene titles|end screen|ending dissolve',
     "Refine the specified video or scene presentation to match the approved narrative, visual format and delivery constraints.",
     "The affected frames or playback segment demonstrate the requested correction with a reviewable before/after or render."),
    (r'animation|manim|scientific visuals|rendered.*frames|frame.rendering|snapshot|contact.sheet|film production|film.*revisions',
     "Build or refine the scientific film and animation pipeline, from scene assets and rendered frames to reviewed final video outputs.",
     "The corresponding render, scene sequence or tool output is reproducible or accessible, with visual defects, export settings and revision evidence recorded."),
    (r'camera.angle|lighting|monitor|faculty office|lab.shared|character|walking|face direction|scene composition',
     "Develop or correct character and environment assets for visual continuity across scenes, camera angles and lighting conditions.",
     "The relevant scenes or assets can be reviewed at required angles and lighting states; identity, direction and visual continuity are checked."),
    (r'voice|audio|sound|music|mixing|lufs|pacing|punchlines',
     "Prepare or refine the audio production chain, including voice tracks, music, timing, mixing and final export levels.",
     "Reviewable audio stems or mixes match the intended scene timing; intelligibility, transitions and declared loudness/export settings are checked."),
    (r'script|content planning|pre.production|post.production|video formats|scientific topics',
     "Define and carry out the content-development workflow, from research and scripting through review, production ownership and deliverable handoff.",
     "A documented production artifact identifies the content approach, responsibilities, review gates, dependencies and final delivery format."),
    (r'brand.name|alternative names|visible product names|interface copy|brand assets?|brand artwork',
     "Align brand naming, labels and reusable artwork across the specified user-visible surfaces and asset library.",
     "Naming decisions and affected assets or screens are reviewed for consistency; deliverables are linked and remaining exceptions identified."),
    (r'avatar|profile image',
     "Implement or refine avatar storage, retrieval and presentation, including error handling and device-specific display behavior.",
     "Upload or retrieval scenarios succeed or show actionable errors; persisted images and fallback display are verified."),
    (r'css structure|responsive|layout|styling|spacing|button|form|select|grid|hover|top.bar',
     "Improve the scoped interface layout or control behavior while preserving usability, responsive design and existing value-change contracts.",
     "Affected components are validated on representative viewport sizes; interaction states and layout regression examples are recorded."),
    (r'cleanup|refactor|restructure|code structure|module instances|observers|redundant fetch',
     "Simplify the code and module lifecycle for maintainability without changing the intended user-facing behavior.",
     "Redundant code paths are removed or consolidated and supported flows are covered by regressions or a reproducible verification checklist."),
    (r'filter|eligibility|archiving|search|saving',
     "Implement or verify the intended filtering and saved-state behavior, including boundaries, empty results and persistence.",
     "Filters yield the expected records, invalid inputs behave predictably, and saved or archived selections remain consistent."),
]

# Acceptance type matters when a title is more precise than the domain labels.
VERB_DOD = [
    (r'^(?:fix|correct|prevent|restore|resolve|reduce)\b',
     "The reported defect is reproducible in the baseline or explained by evidence, and a targeted regression check demonstrates the corrected behavior without a related breakage."),
    (r'^(?:remove|retire|eliminate)\b',
     "The deprecated item and its active references are removed; supported replacements and adjacent workflows continue to function."),
    (r'^(?:verify|test|audit)\b',
     "Test cases, environment, results and any unresolved failures are recorded; a pass is based on observed behavior rather than the original status label."),
    (r'^(?:preserve|keep|ensure)\b',
     "The specified existing contract remains unchanged in representative normal and edge cases, verified by focused regression checks."),
    (r'^(?:explore|research|investigate|assess|evaluate)\b',
     "Considered approaches, supporting evidence, limitations and a recommendation or documented open decision are provided for review."),
    (r'^(?:document|define|plan|coordinate|assign|set|structure)\b',
     "A reviewable plan or specification identifies scope, owners or dependencies where applicable, acceptance decisions and next steps."),
]

ACTION_START = re.compile(
    r'^(?:add|adjust|align|apply|build|change|complete|consolidate|'
    r'coordinate|correct|create|define|deliver|deploy|design|develop|enable|'
    r'ensure|establish|explore|finalize|fix|generate|implement|improve|'
    r'integrate|keep|make|manage|mark|move|organize|place|prepare|'
    r'preserve|prevent|produce|publish|re.enable|re.read|reduce|'
    r'refactor|remove|rename|render|replace|reserve|resolve|restore|'
    r'restructure|review|run|self.host|set|standardize|strengthen|'
    r'support|synchronize|test|unify|update|use|verify|'
    r'defined|structured|established|redesigned|created|produced|'
    r'corrected|integrated|built|applied|removed|rendered)\b',
    re.IGNORECASE,
)

def propose_copy(title):
    title = ' '.join(str(title or '').strip().split()).rstrip('.')
    if not title:
        return None
    descriptor = None
    for pattern, context, checks in CONTEXTS:
        if re.search(pattern, title, re.IGNORECASE):
            descriptor = (context, checks)
            break
    if descriptor is None:
        # Action-specific inference only; opaque headings are left for review.
        for pattern, checks in VERB_DOD:
            if re.search(pattern, title, re.IGNORECASE):
                descriptor = (
                    "Perform the title-scoped work, identifying affected components, dependencies and the intended handoff.",
                    checks,
                )
                break
    if descriptor is None and ACTION_START.search(title):
        descriptor = (
            "Deliver the title-scoped change in the intended product area, including necessary integration and user-facing states.",
            "The target change or artifact is accessible for review, its behavior is demonstrated with a representative example and remaining defects are recorded.",
        )
    if descriptor is None:
        return None
    context, checks = descriptor
    first = title[0].upper() + title[1:]
    sentence = first + ('' if first.endswith(('.', '!', '?')) else '.')
    if not ACTION_START.search(title):
        sentence = 'Workstream: ' + sentence
    description = f"{sentence} {context}"
    # Favor specific acceptance when the action itself is diagnostic/removal.
    for pattern, checks_override in VERB_DOD:
        if re.search(pattern, title, re.IGNORECASE):
            checks = checks_override + " " + checks
            break
    return description, checks


def apply(apps, schema_editor):
    Task = apps.get_model('core', 'OperatingTask')
    CanonicalProject = apps.get_model('core', 'CanonicalProject')
    Outbox = apps.get_model('core', 'CanonicalTaskSyncOutbox')
    alias = schema_editor.connection.alias
    candidates = (
        Task.objects.using(alias)
        .exclude(source_key__isnull=True).exclude(source_key='')
        .filter(definition_of_done=LEGACY_DOD)
    ) | (
        Task.objects.using(alias)
        .exclude(source_key__isnull=True).exclude(source_key='')
        .filter(description__startswith=LEGACY_DESCRIPTION)
    )
    for task in candidates.order_by('pk').distinct().iterator(chunk_size=100):
        proposal = propose_copy(task.title)
        if proposal is None:
            continue
        description, done = proposal
        updates = {}
        if (task.description or '').startswith(LEGACY_DESCRIPTION):
            updates['description'] = description
        if (task.definition_of_done or '').strip() == LEGACY_DOD:
            updates['definition_of_done'] = done
        if not updates:
            continue
        now = timezone.now()
        updates['updated_at'] = now
        if not Task.objects.using(alias).filter(
            pk=task.pk, updated_at=task.updated_at
        ).update(**updates):
            continue
        if not task.project_id or not CanonicalProject.objects.using(alias).filter(
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
    dependencies = [('core', '0078_repair_imported_task_copy')]
    operations = [migrations.RunPython(apply, reverse_code=migrations.RunPython.noop)]
