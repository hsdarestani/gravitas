# Topic 01 · reading-level drafts

Four Markdown drafts for the Curious and Undergrad levels of the two Topic 01
essays. The Researcher level of each essay is the text already published.

They were converted on 2026-11-12 from the external design review
(`tests/topic.html`) into the editorial format the site renders
(`backend/core/topic_essay_render.py`): `::: box`, `::: pullquote` and
`::: figure` blocks, citations written `[Author, Year](#ref-slug)`, and a
References list whose entries carry `<a id="ref-slug"></a>`. Every citation in
them resolves to an entry in their own References. Nothing below the
`## Drafting notes` heading of a file is ever published; that section lists
what the conversion could not carry over (an interactive simulation, drawings
written as boxes).

**They are drafts. None of them has been reviewed, and nothing here is live.**

## Publishing a level

1. Review and edit the file.
2. Put it in the Topic 01 research project, next to the published essays, under
   exactly this name (the publish control only offers a level for its own file):

   `02_Working/Research/notes/Challenges_of_AI_in_Research/`

   | File | Slot |
   |---|---|
   | `essay-1-the-reference-that-never-existed.curious.md` | Essay 1 · Curious |
   | `essay-1-the-reference-that-never-existed.undergrad.md` | Essay 1 · Undergrad |
   | `essay-2-cheap-to-produce-costly-to-trust.curious.md` | Essay 2 · Curious |
   | `essay-2-cheap-to-produce-costly-to-trust.undergrad.md` | Essay 2 · Undergrad |

3. Open the file in the workspace and use **Link and publish · Essay N · Level**.

The Topic page offers a level as soon as it is published, and only the levels
that are. The deploy never publishes a level on its own
(`publish_topic_01_essays` handles only the two original essays).
