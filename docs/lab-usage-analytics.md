# Lab Studio usage and published workspace settings

Lab Studio shows whether the draft source and settings match the published Lab.
Science Ecosystem's guest allowance, first-visit guide, comparison duration, and
all twelve lesson texts are edited in **Pulsar & lessons**, then saved and
published with the existing revision guard. Scientific Markdown remains a
separate, versioned source collection: published document edits apply on save.
The exact engine hash selects the scenario count shown in the release status.

**All Lab usage** opens a workspace-wide dashboard; **Usage analytics** in an
editor opens the same dashboard filtered to that Lab. Date filters use Tehran
time and select sessions by their start date. Activity totals describe those
sessions. Filters support Lab, member/guest, and name/email/guest identifier.
CSV uses the same filters and escapes spreadsheet formula prefixes.

Optional visit analytics starts only after the visitor explicitly selects
**Share usage statistics (optional)** in the Lab. Declining or withdrawing it
does not close the Lab, guide, atlas, or Pulsar. The existing consent manager
stores a Lab-specific choice; the server also requires the corresponding choice
cookie before writing analytics. Earlier generic analytics choices do not
silently enable this feature. Cross-tab changes are observed.

Visits are bound to a server-issued, HMAC-derived pseudonymous identifier and
the actual authenticated account, never a client-supplied user ID. A guest
visit may continue after sign-in. Another browser/account cannot append to it.
Interactive events are explicitly browser-reported; completed Pulsar answers
and newly saved snapshots are server-confirmed. Event UUIDs make retries
idempotent. Public batches and event metadata are bounded and allowlisted.

Foreground active time is an approximate browser measurement, counting only
visible, focused time with input in the preceding 90 seconds. Sleeping and
background intervals are excluded and reported totals cannot exceed elapsed
server time. Heartbeats update a visit rather than creating an event every
15 seconds. Session detail shows device/browser categories, model day, world,
changed parameter, guided comparisons, atlas activity, and source reads.

The analytics dataset contains no questions, conversation text, IP addresses,
or raw user-agent strings. Core admin permissions protect every overview,
detail, saved-record metadata endpoint, and CSV export. Only names and email
addresses from actual member accounts are shown; guest identities stay
pseudonymous.

**Saved-user records** separately reports existing account-owned snapshot,
conversation-thread, and currently saved message counts, including records
created before visit analytics. It does not read or expose conversation text.
Guest allowance counters are separate all-time service counts. Older visits
were never recorded and are not reconstructed or presented as measured usage.

Regression coverage includes SQLite and PostgreSQL aggregation/JSON handling,
permissions, identity boundaries, idempotence, consent, timezone boundaries,
CSV safety, published configuration, and browser acceptance from admin draft
through publication to the live learning workspace. Local preview and CI use
an explicitly labeled, disposable QA fixture; it never creates production users
or changes production records.
