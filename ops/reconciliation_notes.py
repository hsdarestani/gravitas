"""Create the four approved Revenue notes in the existing canonical project."""

def ensure_revenue_notes(plan):
    from django.contrib.auth import get_user_model
    from core.models import ResearchProject,KnowledgeResource
    from core.operating_models import OperatingTask
    from core.platform_access import policy_for,INHERIT_VISIBILITY
    from core.canonical_journal import journal_transaction
    from core.canonical_projects import _pending,refresh_project
    from core.canonical_signals import flush_pending
    actor=get_user_model().objects.get(pk=plan['actor_id'])
    revenue = ResearchProject.objects.get(description__contains='<!-- gq-migration-project:revenue-20261015 -->')
    tasks = list(OperatingTask.objects.filter(project=revenue).order_by('id'))
    rows = '\n'.join(f'| #{t.pk} {t.title} | {t.owner.get_full_name()} | {t.priority} | {t.status} |' for t in tasks)
    definitions = [
      ('revenue-charter-v1', 'Revenue Research — Charter & decision criteria',
       '# Revenue Research\n\nOwners: Hossein Darestani Farahani and Sajad Aghapour.\n\nPurpose: compare revenue lines against actual O3 KR22–KR29 before committing resources. Core tasks are the operational task register; this Markdown note records research context and decisions.\n\n## Evaluation criteria\nWillingness to pay; accessible customer; defensibility; time to first revenue; delivery cost and capacity; evidence quality; legal/operational dependencies; fit with scientific mission.\n\n## Working rule\nFor each line record evidence URL/date, assumptions, counterevidence, estimated cost and capacity, next low-cost validation, and Continue/Change/Stop decision. Rankings remain proposed until reviewed by both owners.\n\n## Existing execution\nCoordinate proposal work with Core #538, #539 and #540. Research does not authorize spending, submission or publication.'),
      ('revenue-evidence-v1', 'Revenue Research — Evidence matrix',
       '# Evidence matrix\n\n| Revenue line | O3 link | Evidence | Assumptions / uncertainty | Next validation | Decision |\n|---|---|---|---|---|---|\n| Scientific services / institutional offers | KR22–KR25 | Pending research | Price and demand unverified | Compare four priced offers | Pending |\n| Paid workshop | KR26 | Pending research | Attendance and delivery cost unverified | Validate audience and price | Pending |\n| Membership Beta | KR27 | Pending research | Retention and payment demand unverified | Validate paid proposition | Pending |\n| Experiment kits | KR28 | Pending research | Supply and purchase intent unverified | Seek purchase/preorder evidence | Pending |\n| Institution-ready game/tool | KR29 | Pending research | Buyer and deployment constraints unverified | Validate institutional use case | Pending |'),
      ('revenue-roadmap-v1', 'Revenue Research — Prioritized discovery roadmap',
       '# Prioritized discovery roadmap\n\nPriority is a proposed discovery order, not a claim of strategy approval or verified delivery dates. Task statuses and owners live in Core.\n\n| Core task | Owner | Proposed priority | Status at initialization |\n|---|---|---|---|\n'+rows),
      ('revenue-decisions-v1', 'Revenue Research — Decision log',
       '# Decision log\n\n| Review date | Revenue line | Evidence reviewed | Continue / Change / Stop | Rationale | Linked Core action | Reviewers |\n|---|---|---|---|---|---|---|\n\nNo viability decision has been made by this migration. Record decisions here and update the linked Core tasks after review.\n\n## Historical reference\nMeeting discussions: 2026-09-07 and 2026-10-14. Explicit project/research request: 2026-10-15. Historical Google Docs remain references, not a parallel task board.')]
    @journal_transaction
    def notes():
        pending=[];token=_pending.set(pending)
        try:
            refresh_project(revenue, actor)
            for key,title,body in definitions:
                if KnowledgeResource.objects.filter(project=revenue, metadata__migration_key=key).exists():
                    continue
                note=KnowledgeResource.objects.create(workspace=revenue.workspace,project=revenue,owner=actor,kind='note',title=title,body=body,
                    source_url='https://docs.google.com/document/d/1GhcIajqtiSdFsyw87zlMPTqX4nA766SZfRTVYxc9PTA/edit',metadata={'migration_key':key,'migration_run_id':plan['run_id']})
                policy_for(note,create=True,created_by=actor,default_visibility=INHERIT_VISIBILITY)
            flush_pending(pending,actor)
        finally:
            _pending.reset(token)
    notes()
    return revenue,tasks
