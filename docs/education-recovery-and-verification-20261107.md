# GraviQuest Education — recovery and implementation

## Recovered baseline

Work continues from `main` at `110b9d98229cafeb03b2be066bd10601b29d9b90`, not from a new site.

The repository was cloned with its remote branch history. Relevant Education/Learning/Pulsar pitch branches and all Education file history were inspected, together with open PRs. The latest relevant branch, `feature/pulsar-guided-interaction-showcase-20261103`, has identical Education files to main. Older pitch branches contain earlier stages of the already merged implementation, not an unfinished inclined plane or multi-discipline catalog. No prior checkout or uncommitted Education files were found in the accessible workspace. Work that existed only in the interrupted session's inaccessible filesystem cannot be recovered or ruled out.

| Previous PR | Confirmed merged result |
| --- | --- |
| [#322](https://github.com/hsdarestani/gravitas/pull/322) | Original independent nine-chapter German partner landing; `7dbbe12e` |
| [#323](https://github.com/hsdarestani/gravitas/pull/323) | Separate English/German pages and language navigation; `63fc0655` |
| [#324](https://github.com/hsdarestani/gravitas/pull/324) | Shared Education stylesheet, canonical brand tokens, theme and responsive shell; `8211f34d` |
| [#325](https://github.com/hsdarestani/gravitas/pull/325) | Pulsar × Simulation product positioning, six discipline concepts, removal of public price; `c465fba0` |
| [#326](https://github.com/hsdarestani/gravitas/pull/326) | Scripted constant-net-force cart lesson: prediction, comparison and reflection; `53d248f9` |

The baseline cart was functional but had no free-form input or live service integration. The six discipline cards described potential future models; they did not open working demos. No advanced incline, CS/IT, sociology or neuroscience demo was present.

## Reused and preserved

- Both existing pages, all nine chapter anchors, header, footer, contact route, presentation/print controls, official fonts/logos, dark/light theme and `assets/education.css`.
- The original cart markup and unchanged `assets/education-pulsar.js`; the cart is now an expandable secondary lesson in the same page.
- Existing public `/api/pulsar/ask/` endpoint and its existing provider gateway. No new key, endpoint, backend model, migration or account flow.
- Existing production deployment workflow and fail-closed release classification. No workflow bypass or direct production file edits.

## Implemented

New, scoped assets separate pure deterministic models, shared bilingual content, studio UI and styles. The existing landing's demo chapter, catalog and readiness/comparison chapter are updated in both languages.

Every new demo has adjustable inputs, computed chart and readings, a prepared one-variable experiment, a prediction, frozen A/B evidence, explanation, reflection prompt and optional free-form Pulsar conversation. Physics includes four scenarios; the other eight include one each (12 new scenarios total, plus the retained original cart).

| Demo selector | Model and numerical method | Main boundaries |
| --- | --- | --- |
| `physics` | Inclined plane with static force balance, kinetic friction, exact release-from-rest kinematics; five controls, force/component vectors, acceleration/velocity arrows, play/pause/rewind | Fixed 12 m plane; parameter edits release from rest; no drag, rotation or deformable contact; μₖ ≤ μₛ |
| `chemistry` | Analytical closed first-order A ⇌ B relaxation | Isothermal, well-mixed; independent rate constants; no molecular/temperature model |
| `mathematics` | Logistic map; 80 iterations; two initial values separated by 10⁻⁶ | Deterministic double precision; finite-run divergence is not a general proof of chaos |
| `finance` | Monthly nominal compounding and end-of-month deposits; annual inflation discount | Abstract currency units; fixed rates; no taxes, fees, risk or forecasts |
| `biology` | Normalized closed SIR; RK4 with 0.1-day step, 160 days | Homogeneous mixing, permanent immunity; no demographic or clinical prediction |
| `engineering` | Exact free spring–mass–damper response for under/critical/overdamping | Linear, one dimension, x₀=1 m, v₀=0; damping ratio fixed while c follows m and k |
| `computing` | Seeded discrete-event M/M/1 FCFS queue; theoretical stationary waiting time where stable | Empty start, 60-second arrival window, exponential service, unlimited buffer; finite sample differs from expectation |
| `sociology` | Seeded 18×18 Schelling-style lattice; bounded eight-neighbour rule and random sequential cell visits for 35 sweeps | Two abstract types, vacancies, no demographic meaning or empirical social prediction; no guaranteed convergence |
| `neuroscience` | Exact constant-current leaky integrate-and-fire trajectory and event times | One neuron, fixed resistance/rest/reset/threshold; 2 ms refractory interval; symbolic spike markers |

### Conversation contract

Sending is explicit. The request includes the learner's question, locale, bounded recent conversation and a text-serialized snapshot of current parameters, readings and assumptions. The frozen prepared A/B experiment is separately identified so it is not confused with later exploration. This uses the existing API's `message`, `history`, `page`, `page_context`, `thread_id` and `locale` contract without changing shared backend behavior.

Prepared lessons are labeled **local**. Model-provider responses are labeled **live AI**. `fallback` and `public_navigation` are service messages, never live AI. HTTP errors, empty responses, timeout and cancellation remain visible and retryable; no generated-looking scripted answer substitutes for a failed live request. User/model text renders using `textContent`, and never executes simulation changes. Switching disciplines aborts stale requests. The simulation does not depend on network availability.

### Competitor review

Reviewed official sources on 7 November 2026:

- [PhET](https://phet.colorado.edu/en/) and its [guided-inquiry activity guidance](https://phet.colorado.edu/nl/teaching-resources/virtual-workshop/science-activity-design): research-informed exploration and teaching resources. Avoid reducing inquiry to instructions that reveal every answer.
- [ExploreLearning Gizmos](https://www.explorelearning.com/our-products/gizmos): structured inquiry, investigations, formative feedback and classroom implementation materials. Guided simulation is already established; it is not a novelty claim.
- [Labster's Dr. One](https://www.labster.com/blog/meet-dr-one): contextual prompts and guidance inside virtual labs. A tutor beside a simulation is not exclusive to GraviQuest.
- [Khanmigo](https://www.khanmigo.ai/): conversational reasoning support integrated with learning content. Conversation alone is not a sufficient differentiator.

The resulting GraviQuest direction is specific and demonstrable: one visible loop connecting the learner's prediction, one controlled model change, frozen numerical evidence, editable exploration and questions grounded in the exact model snapshot. This is a product-positioning judgment, not an assertion that competitors lack comparable features or that GraviQuest has proven better learning outcomes. A concise sourced comparison is published in both landing pages.

### Scientific background

The code is an independent implementation of the stated equations and update rules; no third-party simulator source or artwork was copied.

- [OpenStax: force equations and inclined-plane normal force](https://openstax.org/books/university-physics-volume-1/pages/5-key-equations).
- [OpenStax: friction and inclined-plane forces](https://openstax.org/books/college-physics/pages/4-5-normal-tension-and-other-examples-of-forces).
- [OpenStax: dynamic chemical equilibrium](https://openstax.org/books/chemistry-2e/pages/13-1-chemical-equilibria).
- [OpenStax: damped oscillations](https://openstax.org/books/university-physics-volume-1/pages/15-5-damped-oscillations).
- Kermack & McKendrick (1927), [A contribution to the mathematical theory of epidemics](https://doi.org/10.1098/rspa.1927.0118); the implemented closed normalized SIR is a deliberately restricted teaching model.
- [MIT: single-server queueing](https://www.mit.edu/course/other/urban_or_book/www/book/chapter4/4.6.1.html).
- [Northwestern NetLogo: Segregation Simple](https://ccl.northwestern.edu/netlogo/models/SegregationSimple), conceptual background only; this demo uses its own bounded-grid implementation and explicit relocation rule.
- [Gerstner et al.: integrate-and-fire models](https://neuronaldynamics.epfl.ch/online/Ch1.S3.html).

## Verification

- `npm ci --prefix scripts/education --no-audit --no-fund`
- `npm test --prefix scripts/education`: 20 passing tests, covering analytic references, conservation, extrema, determinism, thresholds, all 12 scenarios in both languages, old cart regression, API payloads/history/locale, safe text rendering, fallback/failure/cancel states, deep links and frozen evidence.
- Existing four simulation suites: 27 passing tests.
- Existing Django `core.test_public_pulsar_api`: 11 passing tests.
- New path-scoped GitHub Actions validation repeats the model/UI checks and existing simulation regressions on PRs and main.
- Real Chrome review uses the actual pages in 375, 768 and 1440 px iframe viewports in both languages. No document-level horizontal overflow; phone/tablet stack, desktop columns. All nine demos' prediction/comparison flows were exercised in both languages at phone width.
- Real animation reached 12.00 m at 2.73 s with v=8.79 m/s for θ=35°, m=2 kg, g=9.81 m/s², μₛ=.45, μₖ=.30; rewind restored the initial state. Light/dark controls also checked.
- Live pre-release API probe returned `cloudflare-workers-ai`, run `a628c522b9bf425eb414519c51fa3aca`, correctly distinguishing static friction 6.71 N from its 8.30 N maximum. This is one observed response, not a comprehensive assessment of answer quality.

The initial release [PR #331](https://github.com/hsdarestani/gravitas/pull/331) passed all PR CI and deployed as `25c3e285f0bb5ad5e62dea8c7e8da3dfe8149ce9` in [production run 42403043870](https://github.com/hsdarestani/gravitas/actions/runs/42403043870). The full readiness suite ran 1,122 tests successfully (2 skipped). The production model, catalog, studio JS/CSS, original cart JS and original shared Education CSS matched repository bytes. Both pages served HTTP 200. Chrome confirmed all nine English production demos loaded with computed readings.

Post-deploy acceptance exposed an actual live-answer error: a generated explanation inferred kinetic friction and motion from a force below the static maximum, despite a=0. This was not a numerical-model error. The follow-up explicitly supplies categorical motion state, friction regime and its balancing rule, repeats a human-readable reference at the end of the request and displays independently computed reference values beside each answer. The reply remains labeled live AI; the reference remains separately labeled model data. This reduces ambiguity and makes checking possible; it does not certify arbitrary generated answers.

The updated full request was tested against the existing live production endpoint in both languages. Run `bee2b3ec487346a0a982a27e61e32913` correctly described static balancing and zero acceleration in English; run `35a6d8a7bad2405d818627586e47f09e` correctly described the same state in German. Regression checks now assert the categorical regime, independent visible reference and complete request bounds for every demo with the maximum question length and a frozen A/B comparison. No backend or model-provider settings were changed.

Local tests with mocked responses do not count as live API verification. Follow-up deployment acceptance is recorded with its PR.

## Test routes

English: `https://graviquest.com/education.html?demo=SELECTOR#erleben`.
German: `https://graviquest.com/education-de.html?demo=SELECTOR#erleben`.
Use the nine exact selectors in the model table. The original cart remains under `#cart-preview`; expand the disclosure. Competitor review: `#comparison`.

## Remaining evaluation

No learner-outcome study, independent domain sign-off or empirical calibration is claimed. Live reply quality/availability is a dependency of the existing Pulsar service. Cross-visit or cross-device chat persistence and instructor analytics are not added; this landing keeps recent conversation in page memory and leaves those existing platform concerns untouched.
