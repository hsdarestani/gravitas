from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0042_topic_poll_vote_poll_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='readersaveditem',
            name='seen_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
