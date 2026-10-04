# Fact-check log

Last full pass: 2026-10-04

## Protocol

Every material public claim must have:

- claim ID;
- exact wording;
- source;
- source type;
- direct/indirect support;
- contradiction search;
- confidence;
- last checked date;
- pass / qualify / remove decision.

## Checked claims

### C001
**Claim:** Accuracy-style LLM evaluations can incentivize guessing rather than abstention.  
**Source:** S001, Nature, 22 April 2026.  
**Support:** direct.  
**Contradiction search:** no evidence found that invalidates the paper's narrower claim; this should not be generalized into a complete theory of hallucination.  
**Decision:** PASS with “can incentivize” wording.  
**Confidence:** high.

### C002
**Claim:** In a 41.3-million-paper analysis, AI-augmented research is associated with individual productivity/impact gains and narrower collective scientific focus.  
**Source:** S002, Nature, 14 January 2026.  
**Support:** direct.  
**Important values reported:** 3.02× papers, 4.84× citations, project leadership 1.37 years earlier; 4.63% contraction in collective topical volume; 22% decline in engagement with one another.  
**Risk:** observational association can be miswritten as causal.  
**Decision:** PASS only with “associated with” language.  
**Confidence:** high.

### C003
**Claim:** Messeri and Crockett describe risks of illusions of understanding and scientific monocultures.  
**Source:** S003, Nature Perspective, 2024.  
**Support:** direct conceptual framing.  
**Decision:** PASS as perspective, not prevalence evidence.  
**Confidence:** high about what the authors argue.

### C005
**Claim:** AlphaFold predictions can be extremely useful but do not universally replace experimental structure determination.  
**Sources:** S005, S006.  
**Support:** direct.  
**Decision:** PASS.  
**Confidence:** high.

### C006
**Claim:** GNoME uses deep learning to scale candidate materials discovery.  
**Source:** S007.  
**Support:** direct.  
**Decision:** PASS; describe downstream checks accurately.  
**Confidence:** high.

### C007
**Claim:** Co-Scientist is a multi-agent hypothesis-generation system with reported biomedical experimental-validation cases.  
**Source:** S008, Nature 2026.  
**Support:** direct.  
**Decision:** PASS; do not generalize to universal autonomous discovery.  
**Confidence:** high.

### C008
**Claim:** A 2026 preprint reports automated resolution and Lean verification of an open commutative-algebra problem with essentially no human involvement.  
**Source:** S009.  
**Support:** direct from preprint abstract.  
**Decision:** PASS with explicit “preprint reports” wording.  
**Confidence:** medium-high.

### C009
**Claim:** Current Nature/Springer Nature AI policy keeps scholarly accountability human and uses a risk-based approach.  
**Source:** S010.  
**Support:** direct policy text.  
**Decision:** PASS.  
**Confidence:** high.  
**Freshness:** policy is time-sensitive; recheck before publication if delayed.

### C010
**Claim:** Paper2Agent validates generated paper tools against reference outputs and excludes repeatedly failing tools.  
**Source:** S012, Nature 2026.  
**Support:** direct.  
**Decision:** PASS.  
**Confidence:** high.

### C012
**Claim:** SciSlopBench treats scientific slop as more than surface AI-writing style.  
**Source:** S015, very recent preprint.  
**Support:** direct from preprint abstract.  
**Decision:** QUALIFY as emerging work; do not present as established field standard.  
**Confidence:** medium.

### C013
**Claim:** Hallucinated citations have entered scientific corpora at measurable scale.  
**Sources:** S013, S014 plus S004.  
**Support:** direct in cited studies/reporting.  
**Risk:** prevalence estimates depend on venue, corpus and definition.  
**Decision:** PASS only without universal prevalence number.  
**Confidence:** high for existence, medium for scale across all science.

## Claims not yet allowed as hard facts

- “Most AI-written papers contain hallucinations.”
- “Peer review cannot catch AI hallucinations.”
- “AI causes science to become less diverse.”
- “Formal verification makes AI mathematics fully autonomous.”
- “AlphaFold replaces experimentation.”
- “AI detectors can reliably identify scientific slop.”

These formulations are either too broad, causal, or unsupported.
