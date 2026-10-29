# Science Universe v1 — model specification and guided tour

**Scope:** Synthetic, seeded agent-based simulation of a research ecosystem. **Not empirically calibrated, not a forecast, not a real-world causal estimate.**

## Population and initialization
- Four domains: Biology, Climate, Physics, Materials. Base assumed prior probability that a generated hypothesis is true: **0.28 / 0.36 / 0.31 / 0.42** respectively (modified slightly by diversity).
- 28 labs (7 in each domain), each initialized with 3–5 agents, a budget of 35–69 credits, and synthetic method, caution, and AI-usage attributes.
- Agents are synthetic **Human** and **AI** roles (approximately 48% AI on initialization), not autonomous language models. Each has generated random traits for rigor, creativity and speed.
- The public UI seeds World A with **20261029**; the engine default is 21061. Random draws use xorshift32, carried in the simulation state.

## Daily order (one simulation day)
1. **Fund:** replenish central pool by `6 + 3×funding` credits; automatically distribute *at most* 65% of daily inflow among the 28 labs, with per-lab caps.
2. **Generate:** each agent makes a probabilistic attempt at a hypothesis, controlled by generation rate, role/AI adoption, speed, lab AI readiness, funding and abstention. An AI's higher uncertainty policy increases modeled abstention.
3. **Test:** candidates wait 2–8 days after creation. Significant simulated experiments enter review; non-significant candidates are rejected.
4. **Review:** capacity is `floor(1 + 0.55×verification)` manuscripts/day. A modeled quality gate may reject even a significant result; false significant findings can slip through.
5. **Replicate:** scheduled repeated tests (3–9 days after scheduling), with capacity `floor(replication/3)+1` / day. A failed attempt can trigger a retraction after 1 failure if verification ≥7; otherwise after 2.
6. **Citations:** every third day the model gives papers weighted attention based on existing citations, network adjacency and shared domain, independently of truth.
7. Snapshot summary history every fourth day (up to 260 data points); trim only old, rejected hypotheses if more than 950 are stored.

## Hypotheses and synthetic truth
- Assigned hidden true/false at generation according to the domain's assumed base rate, with a small `diversity` adjustment. This truth is **synthetic**, not empirical.
- If true, the simulated effect is uniformly distributed from 0.24 to 0.92; otherwise it is exactly zero.
- An initial study consumes `0.4 + 0.16×sampleSize` lab credits.

## Test mechanism
- Model false-positive parameter: `alpha = clamp(0.005×2^(0.43×alphaPolicy), 0.007, 0.18)`.
- Effective sample size: `n = 18 + 16×sampleSize`, times lab method modifier and (on independent replication) replication modifier.
- Signal: `effect×sqrt(effectiveN)/3.7`.
- Model detection probability for true effects:
  `power = clamp(0.035 + 0.91×(1-exp(-signal²/3)), alpha, 0.992)`.
- For false hypotheses, significance probability is `alpha + fishing` (capped at 0.30). `fishing` increases with publication pressure above 5 and decreases with transparency; it is disabled for independent replication.
- These are **designed teaching rules**, not results of a calibrated clinical, environmental or scientific validation study.

## Review gate
- Assumed review rigor:
  `rigour = clamp(0.16 + .048×verification + .22×lab.method + .017×transparency - .028×pressure, .08, .9)`.
- Rejection probability for **false** significant findings: `clamp(.08 + .65×rigour, .06, .76)`; for **true** significant findings: `.045 + (.8 - lab.method)×.055`.
- Thus review is imperfect; passing review never proves a hypothesis is true.

## Citation network
- Links are generated between nearby labs, preferentially within the same domain; relocating a lab recomputes the graph.
- Citation targets receive relative weight
  `(1+sqrt(citations+1)) × (adjacent ? 1.7 : 1) × (same domain ? 1.8 : 0.65)`.
- These weights model *attention and diffusion*, explicitly **not** scientific correctness.

## User interventions
- **+15 credits:** grants from shared reserve if available.
- **Train methods:** method +0.15 (capped at 1.0), budget −10.
- **Replicate latest / paper:** queue a new repeat test for the selected published claim.
- **Pause generation:** reduces the lab's new-idea chance by a factor of 0.17 (does not completely stop).
- **Drag a lab node:** updates spatial collaboration links (and may consume random draws).

## Parallel worlds
- `fork()` deep-clones every relevant state variable, including the PRNG position.
- UI **automatically** increases World B verification and replication policies by +3 (capped at 10) immediately after forking. This is a *combined intervention*, not an isolated change of one variable.
- Worlds subsequently advance separately and may diverge stochastically because changed rules consume draws differently. Differences between one A/B run are **not generalizable causal estimates**.

## Counters and interpretation
- `generated`: cumulative hypotheses. `published`: cumulative accepted papers.
- `healthyPapers`: cumulative published minus retracted.
- `falsePublished`: false published claims not yet retracted, according to the model's hidden truth.
- `replicated`: number of completed repeat tests, not necessarily distinct replicated papers.
- `citations`: simulated citation events, not unique social connections.
- `reviewBacklog`: the current queued manuscript count.
- Interpret outputs as model behavior and test sensitivity across multiple controlled scenarios; **do not infer external-world effects**.

## Guided tutorial v1
When a visitor first opens Science Universe, an unobtrusive 9-step guided panel explains: world/map → time → hypothesis vs truth → policies → verification → citations → fork → comparison → limitations. It can be skipped and restarted any time. The panel highlights real controls in the isolated iframe using an allowlisted message protocol; it does not change any policy or trigger experiments automatically. No component, slider or simulation mechanism is removed.

## Future scientific improvements
1. Separate single-policy A/B experiments from the current built-in +3/+3 combined change.
2. Add replication experiments over many seeds with confidence intervals and sensitivity analysis.
3. Document parameter provenance and validate against public research studies before making empirical claims.
4. Treat observed live claims and synthetic ground truth separately in all displays and exports.
