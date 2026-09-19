import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0028_learning_repository_review'),
    ]

    operations = [
        migrations.AddField(
            model_name='learningasset',
            name='logical_id',
            field=models.UUIDField(db_index=True, default=uuid.uuid4),
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
