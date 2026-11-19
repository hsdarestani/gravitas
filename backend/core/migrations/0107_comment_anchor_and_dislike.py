from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0106_prelaunch_feedback'),
    ]

    operations = [
        migrations.AddField(
            model_name='comment',
            name='anchor',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='commentlike',
            name='value',
            field=models.CharField(
                choices=[('like', 'Like'), ('dislike', 'Dislike')],
                default='like',
                max_length=8,
            ),
        ),
    ]
