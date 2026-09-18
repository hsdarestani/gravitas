from django.db import migrations


OVERVIEW = """<p>Start with the innocent version. Physics is written as rules. Rules can be followed.
A computer follows rules. So in principle a computer could follow the universe's rules and
tell you what happens next.</p>
<p>Three things get in the way, and only one of them is about computers.</p>
<p><b>Chaos.</b> Lorenz found that perfectly deterministic equations can be
unpredictable in practice: tiny differences in where you start grow exponentially. Nothing is
uncomputable here. You simply need infinite precision about the present to say anything about
the distant future, and nobody has that.</p>
<p><b>Cost.</b> Simulating quantum systems on ordinary computers gets exponentially
more expensive with each particle added. This is why Feynman argued in 1982 that if you want to
simulate physics properly you should build your simulator out of physics.</p>
<p><b>Undecidability.</b> Some questions have no procedure that settles them in finite time, and physicists have since found physical questions with exactly this character,
including whether certain materials have an energy gap.</p>
<p>Which leaves the interesting possibility: that "computable" describes the relationship
between us and the world rather than the world itself. The universe is not running a
simulation. It is doing what it does. Computation is the word for our attempt to keep up.</p>"""

IN_DEPTH = """<p>Start with the innocent version. Physics is written as rules; rules can be followed; a
computer follows rules. The Church–Turing thesis makes this precise for
<em>effective procedures</em>, and Deutsch's 1985 physical form of it goes further: every
finitely realisable physical system can be simulated to arbitrary accuracy by a universal
model computing machine. That is a claim about physics, not about mathematics, and it is not
obviously true.</p>

<h3>Chaos is not uncomputability</h3>
<p>Lorenz's 1963 system is three coupled ODEs with a strange attractor. Nearby trajectories
separate exponentially, at a rate set by the leading Lyapunov exponent λ. Predicting to a
horizon T requires roughly λT/ln 2 additional bits of initial precision. The dynamics are
perfectly computable; what fails is the measurement, not the model.</p>
<pre class="g-code"><code><span class="c-com"># Lorenz: deterministic, and useless for long-range prediction</span>
<span class="c-key">def</span> lorenz(s, σ=<span class="c-num">10</span>, ρ=<span class="c-num">28</span>, β=<span class="c-num">8</span>/<span class="c-num">3</span>):
    x, y, z = s
    <span class="c-key">return</span> [σ*(y-x), x*(ρ-z)-y, x*y-β*z]</code></pre>

<h3>Cost is the practical wall</h3>
<p>An <em>n</em>-particle quantum state needs on the order of 2<sup>n</sup> complex amplitudes.
At around 50 particles you exhaust any classical machine. Lloyd's 2002 estimate bounds the
observable universe at ~10<sup>120</sup> logical operations on ~10<sup>90</sup> bits since the Big Bang, so a faithful simulation of the universe cannot be smaller or faster than the
universe.</p>

<h3>Undecidability, made physical</h3>
<p>Cubitt, Pérez-García and Wolf (2015) showed the spectral gap problem is undecidable: there
is no algorithm that takes a local Hamiltonian and returns whether the system is gapped. This
is not a statement about our cleverness. It is a Turing-style limit sitting inside condensed
matter physics.</p>

<h3>What the question is really asking</h3>
<p>Each obstacle bites differently: chaos limits <em>prediction</em>, cost limits
<em>simulation</em>, undecidability limits <em>proof</em>. Conflating them is how the debate
usually goes wrong. The residue is a question about us: computation is our procedure for
keeping up with a universe that is simply doing what it does.</p>"""


def restore_topic(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug='computable-universe').first()
    if item is None:
        return

    item.title = 'Is the universe computable?'
    item.summary = 'If the world runs on rules, something ought to be able to run them. Gödel, chaos and thermodynamics all disagree about how far that goes.'
    item.kind = 'topic'
    item.status = 'published'
    item.topic_data = {
        'number': '04',
        'hero_lead': 'If the world runs on rules, something ought to be able to run them. That thought is older than computers and still unresolved, and the disagreement is not really about hardware.',
        'tags': ['Computation', 'Philosophy of science', 'Physics'],
        'video': {
            'source_type': 'none',
            'youtube_url': '',
            'self_hosted_url': '',
            'description': 'The video is the way in: the story of how the question arose, the people who pushed it, and where it broke. Everything below is what the video did not have room for.',
            'duration': '28 minutes',
            'info': '',
            'companion_label': 'Hypothesis Machine: the reasoning, as a game',
            'companion_url': '/game-hypothesis-machine.html',
            'transcript_label': 'Full transcript with references',
            'transcript_url': '',
        },
        'essay': {
            'overview_html': OVERVIEW,
            'indepth_html': IN_DEPTH,
            'image_url': '',
            'image_alt': '',
            'aside_title': 'Try It Yourself',
            'aside_text': 'The simulation below lets you set the precision of the initial conditions and watch the prediction horizon collapse.',
        },
        'sources_intro': 'Reading lists usually assume one reader. These do not: pick the level you want to enter at, and move up when you feel like it.',
        'sources': [
            {'level': 'start', 'level_label': 'Start here', 'label': 'The Annotated Turing, by Charles Petzold', 'url': ''},
            {'level': 'start', 'level_label': 'Start here', 'label': 'Chaos: Making a New Science, by James Gleick', 'url': ''},
            {'level': 'start', 'level_label': 'Start here', 'label': 'Our short video on the same question (28 min)', 'url': ''},
            {'level': 'further', 'level_label': 'Go further', 'label': 'Feynman, “Simulating Physics with Computers” (1982)', 'url': 'https://doi.org/10.1007/BF02650179'},
            {'level': 'further', 'level_label': 'Go further', 'label': 'Lloyd, “Computational Capacity of the Universe” (2002)', 'url': 'https://arxiv.org/abs/quant-ph/0110141'},
            {'level': 'further', 'level_label': 'Go further', 'label': 'Deutsch, “Quantum theory, the Church–Turing principle…” (1985)', 'url': 'https://doi.org/10.1098/rspa.1985.0070'},
            {'level': 'primary', 'level_label': 'Primary', 'label': 'Turing, “On Computable Numbers…” Proc. LMS (1936)', 'url': 'https://doi.org/10.1112/plms/s2-42.1.230'},
            {'level': 'primary', 'level_label': 'Primary', 'label': 'Lorenz, “Deterministic Nonperiodic Flow”, J. Atmos. Sci. (1963)', 'url': 'https://doi.org/10.1175/1520-0469(1963)020%3C0130:DNF%3E2.0.CO;2'},
            {'level': 'primary', 'level_label': 'Primary', 'label': 'Bennett & Landauer on the physical limits of computation', 'url': ''},
        ],
        'timeline': [
            {'date': '1936', 'title': 'Turing defines computability', 'description': 'A machine that can carry out any effective procedure, and a proof that some questions no such machine can settle.', 'image_url': '/assets/img/topic-04/turing.jpg', 'image_alt': 'Passport photograph of Alan Turing at sixteen'},
            {'date': '1948', 'title': 'Shannon puts a number on information', 'description': 'Information becomes a measurable quantity, which makes “how much computing does this need?” a real question.', 'image_url': '/assets/img/topic-04/eniac.jpg', 'image_alt': 'Two operators working at the ENIAC computer'},
            {'date': '1963', 'title': 'Lorenz finds chaos in three equations', 'description': 'Fully deterministic, fully unpredictable in practice. Computability and predictability part company.', 'image_url': '/assets/img/topic-04/lorenz.svg', 'image_alt': 'A Lorenz attractor'},
            {'date': '1982', 'title': 'Feynman proposes quantum computers', 'description': 'Simulating quantum systems on classical machines costs exponentially. So use quantum ones.', 'image_url': '/assets/img/topic-04/glider-gun.gif', 'image_alt': 'Gosper glider gun in Conway’s Game of Life'},
            {'date': '1990s', 'title': 'Simulation becomes a third pillar', 'description': 'Alongside theory and experiment. Much of modern physics now happens on a cluster.', 'image_url': '', 'image_alt': ''},
            {'date': '2020s', 'title': 'Learned models enter the loop', 'description': 'Systems that approximate solutions without solving the equations: fast, useful, and hard to interrogate.', 'image_url': '', 'image_alt': ''},
        ],
        'simulation': {
            'title': 'The Simulation',
            'description': 'Two identical Lorenz systems, started a hair apart. Set how precisely you know the starting point and watch how long the two agree. This is chaos, not uncertainty: the rules are exact.',
            'builtin': 'lorenz',
            'code': '',
        },
        'viewpoints_intro': 'We publish the strongest case against our own reading. If the counter-argument is weak here, that is our failure, not the argument’s.',
        'viewpoints': {
            'left_label': 'For computability',
            'left_text': 'Every physical process we have examined turns out to be simulable given enough resources. “Enough resources” is an engineering complaint, not a metaphysical one. Deutsch’s principle has survived forty years of attempts to find a counterexample.',
            'left_cite': 'The position the video leans toward',
            'right_label': 'Against',
            'right_text': 'Undecidability results like the spectral gap are not resource complaints: no amount of compute settles them. And treating the universe as executing a computation smuggles in a substrate and a clock that no physics requires. The metaphor is doing work the evidence does not support.',
            'right_cite': 'The strongest objection we could find',
            'poll_question': 'Where do you land?',
            'poll_options': [
                {'id': 'resources', 'label': 'Computable in principle, limited only by resources'},
                {'id': 'undecidable', 'label': 'Not computable: undecidability is a hard wall'},
                {'id': 'badly-posed', 'label': 'The question is badly posed'},
            ],
            'poll_note': 'Make your case in the discussion below.',
        },
        'landing': {
            'essay_meta': '18 min essay · 4 min summary',
            'pictures_title': 'Four pictures it keeps returning to',
            'pictures_text': 'A proof, a trajectory, a machine made of four rules, and the room where “in principle” first started costing electricity.',
            'discussion_title': 'The argument is already running',
            'discussion_text': 'Join the discussion around the current Topic.',
        },
    }
    item.save(update_fields=['title', 'summary', 'kind', 'status', 'topic_data', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('core', '0019_topic_cms')]

    operations = [
        migrations.RunPython(restore_topic, migrations.RunPython.noop),
    ]
}
