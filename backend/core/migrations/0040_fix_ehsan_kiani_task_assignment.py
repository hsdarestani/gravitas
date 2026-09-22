from django.db import migrations


TASK_TITLES = (
    'Create initial unified Gravitas+ proposal template for institutions',
    'Prepare and submit proposals to at least 4 selected funding/institutional opportunities',
)
WRONG_EMAIL = 'sehsanm@gmail.com'


def fix_ehsan_assignment(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')
    WorkspaceProfile = apps.get_model('core', 'WorkspaceProfile')
    OperatingTask = apps.get_model('core', 'OperatingTask')
    db_alias = schema_editor.connection.alias

    profile = (
        WorkspaceProfile.objects.using(db_alias)
        .filter(purpose='core')
        .order_by('workspace_id')
        .first()
    )
    if profile is None:
        raise RuntimeError('Canonical Core workspace not found.')

    core_workspace_id = profile.workspace_id

    wrong_user = (
        User.objects.using(db_alias)
        .filter(email__iexact=WRONG_EMAIL)
        .order_by('id')
        .first()
    )

    # The correct Ehsan was already added manually to Core by the project manager.
    # Resolve only from current Core members and require an unambiguous Kiani match.
    candidate_ids = list(
        WorkspaceMembership.objects.using(db_alias)
        .filter(workspace_id=core_workspace_id, user__is_active=True)
        .filter(
            user__first_name__iexact='Ehsan',
            user__last_name__icontains='Kiani',
        )
        .values_list('user_id', flat=True)
        .distinct()
    )
    if not candidate_ids:
        candidate_ids = list(
            WorkspaceMembership.objects.using(db_alias)
            .filter(workspace_id=core_workspace_id, user__is_active=True)
            .filter(user__email__icontains='kiani')
            .values_list('user_id', flat=True)
            .distinct()
        )
    if len(candidate_ids) != 1:
        raise RuntimeError(
            f'Expected exactly one Core member matching Ehsan Kiani; found {len(candidate_ids)}.'
        )

    correct_user_id = candidate_ids[0]

    updated = (
        OperatingTask.objects.using(db_alias)
        .filter(
            workspace_id=core_workspace_id,
            title__in=TASK_TITLES,
        )
        .update(owner_id=correct_user_id)
    )
    if updated != 2:
        raise RuntimeError(f'Expected to reassign 2 Ehsan tasks; reassigned {updated}.')

    if wrong_user is not None and wrong_user.pk != correct_user_id:
        WorkspaceMembership.objects.using(db_alias).filter(
            workspace_id=core_workspace_id,
            user_id=wrong_user.pk,
        ).delete()

    correct_user = User.objects.using(db_alias).get(pk=correct_user_id)
    print(
        f'Reassigned {updated} tasks to Ehsan Kiani user_id={correct_user_id} '
        f'email={correct_user.email}; removed accidental Ehsan Mahmoudi Core membership.'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0039_add_ehsan_to_core_workspace'),
    ]

    operations = [
        migrations.RunPython(
            fix_ehsan_assignment,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
