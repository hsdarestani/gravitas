from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0046_google_calendar_integration'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GoogleCalendarMeetingMinute',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ical_uid', models.CharField(max_length=1024)),
                ('google_event_id', models.CharField(blank=True, max_length=1024)),
                ('title', models.CharField(blank=True, max_length=500)),
                ('start_at', models.DateTimeField(blank=True, null=True)),
                ('end_at', models.DateTimeField(blank=True, null=True)),
                ('notes', models.TextField(blank=True)),
                ('reference_url', models.URLField(blank=True, max_length=1600)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_meeting_minutes_updated', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='google_calendar_meeting_minutes', to='core.workspace')),
            ],
            options={
                'ordering': ['-start_at', '-updated_at'],
            },
        ),
        migrations.CreateModel(
            name='GoogleCalendarTaskEventLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('calendar_id', models.CharField(default='primary', max_length=255)),
                ('event_id', models.CharField(max_length=1024)),
                ('html_link', models.URLField(blank=True, max_length=1600)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='google_calendar_links', to='core.operatingtask')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_google_calendar_task_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
        migrations.CreateModel(
            name='GoogleCalendarMeetingAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('storage_path', models.CharField(max_length=1000)),
                ('mime_type', models.CharField(blank=True, max_length=160)),
                ('size', models.PositiveBigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('minute', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attachments', to='core.googlecalendarmeetingminute')),
                ('uploader', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_meeting_minute_attachments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.AddConstraint(
            model_name='googlecalendarmeetingminute',
            constraint=models.UniqueConstraint(fields=('workspace', 'ical_uid'), name='unique_google_calendar_minute_workspace_uid'),
        ),
        migrations.AddConstraint(
            model_name='googlecalendartaskeventlink',
            constraint=models.UniqueConstraint(fields=('user', 'task'), name='unique_google_calendar_task_user'),
        ),
    ]
