# Cheap to Produce, Costly to Trust

*The first essay in this series, "The Reference That Never Existed", looked at what AI is doing to the written record of science. This one asks about the other end: what happens when AI is asked to do the science.*

Researchers at Princeton and the UK AI Security Institute gave frontier AI agents two real, unpublished research projects. Each run had six days and $3,000 in computing credits, and no human help. The agents did what the researchers describe as "all of the engineering": they wrote the code, ran the experiments and assembled the results. What they could not do was answer the research question. The scientists who had written the original papers graded the agents' work, and "both papers were unambiguously rejected by the authors" [Kirgis, 2026](#ref-kirgis-2026).

::: pullquote
“The agents completed all of the engineering without human help, yet could not make substantial progress towards answering the research questions.”
— Kirgis et al., 2026
:::

That result carries the theme of this essay. Producing text, code and even complete experiments is becoming cheap. Judging whether any of it is right or worth doing is not. In the first essay, the cheap thing was prose and the costly thing was checking a reference. Here the cheap thing is a whole research workflow, and the costly thing is knowing whether it found anything.

The study is small and the authors say so: two projects, graded by the people whose work was being reproduced, with no blinding. They also note that agents now reproduce published results "far better than they could two years ago". So the finding is not that agents cannot do science. It is narrower, and more useful.

## A spectrum of failure

Other tests show the same gap in different shapes. An independent team ran eight open-source "AI scientist" frameworks on two real research tasks. None completed a full cycle from reading the literature to a validated result and a written paper. "Every framework produced sophisticated hallucinations." In the multi-agent setups, agents sometimes assumed that other agents had computed results that never existed, a pattern the authors call circular hallucination [Agrawal, 2026](#ref-agrawal-2026).

The frontier agents in the Princeton study behaved differently. They did not hide or misrepresent experiments to make a result look better. Five times, a sub-agent invented or misreported a result, and each time the supervising agent, which had been told to double-check, caught it. The failures were about research judgment. The agents set a poor bar for what counted as publishable. They responded to flaws in an experiment without creativity. They did not back out of dead ends. They used poor judgment about resources: both runs ended with less than half of the budget spent, though the agents could see their own usage. And they drifted from their instructions [Kirgis, 2026](#ref-kirgis-2026).

So the picture has two stages. The 2025-era open-source frameworks invented results. The 2026 frontier agents reported honest but weak ones. Both findings come from small studies, and the contrast between them should be held loosely.

## The strongest counter-example, read carefully

The strongest claim on the other side was published in *Nature*. A team, most of whom work for or consult for the company Sakana AI, reported that an AI system generated a paper that passed peer review at a workshop at a major conference [Lu, 2026](#ref-lu-2026).

That is real, and narrow. The workshop accepted about 70% of submissions; the conference's main track accepted 32%. Only one of the system's three submissions was accepted, and the developers "manually filtered the most promising outputs at each stage". The authors report all three submissions. And the Princeton team explains why one acceptance proves little:

::: pullquote
“A developer testing their automatically generated AI research papers using blind review can submit many papers, report the acceptances, and never disclose the failed attempts, so an acceptance says little about how reliably a system produces good research.”
— Kirgis et al., 2026
:::

The point is not that the Nature paper is wrong. A single success, selected and reported by the developer, answers "can it ever happen?" and not "how often does it happen?" The second question is the one that matters for a scientist deciding whether to trust a result.

## Why checking is hard

If producing is cheap, checking should be the place to put the effort. The evidence says checking is hard for machines and humans alike.

Start with the agents' own judgment. The Princeton team found that current frontier models "remain poor discriminators of task success, even as their accuracy has increased": they have got better at the tasks without getting much better at judging whether they succeeded. A benchmark called REPRO-Bench asks agents not to re-run a paper but to judge whether it is reproducible and sound, and in one account the best off-the-shelf agent scored 21.4% [Kassis, 2026](#ref-kassis-2026). That account comes from a blog by a company that sells AI research agents, so read it as a claim about one benchmark and not as a general result.

The scoreboards are shaky too. A review of 55 studies on benchmark contamination, which is when test questions leak into training data, reported inflation of roughly 6–40% in selected settings, and no detection method that worked reliably across them. The authors call these medium-confidence estimates, cite counter-evidence, and cover general benchmarks, not scientific ones [Nourbakhsh, 2026](#ref-nourbakhsh-2026). On a realistic medical test, leading research agents answered only about a quarter of multistep questions correctly [Wong, 2026](#ref-wong-2026).

And the research record itself is slippery. Closed models change without notice, and studies often omit the model version, the prompt and the sampling settings, or run a measurement once [Kiy, 2026](#ref-kiy-2026). Before language models, a compilation of earlier reviews found <abbr title="Information from outside the training set slipping into a machine-learning model's inputs, so that reported performance is better than real performance.">data leakage</abbr> inflating results in 17 fields, affecting at least 294 papers. In one case study, errors appeared in 4 of 12 civil-war prediction papers, and when they were corrected, "complex ML models do not perform substantively better than decades-old LR models" [Kapoor, 2023](#ref-kapoor-2023). That work predates language models, and 294 is a lower bound.

Human checking is not a gold standard either. In NeurIPS experiments where two committees reviewed the same papers, they disagreed on about a quarter of accept/reject decisions, and about half of the accepted papers would have been rejected on a rerun (citing those experiments)[Kirgis, 2026](#ref-kirgis-2026). The bottleneck is not that humans are reliable and machines are not. It is that neither is yet reliable at judging research at volume.

## The productive scientist and the shrinking map

Meanwhile, AI tools have been paying off for individual careers. A *Nature* study of about 41 million papers, of which 310,957 were AI-augmented, found that scientists who use AI methods publish 3.02 times more papers, receive 4.84 times more citations and become project leaders 1.37 years earlier. At the same time, AI adoption shrinks the collective range of topics studied by 4.63% and reduces scientists' engagement with each other by 22% [Hao, 2026](#ref-hao-2026).

::: box "Chart 2 · Raw versus matched (Hao et al., R23)"
Horizontal bars. Raw advantage for scientists using AI: about plus 202 percent more papers and plus 384 percent more citations. Matched comparison at career year 10: plus 9.6 percent annual output and plus 24.5 percent annual citations.

The gap between a raw and a matched comparison is how much of the claim survives. The bars are not the same measure (our conversion of “×” to “+%”).
:::

Two cautions apply. The comparisons in the headline are raw. When the scientists using AI are matched to similar peers, the advantage drops, though it remains. And "AI" in that study mostly means classical machine learning and deep learning, not chatbots: generative AI gets a "necessarily more preliminary" treatment, and the authors cannot establish causation. One mechanism they point to is data. Areas rich in data are "increasingly and disproportionately amenable to AI research". Where the data is, the work goes, which can leave other questions unasked. The authors also note a possible upside: overlapping attention may help replication.

There was a 2024 warning to this effect. Messeri and Crockett had warned that shared tools could create "scientific monocultures" in which some methods and questions dominate the others [Messeri, 2024](#ref-messeri-2024). The 2026 data now give that warning large-scale empirical support, but they are not a verdict.

## What happens to the skill

There is a worry underneath all this: that routine help from AI wears down the skill it replaces. Direct evidence from research is missing. The two nearest cases come from outside it.

In a multicentre study of 19 experienced endoscopists, the rate at which they found adenomas in standard colonoscopies fell from 28.4% to 22.4% after a period of using an AI aid, now measured without it [Budzyń, 2025](#ref-budzyn-2025). The study was observational. Its authors name confounders, including a suspended national screening programme that nearly doubled procedure numbers.

In a preprint that has not been peer reviewed, 54 students wrote essays under different conditions. In the first session, 83% of those using ChatGPT (15 of 18) had difficulty quoting the essay they had just written, and none quoted it correctly; the gap shrank with practice [Kosmyna, 2025](#ref-kosmyna-2025). In the final session only 18 students took part, and using the model only after writing unaided was associated with better recall.

Both are analogies. Whether researchers lose skills in writing, statistics or critical reading when they lean on AI has not been measured. We do not know yet, and the answer is the one piece of evidence this field most needs.

::: box "Beyond reliability"
Reliability is not the only concern in the research package. Briefly, with the main facts:

- **Dual use.** A drug-discovery model, run in reverse, generated 40,000 candidate toxic molecules in under six hours, including the nerve agent VX. The molecules were computer-designed; none was synthesised [Urbina, 2022](#ref-urbina-2022).
- **Compute divide.** Academic labs produced about 65% of notable machine-learning models in the early 2010s and about 10% in the early 2020s (data to 2022) [Besiroglu, 2024](#ref-besiroglu-2024).
- **Confidentiality.** The US National Institutes of Health forbids its peer reviewers from uploading grant applications to generative AI tools [National Institutes of Health, 2023](#ref-nih-2023).
- **Copyright.** In 2025 a US district court held that training a model on books was fair use but that building a permanent library of pirated copies was not; a $1.5 billion settlement received final approval in July 2026 [Bartz v, 2025](#ref-bartz-2025). It is one district-court order, not binding precedent.
- **Energy.** The IEA projects data-centre electricity use to rise from 415 TWh in 2024 to 945 TWh in 2030; not all of it is AI [Chen, 2025](#ref-chen-2025).
:::

## What we know

Return to the two agents with their six days and their $3,000. Measured: current agents can build experiments and cannot reliably decide whether a result is worth anything; open-source frameworks have fabricated results; scientists who use AI methods gain individually while the range of topics narrows; and clinicians and students lost something measurable when AI was removed. Disputed: how much language models raise productivity, and whether polished prose still signals quality. Claimed, not measured: monocultures, illusions of understanding, and deskilling among researchers.

We see a consistent pattern across both essays. When something becomes cheap to produce, the scarce skill moves to checking it, and the checking has to be done by someone who can still tell. That is a reason to keep that skill in practice, not to give it up.

What would change this reading? A blind, pre-registered test of agents on open research questions, with failures reported alongside successes, would show whether the gap is closing. A direct measurement of research-skill decline after routine AI use would turn an analogy into evidence. Either could come out better or worse than the picture here.

::: box "If you only remember"
1. Agents can now do the engineering of research; the unsolved part is the judgment about what is worth doing and whether it worked.
2. The strongest success stories come from developers, are selected, and have limits that are easy to miss.
3. What helps a career may narrow a field, and the evidence for that is real but not yet causal.
:::

::: box "What you can do"
- Put a human check wherever one tool's output feeds the next, as with the supervising agent that caught the five invented results.
- Report the model version, the prompt and the settings, and run it more than once.
- Treat an AI's output as a hypothesis, not an authority. That is the recommendation of the open-source study too.
- Keep practising the skills you delegate, at least often enough to notice an error.
:::

## References

<a id="ref-agrawal-2026"></a>Agrawal, S., Anadkat, H. B., … Xie, L., & Sinitskiy, A. V. (2026). Can AI conduct autonomous scientific research? Case studies on two real-world tasks. bioRxiv. https://doi.org/10.64898/2026.01.05.697809

<a id="ref-bartz-2025"></a>Bartz v. Anthropic PBC, No. C 24-05417 WHA (N.D. Cal. 23 June 2025), Order on fair use. Settlement: Petersen, J., Trigg, J. A., & Ross, G. M. (2025, 11 September). Parties reach a landmark settlement in the Bartz v. Anthropic litigation. Kilpatrick Townsend. https://ktslaw.com/insights/alert/2025/9/parties-reach-a-landmark-settlement-in-the-bartz-v-anthropic-litigation. Final approval reported by JURIST, 22 July 2026.

<a id="ref-besiroglu-2024"></a>Besiroglu, T., Bergerson, S. A., Michael, A., Heim, L., Luo, X., & Thompson, N. (2024). The compute divide in machine learning: A threat to academic contribution and scrutiny? arXiv:2401.02452. https://arxiv.org/abs/2401.02452

<a id="ref-budzyn-2025"></a>Budzyń, K., Romańczyk, M., Kitala, D., … Bretthauer, M., & Mori, Y. (2025). Endoscopist deskilling risk after exposure to artificial intelligence in colonoscopy: A multicentre, observational study. Lancet Gastroenterology & Hepatology, 10(10). https://doi.org/10.1016/S2468-1253(25)00133-5

<a id="ref-chen-2025"></a>Chen, S. (2025, 10 April). Data centers will use twice as much energy by 2030, driven by AI. Scientific American (reporting the IEA's Energy and AI). https://www.scientificamerican.com/article/ai-will-drive-doubling-of-data-center-energy-demand-by-2030/

<a id="ref-hao-2026"></a>Hao, Q., Xu, F., Li, Y., & Evans, J. (2026). Artificial intelligence tools expand scientists' impact but contract science's focus. Nature, 649, 1237–1243. https://doi.org/10.1038/s41586-025-09922-y

<a id="ref-kapoor-2023"></a>Kapoor, S., & Narayanan, A. (2023). Leakage and the reproducibility crisis in machine-learning-based science. Patterns, 4, 100804. https://doi.org/10.1016/j.patter.2023.100804

<a id="ref-kassis-2026"></a>Kassis, T. (2026, 16 June). Reproduction, not generation, is AI's killer app for science. K-Dense blog. https://k-dense.ai/blog/reproduction-not-generation-ai-for-science

<a id="ref-kirgis-2026"></a>Kirgis, P., Kapoor, S., Schwartz, A., Rabanser, S., Africa, D., … Bommasani, R., & Narayanan, A. (2026). Can AI agents conduct open-ended AI research? Early evidence from two case studies (v2). arXiv:2607.27191. https://arxiv.org/abs/2607.27191

<a id="ref-kiy-2026"></a>Kiy, K. D., Porshnev, A., Lakhzoum, D., Lynott, D., O'Donoghue, D., & Singh, M. (2026). Reproducibility under threat: Proposing a framework for reliable LLM-research in psychology and computational social science. Proceedings of PoliticalNLP 2026 @ LREC 2026, 171–179. https://aclanthology.org/2026.politicalnlp-1.19/

<a id="ref-kosmyna-2025"></a>Kosmyna, N., Hauptmann, E., Yuan, Y. T., Situ, J., Liao, X.-H., Beresnitzky, A. V., Braunstein, I., & Maes, P. (2025). Your brain on ChatGPT: Accumulation of cognitive debt when using an AI assistant for essay writing task (v2). arXiv:2506.08872. https://arxiv.org/abs/2506.08872

<a id="ref-lu-2026"></a>Lu, C., Lu, C., Lange, R. T., Yamada, Y., Hu, S., Foerster, J., Ha, D., & Clune, J. (2026). Towards end-to-end automation of AI research. Nature, 651, 914–919. https://doi.org/10.1038/s41586-026-10265-5

<a id="ref-messeri-2024"></a>Messeri, L., & Crockett, M. J. (2024). Artificial intelligence and illusions of understanding in scientific research. Nature, 627, 49–58. https://doi.org/10.1038/s41586-024-07146-0

<a id="ref-nih-2023"></a>National Institutes of Health. (2023, 23 June). The use of generative artificial intelligence technologies is prohibited for the NIH peer review process (Notice NOT-OD-23-149). https://grants.nih.gov/grants/guide/notice-files/NOT-OD-23-149.html

<a id="ref-nourbakhsh-2026"></a>Nourbakhsh, E., Sirjani, M. S., Mousavi, A., Nguyen, K., Quarles, J., Xie, M., & Slavin, R. (2026). Are LLM benchmarks already contaminated? A systematic review of contamination detection methods. Proceedings of GEM 2026, 518–539. https://aclanthology.org/2026.gem-main.50/

<a id="ref-urbina-2022"></a>Urbina, F., Lentzos, F., Invernizzi, C., & Ekins, S. (2022). Dual use of artificial-intelligence-powered drug discovery. Nature Machine Intelligence, 4, 189–191. https://doi.org/10.1038/s42256-022-00465-9

<a id="ref-wong-2026"></a>Wong, M. Y. H., Ong, A. Y., Merle, D. A., & Keane, P. A. (2026). Deep research agents: Major breakthrough or incremental progress for medical AI? Journal of Medical Internet Research, 28, e88195. https://doi.org/10.2196/88195

## Drafting notes

- Level: Undergrad. Draft converted on 2026-11-12 from the external design review (tests/topic.html). Not reviewed. Nothing below this heading is published.
- Every citation points at an entry in the References above; entries marked -rN came from the design's own source list and are not in the Researcher level.
- Figure "Chart 2 · Raw versus matched (Hao et al., R23)" was a drawing in the design; written here as a box. Replace with a real figure if wanted.
