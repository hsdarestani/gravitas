# GraviQuest Science Evidence Bench — preregistration and scientific review (v1.0)

**Status:** Theoretical/educational statistical benchmark built against explicitly assumed parameters. **NOT empirically calibrated; NOT approved for external-world forecasting.** It is a new reproducible research evaluation *alongside* Science Universe v1; it does not replace or silently edit the existing 28-laboratory interactive world.

## Research question and hypotheses (defined before observing results)

**Question:** Under which conditions does an AI-associated increase in hypothesis throughput increase independently confirmed *true* discoveries, rather than simply increasing published false positives?

- H1 (throughput): Increasing tested candidates while holding study-level `alpha`, effect size, prior, methods and validation capacity fixed increases the count of significant findings, including false positives. This is a structural consequence of throughput—not evidence that real-world AI induces poorer research.
- H2 (validation): When throughput grows, expanding review/replication capacity changes bottlenecks and the number of confirmed outcomes. The outcome is conditional on the configured arrival and service rates, not guaranteed for all settings.
- H3 (selective analysis): Selecting the lowest p-value from four independent tests at nominal alpha increases the family-wise false-positive probability; a predeclared Bonferroni threshold alpha/4 controls FWER under model assumptions.
- H4 (reproducibility): With independent fresh normal samples, a repeated positive finding provides additional evidence. One replication success is *not* a universal proof of truth.

**Prespecified primary metric:** mean number of independently confirmed *true* effects per run, according to a synthetic hidden-truth flag.

**Secondary metrics:** published total, published false positives, false confirmations, review backlog, replication backlog, run-by-run paired differences vs baseline, Monte Carlo confidence interval for the mean, and theoretical power/positive predictive value.

## Data-generation and test specification

Each candidate hypothesis `h` has `T_h ~ Bernoulli(pi)` and true standardized effect `theta_h = effect × T_h`. `pi` and `effect` are **explicit user assumptions**; they are not domain-specific empirical estimates.

In each simulated independent analysis:

`Z_h = sqrt(n) × theta_h + epsilon_h`; `epsilon_h ~ N(0,1)`.

`p_h = 2(1 - Phi(|Z_h|))` is the two-sided normal z-test p-value assuming **known sigma = 1** and independent normal sampling. This is a genuine statistical sampling model, not a direct Bernoulli success-probability shortcut. Under the exact null and no multiple comparisons, `P(p ≤ alpha) ≈ alpha` up to the approximation error of Phi.

Under the alternative, analytic power is:

`power = Phi(-z_(1-alpha/2) - sqrt(n)*effect) + 1 - Phi(z_(1-alpha/2) - sqrt(n)*effect)`.

For one unselected study and no publication bias, `PPV = pi*power/(pi*power+(1-pi)*alpha)`; this follows Bayes' theorem and the pre-study-odds framework (Ioannidis 2005). It is **not** an empirical estimate of actual published papers.

For the "flexible" arms, four **independent tests** on the same hypothesized effect are generated and the minimum p is selected. These are modeled independent attempts, **not four correlated analyses of one real observed dataset**. For null `T=0`, uncorrected FWER is `1-(1-alpha)^4`. Bonferroni uses per-test cutoff alpha/4; its exact FWER under independence is `1-(1-alpha/4)^4` (≤ alpha). This is a stylized illustration of selective reporting/multiple testing, not a literal model of every form of p-hacking.

## Schedule, resources, assumptions

- **Baseline:** 4 hypotheses/day, one test/candidate, 6 review slots/day, 2 replication slots/day.
- **AI speed:** round(4 × AI multiplier) hypotheses/day, **same per-study statistical quality and staffing**.
- **AI scaled validation:** same AI throughput plus proportional review and replication staffing, capped at 100/day.
- **AI flexible:** same AI throughput and staffing, four independent potential results, choose minimum p without correction.
- **AI corrected:** same as flexible but Bonferroni alpha/4.
- Review queues process the significant candidates FIFO; all reviewed significant candidates are published. **Reviewer rigor is not modeled** in this first benchmark—capacity only.
- Publications enter a replication queue, due after three days; fresh independent *one-primary-analysis* z tests determine confirmation. Replication uses the same assumed true effect and n, but **independent noise**, not different institutions, protocols or effect heterogeneity.
- All runs stop at day `days`; pending queues are displayed as backlogs; not counted as rejected.
- Twenty-eight numbered "lab slots" are assigned to candidates for comparing provenance across the ecosystem; **the benchmark does not yet simulate all original 28 laboratories' network dynamics, budgets, individual agent learning or collaboration.** The original immersive simulator is preserved untouched.

## Randomness and comparison protocol

The implemented deterministic PRNG keys each hypothesis's truth and initial study noise by (base seed, day, candidate slot). This creates **common random numbers** for overlapping candidates across arms and helps reduce the variance of paired differences. Replication uses a disjoint key. Scenario comparison is thus paired, not fully independent per arm.

Each `run` uses an independently derived seed. 120 paired runs × 60 days is the suggested starting design; confidence intervals (CI = sample mean ± 1.96 × sample standard error) summarize **across-run stochastic uncertainty within the specified model**. They are normal approximations, not predictive confidence intervals or proof of external causal effects. CSV exports include all run-level results, model version and seeds for re-running experiments.

## ODD documentation (benchmark scope)

- **Purpose:** study mechanisms connecting candidate generation, false positives, validation and replication under finite processing capacities.
- **Entities and state:** candidate (truth, effect, p), publication (truth, lab slot), review/replication queues, model day, aggregate counts.
- **Process schedule:** create candidates → sample independent z tests → queue significant candidates → review FIFO → queue published manuscripts → replicate with independent draw → update metrics.
- **Design concepts:** stochasticity, local persistence in queues, experimentally controlled conditions, explicit hidden ground truth; no learned adaptation.
- **Initialization:** deterministic seed, numeric parameters. No outside data by default.
- **Input data:** scenario assumptions entered by user; **no empirical observations currently imported**.
- **Submodels:** known-variance two-sided z test, multiplicity adjustment, queue service, independent replication, paired Monte Carlo outputs.

## Source and parameter provenance

| Rule | Provenance | Current status |
| --- | --- | --- |
| Normal z testing, Type I error, statistical power | Standard statistical probability theory | Mathematically grounded; numerical null-rate test |
| PPV and pre-study truth odds | Ioannidis (2005), DOI:10.1371/journal.pmed.0020124 | Theoretical relationship; prior not estimated |
| Multiplicity and selective reporting | Simmons, Nelson & Simonsohn (2011), DOI:10.1177/0956797611417632 | Illustration; independent-analysis simplification |
| Publication incentives and scientific ecosystem | Smaldino & McElreath (2016), DOI:10.1098/rsos.160384 | Conceptual motivation only; not yet parameterized |
| Agent-based reporting standard | Grimm et al. (2020) ODD update, DOI:10.18564/jasss.4259 | Partial ODD-adapted documentation |
| Truth prior (default .15), effect size (.4), sample n (64), candidate throughput (4/day), AI factor (2.5), reviewer/replication slots (6/2), replication lag (3 days) | **No empirical source chosen** | Explicit hypothetical inputs, not observed facts |
| AI quality or autonomous discovery skills | Not modeled by this benchmark | AI is a throughput multiplier, **not an LLM research scientist** |

## Automated validation

- Numerical CDF consistency at 0 and 1.96, two-sided alpha critical z.
- Theoretical null detection equals alpha.
- Analytic power increases with sample size/effect.
- 18,000 simulated null draws produce type-I error near alpha within 0.9 percentage points (test tolerance).
- Four uncorrected independent tests raise false-positive rate substantially; Bonferroni approaches nominal family-wise rate.
- Determinism: same seed, parameters and steps yield exactly equal results; different seeds generally differ.
- Five scenarios generate paired records and expected zero baseline deltas.
- Parameter, numerical-finiteness and compute-budget validation.

**Run:** `node --test tests/science-evidence.test.cjs`

## Scientific acceptance gate — pending independent review

1. **Sajad / scientific lead:** sign off on research question, labels, mathematical derivations, hypotheses and exactly what can be claimed.
2. **Calibration protocol:** choose a justified domain and a usable public, licensed dataset with study-level effect sizes and independent replications (e.g., Open Science Collaboration 2015 DOI:10.1126/science.aac4716, subject to dataset access/selection); estimate plausible distribution of effect sizes and base rates with uncertainty. OpenAlex citation counts alone cannot establish ground truth or calibrated replication probabilities.
3. **Sensitivity analysis:** vary prior, effect, n, alpha, throughput, queue capacities, independent-analyses correlation, and replication heterogeneity. Evaluate whether qualitative conclusions survive.
4. **Independent reproduction:** a second implementation (preferably R or Python with a standard normal CDF) must reproduce calibration rates and at least one preregistered result.
5. **ABM integration:** only after these checks, decide how benchmark distributions inform the 28-lab main engine without claiming direct real-world calibration.
6. **Pulsar:** endpoint uses shared public GraviQuest Pulsar runtime. Metrics in the browser are client-supplied; the server and Pulsar must describe them as unverified telemetry. No tool access or personalised Research Workspace continuity is assumed. A `script` fallback must be labeled as such.

## References

- Ioannidis, JPA. *Why Most Published Research Findings Are False.* PLOS Medicine (2005): https://doi.org/10.1371/journal.pmed.0020124
- Simmons, JP et al. *False-Positive Psychology.* Psychological Science (2011): https://doi.org/10.1177/0956797611417632
- Smaldino, PE and McElreath, R. *The natural selection of bad science.* Royal Society Open Science (2016): https://doi.org/10.1098/rsos.160384
- Open Science Collaboration. *Estimating the reproducibility of psychological science.* Science (2015): https://doi.org/10.1126/science.aac4716
- Grimm, V et al. *The ODD protocol: A second update.* JASSS (2020): https://doi.org/10.18564/jasss.4259
