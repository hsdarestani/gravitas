"""Public paired evidence, bounded guest coaching and private account history."""
import hashlib
import json
import time
import uuid
from collections import defaultdict
from statistics import mean

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .lab_knowledge import POLICY_KEYS, atlas_context, published_lab
from .lab_knowledge_models import LabCoachTrial, LabConversation, LabKnowledgeDocument

TRIAL_LIMIT = 25
MEASURES = ('published', 'healthyPapers', 'falsePublished', 'falseDiscoveryRate', 'replicated',
            'retracted', 'reviewBacklog', 'replicationBacklog', 'generated', 'tested', 'citations')


def paired_metrics(pairs):
    metrics = {}
    for metric in MEASURES:
        if not all(type(p[side]['result'].get(metric)) in (int, float) for p in pairs for side in ('a', 'b')):
            continue
        a, b = [p['a']['result'][metric] for p in pairs], [p['b']['result'][metric] for p in pairs]
        delta = [y-x for x, y in zip(a, b)]
        metrics[metric] = {'a': mean(a), 'b': mean(b), 'delta': mean(delta),
                           'delta_min': min(delta), 'delta_max': max(delta),
                           'seed_direction': 'mixed' if min(delta) < 0 < max(delta) else 'same_or_zero'}
    return metrics


def selected_atlas_summary(rows, selection):
    """Summarize verified rows only when they form one complete, controlled comparison."""
    policy, low, high = (selection.get(k) for k in ('policy', 'low', 'high'))
    if (not rows or policy not in POLICY_KEYS or type(low) is not int or type(high) is not int
            or not 1 <= low <= 10 or not 1 <= high <= 10 or low == high):
        return None
    reference = rows[0]
    fixed = {k: v for k, v in reference['parameters'].items() if k != policy}
    grouped = defaultdict(dict)
    for row in rows:
        if (row['days'] != reference['days'] or row['design'] != reference['design']
                or {k: v for k, v in row['parameters'].items() if k != policy} != fixed
                or row['parameters'].get(policy) not in (low, high)):
            return None
        grouped[row['seed']][row['parameters'][policy]] = row
    if any(low not in group or high not in group for group in grouped.values()):
        return None
    pairs = [{'a': group[low], 'b': group[high]} for group in grouped.values()]
    return {'policy': policy, 'a_setting': low, 'b_setting': high,
            'days': reference['days'], 'matched_seeds': len(pairs),
            'metrics': paired_metrics(pairs), 'provenance': 'server_verified_stored_model_runs',
            'reading_rule': 'Counts are not probabilities. Mixed seed differences do not establish a consistent increase. Seed spread is descriptive, not a confidence interval; these are synthetic outcomes, not empirical findings.'}


def trial_row(request, lab):
    token = request.session.get('lab_guest_trial')
    if not token:
        token = uuid.uuid4().hex
        request.session['lab_guest_trial'] = token
    signature = hashlib.sha256(f'{lab.pk}:{token}'.encode()).hexdigest()
    return LabCoachTrial.objects.get_or_create(lab=lab, signature=signature)[0]


def trial_json(row=None, authenticated=False):
    pending = len([x for x in (row.reservations if row else []) if time.time()-x['at'] < 180])
    used = row.used if row else 0
    return {'authenticated': authenticated, 'limit': TRIAL_LIMIT, 'used': used,
            'remaining': None if authenticated else max(0, TRIAL_LIMIT-used-pending),
            'simulation_open': True, 'account_saves_history': True}


def reserve_coaching(request, lab, charge):
    if request.user.is_authenticated:
        return None, None
    row = trial_row(request, lab)
    with transaction.atomic():
        row = LabCoachTrial.objects.select_for_update().get(pk=row.pk)
        row.reservations = [x for x in row.reservations if time.time()-x['at'] < 180]
        if row.used+len(row.reservations) >= TRIAL_LIMIT:
            return None, trial_json(row)
        token = uuid.uuid4().hex if charge else None
        if token:
            row.reservations.append({'id': token, 'at': time.time()})
            row.save(update_fields=['reservations', 'updated_at'])
    return (row.pk, token) if token else None, None


def finish_coaching(reservation, success):
    if not reservation:
        return None
    pk, token = reservation
    with transaction.atomic():
        row = LabCoachTrial.objects.select_for_update().get(pk=pk)
        found = any(x['id'] == token for x in row.reservations)
        row.reservations = [x for x in row.reservations if x['id'] != token]
        if found and success:
            row.used += 1
        row.save(update_fields=['used', 'reservations', 'updated_at'])
        return trial_json(row)


@never_cache
@require_http_methods(['GET'])
def lab_access(request, slug):
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    signed_in = request.user.is_authenticated
    return JsonResponse({'ok': True, **trial_json(None if signed_in else trial_row(request, lab), signed_in),
                         'owner_id': request.user.pk if signed_in else None})


@never_cache
@require_http_methods(['GET', 'POST'])
def lab_conversation(request, slug):
    from .lab_api import _body
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        record = LabConversation.objects.filter(lab=lab, owner=request.user).first()
        return JsonResponse({'ok': True, 'messages': record.messages if record else [], 'provenance': 'browser_reported'})
    try:
        data = _body(request, limit=180000)
        incoming = data.get('messages')
        if not isinstance(incoming, list) or len(incoming) > 100:
            raise ValueError('invalid_messages')
        documents = {d.slug: {section['anchor']: (d.title, section['title']) for section in d.sections} for d in LabKnowledgeDocument.objects.filter(lab=lab, is_published=True)}
        cleaned = []
        for message in incoming:
            if not isinstance(message, dict) or message.get('role') not in ('user', 'pulsar'):
                raise ValueError('invalid_message')
            if not isinstance(message.get('id'), str) or not 1 <= len(message['id']) <= 100:
                raise ValueError('invalid_message_id')
            text = message.get('text')
            if not isinstance(text, str) or not 1 <= len(text) <= 1800:
                raise ValueError('invalid_message_text')
            at = message.get('at')
            if type(at) not in (int, float) or not 0 <= at < 1e15:
                raise ValueError('invalid_message_time')
            citations = []
            for cite in (message.get('citations') if isinstance(message.get('citations'), list) else [])[:6]:
                if isinstance(cite, dict) and cite.get('document') in documents and cite.get('anchor') in documents[cite['document']]:
                    title, section = documents[cite['document']][cite['anchor']]
                    citations.append({'document': cite['document'], 'anchor': cite['anchor'], 'title': title, 'section': section})
            cleaned.append({'citations': citations, 'id': message['id'], 'role': message['role'], 'text': text, 'at': at,
                            'title': str(message.get('title', ''))[:100],
                            'provider': 'ai' if message.get('provider') == 'ai' else 'guide'})
        with transaction.atomic():
            record, _ = LabConversation.objects.get_or_create(lab=lab, owner=request.user)
            record = LabConversation.objects.select_for_update().get(pk=record.pk)
            merged = {m['id']: m for m in record.messages}
            # Existing messages are immutable; replaying a client history is idempotent.
            for message in cleaned:
                merged.setdefault(message['id'], message)
            record.messages = sorted(merged.values(), key=lambda m: (m['at'], m['id']))[-200:]
            record.save(update_fields=['messages', 'updated_at'])
        return JsonResponse({'ok': True, 'saved': len(cleaned), 'provenance': record.provenance})
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)


@never_cache
@require_http_methods(['GET'])
def lab_scenario_comparison(request, slug):
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    policy = request.GET.get('policy', 'verification')
    try:
        low, high = int(request.GET.get('low', '3')), int(request.GET.get('high', '9'))
        if policy not in POLICY_KEYS or not 1 <= low <= 10 or not 1 <= high <= 10 or low == high:
            raise ValueError()
    except (TypeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'invalid_comparison'}, status=400)
    engine_sha = atlas_context(lab, {})['engine_sha']
    rows = list(lab.scenario_atlas.filter(engine_sha=engine_sha,
                family__in=['baseline', 'single:'+policy]).values(
                    'signature', 'parameters', 'design', 'seed', 'days', 'result', 'trajectory'))
    # All single-policy rows share the same other controls/design as the stored baseline.
    reference = next((r for r in rows if all(r['parameters'].get(k) is not None for k in POLICY_KEYS)), None)
    if not reference:
        return JsonResponse({'ok': False, 'error': 'comparison_not_available'}, status=404)
    others = {k: v for k, v in reference['parameters'].items() if k != policy}
    groups = defaultdict(dict)
    for row in rows:
        value = row['parameters'].get(policy)
        if row['design'] != reference['design'] or row['days'] != reference['days']:
            continue
        if value not in (low, high) or any(row['parameters'].get(k) != v for k, v in others.items()):
            continue
        key = (row['seed'], row['days'], json.dumps(row['design'], sort_keys=True))
        groups[key][value] = row
    pairs = [{'seed': key[0], 'days': key[1], 'design': values[low]['design'],
              'a': values[low], 'b': values[high]} for key, values in sorted(groups.items())
             if low in values and high in values]
    if not pairs:
        return JsonResponse({'ok': False, 'error': 'comparison_not_available'}, status=404)
    metrics = paired_metrics(pairs)
    # Emit aligned means only at model days available in every matched run.
    trajectories = [{int(t['day']): t for t in p[side]['trajectory']} for p in pairs for side in ('a', 'b')]
    days = sorted(set.intersection(*(set(t) for t in trajectories))) if trajectories else []
    trajectory = []
    for day in days:
        point = {'day': day}
        for side in ('a', 'b'):
            sample = [{int(t['day']): t for t in p[side]['trajectory']}[day] for p in pairs]
            point[side] = {m: mean(t[m] for t in sample) for m in metrics if all(type(t.get(m)) in (int, float) for t in sample)}
        trajectory.append(point)
    return JsonResponse({'ok': True, 'engine_sha': engine_sha, 'policy': policy, 'low': low, 'high': high,
        'matched_seeds': len(pairs), 'days': pairs[0]['days'], 'metrics': metrics, 'trajectory': trajectory,
        'pairs': [{**p, 'a': {k:v for k,v in p['a'].items() if k != 'trajectory'},
                  'b': {k:v for k,v in p['b'].items() if k != 'trajectory'}} for p in pairs],
        'provenance': 'stored_model_execution', 'limitations': 'Paired synthetic model runs. Sampled seed spread is not a confidence interval or empirical evidence.'})
