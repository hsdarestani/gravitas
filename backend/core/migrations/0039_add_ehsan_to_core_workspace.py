from django.db import migrations


EHSAN_EMAIL = 'sehsanm@gmail.com'


def add_ehsan_to_core_workspace(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')
    WorkspaceProfile = apps.get_model('core', 'WorkspaceProfile')
    db_alias = schema_editor.connection.alias

    user = (
        User.objects.using(db_alias)
        .filter(email__iexact=EHSAN_EMAIL, is_active=True)
        .order_by('id')
        .first()
    )
    if user is None:
        return

    profile = (
        WorkspaceProfile.objects.using(db_alias)
        .filter(purpose='core')
        .order_by('workspace_id')
        .first()
    )
    if profile is None:
        return

    WorkspaceMembership.objects.using(db_alias).get_or_create(
        workspace_id=profile.workspace_id,
        user_id=user.pk,
        defaults={'role': 'member'},
    )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0038_purge_legacy_auto_roadmap_tasks'),
    ]

    operations = [
        migrations.RunPython(
            add_ehsan_to_core_workspace,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
