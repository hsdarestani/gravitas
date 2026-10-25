"""Authenticated project-scoped pilot API; requests never execute experiments."""
import csv
import io
import json
import uuid
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from .research_project_tools import _project, _payload, _error
from .research_models import ResearchExperiment
from .platform_access import can_manage
from .scientific_lab_models import ScientificLabRun
from .scientific_lab_methods import VERSION, PILOT, RUBRIC, digest, validate_protocol, summary, assessment_summary
from .scientific_lab_runner import providers, event


def enabled():
    return bool(getattr(settings, 'SCIENTIFIC_LAB_ENABLED', False))


def serialize(run):
    result = {'id': str(run.pk), 'experiment_id': run.experiment_id, 'project_id': run.experiment.project_id, 'creator_id': run.creator_id, 'state': run.state, 'protocol': run.protocol, 'protocol_hash': run.protocol_hash, 'trials': run.trials, 'summary': summary(run.trials), 'error': run.error, 'created_at': run.created_at.isoformat(), 'events': [{'id': e.pk, 'actor_id': e.actor_id, 'kind': e.kind, 'detail': e.detail, 'at': e.created_at.isoformat()} for e in run.events.all()]}
    result['human_assessments'] = assessment_summary(result['events'])
    return result


@require_http_methods(['GET'])
def catalog(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    return JsonResponse({'enabled': enabled(), 'version': VERSION, 'providers': providers() if enabled() else [], 'pilot': PILOT, 'rubric': RUBRIC, 'csrf_token': get_token(request), 'limits': {'repeats': 5, 'references': 5, 'runs_per_user_day': 10, 'runs_per_project_day': 25}, 'scientific_approval': 'Required from an independent project manager; no named person has approved this pilot.'})


@require_http_methods(['GET', 'POST'])
def runs(request, project_id):
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'runs': [{'id': str(r.pk), 'state': r.state, 'question': r.protocol['question'], 'created_at': r.created_at.isoformat()} for r in ScientificLabRun.objects.filter(experiment__project=project).order_by('-created_at')[:100]]})
    if not enabled():
        return _error('scientific_lab_disabled', 503)
    data = _payload(request)
    if data is None or len(request.body) > 20000:
        return _error('invalid_payload')
    try:
        key = uuid.UUID(str(data.get('idempotency_key')))
        protocol = validate_protocol(data.get('protocol'), providers())
    except (ValueError, TypeError) as exc:
        return _error(str(exc)[:100])
    with transaction.atomic():
        # Serialize per user then project, including quotas and deduplication.
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        type(project).objects.select_for_update().get(pk=project.pk)
        previous = ScientificLabRun.objects.filter(creator=request.user, idempotency_key=key).first()
        if previous:
            if previous.experiment.project_id != project.pk or previous.protocol_hash != digest(protocol):
                return _error('idempotency_conflict', 409)
            return JsonResponse({'run': serialize(previous)})
        recent = ScientificLabRun.objects.filter(created_at__gte=timezone.now()-timedelta(days=1))
        if recent.filter(creator=request.user).count() >= 10 or recent.filter(experiment__project=project).count() >= 25:
            return _error('daily_run_quota', 429)
        experiment = ResearchExperiment.objects.create(project=project, owner=request.user, title=protocol['question'][:240], hypothesis=protocol['hypothesis'], protocol=json.dumps(protocol, ensure_ascii=False), metadata={'category': 'empirical_research_experiment', 'topic': '01', 'method_version': VERSION})
        run = ScientificLabRun.objects.create(experiment=experiment, creator=request.user, idempotency_key=key, protocol=protocol, protocol_hash=digest(protocol))
        event(run, request.user, 'protocol_created', {'hash': run.protocol_hash, 'approval': 'none'})
    return JsonResponse({'run': serialize(run)}, status=201)


@require_http_methods(['GET', 'POST'])
def detail(request, project_id, run_id):
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _error('not_found', 404)
    with transaction.atomic():
        run = ScientificLabRun.objects.select_for_update().select_related('experiment').filter(pk=run_id, experiment__project=project).first()
        if not run:
            return _error('not_found', 404)
        if request.method == 'GET':
            return JsonResponse({'run': serialize(run)})
        data = _payload(request)
        if data is None or len(request.body) > 20000:
            return _error('invalid_payload')
        action = data.get('action')
        independent = can_manage(request.user, project) and request.user.pk != run.creator_id
        comment = data.get('comment', '')
        if not isinstance(comment, str) or len(comment) > 8000:
            return _error('invalid_comment')
        transitions = {'submit_protocol': ('draft', 'protocol_review'), 'approve_protocol': ('protocol_review', 'approved'), 'request_corrections': ('protocol_review', 'corrections_required'), 'queue': ('approved', 'queued'), 'review_results': ('results_pending_review', 'reviewed'), 'publish': ('reviewed', 'published')}
        if action in transitions:
            before, after = transitions[action]
            if run.state != before:
                return _error('invalid_transition', 409)
            if action in ('approve_protocol', 'request_corrections', 'review_results') and (not independent or len(comment.strip()) < 10):
                return _error('independent_manager_and_reason_required', 403)
            if action == 'publish' and not can_manage(request.user, project):
                return _error('project_manager_required', 403)
            if action == 'queue' and not enabled():
                return _error('scientific_lab_disabled', 503)
            if action == 'queue' and not run.protocol.get('pricing'):
                return _error('operator_model_pricing_required', 409)
            if action == 'review_results':
                completed = [t for t in run.trials if t['status'] == 'complete']
                assessments = list(run.events.filter(kind='assessment').values_list('detail', flat=True))
                # Independent assessment of every returned reference/response is required.
                needed = {(t['id'], i) for t in completed for i in (range(len(t.get('citations', []))) if run.protocol['kind'] == 'citation' else [-1])}
                reviewed = {(a['trial'], a['citation']) for a in assessments if a.get('independent')}
                if not completed or not needed or not needed.issubset(reviewed):
                    return _error('independent_evidence_assessments_required', 409)
            run.state = after
            run.save(update_fields=['state', 'updated_at'])
            event(run, request.user, action, {'comment': comment, 'protocol_hash': run.protocol_hash, 'from': before, 'to': after})
        elif action == 'cancel':
            if run.state not in ('queued', 'running'):
                return _error('invalid_transition', 409)
            run.state = 'cancel_requested' if run.state == 'running' else 'cancelled'
            run.save(update_fields=['state', 'updated_at'])
            event(run, request.user, 'cancel', {})
        elif action == 'comment':
            if not comment.strip():
                return _error('comment_required')
            event(run, request.user, 'comment', {'comment': comment})
        elif action == 'assessment':
            if run.state != 'results_pending_review':
                return _error('assessment_requires_pending_results', 409)
            trial = next((t for t in run.trials if t['id'] == data.get('trial') and t['status'] == 'complete'), None)
            index = data.get('citation', -1)
            outcomes = ('supportive', 'contradicts', 'does_not_support', 'insufficient') if run.protocol['kind'] == 'citation' else ('yes', 'no', 'ambiguous')
            if not trial or type(index) is not int or (run.protocol['kind'] == 'citation' and not 0 <= index < len(trial.get('citations', []))) or (run.protocol['kind'] == 'framing' and index != -1):
                return _error('invalid_assessment_target')
            if data.get('outcome') not in outcomes or len(comment.strip()) < 20:
                return _error('outcome_and_evidence_rationale_required')
            seconds = data.get('effort_seconds', 0)
            if type(seconds) is not int or not 0 <= seconds <= 86400:
                return _error('invalid_effort')
            event(run, request.user, 'assessment', {'trial': trial['id'], 'citation': index, 'outcome': data['outcome'], 'comment': comment, 'effort_seconds': seconds, 'independent': independent, 'condition': trial['condition'], 'human_condition': 'C' if trial['condition'] == 'retrieval' else None})
        else:
            return _error('unknown_action')
        return JsonResponse({'run': serialize(run)})


@require_http_methods(['GET'])
def export(request, project_id, run_id):
    project = _project(request, project_id)
    run = ScientificLabRun.objects.filter(pk=run_id, experiment__project=project).first() if project else None
    if not run:
        return _error('not_found', 404)
    data = serialize(run)
    fmt = request.GET.get('format', 'json')
    if fmt == 'json':
        content, mime = json.dumps(data, indent=2, ensure_ascii=False), 'application/json'
    elif fmt == 'md':
        p = run.protocol
        content = f"# Topic 01 research report\n\nResearch question: {p['question']}\n\nHypothesis: {p['hypothesis']}\n\nReview state: {run.state}\n\n## Methods\n\n```json\n{json.dumps(p, indent=2, ensure_ascii=False)}\n```\n\n## Observations and provenance\n\n```json\n{json.dumps(data['trials'], indent=2, ensure_ascii=False)}\n```\n\n## Descriptive analysis\n\n```json\n{json.dumps(data['summary'], indent=2)}\n```\n\n## Human interpretation, review and disagreements\n\n```json\n{json.dumps(data['events'], indent=2, ensure_ascii=False)}\n```\n\n## Limitations\n\n{p['limitations']}\n\nMachine responses and registry matches are observations, not validated scientific conclusions. Human reviews remain attributed and fallible. Published means published within the private project.\n\nProtocol SHA256: {run.protocol_hash}\n"
        mime = 'text/markdown'
    elif fmt == 'csv':
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(['run', 'trial', 'condition', 'status', 'doi', 'title', 'claim', 'metadata_status', 'duplicate'])
        def safe(v):
            v = str(v)
            return "'"+v if v.lstrip().startswith(('=', '+', '-', '@')) else v
        for t in run.trials:
            for c in t.get('citations') or [{}]:
                writer.writerow([safe(x) for x in [run.pk, t['id'], t['condition'], t['status'], c.get('doi', ''), c.get('title', ''), c.get('claim', ''), c.get('validation', {}).get('status', ''), c.get('duplicate', '')]])
        content, mime = stream.getvalue(), 'text/csv'
    else:
        return _error('unsupported_export')
    response = HttpResponse(content, content_type=mime+'; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="graviquest-{run.pk}.{fmt}"'
    response['Cache-Control'] = 'private, no-store'
    return response
