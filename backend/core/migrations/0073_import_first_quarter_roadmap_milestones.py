"""Import the approved month 0–3 cumulative milestones into Core Planning.

Source: Gravitas Roadmap — Editable Master Copy, chapter 10, updated 2026-10-21.
These are roadmap checkpoints, not evidence of completion. No KR progress,
existing task, user-authored initiative or existing milestone is overwritten.
"""
from django.db import migrations


# Month, canonical six-month KR, milestone title, acceptance evidence.
# Counts for months 1–3 are cumulative (not incremental).
CHECKPOINTS = [
    (0, 'O4-KR4', 'Infrastructure and KPI baselines',
     'Infrastructure is inventoried and available; baseline definitions and collection methods for content, website, community and revenue are documented.'),
    (0, 'O1-KR1', 'Research content format and visual character',
     'Candidate formats, recurring visual character and production constraints are reviewed and a testable direction is selected.'),
    (0, 'O4-KR1', 'Audience, competitor and research landscape',
     'Audience needs, comparable channels/products, their gaps and initial AI × Research positioning are documented with sources.'),
    (0, 'O4-KR7', 'Research video generation and production workflows',
     'Video-generation, graphic design, research and technical workflows are investigated and their baseline steps, tools and limitations documented.'),

    (1, 'O1-KR1', '2 main videos published (cumulative)',
     'Two distinct public long-form videos, with URLs, publication dates and scientific review evidence.'),
    (1, 'O1-KR2', '6 Shorts published (cumulative)',
     'Six distinct public Shorts, with URLs and dates; retain the native/derived distinction.'),
    (1, 'O1-KR3', '1 topic package prepared or published',
     'One coherent topic with research evidence and a companion dossier/article or publishable source pack; log its actual publication status.'),
    (1, 'O1-KR6', 'Four-week editorial calendar locked',
     'Four-week release calendar with owners, formats, dates, dependencies and review slots.'),
    (1, 'O3-KR1', '2 service offers, prospect list and proposal template',
     'Two written service offers, a qualified target-customer list and one reusable proposal template.'),
    (1, 'O4-KR7', 'Graphic design workflow documented',
     'Reusable design handoffs, templates, owners and approval steps are recorded as an operating asset.'),
    (1, 'O4-KR7', 'Video generation workflow documented',
     'Reusable script-to-video, editing, scientific review, QA and publishing steps are recorded as an operating asset.'),
    (1, 'O4-KR7', 'Web development workflow documented',
     'Development, code review, test, deployment and rollback process is recorded as an operating asset.'),
    (1, 'O4-KR7', 'Research and learning workflow documented',
     'Evidence collection, fact checking, human review, learning and decision flow is documented as a reusable asset.'),
    (1, 'O1-KR4', '1 newsletter edition (cumulative)',
     'First newsletter edition published/sent and archived, consistent with the first-month calendar.'),

    (2, 'O1-KR1', '4 main videos published (cumulative)',
     'Four distinct public long-form videos in total; do not count month-one videos again as new outputs.'),
    (2, 'O1-KR2', '12 Shorts published (cumulative)',
     'Twelve distinct public Shorts in total, with native/derived attribution.'),
    (2, 'O1-KR3', '2 topic packages prepared or published (cumulative)',
     'Two distinct topic packages in total, each with evidence and a documented publication state.'),
    (2, 'O2-KR5', 'First community session held',
     'First real community session with date, attendance and captured feedback or discussion outcomes.'),
    (2, 'O3-KR2', '3 qualified proposals submitted',
     'Three distinct proposals submitted to qualified prospective buyers, with send date and follow-up status.'),
    (2, 'O3-KR5', '1 workshop or small pilot tested',
     'At least one workshop or small pilot completed with real participants/customer feedback; record if paid versus free.'),
    (2, 'O1-KR4', '2 newsletter editions (cumulative)',
     'Two distinct editions sent/archived in total; do not double-count edition one.'),

    (3, 'O1-KR1', '6 main videos published (cumulative)',
     'Six distinct public long-form videos in total, each with a published URL and review evidence.'),
    (3, 'O1-KR2', '18 Shorts published (cumulative)',
     'Eighteen distinct public Shorts in total, with a recorded native/derived split.'),
    (3, 'O1-KR3', '3 topic packages prepared or published (cumulative)',
     'Three distinct topics in total with evidence, companion content and actual release status.'),
    (3, 'O1-KR5', 'Interactive Lab portal and first experience',
     'A publicly reachable interactive Lab portal and one functional, tested experience with recorded user interactions.'),
    (3, 'O3-KR3', 'First paid customer project',
     'First genuine paid project or signed paid agreement, documented with a contract or payment evidence.'),
    (3, 'O4-KR1', 'Audience, format and revenue Decision Document',
     'Signed-off Decision Document for audience, positioning, content direction, and market/revenue evidence.'),
    (3, 'O1-KR4', '3 newsletter editions (cumulative)',
     'Three distinct newsletter editions sent/archived in total, as specified by the month-three publishing-calendar outcome.'),
    (3, 'O4-KR5', 'Quarter-one evidence and go/no-go review',
     'Review format promise, participation signals, sustainable production and first real sale; record continue/change/stop decisions.'),
]

PROCESS_FOR_KR = {
    'O1-KR1': 'content', 'O1-KR2': 'content', 'O1-KR3': 'content',
    'O1-KR4': 'content', 'O1-KR5': 'technology', 'O1-KR6': 'operations',
    'O2-KR5': 'operations', 'O3-KR1': 'commercial',
    'O3-KR2': 'commercial', 'O3-KR3': 'commercial',
    'O3-KR5': 'commercial', 'O4-KR1': 'research',
    'O4-KR4': 'operations', 'O4-KR5': 'operations', 'O4-KR7': 'operations',
}

PROCESS_NAMES = {
    'content': 'Media & Content',
    'research': 'Scientific Research',
    'commercial': 'Commercial Scientific Projects',
    'technology': 'Technology & Infrastructure',
    'operations': 'Operations / Management',
}


def import_first_quarter(apps, schema_editor):
    Profile = apps.get_model('core', 'WorkspaceProfile')
    Sync = apps.get_model('core', 'RoadmapOKRSyncState')
    KR = apps.get_model('core', 'KeyResult')
    Process = apps.get_model('core', 'OperatingProcess')
    Initiative = apps.get_model('core', 'Initiative')
    Milestone = apps.get_model('core', 'OperatingMilestone')
    db = schema_editor.connection.alias
    profiles = Profile.objects.using(db).filter(purpose='core').order_by('workspace_id')
    for profile in profiles:
        workspace_id = profile.workspace_id
        sync = Sync.objects.using(db).filter(workspace_id=workspace_id).first()
        bindings = ((sync.bindings or {}).get('key_results') or {}) if sync else {}
        if not bindings:
            print(f'quarter_roadmap_skipped workspace={workspace_id} reason=missing_okr_bindings')
            continue
        added = already = unresolved = 0
        initiatives_created = 0
        for month, source_kr, label, done in CHECKPOINTS:
            try:
                kr_id = int(bindings[source_kr])
            except (KeyError, TypeError, ValueError):
                unresolved += 1
                continue
            kr = KR.objects.using(db).filter(
                pk=kr_id, objective__workspace_id=workspace_id,
            ).first()
            if not kr:
                unresolved += 1
                continue
            title = f'Roadmap M{month} · {label}'
            if Milestone.objects.using(db).filter(workspace_id=workspace_id, title=title).exists():
                already += 1
                continue
            initiative = (
                Initiative.objects.using(db)
                .filter(workspace_id=workspace_id, key_result_id=kr.pk)
                .exclude(status='archived').order_by('id').first()
            )
            if initiative is None:
                process_key = PROCESS_FOR_KR[source_kr]
                process, _ = Process.objects.using(db).get_or_create(
                    workspace_id=workspace_id, key=process_key,
                    defaults={'name': PROCESS_NAMES[process_key]},
                )
                initiative_title = f'Roadmap first quarter · {source_kr}'
                initiative = Initiative.objects.using(db).filter(
                    workspace_id=workspace_id, key_result_id=kr.pk,
                    title=initiative_title,
                ).first()
                if initiative is None:
                    initiative = Initiative.objects.using(db).create(
                        workspace_id=workspace_id, key_result_id=kr.pk,
                        process_id=process.pk, owner_id=kr.owner_id,
                        title=initiative_title, description='Roadmap month 0–3 checkpoints',
                        status='active', priority='p1',
                    )
                    initiatives_created += 1
            Milestone.objects.using(db).create(
                workspace_id=workspace_id,
                initiative_id=initiative.pk,
                owner_id=kr.owner_id,
                title=title,
                status='active',
                definition_of_done=done,
                # No calendar start was specified in the source; avoid fake dates.
                due_date=None,
            )
            added += 1
        print(
            f'quarter_roadmap_workspace={workspace_id} created={added} '
            f'existing={already} unresolved={unresolved} '
            f'initiatives_created={initiatives_created}'
        )


class Migration(migrations.Migration):
    dependencies = [('core', '0072_planning_display_order')]
    operations = [migrations.RunPython(import_first_quarter, migrations.RunPython.noop)]
