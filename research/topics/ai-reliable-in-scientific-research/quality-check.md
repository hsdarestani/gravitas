# Quality check

Research version: 0.3  
Last review: 2026-10-04

## Gate

A Topic is publish-ready only when all critical categories pass.

### 1. Question precision — PASS
The yes/no question has been decomposed into task, evidence, verifier, uncertainty, distribution and accountability.

### 2. Primary-source coverage — PASS
Core case studies have primary sources.
Historical automation includes Science primary research.
Policy has an official source.
The AI-slop prevalence layer still relies partly on recent preprints and must remain labeled accordingly.

### 3. Counterevidence — PASS
A dedicated contradiction layer now challenges:
- explanation-heavy assumptions;
- human-as-clean-baseline assumptions;
- overconfidence in formal verification;
- causal interpretation of topic narrowing;
- overuse of citation integrity as a proxy;
- ceremonial multi-agent verification;
- symbolic human accountability.

### 4. Quantitative-claim discipline — PASS
Key Hao et al. values are logged with causal-language restrictions.
Paper2Agent benchmark numbers are scoped to the study.
No universal hallucination prevalence number is approved.

### 5. Recency — PASS
Includes research through 04 October 2026.
Time-sensitive publisher policies must be rechecked at publication freeze.

### 6. Source diversity — PASS
The set now includes:
- Nature / Nature Methods;
- Science;
- ACS Materials Letters;
- official publisher policy;
- arXiv research frontier;
- a peer-reviewed physics-informed ML review.

Remaining goal:
add a strong source focused specifically on scientific out-of-distribution reliability if it changes the argument.

### 7. Conceptual precision — PASS
Hallucination, slop, reliability, verification, grounding, abstention, prediction and simulation are separately defined.

### 8. Thesis stress test — PASS
Dedicated contradictions and viewpoints exist.

### 9. Claim traceability — PASS
Core public claims have IDs and source mappings.

### 10. Search traceability — PASS
A search log records completed clusters and open research gaps.

### 11. Simulation integrity — PASS AT PROTOTYPE LEVEL
Executable HTML/CSS/JS prototype exists in 08-simulation.md with explicit QA rules.
Still requires integration and browser testing on the live Topic page.

### 12. Video — INTENTIONALLY OPEN
External video removed. Awaiting original Gravitas+ video.

### 13. Public correction system — DESIGN COMPLETE
corrections.md defines the public correction format.

### 14. Research → publication separation — PASS
13-publication-map.md separates internal research layers from public presentation layers.

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

### Risk: “AI slop” becoming rhetorical
Correction:
use an operational definition and distinguish it from AI authorship detection.

### Risk: agent count mistaken for independence
Correction:
a multi-agent system can still share the same blind spots, model family and evidence base.

## Remaining work before final research freeze

- add one high-quality source on out-of-distribution reliability in scientific ML if it materially changes C015;
- recheck all policy pages immediately before public publication;
- verify final numerical claims used in public copy at the publication freeze;
- run live browser QA on the simulation;
- run one external-domain expert review if available;
- run a final contradiction search specifically against the final public thesis.
