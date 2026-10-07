(function () {
  'use strict';
  if (location.pathname !== '/topics.html') return;
  var target=document.querySelector('[data-filterable]');
  if(!target) return;

  function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
  function dateLabel(value){if(!value)return'';var d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'});}
  function href(item){return '/topic.html?slug='+encodeURIComponent(item.slug);}

  var parent=target.parentElement;
  if(parent){var filters=parent.querySelector('.filters');if(filters)filters.remove();var empty=parent.querySelector('.empty');if(empty)empty.remove();}
  target.innerHTML='<p class="g-muted">Loading published topics…</p>';

  fetch('/api/content/?kind=topic&limit=50',{credentials:'same-origin',cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error('topics');return r.json();})
    .then(function(data){
      var items=Array.isArray(data.items)?data.items:[];
      target.innerHTML='';
      if(!items.length){target.innerHTML='<div class="g-cms-empty"><h2>No published topics yet.</h2></div>';return;}
      items.forEach(function(item,index){
        var topic=item.topic_data||{};
        var parts=[];
        if((topic.video||{}).duration)parts.push((topic.video||{}).duration+' video');
        if((topic.essay||{}).overview_html|| (topic.essay||{}).indepth_html)parts.push('Essay');
        if((topic.timeline||[]).length)parts.push('Timeline');
        if((topic.sources||[]).length)parts.push('Sources');
        if((topic.simulation||{}).code)parts.push('Simulation');
        var a=document.createElement('a');
        a.className='entry';
        a.href=href(item);
        a.innerHTML='<span class="entry__type">'+(topic.number?'Topic '+esc(topic.number):'Topic '+String(index+1).padStart(2,'0'))+'</span><div>' +
          '<h3>'+esc(item.title)+'</h3><p>'+esc(item.summary||'')+'</p>' +
          '<div class="entry__meta"><span>'+esc(parts.join(' · ')||'Topic')+'</span><span>'+(item.published_at?esc(dateLabel(item.published_at)):'Open')+'</span></div></div>';
        target.appendChild(a);
      });
    })
    .catch(function(){target.innerHTML='<div class="g-cms-empty"><p class="g-muted">Published topics are temporarily unavailable.</p></div>';});
})();