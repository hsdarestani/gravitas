/* =========================================================================
   TOPIC 01 FROM ITS RECORD
   Everything a reader sees of Topic 01, on its own page and in the rail on the
   home page, comes from one ContentItem, the record the Topic editor under
   Platform Admin saves. The HTML holds headings and empty containers.

   It used to be written into both HTML files by hand, so an admin's save
   changed nothing and the two pages could disagree. There is deliberately no
   copy of the content here to fall back on: a fallback is a second source that
   quietly goes stale, and a failed read says so and offers a retry instead.

   window.GQTopic01 is a promise for the record, or for null when it could not
   be read. topic-answer.js waits on it for the exercise, topic-01-essay.js for
   the elements its titles go into, so this script loads before both.

   Two things stay outside the record on purpose. The essays are published from
   the research project's files, through their own route. The og:image and
   description tags stay in the HTML because a link preview never runs a script.
   ========================================================================= */
(function () {
  'use strict';

  var SLUG = 'answer-that-looked-right';
  var PAGE = 'topic-answer-that-looked-right.html';
  var CHANNEL = 'https://www.youtube.com/@GraviQuest';
  var PLAY = '<span class="video__play"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span>';

  var shell = document.querySelector('[data-topic-01-shell]');
  var rail = document.querySelector('[data-rail][data-public-featured-topic]');

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /* An address the record may point a reader at. Anything else renders as no
     link at all, because an admin's field is still not trusted markup. */
  function safeUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.charAt(0) === '/' && raw.charAt(1) !== '/') return raw;
    try {
      var url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (err) { return ''; }
  }

  function rows(value) {
    return Array.isArray(value) ? value.filter(function (row) { return row && typeof row === 'object'; }) : [];
  }

  function external(url) { return /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : ''; }

  /* Plain text with [label](url) links, which is all a timeline entry needs. */
  function inline(value) {
    return esc(value).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (whole, label, href) {
      var url = safeUrl(href.replace(/&amp;/g, '&'));
      return url ? '<a href="' + esc(url) + '"' + external(url) + '>' + label + '</a>' : label;
    });
  }

  function image(url, alt, size) {
    var src = safeUrl(url);
    if (!src) return '';
    return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="' + size[0] + '" height="' + size[1] + '" loading="lazy" decoding="async">';
  }

  function videos(data) {
    var list = rows(data.videos);
    if (list.length) return list;
    return data.video && typeof data.video === 'object' && Object.keys(data.video).length ? [data.video] : [];
  }

  function youtubeId(address) {
    try {
      var url = new URL(address);
      if (url.hostname.indexOf('youtu.be') >= 0) return url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.pathname.indexOf('/embed/') === 0) return url.pathname.split('/')[2] || '';
      return url.searchParams.get('v') || '';
    } catch (err) { return ''; }
  }

  function poster(video) {
    var src = safeUrl(video.poster_url);
    return src ? '<img class="video__img" alt="" decoding="async" src="' + esc(src) + '">' : '';
  }

  /* ---- The Topic page --------------------------------------------------- */
  function fill(key, markup) {
    var node = shell.querySelector('[data-t1="' + key + '"]');
    if (node) node.innerHTML = markup;
    return node;
  }

  function player(video) {
    var id = video.source_type === 'youtube' ? youtubeId(video.youtube_url) : '';
    if (id) {
      return '<div class="ta-player"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '" title="' + esc(video.title) + '" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
    }
    var file = video.source_type === 'self_hosted' ? safeUrl(video.self_hosted_url) : '';
    if (file) {
      var still = safeUrl(video.poster_url);
      return '<div class="ta-player"><video controls preload="metadata" src="' + esc(file) + '"' + (still ? ' poster="' + esc(still) + '"' : '') + '></video></div>';
    }
    /* No href until the video is public: a play button that goes nowhere is a
       promise the page cannot keep. */
    return '<a class="video is-flat' + (safeUrl(video.poster_url) ? ' has-thumb' : '') + '" aria-label="' + esc(video.poster_alt || video.title) + '" aria-disabled="true">' + poster(video) + PLAY + '</a>';
  }

  function detail(label, value) { return '<dt>' + label + '</dt><dd>' + value + '</dd>'; }

  function namedLink(label, address) {
    var url = safeUrl(address);
    return url ? '<a href="' + esc(url) + '"' + external(url) + '>' + esc(label) + '</a>' : esc(label);
  }

  function videoBlock(video, index) {
    var facts = '';
    if (video.duration) facts += detail('Runtime', esc(video.duration));
    if (video.info) facts += detail('Field', esc(video.info));
    if (index === 0) facts += detail('Essay', '<a href="#essay" data-topic-essay-title data-public-context-essay="overview"></a>');
    var watch = video.source_type === 'youtube' ? safeUrl(video.youtube_url) : '';
    if (watch) facts += detail('Watch', '<a href="' + esc(watch) + '" target="_blank" rel="noopener">On YouTube</a>');
    else if (video.source_type !== 'self_hosted') facts += detail('Watch', '<span class="g-soon">Soon</span> on the <a href="' + CHANNEL + '" target="_blank" rel="noopener">GraviQuest channel</a>');
    if (video.companion_label) facts += detail('Companion', namedLink(video.companion_label, video.companion_url));
    if (video.transcript_label) facts += detail('Transcript', namedLink(video.transcript_label, video.transcript_url));
    return '<div class="ta-video" id="video-' + (index + 1) + '"><div class="split"><div>' + player(video) + '</div><div>' +
      '<h3 style="margin-top:0">' + esc(video.title) + '</h3>' +
      '<p class="g-muted" style="font-size:var(--g-fs-small)">' + esc(video.description) + '</p>' +
      '<dl class="kv g-mt-md">' + facts + '</dl></div></div></div>';
  }

  function videoList(list) {
    if (list.length < 2) return '';
    return '<ol class="ta-set" data-video-set aria-label="Videos in this Topic">' + list.map(function (video, index) {
      return '<li><a href="#video-' + (index + 1) + '"' + (index ? '' : ' aria-current="true"') + '><span class="ta-set__n">' +
        String(index + 1).padStart(2, '0') + '</span><span class="ta-set__t">' + esc(video.title) + '</span></a></li>';
    }).join('') + '</ol>';
  }

  var LEVELS = [
    ['start', 'Start here', 'No Background Needed', 'No background needed'],
    ['further', 'Go further', 'Some Method Expected', 'Some method expected'],
    ['primary', 'Primary', 'The Papers Themselves', 'The papers themselves']
  ];

  function sourceLevels(data) {
    var all = rows(data.sources);
    return LEVELS.map(function (level) {
      var links = all.filter(function (row) { return (row.level || 'start') === level[0]; }).map(function (row) {
        return '<li>' + namedLink(row.label, row.url) + '</li>';
      }).join('');
      return '<div class="level"><p class="level__tag">' + level[1] + '</p><h4>' + level[2] + '</h4><ul>' + links + '</ul></div>';
    }).join('');
  }

  function exerciseMarkup(exercise) {
    var buttons = '<div class="ta-answer__act"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-act="accept" aria-pressed="false">Accept</button><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-act="check" aria-pressed="false">Check</button></div>';
    var answers = rows(exercise.answers);
    return '<div class="play__bar"><span class="ta-tally"><span>Wrong answers accepted <b data-tally="missed">0</b></span><span>Checked <b data-tally="checked">0</b></span><span>Undecided <b data-tally="left">' + answers.length + '</b></span></span>' +
      '<button class="g-btn g-btn--ghost g-btn--sm" type="button" data-reset>Start again</button></div>' +
      '<div class="play__body"><div class="ta-data-wrap"><table class="ta-data"><caption>' + esc(exercise.caption) + '</caption><thead><tr>' +
      (exercise.columns || []).map(function (name) { return '<th scope="col">' + esc(name) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows(exercise.rows).map(function (row) {
        return '<tr data-row="' + esc(row.id) + '">' + (row.cells || []).map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><ol class="ta-answers">' + answers.map(function (answer) {
        return '<li class="ta-answer" data-ok="' + (answer.correct ? 'true' : 'false') + '" data-row="' + esc(answer.row) + '">' +
          '<p class="ta-answer__q">' + esc(answer.question) + '</p><p class="ta-answer__a">' + esc(answer.answer) + '</p>' + buttons +
          '<p class="ta-answer__v" hidden>' + esc(answer.verdict) + '</p></li>';
      }).join('') + '</ol></div><p class="play__note ta-result" aria-live="polite"></p>';
  }

  function renderPage(item) {
    var data = item.topic_data || {};
    var list = videos(data);
    var views = data.viewpoints || {};
    var poll = rows(views.polls)[0];
    var exercise = data.exercise || {};
    var discussion = data.discussion || {};
    var figure = data.timeline_figure || {};

    document.title = item.title + ' · GraviQuest Topic ' + (data.number || '01');
    fill('number', esc(data.number));
    fill('title', esc(item.title));
    fill('lead', esc(data.hero_lead || item.summary));
    fill('tags', (data.tags || []).map(function (tag) { return '<span class="g-tag">' + esc(tag) + '</span>'; }).join(''));

    fill('videos', videoList(list) + list.map(videoBlock).join(''));
    fill('cast', rows(data.cast).map(function (person) {
      return '<li>' + image(person.image_url, person.image_alt, [480, 480]) + '<div><h3>' + esc(person.name) + '</h3><p>' + esc(person.bio) + '</p></div></li>';
    }).join(''));
    fill('stills', rows(data.stills).map(function (still) {
      return '<figure>' + image(still.image_url, still.image_alt, [1280, 720]) + '<figcaption>' + esc(still.caption) + '</figcaption></figure>';
    }).join(''));
    var transcript = rows(data.transcript);
    var transcriptNode = fill('transcript', transcript.map(function (line) {
      return '<li><b>' + esc(line.speaker) + '</b><span>' + esc(line.text) + '</span></li>';
    }).join(''));
    if (transcriptNode && !transcript.length) transcriptNode.closest('details').hidden = true;

    fill('sources-intro', esc(data.sources_intro));
    fill('sources', sourceLevels(data));

    fill('timeline', rows(data.timeline).map(function (row) {
      return '<div class="tl__item"><span class="tl__yr">' + esc(row.date) + '</span><h4>' + esc(row.title) + '</h4><p>' + inline(row.description) + '</p></div>';
    }).join(''));
    var picture = image(figure.image_url, figure.image_alt, [1280, 720]).replace('<img ', '<img style="width:100%;height:auto;border-radius:var(--g-radius);border:1px solid var(--g-hairline)" ');
    fill('timeline-figure', picture + (picture && figure.caption ? '<figcaption class="g-subtle" style="font-size:var(--g-fs-caption);padding-top:var(--g-space-2xs)">' + esc(figure.caption) + '</figcaption>' : ''));

    fill('exercise-title', esc(exercise.title));
    fill('exercise-intro', esc(exercise.intro));
    fill('exercise', exerciseMarkup(exercise));

    fill('views-intro', esc(data.viewpoints_intro));
    fill('views', rows(views.items).map(function (view, index) {
      return '<div class="view ' + (index % 2 ? 'view--against' : 'view--for') + '"><p class="view__tag">' + esc(view.label) + '</p><p>' + esc(view.text) + '</p>' + (view.cite ? '<cite>' + esc(view.cite) + '</cite>' : '') + '</div>';
    }).join(''));
    fill('stance', poll ? '<p class="g-eyebrow">' + esc(poll.question) + '</p><ul class="stance__list">' + rows(poll.options).map(function (option) {
      return '<li class="stance__opt">' + esc(option.label) + '</li>';
    }).join('') + '</ul>' + (poll.note ? '<p class="g-subtle" style="font-size:var(--g-fs-caption);margin-top:var(--g-space-2xs)">' + esc(poll.note) + '</p>' : '') : '');

    fill('question', esc(discussion.question));
    fill('corrections', esc(discussion.corrections));
    fill('next', rows(data.next).map(function (card) {
      var url = safeUrl(card.href);
      return '<a class="nextcard"' + (url ? ' href="' + esc(url) + '"' : '') + '><span class="nextcard__k">' + esc(card.kicker) + '</span><strong>' + esc(card.title) + '</strong><span>' + esc(card.text) + '</span></a>';
    }).join(''));

    shell.querySelector('[data-t1-status]').hidden = true;
    shell.querySelectorAll('[data-t1-body]').forEach(function (node) { node.hidden = false; });
    shell.removeAttribute('aria-busy');
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  /* ---- The rail on the home page ---------------------------------------- */
  function panel(name) { return rail.querySelector('[data-t1-panel="' + name + '"]'); }

  function side(node, title, say) {
    var heading = node.querySelector('h3');
    var line = node.querySelector('.trail__say');
    if (heading && title != null) heading.textContent = title;
    if (line && say != null) line.textContent = say;
  }

  function railVideos(item, data) {
    var node = panel('video');
    var landing = data.landing || {};
    var list = videos(data);
    var first = list[0] || {};
    side(node, item.title, landing.video_say);
    node.querySelector('.trail__chap').innerHTML = (landing.chapters || []).map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('');
    var card = node.querySelector('.trail__video');
    card.insertAdjacentHTML('afterbegin', poster(first));
    if (safeUrl(first.poster_url)) card.classList.add('has-thumb');
    card.setAttribute('aria-label', (first.title || item.title) + ': chapters and full transcript on the Topic page');
    node.querySelector('[data-set-meta]').innerHTML = (landing.video_runtime ? '<span class="g-nums">' + esc(landing.video_runtime) + '</span> &middot; ' : '') + esc(landing.video_status);
    if (list.length < 2) return;
    var set = document.createElement('ol');
    set.className = 'trail__set';
    set.setAttribute('aria-label', 'Videos in this Topic');
    list.forEach(function (video, index) {
      var row = document.createElement('li');
      var link = document.createElement('a');
      link.href = PAGE + '#video-' + (index + 1);
      link.dataset.title = video.title || '';
      link.dataset.say = video.description || '';
      link.dataset.meta = video.duration || '';
      link.dataset.poster = safeUrl(video.poster_url);
      if (!index) link.setAttribute('aria-current', 'true');
      link.innerHTML = '<span class="trail__set-n">' + String(index + 1).padStart(2, '0') + '</span><span class="trail__set-t">' + esc(video.title) + '</span>';
      row.append(link);
      set.append(row);
    });
    node.querySelector('.trail__side').append(set);
    node.setAttribute('data-rail-set', '');
  }

  function railLine(line) {
    var text = esc(line.text);
    if (line.highlight) text = text.replace(esc(line.highlight), '<strong class="trail__num">' + esc(line.highlight) + '</strong>');
    var cls = [];
    if (line.speaker === 'Pulsar') cls.push('is-ai');
    if (line.key) cls.push('is-key');
    return '<li' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '><b>' + esc(line.speaker) + '</b><span>' + text + '</span></li>';
  }

  function renderRail(item) {
    var data = item.topic_data || {};
    var landing = data.landing || {};
    var exchange = landing.exchange || {};
    var views = rows((data.viewpoints || {}).items).slice(0, 2);

    railVideos(item, data);

    side(panel('cast'), landing.cast_title, landing.cast_say);
    panel('cast').querySelector('.trail__cast').innerHTML = rows(data.cast).map(function (person) {
      return '<li>' + image(person.image_url, person.image_alt, [480, 480]) + '<p class="trail__who"><b>' + esc(person.name) + '</b><span>' + esc(person.role) + '</span></p><p>' + esc(person.short || person.bio) + '</p></li>';
    }).join('');

    side(panel('exchange'), exchange.title, exchange.say);
    panel('exchange').querySelector('.trail__act a').textContent = exchange.cta || 'Try It';
    panel('exchange').querySelector('.trail__talk').innerHTML = rows(exchange.lines).map(railLine).join('');

    var intro = panel('essays').querySelector('[data-topic-essay-intro]');
    intro.dataset.topicEssayIntro = landing.essays_intro || '';
    intro.textContent = landing.essays_intro || '';

    side(panel('sources'), landing.sources_title, landing.sources_say);
    var sources = rows(data.sources);
    panel('sources').querySelector('.trail__stairs').innerHTML = LEVELS.map(function (level) {
      var names = sources.filter(function (row) { return (row.level || 'start') === level[0]; }).slice(0, 2).map(function (row) {
        return '<li>' + esc(row.short || row.label) + '</li>';
      }).join('');
      return '<li><p class="trail__lvl"><b>' + level[1] + '</b><span>' + level[3] + '</span></p><ul>' + names + '</ul></li>';
    }).join('');

    side(panel('timeline'), landing.timeline_title, landing.timeline_say);
    panel('timeline').querySelector('.trail__time').innerHTML = rows(data.timeline).map(function (row) {
      return '<li' + (row.key ? ' class="is-key"' : '') + '><time>' + esc(row.date) + '</time><span>' + esc(row.short || row.title) + '</span></li>';
    }).join('');

    side(panel('views'), landing.viewpoints_title, landing.viewpoints_say);
    panel('views').querySelector('.trail__views').innerHTML = views.map(function (view, index) {
      return '<div class="view ' + (index ? 'view--against' : 'view--for') + '"><p class="view__tag">' + esc(view.label) + '</p><p>' + esc(view.short || view.text) + '</p>' + (view.cite ? '<cite>' + esc(view.cite) + '</cite>' : '') + '</div>';
    }).join('');

    side(panel('talk'), landing.discussion_title, landing.discussion_say);
    panel('talk').querySelector('.trail__q p').textContent = (data.discussion || {}).question || '';

    window.dispatchEvent(new Event('resize'));
  }

  /* ---- Reading it ------------------------------------------------------- */
  function failed() {
    var host = shell || rail;
    if (!host) return;
    host.querySelectorAll('[data-t1-hide-on-failure]').forEach(function (node) { node.hidden = true; });
    var status = host.querySelector('[data-t1-status]');
    status.hidden = false;
    status.replaceChildren('This Topic could not be loaded just now. ');
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'g-btn g-btn--ghost g-btn--sm';
    retry.textContent = 'Try again';
    retry.addEventListener('click', function () { location.reload(); });
    status.append(retry);
    if (shell) shell.removeAttribute('aria-busy');
  }

  window.GQTopic01 = !shell && !rail ? Promise.resolve(null) :
    fetch('/api/content/' + SLUG + '/', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('topic_unavailable');
        return response.json();
      })
      .then(function (payload) {
        if (shell) renderPage(payload.item);
        if (rail) renderRail(payload.item);
        return payload.item;
      })
      .catch(function () {
        failed();
        return null;
      });
})();
