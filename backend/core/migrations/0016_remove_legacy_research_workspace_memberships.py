from django.db import migrations


def remove_legacy_research_workspace_memberships(apps, schema_editor):
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')
    WorkspaceProfile = apps.get_model('core', 'WorkspaceProfile')

    research_workspace_ids = WorkspaceProfile.objects.filter(
        purpose='research',
    ).values_list('workspace_id', flat=True)

    WorkspaceMembership.objects.filter(
        workspace_id__in=research_workspace_ids,
    ).delete()


def noop_reverse(apps, schema_editor):
    # Broad Research workspace membership is legacy authorization state and
    # cannot be reconstructed safely. Project/object grants remain canonical.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0015_research_experiments_discussions'),
    ]

    operations = [
        migrations.RunPython(
            remove_legacy_research_workspace_memberships,
            noop_reverse,
        ),
    ]
