from io import StringIO
from unittest.mock import patch
from pathlib import Path
import tempfile
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from .models import ResearchProject, KnowledgeResource
from .platform_models import MindMap


class PulsarProjectProvisioningTests(TestCase):
    def test_split_deployment_reads_docs_from_source_root_and_installed_backend(self):
        actor = get_user_model().objects.create_superuser('split-owner', 'split@example.test', 'test-only')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / 'docs').mkdir()
            (root / 'docs/five-layer-platform-architecture.md').write_text('Actual split deployment architecture')
            with patch('core.management.commands.setup_pulsar_research_project.ensure_project_folder_structure'):
                call_command('setup_pulsar_research_project', actor=actor.email, apply=True, source_root=root, stdout=StringIO())
        project = ResearchProject.objects.get(title='Pulsar')
        self.assertEqual(KnowledgeResource.objects.filter(project=project).count(), 5)
        self.assertIn('Actual split deployment architecture', KnowledgeResource.objects.get(project=project, description='docs/five-layer-platform-architecture.md').body)

    def test_repeat_provisioning_preserves_existing_note_edits_and_source_links(self):
        actor = get_user_model().objects.create_superuser('source-owner', 'source-owner@example.test', 'test-only')
        with patch('core.management.commands.setup_pulsar_research_project.ensure_project_folder_structure'):
            call_command('setup_pulsar_research_project', actor=actor.email, apply=True, stdout=StringIO())
            project = ResearchProject.objects.get(title='Pulsar')
            notes = KnowledgeResource.objects.filter(project=project)
            ids = set(notes.values_list('pk', flat=True))
            note = notes.first(); note.body = 'Human annotation retained'; note.save()
            source_map = MindMap.objects.get(project=project)
            node_ids = set(source_map.nodes.values_list('pk', flat=True))
            call_command('setup_pulsar_research_project', actor=actor.email, project=project.pk, apply=True, stdout=StringIO())
        note.refresh_from_db()
        self.assertEqual(note.body, 'Human annotation retained')
        self.assertEqual(ids, set(notes.values_list('pk', flat=True)))
        self.assertEqual(node_ids, set(source_map.nodes.values_list('pk', flat=True)))
        self.assertEqual(ids, set(source_map.nodes.exclude(linked_object_id=None).values_list('linked_object_id', flat=True)))
        self.assertFalse(project.canonical_storage.enabled if hasattr(project, 'canonical_storage') else False)
