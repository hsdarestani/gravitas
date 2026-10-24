# Topic 01 Lab pilots — isolation and staged rollout

Status: browser-only implementation on feature branch. No backend migrations, Django URL changes, secrets, runtime package installs or deployment scripts are touched.

## Delivered

- `lab-protein-stability.html`: adjustable temperature/time/midpoint/width, schematic projection of a 3D chain, dynamic SVG stability plot, clear 50 °C evidence boundary and synthetic practice observations. This is a two-state education model, **not molecular dynamics**.
- `lab-prompt-bias.html`: paired seeded Monte Carlo simulation of question framing. Underlying probabilities are explicit assumptions, **not measured LLM agreement**.
- `assets/labs/engine.js`: deterministic shared computation, bounded inputs, reproducible random seed.
- `assets/labs/protein.js`, `assets/labs/bias.js`: browser rendering, JSON export and explicitly local-only save.
- `assets/labs/labs.css`: page-scoped CSS. The public global stylesheet and workspace styles are not modified.
- `lab.html`: two links, preserving the rest of the gallery.
- `scripts/test-topic-01-labs.cjs` and a targeted GitHub Actions workflow: numerical, reproducibility and basic page-asset checks.

## Load and safety properties

- All calculations run in the visiting browser. Nothing runs in Gunicorn, PostgreSQL or Nextcloud when manipulating sliders.
- No AI provider requests, external network dependencies or code evaluation.
- Only explicitly authored static JS is executed; these pages do not accept user-uploaded scripts.
- The client export feature is intentionally standalone; saved runs are localStorage-only (maximum twelve per lab), not research records.
- The feature is initially a draft PR; publishing should be done only after CI and normal release smoke checks.
- Performance and usability checks should cover mobile viewport, keyboard slider navigation, reduced motion, plot rendering, export content and many successive runs.

## Before production

1. Run `node scripts/test-topic-01-labs.cjs` and the scoped Actions workflow.
2. Check baseline production: signed-in workspace bootstrap, Projects, Research Experiments, Nextcloud Notes, public Lab and normal Pulsar chat. Capture current HTTP 500/502 metrics.
3. Review PR diff for scope: no database, server, auth or deployment configuration changes.
4. Merge only after green status checks; the normal main workflow is a **full deployment**, so even static changes require careful release monitoring.
5. Immediately after deployment, open both pages, vary sliders and verify JSON export. Recheck baseline authenticated routes, response rates and Nginx/Gunicorn logs. If metrics regress, roll back the merge rather than changing production databases.
6. Do not claim "zero risk" or global 500/502 elimination. The existing platform has had independent operational incidents.

## Next phase, separately reviewed

Real AI bias comparisons require a dedicated rate-limited experiment endpoint, per-user quotas, asynchronous worker, API cost limits, provider/temperature version capture, independent grading and consent/privacy review. Scientific Python or molecule dynamics requires isolated compute rather than running arbitrary code within Django web workers. Public CMS-uploaded Lab code needs stronger same-origin separation before opening arbitrary user content. These are **not** part of this zero-backend-change PR.

Scientific review: assign to the Topic 01 scientific reviewer before presenting pedagogical assumptions as scientific claims.
