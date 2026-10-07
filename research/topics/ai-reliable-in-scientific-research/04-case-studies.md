# Case studies

## Case 1 — AlphaFold: prediction as scientific hypothesis

### Why it matters
AlphaFold is one of the strongest arguments against simplistic claims that AI is inherently unreliable in science.

### What the system does
Predicts protein structure from sequence using a specialized learned architecture.

### What supports trust
- benchmark performance against experimentally determined structures;
- task-specific confidence metrics;
- comparison with structural data;
- extensive downstream scientific use.

### What limits trust
- proteins are dynamic;
- ligands, covalent modifications and environmental conditions can matter;
- even high-confidence predictions can differ from experimental density in some regions;
- prediction of a structure does not automatically establish biological mechanism.

### Editorial conclusion
AlphaFold is best framed as an unusually powerful scientific hypothesis generator whose predictions often deserve substantial trust, not as a universal replacement for experimental structural biology.

Sources: S005, S006.

---

## Case 2 — GNoME: scaling candidate discovery

### Why it matters
GNoME shows how AI can transform discovery by expanding the candidate search space.

### Verification architecture
1. learned model proposes or ranks candidates;
2. stability is checked with computational physics;
3. subsets can proceed to experimental synthesis.

### Reliability lesson
The neural model is one component in a pipeline. Scientific confidence grows as candidates survive independent layers.

Source: S007.

---

## Case 3 — Co-Scientist: AI moves upstream to hypotheses

### Why it matters
Analysis and prediction are not the only scientific tasks being automated. Co-Scientist moves into hypothesis generation, critique and prioritization.

### Architecture
Multiple agents generate, debate, rank and refine hypotheses.

### Evidence
The Nature paper reports biomedical examples that proceed to experimental validation.

### Risk
A hypothesis can be novel, plausible and still be wrong. Scaling hypothesis production can move the bottleneck to experiment design and validation.

### Reliability lesson
Hypothesis generation is valuable only when the system is connected to evidence and a downstream rejection mechanism.

Source: S008.

---

## Case 4 — Automated conjecture resolution + Lean

### Why it matters
Mathematics offers an unusually strong verifier.

### Reported workflow
- informal reasoning agent explores strategies;
- theorem retrieval supports cross-domain search;
- formal agent translates reasoning into Lean 4;
- Lean checks the formal proof.

### Reported result
The preprint reports resolution of an open commutative-algebra problem with essentially no human involvement.

### What formal verification proves
That a formal object satisfies the theorem under the encoded assumptions.

### What it does not automatically prove
- that the theorem statement faithfully captures the intended informal problem;
- that assumptions are scientifically or mathematically interesting;
- novelty;
- importance;
- quality of exposition.

### Reliability lesson
Correctness can be made far more machine-auditable than significance.

Source: S009.

---

## Case 5 — Paper2Agent: papers become executable research objects

### Why it matters
A static paper is difficult for an agent to use reliably because methods, code, data and assumptions are distributed across artifacts.

Paper2Agent builds MCP-style tool layers from papers and codebases, then tests the tools against reference behavior.

### Reported validation
The Nature paper reports:
- 74 of 100 computational-biology papers successfully agentified;
- 593 of 599 proposed tools passing automated validation;
- 91.2 ± 1.6% accuracy on 300 tutorial-derived questions for one benchmark setup;
- 98.1 ± 0.8% accuracy across 42 execution tasks from 10 non-biology computational papers.

These numbers are specific to the paper's evaluation and must not be generalized to all papers or all agents.

### Reliability lesson
Reproducibility can become part of the interface. A paper that exposes tested tools may be easier to reuse and audit than one that exists only as prose.

Source: S012.

---

## Case 6 — The AI Scientist: generation reaches the full paper loop

### Why it matters
This case changes the scale of the reliability problem.

The system does not automate one isolated scientific task. In machine-learning research it can generate ideas, write code, run experiments, plot and analyse results, write a manuscript and perform automated review.

### Reported result
The 2026 Nature paper reports that one AI-generated manuscript passed the first round of review for a workshop of a top-tier machine-learning conference. The workshop acceptance rate was 70%.

### Why the domain matters
Machine-learning research is unusually automation-friendly:
- experiments are computational;
- environments can be instrumented;
- results can often be regenerated cheaply;
- code can be executed repeatedly.

The same architecture cannot simply be assumed to transfer to wet-lab biology, field science or clinical research.

### Reliability risk
If generation becomes end-to-end and cheap, review capacity can become the limiting resource. The authors explicitly note risks of burdening review systems and adding noise to the literature.

### Reliability lesson
Autonomous research makes verification throughput part of scientific infrastructure.

Source: S017.

---

## Case 7 — Scientific literature assistants: the weak-verifier case

### Why it matters
This is where users most easily confuse fluency with evidence.

### Typical failure chain
1. user asks a broad question;
2. model produces a coherent synthesis;
3. references look plausible;
4. reader assumes sourcing and interpretation were already checked.

### Verification burden
Each material claim may require:
- citation existence check;
- metadata check;
- reading the source;
- checking whether the source actually supports the sentence;
- checking for contradictory literature;
- checking recency.

### Reliability lesson
RAG can improve source traceability, but retrieval is not equivalent to interpretation and a real citation is not automatically a supporting citation.

Sources: S001, S004, S013, S014.
