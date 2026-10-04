# Governance and scientific integrity

## The governance problem

Generative systems change the economics of scholarly production.

They reduce the cost of creating plausible prose, citations, reviews, hypotheses and code. They do not automatically reduce the cost of validating those artifacts.

That produces a verification asymmetry.

## Current Nature / Springer Nature direction

The current Nature AI policy uses a risk-based framework rather than a simple tool ban.

Key principles include:

- human accountability is non-transferable;
- AI may support but not replace scholarly judgement;
- transparency is required;
- confidentiality and data protection are mandatory;
- opaque or unverifiable AI use that replaces accountable human contribution is not permitted;
- AI cannot be assigned authorship or responsibility;
- peer-review judgement cannot be delegated to an LLM.

Source: S010.

Nature Methods also emphasizes the risk of fabricated references and restrictions on uploading confidential manuscripts into generative systems.

Source: S011.

## Why disclosure is not enough

Disclosure tells us that AI was used.

It does not tell us that:
- the sources are real;
- the sources support the claims;
- the analysis is correct;
- the experiment is reproducible;
- the conclusion follows from the result.

Disclosure is a governance layer, not a verification layer.

## Hallucinated references

Citation hallucination is attractive for auditing because it has a relatively objective core.

Possible classes:

1. non-existent work;
2. real title with wrong authors;
3. real authors with invented title;
4. fabricated DOI;
5. real paper cited for an unrelated claim;
6. bibliographic drift that is erroneous but not necessarily generative hallucination.

The research literature uses different definitions. The Topic must not merge these categories into one prevalence number.

## Recent evidence

Several 2026 preprints report that hallucinated references have entered preprints and peer-reviewed proceedings.

These studies are useful signals but must remain labeled as preprints until peer-reviewed or independently replicated.

For Gravitas+:
- use them to show the failure mode is measurable;
- do not present their largest estimates as settled global prevalence;
- preserve corpus, venue and detection-method context.

Sources: S013, S014.

## Scientific slop

The newest SciSlopBench work argues that scientific slop is not adequately captured by token-level “AI detection.” It proposes dimensions involving structure, argument and artifacts.

This is aligned with the Gravitas+ editorial position:
**quality control must evaluate scientific coherence, not writing fingerprints.**

Source: S015.

## Proposed Gravitas+ minimum standard for AI-assisted research

Any AI-assisted research artifact intended for publication should, where applicable, retain:

- human owner;
- model/tool identity;
- date/version;
- source corpus;
- critical prompts or workflow configuration;
- claim-to-source map;
- executable code or analysis environment;
- uncertainty and known failure modes;
- verification steps;
- correction history.

This is an editorial standard for Gravitas+, not a claim about universal current journal policy.
