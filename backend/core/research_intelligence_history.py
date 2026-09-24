from __future__ import annotations

import hashlib
from typing import Iterable

from django.db import transaction
from django.utils import timezone

from .models import (
    ResearchIntelligenceEvent,
    ResearchIntelligenceItem,
    ResearchIntelligenceRun,
)


SIGNIFICANT_FIELDS = {
    'funding': (
        'title', 'summary', 'status', 'open_date', 'close_date',
        'award_ceiling', 'award_floor', 'template_available',
        'template_names', 'attachment_count', 'eligibility', 'categories',
    ),
    'paper': ('title', 'summary', 'updated_at', 'authors', 'categories'),
    'tool': ('title', 'summary', 'language', 'date', 'topics'),
    'development': ('title', 'summary', 'date'),
}


def _flatten(payload: dict) -> Iterable[dict]:
    for bucket in ('funding', 'papers_tools', 'developments'):
        for item in payload.get(bucket) or []:
            if isinstance(item, dict):
                yield item


def _identity(item: dict) -> tuple[str, str]:
    kind = str(item.get('kind') or 'unknown').strip().lower()
    source = str(item.get('source') or 'unknown').strip()
    external_id = str(item.get('id') or '').strip()
    canonical = str(item.get('url') or external_id or item.get('title') or '').strip()
    raw = f'{kind}|{source}|{canonical}'.encode('utf-8', errors='ignore')
    return hashlib.sha256(raw).hexdigest(), external_id


def _changed_fields(previous: dict, current: dict) -> list[str]:
    kind = str(current.get('kind') or previous.get('kind') or 'unknown').strip().lower()
    fields = SIGNIFICANT_FIELDS.get(kind, ('title', 'summary', 'date', 'updated_at'))
    return [name for name in fields if previous.get(name) != current.get(name)]


def history_payload(limit: int = 60) -> list[dict]:
    limit = max(1, min(int(limit or 60), 200))
    events = (
        ResearchIntelligenceEvent.objects
        .select_related('item')
        .order_by('-observed_at')[:limit]
    )
    out = []
    for event in events:
        item = event.item
        snapshot = event.snapshot or item.payload or {}
        changed = event.changed_fields or []
        if event.event_type == ResearchIntelligenceEvent.EventType.NEW:
            summary = 'New item discovered by the automatic radar.'
        elif changed:
            summary = f"Updated: {', '.join(str(value).replace('_', ' ') for value in changed[:6])}."
        else:
            summary = 'Source information changed.'
        out.append({
            'id': f'event:{event.pk}',
            'kind': item.kind,
            'source': item.source,
            'title': item.title,
            'summary': summary,
            'event_type': event.event_type,
            'changed_fields': changed,
            'date': event.observed_at.isoformat(),
            'url': item.url,
            'relevance': snapshot.get('relevance') or 0,
        })
    return out



def archived_funding_payload(limit: int = 120) -> list[dict]:
    """Return persisted funding calls whose ISO deadline has passed."""
    limit = max(1, min(int(limit or 120), 300))
    today = timezone.localdate().isoformat()
    rows = (
        ResearchIntelligenceItem.objects
        .filter(kind='funding')
        .order_by('-last_seen_at')[: max(limit * 4, 200)]
    )
    out = []
    seen = set()
    for row in rows:
        snapshot = dict(row.payload or {})
        close_date = str(snapshot.get('close_date') or '').strip()
        if not close_date or len(close_date) != 10 or close_date >= today:
            continue
        identity = f"{row.source}|{row.external_id or row.url or row.key}"
        if identity in seen:
            continue
        seen.add(identity)
        snapshot['archived'] = True
        snapshot['source'] = snapshot.get('source') or row.source
        snapshot['id'] = snapshot.get('id') or row.external_id
        snapshot['title'] = snapshot.get('title') or row.title
        snapshot['summary'] = snapshot.get('summary') or row.summary
        snapshot['url'] = snapshot.get('url') or row.url
        out.append(snapshot)
        if len(out) >= limit:
            break
    out.sort(key=lambda item: item.get('close_date') or '', reverse=True)
    return out

def run_status_payload() -> dict:
    run = ResearchIntelligenceRun.objects.order_by('-started_at').first()
    if not run:
        return {}
    return {
        'status': run.status,
        'started_at': run.started_at.isoformat() if run.started_at else None,
        'completed_at': run.completed_at.isoformat() if run.completed_at else None,
        'counts': run.counts or {},
        'error_count': len(run.errors or []),
    }


@transaction.atomic
def persist_payload(payload: dict, run: ResearchIntelligenceRun | None = None) -> tuple[ResearchIntelligenceRun, dict]:
    if run is None:
        run = ResearchIntelligenceRun.objects.create(status=ResearchIntelligenceRun.Status.RUNNING)

    counts = {
        'funding': len(payload.get('funding') or []),
        'papers_tools': len(payload.get('papers_tools') or []),
        'developments': len(payload.get('developments') or []),
        'new': 0,
        'updated': 0,
    }

    now = timezone.now()
    for item in _flatten(payload):
        key, external_id = _identity(item)
        defaults = {
            'kind': str(item.get('kind') or 'unknown')[:32],
            'source': str(item.get('source') or 'Unknown')[:120],
            'external_id': external_id[:320],
            'title': str(item.get('title') or 'Untitled')[:500],
            'summary': str(item.get('summary') or ''),
            'url': str(item.get('url') or '')[:1200],
            'payload': item,
            'active': True,
        }

        existing = ResearchIntelligenceItem.objects.filter(key=key).first()
        if existing is None:
            stored = ResearchIntelligenceItem.objects.create(key=key, **defaults)
            ResearchIntelligenceEvent.objects.create(
                item=stored,
                run=run,
                event_type=ResearchIntelligenceEvent.EventType.NEW,
                changed_fields=[],
                snapshot=item,
            )
            counts['new'] += 1
            continue

        changed = _changed_fields(existing.payload or {}, item)
        existing.kind = defaults['kind']
        existing.source = defaults['source']
        existing.external_id = defaults['external_id']
        existing.title = defaults['title']
        existing.summary = defaults['summary']
        existing.url = defaults['url']
        existing.payload = item
        existing.active = True
        existing.last_seen_at = now
        existing.save(update_fields=[
            'kind', 'source', 'external_id', 'title', 'summary',
            'url', 'payload', 'active', 'last_seen_at',
        ])

        if changed:
            ResearchIntelligenceEvent.objects.create(
                item=existing,
                run=run,
                event_type=ResearchIntelligenceEvent.EventType.UPDATED,
                changed_fields=changed,
                snapshot=item,
            )
            counts['updated'] += 1

    errors = payload.get('errors') or []
    run.counts = counts
    run.errors = errors
    run.status = (
        ResearchIntelligenceRun.Status.PARTIAL
        if errors else ResearchIntelligenceRun.Status.SUCCESS
    )
    run.completed_at = now
    run.save(update_fields=['counts', 'errors', 'status', 'completed_at'])
    return run, counts


def mark_run_failed(run: ResearchIntelligenceRun, exc: Exception) -> None:
    run.status = ResearchIntelligenceRun.Status.FAILED
    run.errors = [{'source': 'collector', 'error': str(exc)[:500]}]
    run.completed_at = timezone.now()
    run.save(update_fields=['status', 'errors', 'completed_at'])
