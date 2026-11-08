"""The two original editorial files selected for the public Topic 01."""
from django.conf import settings

SOURCE_DIRECTORY = '02_Working/Research/notes/Challenges_of_AI_in_Research'
SOURCE_FILES = {
    'overview': ('essay-1-the-reference-that-never-existed.md', 'Essay 1', 'The Reference That Never Existed'),
    'deep': ('essay-2-cheap-to-produce-costly-to-trust.md', 'Essay 2', 'Cheap to Produce, Costly to Trust'),
}
SOURCE_PATHS = {slot: f'{SOURCE_DIRECTORY}/{file[0]}' for slot, file in SOURCE_FILES.items()}


def is_topic_essay_source(project, path):
    return project.pk == settings.TOPIC_01_RESEARCH_PROJECT_ID and path in SOURCE_PATHS.values()
