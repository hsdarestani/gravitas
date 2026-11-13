# The Reference That Never Existed

Every paper accepted to a top AI conference in 2025 was read by three to five experts. Still, 53 of them cited at least one paper that does not exist [Ansari, 2026](#ref-ansari-2026).

## What the counts say

A team at Columbia checked 97.1 million references in 2.47 million open-access biomedical papers. In 2023, about one paper in 2,828 had at least one invented reference. In the first seven weeks of 2026 it was one in 277 [He, 2026](#ref-he-2026).

::: figure id=rate-chart
Chart 1. Papers with at least one fabricated reference
Data (Topaz et al., 2026): 2023: 1 in 2,828 · 2025: 1 in 458 · early 2026 (first 7 weeks): 1 in 277
Caption: "Small, and growing fast. The smallness is as real as the growth. Per-10,000 values are our conversion from the “1 in N” figures."
:::

That means 276 papers in 277 do not have the problem. One commentator calls it erosion, not collapse [Green, 2026](#ref-green-2026). The size is also uncertain: a second large study puts the rate more than ten times higher than a straight count would [He, 2026](#ref-he-2026). Different studies count different things.

## Why a fake can look right

A language model writes the most plausible next words. A reference list has a very regular shape, so a model can write one that looks right with no real paper behind it. A checker works the other way round: it looks for a matching record and raises a flag when there is none.

::: figure id=fake-citation
Illustration. a constructed example, not a real paper

Marlowe, D., Hsu, P., & Abara, N. (2021). Adaptive sampling bias in sparse longitudinal cohorts. Journal of Sparse Longitudinal Inference, 14(3), 211–229. https://doi.org/10.0000/jsli.2021.0143

- Total fabrication: 66%
- Partial corruption of a real reference: 27%
- Identifier hijacking: 4%
- Placeholder and semantic: 3%
:::

## The harder problem

A real reference that does not say what it is cited for cannot be caught by lookup. Researchers call this the bigger problem [He, 2026](#ref-he-2026). In one test, popular chatbots made scientific summaries sound broader than the originals in 26 to 73 percent of cases [Peters, 2025](#ref-peters-2025).

## What to take from this

::: box "If you only remember"
1. Invented references are rare per paper but rising fast.
2. A reference that exists may still not support the claim.
3. Tools that detect AI text are unreliable, so rules built on them are hard to enforce.
:::

::: box "What you can do"
- Open every reference you cite and check it says what you claim.
- Disclose AI use the way your journal asks.
- When you see a headline percentage, ask what was counted.
:::

## References

<a id="ref-ansari-2026"></a>Ansari, S. (2026). Compound deception in elite peer review: A failure mode taxonomy of 100 fabricated citations at NeurIPS 2025. arXiv:2602.05930. https://arxiv.org/abs/2602.05930

<a id="ref-green-2026"></a>Green, T. (2026, 15 June). Phantom citations and paper mills: How AI fraud reaches patients. SmarterArticles. https://smarterarticles.co.uk/phantom-citations-and-paper-mills-how-ai-fraud-reaches-patients

<a id="ref-he-2026"></a>He, Y., & Bu, Y. (2026). Academic journals' AI policies fail to curb the surge in AI-assisted academic writing. PNAS, 123(9), e2526734123. https://doi.org/10.1073/pnas.2526734123

<a id="ref-peters-2025"></a>Peters, U., & Chin-Yee, B. (2025). Generalization bias in large language model summarization of scientific research. Royal Society Open Science. https://doi.org/10.1098/rsos.241776

## Drafting notes

- Level: Curious. Draft converted on 2026-11-12 from the external design review (tests/topic.html). Not reviewed. Nothing below this heading is published.
- Every citation points at an entry in the References above; entries marked -rN came from the design's own source list and are not in the Researcher level.
- The constructed reference was interactive in the design (select a part). Here it is a plain figure.
