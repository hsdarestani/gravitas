# Science Universe — scientific model rationale, inventory and review contract

**Status (29 Oct 2026):** Agent-based **teaching model** with a mathematically grounded Gaussian statistical submodel. **NOT** empirically calibrated, externally validated or suitable for forecasting actual scientists. This is a living model decision log, not scientific certification.

## 0 · The first reason must be the research question

Original Research Topic 01 asked **“Is AI reliable in scientific research?”** Its original [Trust Test](../research/topics/ai-reliable-in-scientific-research/08-simulation.md) focused on evidence grounding, independent verification, uncertainty, distribution shift and accountability.

Science Universe currently studies a **different, related** question: *under explicit assumed conditions, how can increased AI-assisted hypothesis throughput interact with sampling error, manuscript review capacity, publication bias, independent replication and correction?*

**Science lead decision pending:** Is an ecosystem simulation necessary for Topic 01? Which specific hypotheses and evaluation patterns make it fit for purpose? Do not quietly claim to simulate all five original Trust Test dimensions.

## 1 · Inclusion rule: no unaccountable model choices

Every consequential mechanism, parameter, data assumption, user intervention and metric must have:

1. **Question:** why it is needed for the exact learning/research goal.
2. **Definition and units:** what changes, what is measured and what its scale means.
3. **Mechanism:** equation, update order and accessible evidence.
4. **Basis:** formal derivation, verified literature or explicit design hypothesis.
5. **Alternatives:** competing defensible assumptions and simpler models.
6. **Sensitivity or validation:** expected patterns, meaningful perturbations and rejection criteria.
7. **Owner/status:** who approved it and whether independently validated.

Classifications: **theory-grounded mechanism**, **testable hypothesis**, **engineering/display decision**, **uncalibrated assumption**. A paper supporting an idea does **not** support arbitrary numbers inserted into the code.

The single Lab provides an interactive **Model assumptions → Decision register** explaining its high-impact choices and 12 controls, with sources and alternatives. Its input controls can change lab population, team size, initial AI fraction and assumed base truth probability. A 3/7/14-labs-per-field × 6-seed audit reports model-internal stability; **six seeds are illustrative, not a precision estimate**.

## 2 · ODD-style overview and implementation map

- **Purpose:** explore mechanisms, not predict research communities.
- **Entities:** 4 named domains as illustrative categories; a configurable number of labs in each (default 7; total 28), research proxies (default 3–5 agents per lab, ~48% AI role initially), hypotheses, manuscript queue, papers, repeat tests, citations, central research-credit pool.
- **Scheduling per model day:** replenish credits → probabilistic idea generation → complete ready experiments → review submitted significant manuscripts → replicate due papers → periodically simulate citations and record history.
- **Scale:** “day” is a discrete computational tick, not a calibrated actual-day duration. Credits are synthetic units.
- **Initialization:** deterministic seeded xorshift32; defaults are deliberately illustrative rather than observed research census data. Model may be rerun with other lab populations/priors.
- **Interaction:** choose a lab; allocate synthetic credits; invest in methods; request a repeat test; reduce idea production; move a node to explicitly edit its simulated network links. Map coordinates are **not** an empirical geography.
- **Counterfactuals:** Fork creates an exact copy, including random state; no automatic +3/+3 intervention is applied. Change **one** policy in World B if estimating its standalone simulated effect; use many paired random seeds for generality *within this model*.
- **Observed outputs:** hypothesis and publication counts; currently surviving false claims (known only to the synthetic engine); repeat-test count; withdrawn publications; review/replication queues; simulated citation events. A repeat test is not automatically a confirmed true discovery.

## 3 · Derived statistical core (genuinely grounded in probability)

True hypotheses have assigned hidden effects; null hypotheses have effect 0. The **generation of truth and effect-size distribution remains hypothetical**, even though testing uses standard probability theory.

Given a *known-variance* two-sided normal model:

`Z = sqrt(n_effective) × theta + epsilon`, where `epsilon ~ N(0,1)`.

`p = 2 × [1 − Phi(|Z|)]`. Significance if `p <= alpha`.

When no true effect exists and there is only one prespecified analysis, the false-positive probability should match alpha. Increasing sample size increases power for nonzero effects. Multiple independent analyses with selection of the smallest uncorrected p can increase family-wise false-positive rates.

**Assumptions still in the formula:** `alpha=clamp(.005×2^(.43×alphaPolicy), .007, .18)`; `n=18+16×sampleSizePolicy` multiplied by method/replication factors; per-field synthetic base priors .28/.36/.31/.42; positive effects drawn uniformly .24–.92. These numerical choices **do not come from the cited literature**. They must be varied and, if empirical interpretation is intended, calibrated.

Relevant theory: [Ioannidis (2005)](https://doi.org/10.1371/journal.pmed.0020124); [Simmons et al. (2011)](https://doi.org/10.1177/0956797611417632).

## 4 · Peer review no longer sees hidden truth

Earlier v2 review probabilities explicitly branched on `h.truth`, giving model reviewers privileged access to the outcome being judged. That was unrealistic.

The updated review stage uses only **observable** simulated manuscript signals: documented method quality, preregistration/registered plan flag and number of disclosed analyses. A model “review rigor” adjustment, publication pressure and finite FIFO capacity influence decisions. **True/false ground truth cannot directly alter acceptance.** Hidden truth is retained only for generating data and evaluating simulated accuracy.

**Still uncalibrated:** the synthetic quality distribution, the relative weighting of visible review signals, capacity slope and reject-probability constants. This is an epistemically safer mechanism, not a validated empirical model of real journals. Independent reviewer disagreement, hidden flexibility, domain expertise and institutional incentives are not fully modeled.

**Test invariant:** clone identical manuscript queues and PRNG state; flip only the hidden truth flag; peer review accept/reject outcomes must remain identical.

## 5 · Other mechanism families: WHY and current evidence quality

| Element | Current decision | Actual reason/status | Needed scientific check |
| --- | --- | --- | --- |
| 4 domains | Biology, Climate, Physics, Materials | Visual categories; **no representative-sampling claim** | Choose domain scope from the research question |
| 28 labs | 7 per domain | Legible network size, **not scientific optimum** | 12/28/56+ lab sensitivity with normalized outcomes |
| 3–5 agents / 48% AI | Synthetic roles, fixed toy defaults | Illustrate mixed actors; **uncalibrated** | Vary populations, AI roles and throughput separately |
| Domain true-claim priors | .28/.36/.31/.42 | Illustrate pre-study odds; **no measured domain ranking** | Empirical calibration or use neutral common prior |
| Effect sizes | Uniform .24–.92 for true effects | Simple heterogeneous examples; **no domain-based estimation** | Compare distributions/heterogeneity |
| Peer review | Finite FIFO capacity, observables-only rejection | Real concepts, **invented response coefficients** | External empirical studies and reviewer sensitivity |
| Replication and retraction | Fresh sample; one/two failed repeats can retract | Independent evidence grounded; **retraction decision arbitrary** | Journal-process model and replication datasets |
| Funding | Inflow 6+3×policy, up to 65% distributed | Budget scarcity example; **numbers arbitrary** | Resource constraints from empirical settings |
| Spatial network | Displayed closeness affects collaboration | Editable toy graph, **not empirical research geography** | Separate layout from actual modeled ties |
| Citations | Popularity, same-field and proximity weights | Attention/diffusion hypothesis, **weights uncalibrated** | Citation-graph fit and network null models |
| A/B fork | Exact saved state including RNG | Controlled computational comparison | Vary one rule at a time; paired multi-seed analysis |
| 12 sliders | Core model mechanism families | UI grouping, not canonical scientific taxonomy | Define units and defend inclusion via Topic 01 |

These rules are documented in `lab-sources/science-universe/engine.js`. User-facing detailed rationales are in `lab-sources/science-universe/app.js` under `DECISION_REGISTER` and `POLICY_RATIONALE`.

## 6 · Why 12 controls? Explicit mechanism categories

- **Hypothesis production:** generation, AI adoption, AI abstention, exploration diversity — hypothetical behavioral mechanisms.
- **Evidence quality:** alpha and sample size — theoretical concepts, but their **slider mappings are invented**.
- **Scientific verification:** peer review, independent replication, transparency — real conceptual distinctions; quantitative capacities and effects are assumptions.
- **System incentives/resources:** funding and publication pressure — plausible constraints, not measured coefficients.
- **Knowledge diffusion:** network attention — plausible graph mechanism, not validated citation prediction.

The number **12** follows the chosen software design; neither science nor ODD mandates it. If a control cannot be linked to a required mechanism and tested, it should remain optional for teaching or be reconsidered by the scientific owner.

**Removed misleading unused attributes:** Agent `creativity`, laboratory `caution` and an unmaintained laboratory `verified` field previously appeared in initialized state but did not influence research behavior or recorded evidence. They have been removed rather than implying nonexistent dynamics. If those concepts are later reintroduced, they need explicit operational mechanisms, test cases and rationale.

## 7 · Pulsar's role and provenance

Pulsar is a contextual teacher inside the one Lab through GraviQuest's common public coaching backend. Branded chat, timestamps and device-local history improve continuity; proactive guidance is intentionally limited. Responses may be **live model-generated** or explicitly labeled **scripted fallback**. Model metrics from the browser are not independently authenticated. It must explain assumptions, methods, sources and possible tests, never invent actual experiments or claim that a paper validates chosen coefficients.

## 8 · Quality gates before empirical claims

1. **Sajad accepts the purpose:** explain the relationship (or separation) between Topic 01's Trust Test and the ecosystem model.
2. **Parameter provenance matrix:** every coefficient, prior, cost, review/citation rate and latency has a justification and owner; mark as uncalibrated until measured.
3. **Statistical checks:** null Type I error, power vs sample size, multiple testing error and independently reproducible results.
4. **Structural checks:** reviewer outcome invariant to hidden truth, deterministic clone, no unnoticed two-policy fork, safe source publication, and non-inferential explanations for display geometry.
5. **Sensitivity:** at least population, agent composition, prior odds, effect sizes, incentive/review/citation strengths; multiple random seeds, uncertainty intervals and design alternatives.
6. **External evaluation:** choose a coherent dataset and independently check target patterns; **OpenAlex citation counts alone do not establish ground truth**.
7. **Independent scientific sign-off:** only after comparative, calibration, and reproducibility evidence may the model be described as empirically informative; generalization is still scoped.

## Sources and standards

- [Grimm et al. (2020), ODD protocol: including model design rationale and evaluation criteria](https://doi.org/10.18564/jasss.4259)
- [Ioannidis (2005), pre-study odds and false published findings](https://doi.org/10.1371/journal.pmed.0020124)
- [Simmons, Nelson & Simonsohn (2011), analytical flexibility and false positives](https://doi.org/10.1177/0956797611417632)
- [Open Science Collaboration (2015), replication evidence](https://doi.org/10.1126/science.aac4716)
- [Smaldino & McElreath (2016), incentives and research practice](https://doi.org/10.1098/rsos.160384)
- [Original Topic 01 Trust Test](../research/topics/ai-reliable-in-scientific-research/08-simulation.md)

**Scientific status:** Theory-grounded in a bounded statistical submodel; overall ecosystem claims are still hypothesis-driven and uncalibrated. Rationale transparency is necessary, **not sufficient**, for scientific validity.


## Interdisciplinary interpretation

Exploration diversity controls the probability of a candidate topic being sampled outside its laboratory's specialty. A novel topic may still belong to the original field. Measure actual topic field versus laboratory field, not the novelty flag alone. Default field-specific truth priors also change with diversity; therefore a comparison confounds topic mixing with an assumed prior shift unless a common prior is chosen. The model does not provide an empirically validated interdisciplinarity bonus. Cross-field study counts refer to retained hypotheses; old rejected hypotheses may be pruned after the engine retention limit. Live cross-field publications remain available.

## Live graph semantics

**Laboratories** shows actual laboratory nodes, sized by active studies with a display cap. Stationary small marks identify actual team members (gold AI roles, blue human roles); their placement is for readability, not a work-rate measure. Blue collaboration edges join the same field and violet edges cross fields. All collaboration edges use the same width: the old distance-based width was not an additional causal weight in citation selection. A grey laboratory has proposal generation reduced to 17% of its usual chance, not completely stopped.

**Knowledge flow** shows up to the latest 180 live published claims in topic-field lanes, horizontally ordered by publication day and placed into nearby free display slots to keep dots apart. Select a dot, or choose a claim from the accessible selector, to reveal retained citation arrows from the citing laboratories at the left to that paper. This focused display avoids drawing every citation at once. The engine retains at most 120 citation events. Gold dots have no completed repeat, green dots have a successful repeat and no failed repeat, and orange dots have a failed repeat. Dot radius follows completed repeats, not certainty of truth. Outer color identifies topic field; an extra violet ring marks a topic outside the origin laboratory's field. Dot placement and field filters affect only the display. Exact publication day, originating laboratory and repeat history appear in the selected claim's details. The illustrated Visual guide is schematic, not fabricated run data.

Moving gold marks encode the age of actual citations over the last eight model days. Their movement is not a measured speed of knowledge transmission. Selection rings indicate the user's selection. No visual research activity advances on wall-clock time while the model is paused. Artificial team-member orbiting has been removed.

**Dragging a laboratory is a model intervention.** Normalized distance changes which collaboration edges exist: same-field neighbors link below distance .49; close pairs below .24 use a fixed pair affinity with a .74 threshold. Initial pair affinities preserve the original seeded baseline. Later movement reuses those affinities, draws deterministic affinities for newly encountered pairs, and consumes no experiment random numbers. Unmoved pairs are not rerolled, and returning a lab to its original position restores its original edges.

Citation preference is proportional to `(1 + sqrt(existing citations + 1)) × (1.7 if linked else 1) × (1.8 if topic matches the citing lab's field else .65)`. The multiplier is an uncalibrated relative weight, not a probability. A different citation target can schedule a fresh repeat with probability `.012 × replication policy`. Moving a lab therefore can affect later citations and repeats; it does not directly change hidden truth or evidence already generated. The inspector reports links and cross-field links before and after a move.

Interdisciplinary activity has distinct meanings: out-of-field research topics, cross-field collaboration edges, and cross-field citations. The actual out-of-field topic probability is `(diversity / 16) × 3/4`, because choosing among four fields can return the original field. Joint authorship or combined scientific methods are not modeled, and there is no validated interdisciplinary quality bonus.

Policy controls replace the right-side summary panels in a nonmodal dock; the map keeps the same size and remains visible. On narrow screens, the policy dock occupies the bottom part of the viewport. Edits change future model steps; while paused, use `+10 model days` to observe an effect. Snapshot explanations refer to a dated interval in one world, and their baselines are stored separately for each world. A missing paper selection does not block general or event-driven teaching.

## Scenario atlas and coverage

The 12 integer policy axes each admit values 1 through 10: exactly 1,000,000,000,000 possible policy vectors, before design, seed, time and intervention history. The listed 180 population/prior/team/AI design combinations multiply that to 180,000,000,000,000 configurations. This atlas is sampled, never exhaustive. It covers every level of each individual policy with all others at baseline, every pair of policy extremes, and all listed population/prior/team/AI combinations with baseline policies. Each sampled configuration is executed with three seeds for 60 model days. Each result records engine SHA256, complete policy/design vector, seed, horizon and trajectory. These are illustrative model runs, not empirical estimates. Sampled min/max across three seeds is descriptive spread, not a confidence interval.

## Pulsar scientific role

Pulsar uses the shared configured LLM runtime, exact database Markdown sections, current policy settings, recent changes, metric differences, events and the selected laboratory or paper. A source citation identifies its stored document and heading. Scientific foundations support concepts, not invented numeric coefficients. A precomputed atlas run is not the visitor's current run. Unavailable LLM responses must be labeled unavailable rather than masquerading as a generative answer.
