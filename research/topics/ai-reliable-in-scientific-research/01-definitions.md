# Operational definitions

## Reliability

For this Topic, reliability is not one number.

### Predictive reliability
The system performs consistently on relevant prediction tasks under defined conditions.

### Epistemic reliability
Claims are grounded in evidence that can be inspected and challenged.

### Procedural reliability
The workflow contains mechanisms that detect, reject, localize or correct failure.

### Scientific reliability
The output can survive the forms of criticism appropriate to its domain: replication, experiment, formal checking, held-out evaluation, sensitivity analysis, intervention or expert review.

## Hallucination

A generated statement presented as if factual or evidentially grounded when the supporting basis is absent, false, mismatched or not warranted.

Important distinction:
not every model error is a hallucination, and not every hallucination is a fabricated citation.

For this Topic, citation hallucination is useful because it is unusually auditable: a cited work either resolves to a real scholarly object with compatible metadata or it does not.

## AI slop

Do not use “AI slop” as a synonym for “AI-generated.”

Operationally, scientific slop is low-integrity scientific output whose local components may look plausible while the global evidentiary or argumentative structure is weak, inconsistent, unsupported or unverifiable.

Possible manifestations:

- fabricated or mismatched references;
- claims unsupported by cited papers;
- generic but empty methodological language;
- experiments that do not test the stated hypothesis;
- conclusions stronger than the results;
- figures or tables disconnected from the described pipeline;
- internally inconsistent methods;
- automated review text that imitates criticism without expert judgement;
- high-volume submissions whose verification cost is pushed onto editors and reviewers.

## Verification

An external process capable of rejecting an AI output.

Strength matters.

Examples, from weaker to stronger depending on task:

- self-consistency;
- second-model critique;
- retrieval against real sources;
- held-out benchmark;
- executable test suite;
- first-principles calculation;
- preregistered experiment;
- independent replication;
- formal proof checker.

Agreement is not automatically verification.

## Grounding

The relationship between an output and identifiable evidence available to the system.

Grounding can improve traceability without proving the conclusion.

A retrieved real paper can still be misread.

## Abstention

A system explicitly declines to answer because evidence or confidence is insufficient.

A reliable scientific workflow must make room for abstention; otherwise uncertainty can be converted into fluent guessing.

## Prediction

A mapping from inputs to expected outputs under some distribution of cases.

## Simulation / mechanistic model

A representation that encodes processes or constraints and supports counterfactual questions about changes to conditions.

Prediction and simulation can overlap but are not interchangeable.

## Scientific understanding

This Topic does not assume one universal definition.

At minimum, distinguish:

- ability to predict;
- ability to intervene;
- ability to explain;
- ability to compress observations into a mechanism;
- ability to transfer to novel conditions;
- ability to communicate reasons to a scientific community.

## Epistemic monoculture

A research ecosystem in which common tools, datasets, models or incentives cause researchers to converge on similar questions, methods or data-rich regions, potentially reducing collective exploration even when individual productivity rises.
