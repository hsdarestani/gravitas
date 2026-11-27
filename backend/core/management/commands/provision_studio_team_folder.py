from django.core.management.base import BaseCommand

from core.studio_storage import provision_next_team_folder


class Command(BaseCommand):
    help = 'Provision the next queued Workspace Studio Nextcloud Team Folder.'

    def handle(self, *args, **options):
        self.stdout.write('studio_team_folder=' + provision_next_team_folder())
