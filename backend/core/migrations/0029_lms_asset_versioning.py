import uuid

from django.db import migrations, models
from django.utils import timezone


def backfill_learning_asset_versions(apps, schema_editor):
    LearningAsset = apps.get_model('core', 'LearningAsset')
    for item in LearningAsset.objects.all().iterator():
        item.logical_id = uuid.uuid4()
        item.updated_at = item.created_at or timezone.now()
        item.save(update_fields=['logical_id', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0028_learning_repository_review'),
    ]

    operations = [
        migrations.AddField(
            model_name='learningasset',
            name='logical_id',
            field=models.UUIDField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='learningasset',
            name='folder_path',
            field=models.CharField(blank=True, db_index=True, max_length=700),
        ),
        migrations.AddField(
            model_name='learningasset',
            name='version',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='learningasset',
            name='version_note',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='learningasset',
            name='is_current',
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AddField(
            model_name='learningasset',
            name='updated_at',
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(backfill_learning_asset_versions, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='learningasset',
            name='logical_id',
            field=models.UUIDField(db_index=True, default=uuid.uuid4),
        ),
        migrations.AlterField(
            model_name='learningasset',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterModelOptions(
            name='learningasset',
            options={'ordering': ['folder_path', 'title', '-version', '-updated_at']},
        ),
        migrations.AddConstraint(
            model_name='learningasset',
            constraint=models.UniqueConstraint(
                fields=('logical_id', 'version'),
                name='unique_gravitas_learning_asset_version',
            ),
        ),
    ]
