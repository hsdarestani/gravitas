(function(){
'use strict';

var activeOverlay=null;
var restoreFocus=null;

function projectId(){
  var match=location.pathname.match(/^\/workspace\/research\/projects\/(\d+)\/?$/);
  return match?Number(match[1]):null;
}

function cookie(name){
  var parts=(document.cookie||'').split(';');
  for(var i=0;i<parts.length;i++){
    var value=parts[i].trim();
    if(value.indexOf(name+'=')===0)return decodeURIComponent(value.slice(name.length+1));
  }
  return '';
}

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(char){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
  });
}

function api(url,options){
  options=options||{};
  options.credentials='same-origin';
  options.headers=options.headers||{};
  options.headers.Accept='application/json';
  if(options.method&&options.method!=='GET'){
    options.headers['X-CSRFToken']=cookie('csrftoken');
    if(!(options.body instanceof FormData))options.headers['Content-Type']='application/json';
  }
  return fetch(url,options).then(function(response){
    return response.json().catch(function(){return {}}).then(function(data){
      if(!response.ok){
        var error=new Error(String(data.error||'Request failed').replace(/_/g,' '));
        error.code=data.error;
        error.data=data;
        error.status=response.status;
        throw error;
      }
      return data;
    });
  });
}

function message(text,bad){
  var box=document.getElementById('ws-alert');
  if(!box)return;
  box.hidden=false;
  box.textContent=text;
  box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';
  clearTimeout(message.timer);
  message.timer=setTimeout(function(){box.hidden=true},bad?7000:4500);
}

function closeOverlay(force){
  if(!activeOverlay)return;
  if(!force&&activeOverlay.dataset.saving==='1')return;
  var overlay=activeOverlay;
  activeOverlay=null;
  document.body.classList.remove('note-ux-open');
  overlay.remove();
  if(restoreFocus&&document.contains(restoreFocus)){
    try{restoreFocus.focus({preventScroll:true})}catch(e){restoreFocus.focus()}
  }
  restoreFocus=null;
}

function mountOverlay(innerHtml,kind){
  closeOverlay(true);
  restoreFocus=document.activeElement;
  var overlay=document.createElement('div');
  overlay.className='note-ux-overlay';
  overlay.dataset.kind=kind||'detail';
  overlay.innerHTML='<div class="note-ux-scrim" data-note-ux-close></div>'+innerHtml;
  document.body.appendChild(overlay);
  document.body.classList.add('note-ux-open');
  activeOverlay=overlay;
  requestAnimationFrame(function(){overlay.classList.add('is-visible')});
  return overlay;
}

function refreshProject(){
  try{
    window.dispatchEvent(new PopStateEvent('popstate'));
  }catch(e){
    window.dispatchEvent(new Event('popstate'));
  }
}

function openProjectNoteComposer(id){
  if(!id)return;
  var overlay=mountOverlay(
    '<section class="note-ux-panel note-ux-composer" role="dialog" aria-modal="true" aria-labelledby="note-ux-title">'+
      '<header class="note-ux-head"><div><small>GRAVITAS</small><h2 id="note-ux-title">New note</h2></div><button type="button" class="note-ux-close" data-note-ux-close aria-label="Close">×</button></header>'+
      '<form class="note-ux-form">'+
        '<div class="note-ux-body">'+
          '<label class="note-ux-field"><span>Title</span><input name="title" type="text" maxlength="240" required autocomplete="off" placeholder="Note title"></label>'+
          '<label class="note-ux-field"><span>Note</span><textarea name="body" required spellcheck="true" placeholder="Write your research note…"></textarea></label>'+
          '<div class="note-ux-scope"><span>◇</span><div><strong>Current project</strong><small>Shared with project members according to project access.</small></div></div>'+
        '</div>'+
        '<footer class="note-ux-actions"><button type="button" class="ws-quiet-btn" data-note-ux-close>Cancel</button><button type="submit" class="ws-primary-btn" data-note-ux-save>Save note</button></footer>'+
      '</form>'+
    '</section>',
    'composer'
  );
  var form=overlay.querySelector('.note-ux-form');
  var save=overlay.querySelector('[data-note-ux-save]');
  var title=overlay.querySelector('input[name="title"]');
  setTimeout(function(){title.focus()},0);

  form.addEventListener('submit',function(event){
    event.preventDefault();
    if(overlay.dataset.saving==='1')return;
    var titleValue=String(title.value||'').trim();
    var body=String(overlay.querySelector('textarea[name="body"]').value||'').trim();
    if(!titleValue||!body)return;
    overlay.dataset.saving='1';
    save.disabled=true;
    save.textContent='Saving…';
    api('/api/platform/resources/',{
      method:'POST',
      body:JSON.stringify({
        kind:'note',
        title:titleValue,
        body:body,
        project_id:id,
        visibility:'project'
      })
    }).then(function(){
      overlay.dataset.saving='0';
      closeOverlay(true);
      message('Note saved. Nextcloud sync continues in the background.');
      setTimeout(refreshProject,20);
    }).catch(function(error){
      overlay.dataset.saving='0';
      save.disabled=false;
      save.textContent='Save note';
      message(error.message,true);
    });
  });
}

function detailBody(item){
  var text=item.body||item.description||'';
  if(item.kind==='paper'&&!text&&item.source_url)text=item.source_url;
  return text?'<div class="note-ux-detail-text">'+esc(text)+'</div>':'<div class="note-ux-empty">No text content.</div>';
}

function openResourceOverlay(resourceId){
  if(!resourceId)return;
  var overlay=mountOverlay(
    '<section class="note-ux-panel note-ux-detail" role="dialog" aria-modal="true" aria-labelledby="note-ux-detail-title">'+
      '<header class="note-ux-head"><div><small>KNOWLEDGE</small><h2 id="note-ux-detail-title">Opening…</h2></div><button type="button" class="note-ux-close" data-note-ux-close aria-label="Close">×</button></header>'+
      '<div class="note-ux-detail-body"><div class="note-ux-loading">Loading note…</div></div>'+
      '<footer class="note-ux-actions"><button type="button" class="ws-secondary-btn" data-note-ux-close>Close</button></footer>'+
    '</section>',
    'detail'
  );
  api('/api/platform/resources/'+resourceId+'/').then(function(data){
    if(!document.contains(overlay))return;
    var item=data.item||{};
    overlay.querySelector('#note-ux-detail-title').textContent=item.title||'Knowledge item';
    var owner=item.owner||item.owner_name||'';
    var meta=[item.kind_label||item.kind,owner].filter(Boolean).join(' · ');
    var body=overlay.querySelector('.note-ux-detail-body');
    var download=(item.has_download||item.kind==='file'||item.kind==='dataset')?'<a class="ws-secondary-btn" href="/api/platform/files/'+resourceId+'/download/">Download</a>':'';
    body.innerHTML=(meta?'<div class="note-ux-detail-meta">'+esc(meta)+'</div>':'')+detailBody(item)+(item.source_url?'<div class="note-ux-source"><span>Source</span><span>'+esc(item.source_url)+'</span></div>':'');
    var actions=overlay.querySelector('.note-ux-actions');
    if(download)actions.insertAdjacentHTML('afterbegin',download);
    var close=overlay.querySelector('[data-note-ux-close]');
    if(close)close.focus({preventScroll:true});
  }).catch(function(error){
    if(!document.contains(overlay))return;
    overlay.querySelector('#note-ux-detail-title').textContent='Could not open item';
    overlay.querySelector('.note-ux-detail-body').innerHTML='<div class="note-ux-empty">'+esc(error.message)+'</div>';
  });
}

document.addEventListener('click',function(event){
  var close=event.target.closest('[data-note-ux-close]');
  if(close&&activeOverlay){
    event.preventDefault();
    closeOverlay(false);
    return;
  }

  var id=projectId();
  if(!id)return;

  var noteButton=event.target.closest('[data-v2-action="project-note"]');
  if(noteButton){
    event.preventDefault();
    event.stopImmediatePropagation();
    openProjectNoteComposer(id);
    return;
  }

  var resourceButton=event.target.closest('[data-open-resource]');
  if(resourceButton){
    event.preventDefault();
    event.stopImmediatePropagation();
    openResourceOverlay(Number(resourceButton.getAttribute('data-open-resource')));
  }
},true);

document.addEventListener('keydown',function(event){
  if(event.key==='Escape'&&activeOverlay){
    event.preventDefault();
    event.stopPropagation();
    closeOverlay(false);
  }
},true);

})();
