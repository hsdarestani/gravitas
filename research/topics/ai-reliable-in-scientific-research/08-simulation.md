# Simulation — The Trust Test

## Research purpose

The simulation should teach one claim:

**An AI output does not deserve one universal trust score. Trust changes with grounding, verification, uncertainty, distribution shift and accountability.**

## Scenarios

### Literature synthesis
Claim: “Compound X significantly improves outcome Y.”

Key failure:
real-looking sources can be fabricated or can fail to support the sentence.

### Protein structure
Claim: “This protein adopts structure Z.”

Key failure:
confidence can be task-specific and structure can depend on context not represented in the prediction.

### Mathematical proof
Claim: “The conjecture is true.”

Key contrast:
a second LLM agreeing is weak evidence; a formal checker changes the trust boundary.

### Wildfire forecast
Claim: “The fire perimeter will reach this region in six hours.”

Key contrast:
historical predictive success does not automatically establish counterfactual validity under unfamiliar conditions.

## Controls

1. Grounding
   - model memory
   - mixed web
   - curated literature
   - verified primary data

2. Independent verification
   - none
   - same model self-check
   - independent model / held-out benchmark
   - formal checker / experiment / independent replication

3. Uncertainty
   - hidden
   - confidence shown
   - alternatives shown
   - calibrated + abstention

4. Distribution
   - far outside evaluation
   - shifted
   - mostly familiar
   - matched

5. Accountability
   - unclear
   - named operator
   - documented reviewer
   - responsible research owner + correction path

## Output

Do **not** show “AI is 87% trustworthy.”

Show a profile:

- Evidence traceability
- Verification strength
- Robustness
- Uncertainty handling
- Accountability

Then classify:

- Candidate only
- Useful lead
- Provisional result
- Strong evidence

The explanation must name the weakest dimension.

## Scoring principle

The final status is constrained by bottlenecks.

A very high average cannot compensate for zero independent verification in a high-stakes claim.

Pseudo-rule:

```text
if independent_verification is none:
    maximum_status = useful_lead

if distribution is far_outside and no mechanistic/external validation:
    maximum_status = provisional_result

if grounding < curated and claim depends on literature:
    evidence_traceability cannot exceed medium

strong_evidence requires:
    strong verifier
    + traceable evidence
    + visible uncertainty
    + defined operating conditions
    + accountable owner
```

## Implementation note

The current website can implement this in vanilla JavaScript. The simulation logic should remain deterministic and inspectable. The values are pedagogical state transitions, not calibrated probabilities.

## Validation tests for the simulation

The simulation itself must pass a small QA suite:

1. A proof reviewed only by a second LLM must not reach Strong Evidence.
2. Adding Lean/formal verification to the proof scenario must increase Verification Strength substantially.
3. A literature claim using verified sources but no causal validation must not automatically become Strong Evidence.
4. Moving a forecast far outside its evaluated distribution must reduce Robustness substantially.
5. Hiding uncertainty must reduce Uncertainty Handling.
6. No combination may display a percentage probability of truth.
7. Every scenario must explain *why* the status changed.
