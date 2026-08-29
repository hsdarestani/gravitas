(function(){
'use strict';
if(!/^\/workspace\/operating\/strategy\/?$/.test(location.pathname))return;

var content=document.getElementById('ws-content');
var alertBox=document.getElementById('ws-alert');
var state={data:null,loading:false};

function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var item=parts[i].trim();if(item.indexOf(name+'=')===0)return decodeURIComponent(item.slice(name.length+1))}return ''}
function api(method){var opts={method:method||'GET',credentials:'same-origin',headers:{Accept:'application/json'}};if(opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');opts.headers['Content-Type']='application/json';opts.body='{}'}return fetch('/api/operating/roadmap-sync/',opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(String(d.detail||d.error||'Roadmap sync failed').replace(/_/g,' '));return d})})}
function when(value){if(!value)return 'Not synced yet';try{return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return value}}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function say(text,bad){if(!alertBox)return;alertBox.hidden=false;alertBox.textContent=text;alertBox.style.borderLeftColor=bad?'var(--ws-danger)':'var(--g-accent,#b59a78)';clearTimeout(say.timer);say.timer=setTimeout(function(){alertBox.hidden=true},4500)}
function seenKey(){return 'gravitas-roadmap-okr-revision'}
function render(){if(!state.data||!content)return;var existing=document.getElementById('roadmap-okr-sync-card');if(existing)existing.remove();var subnav=content.querySelector('.op-subnav');if(!subnav)return;var d=state.data.sync||{},source=d.source||{},counts=d.counts||{},error=d.last_error||'';var card=document.createElement('section');card.id='roadmap-okr-sync-card';card.className='roadmap-sync-card'+(state.loading?' is-syncing':'');card.innerHTML='<div class="roadmap-sync-card__main"><div class="roadmap-sync-card__icon" aria-hidden="true">↗</div><div class="roadmap-sync-card__copy"><strong>Linked to Gravitas Roadmap</strong><small>Roadmap-managed Objectives and Key Results are updated automatically. Progress, owner, health and confidence entered here are preserved.</small><div class="roadmap-sync-card__meta"><span class="roadmap-sync-pill" data-tone="ok">'+esc(counts.objectives||0)+' objectives</span><span class="roadmap-sync-pill" data-tone="ok">'+esc(counts.key_results||0)+' key results</span><span class="roadmap-sync-pill">Synced '+esc(when(d.last_synced_at))+'</span>'+(source.revision?'<span class="roadmap-sync-pill">rev '+esc(source.revision.slice(0,8))+'</span>':'')+(error?'<span class="roadmap-sync-pill" data-tone="error">Sync warning</span>':'')+'</div></div></div><div class="roadmap-sync-card__actions"><a class="ws-secondary-btn" href="'+esc(source.page_url||'https://gravitas-roadmap.pages.dev/')+'" target="_blank" rel="noopener">Open roadmap ↗</a>'+(state.data.can_sync?'<button type="button" class="ws-secondary-btn" data-roadmap-sync-now>'+(state.loading?'Syncing…':'Sync now')+'</button>':'')+'</div>';
subnav.insertAdjacentElement('afterend',card)}
function maybeReload(data){var d=data.sync||{},revision=(d.source||{}).revision||'';if(!revision||!(d.auto_sync||{}).attempted_now)return false;var previous='';try{previous=sessionStorage.getItem(seenKey())||''}catch(e){}if(previous===revision)return false;try{sessionStorage.setItem(seenKey(),revision)}catch(e){}location.reload();return true}
function load(){return api('GET').then(function(data){state.data=data;if(maybeReload(data))return;render()}).catch(function(err){say(err.message,true)})}
function syncNow(){if(state.loading)return;state.loading=true;render();api('POST').then(function(data){state.data=data;var revision=((data.sync||{}).source||{}).revision||'';try{if(revision)sessionStorage.setItem(seenKey(),revision)}catch(e){}say('Roadmap OKRs synced.');location.reload()}).catch(function(err){state.loading=false;render();say(err.message,true)})}

document.addEventListener('click',function(e){var button=e.target.closest('[data-roadmap-sync-now]');if(!button)return;e.preventDefault();syncNow()});
var timer;new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(render,40)}).observe(content,{childList:true});
load();
})();
