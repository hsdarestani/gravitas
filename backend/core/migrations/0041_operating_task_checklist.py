from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0040_fix_ehsan_kiani_task_assignment'),
    ]

    operations = [
        migrations.CreateModel(
            name='OperatingTaskChecklistItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=500)),
                ('is_completed', models.BooleanField(db_index=True, default=False)),
                ('position', models.PositiveIntegerField(db_index=True, default=0)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_operating_task_checklist_items', to=settings.AUTH_USER_MODEL)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='checklist_items', to='core.operatingtask')),
            ],
            options={
                'ordering': ['position', 'id'],
                'indexes': [
                    models.Index(fields=['task', 'is_completed', 'position'], name='grav_check_task_done_pos'),
                ],
            },
        ),
    ]
