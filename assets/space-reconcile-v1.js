(function(){
'use strict';

var timer=null;
function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var value=parts[i].trim();if(value.indexOf(name+'=')===0)return decodeURIComponent(value.slice(name.length+1))}return ''}
function api(url,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=opts.headers||{};opts.headers.Accept='application/json';if(opts.method&&opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');opts.headers['Content-Type']='application/json'}return fetch(url,opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok){var e=new Error(String(d.error||'Request failed').replace(/_/g,' '));e.code=d.error;e.data=d;throw e}return d})})}
function message(text,bad){var box=document.getElementById('ws-alert');if(!box)return;box.hidden=false;box.textContent=text;box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';clearTimeout(message.timer);message.timer=setTimeout(function(){box.hidden=true},6000)}
function onNotes(){return location.pathname.replace(/\/$/,'')==='/workspace/research/notes'}
function inject(){
  if(!onNotes())return;
  var box=document.getElementById('ws-primary-actions');
  if(!box||box.querySelector('[data-space-reconcile]'))return;
  var button=document.createElement('button');
  button.type='button';button.className='ws-secondary-btn';button.dataset.spaceReconcile='1';button.textContent='Import Nextcloud changes';
  var sync=box.querySelector('[data-space-action="sync-space"]');
  if(sync&&sync.nextSibling)box.insertBefore(button,sync.nextSibling);else box.appendChild(button);
}
function reconcile(){
  if(!confirm('Accept confirmed Nextcloud-side Markdown and structural changes into Gravitas? Notes, projects, categories, subspaces, subprojects, tasks, subtasks and repositories can be reconciled.'))return;
  var button=document.querySelector('[data-space-reconcile]');if(button)button.disabled=true;
  api('/api/platform/space/reconcile/',{method:'POST',body:JSON.stringify({confirmed:true})}).then(function(d){
    var imported=(d.imported||[]).length,updated=(d.updated||[]).length,errors=(d.errors||[]).length;
    message('Nextcloud reconciled: '+updated+' updated, '+imported+' imported'+(errors?', '+errors+' errors':''),!!errors);
    setTimeout(function(){location.reload()},350);
  }).catch(function(err){message(err.message,true);if(button)button.disabled=false});
}
document.addEventListener('click',function(e){if(e.target.closest('[data-space-reconcile]')){e.preventDefault();reconcile()}},true);
var observer=new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(inject,80)});observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('popstate',inject);document.addEventListener('click',function(){setTimeout(inject,40)});inject();

if(!document.querySelector('script[data-space-managed]')){
  var managed=document.createElement('script');
  managed.src='/assets/space-managed-v1.js?v=20260831a';
  managed.async=false;
  managed.dataset.spaceManaged='1';
  document.body.appendChild(managed);
}
})();
