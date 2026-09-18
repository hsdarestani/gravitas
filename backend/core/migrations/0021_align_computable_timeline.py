from django.db import migrations


def align_timeline(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug='computable-universe').first()
    if item is None:
        return
    data = dict(item.topic_data or {})
    data['timeline'] = [
        {'date': '1936', 'title': 'Turing defines computability', 'description': 'A machine that can carry out any effective procedure, and a proof that some questions no such machine can settle.', 'image_url': '/assets/img/topic-04/turing.jpg', 'image_alt': 'Passport photograph of Alan Turing at sixteen'},
        {'date': '1946', 'title': 'ENIAC', 'description': 'The point where “in principle” starts costing floor space, power and heat.', 'image_url': '/assets/img/topic-04/eniac.jpg', 'image_alt': 'Two operators working at the ENIAC computer'},
        {'date': '1948', 'title': 'Shannon puts a number on information', 'description': 'Information becomes a measurable quantity, which makes “how much computing does this need?” a real question.', 'image_url': '', 'image_alt': ''},
        {'date': '1963', 'title': 'Lorenz finds chaos in three equations', 'description': 'Fully deterministic, fully unpredictable in practice. Computability and predictability part company.', 'image_url': '/assets/img/topic-04/lorenz.svg', 'image_alt': 'A Lorenz attractor: one trajectory looping through two lobes'},
        {'date': '1970', 'title': 'A glider gun', 'description': 'Four rules, and the result is Turing complete. Computation is not rare.', 'image_url': '/assets/img/topic-04/glider-gun.gif', 'image_alt': 'Gosper’s glider gun in Conway’s Game of Life'},
        {'date': '1982', 'title': 'Feynman proposes quantum computers', 'description': 'Simulating quantum systems on classical machines costs exponentially. So use quantum ones.', 'image_url': '', 'image_alt': ''},
        {'date': '1990s', 'title': 'Simulation becomes a third pillar', 'description': 'Alongside theory and experiment. Much of modern physics now happens on a cluster.', 'image_url': '', 'image_alt': ''},
        {'date': '2020s', 'title': 'Learned models enter the loop', 'description': 'Systems that approximate solutions without solving the equations: fast, useful, and hard to interrogate.', 'image_url': '', 'image_alt': ''},
    ]
    item.topic_data = data
    item.save(update_fields=['topic_data', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('core', '0020_restore_computable_topic')]

    operations = [
        migrations.RunPython(align_timeline, migrations.RunPython.noop),
    ]
