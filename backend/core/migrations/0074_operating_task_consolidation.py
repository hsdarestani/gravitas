"""Reversible historical task consolidation without touching source rows."""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('core', '0073_import_first_quarter_roadmap_milestones')]

    operations = [
        migrations.CreateModel(
            name='OperatingTaskConsolidation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reason', models.CharField(max_length=400)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('source', models.OneToOneField(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='consolidation_alias', to='core.operatingtask')),
                ('target', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='consolidation_sources', to='core.operatingtask')),
            ],
            options={'constraints': [
                models.CheckConstraint(
                    condition=~models.Q(source=models.F('target')),
                    name='grav_task_merge_not_self'),
            ]},
        ),
    ]
