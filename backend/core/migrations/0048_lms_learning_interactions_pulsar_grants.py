from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_calendar_meeting_minutes_task_events'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='LearningInteraction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('note', 'Note'), ('highlight', 'Highlight'), ('bookmark', 'Bookmark'), ('reminder', 'Reminder'), ('task', 'Task')], db_index=True, max_length=24)),
                ('section_key', models.CharField(blank=True, db_index=True, max_length=240)),
                ('quote', models.TextField(blank=True)),
                ('body', models.TextField(blank=True)),
                ('anchor', models.JSONField(blank=True, default=dict)),
                ('due_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('completed', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='interactions', to='core.courseenrollment')),
                ('lesson', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='learner_interactions', to='core.lesson')),
                ('nextcloud_resource', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='learning_interactions', to='core.knowledgeresource')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_learning_interactions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['completed', 'due_at', '-updated_at'],
            },
        ),
        migrations.CreateModel(
            name='PulsarAccessGrant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('allow_markdown', models.BooleanField(default=True)),
                ('allow_notes', models.BooleanField(default=True)),
                ('allow_write_interactions', models.BooleanField(default=True)),
                ('active', models.BooleanField(db_index=True, default=True)),
                ('granted_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pulsar_access_grants', to='core.course')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pulsar_access_grants', to='core.researchproject')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_access_grants', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['project__title', 'id'],
            },
        ),
        migrations.AddIndex(
            model_name='learninginteraction',
            index=models.Index(fields=['user', 'enrollment', 'kind', 'completed'], name='grav_lms_interact_user_state'),
        ),
        migrations.AddIndex(
            model_name='learninginteraction',
            index=models.Index(fields=['enrollment', 'lesson', 'kind'], name='grav_lms_interact_lesson'),
        ),
        migrations.AddIndex(
            model_name='pulsaraccessgrant',
            index=models.Index(fields=['user', 'course', 'active'], name='grav_pulsar_user_course_active'),
        ),
        migrations.AddConstraint(
            model_name='pulsaraccessgrant',
            constraint=models.UniqueConstraint(fields=('user', 'course', 'project'), name='unique_gravitas_pulsar_course_project_grant'),
        ),
    ]
