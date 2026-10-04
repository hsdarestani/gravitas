# Evidence map

Status legend:

- **verified** — directly checked against the listed source
- **qualified** — supported, but wording must preserve limitations
- **open** — not strong enough for public factual wording yet

## C001 — Accuracy-only evaluation can incentivize hallucination

**Type:** methodological / quantitative theory  
**Status:** verified  
**Confidence:** high  
**Source:** S001

Nature 2026 reports that commonly used accuracy-style evaluations can create incentives for models to guess rather than abstain. Public wording should say “can incentivize” rather than “causes all hallucinations.”

## C002 — AI use is associated with higher individual impact and narrower collective focus

**Type:** observational  
**Status:** verified and qualified  
**Confidence:** high for association, low for causal wording  
**Source:** S002

The study analyses 41.3 million papers and reports that AI-augmented researchers publish more, receive more citations and lead projects earlier, while the collective topical range contracts and follow-on engagement falls.

Do not write “AI causes scientists to become narrower.” The study is observational and identifies associations.

## C003 — AI can create an illusion of scientific understanding

**Type:** conceptual / perspective  
**Status:** verified  
**Confidence:** medium  
**Source:** S003

Use as a conceptual framework, not an empirical measurement of hallucination prevalence.

## C004 — Hallucinated references are a real scientific-integrity failure mode

**Type:** empirical + synthesis  
**Status:** verified with source-tier caveat  
**Confidence:** high that the problem exists; prevalence estimates vary by corpus  
**Sources:** S004, S013, S014

Use conservative wording. Large prevalence estimates from 2026 preprints should remain labeled as preprint findings until peer-reviewed or independently reproduced.

## C005 — AlphaFold is transformative but does not eliminate experimental structure determination

**Type:** primary + validation  
**Status:** verified  
**Confidence:** high  
**Sources:** S005, S006

The original AlphaFold paper establishes high predictive accuracy. Later Nature Methods analysis shows that even high-confidence predictions can disagree with experimental density in some regions and recommends treating predictions as powerful hypotheses rather than universal replacements for experiments.

## C006 — GNoME demonstrates generate-then-check materials discovery

**Type:** primary research  
**Status:** verified  
**Confidence:** high  
**Source:** S007

Use it as a case of ML expanding candidate search while stability is checked through computational physics and experimental work.

## C007 — Co-Scientist generates and refines hypotheses with experimental validation cases

**Type:** primary research  
**Status:** verified  
**Confidence:** high for reported architecture and validation cases  
**Source:** S008

Do not generalize from reported biomedical cases to “autonomous science is solved.”

## C008 — Formal verification can move the trust boundary in AI-assisted mathematics

**Type:** preprint / formal methods  
**Status:** verified as reported result; publication status must remain explicit  
**Confidence:** medium-high  
**Source:** S009

The 2026 preprint reports an automated framework resolving an open commutative-algebra problem and formalizing the proof in Lean 4 with essentially no human involvement.

The reliable public point is not that natural-language reasoning became infallible. It is that the final proof artifact became machine-checkable.

## C009 — Human accountability remains central in current Nature/Springer Nature AI policy

**Type:** official policy  
**Status:** verified  
**Confidence:** high  
**Sources:** S010, S011

Current policy states that scholarly judgement, accountability and responsibility remain human, with risk-based requirements for AI use and restrictions around confidential materials.

## C010 — Paper2Agent is an example of reliability through executable research artifacts

**Type:** primary research  
**Status:** verified  
**Confidence:** high for reported benchmark results  
**Source:** S012

Useful because it turns papers, code and workflows into tested executable tools and explicitly excludes repeatedly failing tools from the final agent.

## C011 — Physics-informed approaches can improve plausibility and generalizability

**Type:** review  
**Status:** verified  
**Confidence:** medium-high  
**Source:** S016

Use to support the general claim that known scientific structure can constrain learned models. Do not imply physics-informed ML universally outperforms purely data-driven approaches.

## C012 — Scientific slop is more than detectable “AI style”

**Type:** recent preprint  
**Status:** qualified  
**Confidence:** medium  
**Source:** S015

SciSlopBench argues that scientific slop includes failures of structure, argument and artifacts and that token-style AI detectors miss much of the problem. Keep clearly labeled as a very recent preprint.

## C013 — Verification capacity may become a bottleneck as scientific generation scales

**Type:** synthesis / inference  
**Status:** qualified  
**Confidence:** medium-high  
**Sources:** S004, S012, S013, S014, S015

This is our synthesis across several findings, not a direct result from one paper.

Public wording:
“Generation is scaling faster than many existing verification processes.”

## C014 — The strongest current AI-for-science examples pair generation with rejection mechanisms

**Type:** synthesis  
**Status:** qualified  
**Confidence:** high as an editorial pattern, not a theorem  
**Sources:** S005–S012

Examples:
prediction ↔ experiment;
materials generation ↔ first-principles / synthesis;
hypothesis generation ↔ experimental validation;
proof generation ↔ Lean;
paper agentification ↔ execution tests.

## C015 — Predictive accuracy and mechanistic understanding are distinct

**Type:** conceptual + methodological  
**Status:** verified at general level  
**Confidence:** high  
**Sources:** S016 plus domain-specific case studies

Avoid claiming that mechanistic models are always more scientifically useful. The appropriate representation depends on the question.
