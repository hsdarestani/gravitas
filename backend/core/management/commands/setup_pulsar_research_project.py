"""Connect the existing implementation corpus to a real Research project."""
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from core.models import KnowledgeResource, ResearchProject, ProjectMembership
from core.platform_api import ensure_project_folder_structure
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.platform_access import can_manage, policy_for, INHERIT_VISIBILITY

MATERIAL = ('docs/five-layer-platform-architecture.md', 'backend/core/pulsar_runtime/context.py', 'backend/core/pulsar_runtime/harness.py', 'backend/core/pulsar_task_service.py', 'backend/core/telegram_pulsar.py')


class Command(BaseCommand):
    help = 'Inspect/create a Pulsar Research project from existing repository material; never replace existing source notes.'
    def add_arguments(self, parser):
        parser.add_argument('--actor', required=True)
        parser.add_argument('--project', type=int)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--adopt', action='store_true')
    @transaction.atomic
    def handle(self, *args, **options):
        users = get_user_model().objects.filter(email__iexact=options['actor'], is_active=True)
        if users.count() != 1:
            raise CommandError('Unique active actor required')
        actor = users.get(); spaces = ensure_platform_workspaces(actor)
        matches = ResearchProject.objects.filter(pk=options['project']) if options['project'] else ResearchProject.objects.filter(title__iexact='Pulsar', archived=False)
        if matches.count() > 1:
            raise CommandError('Several Pulsar projects exist; select --project')
        project = matches.first()
        if project and not can_manage(actor, project):
            raise CommandError('Project manage access required')
        root = Path(__file__).resolve().parents[4]
        for path in MATERIAL:
            if not (root / path).is_file():
                raise CommandError(f'Existing source material missing: {path}')
        self.stdout.write(f'project={project.pk if project else "not_defined"} source_files={len(MATERIAL)}')
        if not options['apply']:
            return
        if not project:
            project = ResearchProject.objects.create(workspace=spaces['research'], owner=actor, title='Pulsar',
                description='# Pulsar\n\nExisting Gravitas intelligence layer. This project records the implemented runtime, project context, permission boundaries, task service and Telegram integration.\n\nNext action: validate the existing system against real Research project workflows.\n')
            ProjectMembership.objects.get_or_create(project=project, user=actor, defaults={'role': 'owner'})
            policy_for(project, create=True, created_by=actor, default_visibility='private')
        ensure_project_folder_structure(project, actor)
        for path in MATERIAL:
            key = f'repository-source:{path}'
            if KnowledgeResource.objects.filter(project=project, metadata__canonical_source_key=key).exists():
                continue
            content = (root / path).read_text()
            language = 'python' if path.endswith('.py') else 'markdown'
            note = KnowledgeResource.objects.create(workspace=project.workspace, project=project, owner=actor, kind='note',
                title=f'Existing Pulsar material · {Path(path).name}', description=path,
                body=f'# {path}\n\nRepository source: https://github.com/hsdarestani/gravitas/blob/main/{path}\n\n```{language}\n{content}\n```\n',
                metadata={'canonical_source_key': key, 'source_repository': 'hsdarestani/gravitas', 'source_path': path})
            policy_for(note, create=True, created_by=actor, default_visibility=INHERIT_VISIBILITY)
        if options['adopt']:
            from core.canonical_projects import adopt_project
            adopt_project(project, actor)
        self.stdout.write(f'project={project.pk} source_notes={KnowledgeResource.objects.filter(project=project, metadata__has_key="canonical_source_key").count()}')
