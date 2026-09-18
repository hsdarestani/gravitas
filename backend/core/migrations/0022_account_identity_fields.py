from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0021_align_computable_timeline'),
    ]

    operations = [
        migrations.AddField(
            model_name='communityprofile',
            name='email_verification_required',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='researcherprofile',
            name='phone',
            field=models.CharField(blank=True, max_length=40),
        ),
    ]
