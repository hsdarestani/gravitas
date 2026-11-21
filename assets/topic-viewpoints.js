/* =========================================================================
   TOPIC · VIEWPOINTS
   Say where you stand, then see where everyone else does and why.
   window.GQViewpoints.render(host, { slug, polls }).

   From the design review of 2026-11-19 (tests/topic.html): a list of
   questions beside a stage; an answer (a slider for a scale, one choice
   for the rest) and an optional reason in one line; results that stay
   closed until you answer; then everyone's answers as dots, one per person,
   the reasons people gave in a column per side with likes and dislikes, and
   a balance that tips toward the side whose reasons score higher.

   The review drew invented voters and reasons. Here every dot and every
   reason is the backend's:
   - Answers are the poll route's, one per browser session, counted without
     an account. The page reads them sealed (`sealed=1`): the counts per
     answer do not leave the server until this session has answered or has
     asked to see them.
   - Seeing them first is a choice with a consequence, said before it is
     made: the server then refuses an answer from this session for this
     question, because an answer given after seeing everyone else's is not
     the independent answer the counts claim. Someone who answered first
     can look and still change their answer.
   - A reason is a comment on the poll's key (`<slug>-poll-<id>`) whose
     anchor names the answer it argues for, moderated like every comment.
     Its score is likes minus dislikes, which sets the size of its dot.
   - A dot is a vote. Filled dots are votes with a published reason, sized
     by its score, and open the reason; hollow dots are votes without one.
     Where there are more reasons than votes in a column (a member gave a
     reason from another browser), the column shows the reasons.
   ========================================================================= */
(function () {
  'use strict';

  var T = function () { return window.GQTalk; };
  var esc = function (v) { return T().esc(v); };
  var plural = function (n, one, many) { return T().plural(n, one, many); };
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var MAX_DOTS = 60;
  var DMIN = 16, DMAX = 30, QDOT = 12;

  /* The tones a side can take: the brand's accent, Sisal and its three
     signals. A scale runs from the critical tone to the positive one through
     a quiet middle, so its two ends read as two ends. */
  var CHOICE = ['var(--g-accent)', 'var(--g-signal-caution)', 'var(--g-signal-positive)', 'var(--g-signal-critical)', 'var(--g-sisal)'];
  var SCALE = ['var(--g-signal-critical)', 'var(--g-signal-caution)', 'var(--g-text-subtle)', 'var(--g-accent)', 'var(--g-signal-positive)'];

  var ICON = {
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    plus: '<svg class="g-btn__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    talk: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3.2v-3.2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/></svg>'
  };

  function cookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function render(host, opts) {
    var slug = opts.slug;
    var polls = (opts.polls || []).filter(function (p) { return p && p.id && Array.isArray(p.options) && p.options.length; });
    if (!polls.length) { host.innerHTML = ''; return 0; }
    var pollUrl = '/api/content/' + encodeURIComponent(slug) + '/poll/';
    var live = {}, reasons = {}, ui = {};
    var linked = /^#viewpoint-(\d+)$/.exec(location.hash);
    var at = linked ? Math.min(polls.length - 1, Math.max(0, Number(linked[1]) - 1)) : 0;
    var several = polls.length > 1;

    host.innerHTML = '<div class="tq-vp' + (several ? '' : ' is-single') + '">' +
      (several ? '<div class="tq-vp__list" role="list" aria-label="Questions in this Topic">' + polls.map(function (poll, index) {
        return '<button class="tq-vp__item" type="button" role="listitem" data-vp-pick="' + index + '">' +
          '<span class="tq-vp__art" aria-hidden="true">' + (window.GQTopicArt ? window.GQTopicArt.well(41 + index * 23, { w: 160, h: 100, n: 10 }) : '') + '</span>' +
          '<span class="tq-vp__itext"><small>Viewpoint ' + (index + 1) + '</small><b>' + esc(poll.short || poll.question) + '</b><em data-vp-meta="' + index + '"></em></span></button>';
      }).join('') + '</div>' : '') +
      '<div class="tq-vp__stage" data-vp-stage></div></div>' +
      '<dialog class="tq-dialog tq-reason" data-vp-dialog aria-labelledby="vp-dialog-t"></dialog>' +
      '<dialog class="tq-dialog" data-vp-add aria-labelledby="vp-add-t"></dialog>';
    var stage = host.querySelector('[data-vp-stage]');
    var dialog = host.querySelector('[data-vp-dialog]');
    var addDialog = host.querySelector('[data-vp-add]');
    var tip = document.createElement('div');
    tip.className = 'tq-dtip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);

    /* ---- What a poll is made of ----------------------------------------- */
    function sidesOf(poll) {
      var opts2 = poll.options;
      if (poll.kind !== 'scale') {
        return opts2.map(function (o, i) { return { key: o.id, name: o.label, head: 'Why “' + o.label + '”', tone: CHOICE[i % CHOICE.length] }; });
      }
      var first = opts2[0].label, last = opts2[opts2.length - 1].label;
      return [
        { key: 'low', name: first, head: 'Toward “' + first + '”', tone: SCALE[0] },
        { key: 'high', name: last, head: 'Toward “' + last + '”', tone: SCALE[4] }
      ];
    }
    function toneOf(poll, index) {
      if (poll.kind !== 'scale') return CHOICE[index % CHOICE.length];
      var n = poll.options.length;
      if (n === 1) return SCALE[2];
      return SCALE[Math.round(index / (n - 1) * 4)];
    }
    /* Which side an answer stands on; null for the middle of a scale. */
    function sideOfOption(poll, optionId) {
      var index = poll.options.findIndex(function (o) { return o.id === optionId; });
      if (index < 0) return null;
      if (poll.kind !== 'scale') return optionId;
      var n = poll.options.length;
      if (n % 2 && index === (n - 1) / 2) return null;
      return index < n / 2 ? 'low' : 'high';
    }
    function reasonSide(poll, c) {
      var a = c.anchor || {};
      return a.side || sideOfOption(poll, a.option) || null;
    }
    function stateOf(poll) { return ui[poll.id] = ui[poll.id] || { pick: null, why: '', whySide: null, ask: false, all: false, changing: false }; }
    var score = function (c) { return (c.like_count || 0) - (c.dislike_count || 0); };
    function title(c) { return String(c.body || '').split('\n')[0].trim(); }
    function detail(c) { return String(c.body || '').split('\n').slice(1).join('\n').trim(); }

    /* ---- Reading -------------------------------------------------------- */
    function load(poll, reveal) {
      return T().request(pollUrl + '?poll_id=' + encodeURIComponent(poll.id) + '&sealed=1' + (reveal ? '&reveal=1' : '')).then(function (data) {
        live[poll.id] = data.poll;
        meta(poll);
        return data.poll;
      });
    }
    function loadReasons(poll, force) {
      return T().list(slug + '-poll-' + poll.id, force).then(function (rows) { reasons[poll.id] = rows; return rows; }).catch(function () { reasons[poll.id] = null; return null; });
    }
    function meta(poll) {
      var index = polls.indexOf(poll);
      var node = host.querySelector('[data-vp-meta="' + index + '"]');
      var l = live[poll.id];
      if (!node || !l) return;
      node.innerHTML = plural(l.total_votes || 0, 'answer', 'answers') + (l.selected ? ' &middot; <u>You answered</u>' : l.seen_first ? ' &middot; results only' : '');
    }

    /* ---- The vote ------------------------------------------------------- */
    function voteCard(poll, l) {
      var st = stateOf(poll);
      var scale = poll.kind === 'scale';
      var options = l.options;
      var picked = st.pick != null ? st.pick : (l.selected || null);
      var pickedIndex = options.findIndex(function (o) { return o.id === picked; });
      var middle = picked && scale && sideOfOption(poll, picked) === null;
      var input = scale
        ? '<div class="tq-vp__scale"><span>' + esc(options[0].label) + '</span>' +
          '<input type="range" min="0" max="' + (options.length - 1) + '" step="1" value="' + (pickedIndex >= 0 ? pickedIndex : Math.floor((options.length - 1) / 2)) + '" data-vp-scale aria-label="Your answer, from ' + esc(options[0].label) + ' to ' + esc(options[options.length - 1].label) + '"' + (pickedIndex >= 0 ? ' aria-valuetext="' + esc(options[pickedIndex].label) + '"' : '') + '>' +
          '<span>' + esc(options[options.length - 1].label) + '</span></div>' +
          '<output class="tq-vp__now" data-vp-now>' + (pickedIndex >= 0 ? '<b>' + esc(options[pickedIndex].label) + '</b>' : 'Drag to choose') + '</output>'
        : '<div class="tq-vp__opts" role="radiogroup" aria-label="Your answer">' + options.map(function (o, i) {
          return '<button type="button" class="tq-vp__opt" role="radio" aria-checked="' + (picked === o.id) + '" data-vp-opt="' + esc(o.id) + '" style="--c:' + toneOf(poll, i) + '"><i aria-hidden="true"></i><b>' + esc(o.label) + '</b></button>';
        }).join('') + '</div>';
      var sides = sidesOf(poll);
      return '<form class="tq-vp__vote" data-vp-form>' +
        '<p class="tq-vp__step"><span>1</span><b>Your answer</b></p>' + input +
        '<p class="tq-vp__step"><span>2</span><b>Because&hellip;</b><em class="g-tag">Optional</em></p>' +
        '<div class="tq-vp__why"><label class="g-visually-hidden" for="vp-why-' + esc(poll.id) + '">Why you chose this, in one line</label>' +
          '<input class="g-input" id="vp-why-' + esc(poll.id) + '" maxlength="120" value="' + esc(st.why) + '" placeholder="Say why, in one line. You can skip this." data-vp-why>' +
          (middle ? '<div class="tq-vp__wside" role="group" aria-label="Your reason is for"><span>Your reason is for</span>' + sides.map(function (s) {
            return '<button type="button" data-vp-wside="' + esc(s.key) + '" aria-pressed="' + ((st.whySide || sides[0].key) === s.key) + '" style="--c:' + s.tone + '">' + esc(s.name) + '</button>';
          }).join('') + '</div>' : '') +
          '<p class="g-hint">A reason is posted under your name and read by a moderator first. Your answer counts at once, with or without an account.</p></div>' +
        (st.ask
          ? '<div class="tq-vp__warn" role="alertdialog" aria-labelledby="vp-warn-' + esc(poll.id) + '"><span class="tq-vp__warn-ic">' + ICON.lock + '</span><div>' +
            '<b id="vp-warn-' + esc(poll.id) + '">If you look first, you can’t answer this question</b>' +
            '<p>Seeing other people’s answers can change your own, so answering closes for you here. You will still see all the results, read the reasons and join in.</p>' +
            '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="button" data-vp-peek-go>Show results, no answer</button><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-vp-peek-no>Go back and answer</button></div></div></div>'
          : '<div class="tq-vp__act"><button class="g-btn g-btn--primary" type="submit"' + (picked ? '' : ' disabled') + ' data-vp-submit>' + (l.selected ? 'Change my answer' : 'Submit my answer') + '</button>' +
            (l.selected ? '<button class="tk-link" type="button" data-vp-cancel>Keep my answer</button>' : '<button class="tk-link" type="button" data-vp-peek>See results without answering</button>') +
            '<span class="g-hint" data-vp-note role="status"></span></div>') +
        '</form>';
    }

    /* ---- The results ---------------------------------------------------- */
    function histogram(poll, l, open) {
      var options = l.options;
      if (!open) {
        return '<div class="tq-vp__hist is-veiled" style="--bins:' + options.length + '">' + options.map(function (o) {
          return '<div class="tq-vp__bin is-ghost" aria-hidden="true"><div class="tq-vp__pile"></div><p class="tq-vp__pc">?</p><p class="tq-vp__bl">' + esc(o.label) + '</p></div>';
        }).join('') + '<div class="tq-vp__veil" role="status">' + ICON.lock + '<b>Results and reasons are hidden until you answer</b><span>So other people’s answers do not sway yours.</span></div></div>';
      }
      var rs = (reasons[poll.id] || []).filter(function (c) { return !c.parent_id && c.status !== 'pending' && (c.anchor || {}).option; });
      var total = l.total_votes || 0;
      var max = Math.max(1, Math.max.apply(null, rs.map(score).concat([1])));
      return '<div class="tq-vp__hist" style="--bins:' + options.length + '">' + options.map(function (o, i) {
        var tone = toneOf(poll, i);
        var mine = l.selected === o.id;
        var here = rs.filter(function (c) { return c.anchor.option === o.id; }).sort(function (a, b) { return score(b) - score(a); });
        var votes = o.votes || 0;
        var count = Math.max(votes, here.length);
        var dots = [];
        here.forEach(function (c) { dots.push({ reason: c }); });
        for (var k = here.length; k < count; k++) dots.push({});
        if (mine) {
          var own = dots.filter(function (d) { return d.reason && d.reason.mine; })[0] || dots.filter(function (d) { return !d.reason; })[0];
          if (own) own.me = true;
        }
        var shown = dots.slice(0, MAX_DOTS);
        var pct = total ? Math.round(votes / total * 100) : 0;
        return '<div class="tq-vp__bin' + (mine ? ' is-mine' : '') + '" role="group" aria-label="' + esc(o.label) + ': ' + plural(votes, 'answer', 'answers') + '">' +
          '<div class="tq-vp__pile">' + shown.map(function (d, k) {
            var delay = reduce() ? 0 : Math.min(k * 14, 600);
            if (d.reason) {
              var s = score(d.reason);
              var size = s <= 0 ? DMIN : DMIN + Math.round((DMAX - DMIN) * s / max);
              return '<button type="button" class="tq-vp__dot' + (d.me ? ' is-me' : '') + '" data-vp-reason="' + d.reason.id + '" style="--s:' + size + 'px;--c:' + tone + ';animation-delay:' + delay + 'ms" aria-label="' + esc(d.reason.author) + ': ' + esc(title(d.reason)) + '. Open"></button>';
            }
            return '<i class="tq-vp__dot is-quiet' + (d.me ? ' is-me' : '') + '" style="--s:' + QDOT + 'px;--c:' + tone + ';animation-delay:' + delay + 'ms" role="img" aria-label="' + (d.me ? 'Your answer' : 'An answer without a reason') + '"></i>';
          }).join('') + (dots.length > MAX_DOTS ? '<span class="tq-vp__more g-nums">+' + (dots.length - MAX_DOTS) + '</span>' : '') + '</div>' +
          '<p class="tq-vp__pc g-nums" style="color:' + tone + '">' + pct + '%</p><p class="tq-vp__bl">' + esc(o.label) + '</p></div>';
      }).join('') + '</div>';
    }

    function balance(poll) {
      var sides = sidesOf(poll);
      var rs = (reasons[poll.id] || []).filter(function (c) { return !c.parent_id && c.status !== 'pending'; });
      var weight = sides.map(function (s) { return rs.filter(function (c) { return reasonSide(poll, c) === s.key; }).reduce(function (sum, c) { return sum + Math.max(0, score(c)); }, 0); });
      var total = weight.reduce(function (a, b) { return a + b; }, 0);
      var share = weight.map(function (w) { return total ? w / total : 1 / sides.length; });
      var top = share.indexOf(Math.max.apply(null, share));
      var caption = !total ? 'No scored reasons yet. Like the reasons you find strong, and the balance moves.'
        : (Math.max.apply(null, share) - Math.min.apply(null, share) < 0.08 ? 'About even. The reasons on each side score alike.' : 'The reasons for “' + sides[top].name + '” score highest so far.');
      if (sides.length === 2) {
        var tilt = Math.max(-11, Math.min(11, (share[1] - 0.5) * 44));
        return '<div class="tq-vp__balance"><div class="tq-vp__bside"><small>' + esc(sides[0].name) + '</small><b class="g-nums">' + Math.round(share[0] * 100) + '%</b></div>' +
          '<div class="tq-vp__bmid"><svg viewBox="0 0 600 124" aria-hidden="true"><path class="tq-vp__stand" d="M300 62 L276 116 H324 Z"/>' +
            '<g class="tq-vp__beam" style="--tilt:' + tilt.toFixed(1) + 'deg">' +
              '<rect x="70" y="58" width="460" height="8" rx="4" class="tq-vp__bar"/><circle cx="300" cy="62" r="9" class="tq-vp__pivot"/>' +
              '<path d="M96 66 L70 98 M96 66 L122 98" class="tq-vp__rope"/><path d="M52 98 H140 Q131 116 96 116 Q61 116 52 98Z" style="fill:' + sides[0].tone + '"/>' +
              '<path d="M504 66 L478 98 M504 66 L530 98" class="tq-vp__rope"/><path d="M460 98 H548 Q539 116 504 116 Q469 116 460 98Z" style="fill:' + sides[1].tone + '"/>' +
            '</g></svg><p>' + esc(caption) + '</p></div>' +
          '<div class="tq-vp__bside is-right"><small>' + esc(sides[1].name) + '</small><b class="g-nums">' + Math.round(share[1] * 100) + '%</b></div></div>';
      }
      return '<div class="tq-vp__balance is-bar"><div class="tq-vp__tbar">' + sides.map(function (s, i) { return '<i style="width:' + (share[i] * 100).toFixed(1) + '%;background:' + s.tone + '"></i>'; }).join('') + '</div>' +
        '<div class="tq-vp__tleg">' + sides.map(function (s, i) { return '<span><i style="background:' + s.tone + '"></i>' + esc(s.name) + ' <b class="g-nums">' + Math.round(share[i] * 100) + '%</b></span>'; }).join('') + '</div><p>' + esc(caption) + '</p></div>';
    }

    /* A reason since the review of 2026-11-19: one flat card, not a card in a
       card. The reason itself leads, set in the reading face as a quote; who
       gave it sits under it, and the like, dislike and replies share one row
       at the foot, so a narrow column no longer stacks the controls beside
       three words a line. The score is not shown as its own chip: the two
       counts beside it already say it. */
    function reasonCard(poll, c, top) {
      var mine = c.viewer_reaction || '';
      var replies = (reasons[poll.id] || []).filter(function (r) { return r.parent_id === c.id; }).length;
      var pending = c.status === 'pending';
      return '<article class="tq-vp__reason' + (pending ? ' is-pending' : '') + (top ? ' is-top' : '') + '" data-vp-reason-card="' + c.id + '">' +
        (top ? '<span class="tq-vp__top">Highest score</span>' : '') +
        '<h5><button type="button" data-vp-reason="' + c.id + '">' + esc(title(c)) + '</button></h5>' +
        '<p class="tq-vp__rmeta">' + T().avatar(c.author, 'sm') + '<span class="tq-vp__rwho">' + esc(c.author) + '</span>' +
          (pending ? '<span class="g-tag">Waiting for review</span>' : '<span class="tq-vp__rwhen">' + esc(T().when(c.created_at)) + '</span>') + '</p>' +
        (pending ? '' : '<div class="tq-vp__rfoot"><div class="tq-vp__votes">' +
          '<button type="button" class="tq-vp__lk" data-vp-react="like:' + c.id + '" aria-pressed="' + (mine === 'like') + '" aria-label="Like. ' + plural(c.like_count || 0, 'like', 'likes') + '">' + T().icon.like + '<b class="g-nums">' + (c.like_count || 0) + '</b></button>' +
          '<button type="button" class="tq-vp__lk is-down" data-vp-react="dislike:' + c.id + '" aria-pressed="' + (mine === 'dislike') + '" aria-label="Dislike. ' + plural(c.dislike_count || 0, 'dislike', 'dislikes') + '">' + T().icon.dislike + '<b class="g-nums">' + (c.dislike_count || 0) + '</b></button></div>' +
          '<button type="button" class="tq-vp__cc" data-vp-reason="' + c.id + '" aria-label="' + plural(replies, 'reply', 'replies') + '. Open the reason.">' + ICON.talk + '<span class="g-nums">' + replies + '</span></button></div>') +
        '</article>';
    }

    function reasonColumns(poll) {
      var st = stateOf(poll);
      var sides = sidesOf(poll);
      var rs = (reasons[poll.id] || []).filter(function (c) { return !c.parent_id; });
      var limit = st.all ? 99 : 3;
      var loose = rs.filter(function (c) { return !reasonSide(poll, c); });
      var anyMore = false;
      var cols = sides.map(function (s) {
        var mine = rs.filter(function (c) { return reasonSide(poll, c) === s.key; })
          .sort(function (a, b) { return (b.status === 'pending') - (a.status === 'pending') || score(b) - score(a) || (b.like_count || 0) - (a.like_count || 0); });
        if (mine.length > limit) anyMore = true;
        return '<div class="tq-vp__col" style="--c:' + s.tone + '"><div class="tq-vp__colhead"><i class="tq-vp__cdot" aria-hidden="true"></i><div><h4>' + esc(s.name || s.head) + '</h4><p><span>' + plural(mine.filter(function (c) { return c.status !== 'pending'; }).length, 'reason', 'reasons') + '</span>' +
          '<button class="tq-vp__add" type="button" data-vp-add="' + esc(s.key) + '" aria-label="Add your reason for ' + esc(s.name || s.head) + '">' + ICON.plus + '<span>Add yours</span></button></p></div></div>' +
          '<div class="tq-vp__reasons">' + (mine.length ? mine.slice(0, limit).map(function (c, i) { return reasonCard(poll, c, i === 0 && score(c) > 0 && c.status !== 'pending'); }).join('')
            : '<p class="tk-empty">No reason on this side yet. Yours could be the first.</p>') + '</div></div>';
      }).join('');
      return '<div class="tq-vp__cols" style="--cols:' + Math.min(3, sides.length) + '">' + cols + '</div>' +
        (loose.length ? '<div class="tq-vp__loose"><h4>Reasons given without an answer named</h4><div class="tq-vp__reasons">' + loose.slice(0, limit).map(function (c) { return reasonCard(poll, c, false); }).join('') + '</div></div>' : '') +
        (anyMore || st.all || loose.length > limit ? '<div class="tq-vp__morewrap"><button class="g-btn g-btn--secondary g-btn--sm" type="button" data-vp-all aria-pressed="' + st.all + '">' + (st.all ? 'Show fewer reasons' : 'Show more reasons') + '</button></div>' : '');
    }

    function draw() {
      var poll = polls[at];
      var l = live[poll.id];
      host.querySelectorAll('[data-vp-pick]').forEach(function (b) { b.setAttribute('aria-current', String(Number(b.getAttribute('data-vp-pick')) === at)); });
      if (!l) {
        stage.innerHTML = '<p class="tk-empty">Loading this question&hellip;</p>';
        load(poll).then(function () { return loadReasons(poll); }).then(draw).catch(function () {
          stage.innerHTML = '<p class="tk-empty">This question could not be loaded just now. <button class="tk-link" type="button" data-vp-retry>Try again</button></p>';
        });
        return;
      }
      var st = stateOf(poll);
      var open = !l.sealed;
      var voting = !l.seen_first && (!l.selected || st.changing);
      var chosen = l.options.filter(function (o) { return o.id === l.selected; })[0];
      stage.innerHTML =
        '<header class="tq-vp__head"><p class="tq-vp__k">Viewpoint ' + (at + 1) + ' of ' + polls.length + ' &middot; ' + (poll.kind === 'scale' ? 'Scale' : 'Pick one') + ' &middot; <span class="g-nums">' + plural(l.total_votes || 0, 'answer', 'answers') + '</span></p>' +
          '<h3 id="vp-q-' + at + '">' + esc(l.question || poll.question) + '</h3>' + (l.note ? '<p class="tq-vp__info">' + esc(l.note) + '</p>' : '') + '</header>' +
        (l.seen_first ? '<div class="tq-vp__peekbar" role="status">' + ICON.eye + '<div><b>You are seeing the results only</b><span>Answering is closed for you on this question, so the results could not sway your answer. You can still read the reasons, rate them and join in.</span></div></div>' : '') +
        (voting ? voteCard(poll, l)
          : '<div class="tq-vp__rhead"><div><h4>' + (l.selected ? 'How everyone answered' : 'How people answered') + '</h4>' +
            '<p>Each dot is a person. Filled dots gave a reason: select one to read it, rate it and reply. Bigger dots are reasons with a higher score. Hollow dots answered without a reason.</p></div>' +
            (chosen ? '<div class="tq-vp__mine"><small>You answered</small><b>' + esc(chosen.label) + '</b><button class="tk-link" type="button" data-vp-change>Change my answer</button></div>' : '') + '</div>') +
        '<div class="tq-vp__histbox' + (open ? '' : ' is-pre') + '">' + histogram(poll, l, open) + '</div>' +
        (open
          ? '<div class="tq-vp__why2"><h4>See why others think so</h4><p>Like or dislike the reasons. A reason’s score is its likes minus its dislikes.</p></div>' + balance(poll) +
            (reasons[poll.id] === null ? '<p class="tk-empty">Reasons could not be loaded just now.</p>' : reasonColumns(poll))
          /* The veil over the histogram already says what is locked and why;
             a second lock box under it said the same again (review of 2026-11-21). */
          : '');
    }

    /* ---- Doing ---------------------------------------------------------- */
    function submit(form) {
      var poll = polls[at];
      var l = live[poll.id];
      var st = stateOf(poll);
      var note = form.querySelector('[data-vp-note]');
      var choice = st.pick || l.selected;
      if (!choice) { note.textContent = poll.kind === 'scale' ? 'Move the slider to your answer first.' : 'Choose an answer first.'; return; }
      var why = (form.querySelector('[data-vp-why]').value || '').trim();
      var button = form.querySelector('[data-vp-submit]');
      button.disabled = true;
      note.textContent = 'Saving…';
      T().request(pollUrl, 'POST', { poll_id: poll.id, option_id: choice }).then(function (data) {
        live[poll.id] = data.poll;
        meta(poll);
        st.changing = false;
        if (!why) return 'Answer saved. Here is how everyone answered.';
        var side = sideOfOption(poll, choice) || st.whySide || sidesOf(poll)[0].key;
        return T().me().then(function (who) {
          if (!who.authenticated) { st.why = why; return 'Answer saved. Sign in to add your reason; it is kept on this device.'; }
          return T().post(slug + '-poll-' + poll.id, why, { anchor: { kind: 'reason', option: choice, side: side } }).then(function () {
            st.why = '';
            return loadReasons(poll, true).then(function () { return 'Answer and reason saved. Your reason shows for everyone once a moderator has read it.'; });
          }).catch(function () { return 'Answer saved. The reason could not be sent; try Add yours below.'; });
        });
      }).then(function (message) {
        st.pick = null;
        draw();
        T().toast(message);
        var head = stage.querySelector('.tq-vp__rhead');
        if (head) head.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' });
      }).catch(function (error) {
        if (error && error.error === 'results_seen_first') {
          if (error.poll) live[poll.id] = error.poll;
          draw();
          T().toast('You saw the results first, so this question is closed for an answer from you.');
          return;
        }
        button.disabled = false;
        note.textContent = 'We couldn’t save your answer. Please try again.';
      });
    }

    function reactTo(poll, id, value, button) {
      var c = (reasons[poll.id] || []).filter(function (r) { return r.id === id; })[0];
      if (!c) return;
      T().me().then(function (who) {
        if (!who.authenticated) { T().toast('Sign in to rate a reason.', { href: '/login', label: 'Sign in' }); return; }
        var next = c.viewer_reaction === value ? '' : value;
        var before = { like_count: c.like_count, dislike_count: c.dislike_count, viewer_reaction: c.viewer_reaction };
        if (c.viewer_reaction === 'like') c.like_count--;
        if (c.viewer_reaction === 'dislike') c.dislike_count--;
        if (next === 'like') c.like_count++;
        if (next === 'dislike') c.dislike_count++;
        c.viewer_reaction = next;
        redrawResults(button);
        T().react(slug + '-poll-' + poll.id, id, next).then(function (data) {
          c.like_count = data.like_count; c.dislike_count = data.dislike_count; c.viewer_reaction = data.reaction;
          redrawResults();
        }).catch(function (error) { Object.assign(c, before); redrawResults(); T().toast(T().failure(error, 'save your rating')); });
      });
    }
    /* Ratings move dots and the balance; redraw in place and keep focus. */
    function redrawResults(button) {
      var focusKey = button ? button.getAttribute('data-vp-react') : (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-vp-react'));
      var inDialog = dialog.open;
      var y = window.scrollY;
      draw();
      window.scrollTo(0, y);
      if (inDialog && dialog.dataset.id) openReason(Number(dialog.dataset.id), true);
      if (focusKey) {
        var again = (inDialog ? dialog : stage).querySelector('[data-vp-react="' + focusKey + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    }

    function openReason(id, keep) {
      var poll = polls[at];
      var all = reasons[poll.id] || [];
      var c = all.filter(function (r) { return r.id === id; })[0];
      if (!c) return;
      var side = sidesOf(poll).filter(function (s) { return s.key === reasonSide(poll, c); })[0];
      var replies = all.filter(function (r) { return r.parent_id === c.id; });
      var mine = c.viewer_reaction || '';
      var pending = c.status === 'pending';
      dialog.dataset.id = String(id);
      dialog.innerHTML = '<div class="tq-dialog__head">' + (side ? '<span class="tq-vp__side" style="--c:' + side.tone + '">' + esc(side.name) + '</span>' : '<span></span>') +
          '<button class="tq-icon-btn tq-icon-btn--sm" type="button" data-dialog-close aria-label="Close">' + T().icon.close + '</button></div>' +
        '<h3 id="vp-dialog-t" tabindex="-1">' + esc(title(c)) + '</h3>' +
        '<p class="tq-vp__rmeta">' + T().avatar(c.author, 'sm') + '<span>' + esc(c.author) + '</span><span>&middot; ' + esc(T().when(c.created_at)) + '</span>' + (c.mine ? '<span class="g-tag">Yours</span>' : '') + '</p>' +
        (detail(c) ? '<p class="tq-reason__body">' + esc(detail(c)) + '</p>' : '') +
        (pending ? '<p class="tk-pending">' + T().icon.clock + '<span>Waiting for review. Only you can see it until a moderator has read it.</span></p>'
          : '<div class="tq-reason__act"><button type="button" class="tq-vp__lk is-wide" data-vp-react="like:' + c.id + '" aria-pressed="' + (mine === 'like') + '">' + T().icon.like + '<b class="g-nums">' + (c.like_count || 0) + '</b><span>' + (mine === 'like' ? 'You like this' : 'Like') + '</span></button>' +
            '<button type="button" class="tq-vp__lk is-wide is-down" data-vp-react="dislike:' + c.id + '" aria-pressed="' + (mine === 'dislike') + '">' + T().icon.dislike + '<b class="g-nums">' + (c.dislike_count || 0) + '</b><span>' + (mine === 'dislike' ? 'You dislike this' : 'Dislike') + '</span></button>' +
            '<span class="tq-vp__score is-big g-nums" title="Likes minus dislikes. It sets the size of the dot.">Score ' + (score(c) > 0 ? '+' : '') + score(c) + '</span></div>') +
        '<h4 class="tq-reason__ch">' + plural(replies.length, 'reply', 'replies') + '</h4>' +
        '<div class="tq-reason__replies">' + (replies.length ? replies.map(function (r) {
          return '<div class="tq-reason__reply' + (r.status === 'pending' ? ' is-pending' : '') + '">' + T().avatar(r.author, 'sm') + '<div><p class="tq-reason__who"><b>' + esc(r.author) + '</b><span>' + esc(T().when(r.created_at)) + (r.status === 'pending' ? ' · waiting for review' : '') + '</span></p><p>' + esc(r.body) + '</p></div></div>';
        }).join('') : '<p class="tk-empty">No replies yet. Ask what made them think so, or add what is missing.</p>') + '</div>' +
        (pending ? '' : '<form class="tk-compose tk-compose--reply" data-vp-reply="' + c.id + '"><label class="g-visually-hidden" for="vp-reply-' + c.id + '">Your reply</label>' +
          '<textarea class="g-textarea" id="vp-reply-' + c.id + '" rows="2" maxlength="5000" required placeholder="Reply to ' + esc(c.author) + '…"></textarea>' +
          '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Post reply</button><span class="g-hint">A moderator reads every reply first.</span></div><div data-vp-signin></div></form>');
      if (!dialog.open) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
      if (!keep) setTimeout(function () { var h = dialog.querySelector('#vp-dialog-t'); if (h) h.focus({ preventScroll: true }); }, 30);
    }

    function openAdd(sideKey) {
      var poll = polls[at];
      var sides = sidesOf(poll);
      var l = live[poll.id];
      addDialog.innerHTML = '<div class="tq-dialog__head"><h3 id="vp-add-t">Add your reason</h3><button class="tq-icon-btn tq-icon-btn--sm" type="button" data-dialog-close aria-label="Close">' + T().icon.close + '</button></div>' +
        '<form class="tq-vp__addform" data-vp-addform>' +
          '<label class="g-label" for="vp-add-side">This is a reason for</label><select class="g-select" id="vp-add-side" data-vp-addside>' +
            sides.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === sideKey ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
          '<label class="g-label" for="vp-add-t1">In one line</label><input class="g-input" id="vp-add-t1" maxlength="120" required data-vp-addtitle>' +
          '<label class="g-label" for="vp-add-b">Explain it <span class="g-tag">Optional</span></label><textarea class="g-textarea" id="vp-add-b" rows="4" maxlength="1500" data-vp-addbody></textarea>' +
          '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Add reason</button><span class="g-hint">Members can add a reason. A moderator reads it first.</span></div><div data-vp-signin></div></form>';
      if (addDialog.showModal) addDialog.showModal(); else addDialog.setAttribute('open', '');
      addDialog.querySelector('[data-vp-addtitle]').focus();
      addDialog.dataset.option = l && l.selected ? l.selected : '';
    }

    /* ---- Events --------------------------------------------------------- */
    host.addEventListener('click', function (event) {
      var t = event.target;
      var poll = polls[at];
      var st = stateOf(poll);
      var pick = t.closest('[data-vp-pick]');
      if (pick) { at = Number(pick.getAttribute('data-vp-pick')); history.replaceState(null, '', '#viewpoint-' + (at + 1)); draw(); railFor(); return; }
      if (t.closest('[data-vp-retry]')) { draw(); return; }
      var opt = t.closest('[data-vp-opt]');
      if (opt) {
        st.pick = opt.getAttribute('data-vp-opt');
        st.why = (stage.querySelector('[data-vp-why]') || {}).value || st.why;
        stage.querySelectorAll('[data-vp-opt]').forEach(function (b) { b.setAttribute('aria-checked', String(b === opt)); });
        var submitButton = stage.querySelector('[data-vp-submit]');
        if (submitButton) submitButton.disabled = false;
        return;
      }
      var wside = t.closest('[data-vp-wside]');
      if (wside) { st.whySide = wside.getAttribute('data-vp-wside'); stage.querySelectorAll('[data-vp-wside]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === wside)); }); return; }
      if (t.closest('[data-vp-peek]')) { st.why = (stage.querySelector('[data-vp-why]') || {}).value || ''; st.ask = true; draw(); var no = stage.querySelector('[data-vp-peek-no]'); if (no) no.focus({ preventScroll: true }); return; }
      if (t.closest('[data-vp-peek-no]')) { st.ask = false; draw(); var back = stage.querySelector('[data-vp-peek]'); if (back) back.focus({ preventScroll: true }); return; }
      if (t.closest('[data-vp-peek-go]')) {
        st.ask = false;
        load(poll, true).then(function () { return loadReasons(poll); }).then(function () { draw(); T().toast('Results only. Answering is closed for you on this question.'); })
          .catch(function () { T().toast('The results could not be loaded just now.'); });
        return;
      }
      if (t.closest('[data-vp-change]')) { st.changing = true; st.pick = null; draw(); return; }
      if (t.closest('[data-vp-cancel]')) { st.changing = false; st.pick = null; draw(); return; }
      if (t.closest('[data-vp-all]')) { st.all = !st.all; draw(); var again = stage.querySelector('[data-vp-all]'); if (again) again.focus({ preventScroll: true }); return; }
      var react = t.closest('[data-vp-react]');
      if (react && !dialog.contains(react)) { var parts = react.getAttribute('data-vp-react').split(':'); reactTo(poll, Number(parts[1]), parts[0], react); return; }
      var reason = t.closest('[data-vp-reason]');
      if (reason && !dialog.contains(reason)) { openReason(Number(reason.getAttribute('data-vp-reason'))); return; }
      var card = t.closest('[data-vp-reason-card]');
      if (card && !t.closest('button')) { openReason(Number(card.getAttribute('data-vp-reason-card'))); return; }
      var add = t.closest('[data-vp-add]');
      if (add && !addDialog.contains(add)) { openAdd(add.getAttribute('data-vp-add')); }
    });
    host.addEventListener('input', function (event) {
      var poll = polls[at];
      var st = stateOf(poll);
      var t = event.target;
      if (t.matches('[data-vp-scale]')) {
        var l = live[poll.id];
        var o = l.options[Number(t.value)];
        var hadMiddle = st.pick && sideOfOption(poll, st.pick) === null;
        st.pick = o.id;
        st.why = (stage.querySelector('[data-vp-why]') || {}).value || st.why;
        t.setAttribute('aria-valuetext', o.label);
        stage.querySelector('[data-vp-now]').innerHTML = '<b>' + esc(o.label) + '</b>';
        var submitButton = stage.querySelector('[data-vp-submit]');
        if (submitButton) submitButton.disabled = false;
        /* The side picker appears for the middle of a scale and only there. */
        if (hadMiddle !== (sideOfOption(poll, o.id) === null)) { draw(); var slider = stage.querySelector('[data-vp-scale]'); if (slider) slider.focus(); }
        return;
      }
      if (t.matches('[data-vp-why]')) st.why = t.value;
    });
    host.addEventListener('submit', function (event) {
      if (event.target.matches('[data-vp-form]')) { event.preventDefault(); submit(event.target); return; }
      var poll = polls[at];
      var replyForm = event.target.closest('[data-vp-reply]');
      if (replyForm) {
        event.preventDefault();
        var parent = Number(replyForm.getAttribute('data-vp-reply'));
        var body = replyForm.querySelector('textarea').value.trim();
        if (!body) return;
        T().me().then(function (who) {
          if (!who.authenticated) { replyForm.querySelector('[data-vp-signin]').innerHTML = T().signInPrompt('reply'); return; }
          return T().post(slug + '-poll-' + poll.id, body, { parent: parent }).then(function () {
            return loadReasons(poll, true);
          }).then(function () { openReason(parent, true); T().toast('Reply sent. It shows for everyone once a moderator has read it.'); });
        }).catch(function (error) { T().toast(T().failure(error, 'reply')); });
        return;
      }
      var addForm = event.target.closest('[data-vp-addform]');
      if (addForm) {
        event.preventDefault();
        var line = addForm.querySelector('[data-vp-addtitle]').value.trim();
        var more = addForm.querySelector('[data-vp-addbody]').value.trim();
        var side = addForm.querySelector('[data-vp-addside]').value;
        if (!line) return;
        var option = poll.kind === 'scale' ? (addDialog.dataset.option || '') : side;
        T().me().then(function (who) {
          if (!who.authenticated) { addForm.querySelector('[data-vp-signin]').innerHTML = T().signInPrompt('add a reason'); return; }
          return T().post(slug + '-poll-' + poll.id, line + (more ? '\n' + more : ''), { anchor: { kind: 'reason', option: option, side: side } }).then(function () {
            addDialog.close();
            return loadReasons(poll, true);
          }).then(function () { draw(); T().toast('Added. It shows in its column for you now, and for everyone once a moderator has read it.'); });
        }).catch(function (error) { T().toast(T().failure(error, 'add the reason')); });
      }
    });
    [dialog, addDialog].forEach(function (d) {
      d.addEventListener('click', function (event) {
        if (event.target === d || event.target.closest('[data-dialog-close]')) { d.close(); return; }
        var react = event.target.closest('[data-vp-react]');
        if (react) { var parts = react.getAttribute('data-vp-react').split(':'); reactTo(polls[at], Number(parts[1]), parts[0], react); }
      });
    });

    /* The dot's own line, under a mouse or a keyboard focus. */
    function showTip(event) {
      var dot = event.target.closest && event.target.closest('.tq-vp__dot');
      if (!dot) return;
      var poll = polls[at];
      var id = Number(dot.getAttribute('data-vp-reason'));
      var c = id ? (reasons[poll.id] || []).filter(function (r) { return r.id === id; })[0] : null;
      tip.innerHTML = c ? '<b>' + esc(c.author) + '</b><span>' + esc(title(c)) + '</span>' : '<span>' + (dot.classList.contains('is-me') ? 'Your answer' : 'Answered without a reason') + '</span>';
      tip.hidden = false;
      var r = dot.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = (r.top - tip.offsetHeight - 10) + 'px';
    }
    function hideTip(event) { if (!event || !event.target.closest || event.target.closest('.tq-vp__dot')) tip.hidden = true; }
    host.addEventListener('pointerover', showTip);
    host.addEventListener('pointerout', hideTip);
    host.addEventListener('focusin', showTip);
    host.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });

    function railFor() {
      if (!window.GQTopicToc || !several) return;
      window.GQTopicToc.set('views', polls.length, polls.map(function (p, k) { return { label: p.short || p.question, href: '#viewpoint-' + (k + 1), current: k === at }; }));
    }
    window.addEventListener('hashchange', function () {
      var asked = /^#viewpoint-(\d+)$/.exec(location.hash);
      if (!asked) return;
      var index = Math.min(polls.length - 1, Math.max(0, Number(asked[1]) - 1));
      if (index !== at) { at = index; draw(); railFor(); }
    });
    T().on && polls.forEach(function (poll) { T().on(slug + '-poll-' + poll.id, function () { loadReasons(poll).then(function () { if (polls[at] === poll) draw(); }); }); });

    polls.forEach(function (poll, index) { if (index !== at) load(poll).catch(function () {}); });
    draw();
    railFor();
    return polls.length;
  }

  window.GQViewpoints = { render: render };
})();
