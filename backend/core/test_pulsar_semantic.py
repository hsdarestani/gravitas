from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import KnowledgeResource, PulsarResourceEmbedding, Workspace
from .pulsar_runtime.context import PulsarContextEngine
from .pulsar_runtime.semantic import (
    EmbeddingGateway,
    cosine_similarity,
    index_resource,
    semantic_scores,
)


class FakeEmbeddingGateway:
    provider = 'test'
    model = 'embed-test'

    def __init__(self, vector=None):
        self.vector = vector or [1.0, 0.0]
        self.calls = []

    def configured(self):
        return True

    def embed(self, text):
        self.calls.append(text)
        return list(self.vector)


class PulsarSemanticTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-semantic@example.test',
            email='pulsar-semantic@example.test',
            password='Strong-pass-123!',
        )
        self.workspace = Workspace.objects.create(
            name='Semantic workspace',
            kind=Workspace.Kind.PERSONAL,
            owner=self.user,
        )
        self.resource = KnowledgeResource.objects.create(
            workspace=self.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Unexpected terminology',
            body='This note uses vocabulary that does not overlap with the query.',
        )

    def test_cosine_similarity(self):
        self.assertAlmostEqual(
            cosine_similarity([1.0, 0.0], [1.0, 0.0]),
            1.0,
        )
        self.assertAlmostEqual(
            cosine_similarity([1.0, 0.0], [0.0, 1.0]),
            0.0,
        )

    def test_index_resource_skips_unchanged_content(self):
        gateway = FakeEmbeddingGateway()
        row, changed = index_resource(self.resource, gateway=gateway)
        self.assertTrue(changed)
        self.assertEqual(row.dimensions, 2)
        self.assertEqual(len(gateway.calls), 1)

        row_again, changed_again = index_resource(
            self.resource,
            gateway=gateway,
        )
        self.assertFalse(changed_again)
        self.assertEqual(row_again.pk, row.pk)
        self.assertEqual(len(gateway.calls), 1)

    @override_settings(
        PULSAR_EMBEDDING_API_KEY='test-key',
        PULSAR_EMBEDDING_MODEL='embed-test',
        PULSAR_EMBEDDING_BASE_URL='https://example.test/v1',
    )
    @patch('core.pulsar_runtime.semantic.requests.post')
    def test_embedding_gateway_parses_openai_compatible_response(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'data': [{'embedding': [0.25, 0.5, 0.75]}],
        }
        post.return_value = response

        vector = EmbeddingGateway().embed('query')
        self.assertEqual(vector, [0.25, 0.5, 0.75])
        self.assertEqual(
            post.call_args.kwargs['json']['model'],
            'embed-test',
        )

    @override_settings(
        PULSAR_SEMANTIC_ENABLED=True,
        PULSAR_EMBEDDING_API_KEY='test-key',
        PULSAR_EMBEDDING_MODEL='embed-test',
        PULSAR_EMBEDDING_BASE_URL='https://example.test/v1',
    )
    def test_semantic_scores_use_matching_index_model(self):
        PulsarResourceEmbedding.objects.create(
            resource=self.resource,
            provider='test',
            model_name='embed-test',
            dimensions=2,
            vector=[1.0, 0.0],
            content_hash='x' * 64,
        )
        gateway = FakeEmbeddingGateway([1.0, 0.0])
        scores = semantic_scores(
            [self.resource],
            'conceptually similar query',
            gateway=gateway,
        )
        self.assertAlmostEqual(scores[self.resource.pk], 1.0)

    @override_settings(
        PULSAR_SEMANTIC_ENABLED=True,
        PULSAR_EMBEDDING_API_KEY='test-key',
        PULSAR_EMBEDDING_MODEL='embed-test',
        PULSAR_EMBEDDING_BASE_URL='https://example.test/v1',
        PULSAR_SEMANTIC_MIN_SCORE=0.25,
    )
    @patch(
        'core.pulsar_runtime.semantic.EmbeddingGateway.embed',
        return_value=[1.0, 0.0],
    )
    def test_context_engine_can_retrieve_semantic_match_without_keyword_overlap(self, embed):
        PulsarResourceEmbedding.objects.create(
            resource=self.resource,
            provider='test',
            model_name='embed-test',
            dimensions=2,
            vector=[1.0, 0.0],
            content_hash='x' * 64,
        )

        package = PulsarContextEngine().workspace(
            self.user,
            'quantum replication evidence',
            skill='research',
        )
        self.assertTrue(package.metadata['semantic_used'])
        self.assertIn('semantic', package.metadata['retrieval_mode'])
        self.assertIn('Unexpected terminology', package.text)
        self.assertTrue(embed.called)
