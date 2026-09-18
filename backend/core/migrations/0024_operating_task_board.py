from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0023_access_progress_support_assets_labs'),
    ]

    operations = [
        migrations.AddField(
            model_name='operatingtask',
            name='board_order',
            field=models.PositiveIntegerField(db_index=True, default=0),
        ),
        migrations.CreateModel(
            name='OperatingTaskComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=10000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_operating_task_comments', to=settings.AUTH_USER_MODEL)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='board_comments', to='core.operatingtask')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='OperatingTaskAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('storage_path', models.CharField(max_length=1000)),
                ('mime_type', models.CharField(blank=True, max_length=160)),
                ('size', models.PositiveBigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='board_attachments', to='core.operatingtask')),
                ('uploader', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_operating_task_attachments', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
    ]
