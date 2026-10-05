from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_pulsar_profiles(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    Profile = apps.get_model('core', 'PulsarUserMemoryProfile')
    default_skills = ['learning', 'research', 'project_task']
    default_scope = {
        'learning': {'read': True, 'write_interactions': 'approval'},
        'research': {'read': True, 'write': 'approval'},
        'project_task': {'read': True, 'write': 'approval'},
    }
    for user_id in User.objects.filter(is_active=True).values_list('pk', flat=True).iterator():
        Profile.objects.get_or_create(
            user_id=user_id,
            defaults={
                'allowed_skills': default_skills,
                'permission_scope': default_scope,
                'approval_defaults': {'r0': 'auto', 'r1': 'auto', 'r2': 'approval', 'r3': 'explicit'},
                'preferences': {},
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0055_course_revisions'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PulsarUserMemoryProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('allowed_skills', models.JSONField(blank=True, default=list)),
                ('permission_scope', models.JSONField(blank=True, default=dict)),
                ('approval_defaults', models.JSONField(blank=True, default=dict)),
                ('preferences', models.JSONField(blank=True, default=dict)),
                ('version', models.PositiveIntegerField(default=1)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_memory_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['user_id']},
        ),
        migrations.RunPython(seed_pulsar_profiles, migrations.RunPython.noop),
    ]
