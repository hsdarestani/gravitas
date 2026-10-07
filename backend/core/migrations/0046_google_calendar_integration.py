from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0045_reader_saved_item_seen_at'),
    ]

    operations = [
        migrations.CreateModel(
            name='GoogleCalendarConnection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('google_email', models.EmailField(blank=True, max_length=254)),
                ('refresh_token_encrypted', models.TextField()),
                ('calendar_id', models.CharField(default='primary', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_google_calendar', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='GoogleCalendarEventLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('calendar_id', models.CharField(default='primary', max_length=255)),
                ('event_id', models.CharField(max_length=1024)),
                ('html_link', models.URLField(blank=True, max_length=1600)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('meeting', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='google_calendar_links', to='core.operatingmeeting')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_google_calendar_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
        migrations.AddConstraint(
            model_name='googlecalendareventlink',
            constraint=models.UniqueConstraint(fields=('user', 'meeting'), name='unique_google_calendar_meeting_user'),
        ),
    ]
