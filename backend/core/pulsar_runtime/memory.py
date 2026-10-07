import hashlib
import json
import re

from django.db.models import Q
from django.utils import timezone

from .errors import PulsarPermissionError


STOPWORDS = {
    'about', 'after', 'again', 'also', 'because', 'before', 'from', 'have',
    'into', 'that', 'their', 'there', 'these', 'this', 'what', 'when',
    'where', 'which', 'with', 'your',
}


def _terms(value):
    return {
        token.lower()
        for token in re.findall(r"[\w'\-]{3,}", str(value or ''), flags=re.UNICODE)
        if token.lower() not in STOPWORDS
    }


def _normalized_scope(scope):
    if not isinstance(scope, dict):
        return {}
    clean = {}
    for key in ('workspace_id', 'project_id', 'course_id', 'lesson_id', 'skill'):
        value = scope.get(key)
        if value not in (None, ''):
            clean[key] = str(value)
    return clean


def _fingerprint(user_id, kind, content, scope, source_kind='', source_ref=''):
    payload = json.dumps({
        'user_id': user_id,
        'kind': kind,
        'content': ' '.join(str(content or '').split()),
        'scope': _normalized_scope(scope),
        'source_kind': str(source_kind or ''),
        'source_ref': str(source_ref or ''),
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def remember(
    user,
    *,
    kind,
    content,
    scope=None,
    source_kind='user',
    source_ref='',
    source_url='',
    confidence=1.0,
    last_verified_at=None,
):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    from core.models import PulsarMemoryEntry

    kind = str(kind or '').strip().lower()
    if kind not in {
        PulsarMemoryEntry.Kind.EPISODIC,
        PulsarMemoryEntry.Kind.SEMANTIC,
        PulsarMemoryEntry.Kind.PREFERENCE,
    }:
        raise ValueError('invalid_memory_kind')
    content = ' '.join(str(content or '').split()).strip()
    if not content:
        raise ValueError('memory_content_required')
    content = content[:12000]
    scope = _normalized_scope(scope)
    fingerprint = _fingerprint(
        user.pk,
        kind,
        content,
        scope,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    entry, created = PulsarMemoryEntry.objects.update_or_create(
        user=user,
        fingerprint=fingerprint,
        defaults={
            'kind': kind,
            'content': content,
            'scope': scope,
            'source_kind': str(source_kind or 'user')[:40],
            'source_ref': str(source_ref or '')[:240],
            'source_url': str(source_url or '')[:1000],
            'confidence': max(0.0, min(1.0, float(confidence or 0))),
            'is_active': True,
            'last_verified_at': last_verified_at or timezone.now(),
        },
    )
    return entry, created


def _scope_matches(entry_scope, requested_scope):
    entry_scope = entry_scope if isinstance(entry_scope, dict) else {}
    requested_scope = _normalized_scope(requested_scope)
    for key, expected in entry_scope.items():
        if key not in requested_scope:
            continue
        if str(requested_scope[key]) != str(expected):
            return False
    return True


def recall(user, query='', *, scope=None, limit=8):
    if not user or not getattr(user, 'is_authenticated', False):
        return []
    from core.models import PulsarMemoryEntry

    now = timezone.now()
    candidates = (
        PulsarMemoryEntry.objects
        .filter(user=user, is_active=True)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .order_by('-updated_at')[:120]
    )
    terms = _terms(query)
    ranked = []
    for entry in candidates:
        if not _scope_matches(entry.scope, scope):
            continue
        haystack = entry.content.lower()
        matched = sum(1 for term in terms if term in haystack)
        if terms and not matched and entry.kind != PulsarMemoryEntry.Kind.PREFERENCE:
            continue
        kind_bonus = {
            PulsarMemoryEntry.Kind.PREFERENCE: 2.0,
            PulsarMemoryEntry.Kind.SEMANTIC: 1.4,
            PulsarMemoryEntry.Kind.EPISODIC: 1.0,
        }.get(entry.kind, 1.0)
        score = (matched * 3.0) + kind_bonus + float(entry.confidence or 0)
        ranked.append((score, entry))
    ranked.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp()))
    return [entry for _, entry in ranked[:max(1, min(int(limit or 8), 20))]]


def format_memory(entries):
    rows = []
    for entry in entries:
        source = entry.source_kind or 'memory'
        if entry.source_ref:
            source += f':{entry.source_ref}'
        rows.append(
            f'- [{entry.kind}] {entry.content[:1400]} '
            f'(source={source}, confidence={float(entry.confidence or 0):.2f})'
        )
    return '\n'.join(rows)
