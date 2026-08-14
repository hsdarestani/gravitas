from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hq', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='assetreference',
            name='provider',
            field=models.CharField(
                choices=[
                    ('nextcloud', 'Nextcloud'),
                    ('youtube', 'YouTube'),
                    ('google_drive', 'Google Drive'),
                    ('frame_io', 'Frame.io'),
                    ('vimeo', 'Vimeo'),
                    ('cloudflare_r2', 'Cloudflare R2'),
                    ('s3', 'S3 compatible'),
                    ('external', 'External URL'),
                ],
                db_index=True,
                default='nextcloud',
                max_length=24,
            ),
        ),
    ]
