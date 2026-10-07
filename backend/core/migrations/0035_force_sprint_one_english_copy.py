from django.db import migrations


SPRINT_MARKER = 'sprint01-20260921'


ENGLISH_COPY = {
    1: (
        'Monitor AutoResearch results for funding opportunities and shortlist viable opportunities',
        'AutoResearch results for funding opportunities are reviewed, and a shortlist of viable opportunities is recorded with rationale and status for each item.',
    ),
    2: (
        'Create initial unified Gravitas+ proposal template for institutions',
        'A unified, reusable Gravitas+ proposal template is completed and available to the team.',
    ),
    3: (
        'Prepare and submit proposals to at least 4 selected funding/institutional opportunities',
        'At least 4 tailored proposals are prepared and submitted, with recipient, opportunity, and submission date recorded for each.',
    ),
    4: (
        'Create website UX flow document for key audience segments',
        'The UX flow document covers the main audience segments and their key website journeys and is uploaded for review.',
    ),
    5: (
        'Write complete script for Video #1',
        'The complete script for Video #1 is finished and ready for scientific review and production.',
    ),
    6: (
        'Create a real research project in Research Workspace and document issues in the new version',
        'A real research project is created and used in Research Workspace, with observed issues, friction points, and required improvements documented.',
    ),
    7: (
        'Create a real course in LMS Workspace and document issues in the new version',
        'A real course is created and used in LMS Workspace, with observed issues, friction points, and required improvements documented.',
    ),
    8: (
        'Create a real topic in the platform and test the new structure',
        'A real topic is created, at least one real content item is linked to it, and issues and required improvements from real usage are documented.',
    ),
    9: (
        'Test Stable Diffusion for Gravitas design use cases',
        'Stable Diffusion is tested on at least 3 real Gravitas assets or use cases, with outputs and evaluation results recorded for review.',
    ),
    10: (
        "Test narrator using Sajjad's voice for Video #1",
        "A narrator sample using Sajjad's voice is produced from part of the Video #1 script and uploaded for review.",
    ),
    11: (
        'Deliver final SVG character files',
        'Final SVG character files and required source assets are delivered and uploaded to the agreed location.',
    ),
    12: (
        'Align Core, Research, and LMS workspace design with the website design system',
        'The main Core, Research, and LMS workspace screens are visually aligned with the website design system and ready for review.',
    ),
    13: (
        'Run cross-browser and responsive QA on key pages and fix critical/major issues',
        'Key pages are tested across major browsers and screen sizes, and all critical/major display and responsive issues are fixed with results documented.',
    ),
    14: (
        'Update Brand Identity Document for Assets',
        'The Brand Identity Document is updated and the final version is ready for upload to the Assets section.',
    ),
}


def force_sprint_one_english_copy(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    db_alias = schema_editor.connection.alias

    sprint_tasks = OperatingTask.objects.using(db_alias).filter(
        description__startswith=f'[{SPRINT_MARKER}]',
        status='active',
    )

    for board_order, (title, definition_of_done) in ENGLISH_COPY.items():
        sprint_tasks.filter(board_order=board_order).update(
            title=title,
            definition_of_done=definition_of_done,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0034_translate_sprint_one_tasks_to_english'),
    ]

    operations = [
        migrations.RunPython(
            force_sprint_one_english_copy,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
