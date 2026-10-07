import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0025_openedx_lms_refactor'),
    ]

    operations = [
        migrations.AddField(
            model_name='coreasset',
            name='logical_id',
            field=models.UUIDField(db_index=True, default=uuid.uuid4),
        ),
        migrations.AddField(
            model_name='coreasset',
            name='folder_path',
            field=models.CharField(blank=True, db_index=True, max_length=700),
        ),
        migrations.AddField(
            model_name='coreasset',
            name='version',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='coreasset',
            name='version_note',
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name='coreasset',
            name='is_current',
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AlterModelOptions(
            name='coreasset',
            options={'ordering': ['folder_path', 'title', '-version', '-updated_at']},
        ),
        migrations.AddConstraint(
            model_name='coreasset',
            constraint=models.UniqueConstraint(
                fields=('logical_id', 'version'),
                name='unique_gravitas_core_asset_version',
            ),
        ),
    ]
