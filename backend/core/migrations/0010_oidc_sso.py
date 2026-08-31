from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0009_space_notes_ai'),
    ]

    operations = [
        migrations.CreateModel(
            name='OIDCAuthorizationCode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code_hash', models.CharField(max_length=64, unique=True)),
                ('client_id', models.CharField(max_length=160)),
                ('redirect_uri', models.URLField(max_length=600)),
                ('scope', models.CharField(default='openid email profile', max_length=300)),
                ('nonce', models.CharField(blank=True, max_length=300)),
                ('code_challenge', models.CharField(blank=True, max_length=160)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_oidc_codes', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='OIDCAccessToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('client_id', models.CharField(max_length=160)),
                ('scope', models.CharField(default='openid email profile', max_length=300)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_oidc_tokens', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
