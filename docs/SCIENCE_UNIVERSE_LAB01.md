# Lab 01 · Science Universe
## First topic: Is AI reliable in scientific research?

Implementation: `lab-sources/science-universe/`. This is a **synthetic** educational research-system simulation, not a trained AI model, empirical scientific benchmark, or proof of global scientific behavior.

### What is genuinely implemented
- 28 research laboratories across biology, climate, physics and materials; each has an independent research budget, methodology, AI adoption, active tests and publication history.
- More than 100 seeded researcher / AI agent proxies. Agent actions use explicit stochastic policies; *no external model is called to generate hypotheses.*
- Generated hypotheses carry hidden, sampled Boolean truth and effect size. Tests use a documented illustrative power function and configurable type-I error / analytical flexibility. Positive results queue for peer review; rejected or published papers affect a shared publication state.
- Publication is not truth: peer review has modelled error, independence is fallible, and rejected replications can trigger a simplified withdrawal policy. Actual domain-specific validation does **not** occur here.
- Collaboration links are recomputed when laboratories are repositioned. Citations diffuse using network proximity, domain and publication attention.
- User can inspect every lab, allocate central funding, train methodology, pause idea generation, manually request replicability checks, and drag nodes to change collaboration topology.
- Twelve policy parameters, a live simulated timeline, model event stream, research-network and knowledge-flow visualization, scientific status counters, and experimental evidence plots.
- World B forks a full snapshot of World A, including RNG state, with modified review/replication defaults. Both worlds can evolve side by side with independent policy edits, exposing simulated counterfactual differences.
- Users can control by mouse, touch and keyboard. The simulation is local in the browser. It never reads user files, calls scientific databases or stores personally identifiable visitor data.

### Pulsar
The model reports bounded numeric metrics and semantic events using `GraviLab.emit()`:
- `world_started`, `hypothesis_generated`, `paper_published`, `review_rejected`, `replication_failed`, `replication_passed`, `paper_retracted`.
- `policy_changed`, `funding_changed`, `replication_requested`, `collaboration_changed`, `universe_forked`, `world_reset`.

The Lab Studio manifest supplies seven teaching sections, 13 short scripted explanations and scientific concepts for contextual Pulsar coaching. The platform already throttles live model commentary and falls back to honest scripted hints if the provider is unavailable.

### Authoring / deployment
Source files: `index.html`, `styles.css`, `engine.js`, `app.js`; editor metadata: `manifest.json`.
During standard backend deployment an idempotent Django management command imports the authored package only as **draft** (`published_version=0`, `studio_enabled=False`). Existing drafts are left unchanged, and the CLI only selects an existing active superuser as owner. It never publishes or modifies existing Labs. If the production database has no active superuser, the command safely skips import.

Manual import, if needed:
```
python -m django install_science_universe_lab --auto-owner --apply
```
Admin path: `/workspace/core/admin/labs`. Select **Science Universe — The Discovery Engine**, preview the draft, then explicitly publish after reviewing the scientific assumptions and user experience.

### Validation / publication gate
- Run `node scripts/test-science-universe.cjs`: deterministic RNG, identical forks, tested/rejected/publication invariants, citations, interventions, policy bounds and metadata.
- Run `node scripts/test-science-universe-browser.cjs` using Playwright Chrome for desktop/mobile controls, interventions, double-world comparison, scroll overflow, and runtime errors.
- Run `python -m django test core.test_science_universe_install` for draft ownership, code paths, idempotency and no accidental publish.
- Scientific owner should review the null/alternative probability model, conditional biases, peer-review assumptions and withdrawal logic. Research Topic 01 / public Topic 01 numbering is inconsistent; do **not** attach the Lab to a mismatched public Topic slug.
- This pilot is a computational educational model. Do not describe the synthetic false-claim rate as an empirical rate, and do not claim true causal effects on the real science community.
