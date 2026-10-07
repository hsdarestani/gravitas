from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0024_operating_task_board'),
    ]

    operations = [
        migrations.CreateModel(
            name='CourseCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=160, unique=True)),
                ('name', models.CharField(max_length=180, unique=True)),
                ('description', models.TextField(blank=True)),
                ('position', models.PositiveIntegerField(default=0)),
                ('active', models.BooleanField(db_index=True, default=True)),
            ],
            options={'ordering': ['position', 'name']},
        ),
        migrations.CreateModel(
            name='CourseTag',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=160, unique=True)),
                ('name', models.CharField(max_length=180, unique=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='LearningPath',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=190, unique=True)),
                ('title', models.CharField(max_length=240)),
                ('summary', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('published', 'Published'), ('archived', 'Archived')], db_index=True, default='draft', max_length=20)),
                ('nodes', models.JSONField(blank=True, default=list)),
                ('edges', models.JSONField(blank=True, default=list)),
                ('payment_config', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_learning_paths_created', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.AddField(
            model_name='course',
            name='provider',
            field=models.CharField(choices=[('native', 'Gravitas native'), ('openedx', 'Open edX')], db_index=True, default='native', max_length=20),
        ),
        migrations.AddField(
            model_name='course',
            name='openedx_course_key',
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name='course',
            name='openedx_course_url',
            field=models.URLField(blank=True, max_length=1200),
        ),
        migrations.AddField(
            model_name='course',
            name='openedx_studio_url',
            field=models.URLField(blank=True, max_length=1200),
        ),
        migrations.AddField(
            model_name='course',
            name='registration_schema',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='course',
            name='payment_config',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='course',
            name='learning_config',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='course',
            name='category',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='courses', to='core.coursecategory'),
        ),
        migrations.AddField(
            model_name='course',
            name='tags',
            field=models.ManyToManyField(blank=True, related_name='courses', to='core.coursetag'),
        ),
        migrations.CreateModel(
            name='CourseInstructor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('lead', 'Lead instructor'), ('instructor', 'Instructor'), ('assistant', 'Teaching assistant')], default='instructor', max_length=20)),
                ('position', models.PositiveIntegerField(default=0)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='instructor_links', to='core.course')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_course_instructor_links', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['position', 'id'],
                'constraints': [models.UniqueConstraint(fields=('course', 'user'), name='unique_gravitas_course_instructor')],
            },
        ),
        migrations.AddField(
            model_name='course',
            name='instructors',
            field=models.ManyToManyField(blank=True, related_name='gravitas_courses_taught', through='core.CourseInstructor', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='lesson',
            name='kind',
            field=models.CharField(choices=[('video', 'Video'), ('article', 'Article'), ('file', 'File / download'), ('pdf', 'PDF'), ('audio', 'Audio'), ('document', 'Document'), ('dataset', 'Dataset'), ('embed', 'Embedded content'), ('lab', 'Interactive Lab'), ('interactive', 'Interactive'), ('live', 'Live session')], default='article', max_length=20),
        ),
        migrations.AddField(
            model_name='lesson',
            name='access_rule',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='lesson',
            name='provider_key',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='lesson',
            name='lab_slug',
            field=models.CharField(blank=True, max_length=190),
        ),
        migrations.AddField(
            model_name='courseenrollment',
            name='provider_state',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name='CourseRegistrationProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('answers', models.JSONField(blank=True, default=dict)),
                ('completed', models.BooleanField(db_index=True, default=False)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('enrollment', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='registration_profile', to='core.courseenrollment')),
            ],
        ),
        migrations.CreateModel(
            name='LearningAsset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('file', 'File'), ('url', 'URL'), ('embed', 'Embed')], db_index=True, default='file', max_length=20)),
                ('title', models.CharField(max_length=240)),
                ('original_name', models.CharField(blank=True, max_length=255)),
                ('storage_path', models.CharField(blank=True, max_length=1000)),
                ('source_url', models.URLField(blank=True, max_length=1800)),
                ('mime_type', models.CharField(blank=True, max_length=180)),
                ('size', models.PositiveBigIntegerField(default=0)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assets', to='core.course')),
                ('lesson', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assets', to='core.lesson')),
                ('uploaded_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_learning_assets', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='SourceConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(choices=[('zotero', 'Zotero')], default='zotero', max_length=30)),
                ('label', models.CharField(default='Zotero', max_length=120)),
                ('library_type', models.CharField(default='user', max_length=20)),
                ('library_id', models.CharField(max_length=120)),
                ('encrypted_token', models.TextField()),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_source_connections', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
                'constraints': [models.UniqueConstraint(fields=('user', 'provider', 'library_type', 'library_id'), name='unique_gravitas_source_connection')],
            },
        ),
        migrations.CreateModel(
            name='CourseEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('course.open', 'Course open'), ('lesson.view', 'Lesson view'), ('lesson.skip', 'Lesson skip'), ('lesson.dwell', 'Lesson dwell'), ('ai.use', 'AI use'), ('lab.use', 'Lab use'), ('export', 'Export')], db_index=True, max_length=40)),
                ('duration_seconds', models.PositiveIntegerField(default=0)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='events', to='core.course')),
                ('enrollment', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='core.courseenrollment')),
                ('lesson', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='core.lesson')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_course_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['course', 'kind', '-created_at'], name='grav_lms_event_course_kind'),
                    models.Index(fields=['user', 'kind', '-created_at'], name='grav_lms_event_user_kind'),
                ],
            },
        ),
    ]
