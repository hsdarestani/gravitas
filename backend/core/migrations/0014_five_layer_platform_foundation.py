import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_layer_defaults(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    CommunityProfile = apps.get_model('core', 'CommunityProfile')
    ModuleGrant = apps.get_model('core', 'ModuleGrant')
    WorkspaceProfile = apps.get_model('core', 'WorkspaceProfile')
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')

    for user in User.objects.all().iterator():
        CommunityProfile.objects.get_or_create(user_id=user.pk, defaults={'role': 'member', 'status': 'active'})
        ModuleGrant.objects.get_or_create(
            user_id=user.pk,
            module='dashboard',
            defaults={
                'enabled': True,
                'access_level': 'participate',
                'source': 'system',
                'metadata': {},
            },
        )

    core_profiles = WorkspaceProfile.objects.filter(purpose='core').values_list('workspace_id', flat=True)
    for membership in WorkspaceMembership.objects.filter(workspace_id__in=core_profiles).iterator():
        level = 'manage' if membership.role in {'owner', 'admin'} else 'edit'
        ModuleGrant.objects.update_or_create(
            user_id=membership.user_id,
            module='core',
            defaults={
                'enabled': True,
                'access_level': level,
                'source': 'team',
                'metadata': {'mirrored_from': 'WorkspaceMembership'},
            },
        )


def noop_reverse(apps, schema_editor):
    # The migration is additive. Reversing the schema removes the rows with
    # their tables, so there is no old-model data to restore here.
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0013_reader_saved_item'),
    ]

    operations = [
        migrations.CreateModel(
            name='CommunityProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('member', 'Member'), ('learner', 'Learner'), ('researcher', 'Researcher'), ('team', 'Gravitas+ Team')], db_index=True, default='member', max_length=20)),
                ('status', models.CharField(choices=[('invited', 'Invited'), ('active', 'Active'), ('suspended', 'Suspended')], db_index=True, default='active', max_length=20)),
                ('joined_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_community_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['user_id'],
                'indexes': [models.Index(fields=['role', 'status'], name='grav_community_role_state')],
            },
        ),
        migrations.CreateModel(
            name='ModuleGrant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('module', models.CharField(choices=[('dashboard', 'Member Dashboard'), ('lms', 'LMS'), ('research', 'Research Workspace'), ('core', 'Core Workspace')], db_index=True, max_length=20)),
                ('access_level', models.CharField(choices=[('view', 'View'), ('participate', 'Participate'), ('edit', 'Edit'), ('manage', 'Manage')], default='participate', max_length=20)),
                ('enabled', models.BooleanField(db_index=True, default=True)),
                ('source', models.CharField(choices=[('system', 'System'), ('admin', 'Administrator'), ('enrollment', 'Course enrollment'), ('project', 'Research project'), ('team', 'Core team membership')], default='admin', max_length=20)),
                ('starts_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('granted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_module_grants_created', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_module_grants', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['user_id', 'module'],
                'indexes': [
                    models.Index(fields=['module', 'enabled'], name='grav_module_enabled'),
                    models.Index(fields=['user', 'module', 'enabled'], name='grav_user_module_state'),
                ],
                'constraints': [models.UniqueConstraint(fields=('user', 'module'), name='unique_gravitas_user_module_grant')],
            },
        ),
        migrations.CreateModel(
            name='ActivityEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('layer', models.CharField(choices=[('shell', 'Shell / Showcase'), ('dashboard', 'Member Dashboard'), ('lms', 'LMS'), ('research', 'Research Workspace'), ('core', 'Core Workspace')], db_index=True, max_length=20)),
                ('action', models.CharField(db_index=True, max_length=100)),
                ('object_type', models.CharField(blank=True, max_length=100)),
                ('object_id', models.CharField(blank=True, max_length=160)),
                ('detail', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_activity_events_authored', to=settings.AUTH_USER_MODEL)),
                ('subject_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_activity_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'indexes': [
                    models.Index(fields=['subject_user', 'layer', '-created_at'], name='grav_activity_subject_layer'),
                    models.Index(fields=['layer', 'action', '-created_at'], name='grav_activity_layer_action'),
                ],
            },
        ),
        migrations.CreateModel(
            name='Course',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=190, unique=True)),
                ('title', models.CharField(max_length=240)),
                ('summary', models.TextField(blank=True)),
                ('description', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('published', 'Published'), ('archived', 'Archived')], db_index=True, default='draft', max_length=20)),
                ('access_type', models.CharField(choices=[('open', 'Open enrollment'), ('locked', 'Locked / invite only'), ('paid', 'Paid')], db_index=True, default='open', max_length=20)),
                ('price', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('currency', models.CharField(default='EUR', max_length=8)),
                ('certificate_enabled', models.BooleanField(default=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_courses_created', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-published_at', '-updated_at'],
                'indexes': [models.Index(fields=['status', 'access_type'], name='grav_course_catalog')],
            },
        ),
        migrations.CreateModel(
            name='CourseModule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('position', models.PositiveIntegerField(default=1)),
                ('title', models.CharField(max_length=240)),
                ('summary', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='modules', to='core.course')),
            ],
            options={
                'ordering': ['position', 'id'],
                'constraints': [models.UniqueConstraint(fields=('course', 'position'), name='unique_gravitas_course_module_position')],
            },
        ),
        migrations.CreateModel(
            name='Lesson',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('position', models.PositiveIntegerField(default=1)),
                ('title', models.CharField(max_length=240)),
                ('kind', models.CharField(choices=[('video', 'Video'), ('article', 'Article'), ('file', 'File / download'), ('interactive', 'Interactive'), ('live', 'Live session')], default='article', max_length=20)),
                ('summary', models.TextField(blank=True)),
                ('body', models.TextField(blank=True)),
                ('content_url', models.URLField(blank=True, max_length=1200)),
                ('duration_seconds', models.PositiveIntegerField(default=0)),
                ('is_preview', models.BooleanField(default=False)),
                ('is_required', models.BooleanField(default=True)),
                ('published', models.BooleanField(db_index=True, default=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('module', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lessons', to='core.coursemodule')),
            ],
            options={
                'ordering': ['module__position', 'position', 'id'],
                'constraints': [models.UniqueConstraint(fields=('module', 'position'), name='unique_gravitas_lesson_position')],
            },
        ),
        migrations.CreateModel(
            name='CourseEnrollment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('active', 'Active'), ('completed', 'Completed'), ('paused', 'Paused'), ('revoked', 'Revoked')], db_index=True, default='active', max_length=20)),
                ('access_source', models.CharField(choices=[('open', 'Open enrollment'), ('admin', 'Administrator'), ('purchase', 'Purchase'), ('invite', 'Invite')], default='open', max_length=20)),
                ('progress_percent', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('enrolled_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='enrollments', to='core.course')),
                ('granted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_course_enrollments_granted', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_course_enrollments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
                'indexes': [
                    models.Index(fields=['user', 'status'], name='grav_enrollment_user_state'),
                    models.Index(fields=['course', 'status'], name='grav_enrollment_course_state'),
                ],
                'constraints': [models.UniqueConstraint(fields=('user', 'course'), name='unique_gravitas_course_enrollment')],
            },
        ),
        migrations.CreateModel(
            name='LessonProgress',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('completed', models.BooleanField(db_index=True, default=False)),
                ('progress_seconds', models.PositiveIntegerField(default=0)),
                ('score', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('state', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lesson_progress', to='core.courseenrollment')),
                ('lesson', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='progress_rows', to='core.lesson')),
            ],
            options={
                'ordering': ['lesson__module__position', 'lesson__position'],
                'constraints': [models.UniqueConstraint(fields=('enrollment', 'lesson'), name='unique_gravitas_lesson_progress')],
            },
        ),
        migrations.CreateModel(
            name='Assessment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=240)),
                ('instructions', models.TextField(blank=True)),
                ('questions', models.JSONField(blank=True, default=list)),
                ('passing_score', models.DecimalField(decimal_places=2, default=70, max_digits=5)),
                ('max_attempts', models.PositiveIntegerField(default=3)),
                ('required_for_completion', models.BooleanField(default=True)),
                ('published', models.BooleanField(db_index=True, default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assessments', to='core.course')),
                ('module', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assessments', to='core.coursemodule')),
            ],
            options={'ordering': ['module__position', 'id']},
        ),
        migrations.CreateModel(
            name='AssessmentAttempt',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('attempt_no', models.PositiveIntegerField()),
                ('answers', models.JSONField(blank=True, default=dict)),
                ('score', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('passed', models.BooleanField(db_index=True, default=False)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('submitted_at', models.DateTimeField(auto_now_add=True)),
                ('assessment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attempts', to='core.assessment')),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assessment_attempts', to='core.courseenrollment')),
            ],
            options={
                'ordering': ['-submitted_at'],
                'constraints': [models.UniqueConstraint(fields=('enrollment', 'assessment', 'attempt_no'), name='unique_gravitas_assessment_attempt_number')],
            },
        ),
        migrations.CreateModel(
            name='Certificate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('issued_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('enrollment', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='certificate', to='core.courseenrollment')),
            ],
            options={'ordering': ['-issued_at']},
        ),
        migrations.RunPython(backfill_layer_defaults, noop_reverse),
    ]
