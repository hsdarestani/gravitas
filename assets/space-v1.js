(function(){
'use strict';

var activePath='';
var renderTimer=null;
var modal=null;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cookie(name){var p=(document.cookie||'').split(';');for(var i=0;i<p.length;i++){var v=p[i].trim();if(v.indexOf(name+'=')===0)return decodeURIComponent(v.slice(name.length+1))}return ''}
function api(url,opts){opts=opts||{};opts.credentials='same-origin';opts.headers=opts.headers||{};opts.headers.Accept='application/json';if(opts.method&&opts.method!=='GET'){opts.headers['X-CSRFToken']=cookie('csrftoken');if(!(opts.body instanceof FormData))opts.headers['Content-Type']='application/json'}return fetch(url,opts).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok){var e=new Error(String(d.error||'Request failed').replace(/_/g,' '));e.code=d.error;e.data=d;throw e}return d})})}
function showMessage(text,bad){var box=document.getElementById('ws-alert');if(!box)return;box.hidden=false;box.textContent=text;box.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';clearTimeout(showMessage.timer);showMessage.timer=setTimeout(function(){box.hidden=true},5000)}
function setHeader(title,subtitle,kicker){var t=document.getElementById('ws-title'),s=document.getElementById('ws-subtitle'),k=document.getElementById('ws-kicker');if(t)t.textContent=title;if(s)s.textContent=subtitle;if(k)k.textContent=kicker||'GRAVITAS'}
function actions(html){var box=document.getElementById('ws-primary-actions');if(box)box.innerHTML=html||''}
function button(label,action,secondary){return '<button type="button" class="'+(secondary?'ws-secondary-btn':'ws-primary-btn')+'" data-space-action="'+esc(action)+'">'+esc(label)+'</button>'}
function badge(text,tone){return '<span class="v2-badge"'+(tone?' data-tone="'+esc(tone)+'"':'')+'>'+esc(text)+'</span>'}
function field(label,name,type,value,extra){type=type||'text';extra=extra||'';if(type==='textarea')return '<div class="ws-field"><label>'+esc(label)+'</label><textarea name="'+name+'" '+extra+'>'+esc(value||'')+'</textarea></div>';if(type==='select')return '<div class="ws-field"><label>'+esc(label)+'</label><select name="'+name+'" '+extra+'>'+value+'</select></div>';if(type==='checkbox')return '<div class="ws-field"><label class="v2-check"><input name="'+name+'" type="checkbox" '+(value?'checked':'')+'> '+esc(label)+'</label></div>';return '<div class="ws-field"><label>'+esc(label)+'</label><input name="'+name+'" type="'+type+'" value="'+esc(value||'')+'" '+extra+'></div>'}
function formData(form){var fd=new FormData(form),o={};fd.forEach(function(v,k){o[k]=v});form.querySelectorAll('input[type=checkbox]').forEach(function(x){o[x.name]=x.checked});return o}

function ensureModal(){
  if(modal)return modal;
  modal=document.createElement('dialog');
  modal.id='space-v1-dialog';
  modal.className='ws-dialog';
  modal.innerHTML='<form method="dialog"><div class="ws-dialog__head"><div><p class="ws-kicker">GRAVITAS</p><h2 data-space-title>Configure</h2></div><button type="button" class="ws-icon-btn" data-space-close aria-label="Close">×</button></div><div data-space-body></div><div class="ws-dialog__actions"><button type="button" class="ws-quiet-btn" data-space-close>Cancel</button><button type="submit" class="ws-primary-btn">Save</button></div></form>';
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target.closest('[data-space-close]'))modal.close()});
  return modal;
}
function openModal(title,html,onSubmit,submitLabel){
  var d=ensureModal(),f=d.querySelector('form');
  d.querySelector('[data-space-title]').textContent=title;
  d.querySelector('[data-space-body]').innerHTML=html;
  var save=f.querySelector('[type=submit]');save.textContent=submitLabel||'Save';
  f.onsubmit=function(e){e.preventDefault();save.disabled=true;Promise.resolve(onSubmit(formData(f),f)).then(function(close){if(close!==false)d.close()}).catch(function(err){showMessage(err.message,true)}).finally(function(){save.disabled=false})};
  d.showModal();
  return d;
}

function flattenTree(tree,result,depth){result=result||[];depth=depth||0;(tree||[]).forEach(function(n){n.depth=depth;result.push(n);flattenTree(n.children,result,depth+1)});return result}
function nodeOptions(nodes,selected,kind){return (nodes||[]).filter(function(n){return !kind||n.kind===kind}).map(function(n){return '<option value="'+n.id+'" '+(String(selected||'')===String(n.id)?'selected':'')+'>'+Array((n.depth||0)+1).join('— ') + esc(n.title)+' ('+esc(n.kind)+')</option>'}).join('')}
function option(value,label,current){return '<option value="'+value+'" '+(String(value)===String(current||'')?'selected':'')+'>'+esc(label)+'</option>'}

function patchNavigation(){
  var box=document.getElementById('v3-context-nav');
  if(box&&location.pathname.indexOf('/workspace/research')===0&&!box.querySelector('a[href="/workspace/research/notes"]')){
    var link=document.createElement('a');link.href='/workspace/research/notes';link.innerHTML='<span>✎</span>Notes';
    if(location.pathname.indexOf('/workspace/research/notes')===0)link.className='is-active';
    var files=box.querySelector('a[href="/workspace/research/files"]');box.insertBefore(link,files||null);
  }
  var mobile=document.getElementById('ws-mobile-select');
  if(mobile&&!mobile.querySelector('option[value="/workspace/research/notes"]')){
    var opt=document.createElement('option');opt.value='/workspace/research/notes';opt.textContent='Research · Notes';
    var filesOpt=mobile.querySelector('option[value="/workspace/research/files"]');mobile.insertBefore(opt,filesOpt||null);
  }
  if(mobile&&location.pathname.indexOf('/workspace/research/notes')===0)mobile.value='/workspace/research/notes';
}

function typeTone(type){return type==='project'?'public':type==='note'?'':type==='category'?'secure':''}
function notesRow(item){
  var action='';
  if(item.source==='note'&&item.id)action='<button data-open-resource="'+item.id+'">Open</button>';
  else if(item.source==='project'&&item.id)action='<button data-open-project="'+item.id+'">Project</button>';
  var warning=item.sync_state==='conflict'?'<span title="'+esc(item.sync_error||'Conflict')+'">⚠ conflict</span>':'';
  return '<div class="v2-row"><div class="v2-row__main"><strong>'+esc(item.title)+'</strong><small>'+badge(item.tag||('@'+item.type),typeTone(item.type))+'<span>'+esc(item.path)+'</span><span>'+esc(item.sync_state||'')+'</span>'+warning+'</small></div><div class="v2-row__actions">'+action+'</div></div>';
}
function renderNotes(){
  if(location.pathname.replace(/\/$/,'')!=='/workspace/research/notes')return;
  var content=document.getElementById('ws-content');if(!content)return;
  var stamp='space-notes-'+Date.now();content.dataset.spaceRender=stamp;
  setHeader('Notes','Every Gravitas Markdown item in your personal Nextcloud Space, including nested notes and project metadata.','RESEARCH · NOTES');
  actions(button('New note','new-note')+button('New category','new-category',true)+button('Sync Space','sync-space',true)+button('AI settings','ai-settings',true));
  content.innerHTML='<div class="ws-loading">Reading Space…</div>';
  Promise.all([api('/api/platform/space/notes/?remote=1'),api('/api/platform/space/tree/')]).then(function(all){
    if(location.pathname.replace(/\/$/,'')!=='/workspace/research/notes'||content.dataset.spaceRender!==stamp)return;
    var data=all[0],tree=all[1];window.__gravitasSpaceTree=tree;
    var conflicts=data.items.filter(function(i){return i.sync_state==='conflict'}).length;
    var unindexed=data.items.filter(function(i){return i.sync_state==='unindexed'}).length;
    content.innerHTML='<div class="v2-summary"><article><small>Markdown items</small><strong>'+data.items.length+'</strong></article><article><small>Conflicts</small><strong>'+conflicts+'</strong></article><article><small>Nextcloud-only</small><strong>'+unindexed+'</strong></article><article><small>Root</small><strong>Space/</strong></article></div>'+(data.cloud_unavailable?'<div class="v2-callout"><strong>Nextcloud is temporarily unavailable.</strong><br>The database index is shown; remote-only Markdown discovery will resume on the next sync.</div>':'')+'<section class="v2-panel"><div class="v2-panel__head"><h2>Notes & system Markdown</h2><span>'+badge('@space · @subspace · @category · @project · @note')+'</span></div><div class="v2-list">'+(data.items.length?data.items.map(notesRow).join(''):'<div class="v2-empty"><strong>No Markdown yet</strong><span>Create your first note or category.</span></div>')+'</div></section>';
  }).catch(function(err){content.innerHTML='<div class="v2-empty"><strong>Could not read Notes</strong><span>'+esc(err.message)+'</span></div>'});
}

function openNodeForm(){
  api('/api/platform/space/tree/').then(function(d){var nodes=flattenTree(d.tree,[]);var parents=nodeOptions(nodes,'');openModal('New Space node',field('Type','kind','select',option('category','Category','category')+option('subspace','Subspace','category'))+field('Title','title','text','','required maxlength="220"')+field('Parent (required for Category)','parent_id','select','<option value="">—</option>'+parents),function(o){if(o.kind==='category'&&!o.parent_id)throw new Error('Choose a parent Subspace or Category.');return api('/api/platform/space/tree/',{method:'POST',body:JSON.stringify(o)}).then(function(){showMessage('Space node created.');renderNotes()})})})
}

function openNoteForm(){
  Promise.all([api('/api/platform/space/tree/'),api('/api/platform/space/notes/')]).then(function(all){var nodes=flattenTree(all[0].tree,[]),categories=nodes.filter(function(n){return n.kind==='category'});var noteOptions=(all[1].notes||[]).map(function(n){return '<option value="'+n.id+'">'+esc(n.title)+'</option>'}).join('');openModal('New note',field('Title','title','text','','required maxlength="240"')+field('Note','body','textarea','','required placeholder="Write your note…"')+field('Category','category_id','select','<option value="">Personal / Notes</option>'+nodeOptions(categories,''))+field('Parent note (optional)','parent_note_id','select','<option value="">—</option>'+noteOptions)+field('Create same-name attachment folder','attachments','checkbox',false),function(o){return api('/api/platform/resources/',{method:'POST',body:JSON.stringify({kind:'note',title:o.title,body:o.body,visibility:'private'})}).then(function(created){return api('/api/platform/space/notes/'+created.item.id+'/',{method:'PATCH',body:JSON.stringify({category_id:o.category_id||null,parent_note_id:o.parent_note_id||null,attachments:!!o.attachments})})}).then(function(){showMessage('Note saved to Space.');renderNotes()})})})
}

function syncSpace(force){return api('/api/platform/space/sync/',{method:'POST',body:JSON.stringify({force:!!force,confirmed:!!force})}).then(function(d){showMessage(d.conflicts&&d.conflicts.length?'Sync completed with conflicts.':'Space synchronized.');renderNotes()}).catch(function(err){if(err.code==='space_sync_conflict'||(err.data&&err.data.conflicts&&err.data.conflicts.length)){if(confirm('Some Markdown files changed directly in Nextcloud. Overwrite those remote changes with the Gravitas database version?'))return syncSpace(true)}throw err})}

function projectPayload(o){return {
  title:o.title,category:o.project_type,research_question:o.research_question,description:o.description,
  client_name:o.client_name,deadline:o.deadline,visibility:o.visibility,confidentiality:o.confidentiality,
  required_skills:o.required_skills||'',compensation_text:o.compensation_text||'',secure_data_room:!!o.secure_data_room,
  application_open:!!o.application_open,allow_public_links:!!o.allow_public_links,allow_downloads:!!o.allow_downloads
}}
function projectFields(item,nodes,currentCategory){
  item=item||{};var categories=nodes.filter(function(n){return n.kind==='category'}),allParents=nodes;
  var ptypes=option('internal','Internal research',item.category||'internal')+option('client','Client / revenue project',item.category)+option('community','Community research',item.category);
  var vis=option('private','Private',item.visibility||'private')+option('invite','Invite only',item.visibility)+option('community','Community',item.visibility)+option('public','Public',item.visibility);
  var conf=option('internal','Internal',item.confidentiality||'internal')+option('confidential','Confidential',item.confidentiality)+option('restricted','Restricted data room',item.confidentiality)+option('public','Public',item.confidentiality);
  return field('Title','title','text',item.title,'required maxlength="220"')+
    field('Project type','project_type','select',ptypes)+
    field('Parent Category in Space','category_id','select','<option value="">Research / Projects (default)</option>'+nodeOptions(categories,currentCategory))+
    '<div class="v2-callout"><strong>Create a Category without leaving this form</strong><br>Fill the next two fields only if the parent Category does not exist yet.</div>'+
    field('New Category name (optional)','new_category','text','')+
    field('New Category parent','new_category_parent','select','<option value="">—</option>'+nodeOptions(allParents,''))+
    field('Research question','research_question','textarea',item.research_question,'placeholder="What exactly should this project answer?"')+
    field('Description / brief','description','textarea',item.description)+field('Client / requester','client_name','text',item.client_name)+field('Deadline','deadline','date',item.deadline)+field('Visibility','visibility','select',vis)+field('Confidentiality','confidentiality','select',conf)+field('Required skills','required_skills','text',(item.required_skills||[]).join(', '),'placeholder="bioinformatics, Python, statistics"')+field('Compensation','compensation_text','text',item.compensation_text)+field('Secure Data Room','secure_data_room','checkbox',item.secure_data_room)+field('Open community applications','application_open','checkbox',item.application_open)+field('Allow public links','allow_public_links','checkbox',item.allow_public_links)+field('Allow downloads','allow_downloads','checkbox',item.id?item.allow_downloads:true);
}
function openProjectForm(id){
  var projectPromise=id?api('/api/platform/projects/'+id+'/').then(function(d){return d.project}):Promise.resolve({});
  Promise.all([projectPromise,api('/api/platform/space/tree/'),id?api('/api/platform/space/projects/'+id+'/').catch(function(){return {placement:null}}):Promise.resolve({placement:null})]).then(function(all){var item=all[0],nodes=flattenTree(all[1].tree,[]),placement=all[2].placement;openModal(id?'Edit research project':'New research project',projectFields(item,nodes,placement&&placement.category_id),function(o){var categoryId=o.category_id||'';var categoryPromise=Promise.resolve(categoryId);if(o.new_category){if(!o.new_category_parent)throw new Error('Choose a parent for the new Category.');categoryPromise=api('/api/platform/space/tree/',{method:'POST',body:JSON.stringify({kind:'category',title:o.new_category,parent_id:o.new_category_parent})}).then(function(d){return d.node.id})}return categoryPromise.then(function(cid){return api('/api/platform/projects/'+(id?id+'/':''),{method:id?'PATCH':'POST',body:JSON.stringify(projectPayload(o))}).then(function(saved){var project=saved.project;return Promise.resolve(cid?api('/api/platform/space/projects/'+project.id+'/',{method:'PATCH',body:JSON.stringify({category_id:cid})}):null).then(function(){showMessage('Project saved in Space.');location.href='/workspace/research/projects/'+project.id})})})},'Save project')})
}

function providerLabel(p){return p.provider.replace(/_/g,' ')}
function openAISettings(){
  api('/api/platform/ai/providers/').then(function(d){var creds=(d.credentials||[]).map(function(p){return '<div class="v2-row"><div class="v2-row__main"><strong>'+esc(p.label)+'</strong><small><span>'+esc(providerLabel(p))+'</span><span>'+esc(p.model)+'</span>'+(p.is_default?'<span>Selected</span>':'')+'</small></div><div class="v2-row__actions">'+(!p.is_default?'<button type="button" data-ai-select="'+p.id+'">Use</button>':'')+'<button type="button" data-ai-delete="'+p.id+'">Delete</button></div></div>'}).join('');var selectedManaged=d.selected==='managed';var html='<div class="v2-columns"><section class="v2-panel"><div class="v2-panel__head"><h2>AI source</h2></div><div class="v2-list"><div class="v2-row"><div class="v2-row__main"><strong>Gravitas managed AI</strong><small><span>Cloudflare Workers AI</span><span>'+esc(d.managed.model)+'</span>'+(selectedManaged?'<span>Selected</span>':'')+'</small></div><div class="v2-row__actions">'+(!selectedManaged?'<button type="button" data-ai-managed>Use</button>':'')+'</div></div><div class="v2-row"><div class="v2-row__main"><strong>Nextcloud Assistant</strong><small><span>Native Nextcloud AI surface</span><span>Uses providers configured in Nextcloud</span></small></div><div class="v2-row__actions"><a href="'+esc(d.nextcloud.url)+'" target="_blank" rel="noopener">Open ↗</a></div></div>'+creds+'</div></section><aside><section class="v2-panel"><div class="v2-panel__head"><h2>Add your provider</h2></div><div class="v2-panel__body">'+field('Provider','provider','select',option('openai','OpenAI','')+option('anthropic','Anthropic','')+option('gemini','Google Gemini','')+option('openai_compatible','OpenAI-compatible',''))+field('Label','label','text','','required placeholder="My research model"')+field('Model','model','text','','required placeholder="Model ID from your provider"')+field('Base URL (optional for standard providers)','base_url','url','','placeholder="https://…"')+field('API key','api_key','password','','required autocomplete="off"')+field('Use as default','is_default','checkbox',true)+'</div></section></aside></div>';var dialog=openModal('AI settings',html,function(o){return api('/api/platform/ai/providers/',{method:'POST',body:JSON.stringify({action:'save',provider:o.provider,label:o.label,model:o.model,base_url:o.base_url,api_key:o.api_key,is_default:!!o.is_default})}).then(function(){showMessage('AI provider saved.');dialog.close();openAISettings();return false})},'Add provider');dialog.querySelector('[data-space-body]').onclick=function(e){var select=e.target.closest('[data-ai-select]'),del=e.target.closest('[data-ai-delete]'),managed=e.target.closest('[data-ai-managed]');if(select){api('/api/platform/ai/providers/',{method:'POST',body:JSON.stringify({action:'select',id:select.dataset.aiSelect})}).then(function(){dialog.close();openAISettings()})}else if(managed){api('/api/platform/ai/providers/',{method:'POST',body:JSON.stringify({action:'use_managed'})}).then(function(){dialog.close();openAISettings()})}else if(del&&confirm('Delete this saved AI provider credential?')){api('/api/platform/ai/providers/'+del.dataset.aiDelete+'/',{method:'DELETE',body:'{}'}).then(function(){dialog.close();openAISettings()})}}})
}

function injectAIButton(){var p=location.pathname;if(p.indexOf('/workspace/research/mindmaps')!==0&&p.indexOf('/workspace/research/nextcloud')!==0)return;var box=document.getElementById('ws-primary-actions');if(box&&!box.querySelector('[data-space-action="ai-settings"]'))box.insertAdjacentHTML('beforeend',button('AI settings','ai-settings',true))}
function schedule(){clearTimeout(renderTimer);renderTimer=setTimeout(function(){patchNavigation();injectAIButton();var p=location.pathname;if(p!==activePath){activePath=p;if(p.replace(/\/$/,'')==='/workspace/research/notes')setTimeout(renderNotes,120)}else if(p.replace(/\/$/,'')==='/workspace/research/notes'){var content=document.getElementById('ws-content');if(content&&!content.dataset.spaceRender)setTimeout(renderNotes,80)}},80)}

// Capture the existing V2 project buttons so the Space Category is part of the same form.
document.addEventListener('click',function(e){var project=e.target.closest('[data-v2-action="new-project"],[data-v2-action="edit-project"]');if(project){e.preventDefault();e.stopImmediatePropagation();var edit=project.dataset.v2Action==='edit-project';var m=location.pathname.match(/\/workspace\/research\/projects\/(\d+)/);openProjectForm(edit&&m?Number(m[1]):null);return}var action=e.target.closest('[data-space-action]');if(!action)return;var a=action.dataset.spaceAction;if(a==='new-note')openNoteForm();else if(a==='new-category')openNodeForm();else if(a==='sync-space')syncSpace(false).catch(function(err){showMessage(err.message,true)});else if(a==='ai-settings')openAISettings()},true);

var observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('popstate',schedule);document.addEventListener('click',function(){setTimeout(schedule,20)});schedule();
})();
