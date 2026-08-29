(function(){
'use strict';

var route=/^\/workspace\/core\/team\/?$/;
var busy=false;
var timer=null;
var selected='core';

function active(){return route.test(location.pathname)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var item=parts[i].trim();if(item.indexOf(name+'=')===0)return decodeURIComponent(item.slice(name.length+1))}return ''}
function api(url,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=opts.headers||{};opts.headers.Accept='application/json';if(opts.method&&opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');opts.headers['Content-Type']='application/json'}return fetch(url,opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(String(d.error||'Request failed').replace(/_/g,' '));return d})})}
function initials(name,email){var s=(name||email||'?').trim().split(/\s+/).filter(Boolean);return s.length>1?(s[0][0]+s[s.length-1][0]).toUpperCase():(s[0]||'?').slice(0,2).toUpperCase()}
function when(v){if(!v)return 'Never';try{return new Date(v).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric'})}catch(e){return v}}
function toast(text,bad){var box=document.getElementById('ws-alert');if(!box)return;box.hidden=false;box.textContent=text;box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';clearTimeout(toast.timer);toast.timer=setTimeout(function(){box.hidden=true},4200)}
function icons(name){var set=window.GravitasVisualIcons;return set&&set.icon?set.icon(name):''}

function row(u){return '<article class="ct-member" data-ct-registered-row data-ct-search="'+esc((u.name+' '+u.email+' registered pending').toLowerCase())+'">'+
  '<div class="ct-person"><div class="ct-avatar">'+esc(initials(u.name,u.email))+'</div><div><strong>'+esc(u.name)+'</strong><small>'+esc(u.email)+'</small></div></div>'+
  '<div class="ct-badges"><span class="ct-badge">Registered</span><span class="ct-badge" data-tone="'+(u.is_active?'active':'inactive')+'">'+(u.is_active?'Active':'Inactive')+'</span></div>'+
  '<div class="ct-meta"><span>'+icons('calendar')+'Signed up '+esc(when(u.date_joined))+'</span><span>'+icons('workflow')+'Last login '+esc(when(u.last_login))+'</span><span>'+icons(u.nextcloud&&u.nextcloud.provisioned?'shield':'database')+(u.nextcloud&&u.nextcloud.provisioned?'Nextcloud connected':'Personal account')+'</span></div>'+
  '<div class="ct-actions"><button type="button" data-ct-register-add="'+u.id+'" data-role="member">Add as Member</button><button type="button" data-ct-register-add="'+u.id+'" data-role="admin">Add as Admin</button></div></article>'}

function empty(){return '<div class="ct-empty">'+icons('users')+'<strong>No users waiting for access</strong><span>New self-registered accounts that are not yet in Core or Research will appear here.</span></div>'}

function showTab(name){
  selected=name||'core';
  var core=document.querySelector('[data-ct-section="core"]');
  var research=document.querySelector('[data-ct-section="research"]');
  var registered=document.querySelector('[data-ct-section="registered"]');
  if(!core||!research||!registered)return;
  core.hidden=selected!=='core'; research.hidden=selected!=='research'; registered.hidden=selected!=='registered';
  document.querySelectorAll('.ct-tab').forEach(function(btn){btn.classList.toggle('is-active',btn.getAttribute('data-ct-tab')===selected||btn.getAttribute('data-ct-registered-tab')===selected)});
}

function render(data){
  if(!active())return;
  var root=document.querySelector('[data-core-team-root]');
  if(!root)return;
  var tabs=root.querySelector('.ct-tabs');
  if(!tabs)return;
  var users=data.registered_users||[];
  var tab=tabs.querySelector('[data-ct-registered-tab]');
  if(!tab){
    tabs.insertAdjacentHTML('beforeend','<button type="button" class="ct-tab '+(selected==='registered'?'is-active':'')+'" data-ct-registered-tab="registered">Registered Users'+(users.length?' ('+users.length+')':'')+'</button>');
  }else{
    tab.textContent='Registered Users'+(users.length?' ('+users.length+')':'');
    tab.classList.toggle('is-active',selected==='registered');
  }
  var section=root.querySelector('[data-ct-section="registered"]');
  var html='<section class="ct-section" '+(selected==='registered'?'':'hidden')+' data-ct-section="registered"><div class="ct-panel"><div class="ct-panel__head"><div><h2>Registered Users</h2><p>Accounts created through sign-up that have not yet been granted Core or Research access.</p></div><span class="ct-badge" data-tone="admin">Pending access</span></div><div class="ct-list">'+(users.map(row).join('')||empty())+'</div></div><div class="ct-hint"><strong>Sign-up does not automatically grant internal access.</strong> Choose Member for normal Core access or Admin only for people who should manage the team and access settings.</div></section>';
  if(section)section.outerHTML=html;else root.insertAdjacentHTML('beforeend',html);
  showTab(selected);
}

function load(){
  if(!active()||busy||!document.querySelector('[data-core-team-root]'))return;
  busy=true;
  api('/api/platform/team/').then(render).catch(function(){}).finally(function(){busy=false});
}

function schedule(){clearTimeout(timer);timer=setTimeout(load,120)}

document.addEventListener('click',function(e){
  if(!active())return;
  var tab=e.target.closest('[data-ct-registered-tab]');
  if(tab){showTab('registered');return}
  var regular=e.target.closest('[data-ct-tab]');
  if(regular){selected=regular.getAttribute('data-ct-tab')||'core';setTimeout(schedule,0);return}
  var add=e.target.closest('[data-ct-register-add]');
  if(!add)return;
  var rowEl=add.closest('[data-ct-registered-row]');
  var email=rowEl&&rowEl.querySelector('.ct-person small')?rowEl.querySelector('.ct-person small').textContent:'';
  var name=rowEl&&rowEl.querySelector('.ct-person strong')?rowEl.querySelector('.ct-person strong').textContent:'';
  var role=add.getAttribute('data-role')||'member';
  var label=role==='admin'?'Admin':'Member';
  if(role==='admin'&&!confirm('Add '+name+' to Core as Admin? Admins can manage team access.'))return;
  add.disabled=true;
  api('/api/platform/team/',{method:'POST',body:JSON.stringify({name:name,email:email,role:role,send_setup:false})})
    .then(function(){toast(name+' added to Core as '+label+'.',false);var mainAdd=document.querySelector('[data-core-team-root]');if(mainAdd){mainAdd.remove();var content=document.getElementById('ws-content');if(content)content.innerHTML='<div class="ct-loading">Refreshing team access…</div>';}setTimeout(function(){location.reload()},250)})
    .catch(function(err){toast(err.message,true);add.disabled=false});
});

var observer=new MutationObserver(function(){
  if(!active()||busy)return;
  var root=document.querySelector('[data-core-team-root]');
  if(!root)return;
  if(!root.querySelector('[data-ct-registered-tab]')||!root.querySelector('[data-ct-section="registered"]'))schedule();
});
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('popstate',schedule);
schedule();
})();
