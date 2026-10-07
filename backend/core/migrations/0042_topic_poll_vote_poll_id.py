from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0041_operating_task_checklist'),
    ]

    operations = [
        migrations.AddField(
            model_name='topicpollvote',
            name='poll_id',
            field=models.CharField(default='main', max_length=80),
        ),
        migrations.RemoveConstraint(
            model_name='topicpollvote',
            name='unique_gravitas_topic_poll_voter',
        ),
        migrations.RemoveIndex(
            model_name='topicpollvote',
            name='grav_topic_poll_option',
        ),
        migrations.AddConstraint(
            model_name='topicpollvote',
            constraint=models.UniqueConstraint(
                fields=('topic', 'voter_key', 'poll_id'),
                name='unique_gravitas_topic_poll_voter_key',
            ),
        ),
        migrations.AddIndex(
            model_name='topicpollvote',
            index=models.Index(
                fields=['topic', 'poll_id', 'option_id'],
                name='grav_topic_poll_key_option',
            ),
        ),
    ]
