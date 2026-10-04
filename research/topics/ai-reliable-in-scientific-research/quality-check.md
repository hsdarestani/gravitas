# Quality check

Research version: 0.2  
Last review: 2026-10-04

## Gate

A Topic is publish-ready only when all critical categories pass.

### 1. Question precision — PASS
The yes/no question has been decomposed into task, evidence, verifier, uncertainty, distribution and accountability.

### 2. Primary-source coverage — PASS WITH EXPANSION NEEDED
Core positive case studies have primary sources.
Policy has an official source.
The AI-slop section still relies partly on recent preprints for prevalence and benchmarking.

### 3. Counterevidence — PASS
The pack contains:
- limitations of AlphaFold;
- distinction between prediction and mechanism;
- observational caveat for topic-narrowing results;
- limits of formal verification.

### 4. Quantitative-claim discipline — PASS
Key Hao et al. values are logged with causal-language restrictions.
Paper2Agent benchmark numbers are scoped to the study.

### 5. Recency — PASS
Includes research through early October 2026.
Time-sensitive publisher policies must be rechecked at publication freeze.

### 6. Source diversity — PASS WITH EXPANSION NEEDED
Current set includes Nature primary research, Nature Methods, official policy, arXiv preprints and a methods review.
Add at least one strong non-Nature primary or review source before final publication if it materially improves a claim.

### 7. Conceptual precision — PASS
Hallucination, slop, reliability, verification, grounding, abstention, prediction and simulation are separately defined.

### 8. Thesis stress test — PASS
The pack includes strong cases both for and against demanding explanation.

### 9. Claim traceability — PASS
Core public claims have IDs and source mappings.

### 10. Simulation integrity — PASS AT SPEC LEVEL
The simulation has explicit pedagogical rules and QA tests.
Implementation still requires integration into the site and runtime testing.

### 11. Video — INTENTIONALLY OPEN
External video removed. Awaiting original Gravitas+ video.

### 12. Public correction system — DESIGN COMPLETE
Correction log should be exposed on the public Topic once published.

## Adversarial review notes

### Risk: “verification solves reliability”
Correction:
verification is domain-specific and can itself be incomplete. Formal correctness is not novelty; retrieval is not interpretation; experiment can be underpowered; benchmark fit is not distribution robustness.

### Risk: overstating Hao et al.
Correction:
use association language and note observational design.

### Risk: overusing citation hallucination as a proxy
Correction:
citation integrity is measurable but covers only one slice of scientific reliability.

### Risk: Nature-heavy source set
Action:
retain Nature where it is the primary publication or official policy, but deliberately search other venues for competing evidence before research freeze.

### Risk: “AI slop” becoming rhetorical
Correction:
use an operational definition and distinguish it from AI authorship detection.

## Remaining work before final research freeze

- add a source specifically on reproducibility / agentic scientific workflows outside Paper2Agent;
- add one high-quality source on evaluation under distribution shift in scientific ML;
- verify any final numerical claims used in the public essay immediately before publication;
- run site simulation QA after implementation;
- run one external-domain expert review if available.
