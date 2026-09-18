from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


OVERVIEW = """<p>Start with the innocent version. Physics is written as rules. Rules can be followed. A computer follows rules. So in principle a computer could follow the universe's rules and tell you what happens next.</p>
<p>Three things get in the way, and only one of them is about computers.</p>
<p><strong>Chaos.</strong> Perfectly deterministic equations can be unpredictable in practice because tiny differences in where you start grow exponentially.</p>
<p><strong>Cost.</strong> Simulating quantum systems on ordinary computers gets exponentially more expensive with each particle added.</p>
<p><strong>Undecidability.</strong> Some questions have no procedure that settles them in finite time, and physics contains questions with exactly this character.</p>
<p>That leaves an interesting possibility: “computable” describes the relationship between us and the world rather than the world itself.</p>"""

IN_DEPTH = """<p>Physics is written as rules; rules can be followed; a computer follows rules. The Church–Turing thesis makes this precise for effective procedures, and Deutsch's physical form goes further: every finitely realisable physical system can be simulated to arbitrary accuracy by a universal model computing machine.</p>
<h3>Chaos is not uncomputability</h3>
<p>Lorenz's system is deterministic but nearby trajectories separate exponentially. The dynamics are computable; what fails is measurement precision, not the model.</p>
<h3>Cost is the practical wall</h3>
<p>An n-particle quantum state grows exponentially in classical representation. A faithful simulation of the universe cannot casually be assumed to be smaller or faster than the universe.</p>
<h3>Undecidability, made physical</h3>
<p>Undecidability results show that some families of physical questions have no general algorithm that settles every case.</p>
<h3>What the question is really asking</h3>
<p>Chaos limits prediction, cost limits simulation, and undecidability limits proof. Conflating them is how the debate usually goes wrong.</p>"""


def seed_topic(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    topic_data = {
        'number': '04',
        'tags': ['Computation', 'Philosophy of science', 'Physics'],
        'video': {
            'source_type': 'none',
            'youtube_url': '',
            'self_hosted_url': '',
            'description': 'The video is the way in: how the question arose, who pushed it, and where it broke.',
            'duration': '28 minutes',
            'info': 'Companion: Hypothesis Machine',
        },
        'essay': {'overview_html': OVERVIEW, 'indepth_html': IN_DEPTH, 'image_url': '', 'image_alt': ''},
        'sources': [
            {'level': 'start', 'level_label': 'Start here', 'label': 'The Annotated Turing, by Charles Petzold', 'url': ''},
            {'level': 'start', 'level_label': 'Start here', 'label': 'Chaos: Making a New Science, by James Gleick', 'url': ''},
            {'level': 'further', 'level_label': 'Go further', 'label': 'Feynman, “Simulating Physics with Computers” (1982)', 'url': 'https://doi.org/10.1007/BF02650179'},
            {'level': 'further', 'level_label': 'Go further', 'label': 'Lloyd, “Computational Capacity of the Universe” (2002)', 'url': 'https://arxiv.org/abs/quant-ph/0110141'},
            {'level': 'primary', 'level_label': 'Primary', 'label': 'Turing, “On Computable Numbers…” (1936)', 'url': 'https://doi.org/10.1112/plms/s2-42.1.230'},
            {'level': 'primary', 'level_label': 'Primary', 'label': 'Lorenz, “Deterministic Nonperiodic Flow” (1963)', 'url': 'https://doi.org/10.1175/1520-0469(1963)020%3C0130:DNF%3E2.0.CO;2'},
        ],
        'timeline': [
            {'date': '1936', 'title': 'Turing defines computability', 'description': 'A machine that can carry out any effective procedure, and a proof that some questions no such machine can settle.', 'image_url': '/assets/img/topic-04/turing.jpg', 'image_alt': 'Alan Turing'},
            {'date': '1946', 'title': 'ENIAC', 'description': 'The point where “in principle” starts costing floor space, power and heat.', 'image_url': '/assets/img/topic-04/eniac.jpg', 'image_alt': 'ENIAC operators'},
            {'date': '1963', 'title': 'Lorenz finds chaos', 'description': 'Three deterministic equations and no useful long-range prediction.', 'image_url': '/assets/img/topic-04/lorenz.svg', 'image_alt': 'Lorenz attractor'},
            {'date': '1970', 'title': 'A glider gun', 'description': 'Four rules, and the result is Turing complete. Computation is not rare.', 'image_url': '/assets/img/topic-04/glider-gun.gif', 'image_alt': 'Gosper glider gun'},
            {'date': '1982', 'title': 'Feynman proposes quantum computers', 'description': 'Simulating quantum systems on classical machines is costly, so use quantum ones.', 'image_url': '', 'image_alt': ''},
            {'date': '2020s', 'title': 'Learned models enter the loop', 'description': 'Systems approximate solutions without directly solving the equations.', 'image_url': '', 'image_alt': ''},
        ],
        'simulation': {'title': 'The Simulation', 'description': 'Interactive code can be authored from the Topic admin panel.', 'code': ''},
        'viewpoints': {
            'left_label': 'For computability',
            'left_text': 'Every physical process we have examined appears simulable given enough resources. “Enough resources” is an engineering constraint, not automatically a metaphysical one.',
            'right_label': 'Against',
            'right_text': 'Undecidability is not merely a resource complaint, and treating the universe as executing a computation can add assumptions that physics itself does not require.',
            'poll_question': 'Where do you land?',
            'poll_options': [
                {'id': 'resources', 'label': 'Computable in principle, limited only by resources'},
                {'id': 'undecidable', 'label': 'Not computable: undecidability is a hard wall'},
                {'id': 'badly-posed', 'label': 'The question is badly posed'},
            ],
        },
    }
    item, _ = ContentItem.objects.get_or_create(
        slug='computable-universe',
        defaults={
            'kind': 'topic',
            'status': 'published',
            'title': 'Is the universe computable?',
            'summary': 'If the world runs on rules, something ought to be able to run them. Gödel, chaos and thermodynamics disagree about how far that goes.',
            'body': '',
            'topic_data': topic_data,
        },
    )
    item.kind = 'topic'
    item.status = 'published'
    item.title = 'Is the universe computable?'
    item.summary = 'If the world runs on rules, something ought to be able to run them. Gödel, chaos and thermodynamics disagree about how far that goes.'
    item.topic_data = topic_data
    if item.published_at is None:
        from django.utils import timezone
        item.published_at = timezone.now()
    item.save()


class Migration(migrations.Migration):
    dependencies = [('core', '0018_document_annotations')]

    operations = [
        migrations.AddField(
            model_name='contentitem',
            name='topic_data',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='contentitem',
            name='kind',
            field=models.CharField(
                choices=[
                    ('article', 'Article'),
                    ('dossier', 'Dossier'),
                    ('topic', 'Topic'),
                    ('learning', 'Learning path'),
                    ('lab', 'Lab / Interactive'),
                ],
                default='article',
                max_length=24,
            ),
        ),
        migrations.CreateModel(
            name='CommentLike',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('comment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='likes', to='core.comment')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_comment_likes', to=settings.AUTH_USER_MODEL)),
            ],
            options={'constraints': [models.UniqueConstraint(fields=('comment', 'user'), name='unique_gravitas_comment_like')]},
        ),
        migrations.CreateModel(
            name='TopicPollVote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('voter_key', models.CharField(max_length=64)),
                ('option_id', models.CharField(max_length=80)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('topic', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='poll_votes', to='core.contentitem')),
            ],
            options={
                'indexes': [models.Index(fields=['topic', 'option_id'], name='grav_topic_poll_option')],
                'constraints': [models.UniqueConstraint(fields=('topic', 'voter_key'), name='unique_gravitas_topic_poll_voter')],
            },
        ),
        migrations.RunPython(seed_topic, migrations.RunPython.noop),
    ]
}
