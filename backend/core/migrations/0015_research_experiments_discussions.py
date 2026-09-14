from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0014_five_layer_platform_foundation'),
    ]

    operations = [
        migrations.CreateModel(
            name='ResearchExperiment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=240)),
                ('hypothesis', models.TextField(blank=True)),
                ('protocol', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('planned', 'Planned'), ('running', 'Running'), ('review', 'Under review'), ('complete', 'Complete'), ('abandoned', 'Abandoned')], db_index=True, default='planned', max_length=20)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('result_summary', models.TextField(blank=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_experiments_owned', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='experiments', to='core.researchproject')),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='ProjectDiscussionMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=10000)),
                ('resolved', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_project_messages', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='replies', to='core.projectdiscussionmessage')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='discussion_messages', to='core.researchproject')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.AddIndex(
            model_name='researchexperiment',
            index=models.Index(fields=['project', 'status', '-updated_at'], name='grav_experiment_project_state'),
        ),
        migrations.AddIndex(
            model_name='projectdiscussionmessage',
            index=models.Index(fields=['project', 'resolved', 'created_at'], name='grav_project_discussion_state'),
        ),
    ]
