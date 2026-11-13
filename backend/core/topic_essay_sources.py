"""The editorial files selected for the public Topic 01, one per essay and level.

Each essay reads at three levels, Curious, Undergrad and Researcher, and each
level is its own reviewed Markdown file, published through the same explicit
workflow as before. A slot names one essay at one level.

The two slots that existed before the levels, `overview` and `deep`, keep their
names: they hold the full text of Essay 1 and Essay 2, which is the Researcher
level. Renaming them would have meant a data migration and a moment in which
the published essays had no slot, for a word nobody outside this file reads.
"""
from django.conf import settings

SOURCE_DIRECTORY = '02_Working/Research/notes/Challenges_of_AI_in_Research'

LEVELS = (
    ('curious', 'Curious'),
    ('undergrad', 'Undergrad'),
    ('researcher', 'Researcher'),
)
LEVEL_LABELS = dict(LEVELS)

ESSAYS = {
    1: ('essay-1-the-reference-that-never-existed', 'The Reference That Never Existed'),
    2: ('essay-2-cheap-to-produce-costly-to-trust', 'Cheap to Produce, Costly to Trust'),
}

# slot -> (essay number, level)
SLOTS = {
    'overview': (1, 'researcher'),
    'deep': (2, 'researcher'),
    'e1-curious': (1, 'curious'),
    'e1-undergrad': (1, 'undergrad'),
    'e2-curious': (2, 'curious'),
    'e2-undergrad': (2, 'undergrad'),
}


def slot_label(slot):
    essay, level = SLOTS[slot]
    return f'Essay {essay} · {LEVEL_LABELS[level]}'


def _file_name(essay, level):
    stem = ESSAYS[essay][0]
    return f'{stem}.md' if level == 'researcher' else f'{stem}.{level}.md'


# slot -> (file name, essay label, essay title)
SOURCE_FILES = {
    slot: (_file_name(essay, level), f'Essay {essay}', ESSAYS[essay][1])
    for slot, (essay, level) in SLOTS.items()
}
SOURCE_PATHS = {slot: f'{SOURCE_DIRECTORY}/{file[0]}' for slot, file in SOURCE_FILES.items()}


def is_topic_essay_source(project, path):
    return project.pk == settings.TOPIC_01_RESEARCH_PROJECT_ID and path in SOURCE_PATHS.values()
