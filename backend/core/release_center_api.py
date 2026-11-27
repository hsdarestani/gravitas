"""Staging-facing release proposals and a database-isolated publication rehearsal."""
import json
import re

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .operating_models import OperatingTask
from .platform_access import can_view
from .platform_runtime_v3 import core_access
from .release_evidence import health, staging_metadata, verified_ci
from .release_models import ReleaseChange, ReleaseEvent, ReleaseRevision, VisualRehearsalPage
from . import release_target
from .visual_registry import FIELDS, LINKS, PAGES, fields_for, preview, validate_edits, values_for


State = ReleaseChange.State
Kind = ReleaseChange.Kind
CAPABILITIES = ('author', 'review', 'rehearse')
REGISTERED_SOURCES = ('development', 'github', 'cms', 'essay', 'lab', 'configuration', 'feature_flag')
TRANSITIONS = {
    'submit': ({State.DRAFT}, State.SUBMITTED),
    'validate': ({State.SUBMITTED}, State.VALIDATING),
    'ready': ({State.VALIDATING}, State.READY),
    'review': ({State.READY}, State.REVIEW),
    'corrections': ({State.REVIEW}, State.CORRECTIONS),
    'approve': ({State.REVIEW}, State.APPROVED),
    'reject': ({State.REVIEW}, State.REJECTED),
}


def reply(error='', status=200, **data):
    return JsonResponse(dict(ok=not error, **({'error': error} if error else {}), **data), status=status)


def grants(request):
    if not getattr(settings, 'RELEASE_CENTER_ENABLED', False):
        return {}, reply('release_center_disabled', 404)
    user = request.user
    if not user.is_authenticated:
        return {}, reply('authentication_required', 401)
    if not core_access(user):
        return {}, reply('release_center_forbidden', 403)
    allowed = {name: user.has_perm(f'core.{name}_release_change') for name in CAPABILITIES}
    return (allowed, None) if any(allowed.values()) else (allowed, reply('release_center_forbidden', 403))


def data_from(request):
    if len(request.body) > 20_000:
        raise ValueError('request_too_large')
    data = json.loads(request.body or '{}')
    if not isinstance(data, dict):
        raise ValueError('invalid_request')
    return data


def text_value(data, key, limit, required=False):
    value = data.get(key, '')
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError('invalid_' + key)
    return value.strip()


def visible(user, change, allowed):
    return (change.author_id == user.pk or allowed['review'] or allowed['rehearse']) and (
        not change.task_id or can_view(user, change.task)
    )


def audited(change, actor, action, evidence=None):
    ReleaseEvent.objects.create(change=change, actor=actor, action=action,
                                revision=change.revision, evidence=evidence or {})


def serialize(change, *, history=False):
    rev = change.revisions.get(number=change.revision)
    data = {
        'id': change.pk, 'author': change.author.get_username(), 'author_id': change.author_id,
        'reviewer': change.reviewer.get_username() if change.reviewer_id else None,
        'task': change.task_id, 'kind': change.kind, 'page': change.page,
        'state': change.state, 'revision': change.revision, 'sequence': change.sequence,
        'approved_revision': change.approved_revision, 'created_at': change.created_at.isoformat(),
        'updated_at': change.updated_at.isoformat(), **rev.payload,
    }
    if history:
        data['history'] = list(change.events.order_by('id').values('action', 'revision', 'actor__username', 'evidence', 'created_at'))
        data['versions'] = list(change.revisions.order_by('-number').values(
            'number', 'author__username', 'payload', 'created_at'))
    return data


def proposed_payload(data, kind, page, base=None):
    result = {
        'title': text_value(data, 'title', 220, required=True),
        'description': text_value(data, 'description', 4000),
        'acceptance': text_value(data, 'acceptance', 2000),
        'affected': text_value(data, 'affected', 1000),
        'risk': data.get('risk', 'low'),
    }
    if result['risk'] not in ('low', 'medium', 'high'):
        raise ValueError('invalid_risk')
    if kind == Kind.VISUAL:
        edits = validate_edits(page, data.get('edits'))
        current = values_for(page)
        page_row = VisualRehearsalPage.objects.filter(page=page).first()
        current.update(page_row.values if page_row else {})
        current.update(base or {})
        result.update(before={field: current[field] for field in edits}, after=edits)
    else:
        origin = data.get('source', 'development')
        if origin not in REGISTERED_SOURCES:
            raise ValueError('invalid_change_source')
        reference = text_value(data, 'source_reference', 500)
        pr = data.get('pr')
        sha = text_value(data, 'sha', 40)
        previous = text_value(data, 'previous_sha', 40)
        if pr is not None and (type(pr) is not int or not 0 < pr <= 2147483647):
            raise ValueError('invalid_pr')
        if any(value and re.fullmatch(r'[a-f0-9]{40}', value) is None for value in (sha, previous)):
            raise ValueError('invalid_sha')
        result.update(pr=pr, sha=sha, previous_sha=previous, source=origin, source_reference=reference)
    return result


@never_cache
@require_http_methods(['GET', 'POST'])
def release_changes(request):
    allowed, denied = grants(request)
    if denied:
        return denied
    if request.method == 'GET':
        changes = ReleaseChange.objects.select_related('author', 'task', 'reviewer').order_by('-updated_at', '-id')
        if not (allowed['review'] or allowed['rehearse']):
            changes = changes.filter(author=request.user)
        return reply(changes=[serialize(change) for change in changes[:100] if visible(request.user, change, allowed)],
                     capabilities={**allowed, 'isolated_application': release_target.enabled()},
                     user_id=request.user.pk, production_enabled=False)
    if not allowed['author']:
        return reply('release_author_required', 403)
    try:
        data = data_from(request)
        kind, page = data.get('kind'), data.get('page', '')
        if kind not in Kind.values or (kind == Kind.VISUAL and page not in PAGES):
            raise ValueError('unsupported_release_kind')
        task_id = data.get('task')
        if task_id is not None and (type(task_id) is not int or not 0 < task_id <= 2147483647):
            raise ValueError('invalid_task')
        task = OperatingTask.objects.filter(pk=task_id).first() if task_id else None
        if (task_id and not task) or (task and not can_view(request.user, task)):
            return reply('release_task_unavailable', 404)
        payload = proposed_payload(data, kind, page)
    except (ValueError, TypeError) as exc:
        return reply(str(exc) if re.fullmatch('[a-z_]+', str(exc)) else 'invalid_request', 400)
    with transaction.atomic():
        change = ReleaseChange.objects.create(author=request.user, task=task, kind=kind,
                                              page=page if kind == Kind.VISUAL else '')
        ReleaseRevision.objects.create(change=change, author=request.user, number=1, payload=payload)
        audited(change, request.user, 'created')
    return reply(status=201, change=serialize(change, history=True))


def rehearse(change, actor):
    if change.kind != Kind.VISUAL or change.state != State.APPROVED or change.approved_revision != change.revision:
        return reply('approved_visual_revision_required', 409)
    revision = change.revisions.get(number=change.revision)
    before, after = revision.payload['before'], revision.payload['after']
    page, _ = VisualRehearsalPage.objects.get_or_create(page=change.page)
    page = VisualRehearsalPage.objects.select_for_update().get(pk=page.pk)
    live = {**values_for(change.page), **page.values}
    if any(live.get(field) != value for field, value in before.items()):
        return reply('visual_base_conflict', 409)
    page.values = {**page.values, **after}
    page.save(update_fields=['values', 'updated_at'])
    page.refresh_from_db(fields=['values'])
    if any(page.values[field] != value for field, value in after.items()):
        raise ValueError('rehearsal_readback_failed')
    change.state = State.RELEASED
    audited(change, actor, 'rehearsal_published', {'before': before, 'after': after, 'target': 'isolated-preview'})
    if original_id := revision.payload.get('restore_of'):
        original = ReleaseChange.objects.select_for_update().get(pk=original_id)
        original.state = State.ROLLED_BACK
        original.sequence += 1
        original.save(update_fields=['state', 'sequence', 'updated_at'])
        audited(original, actor, 'rehearsal_restored', {'restoration_change': change.pk})
    return None


def rehearse_application(change, actor, action):
    if not release_target.enabled():
        return reply('isolated_release_target_disabled', 409)
    approved = change.approved_revision == change.revision and change.reviewer_id not in (None, change.author_id)
    operation = 'deploy' if action == 'rehearse_application' else 'rollback'
    required = State.APPROVED if operation == 'deploy' else State.RELEASED
    if change.kind != Kind.DEVELOPMENT or not approved or change.state != required:
        return reply('approved_application_revision_required', 409)
    version = change.revisions.get(number=change.revision).payload
    proposed, prior = version['sha'], version['previous_sha']
    if (not proposed or not prior or proposed == prior
            or not change.events.filter(action='ready', revision=change.revision, evidence__sha=proposed).exists()):
        return reply('isolated_release_requires_exact_ci_and_base', 409)
    expected, revision = (prior, proposed) if operation == 'deploy' else (proposed, prior)
    try:
        receipt = release_target.execute(operation, f'{change.pk}.{change.revision}.{operation}', expected, revision)
    except release_target.TargetError as exc:
        return reply(str(exc), 409 if str(exc) == 'isolated_release_conflict' else 502)
    change.state = State.RELEASED if operation == 'deploy' else State.ROLLED_BACK
    audited(change, actor, action, receipt)
    return None


@never_cache
@require_http_methods(['GET', 'PATCH', 'POST'])
def release_change(request, change_id):
    allowed, denied = grants(request)
    if denied:
        return denied
    with transaction.atomic():
        change = ReleaseChange.objects.select_for_update().filter(pk=change_id).first()
        if change is None or not visible(request.user, change, allowed):
            return reply('release_change_not_found', 404)
        if request.method == 'GET':
            return reply(change=serialize(change, history=True))
        try:
            data = data_from(request)
            action = data.get('action')
            sequence = data.get('sequence')
            if type(sequence) is not int or sequence != change.sequence:
                return reply('stale_change_sequence', 409)
            own = request.user.pk == change.author_id
            if request.method == 'PATCH':
                if not (allowed['author'] and own):
                    return reply('release_author_required', 403)
                if change.state in (State.RELEASED, State.RELEASING, State.SCHEDULED, State.ROLLED_BACK):
                    return reply('release_revision_immutable', 409)
                existing = change.revisions.get(number=change.revision).payload
                payload = proposed_payload(data, change.kind, change.page, existing.get('before'))
                if existing.get('restore_of'):
                    return reply('restoration_revision_immutable', 409)
                change.revision += 1
                change.approved_revision = None
                change.reviewer = None
                change.state = State.DRAFT
                ReleaseRevision.objects.create(change=change, number=change.revision, author=request.user, payload=payload)
                audited(change, request.user, 'revised')
            elif action == 'rehearse':
                if not allowed['rehearse']:
                    return reply('release_manager_required', 403)
                if result := rehearse(change, request.user):
                    return result
            elif action in ('rehearse_application', 'rollback_application'):
                if not allowed['rehearse'] or own:
                    return reply('independent_release_manager_required', 403)
                if result := rehearse_application(change, request.user, action):
                    return result
            elif action == 'restore':
                if not allowed['author']:
                    return reply('release_author_required', 403)
                if change.state != State.RELEASED or change.kind != Kind.VISUAL:
                    return reply('released_visual_revision_required', 409)
                version = change.revisions.get(number=change.revision).payload
                restoration = ReleaseChange.objects.create(author=request.user, task=change.task,
                                                           kind=Kind.VISUAL, page=change.page)
                ReleaseRevision.objects.create(change=restoration, number=1, author=request.user, payload={
                    **version, 'title': 'Restore ' + version['title'][:200],
                    'before': version['after'], 'after': version['before'], 'restore_of': change.pk,
                })
                audited(restoration, request.user, 'restoration_created', {'restores_change': change.pk})
                change.sequence += 1
                change.save(update_fields=['sequence', 'updated_at'])
                audited(change, request.user, 'restoration_requested', {'restoration_change': restoration.pk})
                return reply(status=201, change=serialize(restoration, history=True))
            else:
                if not isinstance(action, str) or action not in TRANSITIONS:
                    return reply('invalid_release_action', 400)
                if action == 'submit':
                    if not (own and allowed['author']):
                        return reply('release_author_required', 403)
                elif own or not allowed['review'] or (change.reviewer_id and change.reviewer_id != request.user.pk):
                    return reply('independent_reviewer_required', 403)
                current, target = TRANSITIONS[action]
                if change.state not in current:
                    return reply('invalid_release_transition', 409)
                note = text_value(data, 'note', 2000, required=action in ('ready', 'approve', 'corrections', 'reject'))
                if action == 'review':
                    change.reviewer = request.user
                if action == 'approve':
                    change.approved_revision = change.revision
                evidence = {'note': note}
                if action == 'ready' and change.kind == Kind.DEVELOPMENT:
                    revision = change.revisions.get(number=change.revision).payload
                    if revision['sha'] or revision.get('source') in ('development', 'github'):
                        evidence.update(verified_ci(data.get('ci_run'), revision['sha']))
                change.state = target
                audited(change, request.user, action, evidence)
            change.sequence += 1
            change.save()
        except (ValueError, TypeError) as exc:
            transaction.set_rollback(True)
            return reply(str(exc) if re.fullmatch('[a-z_]+', str(exc)) else 'invalid_request', 400)
    return reply(change=serialize(change, history=True))


@never_cache
@require_http_methods(['GET'])
def visual_catalog(request):
    allowed, denied = grants(request)
    if denied:
        return denied
    return reply(pages=[{'id': key, 'label': page[0], 'fields': [
        {'id': field, 'label': FIELDS[field][0], 'type': FIELDS[field][1], 'limit': FIELDS[field][2]}
        for field in fields_for(key)
    ]} for key, page in PAGES.items()], links=LINKS, capabilities=allowed)


@never_cache
@require_http_methods(['GET'])
def visual_preview(request, page):
    allowed, denied = grants(request)
    if denied:
        return denied
    if page not in PAGES:
        return reply('unknown_page', 404)
    overrides = {}
    if request.GET.get('target') == 'rehearsal':
        target = VisualRehearsalPage.objects.filter(page=page).first()
        overrides = target.values if target else {}
    if identifier := request.GET.get('change'):
        if not identifier.isdecimal() or len(identifier) > 10:
            return reply('release_change_not_found', 404)
        change = ReleaseChange.objects.filter(pk=int(identifier), page=page, kind=Kind.VISUAL).first()
        if not change or not visible(request.user, change, allowed):
            return reply('release_change_not_found', 404)
        overrides = change.revisions.get(number=change.revision).payload['after']
    result = HttpResponse(preview(page, overrides))
    result['Content-Security-Policy'] = (
        "sandbox allow-same-origin; default-src 'none'; style-src 'self' 'unsafe-inline'; "
        "font-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
    )
    result['X-Frame-Options'] = 'SAMEORIGIN'
    result['X-Robots-Tag'] = 'noindex, nofollow'
    return result


@never_cache
@require_http_methods(['GET'])
def release_status(request):
    _, denied = grants(request)
    if denied:
        return denied
    return reply(staging=staging_metadata(), staging_health=health('staging'),
                 production_health=health('production'), production=None)
