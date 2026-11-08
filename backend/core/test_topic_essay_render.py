from types import SimpleNamespace

from django.test import SimpleTestCase
from lxml import html

from .topic_essay_api import public_essay_context
from .topic_essay_render import render_essay


SOURCE = """---
title: "Editorial title"
standfirst: "[pending]"
status: draft-1
---

<!-- Internal conventions
::: pullquote ... :::
-->

Opening with a <abbr title="Definition &amp; context">term</abbr> and a [citation](#ref-study).
<script>alert(1)</script>

::: pullquote
A reader-facing quote.
— An Author
:::

::: godeeper "A closer look"
More context.
:::

::: box "Key points"
- Keep the first point.
- Keep the last point. :::

::: figure id=rate-chart
**Chart 1. Fabricated references.**
Type: an internal layout direction.
Data ([A study](#ref-study)): 2023: 1 in 2,828 · early 2026 (first 7 weeks): 1 in 277.
Caption: "A public caption."
:::

::: figure id=raw-vs-matched
**Chart 2. Raw versus matched.**
Two panels of grouped bars; values from [A study](#ref-study).

- *Individual advantage*, raw: papers ×3.02.
- Field-level: topic range −4.63%. Caption: "A comparison." :::

## References

<a id="ref-study"></a>A published source.

---

<!-- DRAFTING NOTES — remove before publication -->

## Drafting notes (not for publication)

Private editorial material.
"""


class TopicEssayRenderTests(SimpleTestCase):
    def test_public_components_and_citations_render_without_editorial_markers(self):
        title, result = render_essay(SOURCE, 'essay-overview')
        self.assertEqual(title, '')
        fragment = html.fragment_fromstring(result, create_parent=True)
        self.assertIn('Opening with a term and a citation.', fragment.text_content())
        self.assertEqual(fragment.xpath('string(.//abbr/@title)'), 'Definition & context')
        self.assertEqual(fragment.xpath('string(.//a/@href)'), '#essay-overview-ref-study')
        self.assertTrue(fragment.xpath('.//*[@id="essay-overview-ref-study"]'))
        self.assertEqual(fragment.xpath('string(.//figure[1]/figcaption)'), 'An Author')
        self.assertEqual(fragment.xpath('string(.//details/summary)'), 'A closer look')
        self.assertFalse(fragment.xpath('.//details/@open'))
        self.assertEqual(len(fragment.xpath('.//aside//li')), 2)
        self.assertEqual(len(fragment.xpath('.//meter')), 2)
        self.assertEqual(len(fragment.xpath('.//table//tr')), 2)
        self.assertIn('A public caption.', fragment.text_content())
        self.assertIn('A comparison.', fragment.text_content())
        self.assertFalse(fragment.xpath('.//script|.//hr'))
        for private in ('draft-1', '[pending]', 'Internal conventions', ':::', 'layout direction',
                        'panels of grouped bars', 'Private editorial material'):
            self.assertNotIn(private, result)

    def test_pulsar_reads_the_same_public_projection(self):
        essay = SimpleNamespace(markdown=SOURCE, depth='overview', source_path='')
        text = public_essay_context(essay)
        self.assertIn('A published source.', text)
        self.assertIn('Keep the last point.', text)
        self.assertNotIn('Private editorial material', text)
        self.assertNotIn('draft-1', text)

    def test_a_drafting_heading_alone_ends_public_content(self):
        _, result = render_essay('# Title\n\nPublic text.\n\n## Drafting notes\n\nInternal.', 'essay-deep')
        self.assertEqual(result.strip(), '<p>Public text.</p>')
