"""Bounded, identity-bound Lab telemetry and admin-only cohort analytics."""
import csv
from datetime import date, datetime, time, timedelta
import logging
import math
import re
import secrets
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import DatabaseError, connection, transaction
from django.db.models import Case, CharField, Count, F, Func, IntegerField, Max, Min, Q, Sum, Value, When
from django.db.models.functions import Cast, Concat, TruncDate
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.crypto import salted_hmac
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .lab_knowledge import published_lab
from .lab_usage_models import LabUsageEvent, LabUsageVisit

log = logging.getLogger(__name__)
CLIENT_KINDS = frozenset(('opened', 'closed', 'play', 'pause', 'step', 'reset',
    'comparison_created', 'comparison_viewed', 'atlas_replayed', 'parameter_changed', 'laboratory_moved',
    'view_changed', 'guide_started', 'guide_step', 'guide_test', 'guide_completed', 'guide_skipped',
    'atlas_opened', 'atlas_compared', 'sources_opened', 'source_read', 'snapshot_requested'))
SERVER_KINDS = frozenset(('pulsar_question', 'pulsar_answered', 'pulsar_failed', 'trial_exhausted', 'snapshot_saved'))
COUNTERS = {'comparison_created': 'comparisons', 'atlas_replayed': 'comparisons',
    'parameter_changed': 'policy_changes', 'atlas_compared': 'atlas_comparisons',
    'source_read': 'source_reads', 'pulsar_question': 'pulsar_questions',
    'pulsar_answered': 'pulsar_answers', 'pulsar_failed': 'pulsar_failures', 'snapshot_saved': 'snapshots'}
TOTALS = ('active_seconds', 'comparisons', 'policy_changes', 'guide_tests', 'atlas_comparisons',
          'source_reads', 'pulsar_questions', 'pulsar_answers', 'pulsar_failures', 'snapshots')
SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,100}$')


def analytics_allowed(request):
    return request.COOKIES.get('gq_lab_analytics') == '1'


def visitor_key(request):
    token = request.session.get('lab_usage_visitor')
    if not token:
        token = secrets.token_hex(24)
        request.session['lab_usage_visitor'] = token
    return salted_hmac('graviquest.lab-usage', token, algorithm='sha256').hexdigest()


def client_device(request):
    ua = request.META.get('HTTP_USER_AGENT', '')[:1000]
    os = next((name for token, name in [('Android', 'Android'), ('iPhone', 'iOS'),
        ('iPad', 'iPadOS'), ('Windows', 'Windows'), ('Macintosh', 'macOS'), ('Linux', 'Linux')]
        if token in ua), 'Other')
    browser = next((name for token, name in [('Edg/', 'Edge'), ('OPR/', 'Opera'),
        ('Firefox/', 'Firefox'), ('Chrome/', 'Chrome'), ('Safari/', 'Safari')]
        if token in ua), 'Other')
    device = 'tablet' if 'iPad' in ua or ('Android' in ua and 'Mobile' not in ua) else 'mobile' if 'Mobile' in ua or 'iPhone' in ua else 'desktop'
    return {'operating_system': os, 'browser': browser, 'device': device}


def clean_data(raw):
    raw = raw if isinstance(raw, dict) else {}
    data = {}
    for key in ('parameter', 'document', 'view', 'provider', 'error'):
        value = raw.get(key)
        if isinstance(value, str) and SAFE_ID.fullmatch(value):
            data[key] = value[:100]
    for key in ('value', 'from', 'day', 'days', 'step', 'seed', 'low', 'high', 'laboratory'):
        value = raw.get(key)
        if type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e12:
            data[key] = value
    if raw.get('world') in ('A', 'B'):
        data['world'] = raw['world']
    return data


def bound_visit(request, lab, visit_id):
    visit_id = uuid.UUID(str(visit_id))
    key = visitor_key(request)
    owner = request.user.pk if request.user.is_authenticated else None
    visit, _ = LabUsageVisit.objects.get_or_create(id=visit_id, defaults={
        'lab': lab, 'visitor_key': key, 'user_id': owner,
        'published_version': lab.published_version, **client_device(request)})
    visit = LabUsageVisit.objects.select_for_update().get(pk=visit.pk)
    if visit.lab_id != lab.pk or visit.visitor_key != key or (visit.user_id and visit.user_id != owner):
        raise ValueError('visit_conflict')
    if owner and visit.user_id is None:
        visit.user_id = owner
        visit.save(update_fields=['user'])
    return visit


def add_event(visit, kind, data, event_id=None, provenance='browser_reported'):
    event_id = event_id or uuid.uuid4()
    event, created = LabUsageEvent.objects.get_or_create(id=event_id, defaults={
        'visit': visit, 'kind': kind, 'data': clean_data(data), 'provenance': provenance})
    if event.visit_id != visit.pk:
        raise ValueError('event_conflict')
    if not created:
        return
    visit.event_count += 1
    field = COUNTERS.get(kind)
    if field:
        setattr(visit, field, getattr(visit, field) + 1)
    if kind == 'guide_test':
        visit.guide_tests += 1
        visit.comparisons += 1
    if kind == 'guide_completed':
        visit.guide_completed = True
    if kind == 'closed':
        visit.ended_at = timezone.now()


def record_server_action(request, lab, visit_id, kind, data=None):
    if not analytics_allowed(request) or not visit_id or kind not in SERVER_KINDS:
        return
    key = 'lab:usage:server:' + str(lab.pk) + ':' + str(visit_id)[:64]
    if not cache.add(key, 1, 60) and cache.incr(key) > 120:
        return
    try:
        with transaction.atomic():
            visit = bound_visit(request, lab, visit_id)
            add_event(visit, kind, data, provenance='server_confirmed')
            visit.last_seen_at = timezone.now()
            visit.save()
    except (ValueError, TypeError, AttributeError, DatabaseError):
        # Analytics must not turn a successfully delivered answer/snapshot into an error.
        log.warning('Lab usage action could not be recorded', extra={'lab_id': lab.pk, 'kind': kind})


@never_cache
@csrf_exempt
@require_POST
def lab_usage(request, slug):
    from .lab_api import _body
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    origin = request.META.get('HTTP_ORIGIN')
    if request.META.get('HTTP_SEC_FETCH_SITE') == 'cross-site' or (origin and origin != request.build_absolute_uri('/').rstrip('/')):
        return JsonResponse({'ok': False, 'error': 'same_origin_required'}, status=403)
    if not analytics_allowed(request):
        return JsonResponse({'ok': True, 'tracking': False})
    try:
        data = _body(request, limit=32000)
        events = data.get('events', [])
        active = data.get('active_seconds', 0)
        if not isinstance(events, list) or len(events) > 30 or type(active) is not int or not 0 <= active <= 7*86400:
            raise ValueError('invalid_usage_batch')
        cleaned = []
        for event in events:
            if not isinstance(event, dict) or event.get('kind') not in CLIENT_KINDS:
                raise ValueError('invalid_usage_event')
            cleaned.append((uuid.UUID(str(event.get('id'))), event['kind'], clean_data(event.get('data'))))
        key = 'lab:usage:' + visitor_key(request) + ':' + str(lab.pk)
        if not cache.add(key, 1, 60) and cache.incr(key) > 120:
            return JsonResponse({'ok': False, 'error': 'rate_limited'}, status=429)
        with transaction.atomic():
            visit = bound_visit(request, lab, data.get('visit'))
            if visit.event_count + len(cleaned) > 10000:
                raise ValueError('visit_event_limit')
            for event_id, kind, detail in cleaned:
                add_event(visit, kind, detail, event_id)
            now = timezone.now()
            visit.active_seconds = max(visit.active_seconds, min(active, max(0, int((now-visit.started_at).total_seconds()))))
            visit.last_seen_at = now
            visit.save()
        return JsonResponse({'ok': True, 'visit': str(visit.pk)})
    except (ValueError, TypeError, AttributeError) as exc:
        reason = str(exc) if str(exc) in ('visit_conflict', 'event_conflict', 'visit_event_limit') else 'invalid_usage_batch'
        return JsonResponse({'ok': False, 'error': reason}, status=409 if reason.endswith('conflict') else 400)


def filtered_visits(request):
    try:
        zone = ZoneInfo(request.GET.get('tz', 'Asia/Tehran'))
        today = timezone.now().astimezone(zone).date()
        first = date.fromisoformat(request.GET.get('from', (today-timedelta(days=29)).isoformat()))
        last = date.fromisoformat(request.GET.get('to', today.isoformat()))
        if first > last or (last-first).days > 3660:
            raise ValueError()
        start = datetime.combine(first, time.min, zone)
        end = datetime.combine(last+timedelta(days=1), time.min, zone)
        rows = LabUsageVisit.objects.filter(started_at__gte=start, started_at__lt=end)
        lab_id = request.GET.get('lab', '')
        if lab_id:
            rows = rows.filter(lab_id=int(lab_id))
        audience = request.GET.get('audience', 'all')
        if audience not in ('all', 'members', 'guests'):
            raise ValueError()
        if audience != 'all':
            rows = rows.filter(user__isnull=audience == 'guests')
        query = request.GET.get('q', '').strip()[:120]
        if query:
            rows = rows.filter(Q(user__username__icontains=query) | Q(user__email__icontains=query) |
                Q(user__first_name__icontains=query) | Q(user__last_name__icontains=query) |
                Q(visitor_key__istartswith=query.removeprefix('Guest ')))
        return rows, {'from': first.isoformat(), 'to': last.isoformat(), 'tz': str(zone)}, zone
    except (ValueError, ZoneInfoNotFoundError, OverflowError):
        raise ValueError('invalid_usage_filter')


def totals(rows):
    values = rows.aggregate(sessions=Count('pk'), **{k: Sum(k) for k in TOTALS},
        completed_guides=Sum(Case(When(guide_completed=True, then=1), default=0, output_field=IntegerField())))
    return {k: v or 0 for k, v in values.items()}


def identity_expression():
    return Case(When(user_id__isnull=False, then=Concat(Value('u:'), Cast('user_id', CharField()))),
        default=Concat(Value('g:'), F('visitor_key')), output_field=CharField())


def grouped_visitors(rows):
    return rows.annotate(identity=identity_expression()).values('identity').annotate(
        user_id=Max('user_id'), sessions=Count('pk'), labs=Count('lab_id', distinct=True),
        first_seen=Min('started_at'), last_seen=Max('last_seen_at'),
        **{k: Sum(k) for k in TOTALS},
        completed_guides=Sum(Case(When(guide_completed=True, then=1), default=0, output_field=IntegerField()))
    ).order_by('-last_seen', 'identity')


def profile(user):
    return {'id': user.pk, 'name': user.get_full_name() or user.username,
            'username': user.username, 'email': user.email} if user else None


def visitor_rows(groups):
    groups = list(groups)
    users = get_user_model().objects.in_bulk(g['user_id'] for g in groups if g['user_id'])
    return [{**g, 'user': profile(users.get(g['user_id'])),
             'guest_id': g['identity'][2:14] if g['identity'].startswith('g:') else None} for g in groups]


def pagination(request, count, size=25):
    try:
        page = int(request.GET.get('page', '1'))
        if not 1 <= page <= 1000000:
            raise ValueError()
    except ValueError:
        raise ValueError('invalid_page')
    return page, (page-1)*size, {'page': page, 'pages': max(1, math.ceil(count/size)), 'total': count, 'page_size': size}


def admin_allowed(request):
    from .lab_api import _admin
    return _admin(request)


@never_cache
@require_GET
def admin_lab_usage(request):
    from .lab_api import _denied
    from .models import InteractiveLab
    from .lab_knowledge_models import LabCoachTrial, LabConversation, LabRunSnapshot
    if not admin_allowed(request):
        return _denied(request)
    try:
        rows, period, zone = filtered_visits(request)
        groups = grouped_visitors(rows)
        if request.GET.get('format') == 'csv':
            class Echo:
                def write(self, value): return value
            writer = csv.writer(Echo())
            def safe(value):
                text = str(value or '')
                return "'"+text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r')) else text
            def lines():
                yield writer.writerow(['Visitor', 'Email', 'Account ID', 'Sessions', 'Labs', 'Active seconds', 'Comparisons', 'Parameter changes', 'Guide tests', 'Completed guides', 'Atlas comparisons', 'Pulsar questions', 'Pulsar answers', 'Pulsar failures', 'Saved snapshots', 'First seen', 'Last seen'])
                for group in groups.iterator(chunk_size=200):
                    user = get_user_model().objects.filter(pk=group['user_id']).first() if group['user_id'] else None
                    yield writer.writerow([safe(user.get_full_name() or user.username) if user else 'Guest '+group['identity'][2:14],
                        safe(user.email) if user else '', group['user_id'] or '', group['sessions'], group['labs'],
                        *[group[k] for k in ('active_seconds', 'comparisons', 'policy_changes', 'guide_tests', 'completed_guides', 'atlas_comparisons', 'pulsar_questions', 'pulsar_answers', 'pulsar_failures', 'snapshots')],
                        group['first_seen'].isoformat(), group['last_seen'].isoformat()])
            response = StreamingHttpResponse(lines(), content_type='text/csv; charset=utf-8')
            response['Content-Disposition'] = 'attachment; filename="lab-usage-'+period['from']+'-'+period['to']+'.csv"'
            return response
        page, offset, pager = pagination(request, groups.count())
        summary = totals(rows)
        summary.update(member_users=rows.filter(user__isnull=False).values('user_id').distinct().count(),
            guest_visitors=rows.filter(user__isnull=True).values('visitor_key').distinct().count())
        per_lab = list(rows.values('lab_id', 'lab__title', 'lab__slug').annotate(sessions=Count('pk'),
            **{k: Sum(k) for k in TOTALS}).order_by('-sessions', 'lab_id'))
        daily = list(rows.annotate(day=TruncDate('started_at', tzinfo=zone)).values('day').annotate(
            sessions=Count('pk'), active_seconds=Sum('active_seconds'), comparisons=Sum('comparisons'),
            pulsar_answers=Sum('pulsar_answers')).order_by('day'))
        lab_filter = {'lab_id': int(request.GET['lab'])} if request.GET.get('lab') else {}
        saved = {'snapshots': LabRunSnapshot.objects.filter(**lab_filter).count(),
                 'conversations': LabConversation.objects.filter(**lab_filter).count(),
                 'guest_questions': LabCoachTrial.objects.filter(**lab_filter).aggregate(n=Sum('used'))['n'] or 0}
        return JsonResponse({'ok': True, 'period': period, 'summary': summary, 'by_lab': per_lab, 'daily': daily,
            'visitors': {**pager, 'items': visitor_rows(groups[offset:offset+25])}, 'saved_records_all_time': saved,
            'labs': list(InteractiveLab.objects.filter(studio_enabled=True).values('id', 'slug', 'title')),
            'coverage': {'first_tracked_session': LabUsageVisit.objects.aggregate(n=Min('started_at'))['n'],
                'session_basis': 'Sessions started in the selected range; totals cover activity in those sessions.',
                'active_time_basis': 'Browser-reported foreground time with recent interaction; background and idle time excluded.',
                'history': 'Visit analytics includes only visitors who opted in. Earlier untracked visits cannot be reconstructed. Saved service records are separate all-time counts.',
                'identity': 'Members use verified account identities; guests use pseudonymous browser identifiers. No IP addresses or question text are collected here.'}})
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)


def visit_json(visit):
    return {'id': str(visit.pk), 'lab': {'id': visit.lab_id, 'title': visit.lab.title, 'slug': visit.lab.slug},
        'user': profile(visit.user), 'guest_id': visit.visitor_key[:12] if not visit.user_id else None,
        'published_version': visit.published_version, 'started_at': visit.started_at,
        'last_seen_at': visit.last_seen_at, 'ended_at': visit.ended_at,
        'device': visit.device, 'browser': visit.browser, 'operating_system': visit.operating_system,
        'completed_guide': visit.guide_completed, **{k: getattr(visit, k) for k in TOTALS}}


@never_cache
@require_GET
def admin_usage_visits(request):
    from .lab_api import _denied
    if not admin_allowed(request): return _denied(request)
    try:
        rows, period, _ = filtered_visits(request)
        identity = request.GET.get('visitor', '')
        if identity:
            if identity.startswith('u:') and identity[2:].isdigit(): rows = rows.filter(user_id=int(identity[2:]))
            elif re.fullmatch(r'g:[a-f0-9]{64}', identity): rows = rows.filter(user__isnull=True, visitor_key=identity[2:])
            else: raise ValueError('invalid_visitor')
        _, offset, pager = pagination(request, rows.count())
        return JsonResponse({'ok': True, 'period': period, **pager, 'items': [visit_json(v) for v in rows.select_related('lab', 'user').order_by('-started_at', 'pk')[offset:offset+25]]})
    except ValueError as exc: return JsonResponse({'ok': False, 'error': str(exc)}, status=400)


@never_cache
@require_GET
def admin_usage_visit(request, visit_id):
    from .lab_api import _denied
    if not admin_allowed(request): return _denied(request)
    visit = LabUsageVisit.objects.select_related('lab', 'user').filter(pk=visit_id).first()
    if not visit: return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    try:
        _, offset, pager = pagination(request, visit.events.count(), 100)
        return JsonResponse({'ok': True, 'visit': visit_json(visit), 'events': {**pager,
            'items': list(visit.events.order_by('-received_at', '-id').values('id', 'kind', 'received_at', 'data', 'provenance')[offset:offset+100])}})
    except ValueError as exc: return JsonResponse({'ok': False, 'error': str(exc)}, status=400)


@never_cache
@require_GET
def admin_usage_saved(request):
    """Metadata from account-owned saved records, including before optional telemetry."""
    from .lab_api import _denied
    from .lab_knowledge_models import LabConversation, LabRunSnapshot
    if not admin_allowed(request): return _denied(request)
    try:
        lab_id = request.GET.get('lab', '')
        filters = {'lab_id': int(lab_id)} if lab_id else {}
        chats = LabConversation.objects.filter(**filters)
        snaps = LabRunSnapshot.objects.filter(**filters)
        owners = chats.order_by().values('owner_id').union(snaps.order_by().values('owner_id'))
        users = get_user_model().objects.filter(pk__in=owners).order_by('username', 'pk')
        query = request.GET.get('q', '').strip()[:120]
        if query: users = users.filter(Q(username__icontains=query) | Q(email__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query))
        _, offset, pager = pagination(request, users.count())
        people = list(users[offset:offset+25]); ids = [u.pk for u in people]
        length = Func('messages', function='jsonb_array_length' if connection.vendor == 'postgresql' else 'json_array_length', output_field=IntegerField())
        conversations = {r['owner_id']: r for r in chats.filter(owner_id__in=ids).values('owner_id').annotate(threads=Count('pk'), messages=Sum(length), last=Max('updated_at'))}
        snapshots = {r['owner_id']: r for r in snaps.filter(owner_id__in=ids).values('owner_id').annotate(total=Count('pk'), last=Max('created_at'))}
        result = []
        for user in people:
            c, s = conversations.get(user.pk, {}), snapshots.get(user.pk, {})
            dates = [v for v in (c.get('last'), s.get('last')) if v]
            result.append({'user': profile(user), 'snapshots': s.get('total', 0), 'conversations': c.get('threads', 0),
                           'saved_messages': c.get('messages', 0), 'last_saved': max(dates) if dates else None})
        return JsonResponse({'ok': True, **pager, 'items': result})
    except ValueError as exc: return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
