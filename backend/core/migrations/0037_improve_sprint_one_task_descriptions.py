from django.db import migrations


DESCRIPTIONS = {
    'Monitor AutoResearch results for funding opportunities and shortlist viable opportunities':
        'Review AutoResearch-generated funding opportunities, assess relevance and feasibility, and produce a shortlist of opportunities worth deeper evaluation.',
    'Create initial unified Gravitas+ proposal template for institutions':
        'Prepare the first reusable Gravitas+ proposal template for institutional outreach, covering the core value proposition, project scope, methodology, expected outcomes, and team profile.',
    'Prepare and submit proposals to at least 4 selected funding/institutional opportunities':
        'Adapt the Gravitas+ proposal to at least four selected funding or institutional opportunities and complete submission for each one.',
    'Create website UX flow document for key audience segments':
        'Map the website journey for the main audience segments, including entry points, key decisions, primary actions, and expected conversion paths.',
    'Write complete script for Video #1':
        'Write the complete production-ready script for the first Gravitas video, including narrative structure, scene flow, key messages, and transitions.',
    'Create a real research project in Research Workspace and document issues in the new version':
        'Create and use one real research project inside Research Workspace to validate the current workflow and document product issues and improvement needs discovered during real use.',
    'Create a real course in LMS Workspace and document issues in the new version':
        'Create and use one real course inside LMS Workspace to validate the current learning workflow and document product issues and improvement needs discovered during real use.',
    'Create a real topic in the platform and test the new structure':
        'Create one real topic using actual content, connect relevant material to it, and validate the updated topic structure through real usage.',
    'Test Stable Diffusion for Gravitas design use cases':
        'Test Stable Diffusion on real Gravitas design needs and evaluate whether the generated outputs are usable for the current visual production workflow.',
    "Test narrator using Sajjad's voice for Video #1":
        'Create a narrator test using Sajjad\'s voice and a representative section of the Video #1 script so the team can evaluate voice quality and suitability.',
    'Deliver final SVG character files':
        'Prepare and deliver the approved characters as clean production-ready SVG files together with the required source assets.',
    'Align Core, Research, and LMS workspace design with the website design system':
        'Bring the main Core, Research, and LMS workspace screens into visual alignment with the approved Gravitas website design system and material language.',
    'Run cross-browser and responsive QA on key pages and fix critical/major issues':
        'Test the key website and workspace pages across major browsers and screen sizes, then resolve all critical and major responsive or rendering issues found.',
    'Update Brand Identity Document for Assets':
        'Update the Gravitas Brand Identity Document to reflect the current approved visual system and prepare the final version for upload to the Assets section.',
}


def improve_sprint_one_descriptions(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    db_alias = schema_editor.connection.alias

    for title, description in DESCRIPTIONS.items():
        task = (
            OperatingTask.objects.using(db_alias)
            .filter(title=title, status='active')
            .order_by('id')
            .first()
        )
        if task is None:
            continue
        task.description = description
        task.save(using=db_alias, update_fields=['description', 'updated_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0036_force_english_and_bump_task_sync_timestamp'),
    ]

    operations = [
        migrations.RunPython(
            improve_sprint_one_descriptions,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
