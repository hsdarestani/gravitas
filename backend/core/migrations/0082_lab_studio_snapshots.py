from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0081_allow_unscheduled_subtasks'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name='interactivelab', name='config', field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='interactivelab', name='topic_slug', field=models.SlugField(blank=True, db_index=True, max_length=180)),
        migrations.AddField(model_name='interactivelab', name='version', field=models.PositiveIntegerField(default=1)),
        migrations.AddField(model_name='interactivelab', name='published_version', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='interactivelab', name='published_files', field=models.JSONField(blank=True, default=list)),
        migrations.AddField(model_name='interactivelab', name='published_config', field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='interactivelab', name='studio_enabled', field=models.BooleanField(db_index=True, default=False)),
        migrations.CreateModel(
            name='LabRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField()),
                ('files', models.JSONField(default=list)),
                ('config', models.JSONField(default=dict)),
                ('topic_slug', models.SlugField(blank=True, max_length=180)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ('lab', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='revisions', to='core.interactivelab')),
            ],
            options={
                'ordering': ['-version'],
                'constraints': [models.UniqueConstraint(fields=('lab','version'), name='grav_lab_revision_unique')],
            },
        ),
    ]
