from django.db import migrations, models


class Migration(migrations.Migration):
    """Profile pictures.

    A TextField holding a data URI rather than a FileField: this deployment
    configures no MEDIA_ROOT and serves no media URL, and Pillow is not
    installed, so an ImageField would add three pieces of deployment surface
    for one small image. The view that writes it enforces the size cap and
    the allowed image types.
    """

    dependencies = [
        ('core', '0011_space_managed_items'),
    ]

    operations = [
        migrations.AddField(
            model_name='researcherprofile',
            name='avatar',
            field=models.TextField(blank=True, default=''),
            preserve_default=False,
        ),
    ]
