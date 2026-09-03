(function(){
'use strict';

var scheduled=false;
var legacyLoadedFor=null;
var legacyState=null;
var legacyLoading=false;
var spaceLoadedFor=null;
var spacePlacement=null;

function notesRoute(){return location.pathname.indexOf('/workspace/research/notes')===0}
function projectId(){var m=location.pathname.match(/^\/workspace\/research\/projects\/(\d+)\/?$/);return m?Number(m[1]):null}
function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var value=parts[i].trim();if(value.indexOf(name+'=')===0)return decodeURIComponent(value.slice(name.length+1))}return ''}
function api(url,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=opts.headers||{};opts.headers.Accept='application/json';if(opts.method&&opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');opts.headers['Content-Type']='application/json'}return fetch(url,opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok){var e=new Error(String(d.error||'request_failed').replace(/_/g,' '));e.code=d.error;e.data=d;e.status=r.status;throw e}return d})})}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]})}
function spaceUrl(path){return '/nextcloud/index.php/apps/files/files?dir='+encodeURIComponent('/'+String(path||'').replace(/^\/+/,''))}

function ensureNotesNavigation(){
  var box=document.getElementById('v3-context-nav');
  if(box&&location.pathname.indexOf('/workspace/research')===0&&!box.querySelector('a[href="/workspace/research/notes"]')){
    var link=document.createElement('a');
    link.href='/workspace/research/notes';
    link.innerHTML='<span>✎</span>Notes';
    if(notesRoute())link.className='is-active';
    var files=box.querySelector('a[href="/workspace/research/files"]');
    box.insertBefore(link,files||null);
  }

  var select=document.getElementById('ws-mobile-select');
  if(!select)return;
  var option=select.querySelector('option[value="/workspace/research/notes"]');
  if(!option){
    option=document.createElement('option');
    option.value='/workspace/research/notes';
    option.textContent='Research · Notes';
    var filesOption=select.querySelector('option[value="/workspace/research/files"]');
    select.insertBefore(option,filesOption||null);
  }
  if(notesRoute()&&select.value!=='/workspace/research/notes')select.value='/workspace/research/notes';
}

function showMessage(text){
  var box=document.getElementById('ws-alert');
  if(!box)return;
  box.hidden=false;
  box.textContent=text;
  box.style.borderLeftColor='var(--ws-danger)';
  clearTimeout(showMessage.timer);
  showMessage.timer=setTimeout(function(){box.hidden=true},5000);
}

function showLegacyMessage(text,bad){
  var box=document.getElementById('ws-alert');
  if(!box)return;
  box.hidden=false;
  box.textContent=text;
  box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-good)';
  clearTimeout(showLegacyMessage.timer);
  showLegacyMessage.timer=setTimeout(function(){box.hidden=true},bad?10000:6500);
}

function hardenSpaceProjectForm(){
  var dialog=document.getElementById('space-v1-dialog');
  if(!dialog||!dialog.open)return;
  var title=dialog.querySelector('[data-space-title]');
  var category=dialog.querySelector('select[name="category_id"]');
  var newCategory=dialog.querySelector('input[name="new_category"]');
  var form=dialog.querySelector('form');
  if(!form||!category||!newCategory||!title||!/research project/i.test(title.textContent||''))return;

  var first=category.options&&category.options[0];
  if(first&&first.value==='')first.textContent='Choose a Category…';

  if(form.dataset.spaceCategoryGuard==='1')return;
  form.dataset.spaceCategoryGuard='1';
  form.addEventListener('submit',function(e){
    if(category.value||String(newCategory.value||'').trim())return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showMessage('Choose a parent Category or create a new Category first.');
    category.focus({preventScroll:true});
    category.scrollIntoView({behavior:'smooth',block:'center'});
  },true);
}

function hardenAccessDialog(){
  var dialog=document.getElementById('v5-access-dialog');
  if(!dialog||!dialog.open)return;
  dialog.querySelectorAll('button,select,input,a').forEach(function(el){
    el.style.touchAction='manipulation';
  });
}

function legacyDismissed(id){
  try{return sessionStorage.getItem('gravitas-legacy-folders-'+id)==='dismissed'}catch(e){return false}
}

function loadSpacePlacement(){
  var id=projectId();
  if(!id)return;
  if(spaceLoadedFor===id&&spacePlacement){decorateSpacePlacement();return}
  api('/api/platform/space/projects/'+id+'/').then(function(d){
    if(projectId()!==id)return;
    spaceLoadedFor=id;
    spacePlacement=d.placement||null;
    decorateSpacePlacement();
  }).catch(function(){spaceLoadedFor=id;spacePlacement=null});
}

function decorateSpacePlacement(){
  if(!spacePlacement||!spacePlacement.folder_path)return;
  var banner=document.getElementById('legacy-folder-banner');
  if(banner){
    var target=banner.querySelector('[data-legacy-space-path]');
    if(target){
      target.hidden=false;
      target.innerHTML='Current Nextcloud Space: <code>'+esc(spacePlacement.folder_path)+'</code> · <a href="'+esc(spaceUrl(spacePlacement.folder_path))+'" target="_blank" rel="noopener">Open Space ↗</a>';
    }
  }
}

function renderLegacyFolders(legacy){
  var id=projectId();
  var old=document.getElementById('legacy-folder-banner');
  if(!id||!legacy||!legacy.active||!legacy.can_cleanup||legacyDismissed(id)){
    if(old)old.remove();
    return;
  }
  var content=document.getElementById('ws-content');
  var cockpit=content&&content.querySelector('.v5-cockpit');
  if(!cockpit)return;
  if(old&&old.dataset.projectId===String(id)){decorateSpacePlacement();return}
  if(old)old.remove();

  var banner=document.createElement('section');
  banner.id='legacy-folder-banner';
  banner.className='legacy-folder-banner';
  banner.dataset.projectId=String(id);
  var blocked=legacy.database_blocked_count||0;
  var chips=(legacy.items||[]).map(function(item){return '<span'+(!item.database_empty?' data-busy="true"':'')+'>'+esc(item.name)+'</span>'}).join('');
  banner.innerHTML='<div class="legacy-folder-banner__copy"><small>OLDER PROJECT STRUCTURE</small><strong>Legacy auto-generated folders detected</strong><p>This project still has folders created by the old fixed structure. Gravitas can remove only folders that are empty in both the database and Nextcloud. Files and subfolders are never deleted.</p><div class="legacy-folder-banner__chips">'+chips+'</div>'+(blocked?'<em>'+blocked+' folder'+(blocked===1?' already contains':'s already contain')+' linked content and will be kept.</em>':'')+'<em data-legacy-space-path hidden></em></div><div class="legacy-folder-banner__actions"><button type="button" class="ws-secondary-btn" data-legacy-folder-keep>Keep for now</button><button type="button" class="ws-primary-btn" data-legacy-folder-clean>Clean empty folders</button></div>';
  var strip=cockpit.querySelector('.v5-project-strip');
  if(strip&&strip.nextSibling)cockpit.insertBefore(banner,strip.nextSibling);else cockpit.insertBefore(banner,cockpit.firstChild);
  loadSpacePlacement();
}

function checkLegacyFolders(){
  var id=projectId();
  if(!id){
    legacyLoadedFor=null;
    legacyState=null;
    spaceLoadedFor=null;
    spacePlacement=null;
    var old=document.getElementById('legacy-folder-banner');
    if(old)old.remove();
    return;
  }
  var content=document.getElementById('ws-content');
  if(!content||!content.querySelector('.v5-cockpit'))return;
  if(legacyDismissed(id))return;
  if(legacyLoadedFor===id&&legacyState){renderLegacyFolders(legacyState);return}
  if(legacyLoading)return;
  legacyLoading=true;
  api('/api/platform/projects/'+id+'/legacy-folders/').then(function(d){
    if(projectId()!==id)return;
    legacyLoadedFor=id;
    legacyState=d.legacy;
    renderLegacyFolders(legacyState);
  }).catch(function(){
    if(projectId()===id){legacyLoadedFor=id;legacyState={active:false}}
  }).finally(function(){legacyLoading=false});
}

function keepLegacyFolders(){
  var id=projectId();
  if(!id)return;
  try{sessionStorage.setItem('gravitas-legacy-folders-'+id,'dismissed')}catch(e){}
  var banner=document.getElementById('legacy-folder-banner');
  if(banner)banner.remove();
}

function cleanLegacyFolders(button){
  var id=projectId();
  if(!id)return;
  var message='Gravitas will remove only legacy folders that are empty in both Gravitas and Nextcloud. Any folder containing files or subfolders will be kept. Continue?';
  if(!window.confirm(message))return;
  var original=button.textContent;
  button.disabled=true;
  button.textContent='Checking Nextcloud…';
  api('/api/platform/projects/'+id+'/legacy-folders/',{method:'POST',body:JSON.stringify({confirmed:true})}).then(function(d){
    legacyLoadedFor=id;
    legacyState=d.legacy;
    var cleaned=(d.cleaned||[]).length;
    var blocked=(d.blocked||[]).length;
    var pending=d.nextcloud&&d.nextcloud.space_pending?d.nextcloud.space_pending.length:0;
    if(d.nextcloud&&d.nextcloud.space_paths&&d.nextcloud.space_paths.length){
      var first=d.nextcloud.space_paths[0];
      if(first&&first.path){spaceLoadedFor=id;spacePlacement={folder_path:first.path};}
    }
    if(cleaned){
      showLegacyMessage('Cleaned '+cleaned+' empty legacy folder'+(cleaned===1?'':'s')+'. '+blocked+' folder'+(blocked===1?' was':'s were')+' kept because they contain data.'+(pending?' Space sync has '+pending+' pending item(s).':''));
      setTimeout(function(){if(projectId()===id)location.reload()},1000);
    }else if(blocked){
      showLegacyMessage('Nothing was removed. The detected legacy folders contain data and were kept.');
      renderLegacyFolders(legacyState);
    }else{
      showLegacyMessage('No empty legacy folders remain. Nextcloud and Space were reconciled.');
      renderLegacyFolders(legacyState);
    }
  }).catch(function(err){
    if(err.code==='cloud_check_failed'){
      var detail=err.data||{};
      var where=detail.folder?' while checking “'+detail.folder+'”':'';
      showLegacyMessage('Nextcloud check failed'+where+'. Nothing was deleted. Please retry; the error is now preserved for diagnostics.',true);
    }else{
      showLegacyMessage(err.message,true);
    }
  }).finally(function(){
    button.disabled=false;
    button.textContent=original;
  });
}

function apply(){
  scheduled=false;
  ensureNotesNavigation();
  hardenSpaceProjectForm();
  hardenAccessDialog();
  checkLegacyFolders();
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(apply);
}

new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('popstate',function(){legacyLoadedFor=null;legacyState=null;spaceLoadedFor=null;spacePlacement=null;schedule()});
document.addEventListener('click',function(e){
  var keep=e.target.closest('[data-legacy-folder-keep]');
  if(keep){e.preventDefault();keepLegacyFolders();return}
  var clean=e.target.closest('[data-legacy-folder-clean]');
  if(clean){e.preventDefault();cleanLegacyFolders(clean);return}
  setTimeout(schedule,0);
},true);
document.addEventListener('change',function(){setTimeout(schedule,0)},true);
setTimeout(apply,120);
})();
