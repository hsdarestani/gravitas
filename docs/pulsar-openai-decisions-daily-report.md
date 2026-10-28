# Pulsar daily reports: OpenAI Decisions API routing

Pulsar keeps Cloudflare Workers AI and the existing multi-provider `ModelGateway` for interpretation. The optional bounded **OpenAI Decisions API** (`POST /v1/decisions`, `gpt-6-luna`) only selects an existing task ID for ambiguous daily activities, using a fixed candidate set and an explicit `none` option. This is **not** the existing Jev/System One `DecisionRouter`.

## Configuration

- `PULSAR_OPENAI_API_KEY`: existing managed OpenAI credential; used automatically if available.
- `PULSAR_REPORT_DECISIONS_API_KEY`: optional dedicated Decisions credential (takes precedence).
- `PULSAR_REPORT_DECISIONS_ENABLED`: `true` by default when an OpenAI key exists; set `false` to disable without redeploying. Without a key the system preserves unmatched reports.
- `PULSAR_REPORT_DECISIONS_TIMEOUT`: default 8 seconds (capped to 4–12).
- `PULSAR_REPORT_DECISIONS_MIN_CONFIDENCE`: default 0.88.
- `PULSAR_REPORT_DECISIONS_MIN_PROBABILITY`: default 0.88.
- `PULSAR_REPORT_DECISIONS_MIN_MARGIN`: default 0.25 (top probability minus runner-up).

These are environment variables or Django settings (Django settings take precedence). API credentials must only be stored server-side.

## Data flow and safety

1. Keep the existing `interpret()` model to extract activities (Cloudflare/other configured providers).
2. Filter task catalog to the reporter's project and task permissions.
3. Restrict candidate generation to a six-task shortlist per unmatched activity, ignoring single generic-word overlap.
4. Send one batch Decisions request with independent `choice` questions and a `none` option.
5. Accept an answer only if its task ID appears in the authorized shortlist and its confidence, probability, and margin all pass their thresholds. Never allow two activities to auto-link the same task in a single proposal.
6. Preserve reported work unlinked on failure, refusal, malformed response, missing key, or low confidence.
7. Prevent AI-inferred matches from automatically proposing status mutations; require the user to name the exact task ID for a proposed status change. Every report still requires confirmation and uses existing ACL, task revision, transaction, and idempotency checks.
8. Telegram preview displays compact evidence and only Confirm/Edit/Cancel buttons. Old explicit-link callbacks remain accepted for backwards compatibility but are not offered as noisy suggestions.
9. Three website video variants may be **grouped visually** only if they have the same task link. Original activities remain individually stored.

The reporter's task shortlist and free-text activity are sent to OpenAI when this feature is enabled. Confirm your organization's data-sharing requirements before enabling it.

## Tests

Run the project test suite, including:

`python -m django test core.test_pulsar_openai_decisions core.test_work_reports`

Cases cover: actual `/v1/decisions` payload shape, allowed candidate IDs, `none`, uncertainty, network outages, disabling the feature, concise previews, three video variants, stale confirmation and idempotent reporting.

Rollout: execute tests and shadow/evaluation examples before merging; verify live key access and worker environment configuration separately. No live OpenAI request or production deployment is included in this branch.
