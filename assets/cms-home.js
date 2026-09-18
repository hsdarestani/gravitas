(function () {
  'use strict';
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;

  var section = document.getElementById('current-topic');
  if (!section) return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function topicUrl(item, hash) {
    return '/topic.html?slug=' + encodeURIComponent(item.slug) + (hash || '');
  }
  function setText(selector, value) {
    var node = section.querySelector(selector);
    if (node && value != null) node.textContent = value;
  }
  function setHref(selector, value) {
    var node = section.querySelector(selector);
    if (node) node.href = value;
  }

  fetch('/api/content/?kind=topic&limit=1', {
    credentials: 'same-origin',
    cache: 'no-store'
  })
    .then(function (response) {
      if (!response.ok) throw new Error('topic_list');
      return response.json();
    })
    .then(function (data) {
      var item = (data.items || [])[0];
      if (!item) {
        section.remove();
        return;
      }
      var topic = item.topic_data || {};
      var landing = topic.landing || {};
      var timeline = Array.isArray(topic.timeline) ? topic.timeline : [];
      var viewpoints = topic.viewpoints || {};
      var url = topicUrl(item, '');

      setText('.trail__now b', item.title);
      var panels = section.querySelectorAll('.trail__panel');

      if (panels[0]) {
        var n = panels[0].querySelector('.trail__n');
        if (n) n.innerHTML = '01 &middot; THE QUESTION';
        var h = panels[0].querySelector('h3');
        if (h) h.textContent = item.title;
        var say = panels[0].querySelector('.trail__say');
        if (say) say.textContent = item.summary || topic.hero_lead || '';
        var meta = panels[0].querySelector('.trail__meta');
        if (meta) meta.textContent = landing.essay_meta || 'Essay · Video · Sources · Simulation';
        var links = panels[0].querySelectorAll('.trail__act a');
        if (links[0]) { links[0].href = topicUrl(item, '#essay'); links[0].textContent = 'Read the essay'; }
        if (links[1]) links[1].href = topicUrl(item, '#sim');
        var video = panels[0].querySelector('.video');
        if (video) {
          video.href = topicUrl(item, '#video');
          video.setAttribute('aria-label', 'Open video: ' + item.title);
        }
      }

      if (panels[1]) {
        var title = panels[1].querySelector('h3');
        if (title) title.textContent = landing.pictures_title || 'Four pictures it keeps returning to';
        var copy = panels[1].querySelector('.trail__say');
        if (copy) copy.textContent = landing.pictures_text || 'A visual path through how the question developed.';
        var timelineLink = panels[1].querySelector('.trail__act a');
        if (timelineLink) timelineLink.href = topicUrl(item, '#timeline');
        var gallery = panels[1].querySelector('.trail__gal');
        if (gallery) {
          gallery.innerHTML = '';
          timeline.filter(function (row) { return row.image_url; }).slice(0, 4).forEach(function (row, index) {
            var figure = document.createElement('figure');
            figure.className = 'trail__fig' + (index === 0 ? ' trail__fig--face' : '') + (index === 3 ? ' trail__fig--wide' : '');
            figure.innerHTML =
              '<img src="' + esc(row.image_url) + '" alt="' + esc(row.image_alt || '') + '" loading="lazy" decoding="async">' +
              '<figcaption><b>' + esc((row.title || '') + (row.date ? ', ' + row.date : '')) + '</b>' +
              '<span>' + esc(row.description || '') + '</span></figcaption>';
            gallery.appendChild(figure);
          });
        }
      }

      if (panels[2]) {
        var left = panels[2].querySelector('.view--for');
        var right = panels[2].querySelector('.view--against');
        if (left) {
          var tag = left.querySelector('.view__tag'); if (tag) tag.textContent = viewpoints.left_label || 'Viewpoint A';
          var p = left.querySelector('p:not(.view__tag)'); if (p) p.textContent = viewpoints.left_text || '';
          var cite = left.querySelector('cite'); if (cite) cite.textContent = viewpoints.left_cite || '';
        }
        if (right) {
          var rtag = right.querySelector('.view__tag'); if (rtag) rtag.textContent = viewpoints.right_label || 'Viewpoint B';
          var rp = right.querySelector('p:not(.view__tag)'); if (rp) rp.textContent = viewpoints.right_text || '';
          var rcite = right.querySelector('cite'); if (rcite) rcite.textContent = viewpoints.right_cite || '';
        }
        var vpLink = panels[2].querySelector('.trail__act a');
        if (vpLink) vpLink.href = topicUrl(item, '#views');
      }

      if (panels[3]) {
        var dh = panels[3].querySelector('h3');
        if (dh) dh.textContent = landing.discussion_title || 'The argument is already running';
        var ds = panels[3].querySelector('.trail__say');
        if (ds) ds.textContent = landing.discussion_text || 'Read the discussion or add your own reply after signing in.';
        var dlinks = panels[3].querySelectorAll('.trail__act a');
        if (dlinks[0]) dlinks[0].href = topicUrl(item, '#talk');
        var talk = panels[3].querySelector('.trail__talk');
        if (talk) {
          talk.innerHTML =
            '<div class="callout"><p class="g-eyebrow">Discussion</p>' +
            '<h4>No placeholder comments</h4>' +
            '<p>Published comments load on the Topic page. Sign in there to comment, reply or like.</p>' +
            '<p><a class="g-btn g-btn--secondary g-btn--sm" href="' + topicUrl(item, '#talk') + '">Open discussion</a></p></div>';
        }
      }

      section.querySelectorAll('a[href="topic-computable-universe.html"],a[href^="topic-computable-universe.html#"]').forEach(function (link) {
        var hash = '';
        var old = link.getAttribute('href') || '';
        if (old.indexOf('#') >= 0) hash = old.slice(old.indexOf('#'));
        link.href = topicUrl(item, hash);
      });

      window.dispatchEvent(new Event('resize'));
    })
    .catch(function () {
      /* Keep the original horizontal rail as a resilient fallback. */
    });
})();