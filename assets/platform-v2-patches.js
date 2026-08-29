(function(){
'use strict';

function cookie(name){
  var parts=(document.cookie||'').split(';');
  for(var i=0;i<parts.length;i++){
    var value=parts[i].trim();
    if(value.indexOf(name+'=')===0)return decodeURIComponent(value.slice(name.length+1));
  }
  return '';
}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(url,opts){
  opts=opts||{};
  opts.credentials='same-origin';
  opts.headers=opts.headers||{};
  opts.headers.Accept='application/json';
  if(opts.method&&opts.method!=='GET'){
    opts.headers['X-CSRFToken']=cookie('csrftoken');
    opts.headers['Content-Type']='application/json';
  }
  return fetch(url,opts).then(function(r){
    return r.json().catch(function(){return {}}).then(function(d){
      if(!r.ok)throw new Error((d.error||'Request failed').replace(/_/g,' '));
      return d;
    });
  });
}
function notify(text,bad){
  var box=document.getElementById('ws-alert');
  if(!box)return;
  box.hidden=false;
  box.textContent=text;
  box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';
  clearTimeout(notify.timer);
  notify.timer=setTimeout(function(){box.hidden=true},4000);
}

/*
 * Project edit protection.
 * platform-v2.js opens the existing project dialog synchronously. Once it is
 * open, restore the persisted visibility/confidentiality values so editing a
 * title or deadline can never silently reset a project's security posture.
 */
var mainDialog=document.getElementById('ws-dialog');
var editHydration=0;
function hydrateProjectSecurityFields(){
  if(!mainDialog||!mainDialog.open)return;
  var title=document.getElementById('ws-dialog-title');
  if(!title||title.textContent.trim()!=='Edit research project')return;
  var match=location.pathname.match(/^\/workspace\/research\/projects\/(\d+)/);
  if(!match)return;
  var token=++editHydration;
  api('/api/platform/projects/'+match[1]+'/').then(function(d){
    if(token!==editHydration||!mainDialog.open)return;
    var form=document.getElementById('ws-form');
    if(!form)return;
    if(form.elements.visibility)form.elements.visibility.value=d.project.visibility||'private';
    if(form.elements.confidentiality)form.elements.confidentiality.value=d.project.confidentiality||'internal';
    if(form.elements.category)form.elements.category.value=d.project.category||'internal';
  }).catch(function(err){notify(err.message,true)});
}
if(mainDialog){
  new MutationObserver(hydrateProjectSecurityFields).observe(mainDialog,{attributes:true,attributeFilter:['open']});
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-v2-action="edit-project"]'))setTimeout(hydrateProjectSecurityFields,0);
  });
}

/* Task sharing dialog ---------------------------------------------------- */
var taskDialog=document.createElement('dialog');
taskDialog.id='v2-task-share-dialog';
taskDialog.className='ws-dialog';
taskDialog.innerHTML='<form method="dialog"><div class="ws-dialog__head"><div><p class="ws-kicker">GRAVITAS ACCESS</p><h2 id="v2-task-dialog-title">Task</h2></div><button type="button" class="ws-icon-btn" data-task-dialog-close aria-label="Close">×</button></div><div id="v2-task-dialog-body"></div><div class="ws-dialog__actions"><button type="button" class="ws-quiet-btn" data-task-dialog-close>Close</button></div></form>';
document.body.appendChild(taskDialog);
var taskBody=taskDialog.querySelector('#v2-task-dialog-body');
var taskTitle=taskDialog.querySelector('#v2-task-dialog-title');

taskDialog.addEventListener('click',function(e){
  if(e.target.closest('[data-task-dialog-close]'))taskDialog.close();
});

function taskShareMarkup(taskId,d){
  var grants=(d.grants||[]).map(function(g){
    return '<div class="v2-row"><div class="v2-row__main"><strong>'+esc(g.name)+'</strong><small><span>'+esc(g.email)+'</span><span>'+esc(g.role)+'</span></small></div></div>';
  }).join('');
  var links=(d.links||[]).filter(function(l){return l.active}).map(function(l){
    var url=location.origin+l.url;
    return '<div class="v2-share-link"><code>'+esc(url)+'</code><button type="button" class="v2-mini-btn" data-task-copy="'+esc(url)+'">Copy</button></div>';
  }).join('');
  return '<div class="v2-share-grid">'+
    '<section class="v2-share-box"><h3>People</h3><p>Share only this task. The recipient does not get access to the full Core workspace.</p>'+
    '<input id="v2-task-share-email" type="email" placeholder="researcher@example.com">'+
    '<select id="v2-task-share-role"><option value="view">View</option><option value="comment">Comment</option><option value="edit">Edit</option><option value="manage">Manage</option></select>'+
    '<button type="button" class="v2-mini-btn" data-task-grant="'+taskId+'">Grant access</button><div style="margin-top:10px">'+grants+'</div></section>'+
    '<section class="v2-share-box"><h3>Share link</h3><p>Create a controlled view-only link for this task.</p><button type="button" class="v2-mini-btn" data-task-link="'+taskId+'">Create link</button><div style="margin-top:10px">'+links+'</div></section></div>';
}
function openTaskShare(taskId){
  Promise.all([
    api('/api/platform/tasks/'+taskId+'/'),
    api('/api/platform/share/?type=task&id='+taskId)
  ]).then(function(all){
    taskTitle.textContent='Share · '+all[0].task.title;
    if(!all[1].permissions.can_manage){
      taskBody.innerHTML='<div class="v2-callout">You can access this task, but only its owner or a manager can change sharing.</div>';
    }else{
      taskBody.innerHTML=taskShareMarkup(taskId,all[1]);
    }
    taskDialog.showModal();
  }).catch(function(err){notify(err.message,true)});
}
function openSharedTask(taskId){
  api('/api/platform/tasks/'+taskId+'/').then(function(d){
    var t=d.task;
    taskTitle.textContent=t.title;
    taskBody.innerHTML='<div class="v2-hero-card"><div class="v2-hero-card__top"><div><span class="v2-badge">'+esc(t.status)+'</span><span class="v2-badge">'+esc(t.priority)+'</span><h2>'+esc(t.title)+'</h2><p>'+esc(t.description||'No description.')+'</p></div></div><div class="v2-meta-grid"><div><small>Owner</small><strong>'+esc((t.owner&&t.owner.name)||t.owner||'—')+'</strong></div><div><small>Due</small><strong>'+esc(t.due_date||'—')+'</strong></div><div><small>Initiative</small><strong>'+esc(t.initiative_title||t.initiative||'—')+'</strong></div><div><small>Access</small><strong>'+esc(t.permissions.role||'view')+'</strong></div></div></div><div class="v2-callout"><strong>Definition of done</strong><br>'+esc(t.definition_of_done||'—')+'</div>';
    taskDialog.showModal();
  }).catch(function(err){notify(err.message,true)});
}

taskDialog.addEventListener('click',function(e){
  var grant=e.target.closest('[data-task-grant]');
  var link=e.target.closest('[data-task-link]');
  var copy=e.target.closest('[data-task-copy]');
  if(copy){
    if(navigator.clipboard)navigator.clipboard.writeText(copy.dataset.taskCopy);
    notify('Link copied.');
    return;
  }
  if(grant){
    var email=document.getElementById('v2-task-share-email').value.trim();
    var role=document.getElementById('v2-task-share-role').value;
    if(!email){notify('Enter an email address.',true);return;}
    api('/api/platform/share/',{method:'POST',body:JSON.stringify({type:'task',id:Number(grant.dataset.taskGrant),action:'grant',email:email,role:role})}).then(function(){
      taskDialog.close();notify('Task access granted.');openTaskShare(grant.dataset.taskGrant);
    }).catch(function(err){notify(err.message,true)});
    return;
  }
  if(link){
    api('/api/platform/share/',{method:'POST',body:JSON.stringify({type:'task',id:Number(link.dataset.taskLink),action:'link',role:'view',allow_download:false})}).then(function(d){
      if(navigator.clipboard)navigator.clipboard.writeText(location.origin+d.link.url);
      taskDialog.close();notify('Task share link created and copied.');openTaskShare(link.dataset.taskLink);
    }).catch(function(err){notify(err.message,true)});
  }
});

document.addEventListener('click',function(e){
  var share=e.target.closest('[data-task-share]');
  var open=e.target.closest('[data-shared-task-open]');
  if(share){e.preventDefault();openTaskShare(share.dataset.taskShare);}
  if(open){e.preventDefault();openSharedTask(open.dataset.sharedTaskOpen);}
});

/* Add task share affordances without changing the legacy Operating UI. */
var decorating=false;
function decorateCoreTasks(){
  if(decorating)return;
  var isDashboard=location.pathname==='/workspace/core'||location.pathname==='/workspace/core/';
  var isTasks=/^\/workspace\/core\/tasks\/?$/.test(location.pathname);
  if(!isDashboard&&!isTasks)return;
  decorating=true;
  api('/api/platform/dashboard/?workspace=core').then(function(d){
    var panels=Array.from(document.querySelectorAll('.v2-panel'));
    var wanted=isTasks?'Current execution':'Execution';
    var panel=panels.find(function(p){var h=p.querySelector('.v2-panel__head h2');return h&&h.textContent.trim()===wanted;});
    if(!panel)return;
    var rows=Array.from(panel.querySelectorAll('.v2-list > .v2-row'));
    rows.forEach(function(row,index){
      var task=d.tasks[index];
      if(!task||row.querySelector('[data-task-share]'))return;
      var actions=row.querySelector('.v2-row__actions');
      if(!actions){actions=document.createElement('div');actions.className='v2-row__actions';row.appendChild(actions);}
      var b=document.createElement('button');
      b.type='button';b.textContent='Share';b.dataset.taskShare=task.id;
      actions.appendChild(b);
    });
  }).catch(function(){}).finally(function(){decorating=false});
}
function decorateSharedTasks(){
  if(!/^\/workspace\/shared\/?$/.test(location.pathname))return;
  api('/api/platform/shared-with-me/').then(function(d){
    var rows=Array.from(document.querySelectorAll('#ws-content .v2-list > .v2-row'));
    rows.forEach(function(row,index){
      var item=d.items[index];
      if(!item||item.type!=='task'||row.querySelector('[data-shared-task-open]'))return;
      var actions=row.querySelector('.v2-row__actions');
      if(!actions){actions=document.createElement('div');actions.className='v2-row__actions';row.appendChild(actions);}
      var b=document.createElement('button');
      b.type='button';b.textContent='Open';b.dataset.sharedTaskOpen=item.id;
      actions.appendChild(b);
    });
  }).catch(function(){});
}
var observer=new MutationObserver(function(){
  clearTimeout(observer.timer);
  observer.timer=setTimeout(function(){decorateCoreTasks();decorateSharedTasks();},80);
});
var wsContent=document.getElementById('ws-content');
if(wsContent)observer.observe(wsContent,{childList:true,subtree:true});
setTimeout(function(){decorateCoreTasks();decorateSharedTasks();},150);

})();
