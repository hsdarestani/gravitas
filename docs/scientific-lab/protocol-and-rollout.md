# Topic 01 scientific pilot: implementation and release gates

Status: implementation candidate; **not deployed, not scientifically approved**.

## Scientific design, version topic01-pilot-1

The main question is whether retrieval changes citation metadata reliability and
human-assessed claim support. An authenticated researcher chooses an existing
research project, a question, hypothesis, configured Pulsar model and 1–5 paired
repetitions. These are frozen, hashed protocol snapshots. A separate project
manager must approve the protocol. No named member is assigned or impersonated.

Citation conditions A (direct) and B (Europe PMC retrieval) have the same model,
question, reference count, temperature and output token ceiling. Scheduling is
randomized and persisted before observations. C consists of attributed human
assessments of the *same B output*, preserving the original denominator. It is
not a third, independently generated response and cannot be interpreted as such.

Prompt framing holds submitted evidence fixed, varies neutral/leading prompts,
and records a prespecified target claim. Human labels are yes/no/ambiguous
unsupported agreement, with evidence rationale. There is no scripted direction
of effect and no AI-generated grading treated as truth.

All provider calls use existing managed Pulsar adapters directly, avoiding gateway
fallback that could change the experimental model. The configured identifier,
prompt, parameters, timing, raw output and usage telemetry are recorded. Provider
identifiers may refer to mutable aliases. No unsupported seed is claimed. Raw
outputs survive JSON parse failures. Requests never execute user code.

Crossref matching separately compares DOI, title, first author, publication year
and journal. Exact normalized matching is conservative; discrepancies and missing
fields require review. Registry failures/no match are **unknown**, never proof
of fabrication. DOI presence is never claim support. Abstract access is never
called full-text review. Full text is reviewed by participants via the source.
OpenAlex and automated full-text extraction are not implemented in this pilot.

## Benchmark foundation, not ground truth

Three exploratory question prompts cover structural biology, psychology and
climate science. They are deliberately a convenience sample, not a representative
benchmark. Europe PMC introduces biomedical coverage bias. Each run is limited to
1–5 repetitions and 1–5 requested references per condition. This is a feasibility
pilot, not a powered confirmatory study. Missing/failed trials and duplicate
references remain visible. Unknown metadata is not automatically a false citation.

Inclusion: answerable scientific questions requiring identifiable published
sources, accessible question wording, a prespecified hypothesis and rubric.
Exclusion: confidential/personal information, questions requiring inaccessible
private data, and protocol changes after observation. A revision creates a new
run; old snapshots and events remain. Exclude no generated output based on whether
it agrees with the hypothesis. Keep failed observations in the run record.

Metadata tests use explicitly artificial fixtures. Fixtures are never benchmark
truth or published findings. Before final evaluation, an actual reviewer must
freeze a separate held-out question set, sampling plan and sample-size rationale;
independently assess source records; define adjudication and prevent pilot reuse
as confirmatory evidence. This human curation has **not** occurred.

Outcome reporting is descriptive, with per-reviewer counts, self-reported effort
and visible disagreements. No majority vote silently becomes truth. Correlated
citations are not pooled into binomial confidence intervals. No causal or
population-level conclusion is inferred. Independent review is required for every
returned reference/response before the reviewed state; review can conclude that
evidence is insufficient. Published means within the private project, not a
public scientific endorsement.

## Integration and persistence

`ScientificLabRun` protects its canonical `ResearchExperiment` from deletion.
Immutable protocol snapshots and append-only `ScientificLabEvent` entries are
mirrored to `ExperimentJournalEntry`. Existing project ACL and layer guards apply
to creation, reads, review, exports and writes. A creator cannot self-approve.
Named team responsibilities are organizational; the implementation does not grant
Hossein, Sajjad, Kiarash or Ahmad permissions based on their names.

Uniqueness on creator/idempotency key and transactional user/project locks prevent
creation retry duplicates. A mismatched retry yields 409. The worker claims queued
runs atomically; there are no automatic provider retries. An interrupted run must
be reproduced as a new run, preserving uncertainty about potentially billed calls.

JSON, Markdown and formula-safe CSV exports include observations and history.
The browser print action supports PDF output; there is no server PDF renderer.
The UI links back to the existing project experiment journal. Sources remain in
run evidence snapshots; there is not yet a separate KnowledgeResource per citation.
Existing simulations are unchanged apart from a link to real-data analysis.

## Real observational computation

`lab-observations.html` computes unweighted linear/quadratic least squares from a
frozen NOAA GML Mauna Loa monthly CO2 snapshot, 2015–2020. Selection is chronological,
requires positive mean and nonnegative source uncertainty, and excludes interpolated
missing-uncertainty rows. It retains source URL, retrieval time, full-download hash,
original notes and selected source CSV. The hash is of the full retrieved CSV,
not the selected excerpt. Attribution: NOAA Global Monitoring Laboratory.

The calculation exposes centered/scaled coefficients, residuals, RMSE, source
uncertainty and extrapolation. Source uncertainty is not a fitted-model CI.
Seasonal residual patterns and temporal dependence invalidate simplistic inference.
This is neither protein stability data nor a validated forecast. Protein stability
remains a clearly labeled educational schematic, not molecular dynamics.

## Runtime controls

Default disabled: `SCIENTIFIC_LAB_ENABLED=0`. All writes retain CSRF protection.
Run creation quotas: 10 per user/rolling day, 25 per project/rolling day. At most
10 model calls per run, 1,600 output tokens each. Pricing must be configured via
existing `PULSAR_MODEL_PRICING_JSON` keyed by exact model identifier with
`input_per_million` and `output_per_million` numeric USD rates. Rates are frozen
into the protocol; missing pricing blocks queueing. A $0.50 estimated run ceiling
reserves a conservative UTF-8-byte input bound plus maximum output tokens before
each call. Estimates depend on correct operator rates and are not billing records.

The single-host systemd oneshot worker has 384 MB RAM, 50% CPU, 32 tasks and
25-minute runtime limits. Fixed-host retrieval has response size limits and timeouts;
no model-provided URL is fetched and redirects are disabled. No secrets reach the
browser. Cancellation stops future calls after the in-flight request returns.
A host lock bounds worker concurrency; PostgreSQL row locks prevent double claims.
Multiple worker hosts are not supported. Interruptions are not silently retried.

## Baseline and release gates

Inspected production main: `511f35b5abeca3fcd8731654e5f325e9dfe24c10`.
Reviewed PRs #255, #256, #257 and outstanding issue #193. PR #257 fixes live
CMS visibility suppression; this candidate does not change global CSS.

On 2026-10-25 the public `/lab.html` returned HTTP 200. Latest observed Backend
Error Monitor run `40169104205` failed at its service/journal check. Its logs only
show exit 1, not the matching traceback. Production Monitor run `40167720981`
succeeded. Neither result establishes authenticated application health.

**Do not merge to main while these release gates are unresolved.** Main's general
deploy workflow bootstraps/restarts services and is not a safe isolated Lab rollout.
Do not use green tests as permission to ignore the baseline incident.

1. Obtain read-only server traces for #193 and establish the current incident baseline.
2. Validate backend regression, migration, real-browser and authenticated acceptance.
3. Stage additive migration 0076 and code with the feature disabled; record current
   deployed SHA, migration state, database backup and service settings.
4. Install the supplied dedicated worker/timer units. Existing provider credentials
   are `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN`, or configured managed
   OpenAI/Anthropic/Gemini Pulsar credentials. Actual production credentials and
   pricing availability have not been inspected in this session.
5. Enable for a controlled pilot only after independent scientific protocol review.
   Execute bounded actual provider/retrieval trials; fixtures are not empirical QA.
6. Verify project authorization, persistence across reload, review, export, mobile,
   no hidden catalog cards, existing tasks/notes/auth and observed error baseline.
7. Only then broaden availability and report production URLs as working.

Rollback: disable `SCIENTIFIC_LAB_ENABLED`, stop only the Lab timer/worker, restore
the previous application/static release with the normal controlled backend reload.
Keep migration 0076 and research data; never migrate down or delete experiment data
as a rollback shortcut. No unrelated service restarts or production data rewrites.

## Remaining scientific/technical scope

This is not completion of the supplied full mission: production incident diagnosis,
safe deployment, live authenticated testing, actual model observations, independent
benchmark curation, named human scientific approval, dedicated evidence resource
linkage and OpenAlex remain unresolved. No screenshots/results from fixtures are
represented as production or empirical findings.

## Verification observed in this implementation session

- 921 Django tests passed on the initial implementation candidate. The 8 targeted
  Lab tests were rerun successfully after pricing/report additions.
- Django system check and migration drift check passed.
- Existing Topic 01 engine: 16 safety/numerical/determinism assertions passed.
- New OLS implementation reproduced exact linear and quadratic fixtures.
- Bounded live Crossref lookup for DOI `10.1038/s41586-021-03819-2` matched all
  supplied metadata fields; claim support was deliberately left unassessed.
- Live Europe PMC retrieval returned five records for the AlphaFold query.
- Local Chromium launch was blocked by the execution environment's socket
  restrictions; the headless-shell attempt also failed. No local screenshot or
  successful browser test is claimed. The dedicated CI workflow runs the real
  local Django/browser integration with fixture external services and preserves
  explicitly labeled QA artifacts. Its result must be checked before release.


## Follow-up verification, 2026-10-25 12:08 UTC

CI run 40191658997 passed 921 backend tests and the complete real Chromium +
local Django workflow, including CSRF, protocol approval, fixture worker outputs,
two human-review fixtures, report export, mobile overflow checks, NOAA controls,
and anonymous denial. All external experiment calls in this test are fixtures.
The mobile protocol hash wrapping issue was corrected. The NOAA test now reads
textContent for collapsed computation details rather than empty hidden innerText.

Read-only production run 40191739905 confirms Cloudflare Workers AI configured,
but no valid model pricing. OpenAI, Anthropic, and Gemini are not configured.
Required configuration before paid queue execution: PULSAR_MODEL_PRICING_JSON,
keyed by the actual configured Cloudflare model with input_per_million and
output_per_million USD rates. No rates or credentials were changed or guessed.
Migration 0075 is applied; 0076 was not applied at inspection time.

Read-only run 40191348393 showed active backend/Nginx/PostgreSQL, no recent
upstream 502/504 or access-log 5xx, and successful bounded full-middleware read
probes for task 726 and the principal project 208 panels. External datasets
returned 409; 37 generic traceback signatures and historical Nextcloud locks
remain in the aggregate diagnostics. This is a current baseline, not closure of
issue 193 or a long-term latency guarantee.

The isolated release workflow packages 19 allowlisted application/static files,
checks exact prior production hashes, creates a restricted consistent pg_dump
and file backup, applies only additive migration 0076, and gracefully reloads
only the backend. It installs but does not enable the dedicated worker. The
feature remains disabled. Any application failure restores only changed code;
additive schema and research data remain. Main's general deploy must not run
for this release: merge only the CI-verified candidate with [skip ci], then
manually dispatch Scientific Lab isolated release on main. Never infer a live
empirical workflow from this disabled first release.
