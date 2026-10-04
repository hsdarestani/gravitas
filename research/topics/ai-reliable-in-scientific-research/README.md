---
topic_id: topic-01-ai-reliability
title: Is AI reliable in scientific research?
status: research
research_version: 0.3
last_researched: 2026-10-04
video_status: awaiting_original_video
source_count: 21
---

# Topic 01 — Is AI reliable in scientific research?

## Working thesis

AI reliability in science is not a stable property of a model. It is an emergent property of a scientific workflow: what the system is asked to produce, what evidence it can access, how uncertainty is represented, what independent process can reject the output, and who remains accountable for error.

## Research status

This folder is the internal Research Pack for the first Gravitas+ Topic.

It is intentionally deeper than the public page. The website should select from this material rather than become the only place where the research exists.

## Layer map

| Layer | File | Purpose |
|---|---|---|
| Research question | 00-scope.md | Scope, assumptions, subquestions |
| Definitions | 01-definitions.md | Operational meaning of reliability, hallucination, verification, slop |
| Evidence map | 02-evidence-map.md | Claim-to-source map |
| Contradictions | 03-contradictions.md | Active search against the working thesis |
| Deep synthesis | 03-deep-synthesis.md | Main research narrative |
| Case studies | 04-case-studies.md | AlphaFold, GNoME, Co-Scientist, formal mathematics, Paper2Agent, AI Scientist |
| Governance | 05-governance-and-integrity.md | Journals, review, hallucinated references, accountability |
| Timeline | 06-timeline.md | Historical development of the question |
| Video | 07-video.md | Reserved for Gravitas+ original video |
| Simulation | 08-simulation.md | Interactive Trust Test + executable prototype |
| Viewpoints | 09-viewpoints.md | Best competing interpretations |
| Open questions | 10-open-questions.md | Unsettled questions and research gaps |
| Discussion | 11-discussion.md | Public prompts |
| Search log | 12-search-log.md | What was searched and what remains |
| Publication map | 13-publication-map.md | Research Pack → public site mapping |
| Fact check | fact-check.md | Atomic claim verification |
| Quality check | quality-check.md | Editorial quality gate |
| Corrections | corrections.md | Public correction history |
| Team input | team-input.md | Internal research leads separated from verified evidence |
| Sources | sources/ | One Markdown record per retained source |

## Current headline answer

AI is reliable enough to transform scientific practice in some bounded tasks and unreliable enough to corrupt scientific communication in others.

The difference is not captured by the word “AI.” It is captured by verification.

The strongest current examples share a pattern: a generative or predictive component is paired with an external judge — experimental data, first-principles computation, a proof assistant, executable tests, or reproducibility checks.

The weakest use cases ask a fluent model to act as its own source of truth.

## Publication rule

No quantitative or policy claim from this folder should be copied to the public site unless it has a claim ID in `02-evidence-map.md` and a non-failing entry in `fact-check.md`.

Preprints must remain visibly labeled as preprints in public-facing copy.
