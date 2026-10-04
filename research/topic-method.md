# Gravitas+ Topic Research Method v1.0

## Purpose

A Gravitas+ Topic is not a content page assembled from a few links. It is a small research project whose public page is the final interface over a traceable research pack.

The method has four goals:

1. depth: the topic should survive expert scrutiny;
2. traceability: every material factual claim should be traceable to evidence;
3. disagreement: serious counter-evidence and competing interpretations must be represented;
4. reusability: the research corpus must be stored as structured Markdown so it can be reused by the website, Pulsar, editorial workflows, future essays and updates.

## Two outputs

### A. Internal Research Pack

This is the source of truth. It can be long, technical and redundant where redundancy helps verification.

It contains:

- research question and scope;
- operational definitions;
- search strategy;
- source library;
- evidence map;
- claim ledger;
- contradictions and uncertainty;
- case studies;
- timeline;
- technical mechanisms;
- governance and policy;
- open questions;
- fact-check log;
- quality-check log;
- public-page content;
- simulation specification.

### B. Public Topic

The public page is a selected, readable interface over the Research Pack.

The default public layers are:

1. Video
2. Short answer
3. Essay
4. Evidence map
5. Case studies
6. Sources
7. Timeline
8. Simulation
9. Viewpoints
10. Open questions
11. Discussion
12. Correction log

The public page may add or remove layers when the research question demands it. The Research Pack should not be reduced merely because the page is shorter.

---

## Research workflow

### Stage 1 — Frame the question

Write:

- the primary question;
- the strongest version of the question;
- what would count as a useful answer;
- what is explicitly out of scope;
- key terms that need operational definitions;
- likely hidden assumptions.

Do not search broadly before the question is framed.

### Stage 2 — Build a search matrix

Search by evidence need, not by keyword volume.

For each Topic, include at minimum:

- foundational literature;
- recent primary research;
- recent reviews;
- methods and benchmark papers;
- negative results and limitations;
- policy or governance documents where relevant;
- credible criticism or opposing interpretations;
- direct evidence for case studies;
- current developments if the field is moving quickly.

### Stage 3 — Ingest sources

Every retained source becomes Markdown.

Each source file must carry:

- stable source ID;
- title;
- authors;
- date;
- venue;
- source type;
- peer-review status where applicable;
- DOI or canonical URL;
- access date;
- evidence tier;
- claims supported;
- claims challenged;
- important quantitative results;
- limitations;
- editorial use;
- verification status.

A link alone is not a source record.

### Stage 4 — Extract claims before writing prose

Create claim IDs such as C001, C002, C003.

For each material claim record:

- exact claim;
- whether it is descriptive, quantitative, causal, interpretive or normative;
- supporting sources;
- contradicting sources;
- whether support is direct or inferential;
- confidence level;
- last checked date;
- wording constraints.

Do not write a confident sentence first and look for a citation later.

### Stage 5 — Triangulate

For consequential factual claims:

- prefer the primary source;
- independently verify important numbers, dates and policy language;
- use more than one source when the claim is broad or contested;
- distinguish a paper's finding from our interpretation of that finding;
- distinguish peer-reviewed work from preprints;
- avoid turning correlation into causation.

### Stage 6 — Contradiction search

Before synthesis, actively search for evidence that weakens the emerging thesis.

Required questions:

- What result would make our thesis less convincing?
- Is there a domain in which the opposite is true?
- Is a prominent result disputed?
- Is the evidence observational rather than causal?
- Is the benchmark measuring what we say it measures?
- Are there hidden selection effects?
- Does a later paper materially change the earlier conclusion?

A Topic is incomplete until its strongest counter-case is represented.

### Stage 7 — Fact-check loop

Every publishable factual claim goes through:

1. Claim written in atomic form.
2. Primary or best available source attached.
3. Source opened and claim checked against what the source actually says.
4. Quantitative values, dates, names and policy details checked separately.
5. Independent search performed for contradiction or correction.
6. Evidence classified: direct / indirect / interpretation.
7. Confidence assigned: high / medium / low.
8. Low-confidence claims are qualified, moved to open questions, or removed.
9. Check date recorded.
10. If a time-sensitive claim changes, dependent prose is re-run through the loop.

### Stage 8 — Synthesis

Only after the evidence map is stable should the main essay be written.

The synthesis must separate:

- known;
- strongly supported;
- plausible but unsettled;
- disputed;
- unknown.

### Stage 9 — Adversarial editorial review

Run a hostile review of the draft:

- Which sentence overclaims?
- Which source is doing too much work?
- Which number lacks context?
- Which case study is cherry-picked?
- Which important opposing source is missing?
- Which term changes meaning across sections?
- Which statement sounds scientific but is only rhetoric?
- What would an expert in the field challenge first?

### Stage 10 — Quality gate

The Topic cannot move to publish-ready until the quality checklist passes.

Required dimensions:

- factual accuracy;
- source quality;
- source diversity;
- primary-source coverage;
- recency where needed;
- conceptual precision;
- counterargument quality;
- internal consistency;
- uncertainty handling;
- readability;
- simulation integrity;
- traceability from page claim to source.

### Stage 11 — Freeze a research snapshot

A publishable Topic should record:

- research version;
- research freeze date;
- source count;
- claim count;
- unresolved questions;
- last fact-check date;
- next scheduled review trigger.

This makes future updates auditable rather than invisible.

---

## Evidence tiers

### Tier A — Primary / authoritative
Original peer-reviewed research, official policy, standards, formal documentation, datasets, direct records.

### Tier B — High-quality synthesis
Systematic reviews, major review papers, research briefings tightly tied to primary literature.

### Tier C — Expert interpretation
Perspective pieces, editorials, expert commentary.

### Tier D — Discovery lead
News reports, social posts, videos, informal commentary. Useful for finding questions or sources, not sufficient for important factual claims by themselves.

---

## Confidence language

### High
Directly supported by strong evidence and independently checked.

### Medium
Supported but limited by design, scope, recency, or lack of replication.

### Low
Interesting and relevant, but not strong enough to state as settled fact.

Low-confidence material belongs in open questions or explicitly qualified prose.

---

## Reference architecture

Each Topic folder should contain:

- `README.md` — manifest and research status
- `00-scope.md`
- `01-definitions.md`
- `02-evidence-map.md`
- `03-deep-synthesis.md`
- `04-case-studies.md`
- `05-governance-and-integrity.md`
- `06-timeline.md`
- `07-video.md`
- `08-simulation.md`
- `09-viewpoints.md`
- `10-open-questions.md`
- `11-discussion.md`
- `fact-check.md`
- `quality-check.md`
- `sources/README.md`
- one Markdown file per retained source

This layout is deliberately machine-readable and human-readable.
