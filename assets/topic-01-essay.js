/* The homepage teaser and the Topic reader use the same published snapshot.

   The route returns two slots, overview and deep. When both carry a label they
   are two separate essays, and each page lists them to choose between. Without
   labels they are one essay at two depths, and the Topic page shows the site's
   depth switch (.depth, site.js), which stays hidden otherwise. */
(function () {
  'use strict';
  const reader = document.querySelector('[data-topic-essay-reader]');
  const excerpt = document.querySelector('[data-topic-essay-excerpt]');
  let overviewTitles = [];
  let deepTitles = [];
  const depthBar = document.querySelector('[data-essay-depth]');
  const updateTitle = (nodes, title) => nodes.forEach(node => { node.textContent = title; });
  const slotOf = depth => reader?.querySelector(`[data-essay="${depth}"]`);
  const TOPIC_PAGE = 'topic-answer-that-looked-right.html';

  const firstParagraph = fragment => {
    const text = fragment.querySelector('p')?.textContent?.trim() || '';
    return text.length > 360 ? text.slice(0, 357).trimEnd() + '…' : text;
  };

  /* One row per essay: its number and title. Each is a real link. */
  function fillList(list, prefix, found, page) {
    found.forEach((essay, index) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = page + '#essay-' + (index + 1);
      link.dataset.title = essay.title;
      link.dataset.open = essay.text;
      if (index === 0) link.setAttribute('aria-current', 'true');
      const number = document.createElement('span');
      number.className = prefix + 'n';
      number.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = prefix + 't';
      name.textContent = essay.title;
      link.append(number, name);
      item.append(link);
      list.append(item);
    });
  }

  /* Home page: the two essays are one panel of the rail (topic-rail.js does the
     choosing). */
  function listEssaysInRail(found) {
    const panel = excerpt?.closest('.trail__panel');
    const side = panel?.querySelector('.trail__side');
    if (!side) return;
    const list = document.createElement('ol');
    list.className = 'trail__set';
    list.setAttribute('aria-label', 'Essays in this Topic');
    fillList(list, 'trail__set-', found, TOPIC_PAGE);
    const act = side.querySelector('.trail__act');
    if (act) act.before(list); else side.append(list);
    panel.setAttribute('data-rail-set', '');
  }

  /* Topic page: one essay at a time, opened directly by #essay-1 or #essay-2. */
  function listEssaysOnPage(found) {
    const list = document.querySelector('[data-essay-set]');
    if (!list) return;
    fillList(list, 'ta-set__', found, '');
    list.hidden = false;
    const links = [...list.querySelectorAll('a')];
    const slots = ['overview', 'deep'].map(slotOf);
    const show = index => {
      links.forEach((link, k) => {
        if (k === index) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
        slots[k].hidden = k !== index;
      });
    };
    links.forEach((link, index) => link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      show(index);
    }));
    const linked = links.findIndex(link => link.getAttribute('href') === location.hash);
    if (linked >= 0) {
      show(linked);
      document.getElementById('essay')?.scrollIntoView();
    }
  }

  /* One essay at two depths: both slots become the site's levels. */
  function showDepthSwitch() {
    for (const depth of ['overview', 'deep']) {
      const slot = slotOf(depth);
      if (!slot) return;
      slot.dataset.level = depth;
      slot.hidden = false;
    }
    if (depthBar) depthBar.hidden = false;
  }

  /* The record draws some of the elements the titles go into, so it goes first. */
  (window.GQTopic01 || Promise.resolve())
    .then(() => {
      overviewTitles = document.querySelectorAll('[data-topic-essay-title]');
      deepTitles = document.querySelectorAll('[data-topic-essay-deep-title]');
      return fetch('/api/topics/answer-that-looked-right/essays/', { cache: 'no-store' });
    })
    .then(response => {
      if (!response.ok) throw new Error('Essay unavailable');
      return response.json();
    })
    .then(({ essays }) => {
      const standalone = essays.overview?.label && essays.deep?.label;
      if (standalone) {
        document.querySelectorAll('[data-topic-essay-intro]').forEach(node => {
          node.textContent = node.dataset.topicEssayIntro;
        });
      }
      const found = [];
      for (const depth of ['overview', 'deep']) {
        const essay = essays[depth];
        if (!essay) continue;
        // The API renders Markdown with raw HTML disabled and unsafe links filtered.
        const content = document.createElement('template');
        content.innerHTML = essay.html;
        const title = essay.title || (depth === 'overview' ? 'Overview' : 'In depth');
        const text = firstParagraph(content.content);
        if (depth === 'overview' && excerpt) {
          excerpt.textContent = text;
          excerpt.closest('blockquote').hidden = !text;
        }
        if (standalone) found.push({ title, text });
        updateTitle(depth === 'overview' ? overviewTitles : deepTitles, title);
        const target = slotOf(depth);
        if (target) {
          const heading = document.createElement('h3');
          heading.textContent = title;
          target.replaceChildren(heading, content.content);
        }
      }
      if (found.length > 1) {
        listEssaysInRail(found);
        listEssaysOnPage(found);
      } else if (essays.overview && essays.deep) {
        showDepthSwitch();
      }
    })
    .catch(() => {
      if (excerpt) excerpt.closest('blockquote').hidden = true;
      updateTitle(overviewTitles, 'Topic 01 essay');
      updateTitle(deepTitles, 'Topic 01 essay');
      if (!reader) return;
      reader.querySelectorAll('[data-essay]').forEach(node => node.replaceChildren());
      const error = reader.querySelector('[data-topic-essay-error]');
      error.textContent = 'The essay is temporarily unavailable. Reload to try again.';
      error.hidden = false;
    });
})();
