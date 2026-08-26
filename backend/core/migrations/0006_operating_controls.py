from django.conf import settings
from django.db import migrations, models
from django.db.models import Q
import django.db.models.deletion


def backfill_task_schedule(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    # The Operating Model requires every task to have a Cycle or Due Date.
    # This only protects any rows created between 0005 and 0006 deployments.
    from django.utils import timezone
    OperatingTask.objects.filter(cycle__isnull=True, due_date__isnull=True).update(due_date=timezone.localdate())


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0005_operating_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='initiative',
            name='stage',
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.CreateModel(
            name='OperatingWorkPackage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=220)),
                ('description', models.TextField(blank=True)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('definition_of_done', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('active', 'Active'), ('blocked', 'Blocked'), ('done', 'Done'), ('archived', 'Archived')], default='active', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('milestone', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='work_packages', to='core.operatingmilestone')),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_work_packages_owned', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='operating_work_packages', to='core.researchproject')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='operating_work_packages', to='core.workspace')),
            ],
            options={'ordering': ['due_date', 'id']},
        ),
        migrations.CreateModel(
            name='OperatingRisk',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=220)),
                ('description', models.TextField(blank=True)),
                ('mitigation', models.TextField(blank=True)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('health', models.CharField(choices=[('green', 'Green'), ('yellow', 'Yellow'), ('red', 'Red')], default='yellow', max_length=12)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('active', 'Active'), ('blocked', 'Blocked'), ('done', 'Done'), ('archived', 'Archived')], default='active', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('initiative', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='risks', to='core.initiative')),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_risks_owned', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='operating_risks', to='core.researchproject')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='operating_risks', to='core.workspace')),
            ],
            options={'ordering': ['health', 'due_date', '-updated_at']},
        ),
        migrations.AddField(
            model_name='operatingtask',
            name='work_package',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tasks', to='core.operatingworkpackage'),
        ),
        migrations.RunPython(backfill_task_schedule, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='operatingtask',
            constraint=models.CheckConstraint(condition=Q(('cycle__isnull', False), ('due_date__isnull', False), _connector='OR'), name='grav_task_cycle_or_due'),
        ),
        migrations.AddConstraint(
            model_name='operatingtask',
            constraint=models.CheckConstraint(condition=Q(('meeting__isnull', True), ('due_date__isnull', False), _connector='OR'), name='grav_meeting_action_due'),
        ),
    ]
