from django.db import migrations


SPRINT_MARKER = 'sprint01-20260921'


UPDATES = [
    (
        'پایش نتایج AutoResearch برای Funding Opportunityها و تهیه Shortlist موارد قابل بررسی',
        'Monitor AutoResearch results for funding opportunities and shortlist viable opportunities',
        'AutoResearch results for funding opportunities are reviewed, and a shortlist of viable opportunities is recorded with rationale and status for each item.',
    ),
    (
        'تدوین قالب اولیه Proposal یکپارچه Gravitas+ برای ارسال به مؤسسات',
        'Create initial unified Gravitas+ proposal template for institutions',
        'A unified, reusable Gravitas+ proposal template is completed and available to the team.',
    ),
    (
        'آماده‌سازی و ارسال Proposal به حداقل 4 Funding / Institutional Opportunity منتخب',
        'Prepare and submit proposals to at least 4 selected funding/institutional opportunities',
        'At least 4 tailored proposals are prepared and submitted, with recipient, opportunity, and submission date recorded for each.',
    ),
    (
        'تدوین سند UX Flow وب‌سایت بر اساس گروه‌های مختلف مخاطب',
        'Create website UX flow document for key audience segments',
        'The UX flow document covers the main audience segments and their key website journeys and is uploaded for review.',
    ),
    (
        'نوشتن Script کامل Video #1',
        'Write complete script for Video #1',
        'The complete script for Video #1 is finished and ready for scientific review and production.',
    ),
    (
        'ثبت یک Research Project واقعی در Research Workspace و ثبت ایرادات نسخه جدید',
        'Create a real research project in Research Workspace and document issues in the new version',
        'A real research project is created and used in Research Workspace, with observed issues, friction points, and required improvements documented.',
    ),
    (
        'ثبت یک Course واقعی در LMS Workspace و ثبت ایرادات نسخه جدید',
        'Create a real course in LMS Workspace and document issues in the new version',
        'A real course is created and used in LMS Workspace, with observed issues, friction points, and required improvements documented.',
    ),
    (
        'ثبت یک Topic واقعی در پلتفرم و تست ساختار جدید',
        'Create a real topic in the platform and test the new structure',
        'A real topic is created, at least one real content item is linked to it, and issues and required improvements from real usage are documented.',
    ),
    (
        'بررسی عملی Stable Diffusion برای طراحی‌های Gravitas',
        'Test Stable Diffusion for Gravitas design use cases',
        'Stable Diffusion is tested on at least 3 real Gravitas assets or use cases, with outputs and evaluation results recorded for review.',
    ),
    (
        'تست Narrator با صدای سجاد برای Video #1',
        "Test narrator using Sajjad's voice for Video #1",
        "A narrator sample using Sajjad's voice is produced from part of the Video #1 script and uploaded for review.",
    ),
    (
        'ارائه فایل‌های SVG نهایی Characterها',
        'Deliver final SVG character files',
        'Final SVG character files and required source assets are delivered and uploaded to the agreed location.',
    ),
    (
        'یکپارچه‌سازی Design سه Workspace اصلی با Material Design وب‌سایت',
        'Align Core, Research, and LMS workspace design with the website material design',
        'The main Core, Research, and LMS workspace screens are visually aligned with the website design system and ready for review.',
    ),
    (
        'Cross-browser و Responsive QA صفحات اصلی و رفع ایرادات Critical/Major',
        'Run cross-browser and responsive QA on key pages and fix critical/major issues',
        'Key pages are tested across major browsers and screen sizes, and all critical/major display and responsive issues are fixed with results documented.',
    ),
    (
        'به‌روزرسانی Brand Identity Document برای بخش Assets',
        'Update Brand Identity Document for Assets',
        'The Brand Identity Document is updated and the final version is ready for upload to the Assets section.',
    ),
]


def translate_sprint_one_tasks(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    db_alias = schema_editor.connection.alias

    for old_title, new_title, definition_of_done in UPDATES:
        OperatingTask.objects.using(db_alias).filter(
            description__startswith=f'[{SPRINT_MARKER}]',
            title=old_title,
        ).update(
            title=new_title,
            definition_of_done=definition_of_done,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0033_seed_sprint_one_active_tasks'),
    ]

    operations = [
        migrations.RunPython(
            translate_sprint_one_tasks,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
