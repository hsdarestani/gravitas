(function () {
  'use strict';

  var root = document.querySelector('[data-topic-shell]');
  if (!root) return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.charAt(0) === '/' || raw.indexOf('assets/') === 0) return raw;
    try {
      var url = new URL(raw, location.origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch (err) {
      return '';
    }
  }

  function safeRichHtml(value) {
    var template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select').forEach(function (node) {
      node.remove();
    });
    template.content.querySelectorAll('*').forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name.indexOf('on') === 0) node.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && !safeUrl(attr.value)) node.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function cookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i].trim();
      if (part.indexOf(prefix) === 0) return decodeURIComponent(part.slice(prefix.length));
    }
    return '';
  }

  function csrf() {
    return fetch('/api/auth/csrf/', {credentials: 'same-origin', cache: 'no-store'})
      .then(function (response) {
        if (!response.ok) throw new Error('csrf');
        return cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
      });
  }

  function post(url, payload) {
    return csrf().then(function (token) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': token},
        body: JSON.stringify(payload || {})
      });
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw data;
        return data;
      });
    });
  }

  function topicSlug() {
    var explicit = root.getAttribute('data-topic-slug');
    if (explicit) return explicit;
    var fromQuery = new URLSearchParams(location.search).get('slug');
    if (fromQuery) return fromQuery;
    var match = location.pathname.match(/topic-([a-z0-9-]+)\.html$/i);
    return match ? match[1] : '';
  }

  function youtubeId(url) {
    try {
      var parsed = new URL(url);
      if (parsed.hostname.indexOf('youtu.be') >= 0) return parsed.pathname.split('/').filter(Boolean)[0] || '';
      if (parsed.hostname.indexOf('youtube.com') >= 0 || parsed.hostname.indexOf('youtube-nocookie.com') >= 0) {
        if (parsed.pathname.indexOf('/embed/') === 0) return parsed.pathname.split('/')[2] || '';
        return parsed.searchParams.get('v') || '';
      }
    } catch (err) {}
    return '';
  }

  function section(number, id, title, body) {
    return '<section class="layer topic-live__section" id="' + id + '">' +
      '<div class="layer__head"><span class="layer__n">' + esc(number) + '</span><h2>' + esc(title) + '</h2></div>' +
      body + '</section>';
  }

  function renderVideo(data) {
    var video = data.video || {};
    var media = '<div class="video topic-video-placeholder" aria-label="Video not published yet">' +
      '<span class="video__play"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>';
    if (video.source_type === 'youtube' && safeUrl(video.youtube_url)) {
      var id = youtubeId(video.youtube_url);
      if (id) {
        media = '<div class="topic-media"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) +
          '" title="Topic video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
      }
    } else if (video.source_type === 'self_hosted' && safeUrl(video.self_hosted_url)) {
      media = '<div class="topic-media"><video controls preload="metadata" src="' + esc(safeUrl(video.self_hosted_url)) + '"></video></div>';
    }
    var meta = [];
    if (video.duration) meta.push('<dt>Runtime</dt><dd>' + esc(video.duration) + '</dd>');
    if (video.companion_label) {
      var companion = safeUrl(video.companion_url);
      meta.push('<dt>Companion</dt><dd>' + (companion ? '<a href="' + esc(companion) + '">' + esc(video.companion_label) + '</a>' : esc(video.companion_label)) + '</dd>');
    }
    if (video.transcript_label) {
      var transcript = safeUrl(video.transcript_url);
      meta.push('<dt>Transcript</dt><dd>' + (transcript ? '<a href="' + esc(transcript) + '">' + esc(video.transcript_label) + '</a>' : '<span class="g-subtle">' + esc(video.transcript_label) + '</span>') + '</dd>');
    }
    if (video.info) meta.push('<dt>Info</dt><dd>' + esc(video.info) + '</dd>');
    return section('01', 'video', 'The Video',
      '<div class="split">' + media + '<div>' +
      (video.description ? '<p class="g-muted" style="font-size:var(--g-fs-small)">' + esc(video.description) + '</p>' : '') +
      (meta.length ? '<dl class="kv g-mt-md">' + meta.join('') + '</dl>' : '') +
      '</div></div>');
  }

  function renderEssay(data) {
    var essay = data.essay || {};
    var image = safeUrl(essay.image_url);
    var aside = '';
    if (essay.aside_title || essay.aside_text) {
      aside = '<aside class="aside"><div class="callout"><h4>' + esc(essay.aside_title || 'Try It Yourself') + '</h4><p>' +
        (essay.aside_text ? esc(essay.aside_text) : '') + '</p></div></aside>';
    }
    var article = '<div class="depthbar"><p class="depthbar__note">This essay reads two ways. Pick one.</p>' +
      '<div class="depth" role="group" aria-label="Reading depth">' +
      '<button type="button" data-topic-depth="overview" aria-pressed="true">Overview</button>' +
      '<button type="button" data-topic-depth="indepth" aria-pressed="false">In depth</button></div></div>' +
      (image ? '<figure class="topic-essay-image"><img src="' + esc(image) + '" alt="' + esc(essay.image_alt || '') + '"></figure>' : '') +
      '<div class="' + (aside ? 'split' : '') + '"><article class="g-prose topic-essay-copy">' +
      '<div data-topic-level="overview">' + safeRichHtml(essay.overview_html || '<p>No overview has been published yet.</p>') + '</div>' +
      '<div data-topic-level="indepth" hidden>' + safeRichHtml(essay.indepth_html || '<p>No in-depth version has been published yet.</p>') + '</div>' +
      '</article>' + aside + '</div>';
    return section('02', 'essay', 'The Essay', article);
  }

  function renderSources(data) {
    var sourceRows = Array.isArray(data.sources) ? data.sources : [];
    var groups = [
      ['start', 'Start here', 'No Background Needed'],
      ['further', 'Go further', 'Some Maths Expected'],
      ['primary', 'Primary', 'The Papers Themselves']
    ];
    var html = data.sources_intro
      ? '<p class="g-muted topic-section-intro" style="font-size:var(--g-fs-small);margin-bottom:var(--g-space-md)">' + esc(data.sources_intro) + '</p>'
      : '';
    html += '<div class="levels">';
    groups.forEach(function (group) {
      var rows = sourceRows.filter(function (row) { return (row.level || 'start') === group[0]; });
      html += '<div class="level"><p class="level__tag">' + esc(group[1]) + '</p><h4>' + esc(group[2]) + '</h4><ul>';
      if (!rows.length) html += '<li class="g-subtle">No sources yet.</li>';
      rows.forEach(function (row) {
        var url = safeUrl(row.url);
        html += '<li>' + (url
          ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(row.label || url) + '</a>'
          : '<span>' + esc(row.label || 'Untitled source') + '</span>') + '</li>';
      });
      html += '</ul></div>';
    });
    html += '</div>';
    return section('03', 'sources', 'Sources, at Three Levels', html);
  }

  function renderTimeline(data) {
    var rows = Array.isArray(data.timeline) ? data.timeline : [];
    var html = '<div class="topic-timeline">';
    rows.forEach(function (row, index) {
      var image = safeUrl(row.image_url);
      html += '<article class="topic-timeline__node' + (index % 2 ? ' is-right' : ' is-left') + '">' +
        '<div class="topic-timeline__dot" aria-hidden="true"></div>' +
        '<div class="topic-timeline__media">' +
          (image ? '<img src="' + esc(image) + '" alt="' + esc(row.image_alt || '') + '" loading="lazy">' : '<div class="topic-timeline__placeholder"></div>') +
        '</div>' +
        '<div class="topic-timeline__copy"><span class="topic-timeline__date">' + esc(row.date || '') + '</span>' +
          '<h3>' + esc(row.title || '') + '</h3><p>' + esc(row.description || '') + '</p></div>' +
      '</article>';
    });
    if (!rows.length) html += '<p class="g-muted">Timeline coming soon.</p>';
    html += '</div>';
    return section('04', 'timeline', 'How the Question Developed', html);
  }

  function simulationDocument(code) {
    var raw = String(code || '').trim();
    if (!raw) return '';
    if (/<(?:!doctype|html|head|body|style|script|div|canvas|svg)\b/i.test(raw)) return raw;
    return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;font-family:system-ui;background:#fff;color:#162c38}#app{min-height:280px;padding:16px;box-sizing:border-box}</style><div id="app"></div><script>' +
      raw.replace(/<\/script/gi, '<\\/script') + '<\/script>';
  }

  function renderSimulation(data) {
    var sim = data.simulation || {};
    if (sim.builtin === 'lorenz' && !String(sim.code || '').trim()) {
      return section('05', 'sim', sim.title || 'The Simulation',
        (sim.description ? '<p class="g-muted topic-section-intro" style="font-size:var(--g-fs-small);margin-bottom:var(--g-space-md)">' + esc(sim.description) + '</p>' : '') +
        '<div class="play" data-native-simulation="lorenz">' +
          '<div class="play__bar">' +
            '<label for="eps" style="display:flex;align-items:center;gap:.6rem">Initial difference ' +
              '<input id="eps" type="range" min="-12" max="-1" value="-6" step="1" style="width:11rem"> ' +
              '<b id="epsv" class="g-mono">1e-6</b></label>' +
            '<span>Divergence at <b id="tdiv" class="g-mono">–</b></span>' +
            '<button class="g-btn g-btn--ghost g-btn--sm" id="simreset" type="button">Restart</button>' +
          '</div>' +
          '<div class="play__body play__body--fig"><canvas id="lorenz" style="width:100%;height:340px;display:block"></canvas></div>' +
        '</div>');
    }
    var doc = simulationDocument(sim.code);
    var frame = doc
      ? '<iframe class="topic-simulation__frame" sandbox="allow-scripts" title="Topic simulation"></iframe>'
      : '<div class="topic-simulation__empty">Simulation code has not been published yet.</div>';
    return section('05', 'sim', sim.title || 'The Simulation',
      (sim.description ? '<p class="g-muted topic-section-intro">' + esc(sim.description) + '</p>' : '') +
      '<div class="topic-simulation" data-simulation-src="' + esc(doc) + '">' + frame + '</div>');
  }

  function initLorenzSimulation() {
    var cv = document.getElementById('lorenz');
    if (!cv || cv.dataset.ready === '1') return;
    cv.dataset.ready = '1';
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var eps = document.getElementById('eps'), epsv = document.getElementById('epsv'),
      tdiv = document.getElementById('tdiv'), reset = document.getElementById('simreset');
    if (!eps || !epsv || !tdiv || !reset) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var EXT = {x0:-21, x1:21, z0:3, z1:48};
    var VIEW = {sc:1, ox:0, oy:0};

    function fitView() {
      var pad = 16;
      var sc = Math.min((W - pad * 2) / (EXT.x1 - EXT.x0), (H - pad * 2) / (EXT.z1 - EXT.z0));
      VIEW.sc = sc;
      VIEW.ox = W / 2 - ((EXT.x0 + EXT.x1) / 2) * sc;
      VIEW.oy = H / 2 + ((EXT.z0 + EXT.z1) / 2) * sc;
    }
    function size() {
      var rect = cv.getBoundingClientRect();
      W = rect.width; H = rect.height;
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr,0,0,dpr,0,0);
      fitView();
    }
    size();
    window.addEventListener('resize', size);

    var A, B, trailA, trailB, t, diverged;
    function init() {
      var e = Math.pow(10, +eps.value);
      epsv.textContent = '1e' + eps.value;
      A = [1,1,20]; B = [1+e,1,20]; trailA = []; trailB = []; t = 0; diverged = null;
      tdiv.textContent = '–';
    }
    function step(s, dt) {
      var x=s[0], y=s[1], z=s[2], S=10, R=28, Bq=8/3;
      var k1=[S*(y-x), x*(R-z)-y, x*y-Bq*z];
      var x2=x+k1[0]*dt/2, y2=y+k1[1]*dt/2, z2=z+k1[2]*dt/2;
      var k2=[S*(y2-x2), x2*(R-z2)-y2, x2*y2-Bq*z2];
      return [x+k2[0]*dt, y+k2[1]*dt, z+k2[2]*dt];
    }
    function draw() {
      ctx.clearRect(0,0,W,H);
      var sc=VIEW.sc, cx=VIEW.ox, cy=VIEW.oy;
      function path(tr,col) {
        ctx.beginPath();
        for(var i=0;i<tr.length;i+=1) {
          var p=tr[i], X=cx+p[0]*sc, Y=cy-p[2]*sc;
          if(i) ctx.lineTo(X,Y); else ctx.moveTo(X,Y);
        }
        ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.stroke();
      }
      var inkA=window.gravitasInk?window.gravitasInk('body-a','241,239,236'):'241,239,236';
      var inkB=window.gravitasInk?window.gravitasInk('body-b','212,201,190'):'212,201,190';
      path(trailA,'rgba('+inkA+',.72)');
      path(trailB,'rgba('+inkB+',.62)');
      if(trailA.length) {
        var p=trailA[trailA.length-1], q=trailB[trailB.length-1];
        ctx.fillStyle='rgb('+inkA+')'; ctx.beginPath(); ctx.arc(cx+p[0]*sc,cy-p[2]*sc,2.6,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgb('+inkB+')'; ctx.beginPath(); ctx.arc(cx+q[0]*sc,cy-q[2]*sc,2.6,0,Math.PI*2); ctx.fill();
      }
    }
    function tick() {
      if(!document.body.contains(cv)) return;
      if(!reduce) {
        for(var i=0;i<6;i+=1) {
          A=step(A,.005); B=step(B,.005); t+=.005;
          trailA.push(A.slice()); trailB.push(B.slice());
          if(trailA.length>1400){trailA.shift();trailB.shift();}
          if(diverged===null) {
            var d=Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);
            if(d>1){diverged=t;tdiv.textContent='t = '+t.toFixed(1);}
          }
        }
      }
      draw();
      window.requestAnimationFrame(tick);
    }
    eps.addEventListener('input', init);
    reset.addEventListener('click', init);
    init();
    window.requestAnimationFrame(tick);
  }

  function renderViewpoints(data) {
    var v = data.viewpoints || {};
    var intro = data.viewpoints_intro
      ? '<p class="g-muted topic-section-intro" style="font-size:var(--g-fs-small);margin-bottom:var(--g-space-md)">' + esc(data.viewpoints_intro) + '</p>'
      : '';
    var html = intro + '<div class="views">' +
      '<div class="view view--for"><p class="view__tag">' + esc(v.left_label || 'Viewpoint A') + '</p><p>' + esc(v.left_text || '') + '</p>' +
        (v.left_cite ? '<cite>' + esc(v.left_cite) + '</cite>' : '') + '</div>' +
      '<div class="view view--against"><p class="view__tag">' + esc(v.right_label || 'Viewpoint B') + '</p><p>' + esc(v.right_text || '') + '</p>' +
        (v.right_cite ? '<cite>' + esc(v.right_cite) + '</cite>' : '') + '</div></div>' +
      '<div class="topic-poll g-mt-lg" data-topic-poll><p class="g-eyebrow">' + esc(v.poll_question || 'Where do you land?') + '</p><div class="topic-poll__options"></div>' +
      (v.poll_note ? '<p class="g-subtle" style="font-size:var(--g-fs-caption);margin-top:var(--g-space-2xs)">' + esc(v.poll_note) + '</p>' : '') +
      '<p class="g-hint" data-poll-note></p></div>';
    return section('06', 'views', 'Viewpoints', html);
  }

  function renderDiscussion() {
    return section('07', 'talk', 'Discussion',
      '<div class="topic-comments"><div data-comment-list><p class="g-muted">Loading discussion…</p></div>' +
      '<div data-comment-compose></div></div>');
  }

  function renderTopic(item) {
    var data = item.topic_data || {};
    var tags = Array.isArray(data.tags) ? data.tags : [];
    root.innerHTML =
      '<section class="page-head"><div class="g-container">' +
      '<p class="crumb"><a href="index.html">Home</a> / <a href="topics.html">Topics</a>' +
      (data.number ? ' / ' + esc(data.number) : '') + '</p>' +
      '<h1>' + esc(item.title) + '</h1><p class="g-lead">' + esc(data.hero_lead || item.summary || '') + '</p>' +
      (tags.length ? '<div class="pill-row g-mt-md">' + tags.map(function (tag) { return '<span class="g-tag">' + esc(tag) + '</span>'; }).join('') + '</div>' : '') +
      '</div></section>' +
      '<div class="topic-nav"><div class="g-container"><nav class="topic-nav__row" aria-label="In this topic">' +
      '<a href="#video">Video</a><a href="#essay">Essay</a><a href="#sources">Sources</a><a href="#timeline">Timeline</a><a href="#sim">Simulation</a><a href="#views">Viewpoints</a><a href="#talk">Discussion</a>' +
      '</nav></div></div><div class="g-container">' +
      renderVideo(data) + renderEssay(data) + renderSources(data) + renderTimeline(data) +
      renderSimulation(data) + renderViewpoints(data) + renderDiscussion() + '</div>';

    document.title = item.title + ' — Gravitas+';
    document.querySelectorAll('[data-topic-depth]').forEach(function (button) {
      button.addEventListener('click', function () {
        var depth = button.getAttribute('data-topic-depth');
        document.querySelectorAll('[data-topic-depth]').forEach(function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
        document.querySelectorAll('[data-topic-level]').forEach(function (node) { node.hidden = node.getAttribute('data-topic-level') !== depth; });
      });
    });

    document.querySelectorAll('[data-simulation-src]').forEach(function (host) {
      var frame = host.querySelector('iframe');
      if (frame) frame.srcdoc = host.getAttribute('data-simulation-src') || '';
      host.removeAttribute('data-simulation-src');
    });
    initLorenzSimulation();
  }

  function paintPoll(slug, poll) {
    var host = document.querySelector('[data-topic-poll]');
    if (!host) return;
    var box = host.querySelector('.topic-poll__options');
    var note = host.querySelector('[data-poll-note]');
    box.innerHTML = '';
    var total = Number(poll.total_votes || 0);
    (poll.options || []).forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'topic-poll__option' + (poll.selected === option.id ? ' is-selected' : '');
      var pct = total ? Math.round((Number(option.votes || 0) / total) * 100) : 0;
      button.innerHTML = '<span>' + esc(option.label) + '</span><strong>' + esc(option.votes || 0) + ' · ' + pct + '%</strong>';
      button.addEventListener('click', function () {
        button.disabled = true;
        post('/api/content/' + encodeURIComponent(slug) + '/poll/', {option_id: option.id})
          .then(function (data) { paintPoll(slug, data.poll); })
          .catch(function () { note.textContent = 'Vote could not be saved.'; button.disabled = false; });
      });
      box.appendChild(button);
    });
    note.textContent = total + (total === 1 ? ' vote' : ' votes');
  }

  function initials(name) {
    return String(name || 'Member').split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join('') || 'M';
  }

  function renderComments(slug, comments, authenticated) {
    var list = document.querySelector('[data-comment-list]');
    var compose = document.querySelector('[data-comment-compose]');
    if (!list || !compose) return;
    list.innerHTML = '';
    var byParent = {};
    comments.forEach(function (comment) {
      var key = comment.parent_id || 0;
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(comment);
    });

    function appendRows(parentId, host, depth) {
      (byParent[parentId] || []).forEach(function (comment) {
        var article = document.createElement('article');
        article.className = 'comment topic-comment' + (depth ? ' topic-comment--reply' : '');
        article.innerHTML =
          '<span class="avatar">' + esc(initials(comment.author)) + '</span><div class="topic-comment__body">' +
          '<p class="comment__who">' + esc(comment.author) + '</p><p>' + esc(comment.body) + '</p>' +
          '<div class="topic-comment__actions"></div></div>';
        var actions = article.querySelector('.topic-comment__actions');
        var likes = document.createElement('span');
        likes.className = 'topic-comment__likes';
        likes.textContent = String(comment.like_count || 0) + ((comment.like_count || 0) === 1 ? ' like' : ' likes');
        actions.appendChild(likes);
        if (authenticated) {
          var like = document.createElement('button');
          like.type = 'button';
          like.className = 'topic-comment__action' + (comment.viewer_liked ? ' is-active' : '');
          like.textContent = comment.viewer_liked ? 'Liked' : 'Like';
          like.addEventListener('click', function () {
            like.disabled = true;
            post('/api/community/comments/' + encodeURIComponent(slug) + '/' + comment.id + '/like/', {})
              .then(function (data) {
                comment.viewer_liked = data.liked;
                comment.like_count = data.like_count;
                like.textContent = data.liked ? 'Liked' : 'Like';
                like.classList.toggle('is-active', data.liked);
                likes.textContent = String(data.like_count) + (data.like_count === 1 ? ' like' : ' likes');
              })
              .catch(function () {})
              .finally(function () { like.disabled = false; });
          });
          var reply = document.createElement('button');
          reply.type = 'button';
          reply.className = 'topic-comment__action';
          reply.textContent = 'Reply';
          reply.addEventListener('click', function () { showComposer(slug, compose, comment.id, comment.author, authenticated); });
          actions.append(like, reply);
        }
        host.appendChild(article);
        appendRows(comment.id, host, depth + 1);
      });
    }

    if (!comments.length) {
      list.innerHTML = '<p class="g-muted">No published comments yet. Start the discussion.</p>';
    } else {
      appendRows(0, list, 0);
    }
    showComposer(slug, compose, null, '', authenticated);
  }

  function showComposer(slug, host, parentId, parentName, authenticated) {
    host.innerHTML = '';
    if (!authenticated) {
      host.innerHTML = '<div class="topic-login-callout"><h3>Join the discussion</h3><p>Sign in or create an account to comment, reply or like.</p>' +
        '<div class="g-cluster"><a class="g-btn g-btn--primary" href="/account.html#in">Sign in</a>' +
        '<a class="g-btn g-btn--secondary" href="/account.html#up">Create account</a></div></div>';
      return;
    }
    var form = document.createElement('form');
    form.className = 'g-field topic-comment-form';
    form.innerHTML =
      (parentId ? '<div class="topic-replying">Replying to <strong>' + esc(parentName) + '</strong> <button type="button" data-cancel-reply>Cancel</button></div>' : '') +
      '<label class="g-label">Add to the discussion</label><textarea class="g-textarea" name="body" required maxlength="5000" placeholder="Disagreement is more useful than agreement here."></textarea>' +
      '<div class="g-cluster g-mt-sm"><button class="g-btn g-btn--primary" type="submit">Post</button><span class="g-hint" data-comment-note>Comments are reviewed before publication.</span></div>';
    host.appendChild(form);
    var cancel = form.querySelector('[data-cancel-reply]');
    if (cancel) cancel.addEventListener('click', function () { showComposer(slug, host, null, '', true); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var body = form.elements.body.value.trim();
      var note = form.querySelector('[data-comment-note]');
      var submit = form.querySelector('button[type="submit"]');
      if (!body) return;
      submit.disabled = true;
      note.textContent = 'Posting…';
      post('/api/community/comments/' + encodeURIComponent(slug) + '/', {body: body, parent_id: parentId || null})
        .then(function () {
          form.reset();
          note.textContent = 'Posted. A moderator will review it before it appears.';
          if (parentId) window.setTimeout(function () { showComposer(slug, host, null, '', true); }, 900);
        })
        .catch(function (err) {
          note.textContent = err && err.error === 'authentication_required' ? 'Please sign in again.' : 'Comment could not be posted.';
        })
        .finally(function () { submit.disabled = false; });
    });
    form.querySelector('textarea').focus();
  }

  function markProgress(slug, action) {
    return post('/api/content/' + encodeURIComponent(slug) + '/progress/', {action: action}).catch(function () { return null; });
  }

  function setupTopicProgress(slug) {
    fetch('/api/content/' + encodeURIComponent(slug) + '/progress/', {credentials: 'same-origin', cache: 'no-store'})
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.authenticated || !data.progress) return;
        var applicable = data.progress.applicable || {};
        var done = data.progress.done || {};

        if (applicable.video && !done.video) {
          var video = document.querySelector('#video video');
          var videoHost = document.querySelector('#video .topic-media, #video .video');
          var markedVideo = false;
          var finishVideo = function () {
            if (markedVideo) return;
            markedVideo = true;
            markProgress(slug, 'video');
          };
          if (video) {
            video.addEventListener('timeupdate', function () {
              if (video.currentTime >= Math.min(10, Math.max(3, (video.duration || 30) * .2))) finishVideo();
            });
          } else if (videoHost && 'IntersectionObserver' in window) {
            var timer = 0;
            var observer = new IntersectionObserver(function (entries) {
              entries.forEach(function (entry) {
                if (entry.isIntersecting && entry.intersectionRatio >= .55) {
                  if (!timer) timer = window.setTimeout(function () { finishVideo(); observer.disconnect(); }, 10000);
                } else if (timer) {
                  window.clearTimeout(timer); timer = 0;
                }
              });
            }, {threshold: [.55]});
            observer.observe(videoHost);
          }
        }

        if (applicable.simulation && !done.simulation) {
          var sim = document.getElementById('sim');
          if (sim) {
            var markedSim = false;
            var finishSim = function () {
              if (markedSim) return;
              markedSim = true;
              markProgress(slug, 'simulation');
            };
            sim.addEventListener('change', finishSim, {once: true, capture: true});
            sim.addEventListener('pointerdown', function (event) {
              if (event.target.closest('input,button,select,canvas,iframe')) finishSim();
            }, {once: true, capture: true});
            var frame = sim.querySelector('iframe');
            if (frame) {
              window.addEventListener('blur', function onBlur() {
                if (document.activeElement === frame) {
                  finishSim();
                  window.removeEventListener('blur', onBlur);
                }
              });
            }
          }
        }
      })
      .catch(function () {});
  }

  function loadCommunity(slug) {
    return Promise.all([
      fetch('/api/auth/me/', {credentials: 'same-origin', cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : {authenticated: false}; }).catch(function () { return {authenticated: false}; }),
      fetch('/api/community/comments/' + encodeURIComponent(slug) + '/', {credentials: 'same-origin', cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : {comments: []}; }).catch(function () { return {comments: []}; })
    ]).then(function (rows) {
      renderComments(slug, rows[1].comments || [], !!rows[0].authenticated);
    });
  }

  var slug = topicSlug();
  if (!slug) {
    root.innerHTML = '<section class="page-head"><div class="g-container"><h1>Topic not found</h1></div></section>';
    return;
  }

  fetch('/api/content/' + encodeURIComponent(slug) + '/', {credentials: 'same-origin', cache: 'no-store'})
    .then(function (response) {
      if (!response.ok) throw new Error('topic_not_found');
      return response.json();
    })
    .then(function (data) {
      var item = data.item;
      if (!item || item.kind !== 'topic') throw new Error('topic_not_found');
      renderTopic(item);
      setupTopicProgress(slug);
      return Promise.all([
        fetch('/api/content/' + encodeURIComponent(slug) + '/poll/', {credentials: 'same-origin', cache: 'no-store'})
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (p) { if (p && p.poll) paintPoll(slug, p.poll); }),
        loadCommunity(slug)
      ]);
    })
    .catch(function () {
      root.innerHTML = '<section class="page-head"><div class="g-container"><p class="crumb"><a href="topics.html">Topics</a></p><h1>Topic unavailable</h1><p class="g-lead">This topic is not published or could not be loaded.</p></div></section>';
    });
})();