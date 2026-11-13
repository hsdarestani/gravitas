from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0097_topic_01_second_video_placeholder')]

    operations = [
        migrations.AlterField(
            model_name='topicessaypublication',
            name='depth',
            field=models.CharField(choices=[
                ('overview', 'Essay 1 · Researcher'), ('deep', 'Essay 2 · Researcher'),
                ('e1-curious', 'Essay 1 · Curious'), ('e1-undergrad', 'Essay 1 · Undergrad'),
                ('e2-curious', 'Essay 2 · Curious'), ('e2-undergrad', 'Essay 2 · Undergrad'),
            ], max_length=12, unique=True),
        ),
        migrations.CreateModel(
            name='TopicEssayReaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('essay', models.PositiveSmallIntegerField()),
                ('voter_key', models.CharField(max_length=64)),
                ('value', models.CharField(choices=[('useful', 'Useful'), ('not_useful', 'Not for me')], max_length=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'indexes': [models.Index(fields=['essay', 'value'], name='topic_essay_reaction_value')],
                'constraints': [models.UniqueConstraint(fields=('essay', 'voter_key'), name='unique_topic_essay_reaction_voter')],
            },
        ),
    ]
