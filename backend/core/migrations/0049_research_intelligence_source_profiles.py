from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


DEFAULT_SOURCES = [
    'eu_funding',
    'ukri_funding',
    'dfg_funding',
    'arxiv',
    'github',
    'openai_news',
    'huggingface_blog',
]


def seed_source_profiles(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    Profile = apps.get_model('core', 'ResearchIntelligenceSourceProfile')
    db_alias = schema_editor.connection.alias
    profiles = [
        Profile(
            user_id=user_id,
            enabled_sources=list(DEFAULT_SOURCES),
            custom_sources=[],
        )
        for user_id in User.objects.using(db_alias).filter(is_active=True).values_list('id', flat=True)
    ]
    if profiles:
        Profile.objects.using(db_alias).bulk_create(profiles, ignore_conflicts=True)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0048_lms_learning_interactions_pulsar_grants'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ResearchIntelligenceSourceProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled_sources', models.JSONField(blank=True, default=list)),
                ('custom_sources', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_research_intelligence_sources', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['user_id'],
            },
        ),
        migrations.RunPython(seed_source_profiles, reverse_code=migrations.RunPython.noop),
    ]
