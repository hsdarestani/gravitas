# Pulsar daily reports: Cloudflare-first matching with optional OpenAI Decisions

Pulsar keeps Cloudflare Workers AI and the existing multi-provider `ModelGateway` for interpretation. The matching layer uses existing **Cloudflare Workers AI** when no OpenAI key is configured, and optionally uses the real **OpenAI Decisions API** (`POST /v1/decisions`, `gpt-6-luna`) when an OpenAI key is configured. Both operate on ACL-filtered task IDs and support `none`. Cloudflare's normal chat-model inference is NOT the dedicated OpenAI Decisions endpoint or Jev/System One router.

## Configuration

- `PULSAR_OPENAI_API_KEY`: existing managed OpenAI credential; used automatically if available.
- `PULSAR_REPORT_DECISIONS_API_KEY`: optional dedicated Decisions credential (takes precedence).
- `PULSAR_REPORT_DECISIONS_ENABLED`: `true` by default when either Cloudflare Workers AI or OpenAI Decisions credentials are configured; set `false` to disable without redeploying. **No OpenAI key is required** for Cloudflare matching.
- `CLOUDFLARE_AI_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN`: existing configured Cloudflare Workers AI credentials reused without modification.
- With a valid OpenAI key, the dedicated OpenAI Decisions API takes precedence. If its request fails, the matcher tries Cloudflare.
- Cloudflare returns conservative categorical labels (not calibrated Decisions API probabilities); a proposed match must also pass deterministic two-word task-title evidence checking.
- `PULSAR_REPORT_DECISIONS_TIMEOUT`: default 8 seconds (capped to 4–12).
- `PULSAR_REPORT_DECISIONS_MIN_CONFIDENCE`: default 0.88.
- `PULSAR_REPORT_DECISIONS_MIN_PROBABILITY`: default 0.88.
- `PULSAR_REPORT_DECISIONS_MIN_MARGIN`: default 0.25 (top probability minus runner-up).

These are environment variables or Django settings (Django settings take precedence). API credentials must only be stored server-side.

## Data flow and safety

1. Keep the existing `interpret()` model to extract activities (Cloudflare/other configured providers).
2. Filter task catalog to the reporter's project and task permissions.
3. Restrict candidate generation to a six-task shortlist per unmatched activity, ignoring single generic-word overlap.
4. Use one batch of bounded questions: OpenAI Decisions API if authorized; otherwise the existing Cloudflare Workers AI model. Both may choose `none`.
5. Accept OpenAI answers only with authorized task IDs and calibrated confidence, probability, and margin thresholds. For Cloudflare, require high-certainty exact-deliverable classification and at least two independent title-term overlaps (not self-reported numerical probabilities). Never auto-link the same task twice in a proposal.
6. Preserve reported work unlinked on failure, refusal, malformed response, missing key, or low confidence.
7. Prevent AI-inferred matches from automatically proposing status mutations; require the user to name the exact task ID for a proposed status change. Every report still requires confirmation and uses existing ACL, task revision, transaction, and idempotency checks.
8. Telegram preview displays compact evidence and only Confirm/Edit/Cancel buttons. Old explicit-link callbacks remain accepted for backwards compatibility but are not offered as noisy suggestions.
9. Three website video variants may be **grouped visually** only if they have the same task link. Original activities remain individually stored.

The reporter's task shortlist and free-text activity are sent to whichever provider actually performs the match: the existing Cloudflare Workers AI by default in Cloudflare-only deployments, or OpenAI if an OpenAI API key is configured. Confirm your organization's data-sharing requirements before enabling either route.

## Tests

Run the project test suite, including:

`python -m django test core.test_pulsar_openai_decisions core.test_work_reports`

Cases cover: actual `/v1/decisions` payload shape, Cloudflare-only matching without OpenAI credentials, allowed candidate IDs, `none`, uncertainty, network outages, disabling the feature, concise previews, three video variants, stale confirmation and idempotent reporting.

Rollout: execute tests and evaluation examples before merging; verify the existing Cloudflare runtime and any optional OpenAI credentials separately. Unit tests use mocked AI responses, not a live credential.
