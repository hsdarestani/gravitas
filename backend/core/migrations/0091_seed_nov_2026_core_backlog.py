"""Register two Nov 2026 team decisions in the canonical Core task backlog.

Data-only migration, using Django's existing production migration pipeline.
Do not alter existing tasks. Task status 'draft' is displayed as Backlog.
"""
from datetime import date

from django.db import migrations


ENTRIES = [
    {
        "key": "team:community-l2:2026-11-06",
        "title": "Community Layer 2: contextual asset reviews and targeted surveys",
        "due": None,
        "description": (
            "Team discussion (Sajad, Ahmad, Hossein; 6 Nov 2026). "
            "After Forum V1, consider an invitation-only second-layer community workflow for "
            "review of unpublished topic research, project files, scientific accuracy, video drafts, "
            "character designs, website UX and working process. Start with 2-3 real files in "
            "Sajad's first-topic project; ask him for specific review questions. "
            "Assess anchored comments against the correct file/version, access controls, "
            "reviewer attribution and triage, and short targeted questionnaires with ratings, "
            "choice and free-text answers. Do not grant reviewers editing access to original assets. "
            "Do not start implementation before the Forum V1 community flow and pilot scope are agreed."
        ),
        "done": (
            "Following Forum V1, review concrete Topic 1 assets with Sajad; define reviewers, "
            "permissions, version-specific comment flow, a 3-5 question pilot survey, "
            "feedback ownership/triage and a build-vs-defer decision."
        ),
        "phases": [],
    },
    {
        "key": "team:wsw-sandpit-2027:2026-11-06",
        "title": "WSW Sandpit Bildung und KI 2027: application and eligibility",
        "due": date(2027, 3, 31),
        "description": (
            "Grant assessment from Hossein and Sajad (6 Nov 2026). "
            "Maximum reported EUR 50,000, paid to a German host university for a "
            "three-day Sandpit of approximately 15-20 researchers and documentation, NOT "
            "a direct GraviQuest software development grant. Reported eligibility: "
            "doctoral researcher with German university research affiliation; verify the "
            "Koblenz guidance on two years of remaining university contract. "
            "Individual or maximum three applicants; English anonymized two-page proposal, "
            "CV(s), budget and proposed participant list. Eight researchers proposed by the "
            "applicant; researchers should generally have no past collaboration/publications; "
            "funder may nominate others. Eligible costs reported: travel, lodging, venue, "
            "catering, research materials and other justified workshop expenses. "
            "Funder publishes results, so confidentiality and IP must be clarified. "
            "Workshop window reported Jan-Jul 2028. "
            "Critical written questions to university/funder: Can the university contract "
            "for GraviQuest platform research usage or technical services? Can any grant "
            "amount legally be paid to the company, given procurement/conflicts rules? "
            "Who owns any code, content, datasets or research outcomes created? "
            "If no compliant financial route exists, compare community/network/research "
            "benefits with time cost and record a go/no-go. "
            "This grant supplements rather than replaces other fundraising. "
            "Verify all reported conditions against official call documents before submission."
        ),
        "done": (
            "Verify host and eligibility; secure written budget, contracting, publication and IP "
            "answers; decide go/no-go; if approved, prepare compliant English proposal, CV(s), "
            "budget and eight-person researcher shortlist and submit by 31 March 2027."
        ),
        "phases": [
            (
                "Sandpit 01: confirm German university lead and eligibility",
                date(2026, 12, 15),
                "Confirm PhD, researcher affiliation, university contract duration and host permission.",
                "Written host and applicant eligibility decision recorded.",
            ),
            (
                "Sandpit 02: clarify allowed platform fees, budget and IP",
                date(2027, 1, 15),
                "Ask university grant office and funder about allowable technical service costs, "
                "payment to GraviQuest, procurement, conflicts of interest, code IP and publication.",
                "Written grant-finance and IP findings plus value-based go/no-go decision recorded.",
            ),
            (
                "Sandpit 03: design scientific program and participants",
                date(2027, 2, 5),
                "Define three-day Bildung und KI Sandpit question, outputs and 8 proposed researchers "
                "with independence rules, within the expected 15-20 person format.",
                "Scientific workshop outline and proposed participant shortlist reviewed.",
            ),
            (
                "Sandpit 04: draft English application and compliant budget",
                date(2027, 2, 28),
                "Write anonymized two-page proposal, compile applicant CVs, participant list and "
                "university costed budget under EUR 50,000, with host review.",
                "Complete internal application pack and reviewed budget ready.",
            ),
            (
                "Sandpit 05: final review and submission",
                date(2027, 3, 24),
                "Check official conditions, anonymity, eligibility, IP disclosures and "
                "university application route; submit before 31 Mar 2027 if approved.",
                "Submission confirmation or explicit no-go recorded by the official deadline.",
            ),
        ],
    },
]


def forward(apps, schema_editor):
    Profile = apps.get_model("core", "WorkspaceProfile")
    Membership = apps.get_model("core", "WorkspaceMembership")
    Task = apps.get_model("core", "OperatingTask")
    profiles = list(Profile.objects.filter(purpose="core").values_list("workspace_id", flat=True)[:2])
    if len(profiles) != 1:
        print("Core backlog seed skipped: unique Core workspace unavailable.")
        return
    workspace_id = profiles[0]
    members = list(Membership.objects.filter(workspace_id=workspace_id, user__is_active=True)
                   .select_related("user").order_by("id"))
    if not members:
        print("Core backlog seed skipped: no active Core members.")
        return

    def rank(member):
        user = member.user
        label = " ".join([str(getattr(user, attr, "") or "")
                          for attr in ("first_name", "last_name", "email", "username")]).lower()
        if "hossein" in label or "darestani" in label or "farahani" in label:
            return 3
        if member.role in ("owner", "admin"):
            return 2
        return 1

    owner = sorted(members, key=lambda x: (-rank(x), x.id))[0].user
    next_order = (Task.objects.filter(workspace_id=workspace_id, status="draft")
                  .order_by("-board_order").values_list("board_order", flat=True).first() or 0)

    def create_once(source_key, title, description, done, due, parent_id=None):
        nonlocal next_order
        found = Task.objects.filter(workspace_id=workspace_id, source_key=source_key).first()
        if found:
            print("Core backlog existing task", found.pk, source_key)
            return found
        found = Task.objects.filter(workspace_id=workspace_id, title__iexact=title).first()
        if found:
            print("Core backlog matching title; no duplicate", found.pk, title)
            return found
        next_order += 100
        row = Task.objects.create(
            workspace_id=workspace_id, owner_id=owner.pk,
            title=title, description=description, definition_of_done=done,
            source_key=source_key,
            source_metadata={"intake_origin": "team_discussion", "intake_date": "2026-11-06"},
            project_id=None, parent_id=parent_id, initiative_id=None,
            status="draft", priority="p2", due_date=due,
            board_order=next_order,
        )
        print("Core backlog created", row.pk, source_key, "draft")
        return row

    for item in ENTRIES:
        parent = create_once(item["key"], item["title"], item["description"],
                             item["done"], item["due"])
        for number, phase in enumerate(item["phases"], 1):
            title, due, description, done = phase
            create_once(item["key"] + ":phase:" + str(number),
                        title, description, done, due, parent.pk)


class Migration(migrations.Migration):
    dependencies = [("core", "0090_lab_usage_analytics")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
