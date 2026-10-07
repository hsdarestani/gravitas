from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0042_topic_poll_vote_poll_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='TaskNotificationPreference',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email_enabled', models.BooleanField(default=True)),
                ('telegram_enabled', models.BooleanField(default=True)),
                ('task_changes_enabled', models.BooleanField(default=True)),
                ('due_reminders_enabled', models.BooleanField(default=True)),
                ('telegram_chat_id', models.BigIntegerField(blank=True, null=True, unique=True)),
                ('telegram_username', models.CharField(blank=True, max_length=64)),
                ('telegram_link_code', models.CharField(blank=True, max_length=64, null=True, unique=True)),
                ('telegram_link_expires_at', models.DateTimeField(blank=True, null=True)),
                ('telegram_connected_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_task_notification_preference', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='TaskNotificationOutbox',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel', models.CharField(choices=[('email', 'Email'), ('telegram', 'Telegram')], max_length=16)),
                ('event_key', models.CharField(max_length=120)),
                ('event_type', models.CharField(max_length=80)),
                ('subject', models.CharField(max_length=300)),
                ('body', models.TextField()),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('sent', 'Sent'), ('failed', 'Failed')], db_index=True, default='pending', max_length=16)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('available_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_task_notification_outbox', to=settings.AUTH_USER_MODEL)),
                ('task', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='notification_outbox', to='core.operatingtask')),
            ],
            options={
                'ordering': ['created_at', 'id'],
                'indexes': [
                    models.Index(fields=['status', 'available_at', 'created_at'], name='grav_task_notif_queue'),
                ],
                'constraints': [
                    models.UniqueConstraint(fields=('recipient', 'channel', 'event_key'), name='unique_task_notification_delivery'),
                ],
            },
        ),
    ]
