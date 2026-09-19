from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0026_core_asset_versions'),
    ]

    operations = [
        migrations.AlterField(
            model_name='courseevent',
            name='kind',
            field=models.CharField(
                choices=[
                    ('course.open', 'Course open'),
                    ('lesson.view', 'Lesson view'),
                    ('lesson.skip', 'Lesson skip'),
                    ('lesson.dwell', 'Lesson dwell'),
                    ('ai.use', 'AI use'),
                    ('lab.use', 'Lab use'),
                    ('export', 'Export'),
                    ('discussion.post', 'Discussion post'),
                    ('literature.search', 'Literature search'),
                    ('notebook.open', 'Notebook open'),
                    ('git.push', 'Git push'),
                    ('social.publish', 'Social publish'),
                    ('pkm.export', 'PKM export'),
                    ('path.personalize', 'Path personalize'),
                ],
                db_index=True,
                max_length=40,
            ),
        ),
        migrations.CreateModel(
            name='LearnerPathAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('goal', models.TextField()),
                ('nodes', models.JSONField(blank=True, default=list)),
                ('edges', models.JSONField(blank=True, default=list)),
                ('rationale', models.TextField(blank=True)),
                ('active', models.BooleanField(db_index=True, default=True)),
                ('generated_by_ai', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('learning_path', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='learner_assignments', to='core.learningpath')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_learning_path_assignments', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='CourseDiscussionMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=12000)),
                ('deleted', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_course_discussion_messages', to=settings.AUTH_USER_MODEL)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='discussion_messages', to='core.course')),
                ('reply_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='replies', to='core.coursediscussionmessage')),
            ],
            options={
                'ordering': ['created_at', 'id'],
                'indexes': [models.Index(fields=['course', 'created_at'], name='grav_lms_chat_course_time')],
            },
        ),
        migrations.CreateModel(
            name='LearningIntegration',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(choices=[('github', 'GitHub'), ('linkedin', 'LinkedIn'), ('medium', 'Medium'), ('orcid', 'ORCID')], db_index=True, max_length=30)),
                ('label', models.CharField(blank=True, max_length=160)),
                ('account_id', models.CharField(blank=True, max_length=320)),
                ('encrypted_token', models.TextField(blank=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_learning_integrations', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['provider', '-updated_at'],
                'constraints': [models.UniqueConstraint(fields=('user', 'provider'), name='unique_gravitas_learning_integration')],
            },
        ),
        migrations.CreateModel(
            name='LearningRepository',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(default='github', max_length=30)),
                ('owner', models.CharField(max_length=160)),
                ('repository', models.CharField(max_length=220)),
                ('branch', models.CharField(default='main', max_length=160)),
                ('path_prefix', models.CharField(blank=True, max_length=600)),
                ('html_url', models.URLField(blank=True, max_length=1600)),
                ('last_commit_sha', models.CharField(blank=True, max_length=160)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='repositories', to='core.courseenrollment')),
                ('lesson', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='learning_repositories', to='core.lesson')),
            ],
            options={
                'ordering': ['-updated_at'],
                'constraints': [models.UniqueConstraint(fields=('enrollment', 'lesson', 'provider', 'owner', 'repository', 'path_prefix'), name='unique_gravitas_learning_repository')],
            },
        ),
        migrations.CreateModel(
            name='NotebookWorkspace',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=240)),
                ('runtime', models.CharField(choices=[('python', 'Python'), ('jupyter', 'Jupyter'), ('mathematica', 'Mathematica')], default='python', max_length=20)),
                ('code', models.TextField(blank=True)),
                ('environment', models.JSONField(blank=True, default=dict)),
                ('revision', models.PositiveIntegerField(default=1)),
                ('last_run_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notebooks', to='core.courseenrollment')),
                ('lesson', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='notebook_workspaces', to='core.lesson')),
            ],
            options={'ordering': ['-updated_at']},
        ),
    ]
