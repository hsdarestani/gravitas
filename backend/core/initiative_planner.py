from datetime import timedelta

from django.db import transaction
from django.db.models import Count
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .models import WorkspaceMembership
from .operating_models import (
    Health,
    Initiative,
    KeyResult,
    OperatingProcess,
    OperatingTask,
    Priority,
    WorkStatus,
)
from .roadmap_models import RoadmapOKRSyncState


FAMILY_TEMPLATES = {
    'content_longform': {
        'label': 'Long-form production engine',
        'process': 'content',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A repeatable long-form production loop that can move the KR every cycle.',
        'tasks': [
            ('Define format and acceptance criteria', 'Format, audience promise, quality bar and measurable success criteria are documented.'),
            ('Build and prioritize the topic backlog', 'A ranked backlog exists and the next pilot topic is selected with rationale.'),
            ('Complete research and production brief', 'Sources, claims, narrative angle and production brief are review-ready.'),
            ('Write script and complete scientific review', 'Script is approved for scientific accuracy and production.'),
            ('Produce, edit and QA the pilot', 'A publish-ready asset passes editorial, technical and brand QA.'),
            ('Publish and run the analytics review', 'The asset is published and its first performance review is logged against the KR.'),
        ],
    },
    'content_shortform': {
        'label': 'Short-form distribution system',
        'process': 'content',
        'priority': Priority.P1,
        'duration': 28,
        'outcome': 'A batch-based short-form system with a measurable publishing and iteration cadence.',
        'tasks': [
            ('Define repeatable short-form formats', 'Three reusable short-form formats and their quality criteria are documented.'),
            ('Create the first concept batch', 'A prioritized batch of at least ten publishable concepts exists.'),
            ('Produce and QA the first batch', 'The selected batch is edited, captioned and passes QA.'),
            ('Run the publishing cadence', 'The planned batch is published according to the agreed schedule.'),
            ('Review retention and iterate formats', 'Performance is reviewed and at least one format decision is recorded.'),
        ],
    },
    'content_web': {
        'label': 'Knowledge publishing pipeline',
        'process': 'content',
        'priority': Priority.P2,
        'duration': 35,
        'outcome': 'A reliable path from research to high-quality website article, dossier or learning asset.',
        'tasks': [
            ('Define asset structure and editorial standard', 'Template, evidence requirements and definition of publish-ready are documented.'),
            ('Select and scope the first asset', 'Topic, audience, source set and intended learning outcome are approved.'),
            ('Research and draft the asset', 'A complete draft with sources and claims is ready for review.'),
            ('Scientific and editorial review', 'All review comments are resolved and the asset is approved.'),
            ('Publish, link and instrument analytics', 'The asset is live, connected to related content and analytics are active.'),
        ],
    },
    'content_newsletter': {
        'label': 'Newsletter growth loop',
        'process': 'content',
        'priority': Priority.P1,
        'duration': 35,
        'outcome': 'A recurring newsletter that converts reach into an owned audience and a return habit.',
        'tasks': [
            ('Define newsletter promise and cadence', 'Audience promise, recurring sections and publishing cadence are documented.'),
            ('Improve signup and attribution flow', 'Signup entry points and source tracking are live and tested.'),
            ('Create reusable issue template', 'A production-ready newsletter template and checklist exist.'),
            ('Publish the first recurring sequence', 'The planned initial editions are sent on schedule.'),
            ('Review subscriber growth and engagement', 'Growth, opens, clicks and conversion are reviewed against the KR.'),
        ],
    },
    'content_interactive': {
        'label': 'Interactive format pilot',
        'process': 'technology',
        'priority': Priority.P2,
        'duration': 42,
        'outcome': 'A testable interactive science experience that can become a repeatable Gravitas format.',
        'tasks': [
            ('Define interaction and learning outcome', 'The user action, learning goal and success metric are documented.'),
            ('Prototype the core interaction', 'A functional prototype demonstrates the central experience.'),
            ('Scientific and UX review', 'Scientific accuracy and usability issues are resolved.'),
            ('Run a small user test', 'Real users complete the experience and structured feedback is captured.'),
            ('Release and measure completion', 'The experience is live and completion/engagement data are recorded.'),
        ],
    },
    'content_distribution': {
        'label': 'Audience distribution loop',
        'process': 'content',
        'priority': Priority.P1,
        'duration': 28,
        'outcome': 'A measurable distribution loop that repeatedly moves content toward the right audience.',
        'tasks': [
            ('Define channels and baseline metrics', 'Priority channels, baseline reach and target metrics are documented.'),
            ('Build the distribution calendar', 'Each core asset has channel-specific distribution actions and dates.'),
            ('Prepare channel-native derivatives', 'Required derivative assets and copy are production-ready.'),
            ('Execute the first distribution cycle', 'The planned cycle is completed across priority channels.'),
            ('Review acquisition and update the playbook', 'Reach, conversion and channel decisions are recorded.'),
        ],
    },
    'community_onboarding': {
        'label': 'Community onboarding & activation',
        'process': 'operations',
        'priority': Priority.P1,
        'duration': 35,
        'outcome': 'A clear path from first signup to an activated member who knows how to participate.',
        'tasks': [
            ('Define member journey and activation event', 'Stages from visitor to active member and the activation metric are documented.'),
            ('Define roles and participation paths', 'Member, contributor and researcher participation paths are clear.'),
            ('Build onboarding touchpoints', 'Welcome, orientation and first-action touchpoints are live.'),
            ('Recruit and onboard the first cohort', 'A real cohort completes the onboarding flow.'),
            ('Measure activation and fix drop-off', 'Activation rate and the largest drop-off point are reviewed and acted on.'),
        ],
    },
    'community_contributors': {
        'label': 'Contributor network program',
        'process': 'research',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A controlled way for researchers and contributors to join, receive scoped work and produce reviewed outputs.',
        'tasks': [
            ('Define contributor criteria and roles', 'Eligibility, roles, permissions and review expectations are documented.'),
            ('Build intake and application flow', 'A working intake/application path exists with required profile information.'),
            ('Select and onboard the first cohort', 'The first contributors are approved and have correct access.'),
            ('Assign scoped contributions', 'Each selected contributor has a clear deliverable, owner and deadline.'),
            ('Review and publish accepted contributions', 'Accepted outputs pass review and are stored or published correctly.'),
            ('Review contributor quality and retention', 'Quality, cycle time and continued participation are reviewed.'),
        ],
    },
    'community_events': {
        'label': 'Community session cadence',
        'process': 'operations',
        'priority': Priority.P2,
        'duration': 35,
        'outcome': 'A recurring discussion, study-club or live-session format that creates reasons to return.',
        'tasks': [
            ('Define recurring session format', 'Purpose, audience, frequency and facilitation format are documented.'),
            ('Create the first session calendar', 'Dates, topics, hosts and owners are confirmed.'),
            ('Recruit the first participants', 'The first session has a qualified participant list.'),
            ('Run the initial session sequence', 'The planned sessions are completed and notes are captured.'),
            ('Review attendance and return rate', 'Attendance, participation and repeat attendance are reviewed.'),
        ],
    },
    'community_retention': {
        'label': 'Member retention loop',
        'process': 'operations',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A recurring participation loop that turns registered members into returning active members.',
        'tasks': [
            ('Define active-member and retention metrics', 'Active and retained member definitions are agreed and measurable.'),
            ('Map reasons to return', 'Recurring value moments and return triggers are prioritized.'),
            ('Implement recurring touchpoints', 'At least two repeatable return mechanisms are live.'),
            ('Run a reactivation experiment', 'Inactive members receive a measurable reactivation experiment.'),
            ('Review cohort retention', 'Cohort retention and next intervention are documented.'),
        ],
    },
    'revenue_client': {
        'label': 'Paid research offer pilot',
        'process': 'commercial',
        'priority': Priority.P0,
        'duration': 42,
        'outcome': 'A sellable scientific/research service with a real pipeline from qualified lead to paid delivery.',
        'tasks': [
            ('Package the first paid research offer', 'Scope, buyer, deliverables, exclusions and delivery model are documented.'),
            ('Set pricing and proposal template', 'Pricing logic and a reusable proposal/SOW template are approved.'),
            ('Build and qualify the first lead list', 'A prioritized lead list exists with qualification notes.'),
            ('Run discovery and send proposals', 'Qualified discovery calls are completed and proposals are sent.'),
            ('Close and kick off the first paid project', 'A signed/paid project reaches kickoff with agreed scope.'),
            ('Review delivery economics and client feedback', 'Margin, cycle time, scope and client feedback are reviewed.'),
        ],
    },
    'revenue_sponsor': {
        'label': 'Sponsorship pilot',
        'process': 'commercial',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A sponsor-ready offer tested with real prospects and measurable commercial feedback.',
        'tasks': [
            ('Define sponsorship inventory and boundaries', 'Eligible formats, editorial boundaries and sponsor value are documented.'),
            ('Create sponsor deck and pricing', 'A reusable sponsor deck, packages and pricing ranges are ready.'),
            ('Build target sponsor list', 'A qualified prospect list is prioritized by fit.'),
            ('Run outreach and meetings', 'Outreach is executed and decision-maker feedback is captured.'),
            ('Close or reject the pilot hypothesis', 'A pilot is closed or the offer is explicitly revised/stopped from evidence.'),
        ],
    },
    'revenue_membership': {
        'label': 'Paid membership pilot',
        'process': 'commercial',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A paid membership hypothesis tested with a small cohort and real payment behavior.',
        'tasks': [
            ('Define paid-member value proposition', 'Benefits, target member and non-goals are documented.'),
            ('Set price and payment flow', 'Price, checkout and cancellation flow are working.'),
            ('Recruit beta members', 'A defined beta cohort is invited and payment intent is measured.'),
            ('Deliver the first paid-member benefits', 'Promised beta benefits are delivered on schedule.'),
            ('Review conversion, usage and churn', 'Payment conversion, usage and churn signals are reviewed.'),
        ],
    },
    'revenue_product': {
        'label': 'Science product & licensing pilot',
        'process': 'commercial',
        'priority': Priority.P2,
        'duration': 49,
        'outcome': 'A product, workshop, toolkit or license tested with real buyers before scaling.',
        'tasks': [
            ('Define the product and buyer job', 'Buyer, problem, deliverable and value proposition are documented.'),
            ('Build a minimum sellable version', 'A demonstrable minimum version is ready for buyer feedback.'),
            ('Set pricing and licensing terms', 'Pricing and usage/licensing terms are documented.'),
            ('Run buyer interviews and demos', 'Qualified buyer feedback is captured against explicit assumptions.'),
            ('Run the first paid pilot', 'At least one real payment or explicit commercial decision is recorded.'),
        ],
    },
    'revenue_validation': {
        'label': 'Revenue validation sprint',
        'process': 'commercial',
        'priority': Priority.P1,
        'duration': 35,
        'outcome': 'A disciplined willingness-to-pay experiment that produces a continue/change/stop decision.',
        'tasks': [
            ('Choose the monetization hypothesis', 'One buyer, problem, offer and price hypothesis is written clearly.'),
            ('Build the minimum offer', 'A proposal, landing page or sales artifact can be shown to buyers.'),
            ('Run qualified buyer interviews', 'Enough qualified interviews are completed to identify repeat patterns.'),
            ('Ask for a real commercial commitment', 'Real payment, signed intent or explicit rejection is recorded.'),
            ('Make the continue/change/stop decision', 'Evidence and the next commercial decision are documented.'),
        ],
    },
    'operating_okr': {
        'label': 'OKR operating cadence',
        'process': 'operations',
        'priority': Priority.P0,
        'duration': 28,
        'outcome': 'A living OKR system with owners, data sources and a weekly management rhythm.',
        'tasks': [
            ('Confirm KR owners and definitions', 'Every active KR has one accountable owner and an unambiguous metric definition.'),
            ('Connect KR data sources', 'Each measurable KR has a documented source and update method.'),
            ('Launch weekly KR check-ins', 'A weekly update cadence is running with current value, confidence and health.'),
            ('Build the portfolio review view', 'Managers can see KR, initiative, blocker and capacity status in one place.'),
            ('Run the first monthly OKR review', 'A formal continue/change/stop review is completed and decisions are logged.'),
        ],
    },
    'operating_process': {
        'label': 'Process & cycle rollout',
        'process': 'operations',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'A repeatable process with clear ownership, WIP limits, cadence and measurable cycle performance.',
        'tasks': [
            ('Document the end-to-end process', 'Stages, inputs, outputs and handoffs are documented.'),
            ('Assign owner and role boundaries', 'One process owner and role responsibilities are explicit.'),
            ('Configure cycle and WIP rules', 'Cadence, WIP limits and review points are agreed.'),
            ('Run two real execution cycles', 'Two cycles complete using the defined process rather than ad-hoc execution.'),
            ('Retrospect and update the process', 'Cycle data and team feedback produce a documented process improvement.'),
        ],
    },
    'operating_team': {
        'label': 'Ownership & capacity system',
        'process': 'operations',
        'priority': Priority.P1,
        'duration': 28,
        'outcome': 'Clear ownership and visible capacity so priorities can be assigned without hidden overload.',
        'tasks': [
            ('Map recurring responsibilities', 'Recurring responsibilities and accountable roles are documented.'),
            ('Define capacity and WIP limits', 'Per-person active-priority limits are agreed.'),
            ('Assign current priorities', 'Every active priority has one owner and conflicting work is resolved.'),
            ('Launch weekly capacity review', 'Capacity and WIP are reviewed as part of the weekly operating rhythm.'),
        ],
    },
    'operating_technology': {
        'label': 'Workflow automation sprint',
        'process': 'technology',
        'priority': Priority.P2,
        'duration': 35,
        'outcome': 'A high-friction recurring workflow is automated, tested and monitored.',
        'tasks': [
            ('Select the highest-friction workflow', 'The workflow is selected using frequency, time cost and error risk.'),
            ('Write the automation spec', 'Inputs, outputs, permissions, failure behavior and success metric are documented.'),
            ('Build and test the automation', 'The automation passes functional and permission tests.'),
            ('Release with monitoring', 'The automation is live with observable failure and recovery behavior.'),
            ('Measure time saved and error reduction', 'Before/after data are reviewed and the next automation decision is made.'),
        ],
    },
    'operating_data': {
        'label': 'Research data operations hardening',
        'process': 'technology',
        'priority': Priority.P1,
        'duration': 42,
        'outcome': 'Secure project data flows with explicit permissions, auditability and recoverability.',
        'tasks': [
            ('Classify data and access requirements', 'Data classes, client restrictions and access roles are documented.'),
            ('Standardize project data-room structure', 'Folder/data-room templates and ownership rules are implemented.'),
            ('Audit permissions and sharing paths', 'Project and object access is verified against least-privilege rules.'),
            ('Verify backup and recovery path', 'A documented restore/recovery test succeeds.'),
            ('Run a security/access retrospective', 'Findings, owners and remediation actions are recorded.'),
        ],
    },
    'operating_meetings': {
        'label': 'Decision & review cadence',
        'process': 'operations',
        'priority': Priority.P2,
        'duration': 35,
        'outcome': 'Meetings become decision and follow-up mechanisms rather than disconnected conversations.',
        'tasks': [
            ('Define required meeting types and purpose', 'Each recurring meeting has a purpose, owner and decision scope.'),
            ('Create agenda and decision-log templates', 'Reusable agenda, decision and action-item templates are ready.'),
            ('Run the first recurring sequence', 'The planned meeting sequence runs with owners and action items.'),
            ('Audit follow-up completion', 'Action-item completion and unresolved decisions are reviewed.'),
            ('Remove or redesign low-value meetings', 'Meeting cadence is changed based on evidence from the first sequence.'),
        ],
    },
    'generic': {
        'label': 'KR execution sprint',
        'process': 'operations',
        'priority': Priority.P2,
        'duration': 35,
        'outcome': 'A scoped execution loop that moves the KR from baseline to measurable evidence.',
        'tasks': [
            ('Define scope, baseline and success signal', 'Scope, baseline, owner and the evidence required to move the KR are documented.'),
            ('Build the minimum execution plan', 'The smallest viable path to produce measurable movement is approved.'),
            ('Execute the first pilot', 'The planned pilot is completed with evidence captured.'),
            ('Review the result against the KR', 'Result, blockers and learning are recorded against the KR.'),
            ('Decide scale, change or stop', 'The next decision and owner are explicit.'),
        ],
    },
}


def _lower(value):
    return str(value or '').strip().lower()


def _roadmap_key_map(workspace):
    try:
        state = RoadmapOKRSyncState.objects.get(workspace=workspace)
    except RoadmapOKRSyncState.DoesNotExist:
        return {}
    return {int(value): key for key, value in (state.bindings or {}).get('key_results', {}).items() if str(value).isdigit()}


def _family(objective_title, kr_title):
    objective = _lower(objective_title)
    text = _lower(kr_title)
    if 'content engine' in objective:
        if 'short' in text:
            return 'content_shortform'
        if any(word in text for word in ('long-form', 'main video', 'youtube', 'video')):
            return 'content_longform'
        if any(word in text for word in ('article', 'dossier', 'website', 'learning')):
            return 'content_web'
        if any(word in text for word in ('newsletter', 'subscriber', 'email')):
            return 'content_newsletter'
        if any(word in text for word in ('game', 'quiz', 'simulation', 'interactive', 'tool')):
            return 'content_interactive'
        if any(word in text for word in ('reach', 'distribution', 'view', 'impression', 'audience')):
            return 'content_distribution'
        return 'content_longform'
    if 'community' in objective:
        if any(word in text for word in ('contributor', 'contribution', 'researcher', 'people contributing')):
            return 'community_contributors'
        if any(word in text for word in ('session', 'study club', 'live discussion', 'participant', 'event')):
            return 'community_events'
        if any(word in text for word in ('return', 'retention', 'active member')):
            return 'community_retention'
        return 'community_onboarding'
    if 'revenue' in objective:
        if any(word in text for word in ('client', 'paid project', 'proposal', 'contract')):
            return 'revenue_client'
        if 'sponsor' in text:
            return 'revenue_sponsor'
        if any(word in text for word in ('membership', 'paid member', 'subscription')):
            return 'revenue_membership'
        if any(word in text for word in ('license', 'licensing', 'product', 'workshop', 'kit')):
            return 'revenue_product'
        return 'revenue_validation'
    if 'operating system' in objective or 'data-driven' in objective:
        if any(word in text for word in ('okr', 'metric', 'dashboard', 'key result')):
            return 'operating_okr'
        if any(word in text for word in ('process', 'cycle', 'cadence', 'milestone')):
            return 'operating_process'
        if any(word in text for word in ('owner', 'team', 'capacity', 'wip', 'responsib')):
            return 'operating_team'
        if any(word in text for word in ('automat', 'tool', 'workflow', 'deploy', 'uptime')):
            return 'operating_technology'
        if any(word in text for word in ('data', 'secure', 'access', 'nextcloud', 'backup')):
            return 'operating_data'
        if any(word in text for word in ('meeting', 'review', 'decision')):
            return 'operating_meetings'
        return 'operating_process'
    return 'generic'


def _compact(text, limit=72):
    value = ' '.join(str(text or '').split())
    return value if len(value) <= limit else value[:limit - 1].rstrip() + '…'


def _suggestion(kr, source_key=''):
    family = _family(kr.objective.title, kr.title)
    template = FAMILY_TEMPLATES[family]
    return {
        'key': f'{source_key or kr.pk}:{family}',
        'family': family,
        'title': f'{template["label"]} · {_compact(kr.title, 58)}',
        'label': template['label'],
        'outcome': template['outcome'],
        'process_key': template['process'],
        'priority': template['priority'],
        'duration_days': template['duration'],
        'tasks': [
            {'index': index, 'title': title, 'definition_of_done': done}
            for index, (title, done) in enumerate(template['tasks'])
        ],
    }


def _member(workspace, user_id):
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return None
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user_id=user_id, user__is_active=True).select_related('user').first()
    return membership.user if membership else None


def _planner_json(workspace, user):
    base._ensure_processes(workspace)
    roadmap_keys = _roadmap_key_map(workspace)
    initiatives = Initiative.objects.filter(workspace=workspace).exclude(status=WorkStatus.ARCHIVED).values('key_result_id').annotate(count=Count('id'))
    coverage = {item['key_result_id']: item['count'] for item in initiatives}
    task_counts = OperatingTask.objects.filter(workspace=workspace).exclude(status=WorkStatus.ARCHIVED).values('initiative__key_result_id').annotate(count=Count('id'))
    tasks_by_kr = {item['initiative__key_result_id']: item['count'] for item in task_counts}
    objectives = []
    for objective in workspace.strategic_objectives.exclude(status=WorkStatus.ARCHIVED).order_by('id'):
        key_results = []
        for kr in objective.key_results.exclude(status=WorkStatus.ARCHIVED).order_by('id'):
            source_key = roadmap_keys.get(kr.pk, '')
            key_results.append({
                'id': kr.pk,
                'title': kr.title,
                'roadmap_key': source_key,
                'health': kr.health,
                'progress': base._kr_progress(kr),
                'current_value': str(kr.current_value) if kr.current_value is not None else None,
                'target_value': str(kr.target_value) if kr.target_value is not None else None,
                'unit': kr.unit,
                'initiative_count': coverage.get(kr.pk, 0),
                'task_count': tasks_by_kr.get(kr.pk, 0),
                'suggestion': _suggestion(kr, source_key),
            })
        objectives.append({
            'id': objective.pk,
            'title': objective.title,
            'description': objective.description,
            'health': objective.health,
            'key_results': key_results,
            'planned_count': sum(1 for item in key_results if item['initiative_count']),
        })
    members = [
        base._person(item.user) | {'role': item.role}
        for item in workspace.memberships.select_related('user').filter(user__is_active=True).order_by('user__first_name', 'user__email')
    ]
    processes = [base._process_json(item) for item in OperatingProcess.objects.filter(workspace=workspace, active=True).select_related('owner')]
    total_krs = sum(len(item['key_results']) for item in objectives)
    planned_krs = sum(item['planned_count'] for item in objectives)
    return {
        'ok': True,
        'can_edit': base._editable(type('RequestProxy', (), {'user': user})(), workspace),
        'summary': {
            'objectives': len(objectives),
            'key_results': total_krs,
            'planned_key_results': planned_krs,
            'unplanned_key_results': max(0, total_krs - planned_krs),
        },
        'members': members,
        'processes': processes,
        'objectives': objectives,
    }


def _can_edit(user, workspace):
    if getattr(user, 'is_superuser', False):
        return True
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    return bool(membership and membership.role in {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN, WorkspaceMembership.Role.MEMBER})


@require_http_methods(['GET', 'POST'])
def initiative_planner(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request) if request.method == 'POST' else {}
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    base._ensure_processes(workspace)

    if request.method == 'GET':
        data = _planner_json(workspace, request.user)
        data['can_edit'] = _can_edit(request.user, workspace)
        return JsonResponse(data)

    if not _can_edit(request.user, workspace):
        return base._error('permission_denied', 403)

    kr = KeyResult.objects.select_related('objective').filter(pk=payload.get('key_result_id'), objective__workspace=workspace).first()
    if not kr:
        return base._error('key_result_not_found', 404)
    source_key = _roadmap_key_map(workspace).get(kr.pk, '')
    suggestion = _suggestion(kr, source_key)
    if payload.get('suggestion_key') and payload.get('suggestion_key') != suggestion['key']:
        return base._error('stale_execution_plan', 409)

    owner = _member(workspace, payload.get('owner_id')) or (request.user if WorkspaceMembership.objects.filter(workspace=workspace, user=request.user).exists() else None)
    if not owner:
        return base._error('initiative_owner_required')

    process_key = payload.get('process_key') or suggestion['process_key']
    process = OperatingProcess.objects.filter(workspace=workspace, key=process_key, active=True).first()
    if not process:
        return base._error('invalid_process')

    priority = payload.get('priority') or suggestion['priority']
    if priority not in Priority.values:
        return base._error('invalid_priority')

    today = timezone.localdate()
    due_date = base._date(payload.get('due_date')) or kr.due_date or kr.objective.due_date or (today + timedelta(days=suggestion['duration_days']))
    if due_date < today:
        due_date = today + timedelta(days=suggestion['duration_days'])
    title = str(payload.get('title') or suggestion['title']).strip()
    if not title:
        return base._error('initiative_title_required')
    if Initiative.objects.filter(workspace=workspace, key_result=kr, title=title).exclude(status=WorkStatus.ARCHIVED).exists():
        return base._error('initiative_already_exists', 409)

    selected = payload.get('tasks')
    if selected is None:
        selected = [{'index': item['index'], 'owner_id': owner.pk} for item in suggestion['tasks']]
    if not isinstance(selected, list):
        return base._error('invalid_task_plan')

    blueprints = {item['index']: item for item in suggestion['tasks']}
    prepared = []
    for item in selected:
        try:
            index = int(item.get('index'))
        except (TypeError, ValueError, AttributeError):
            return base._error('invalid_task_plan')
        blueprint = blueprints.get(index)
        task_owner = _member(workspace, item.get('owner_id')) or owner
        if blueprint is None or task_owner is None:
            return base._error('invalid_task_plan')
        prepared.append((blueprint, task_owner, str(item.get('title') or blueprint['title']).strip()))

    with transaction.atomic():
        initiative = Initiative.objects.create(
            workspace=workspace,
            key_result=kr,
            process=process,
            title=title,
            description=str(payload.get('description') or suggestion['outcome']).strip(),
            owner=owner,
            priority=priority,
            stage=process.flow[0] if process.flow else '',
            health=Health.GREEN,
            status=WorkStatus.ACTIVE,
            start_date=today,
            due_date=due_date,
        )
        created_tasks = []
        previous = None
        span_days = max(1, (due_date - today).days)
        total = max(1, len(prepared))
        for position, (blueprint, task_owner, task_title) in enumerate(prepared, start=1):
            task_due = today + timedelta(days=max(1, round(span_days * position / total)))
            task = OperatingTask.objects.create(
                workspace=workspace,
                initiative=initiative,
                owner=task_owner,
                title=task_title,
                description='',
                priority=Priority.P1 if priority in {Priority.P0, Priority.P1} and position == total else Priority.P2,
                status=WorkStatus.ACTIVE,
                due_date=task_due,
                definition_of_done=blueprint['definition_of_done'],
                dependency=previous,
            )
            created_tasks.append(task)
            previous = task

    return JsonResponse({
        'ok': True,
        'initiative': base._initiative_json(initiative),
        'tasks': [base._task_json(item) for item in created_tasks],
    }, status=201)
