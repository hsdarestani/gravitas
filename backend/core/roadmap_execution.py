from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import operating_api as base
from .models import WorkspaceMembership
from .operating_models import (
    Health,
    Initiative,
    KeyResult,
    OperatingProcess,
    OperatingTask,
    Priority,
    WorkStatus,
)
from .roadmap_models import RoadmapOKRSyncState


ROLE_ALIASES = {
    'hossein': ('hossein', 'hosein', 'حسین', 'darestani'),
    'ahmad': ('ahmad', 'ahmed', 'احمد'),
    'kiarash': ('kiarash', 'kiarash', 'کیارش'),
    'sajjad': ('sajjad', 'sajad', 'سجاد'),
}


def _task(role, title, done):
    return {'role': role, 'title': title, 'definition_of_done': done}


ROADMAP_EXECUTION_PLANS = {
    'O1-KR1': {
        'title': 'Long-form video production cadence',
        'owner': 'ahmad', 'process': 'content', 'priority': Priority.P0, 'month': 6,
        'outcome': 'Ship 12 scientifically reviewed 8–20 minute videos through a repeatable biweekly production system.',
        'tasks': [
            _task('hossein', 'Lock the six-month long-form calendar and production slots', 'Twelve release slots, owners, dependencies and biweekly deadlines are visible in the operating calendar.'),
            _task('sajjad', 'Prepare evidence maps and scientific briefs for the next video batch', 'Each queued main video has a central question, source set, claim map and scientific risks before scripting starts.'),
            _task('kiarash', 'Define and maintain the reusable long-form visual system', 'Thumbnail, diagrams, title cards and recurring visual components are production-ready and reusable.'),
            _task('ahmad', 'Produce, edit and QA the long-form release batch', 'Each scheduled video is edited, captioned, technically checked and delivered before its release deadline.'),
        ],
    },
    'O1-KR2': {
        'title': 'YouTube Shorts production system',
        'owner': 'ahmad', 'process': 'content', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Publish 36 Shorts, including at least 18 native short-form pieces, through a weekly batch workflow.',
        'tasks': [
            _task('sajjad', 'Build a bank of scientifically sound native Short concepts', 'At least 18 native concepts have a clear question, claim or insight with source support.'),
            _task('kiarash', 'Create reusable vertical visual and caption templates', 'Reusable 9:16 templates cover hook, diagrams, captions, CTA and brand consistency.'),
            _task('ahmad', 'Produce native and long-form-derived Short batches', 'The rolling batch contains enough finished Shorts to maintain the roadmap publishing cadence.'),
            _task('hossein', 'Schedule Shorts and track native-versus-derived output', 'All 36 slots are scheduled and the dashboard separately counts native and derived Shorts.'),
        ],
    },
    'O1-KR3': {
        'title': 'Companion dossier publishing pipeline',
        'owner': 'sajjad', 'process': 'content', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Publish six evidence-rich companion dossiers or articles connected to major Gravitas content.',
        'tasks': [
            _task('sajjad', 'Select six dossier questions and build source packs', 'Six dossier scopes are linked to roadmap content and each has a verified source pack and claim outline.'),
            _task('sajjad', 'Draft and scientifically review dossier copy', 'Each dossier draft resolves scientific review comments and meets the editorial evidence standard.'),
            _task('kiarash', 'Create dossier diagrams and article visual assets', 'Required diagrams, cover visual and reusable content components are ready for web publication.'),
            _task('hossein', 'Publish dossiers with analytics and cross-links', 'Each approved dossier is live, linked to related videos/community actions and instrumented for analytics.'),
        ],
    },
    'O1-KR4': {
        'title': 'Monthly newsletter publishing loop',
        'owner': 'hossein', 'process': 'content', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Publish six monthly newsletter editions that connect content, evidence and community actions.',
        'tasks': [
            _task('sajjad', 'Define recurring editorial sections and evidence standard', 'Newsletter structure, source rules and monthly editorial selection criteria are documented.'),
            _task('kiarash', 'Build the reusable newsletter visual template', 'Responsive newsletter modules and image specifications are ready for repeated use.'),
            _task('ahmad', 'Prepare media derivatives for each newsletter edition', 'Each edition has the required stills, clips or media derivatives before send day.'),
            _task('hossein', 'Run monthly send, attribution and performance review', 'Six editions are sent on schedule with source attribution and opens/clicks/conversions logged.'),
        ],
    },
    'O1-KR5': {
        'title': 'Interactive science experience pipeline',
        'owner': 'hossein', 'process': 'technology', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Release two games, quizzes, simulations or interactive experiences with measurable completion and learning signals.',
        'tasks': [
            _task('sajjad', 'Define two interaction concepts and scientific learning outcomes', 'Two concepts specify the scientific question, user action, correct model and measurable learning outcome.'),
            _task('kiarash', 'Design interaction flows and visual states', 'User flows, interaction states, responsive UI and feedback states are ready for implementation.'),
            _task('hossein', 'Build and instrument the interactive experiences', 'Both experiences work end-to-end and record starts, completion and key interaction events.'),
            _task('ahmad', 'Create launch assets and motion/media components', 'Required audio, motion, video or promotional assets are integrated and launch-ready.'),
            _task('hossein', 'Run user tests and release both experiences', 'Real-user feedback is resolved, both experiences are live and the first analytics review is logged.'),
        ],
    },
    'O1-KR6': {
        'title': 'On-time publishing reliability',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P0, 'month': 6,
        'outcome': 'Keep at least 85% of planned outputs on schedule during the final three months.',
        'tasks': [
            _task('hossein', 'Create one source-of-truth production calendar with owners', 'Every planned output has a release date, accountable owner, current stage and dependency visibility.'),
            _task('ahmad', 'Set realistic production capacity and edit WIP limits', 'Video and media WIP limits are documented and used when locking each four-week calendar.'),
            _task('kiarash', 'Set design handoff deadlines and reusable asset rules', 'Design dependencies have standard lead times and recurring assets use reusable templates.'),
            _task('sajjad', 'Set scientific review service levels for deep content', 'Review deadlines and escalation rules are explicit enough to protect release dates without lowering evidence quality.'),
            _task('hossein', 'Review schedule adherence weekly and remove blockers', 'Weekly review records planned versus on-time outputs and actions needed to remain at or above 85%.'),
        ],
    },
    'O1-KR7': {
        'title': 'Long-form retention improvement experiments',
        'owner': 'ahmad', 'process': 'content', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Improve average retention by at least 20% versus the first three long-form videos through measured editorial experiments.',
        'tasks': [
            _task('hossein', 'Capture the first-three-video retention baseline', 'Baseline average retention and key drop-off timestamps are stored and used as the comparison set.'),
            _task('sajjad', 'Test stronger question framing and narrative evidence order', 'Each experiment states one editorial hypothesis about clarity, curiosity or evidence sequencing.'),
            _task('kiarash', 'Test visual pacing, diagrams and on-screen information density', 'Visual retention hypotheses are implemented as controlled changes rather than untracked redesigns.'),
            _task('ahmad', 'Run hook, pacing and edit-structure experiments', 'At least three release experiments are executed with documented changes and comparable retention data.'),
            _task('hossein', 'Compare retention and keep only winning changes', 'Dashboard shows improvement versus baseline and a keep/change/stop decision for each tested pattern.'),
        ],
    },
    'O1-KR8': {
        'title': 'Winning topic and format identification',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 3,
        'outcome': 'Identify at least three topics or formats that perform above the channel median and feed them into the next calendar.',
        'tasks': [
            _task('hossein', 'Define the comparison scorecard and channel median', 'Reach, retention, continuation and conversion metrics have clear definitions and a reproducible median benchmark.'),
            _task('sajjad', 'Tag content by topic, scientific question and depth', 'Published items use a consistent taxonomy that supports meaningful topic comparisons.'),
            _task('ahmad', 'Tag content by production and narrative format', 'Format variables such as interview, explainer, experiment and narrative structure are consistently recorded.'),
            _task('kiarash', 'Document recurring visual/packaging patterns', 'Thumbnail and presentation patterns are tagged so packaging effects can be separated from topic effects.'),
            _task('hossein', 'Select three above-median patterns for the next cycle', 'At least three evidence-backed topics/formats are named with the metric evidence and a scale/change decision.'),
        ],
    },

    'O2-KR1': {
        'title': 'Newsletter subscriber growth funnel',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Reach 1,500 newsletter subscribers through attributable content-to-signup paths.',
        'tasks': [
            _task('hossein', 'Instrument newsletter signup sources and conversion funnel', 'Every priority signup entry point records source and conversion from visit to confirmed subscriber.'),
            _task('sajjad', 'Define high-value signup promises tied to scientific depth', 'Signup copy clearly promises useful sources, experiments or deeper learning rather than generic updates.'),
            _task('kiarash', 'Design high-converting signup modules across the website', 'Responsive signup modules are consistent, accessible and placed at the highest-intent points.'),
            _task('ahmad', 'Create recurring video and social newsletter CTAs', 'Reusable end cards and short-form CTA assets are integrated into the media production workflow.'),
            _task('hossein', 'Run monthly acquisition review and improve weak sources', 'Subscriber growth by source is reviewed monthly and at least one funnel improvement is shipped after each review.'),
        ],
    },
    'O2-KR2': {
        'title': 'Registered member acquisition',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Reach 300 registered members with a low-friction path from content consumption to account creation.',
        'tasks': [
            _task('sajjad', 'Define member value and the first meaningful post-signup action', 'Registration has a clear reason and immediately routes members toward a scientific action.'),
            _task('kiarash', 'Design registration and onboarding UX', 'Registration, verification, welcome and first-action states are responsive and friction-tested.'),
            _task('hossein', 'Implement and instrument registration/onboarding', 'Signup flow is reliable and captures registration, verification and first-action conversion events.'),
            _task('ahmad', 'Create member acquisition assets in content releases', 'Major releases include a natural member CTA with reusable visual/media assets.'),
            _task('hossein', 'Review registration conversion and fix top drop-offs', 'The largest signup/onboarding drop-off is identified and acted on every review cycle.'),
        ],
    },
    'O2-KR3': {
        'title': 'Monthly active member loop',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Reach 100 monthly active members based on observable scientific/community actions, not registration alone.',
        'tasks': [
            _task('hossein', 'Define and instrument the monthly active member event set', 'The active-member definition maps to measurable actions and is queryable from product data.'),
            _task('sajjad', 'Create recurring scientific prompts and contribution actions', 'A rolling bank of meaningful actions gives members a reason to do more than passively browse.'),
            _task('kiarash', 'Design visible participation and return surfaces', 'Dashboard/community UI makes current actions, progress and next opportunities easy to find.'),
            _task('ahmad', 'Create recurring media prompts that bring members back', 'Content releases consistently point members to a specific action, discussion or interactive experience.'),
            _task('hossein', 'Review MAU drivers and remove inactive loops', 'Monthly review identifies which actions create repeat activity and stops or changes weak loops.'),
        ],
    },
    'O2-KR4': {
        'title': 'Meaningful contribution system',
        'owner': 'sajjad', 'process': 'research', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Collect 250 meaningful contributions with clear intake, review and attribution rules.',
        'tasks': [
            _task('sajjad', 'Define meaningful contribution types and review criteria', 'Critiques, source additions, topic ideas, translations, research and builds have explicit acceptance criteria.'),
            _task('hossein', 'Build contribution intake, status and attribution workflow', 'Members can submit contributions and the team can review, accept/reject and attribute them without manual spreadsheets.'),
            _task('kiarash', 'Design contribution forms and status feedback states', 'Submission and review feedback are understandable on desktop and mobile.'),
            _task('ahmad', 'Create contributor explainers and calls to action', 'Media assets show concrete examples of useful contributions and how to participate.'),
            _task('sajjad', 'Run weekly contribution review and quality sampling', 'Accepted contribution count and quality notes are updated weekly toward the 250 target.'),
        ],
    },
    'O2-KR5': {
        'title': 'Recurring online science sessions',
        'owner': 'sajjad', 'process': 'research', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Run four online sessions, study clubs or live discussions with reusable facilitation and follow-up.',
        'tasks': [
            _task('sajjad', 'Define four session topics, hosts and discussion outcomes', 'Four roadmap-aligned sessions have purpose, host, reading/context and intended participant action.'),
            _task('hossein', 'Set up registration, reminders and attendance tracking', 'Registration and reminders work end-to-end and attendance can be measured per session.'),
            _task('kiarash', 'Create session identity, deck and participant materials', 'Reusable event visual system plus session-specific materials are ready before each event.'),
            _task('ahmad', 'Handle recording, clips and post-session media', 'Each session has usable recording/clip output and the agreed recap assets.'),
            _task('sajjad', 'Facilitate sessions and publish decisions/notes', 'Four sessions run and their scientific discussion notes, questions and follow-ups are captured.'),
        ],
    },
    'O2-KR6': {
        'title': 'Session attendance growth',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P2, 'month': 6,
        'outcome': 'Average at least 25 participants per session through measurable recruitment and reminder loops.',
        'tasks': [
            _task('sajjad', 'Define a strong participant promise for each session', 'Each event communicates a concrete scientific question/outcome and target participant profile.'),
            _task('kiarash', 'Create event promotion and reminder templates', 'Reusable social, email and website promotion assets are ready for each session.'),
            _task('ahmad', 'Publish session teasers and speaker/topic clips', 'Each event receives at least one media-native promotion asset before registration closes.'),
            _task('hossein', 'Run invitation, reminder and attendance funnel', 'Invites, registrations, reminders and attendance are attributable and average attendance reaches 25+.'),
        ],
    },
    'O2-KR7': {
        'title': '30-day user return loop',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Reach at least a 20% 30-day return rate among website users by creating repeatable reasons to return.',
        'tasks': [
            _task('hossein', 'Define cohorts and establish the 30-day return baseline', 'Return-rate calculation is stable, cohort-based and visible in the operating dashboard.'),
            _task('sajjad', 'Prioritize recurring scientific value moments', 'At least three return triggers are tied to new evidence, questions, activities or discussions.'),
            _task('kiarash', 'Design next-action and return-state UX', 'Returning users see relevant unfinished, new or recommended actions rather than a generic homepage.'),
            _task('ahmad', 'Create reactivation media and recurring content hooks', 'Reusable assets support reactivation and recurring visit campaigns.'),
            _task('hossein', 'Run cohort experiments until return reaches 20%', 'Each experiment has a cohort, result and keep/change/stop decision; 30-day return is tracked against target.'),
        ],
    },
    'O2-KR8': {
        'title': 'Contributor network activation',
        'owner': 'sajjad', 'process': 'research', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Activate 30 people who contribute through critique, suggestions, translation, research or building.',
        'tasks': [
            _task('sajjad', 'Define contributor roles, quality bar and starter assignments', 'Each contributor path has eligibility, first task, review expectations and a clear definition of useful contribution.'),
            _task('hossein', 'Build application, access and assignment workflow', 'Applicants can be approved, assigned scoped work and given only the permissions they need.'),
            _task('kiarash', 'Create contributor onboarding kit and task templates', 'Contributor handbook, assignment template and status views are coherent and reusable.'),
            _task('ahmad', 'Create recruitment and contributor-story media', 'Recruitment assets explain who should join, why, and what real contribution looks like.'),
            _task('sajjad', 'Onboard and review the first 30 active contributors', 'Thirty distinct people have delivered at least one reviewed contribution.'),
        ],
    },

    'O3-KR1': {
        'title': 'Four packaged scientific offers',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P0, 'month': 1,
        'outcome': 'Design and price four clear offers grounded in buyer problems, scientific credibility and realistic delivery capacity.',
        'tasks': [
            _task('sajjad', 'Define buyer problems, scientific scope and delivery boundaries', 'Four offers each have a target buyer, problem, scientific value, deliverables and explicit exclusions.'),
            _task('hossein', 'Set pricing logic, timeline and commercial terms', 'Each offer has a price/range, delivery timeline, assumptions, margin logic and next-step CTA.'),
            _task('kiarash', 'Design four reusable offer one-pagers', 'Offer sheets communicate scope, evidence, process and price clearly enough for a buyer conversation.'),
            _task('ahmad', 'Create proof/demo media for the offers that need it', 'Relevant offers include concise visual proof, demo or media examples usable in sales meetings.'),
        ],
    },
    'O3-KR2': {
        'title': 'Qualified proposal pipeline',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P0, 'month': 3,
        'outcome': 'Send 12 qualified proposals to buyers with a real problem, budget path and decision process.',
        'tasks': [
            _task('hossein', 'Build and qualify the target-customer pipeline', 'Prospects are ranked by fit, problem, contact, budget path and next action rather than kept as a raw lead list.'),
            _task('sajjad', 'Prepare scientific scope modules for proposal tailoring', 'Reusable scope/evidence modules let proposals stay scientifically credible while matching buyer needs.'),
            _task('kiarash', 'Create the proposal and case-study template', 'A polished reusable proposal deck/document supports fast tailoring without redesign.'),
            _task('ahmad', 'Prepare demo assets for high-priority proposal conversations', 'Priority proposals have relevant media, prototype or visual proof where it increases buyer confidence.'),
            _task('hossein', 'Send and track 12 qualified proposals', 'Twelve proposals are sent to qualified buyers and outcome/next-step status is recorded for each.'),
        ],
    },
    'O3-KR3': {
        'title': 'First three paid research projects',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P0, 'month': 5,
        'outcome': 'Win at least three paid projects while protecting scientific scope, delivery quality and economics.',
        'tasks': [
            _task('hossein', 'Run discovery and qualification for project opportunities', 'Only opportunities with a concrete problem, buyer, budget path and feasible timeline reach proposal stage.'),
            _task('sajjad', 'Validate scientific scope, methods and acceptance criteria', 'Each proposed project has a defensible research scope, assumptions, outputs and review standard.'),
            _task('kiarash', 'Package project deliverables and client-facing presentation', 'Proposals/deliverables use a consistent client-facing system that makes scope and outputs clear.'),
            _task('ahmad', 'Create prototype or demonstration assets when needed', 'High-value opportunities receive the minimum demo needed to reduce buyer uncertainty.'),
            _task('hossein', 'Close, contract and kick off three paid projects', 'Three projects have explicit commercial commitment and enter delivery with owner, scope and data-access plan.'),
        ],
    },
    'O3-KR4': {
        'title': '€15k revenue and signed-contract target',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P0, 'month': 6,
        'outcome': 'Reach at least €15,000 in recognized revenue or signed contracts with traceable pipeline evidence.',
        'tasks': [
            _task('hossein', 'Create revenue pipeline and signed-value dashboard', 'Pipeline shows stage, probability, signed value, received value, next action and owner without double counting.'),
            _task('sajjad', 'Protect scope and scientific delivery economics', 'Scientific effort assumptions and review load are explicit before commercial commitments are accepted.'),
            _task('kiarash', 'Maintain commercial deck, case studies and proof assets', 'Sales materials stay current with approved project outcomes and evidence.'),
            _task('ahmad', 'Produce buyer-facing demos for priority opportunities', 'Media/prototype support is focused on deals where it materially increases conversion.'),
            _task('hossein', 'Run weekly commercial review toward €15k', 'Every open opportunity has a next action and signed/received value is reviewed until the €15k target is reached.'),
        ],
    },
    'O3-KR5': {
        'title': 'Paid scientific workshop pilot',
        'owner': 'sajjad', 'process': 'commercial', 'priority': Priority.P1, 'month': 2,
        'outcome': 'Run one paid workshop with at least 20 participants and evidence about willingness to pay and learning value.',
        'tasks': [
            _task('sajjad', 'Design workshop promise, curriculum and learning outcomes', 'Workshop has target participant, agenda, exercises, prerequisites and measurable learning outcomes.'),
            _task('hossein', 'Set price, checkout, registration and attendance tracking', 'Payment and registration work end-to-end and paid/attended participant counts are reliable.'),
            _task('kiarash', 'Design workshop deck, workbook and promotional assets', 'Participant materials and promotion use one coherent reusable workshop system.'),
            _task('ahmad', 'Produce workshop promo and recording setup', 'Promotion assets are published and recording/media requirements are ready before delivery.'),
            _task('sajjad', 'Deliver workshop and review participant evidence', 'At least 20 paid participants are served and feedback/learning/commercial evidence is reviewed.'),
        ],
    },
    'O3-KR6': {
        'title': 'Membership Beta acquisition',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Acquire 50 paid members in Membership Beta and learn which recurring benefits drive usage and retention.',
        'tasks': [
            _task('sajjad', 'Define beta member value and recurring scientific benefits', 'Membership promise, recurring benefits and content/community boundaries are explicit and feasible.'),
            _task('hossein', 'Implement pricing, checkout, entitlement and cancellation', 'Paid membership flow works end-to-end and member status is reliable.'),
            _task('kiarash', 'Design membership landing, onboarding and member surfaces', 'The value proposition and paid-member experience are coherent across acquisition and use.'),
            _task('ahmad', 'Create launch and recurring member media', 'Beta launch has media assets and recurring benefits can be promoted without bespoke production each time.'),
            _task('hossein', 'Recruit 50 paid beta members and review churn signals', 'Fifty paid members are acquired and conversion, activation, usage and churn evidence are logged.'),
        ],
    },
    'O3-KR7': {
        'title': 'Experiment-kit purchase validation',
        'owner': 'sajjad', 'process': 'commercial', 'priority': Priority.P1, 'month': 5,
        'outcome': 'Test one experiment kit with genuine purchase, deposit or pre-order evidence before scaling physical production.',
        'tasks': [
            _task('sajjad', 'Define one experiment-kit concept and scientific protocol', 'Kit has target learner, experiment, materials, safety considerations and learning outcome.'),
            _task('kiarash', 'Design the kit experience, instructions and physical concept', 'Packaging concept, instruction flow and physical/digital touchpoints are testable without full-scale manufacturing.'),
            _task('ahmad', 'Create a convincing kit demo and experiment walkthrough', 'Buyer can understand the experience and outcome from a concise demo without the final production run.'),
            _task('hossein', 'Build pre-order/deposit test and buyer tracking', 'A real commitment mechanism records buyer source, amount/intent and conversion.'),
            _task('sajjad', 'Review purchase evidence and make build/change/stop decision', 'Decision is based on genuine purchase evidence, user feedback, cost and scientific value.'),
        ],
    },
    'O3-KR8': {
        'title': 'Institution-ready game or scientific tool',
        'owner': 'hossein', 'process': 'commercial', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Build one game or tool that can be credibly offered to a school, university or scientific institution.',
        'tasks': [
            _task('sajjad', 'Choose an institutional problem and define scientific requirements', 'Target institution, user, learning/research job and scientific acceptance criteria are explicit.'),
            _task('kiarash', 'Design institutional user flow and presentation system', 'Prototype supports the real classroom/research context and communicates value to a buyer.'),
            _task('hossein', 'Build a minimum sellable institutional version', 'Working version can be demonstrated end-to-end with basic access, data and deployment assumptions.'),
            _task('ahmad', 'Create demonstration and onboarding media', 'Buyer-facing demo clearly shows use, outcome and implementation context.'),
            _task('hossein', 'Run institutional demos and record commercial evidence', 'Qualified institutions see the product and at least one concrete commercial decision/next step is recorded.'),
        ],
    },

    'O4-KR1': {
        'title': 'Audience and positioning Decision Document',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P0, 'month': 3,
        'outcome': 'Complete one evidence-backed Decision Document for initial audience, positioning and the content wedge.',
        'tasks': [
            _task('sajjad', 'Synthesize audience, need and positioning research evidence', 'Decision-relevant observations, interviews, market evidence and uncertainties are summarized with sources.'),
            _task('hossein', 'Write decision options, criteria and recommended direction', 'Document distinguishes evidence from assumptions and states audience, position, wedge and rejected alternatives.'),
            _task('kiarash', 'Create visual positioning and audience maps', 'Core comparisons and decision logic are understandable through concise diagrams rather than text alone.'),
            _task('ahmad', 'Add production evidence from content experiments', 'Observed production feasibility, format performance and creative constraints are represented in the decision.'),
            _task('hossein', 'Approve and version the Decision Document', 'A dated approved decision exists with owners, implications and explicit triggers for revisiting it.'),
        ],
    },
    'O4-KR2': {
        'title': 'Evidence Map and Source Log standard',
        'owner': 'sajjad', 'process': 'research', 'priority': Priority.P0, 'month': 2,
        'outcome': 'Maintain an Evidence Map and Source Log for every main video as a mandatory production artifact.',
        'tasks': [
            _task('sajjad', 'Define the Evidence Map and Source Log schema', 'Template covers claims, source quality, uncertainty, contradictions, citation details and review status.'),
            _task('hossein', 'Integrate evidence artifacts into the content workflow', 'A main video cannot pass the research stage without its linked evidence artifacts in the workspace.'),
            _task('kiarash', 'Define source-to-visual traceability for charts and diagrams', 'Visual claims can be traced back to the evidence/source used to create them.'),
            _task('ahmad', 'Use evidence status during scripting and edit handoffs', 'Script/edit workflow visibly flags unsupported claims or missing source evidence before final export.'),
            _task('sajjad', 'Audit Evidence Maps for every main video', 'All main videos have complete and reviewable evidence artifacts, with missing items corrected before publish.'),
        ],
    },
    'O4-KR3': {
        'title': 'Scientific review coverage',
        'owner': 'sajjad', 'process': 'research', 'priority': Priority.P0, 'month': 6,
        'outcome': 'Complete Scientific Review for at least 90% of deep content without creating an invisible production bottleneck.',
        'tasks': [
            _task('sajjad', 'Define deep-content review checklist and severity levels', 'Scientific review covers claims, uncertainty, sources, wording and correction severity with a reusable checklist.'),
            _task('hossein', 'Add review state, deadline and coverage tracking to workflow', 'Deep content has explicit review status and the dashboard can calculate reviewed versus published coverage.'),
            _task('kiarash', 'Route scientific review to data visuals and explanatory diagrams', 'Charts, diagrams and visual scientific claims are included in review, not only text.'),
            _task('ahmad', 'Resolve scientific notes in script, voice and final edit', 'Production handoff keeps review notes traceable until each issue is resolved or explicitly accepted.'),
            _task('sajjad', 'Audit monthly review coverage and exceptions', 'Scientific review coverage is measured monthly and remains at or above 90%, with exceptions documented.'),
        ],
    },
    'O4-KR4': {
        'title': 'Cross-channel KPI system',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P0, 'month': 1,
        'outcome': 'Define and operationalize KPIs for YouTube, website, newsletter, community and revenue.',
        'tasks': [
            _task('hossein', 'Define KPI dictionary, owner and data source for every channel', 'Each KPI has formula, data source, update cadence, accountable owner and decision it informs.'),
            _task('sajjad', 'Define scientific quality and empowerment guardrail metrics', 'Quality, sourcing, correction and meaningful-action metrics sit beside growth metrics.'),
            _task('kiarash', 'Design the operating KPI dashboard information hierarchy', 'Dashboard makes trend, target, health and decision context scannable without decorative complexity.'),
            _task('ahmad', 'Define production health metrics for media output', 'Production cycle time, revision load, schedule adherence and content throughput are measurable.'),
            _task('hossein', 'Connect baseline values and launch weekly KPI updates', 'All priority KPI baselines are populated and the weekly review uses current data.'),
        ],
    },
    'O4-KR5': {
        'title': 'Weekly data review cadence',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P0, 'month': 1,
        'outcome': 'Run a weekly data review that produces explicit continue, change or stop decisions.',
        'tasks': [
            _task('hossein', 'Create weekly review agenda, scorecard and decision log', 'Meeting inputs are prepared from live KPIs and every reviewed item can end in continue/change/stop with owner.'),
            _task('sajjad', 'Bring scientific quality, research and community evidence', 'Scientific/research signals are reviewed alongside audience and revenue metrics.'),
            _task('ahmad', 'Bring production throughput and content-learning evidence', 'Production blockers, edit learnings and retention-relevant observations enter the weekly review.'),
            _task('kiarash', 'Bring design/packaging experiment evidence', 'Visual/UX experiments are linked to measurable outcomes rather than discussed as taste alone.'),
            _task('hossein', 'Run and close the weekly review action loop', 'Review happens weekly and prior decisions/action items are checked before new ones are opened.'),
        ],
    },
    'O4-KR6': {
        'title': 'Major-output post-mortem system',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 3,
        'outcome': 'Create a post-mortem for at least 80% of major outputs and feed learning back into process and planning.',
        'tasks': [
            _task('hossein', 'Define major-output threshold and post-mortem template', 'Template captures planned result, actual result, timing, blockers, metrics, decision and owner of improvements.'),
            _task('sajjad', 'Add scientific/research learning to post-mortems', 'Research quality, review issues and evidence gaps are captured where relevant.'),
            _task('ahmad', 'Add production and edit learning to post-mortems', 'Production estimates, revision causes, tooling and edit decisions become reusable learning.'),
            _task('kiarash', 'Add design/UX learning to post-mortems', 'Visual, packaging and interaction decisions are reviewed against outcome data.'),
            _task('hossein', 'Track post-mortem coverage and convert learning into tasks', 'At least 80% of major outputs have a closed post-mortem and actionable improvements enter the operating backlog.'),
        ],
    },
    'O4-KR7': {
        'title': 'Core process documentation',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 3,
        'outcome': 'Document 90% of core processes with owners, inputs, outputs, handoffs and measurable completion criteria.',
        'tasks': [
            _task('hossein', 'Build the core process inventory and documentation standard', 'Core processes are enumerated and each document uses a consistent owner/input/output/handoff/KPI structure.'),
            _task('sajjad', 'Document research and scientific-review processes', 'Research intake, evidence logging, scientific review and correction flows meet the process standard.'),
            _task('ahmad', 'Document media production and AI-assisted production processes', 'Script-to-edit, asset, QA and AI-assisted workflows are documented with real handoffs.'),
            _task('kiarash', 'Document design, graphics and visual handoff processes', 'Design request, iteration, delivery and reusable-system workflows are documented.'),
            _task('hossein', 'Document PM, technology and release processes and audit coverage', 'Remaining core processes are documented and coverage reaches at least 90%.'),
        ],
    },
    'O4-KR8': {
        'title': 'Idea-to-publish cycle-time reduction',
        'owner': 'hossein', 'process': 'operations', 'priority': Priority.P1, 'month': 6,
        'outcome': 'Reduce average idea-to-publish production time by at least 25% without reducing scientific quality.',
        'tasks': [
            _task('hossein', 'Establish baseline cycle time by production stage', 'Baseline measures idea, brief, research, script, design, edit, review and publish timestamps.'),
            _task('ahmad', 'Remove the largest production/edit bottlenecks', 'Top media bottlenecks have concrete workflow/template/tooling changes and before/after timing evidence.'),
            _task('kiarash', 'Reduce design handoff and repeated-asset time', 'Reusable systems and clearer handoffs reduce design wait/rework without lowering output quality.'),
            _task('sajjad', 'Reduce research/review wait time without weakening evidence', 'Review SLAs, templates and early evidence checks lower waiting/rework while preserving quality guardrails.'),
            _task('hossein', 'Automate recurring handoffs and verify 25% cycle-time reduction', 'End-to-end average is compared with baseline and reaches at least 25% improvement with quality guardrails intact.'),
        ],
    },
}


def _member_text(user):
    return ' '.join(filter(None, [
        getattr(user, 'first_name', ''),
        getattr(user, 'last_name', ''),
        getattr(user, 'username', ''),
        getattr(user, 'email', ''),
    ])).lower()


def _members(workspace):
    return [
        membership.user
        for membership in WorkspaceMembership.objects.filter(
            workspace=workspace,
            user__is_active=True,
        ).select_related('user').order_by('id')
    ]


def _resolve_roles(workspace):
    users = _members(workspace)
    if not users:
        raise ValueError('core_workspace_has_no_active_member')
    resolved = {}
    for role, aliases in ROLE_ALIASES.items():
        for user in users:
            text = _member_text(user)
            if any(alias.lower() in text for alias in aliases):
                resolved[role] = user
                break

    fallback_membership = (
        WorkspaceMembership.objects.filter(
            workspace=workspace,
            user__is_active=True,
            role__in=[WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN],
        )
        .select_related('user')
        .order_by('id')
        .first()
    )
    fallback = fallback_membership.user if fallback_membership else users[0]
    resolved.setdefault('hossein', fallback)
    unresolved = [role for role in ROLE_ALIASES if role not in resolved]
    for role in unresolved:
        resolved[role] = fallback
    return resolved, unresolved


def _roadmap_state(workspace):
    try:
        return RoadmapOKRSyncState.objects.get(workspace=workspace)
    except RoadmapOKRSyncState.DoesNotExist:
        return None


def _anchor_date(workspace, state):
    objective_ids = [
        int(value)
        for value in ((state.bindings or {}).get('objectives') or {}).values()
        if str(value).isdigit()
    ]
    objective = (
        workspace.strategic_objectives.filter(pk__in=objective_ids)
        .order_by('created_at', 'id')
        .first()
    )
    if objective:
        if objective.start_date:
            return objective.start_date
        if objective.created_at:
            try:
                return timezone.localtime(objective.created_at).date()
            except Exception:
                return objective.created_at.date()
    return timezone.localdate()


def _task_due(anchor, due_date, position, total):
    span = max(1, (due_date - anchor).days)
    return anchor + timedelta(days=max(1, round(span * position / max(1, total))))


def seed_workspace_roadmap_execution(workspace):
    """Create/converge the deterministic Core execution layer for all bound Roadmap KRs.

    The function only owns initiatives whose titles start with ``Roadmap <KR> ·``.
    User-created initiatives are intentionally left untouched.
    """
    state = _roadmap_state(workspace)
    if not state:
        return {
            'planned': 0, 'initiatives_created': 0, 'initiatives_updated': 0,
            'tasks_created': 0, 'tasks_updated': 0, 'missing_bindings': len(ROADMAP_EXECUTION_PLANS),
            'unresolved_roles': [],
        }

    bindings = (state.bindings or {}).get('key_results') or {}
    roles, unresolved_roles = _resolve_roles(workspace)
    base._ensure_processes(workspace)
    processes = {
        process.key: process
        for process in OperatingProcess.objects.filter(workspace=workspace, active=True)
    }
    anchor = _anchor_date(workspace, state)
    stats = {
        'planned': 0,
        'initiatives_created': 0,
        'initiatives_updated': 0,
        'tasks_created': 0,
        'tasks_updated': 0,
        'missing_bindings': 0,
        'unresolved_roles': unresolved_roles,
    }

    with transaction.atomic():
        for source_key, spec in ROADMAP_EXECUTION_PLANS.items():
            try:
                kr_id = int(bindings.get(source_key))
            except (TypeError, ValueError):
                stats['missing_bindings'] += 1
                continue
            kr = (
                KeyResult.objects.select_related('objective')
                .filter(pk=kr_id, objective__workspace=workspace)
                .first()
            )
            if not kr:
                stats['missing_bindings'] += 1
                continue

            process = processes.get(spec['process'])
            if not process:
                raise ValueError(f'roadmap_execution_process_missing:{spec["process"]}')
            owner = roles[spec['owner']]
            due_date = anchor + timedelta(days=30 * int(spec['month']))
            title = f'Roadmap {source_key} · {spec["title"]}'
            initiative = (
                Initiative.objects.filter(
                    workspace=workspace,
                    key_result=kr,
                    title=title,
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .first()
            )
            if initiative is None:
                initiative = Initiative.objects.create(
                    workspace=workspace,
                    key_result=kr,
                    process=process,
                    title=title,
                    description=spec['outcome'],
                    owner=owner,
                    priority=spec['priority'],
                    stage=process.flow[0] if process.flow else '',
                    health=Health.GREEN,
                    status=WorkStatus.ACTIVE,
                    start_date=anchor,
                    due_date=due_date,
                )
                stats['initiatives_created'] += 1
            else:
                changed = []
                desired = {
                    'process': process,
                    'description': spec['outcome'],
                    'owner': owner,
                    'priority': spec['priority'],
                    'start_date': initiative.start_date or anchor,
                    'due_date': due_date,
                }
                if not initiative.stage and process.flow:
                    desired['stage'] = process.flow[0]
                for field, value in desired.items():
                    if getattr(initiative, field) != value:
                        setattr(initiative, field, value)
                        changed.append(field)
                if changed:
                    changed.append('updated_at')
                    initiative.save(update_fields=changed)
                    stats['initiatives_updated'] += 1

            previous = None
            total = len(spec['tasks'])
            for position, blueprint in enumerate(spec['tasks'], start=1):
                task_owner = roles[blueprint['role']]
                task_due = _task_due(anchor, due_date, position, total)
                task = (
                    OperatingTask.objects.filter(
                        workspace=workspace,
                        initiative=initiative,
                        title=blueprint['title'],
                    )
                    .exclude(status=WorkStatus.ARCHIVED)
                    .first()
                )
                task_priority = (
                    Priority.P1
                    if spec['priority'] in {Priority.P0, Priority.P1}
                    else Priority.P2
                )
                if task is None:
                    task = OperatingTask.objects.create(
                        workspace=workspace,
                        initiative=initiative,
                        owner=task_owner,
                        title=blueprint['title'],
                        description=f'Roadmap execution task for {source_key}: {kr.title}',
                        priority=task_priority,
                        status=WorkStatus.ACTIVE,
                        due_date=task_due,
                        definition_of_done=blueprint['definition_of_done'],
                        dependency=previous,
                    )
                    stats['tasks_created'] += 1
                else:
                    changed = []
                    desired = {
                        'owner': task_owner,
                        'description': f'Roadmap execution task for {source_key}: {kr.title}',
                        'priority': task_priority,
                        'due_date': task_due,
                        'definition_of_done': blueprint['definition_of_done'],
                        'dependency': previous,
                    }
                    for field, value in desired.items():
                        if getattr(task, field) != value:
                            setattr(task, field, value)
                            changed.append(field)
                    if changed:
                        changed.append('updated_at')
                        task.save(update_fields=changed)
                        stats['tasks_updated'] += 1
                previous = task

            stats['planned'] += 1

    return stats
