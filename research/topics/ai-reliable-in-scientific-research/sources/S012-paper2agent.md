---
id: S012
title: Reimagining research papers as interactive and reliable AI agents
authors: Jiacheng Miao et al.
date: 2026-09-16
venue: Nature
type: primary-research
peer_reviewed: true
evidence_tier: A
url: https://www.nature.com/articles/s41586-026-11044-y
doi: 10.1038/s41586-026-11044-y
verified: true
last_checked: 2026-10-04
supports_claims: [C010, C013, C014]
---

# S012 — Paper2Agent

## Core idea
Convert a paper plus code/data/workflows into an MCP-style agent interface with validated executable tools.

## Reported results
Among 100 computational-biology papers:
- 74 successfully agentified;
- 599 tools proposed;
- 593 passed automated validation.

The paper also reports:
- 91.2 ± 1.6% accuracy on 300 tutorial-derived questions in one evaluation;
- 98.1 ± 0.8% accuracy across 42 execution tasks from 10 non-biology computational papers.

## Reliability mechanism
Generated tools are tested against reference outputs and repeatedly failing tools are excluded.

## Limitation
Open-ended scientific interpretation remains human-in-the-loop in the authors' framing.
