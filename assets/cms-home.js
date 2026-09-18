(function () {
  'use strict';
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;
  var section = document.getElementById('current-topic');
  if (!section) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function strip(html) {
    var d=document.createElement('div'); d.innerHTML=String(html||''); return (d.textContent||'').trim();
  }
  function url(item) { return '/topic.html?slug=' + encodeURIComponent(item.slug); }

  section.innerHTML='<div class="g-container"><div class="g-section-head"><p class="g-eyebrow">Start Here</p><h2>The Current Topic</h2></div><p class="g-muted">Loading the current topic…</p></div>';

  fetch('/api/content/?kind=topic&limit=1',{credentials:'same-origin',cache:'no-store'})
    .then(function(r){if(!r.ok) throw new Error('topic_list'); return r.json();})
    .then(function(data){
      var item=(data.items||[])[0];
      if(!item){ section.remove(); return; }
      var topic=item.topic_data||{};
      var essay=topic.essay||{};
      var tags=Array.isArray(topic.tags)?topic.tags:[];
      var video=topic.video||{};
      var meta=[];
      if(video.duration) meta.push(video.duration+' video');
      if((topic.timeline||[]).length) meta.push((topic.timeline||[]).length+' timeline nodes');
      if((topic.sources||[]).length) meta.push((topic.sources||[]).length+' sources');
      section.removeAttribute('data-rail');
      section.innerHTML='<div class="g-container">' +
        '<div class="lp-head"><div class="g-section-head" style="margin-bottom:0"><p class="g-eyebrow">Start Here</p><h2>The Current Topic</h2></div>' +
        '<a class="lp-head__link" href="topics.html">All Topics →</a></div>' +
        '<article class="g-mt-lg topic-home-card"><div>' +
        '<p class="g-eyebrow g-eyebrow--bare">' + (topic.number?'Topic '+esc(topic.number):'Topic') + '</p>' +
        '<h3 style="font-size:var(--g-fs-h2);margin:.25rem 0 .75rem">' + esc(item.title) + '</h3>' +
        '<p class="g-muted">' + esc(item.summary||'') + '</p>' +
        (tags.length?'<div class="pill-row g-mt-sm">'+tags.map(function(t){return '<span class="g-tag">'+esc(t)+'</span>';}).join('')+'</div>':'') +
        (meta.length?'<p class="g-subtle g-mt-sm">'+esc(meta.join(' · '))+'</p>':'') +
        '<div class="g-cluster g-mt-md"><a class="g-btn g-btn--primary" href="'+url(item)+'">Open Topic</a><a class="g-btn g-btn--secondary" href="'+url(item)+'#essay">Read the Essay</a></div></div>' +
        '<div class="topic-home-card__preview"><p class="g-eyebrow">Overview</p><p>'+esc(strip(essay.overview_html).slice(0,520))+(strip(essay.overview_html).length>520?'…':'')+'</p></div></article></div>';
    })
    .catch(function(){ section.remove(); });
})();