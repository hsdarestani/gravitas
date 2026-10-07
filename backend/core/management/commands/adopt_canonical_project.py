from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from core.models import ResearchProject
from core.canonical_projects import adopt_project, project_objects
from core.canonical_models import CanonicalProject


class Command(BaseCommand):
    help = 'Inspect or explicitly adopt one existing Research project into guarded canonical Nextcloud files.'

    def add_arguments(self, parser):
        parser.add_argument('--project', type=int, required=True)
        parser.add_argument('--actor', required=True, help='Existing authorized user email')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        project = ResearchProject.objects.filter(pk=options['project'], archived=False).first()
        users = get_user_model().objects.filter(email__iexact=options['actor'], is_active=True)
        if not project or users.count() != 1:
            raise CommandError('Project or unique active actor not found')
        actor = users.get()
        from core.platform_access import can_manage
        if not can_manage(actor, project):
            raise CommandError('Actor cannot manage this project')
        self.stdout.write(f'project={project.pk} title={project.title} objects={sum(1 for _ in project_objects(project))}')
        if not options['apply']:
            self.stdout.write('Inspection only. Use --apply after checking backup/recovery and live Nextcloud ACLs.')
            return
        try:
            state = adopt_project(project, actor)
        except Exception as exc:
            state, _ = CanonicalProject.objects.get_or_create(project=project)
            state.last_error = str(exc); state.save(update_fields=['last_error'])
            raise CommandError(f'Adoption did not complete: {exc}') from exc
        self.stdout.write(f'enabled={state.enabled} backup={state.migration_backup_path}')
