(function(){
'use strict';
if(!/^\/workspace\/operating(?:\/|$)/.test(location.pathname))return;

var content=document.getElementById('ws-content');
if(!content)return;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cookie(name){var parts=(document.cookie||'').split(';');for(var i=0;i<parts.length;i++){var v=parts[i].trim();if(v.indexOf(name+'=')===0)return decodeURIComponent(v.slice(name.length+1))}return ''}
function request(url,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=opts.headers||{};opts.headers.Accept='application/json';if(opts.method&&opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');opts.headers['Content-Type']='application/json'}return fetch(url,opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(String(d.error||'Request failed').replace(/_/g,' '));return d})})}
function notify(text,bad){var box=document.getElementById('ws-alert');if(!box)return;box.hidden=false;box.textContent=text;box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--g-accent,#d4c9be)';clearTimeout(notify.t);notify.t=setTimeout(function(){box.hidden=true},4200)}
function textStatus(v){return ({draft:'Draft',active:'Active',blocked:'Blocked',done:'Done',archived:'Archived'})[v]||v||'—'}
function textPriority(v){return ({p0:'P0 · Critical',p1:'P1 · High',p2:'P2 · Normal',p3:'P3 · Low'})[v]||v||'—'}
function dateLabel(v){if(!v)return 'No due date';var d=new Date(v+'T12:00:00');if(isNaN(d.getTime()))return v;return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
function intendedOwner(task){var s=(task.blocked_reason||'')+' '+(task.description||'');var m=s.match(/(?:Core member|Intended team owner):\s*([^\.\n]+)/i);return m?m[1].trim():''}

function ensureStyles(){
  if(document.getElementById('op-task-detail-style'))return;
  var s=document.createElement('style');s.id='op-task-detail-style';
  s.textContent=[
    '#op-task-detail{width:min(820px,calc(100vw - 32px));height:min(84dvh,780px);max-height:calc(100dvh - 28px);border:1px solid var(--ws-line,#d8d8d8);border-radius:20px;padding:0;overflow:hidden;background:var(--ws-panel,#fff);color:inherit;box-shadow:0 28px 90px rgba(0,0,0,.28)}',
    '#op-task-detail::backdrop{background:rgba(9,13,18,.55);backdrop-filter:blur(5px)}',
    '#op-task-detail-form{height:100%;display:flex;flex-direction:column;min-height:0}',
    '.op-task-detail__head{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 22px 15px;border-bottom:1px solid var(--ws-line,#ddd);background:var(--ws-panel,#fff);z-index:2}',
    '.op-task-detail__head-main{min-width:0}.op-task-detail__head h2{margin:2px 0 0;font-size:22px;line-height:1.22;letter-spacing:-.02em;overflow-wrap:anywhere}.op-task-detail__eyebrow{margin:0;font-size:10px;font-weight:750;letter-spacing:.15em;text-transform:uppercase;opacity:.56}',
    '.op-task-detail__summary{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.op-task-detail__pill{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:3px 9px;border:1px solid var(--ws-line,#ddd);border-radius:999px;font-size:11px;font-weight:650;background:rgba(127,127,127,.045)}.op-task-detail__pill.is-blocked{border-color:rgba(190,120,40,.38);background:rgba(190,120,40,.09)}.op-task-detail__pill.is-critical{border-color:rgba(185,74,74,.38);background:rgba(185,74,74,.08)}',
    '.op-task-detail__body{flex:1 1 auto;min-height:0;padding:18px 22px 20px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(100,100,100,.35) transparent}.op-task-detail__body::-webkit-scrollbar{width:7px}.op-task-detail__body::-webkit-scrollbar-track{background:transparent}.op-task-detail__body::-webkit-scrollbar-thumb{background:rgba(100,100,100,.3);border-radius:999px}',
    '.op-task-detail__trace{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:0 0 15px;font-size:11px;opacity:.72}.op-task-detail__trace a{color:inherit;text-decoration:none;padding:4px 7px;border-radius:7px}.op-task-detail__trace a:hover{background:rgba(127,127,127,.08);opacity:1}.op-task-detail__trace i{font-style:normal;opacity:.45}',
    '.op-task-detail__section{padding:14px 0;border-top:1px solid color-mix(in srgb,var(--ws-line,#ddd) 72%,transparent)}.op-task-detail__section:first-of-type{border-top:0;padding-top:0}.op-task-detail__section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px}.op-task-detail__section-title strong{font-size:12px;letter-spacing:.01em}.op-task-detail__section-title small{font-size:11px;opacity:.55}',
    '.op-task-detail__grid{display:grid;grid-template-columns:1fr 1fr;gap:11px 12px}.op-task-detail__field{display:flex;flex-direction:column;gap:5px}.op-task-detail__field.wide{grid-column:1/-1}.op-task-detail__field label{font-size:11px;font-weight:700;opacity:.68}',
    '.op-task-detail__field input,.op-task-detail__field select,.op-task-detail__field textarea{width:100%;box-sizing:border-box;border:1px solid var(--ws-line,#d8d8d8);border-radius:10px;background:rgba(127,127,127,.025);color:inherit;padding:9px 10px;font:inherit;font-size:13px;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}.op-task-detail__field input:focus,.op-task-detail__field select:focus,.op-task-detail__field textarea:focus{border-color:color-mix(in srgb,var(--g-accent,#b69a79) 68%,var(--ws-line,#ddd));box-shadow:0 0 0 3px color-mix(in srgb,var(--g-accent,#b69a79) 13%,transparent);background:rgba(127,127,127,.04)}',
    '.op-task-detail__field textarea{resize:vertical;line-height:1.48}.op-task-detail__field textarea[name="description"]{min-height:66px}.op-task-detail__field textarea[name="definition_of_done"]{min-height:76px}.op-task-detail__field textarea[name="blocked_reason"]{min-height:64px}',
    '.op-task-detail__blocked{margin-top:11px;padding:11px 12px;border:1px solid rgba(190,120,40,.28);border-radius:12px;background:rgba(190,120,40,.075)}.op-task-detail__blocked[hidden]{display:none}.op-task-detail__blocked-head{display:flex;align-items:flex-start;gap:9px;margin-bottom:9px}.op-task-detail__blocked-icon{display:grid;place-items:center;flex:0 0 24px;width:24px;height:24px;border-radius:50%;background:rgba(190,120,40,.13);font-size:12px}.op-task-detail__blocked-copy strong{display:block;font-size:12px}.op-task-detail__blocked-copy span{display:block;margin-top:2px;font-size:11px;line-height:1.4;opacity:.68}',
    '.op-task-detail__links{display:flex;flex-wrap:wrap;gap:7px}.op-task-detail__link{display:inline-flex;align-items:center;gap:6px;max-width:100%;border:1px solid var(--ws-line,#ddd);border-radius:9px;background:rgba(127,127,127,.035);color:inherit;text-decoration:none;padding:7px 9px;font-size:11px;line-height:1.2}.op-task-detail__link span{opacity:.56}.op-task-detail__link strong{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:270px}.op-task-detail__link.is-button{cursor:pointer}.op-task-detail__link:hover{background:rgba(127,127,127,.075)}',
    '.op-task-detail__actions{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 22px;border-top:1px solid var(--ws-line,#ddd);background:var(--ws-panel,#fff);box-shadow:0 -8px 24px rgba(0,0,0,.025);z-index:2}.op-task-detail__actions-right{display:flex;align-items:center;gap:8px}.op-task-detail__delete{border:1px solid rgba(201,91,91,.56);color:#b83f3f;background:transparent;border-radius:9px;padding:8px 12px;font-size:12px;cursor:pointer}.op-task-detail__button{border:1px solid var(--ws-line,#ddd);background:transparent;color:inherit;border-radius:9px;padding:8px 12px;font-size:12px;cursor:pointer}.op-task-detail__save{border:0;background:var(--g-accent,#d4c9be);color:#111;border-radius:9px;padding:9px 15px;font-size:12px;font-weight:750;cursor:pointer;min-width:112px}',
    '#ws-content .ws-row:has([data-task-status]){cursor:pointer;transition:background .15s ease,transform .15s ease}#ws-content .ws-row:has([data-task-status]):hover{background:rgba(127,127,127,.06)}',
    '@media(max-width:680px){#op-task-detail{width:calc(100vw - 14px);height:calc(100dvh - 14px);max-height:none;border-radius:16px}.op-task-detail__head{padding:15px 16px 13px}.op-task-detail__head h2{font-size:19px}.op-task-detail__body{padding:15px 16px 18px}.op-task-detail__grid{grid-template-columns:1fr}.op-task-detail__field.wide{grid-column:auto}.op-task-detail__actions{padding:11px 16px}.op-task-detail__delete{padding:8px 10px}.op-task-detail__actions-right{flex:1;justify-content:flex-end}.op-task-detail__save{min-width:0}.op-task-detail__link strong{max-width:190px}}'
  ].join('');
  document.head.appendChild(s)
}

function ensureDialog(){
  var d=document.getElementById('op-task-detail');if(d)return d;
  d=document.createElement('dialog');d.id='op-task-detail';
  d.innerHTML='<form id="op-task-detail-form">'+
    '<div class="op-task-detail__head"><div class="op-task-detail__head-main"><p class="op-task-detail__eyebrow">TASK</p><h2 id="op-task-detail-title">Task</h2><div id="op-task-detail-summary" class="op-task-detail__summary"></div></div><button type="button" class="ws-icon-btn" data-op-close aria-label="Close">×</button></div>'+
    '<div class="op-task-detail__body">'+
      '<nav id="op-task-detail-trace" class="op-task-detail__trace" aria-label="Task hierarchy"></nav>'+
      '<section class="op-task-detail__section"><div class="op-task-detail__section-title"><strong>Task details</strong><small>What is being delivered</small></div><div class="op-task-detail__grid"><div class="op-task-detail__field wide"><label>Title</label><input name="title" required></div><div class="op-task-detail__field wide"><label>Description</label><textarea name="description"></textarea></div></div></section>'+
      '<section class="op-task-detail__section"><div class="op-task-detail__section-title"><strong>Execution</strong><small>Owner, priority and timing</small></div><div class="op-task-detail__grid"><div class="op-task-detail__field"><label>Owner</label><select name="owner_id"></select></div><div class="op-task-detail__field"><label>Priority</label><select name="priority"><option value="p0">P0 · Critical</option><option value="p1">P1 · High</option><option value="p2">P2 · Normal</option><option value="p3">P3 · Low</option></select></div><div class="op-task-detail__field"><label>Status</label><select name="status"><option value="draft">Draft</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="archived">Archived</option></select></div><div class="op-task-detail__field"><label>Due date</label><input type="date" name="due_date"></div></div><div id="op-task-detail-blocked" class="op-task-detail__blocked" hidden><div class="op-task-detail__blocked-head"><span class="op-task-detail__blocked-icon">!</span><div class="op-task-detail__blocked-copy"><strong id="op-task-detail-blocked-title">This task is blocked</strong><span id="op-task-detail-blocked-help">Record the blocker clearly so it can be removed quickly.</span></div></div><div class="op-task-detail__field"><label>Blocked reason</label><textarea name="blocked_reason"></textarea></div></div></section>'+
      '<section class="op-task-detail__section"><div class="op-task-detail__section-title"><strong>Definition of Done</strong><small>The finish line</small></div><div class="op-task-detail__field"><textarea name="definition_of_done" required></textarea></div></section>'+
      '<section class="op-task-detail__section"><div class="op-task-detail__section-title"><strong>Connected work</strong><small>Roadmap context</small></div><div id="op-task-detail-links" class="op-task-detail__links"></div></section>'+
    '</div>'+
    '<div class="op-task-detail__actions"><button type="button" class="op-task-detail__delete" data-op-delete>Delete</button><div class="op-task-detail__actions-right"><button type="button" class="op-task-detail__button" data-op-close>Cancel</button><button type="submit" class="op-task-detail__save">Save changes</button></div></div>'+
  '</form>';
  document.body.appendChild(d);
  d.addEventListener('click',function(e){if(e.target.hasAttribute('data-op-close'))d.close()});
  var form=document.getElementById('op-task-detail-form');
  ['owner_id','priority','status','due_date'].forEach(function(name){form.elements[name].addEventListener('change',function(){refreshSummary(form);toggleBlocked(form)})});
  return d
}

function ownerOptions(members,selected){return (members||[]).map(function(m){var p=m.name||m.email||'Member';return '<option value="'+esc(m.id)+'" '+(String(m.id)===String(selected)?'selected':'')+'>'+esc(p)+'</option>'}).join('')}
function value(form,name,v){if(form.elements[name])form.elements[name].value=v==null?'':v}
function selectedText(select){return select&&select.options[select.selectedIndex]?select.options[select.selectedIndex].text:'—'}
function refreshSummary(form){
  var box=document.getElementById('op-task-detail-summary');if(!box)return;
  var status=form.elements.status.value,priority=form.elements.priority.value;
  var parts=[
    '<span class="op-task-detail__pill '+(priority==='p0'?'is-critical':'')+'">'+esc(textPriority(priority))+'</span>',
    '<span class="op-task-detail__pill '+(status==='blocked'?'is-blocked':'')+'">'+esc(textStatus(status))+'</span>',
    '<span class="op-task-detail__pill">'+esc(selectedText(form.elements.owner_id))+'</span>',
    '<span class="op-task-detail__pill">'+esc(dateLabel(form.elements.due_date.value))+'</span>'
  ];
  var intended=form.dataset.intendedOwner||'';if(intended&&selectedText(form.elements.owner_id).toLowerCase().indexOf(intended.toLowerCase())===-1)parts.push('<span class="op-task-detail__pill is-blocked">Intended · '+esc(intended)+'</span>');
  box.innerHTML=parts.join('')
}
function toggleBlocked(form){
  var wrap=document.getElementById('op-task-detail-blocked');if(!wrap)return;
  var hasReason=!!form.elements.blocked_reason.value.trim();var show=form.elements.status.value==='blocked'||hasReason;wrap.hidden=!show;
  var intended=form.dataset.intendedOwner||'';
  document.getElementById('op-task-detail-blocked-title').textContent=intended?'Waiting on '+intended:'This task is blocked';
  document.getElementById('op-task-detail-blocked-help').textContent=intended?'The intended owner is not yet linked to an active Core account. The task will reconcile when that account is connected.':'Keep the blocker specific and actionable so it can be removed quickly.'
}
function byId(list,id){return (list||[]).find(function(x){return String(x.id)===String(id)})}
function link(label,name,href,extra){var cls='op-task-detail__link'+(extra?' is-button':'');var tag=href?'a':(extra?'button':'span');var attr=href?' href="'+esc(href)+'"':(extra?' type="button" data-op-open-task="'+esc(extra)+'"':'');return '<'+tag+' class="'+cls+'"'+attr+'><span>'+esc(label)+'</span><strong>'+esc(name||'—')+'</strong></'+tag+'>'}

function openTask(id){
  Promise.all([request('/api/operating/tasks/'),request('/api/operating/dashboard/'),request('/api/operating/cycles/'),request('/api/operating/milestones/')]).then(function(all){
    var tasks=all[0].tasks||[],task=byId(tasks,id);if(!task)throw new Error('Task not found');
    var members=all[1].members||[],cycles=all[2].cycles||[],milestones=all[3].milestones||[];
    var cycle=byId(cycles,task.cycle_id),milestone=byId(milestones,task.milestone_id),dependency=byId(tasks,task.dependency_id);
    var d=ensureDialog(),form=document.getElementById('op-task-detail-form');form.dataset.taskId=task.id;form.dataset.intendedOwner=intendedOwner(task);
    document.getElementById('op-task-detail-title').textContent=task.title;
    var trace=[];
    if(task.trace&&task.trace.objective)trace.push('<a href="/workspace/operating/strategy">'+esc(task.trace.objective.title)+'</a>');
    if(task.trace&&task.trace.key_result)trace.push('<a href="/workspace/operating/strategy">'+esc(task.trace.key_result.title)+'</a>');
    if(task.trace&&task.trace.initiative)trace.push('<a href="/workspace/operating/initiatives">'+esc(task.trace.initiative.title)+'</a>');
    document.getElementById('op-task-detail-trace').innerHTML=trace.join('<i>›</i>');
    form.elements.owner_id.innerHTML=ownerOptions(members,task.owner&&task.owner.id);
    value(form,'title',task.title);value(form,'description',task.description);value(form,'priority',task.priority);value(form,'status',task.status);value(form,'due_date',task.due_date);value(form,'definition_of_done',task.definition_of_done);value(form,'blocked_reason',task.blocked_reason);
    var links=[];
    if(task.trace&&task.trace.process)links.push(link('Process',task.trace.process.name,'/workspace/operating/processes'));
    if(task.trace&&task.trace.initiative)links.push(link('Initiative',task.trace.initiative.title,'/workspace/operating/initiatives'));
    if(cycle)links.push(link('Cycle',cycle.name,'/workspace/operating/cycles'));
    if(milestone)links.push(link('Milestone',milestone.title,'/workspace/operating/cycles'));
    if(dependency)links.push(link('Depends on',dependency.title,'',dependency.id));
    document.getElementById('op-task-detail-links').innerHTML=links.length?links.join(''):'<span class="op-task-detail__link"><span>Context</span><strong>No additional execution links</strong></span>';
    refreshSummary(form);toggleBlocked(form);
    if(!d.open)d.showModal();
    requestAnimationFrame(function(){document.querySelector('.op-task-detail__body').scrollTop=0})
  }).catch(function(e){notify(e.message,true)})
}

ensureStyles();ensureDialog();
content.addEventListener('click',function(e){if(e.target.closest('select,button,a,input,textarea,label'))return;var row=e.target.closest('.ws-row');if(!row)return;var sel=row.querySelector('[data-task-status]');if(!sel)return;openTask(sel.dataset.taskStatus)});

document.getElementById('op-task-detail').addEventListener('click',function(e){var dep=e.target.closest('[data-op-open-task]');if(dep){openTask(dep.dataset.opOpenTask);return}var del=e.target.closest('[data-op-delete]');if(!del)return;var form=document.getElementById('op-task-detail-form'),id=form.dataset.taskId;if(!id)return;var title=form.elements.title.value.trim()||'this task';if(!window.confirm('Delete “'+title+'” permanently? This cannot be undone.'))return;request('/api/operating/tasks/'+id+'/',{method:'DELETE',body:'{}'}).then(function(){document.getElementById('op-task-detail').close();notify('Task deleted');setTimeout(function(){location.reload()},180)}).catch(function(err){notify(err.message,true)})});

document.getElementById('op-task-detail-form').addEventListener('submit',function(e){e.preventDefault();var form=this,id=form.dataset.taskId;if(!id)return;var payload={title:form.elements.title.value.trim(),description:form.elements.description.value,owner_id:form.elements.owner_id.value,priority:form.elements.priority.value,status:form.elements.status.value,due_date:form.elements.due_date.value,definition_of_done:form.elements.definition_of_done.value.trim(),blocked_reason:form.elements.blocked_reason.value};if(!payload.title||!payload.definition_of_done){notify('Task and Definition of Done are required.',true);return}var save=form.querySelector('.op-task-detail__save'),old=save.textContent;save.disabled=true;save.textContent='Saving…';request('/api/operating/tasks/'+id+'/',{method:'PATCH',body:JSON.stringify(payload)}).then(function(){document.getElementById('op-task-detail').close();notify('Task saved');setTimeout(function(){location.reload()},180)}).catch(function(err){save.disabled=false;save.textContent=old;notify(err.message,true)})});
})();
