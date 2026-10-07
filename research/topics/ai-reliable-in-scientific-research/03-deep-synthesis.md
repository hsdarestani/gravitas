# Deep synthesis

## Thesis

The question “Is AI reliable in scientific research?” sounds like a question about model quality. It is better understood as a question about scientific architecture.

A model can be highly capable and still sit inside a weak research process. A model can also be individually fallible while sitting inside a strong process that rejects most of its failures before they become scientific claims.

That difference is the core of this Topic.

---

## 1. Science never required infallible actors

Researchers make mistakes. Instruments drift. Code contains bugs. Statistical models overfit. Papers get corrected and retracted.

Science works not because every actor is reliable in isolation, but because claims can be exposed to criticism from outside the actor that produced them.

Different fields use different rejection mechanisms:

- experiments;
- replication;
- independent measurement;
- held-out tests;
- sensitivity analysis;
- physical constraints;
- formal proof checking;
- reproduction of code and figures;
- peer criticism.

AI does not create the first fallible participant in science. It changes the speed and scale at which fallible outputs can be produced.

That makes verification architecture more important, not less.

---

## 2. “AI” collapses tasks that deserve different trust

Consider four outputs:

1. a chatbot summarizes ten papers;
2. AlphaFold predicts a protein structure;
3. a multi-agent system proposes a biomedical hypothesis;
4. an automated theorem system produces a Lean-verified proof.

Calling all four “AI output” hides the central differences.

The literature summary depends on correct retrieval, accurate interpretation and synthesis.

The protein prediction can be benchmarked against experimental structures and comes with task-specific confidence measures.

The biomedical hypothesis is a candidate whose scientific value depends on future experiment.

The formal proof can be checked against a symbolic proof environment.

The correct trust policy therefore depends on the object produced and the cost of checking it.

---

## 3. Hallucination is especially dangerous when it imitates scholarship

Nonsense is often easy to reject.

The scientifically dangerous failure is a claim that already has the surface form of evidence: a plausible mechanism, a convincing paragraph, a realistic paper title, a complete-looking DOI.

Citation hallucination is a useful lens because it converts an abstract reliability problem into something auditable. The bibliographic object can often be checked against scholarly databases.

Recent work and reporting show that fabricated and mismatched references have entered academic corpora. The exact prevalence varies strongly by dataset, venue and detection definition, so the Topic should resist one global number.

The structural point is stronger than any single estimate:

**generation of plausible references is cheap; verification still costs attention.**

---

## 4. Evaluation can accidentally reward guessing

One of the most important 2026 results for this Topic is that hallucination cannot be discussed only as a defect inside the model.

Kalai and colleagues show how accuracy-style evaluation can reward an answer over abstention. If a correct guess earns credit while “I do not know” earns none, a system optimizing the metric has an incentive to answer even when uncertain.

This matters because scientific reliability sometimes requires exactly the opposite behavior.

A trustworthy research assistant should be capable of producing:

- “the evidence is insufficient”;
- “I found conflicting sources”;
- “this claim is outside the verified corpus”;
- “the result changes under these assumptions”;
- “I cannot verify this citation.”

Abstention is not a weakness if the alternative is fabricated certainty.

---

## 5. Reliable AI often has an external judge

The strongest case studies in this Topic share a pattern.

### AlphaFold

The scientific value is not that a network can draw protein structures that look plausible.

Its value comes from performance against experimental structures, well-defined evaluation regimes, confidence measures and continued interaction with structural biology.

Terwilliger and colleagues provide an important correction to simplistic narratives. Many AlphaFold predictions are extraordinarily accurate, but some high-confidence regions still differ from experimental maps, and important biological details depend on ligands, modifications, environment and conformational state.

The right framing is powerful hypothesis generation, not “experiments are obsolete.”

### GNoME

A learned system expands the search over candidate materials.

Candidate generation is not the final epistemic act. Stability is checked with first-principles calculations, and experimental synthesis provides another layer of evidence.

### Co-Scientist

The system moves AI upstream into hypothesis generation and refinement.

That is a bigger epistemic leap because the output is not merely a prediction over an established benchmark. It is a proposal for what scientists should test.

The Nature paper is useful precisely because some cases proceed into experimental validation.

### Formal mathematics

Here the trust boundary changes most dramatically.

Natural-language reasoning can be unreliable while the final proof object can be accepted or rejected by Lean.

This does not solve every problem. Formalization can misstate the intended theorem, assumptions can be too weak or too strong, and correctness does not establish novelty or significance.

But it demonstrates an important principle:

**a fallible generator can participate in a highly reliable pipeline when the verifier is strong enough.**

### Paper2Agent

Paper2Agent turns papers, code, data and workflows into executable agent tools and validates generated tools against reference outputs.

Repeatedly failing tools are excluded.

This is close to the architecture Gravitas+ should care about: not merely giving an LLM access to papers, but converting research artifacts into testable capabilities.

---

## 6. AI slop is not mainly a writing-style problem

A weak definition of AI slop is “text that sounds machine-written.”

That is not enough for science.

Scientific slop can be locally polished while globally incoherent.

A manuscript might contain real citations and still fail because:

- the cited sources do not support the claims;
- the method does not test the stated hypothesis;
- the reported result does not justify the conclusion;
- the experiment is not reproducible;
- the argument contains hidden contradictions;
- figures and tables are inconsistent with the described analysis.

The newest SciSlopBench preprint is useful because it explicitly treats slop as failures across structure, argument and artifacts rather than only linguistic fingerprints.

Because it is very recent and not yet peer-reviewed, the Topic should present it as an emerging measurement approach, not settled consensus.

---

## 7. Scientific institutions are building an immune response

Current publisher policy is moving toward a risk-based view.

Nature/Springer Nature’s current AI policy emphasizes:

- non-transferable human accountability;
- AI supporting rather than replacing scholarly judgement;
- transparency;
- confidentiality and data protection;
- restrictions on unverifiable or undisclosed AI use;
- prohibition on delegating peer-review judgement to AI.

This is more useful than a blanket “AI allowed / AI forbidden” rule because the scientific risk depends on the role the system plays.

Language polishing is not equivalent to generating a hypothesis.
Summarization is not equivalent to making an editorial decision.
Organizing a review is not equivalent to performing the review.

The policy direction is therefore converging on function, risk and accountability.

---

## 8. Prediction is not the same thing as mechanism

A predictive system can be scientifically useful without representing the processes that produced the outcome.

That distinction becomes important under intervention and distribution shift.

A model may predict wildfire movement from historical observations. A mechanistic or physics-guided system can additionally represent constraints and processes that help scientists reason about changed wind, altered fuels or rare combinations of conditions.

This is not an argument that mechanistic models always win.

It is an argument that models answer different questions.

The scientific mistake occurs when successful prediction on one class of questions is silently upgraded into justified answers to another.

---

## 9. Reliability can fail at the ecosystem level

Most reliability discussions focus on whether a single answer is true.

The 2026 Nature study by Hao and colleagues shows why that is incomplete.

Across 41.3 million papers, AI adoption is associated with strong individual advantages but a contraction in the collective space of scientific topics.

The causal interpretation should remain cautious, but the phenomenon raises an important systems question:

What if AI makes each researcher locally more efficient while many researchers become more likely to explore the same legible, data-rich regions?

That is not hallucination.
It is not an incorrect answer.

It is a possible failure of scientific search diversity.

A scientific tool can therefore be locally reliable and globally distorting.

---

## 10. The trust spectrum should be based on verifiability

A useful way to organize AI-assisted science is by the cost and strength of verification.

### Cheap, hard verification
Examples:
formal proof checking, deterministic database resolution, executable unit tests.

AI can be used aggressively because many errors can be rejected automatically.

### Moderate verification cost
Examples:
held-out prediction, numerical reproduction, structural comparison, simulation, computational chemistry.

AI can scale discovery, but claims still require domain-specific evaluation.

### Expensive verification
Examples:
wet-lab hypotheses, clinical causal claims, complex field experiments.

AI generation may be cheap while validation is slow and expensive. Triage becomes essential.

### Ambiguous or long-horizon verification
Examples:
broad theoretical interpretations, policy recommendations, claims about complex social systems.

The system should expose uncertainty and alternatives rather than manufacture a single authoritative answer.

---

## 11. A better question than “Do you trust AI?”

For any AI-assisted scientific claim, ask:

### Object
What did the system produce?

### Evidence
What evidence did it actually have access to?

### Provenance
Can we reconstruct where the important claims came from?

### Verifier
What independent process can reject the output?

### Uncertainty
Can the system abstain and expose disagreement?

### Distribution
Does the current case resemble the cases on which reliability was established?

### Accountability
Who is responsible for checking, publishing and correcting the result?

### Cost of error
What is the consequence of being wrong?

This is a more scientific question than asking for one universal trust score.

---

## 12. Conclusion

AI is already part of scientific discovery.

The mature question is not whether machines should be allowed into science.

It is whether we can build research workflows in which machine speed does not outrun our ability to detect error.

The most promising direction is not an artificial scientist that always knows the answer.

It is a research system in which:

- generation can be broad;
- evidence is traceable;
- uncertainty is visible;
- validation is external;
- failures are logged;
- results are reproducible where possible;
- corrections propagate;
- and no fluent sentence becomes scientific authority merely because it sounds complete.

Reliability is not a personality trait of the model.

It is the architecture around the claim.
