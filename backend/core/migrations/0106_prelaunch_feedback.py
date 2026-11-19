from django.db import migrations, models
import uuid


class Migration(migrations.Migration):
    dependencies = [('core', '0105_topic_01_title_research')]

    operations = [
        migrations.CreateModel(
            name='PrelaunchFeedback',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('survey_version', models.CharField(max_length=48, default='prelaunch-2026-v1', db_index=True)),
                ('name', models.CharField(max_length=120, blank=True)),
                ('answers', models.JSONField(default=dict, blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
