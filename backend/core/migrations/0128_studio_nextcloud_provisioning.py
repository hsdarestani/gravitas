from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0127_studio_template_revisions')]

    operations = [
        migrations.AddField(
            model_name='workspacestudioproject',
            name='nextcloud_provision_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
