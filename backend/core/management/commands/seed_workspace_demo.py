from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core import cloud
from core.models import (
    Collection, KnowledgeLink, KnowledgeResource, ProjectMembership,
    ResearchProject, Tag,
)
from core.workspace_api import _collection_path, _plan, provision_personal_workspace


SEED_KEY = 'gravitas-research-demo-v1'
PROJECT_TITLE = 'AI for Scientific Discovery'
FOLDER_NAMES = ('Papers', 'Datasets', 'Experiments')
TAG_NAMES = ('AI', 'LLM', 'Dataset', 'Experiment')


class Command(BaseCommand):
    help = 'Create or remove an idempotent private Research Workspace demo for an existing user.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='Existing user email or username')
        parser.add_argument('--remove', action='store_true', help='Remove only content created by this seed')

    def handle(self, *args, **options):
        identifier = options['user'].strip()
        user_model = get_user_model()
        user = user_model.objects.filter(email__iexact=identifier).first() or user_model.objects.filter(username__iexact=identifier).first()
        if not user:
            raise CommandError('User does not exist. Create the account normally before seeding.')
        workspace = provision_personal_workspace(user)
        if options['remove']:
            self._remove(user, workspace)
            return
        self._seed(user, workspace)

    @transaction.atomic
    def _seed(self, user, workspace):
        project, _ = ResearchProject.objects.get_or_create(
            workspace=workspace, owner=user, title=PROJECT_TITLE,
            defaults={'description': 'A private demonstration workspace connecting research questions, evidence, experiments and data.'},
        )
        ProjectMembership.objects.get_or_create(project=project, user=user, defaults={'role': 'owner'})
        identity = cloud.ensure_identity(user, _plan(user).quota_bytes)
        folders = {}
        for name in FOLDER_NAMES:
            folder, _ = Collection.objects.get_or_create(
                workspace=workspace, project=project, parent=None, name=name,
                defaults={'created_by': user},
            )
            cloud.make_folder(identity, _collection_path(folder))
            folders[name] = folder
        colors = {'AI': '#8d80ff', 'LLM': '#6e9fe8', 'Dataset': '#67b98c', 'Experiment': '#d6a35d'}
        tags = {}
        for name in TAG_NAMES:
            tag, _ = Tag.objects.get_or_create(
                workspace=workspace, slug=name.lower(),
                defaults={'name': name, 'color': colors[name]},
            )
            tags[name] = tag

        resources = {}
        definitions = [
            ('questions', 'note', 'Research questions', 'Which parts of a scientific workflow can benefit from AI while preserving traceability and expert judgment?', '', '', folders['Experiments'], ('AI', 'Experiment')),
            ('assumptions', 'note', 'Experiment assumptions', 'Record evaluation assumptions, baselines, data provenance and failure criteria before each run.', '', '', folders['Experiments'], ('AI', 'Experiment')),
            ('alphafold', 'paper', 'Highly accurate protein structure prediction with AlphaFold', '', 'A landmark example of machine learning supporting scientific discovery.', 'https://doi.org/10.1038/s41586-021-03819-2', folders['Papers'], ('AI',)),
            ('ai_scientist', 'paper', 'The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery', '', 'A reference for evaluating agentic research workflows and their limitations.', 'https://arxiv.org/abs/2408.06292', folders['Papers'], ('AI', 'LLM')),
            ('runs', 'dataset', 'Experiment runs 2026', '', 'Illustrative metadata for a private demo dataset; no scientific claim is implied.', '', folders['Datasets'], ('Dataset', 'Experiment')),
        ]
        for key, kind, title, body, description, source_url, folder, tag_names in definitions:
            defaults = {
                'owner': user, 'kind': kind, 'description': description, 'body': body,
                'source_url': source_url, 'collection': folder, 'ingestion_status': 'ready' if kind != 'note' else 'not_queued',
                'metadata': {'demo_seed': SEED_KEY},
            }
            if kind == 'dataset':
                defaults.update(original_name='run-2026.csv', mime_type='text/csv', file_size=0,
                                metadata={'demo_seed': SEED_KEY, 'extension': '.csv', 'sample_fields': ['run_id', 'model', 'score', 'timestamp']})
            resource, _ = KnowledgeResource.objects.get_or_create(
                workspace=workspace, project=project, title=title,
                defaults=defaults,
            )
            if resource.metadata.get('demo_seed') == SEED_KEY:
                resource.tags.set(tags[name] for name in tag_names)
            resources[key] = resource

        pairs = (
            ('questions', 'alphafold', 'references'), ('questions', 'ai_scientist', 'references'),
            ('assumptions', 'runs', 'supports'), ('alphafold', 'runs', 'related'),
        )
        for left, right, relation in pairs:
            source, target = sorted((resources[left], resources[right]), key=lambda item: item.pk)
            KnowledgeLink.objects.get_or_create(source=source, target=target, relation=relation)
        self.stdout.write(self.style.SUCCESS(f'Demo workspace ready for {user.email or user.username}.'))

    @transaction.atomic
    def _remove(self, user, workspace):
        project = ResearchProject.objects.filter(workspace=workspace, owner=user, title=PROJECT_TITLE).first()
        if not project:
            self.stdout.write('No demo workspace found.')
            return
        folders = list(project.collections.select_related('parent').order_by('-id'))
        project.resources.filter(metadata__demo_seed=SEED_KEY).delete()
        try:
            identity = cloud.ensure_identity(user, _plan(user).quota_bytes)
            for folder in folders:
                try:
                    if not folder.resources.exists() and not folder.children.exists() and cloud.folder_is_empty(identity, _collection_path(folder)):
                        cloud.delete(identity, _collection_path(folder))
                        folder.delete()
                except cloud.CloudError:
                    self.stderr.write(f'Could not remove storage folder: {folder.name}')
        except cloud.CloudError:
            self.stderr.write('Demo database content was removed; private storage cleanup could not be verified.')
        for name in TAG_NAMES:
            Tag.objects.filter(workspace=workspace, name=name, resources__isnull=True).delete()
        if not project.resources.exists() and not project.collections.exists():
            project.delete()
        self.stdout.write(self.style.SUCCESS(f'Demo workspace removed for {user.email or user.username}.'))
