import hashlib
import logging
import math
from typing import Dict, Iterable, List

import requests
from django.conf import settings

from .errors import PulsarError


logger = logging.getLogger(__name__)


def _setting(name, default=''):
    return str(getattr(settings, name, default) or '').strip()


def semantic_enabled():
    return bool(
        getattr(settings, 'PULSAR_SEMANTIC_ENABLED', False)
        and EmbeddingGateway().configured()
    )


def resource_text(resource):
    title = str(resource.title or '').strip()
    description = str(resource.description or '').strip()
    body = str(resource.body or '').strip()
    value = '\n\n'.join(part for part in (title, description, body) if part)
    max_chars = int(getattr(settings, 'PULSAR_EMBEDDING_MAX_CHARS', 16000) or 16000)
    return value[:max(1000, max_chars)]


def content_hash(resource):
    return hashlib.sha256(resource_text(resource).encode('utf-8')).hexdigest()


def cosine_similarity(left, right):
    if not isinstance(left, list) or not isinstance(right, list):
        return 0.0
    if not left or len(left) != len(right):
        return 0.0
    try:
        dot = sum(float(a) * float(b) for a, b in zip(left, right))
        left_norm = math.sqrt(sum(float(a) * float(a) for a in left))
        right_norm = math.sqrt(sum(float(b) * float(b) for b in right))
    except (TypeError, ValueError):
        return 0.0
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


class EmbeddingGateway:
    """OpenAI-compatible embeddings boundary.

    Storage and retrieval do not depend on a particular model vendor. Any
    provider that exposes an OpenAI-compatible /embeddings endpoint can be used.
    """

    provider = 'openai-compatible'

    def __init__(self, *, base_url=None, api_key=None, model=None, timeout=None):
        self.base_url = str(
            base_url
            if base_url is not None
            else _setting(
                'PULSAR_EMBEDDING_BASE_URL',
                _setting('PULSAR_OPENAI_BASE_URL', 'https://api.openai.com/v1'),
            )
        ).rstrip('/')
        self.api_key = str(
            api_key
            if api_key is not None
            else _setting(
                'PULSAR_EMBEDDING_API_KEY',
                _setting('PULSAR_OPENAI_API_KEY'),
            )
        ).strip()
        self.model = str(
            model
            if model is not None
            else _setting('PULSAR_EMBEDDING_MODEL')
        ).strip()
        self.timeout = int(
            timeout
            if timeout is not None
            else getattr(settings, 'PULSAR_EMBEDDING_TIMEOUT', 30)
        )

    def configured(self):
        return bool(self.base_url and self.api_key and self.model)

    def embed(self, text):
        if not self.configured():
            raise PulsarError('pulsar_embedding_not_configured')
        try:
            response = requests.post(
                self.base_url + '/embeddings',
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': self.model,
                    'input': str(text or ''),
                },
                timeout=(8, max(15, self.timeout)),
            )
            response.raise_for_status()
            payload = response.json()
            vector = payload['data'][0]['embedding']
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning('Pulsar embedding request failed: %s', exc)
            raise PulsarError('pulsar_embedding_failed') from exc
        if not isinstance(vector, list) or not vector:
            raise PulsarError('pulsar_embedding_invalid_vector')
        try:
            return [float(value) for value in vector]
        except (TypeError, ValueError) as exc:
            raise PulsarError('pulsar_embedding_invalid_vector') from exc


def index_resource(resource, *, gateway=None, force=False):
    from core.models import PulsarResourceEmbedding

    gateway = gateway or EmbeddingGateway()
    if not gateway.configured():
        raise PulsarError('pulsar_embedding_not_configured')

    digest = content_hash(resource)
    existing = PulsarResourceEmbedding.objects.filter(resource=resource).first()
    if (
        existing
        and not force
        and existing.content_hash == digest
        and existing.model_name == gateway.model
        and isinstance(existing.vector, list)
        and existing.vector
    ):
        return existing, False

    text = resource_text(resource)
    if not text.strip():
        return None, False
    vector = gateway.embed(text)
    row, _ = PulsarResourceEmbedding.objects.update_or_create(
        resource=resource,
        defaults={
            'provider': gateway.provider,
            'model_name': gateway.model,
            'dimensions': len(vector),
            'vector': vector,
            'content_hash': digest,
        },
    )
    return row, True


def semantic_candidates(queryset, *, limit=300, gateway=None):
    if not getattr(settings, 'PULSAR_SEMANTIC_ENABLED', False):
        return []
    gateway = gateway or EmbeddingGateway()
    if not gateway.configured():
        return []
    from core.models import PulsarResourceEmbedding

    ids = list(
        PulsarResourceEmbedding.objects
        .filter(model_name=gateway.model)
        .order_by('-indexed_at')
        .values_list('resource_id', flat=True)[:max(1, int(limit or 300))]
    )
    if not ids:
        return []
    by_id = {
        resource.pk: resource
        for resource in queryset.filter(pk__in=ids)
    }
    return [by_id[pk] for pk in ids if pk in by_id]


def semantic_scores(resources: Iterable, query, *, gateway=None) -> Dict[int, float]:
    resources = list(resources)
    query = str(query or '').strip()
    if not resources or not query or not getattr(settings, 'PULSAR_SEMANTIC_ENABLED', False):
        return {}

    gateway = gateway or EmbeddingGateway()
    if not gateway.configured():
        return {}

    from core.models import PulsarResourceEmbedding

    embeddings = {
        row.resource_id: row
        for row in PulsarResourceEmbedding.objects.filter(
            resource_id__in=[resource.pk for resource in resources],
            model_name=gateway.model,
        )
    }
    if not embeddings:
        return {}

    try:
        query_vector = gateway.embed(query)
    except PulsarError:
        logger.exception('Pulsar semantic query embedding failed; lexical retrieval will continue')
        return {}

    scores = {}
    for resource in resources:
        row = embeddings.get(resource.pk)
        if not row or row.dimensions != len(query_vector):
            continue
        score = cosine_similarity(query_vector, row.vector)
        if score:
            scores[resource.pk] = float(score)
    return scores
