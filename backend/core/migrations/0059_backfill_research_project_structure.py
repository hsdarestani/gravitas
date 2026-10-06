from django.db import migrations


CANONICAL_PROJECT_FOLDERS = (
    '01_Client_Input',
    '02_Working',
    '03_Datasets',
    '04_Analysis',
    '05_Deliverables',
    '06_Archive',
)


def backfill_research_project_structure(apps, schema_editor):
    ResearchProject = apps.get_model('core', 'ResearchProject')
    Collection = apps.get_model('core', 'Collection')
    ResearchProjectProfile = apps.get_model('core', 'ResearchProjectProfile')

    for project in ResearchProject.objects.filter(archived=False).iterator():
        for name in CANONICAL_PROJECT_FOLDERS:
            Collection.objects.get_or_create(
                workspace_id=project.workspace_id,
                project_id=project.pk,
                parent_id=None,
                name=name,
                defaults={'created_by_id': project.owner_id},
            )
        ResearchProjectProfile.objects.filter(project_id=project.pk).exclude(
            nextcloud_root=f'GRV-{project.pk:06d}',
        ).update(nextcloud_root=f'GRV-{project.pk:06d}')


def noop_reverse(apps, schema_editor):
    # The folders may contain user data after deployment; never delete them on
    # a reverse migration.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0058_pulsar_resource_embedding'),
    ]

    operations = [
        migrations.RunPython(backfill_research_project_structure, noop_reverse),
    ]
