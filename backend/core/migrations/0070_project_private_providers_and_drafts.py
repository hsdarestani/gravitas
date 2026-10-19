from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0069_project_operational_tools'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='ProjectProviderBinding',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('private_git', 'Private GitHub'), ('remote_db', 'External database')], max_length=24)),
                ('credential_alias', models.CharField(max_length=80)),
                ('resource', models.CharField(blank=True, max_length=210)),
                ('last_verified_at', models.DateTimeField(blank=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('configured_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_provider_bindings', to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='provider_bindings', to='core.researchproject')),
            ],
        ),
        migrations.AddConstraint(
            model_name='projectproviderbinding',
            constraint=models.UniqueConstraint(fields=('project', 'kind'), name='unique_project_provider_kind'),
        ),
        migrations.CreateModel(
            name='ProjectBufferedDraft',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('base_etag', models.CharField(max_length=240)),
                ('base_content', models.TextField()),
                ('content', models.TextField()),
                ('revision', models.PositiveIntegerField(default=1)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('file', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='buffered_drafts', to='core.canonicalfile')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_buffered_drafts', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='projectbuffereddraft',
            constraint=models.UniqueConstraint(fields=('file', 'user'), name='unique_user_file_buffer'),
        ),
    ]
