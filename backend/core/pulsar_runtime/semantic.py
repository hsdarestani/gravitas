import hashlib
import re

from django.db import connection

from . import embeddings
from .errors import PulsarError


def _chunks(text, *, max_chars=2600, max_chunks=10):
    text = re.sub(r'\r\n?', '\n', str(text or '')).strip()
    if not text:
        return []
    paragraphs = [re.sub(r'\s+', ' ', row).strip() for row in text.split('\n') if row.strip()]
    chunks = []
    current = []
    size = 0
    for paragraph in paragraphs:
        if current and size + len(paragraph) + 1 > max_chars:
            chunks.append(' '.join(current))
            current, size = [], 0
            if len(chunks) >= max_chunks:
                break
        current.append(paragraph)
        size += len(paragraph) + 1
    if current and len(chunks) < max_chunks:
        chunks.append(' '.join(current))
    if not chunks:
        chunks = [text[:max_chars]]
    return chunks[:max_chunks]


def resource_text(resource):
    return '\n'.join(
        value for value in [
            str(resource.title or '').strip(),
            str(resource.description or '').strip(),
            str(resource.body or '').strip(),
        ] if value
    )


def index_resource(resource):
    from core.models import PulsarSemanticChunk

    pieces = _chunks(resource_text(resource))
    if not pieces:
        PulsarSemanticChunk.objects.filter(source_type='resource', source_id=str(resource.pk)).delete()
        return 0
    hashes = [hashlib.sha256(value.encode('utf-8')).hexdigest() for value in pieces]
    existing = {
        row.chunk_index: row
        for row in PulsarSemanticChunk.objects.filter(
            source_type='resource',
            source_id=str(resource.pk),
        )
    }
    missing_indexes = [
        index for index, digest in enumerate(hashes)
        if index not in existing or existing[index].content_hash != digest or existing[index].embedding is None
    ]
    vectors = {}
    if missing_indexes:
        values = [pieces[index] for index in missing_indexes]
        embedded = embeddings.embed_texts(values)
        vectors = dict(zip(missing_indexes, embedded))

    for index, piece in enumerate(pieces):
        digest = hashes[index]
        defaults = {
            'workspace_id_ref': resource.workspace_id,
            'project_id_ref': resource.project_id,
            'content': piece,
            'content_hash': digest,
            'metadata': {
                'title': resource.title,
                'kind': resource.kind,
            },
        }
        current = existing.get(index)
        if index in vectors:
            defaults['embedding'] = vectors[index]
        elif current is not None:
            defaults['embedding'] = current.embedding
        PulsarSemanticChunk.objects.update_or_create(
            source_type='resource',
            source_id=str(resource.pk),
            chunk_index=index,
            defaults=defaults,
        )
    PulsarSemanticChunk.objects.filter(
        source_type='resource',
        source_id=str(resource.pk),
        chunk_index__gte=len(pieces),
    ).delete()
    return len(pieces)


def semantic_resource_ranks(query, *, project_id=None, limit=40):
    from core.models import PulsarSemanticChunk
    if connection.vendor != 'postgresql' or not embeddings.configured():
        return []
    try:
        from pgvector.django import CosineDistance
        query_vector = embeddings.embed_texts([query])[0]
        qs = PulsarSemanticChunk.objects.filter(
            source_type='resource',
            embedding__isnull=False,
        )
        if project_id not in (None, ''):
            qs = qs.filter(project_id_ref=int(project_id))
        rows = (
            qs.annotate(distance=CosineDistance('embedding', query_vector))
            .order_by('distance')[:max(1, min(100, int(limit or 40)))]
        )
        result = []
        seen = set()
        for row in rows:
            if row.source_id in seen:
                continue
            seen.add(row.source_id)
            result.append((row.source_id, float(row.distance)))
        return result
    except (PulsarError, ValueError, TypeError) as exc:
        return []


def hybrid_resources(user, query, queryset, *, project_id=None, limit=8):
    from core.models import KnowledgeResource
    from core.platform_access import can_view

    terms = {
        value.lower()
        for value in re.findall(r"[\w'-]{3,}", str(query or ''), flags=re.UNICODE)
    }
    candidates = list(queryset[:250])
    lexical = []
    by_id = {}
    for resource in candidates:
        if not can_view(user, resource):
            continue
        by_id[str(resource.pk)] = resource
        haystack = resource_text(resource).lower()
        title = str(resource.title or '').lower()
        score = sum(3 if term in title else 1 for term in terms if term in haystack)
        if not terms:
            score = 1
        if score:
            lexical.append((resource, score))
    lexical.sort(key=lambda row: (-row[1], -row[0].updated_at.timestamp()))

    # Reciprocal-rank fusion lets vector matches add recall without making
    # embeddings an authority. Live ACL is checked again before returning.
    fused = {}
    for rank, (resource, _) in enumerate(lexical, 1):
        fused[str(resource.pk)] = fused.get(str(resource.pk), 0.0) + 1.0 / (60 + rank)

    semantic = semantic_resource_ranks(query, project_id=project_id, limit=50)
    missing_ids = [source_id for source_id, _ in semantic if source_id not in by_id]
    if missing_ids:
        for resource in KnowledgeResource.objects.filter(pk__in=missing_ids).select_related('workspace', 'project'):
            if can_view(user, resource):
                by_id[str(resource.pk)] = resource
    for rank, (source_id, _) in enumerate(semantic, 1):
        resource = by_id.get(source_id)
        if resource is None or not can_view(user, resource):
            continue
        fused[source_id] = fused.get(source_id, 0.0) + 1.0 / (60 + rank)

    ordered = sorted(
        (
            (score, by_id[source_id])
            for source_id, score in fused.items()
            if source_id in by_id
        ),
        key=lambda row: (-row[0], -row[1].updated_at.timestamp()),
    )
    return [resource for _, resource in ordered[:max(1, min(30, int(limit or 8)))]]
