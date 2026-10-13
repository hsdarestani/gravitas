/* Project command center. All views use the same ACL-scoped OperatingTask
 * objects; canonical Nextcloud documents remain the source of truth.
 * These views do not persist a competing task representation. */
import * as P from './ws-platform.js?v=20261011-r4';

const node = (tag, cls = '', content = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = content;
  return n;
};
const btn = (label, onClick) => {
  const b = node('button', 'ws-btn', label);
  b.type = 'button'; b.addEventListener('click', onClick); return b;
};
const day = value => value ? String(value).slice(0, 10) : '';
const done = task => ['done', 'archived'].includes(task.status);
const overdue = (task, today) => !done(task) && !!task.due_date && day(task.due_date) < today;
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const statusNames = [['draft','Backlog'],['active','Doing'],['ready','Ready'],['waiting','Waiting'],['needs_review','Needs review'],['retest','Retest'],['blocked','Blocked'],['done','Done'],['archived','Archived']];
const css = `
.pm-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}
.pm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.pm-stat{padding:14px;border:1px solid var(--fl-border,var(--line,#39434a));border-radius:12px}
.pm-stat strong{display:block;font-size:24px}
.pm-stat small{opacity:.76}
.pm-views,.pm-filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.pm-views button[aria-pressed="true"]{outline:2px solid currentColor}
.pm-filters input,.pm-filters select,.pm-new input,.pm-new select,.pm-ai textarea{min-height:36px;border-radius:8px;padding:7px;color:inherit;background:transparent;border:1px solid currentColor;max-width:100%}
.pm-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.pm-column{padding:12px;border:1px solid var(--fl-border,#445);border-radius:12px;min-height:140px}
.pm-card{display:block;text-align:left;width:100%;border:1px solid var(--fl-border,#445);border-radius:10px;padding:10px;margin:8px 0;background:transparent;color:inherit}
.pm-card small{display:block;margin-top:5px;opacity:.75}
.pm-card[draggable=true]{cursor:grab}.pm-column.pm-drop{outline:2px dashed currentColor;outline-offset:-5px}.pm-source{display:flex;flex-wrap:wrap;gap:8px;margin-top:7px}.pm-notice-warning{font-weight:600}
.pm-list{display:grid;gap:7px}
.pm-task{padding:10px;border:1px solid var(--fl-border,#445);border-radius:9px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.pm-editor,.pm-new,.pm-ai{display:grid;gap:9px;padding:12px;margin:12px 0;border:1px solid var(--fl-border,#445);border-radius:12px}
.pm-new{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.pm-planner{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.pm-day{border:1px solid var(--fl-border,#445);border-radius:10px;padding:10px;min-height:100px}
.pm-note{font-size:12px;opacity:.75;margin:8px 0}
.pm-ai textarea{width:100%;min-height:84px}
.pm-ai pre{white-space:pre-wrap;font:inherit}
`;
function ensureStyle() {
  if (document.getElementById('pm-cockpit-style')) return;
  const s = node('style'); s.id = 'pm-cockpit-style'; s.textContent = css; document.head.append(s);
}
const format = t => [t.owner, t.due_date ? 'Due ' + day(t.due_date) : 'Unscheduled', t.priority, t.status].filter(Boolean).join(' · ');
function control(tag, type, placeholder = '') {
  const x = node(tag); if (type) x.type = type;
  x.placeholder = placeholder; if (placeholder) x.setAttribute('aria-label', placeholder); return x;
}
export function renderProjectManagement(doc, projectId, cockpit, { go, refresh }) {
  ensureStyle();
  let tasks = [...(cockpit.tasks || [])];
  const members = cockpit.members || [];
  const current = { view: 'board', text: '', status: '', owner: '', priority: '', onlyOverdue: false };
  const today = dayKey(new Date());
  const root = node('section', 'fl-panel wc-card');
  const wrap = node('div', 'fl-panel__body wc-card__body');
  root.append(wrap); doc.append(root);

  async function reload() {
    const latest = await P.projectCockpit(projectId);
    tasks = latest.tasks || [];
    paint();
  }
  const notice = node('p', 'pm-note', 'All views use the same project tasks; Nextcloud remains the source for adopted projects.');
  const heading = node('div', 'pm-head');
  heading.append(node('h2', '', 'Project command center'),
    btn('Source files / editor', () => go('/workspace/research/projects/' + projectId + '/structure')),
    btn('Refresh from source', async () => { try { await reload(); } catch(e) { notice.textContent = e.message; } }));
  const stat = node('div', 'pm-stats'), views = node('div', 'pm-views'), filters = node('div', 'pm-filters');
  const body = node('div'), editor = node('div'), ai = node('div', 'pm-ai');
  wrap.append(heading, notice, stat, views, filters, body, editor, ai);

  async function patch(task, payload) {
    try {
      await P.call(`/platform/projects/${projectId}/tasks/${task.id}/`, { method: 'PATCH', body: payload });
      notice.textContent = 'Saved to the existing project task; canonical synchronization is enforced by the server.';
      await reload();
    } catch (err) {
      notice.textContent = err.message === 'canonical_task_schema_upgrade_required' ? 'This task field is locked until its canonical text schema supports it.' : err.message + (err.data?.detail ? ': ' + err.data.detail : '');
    }
  }
  function openEditor(task) {
    editor.replaceChildren();
    const panel = node('div', 'pm-editor');
    panel.append(node('h3', '', 'Edit task #' + task.id + ' · ' + task.title));
    const title = control('input', 'text', 'Task title'); title.value = task.title;
    const deadline = control('input', 'date', 'Due date'); deadline.value = day(task.due_date);
    const status = node('select'), priority = node('select'), owner = node('select');
    [['draft','Draft'],['active','Doing'],['ready','Ready'],['waiting','Waiting'],['needs_review','Needs review'],['retest','Retest'],['blocked','Blocked'],['done','Done'],['archived','Archived']].forEach(([v,n])=>{const op=node('option','',n);op.value=v;status.append(op);});
    ['p0','p1','p2','p3'].forEach(v=>{const op=node('option','',v.toUpperCase());op.value=v;priority.append(op);});
    status.value=task.status; priority.value=task.priority;
    members.forEach(m=>{const op=node('option','',m.name);op.value=m.user_id;owner.append(op);});
    owner.value=String(task.owner_id);
    const blocked = control('input','text','Blocker or waiting reason'); blocked.value=task.blocked_reason || '';
    panel.append(title, deadline, status, priority, owner, blocked,
      btn('Save changes', () => { const data = { title: title.value, due_date:deadline.value, status:status.value, priority:priority.value, blocked_reason:blocked.value }; if(owner.value && owner.value !== String(task.owner_id)) data.owner_id = owner.value; patch(task, data); }),
      btn('Close', () => editor.replaceChildren()));
    editor.append(panel);
  }
  function tile(task) {
    const t = btn('#' + task.id + ' · ' + task.title, () => { if(task.can_edit) openEditor(task); else notice.textContent='Read only task'; });
    t.className = 'pm-card';
    t.append(node('small','',format(task)));
    if(task.dependency_id) t.append(node('small','','Depends on #' + task.dependency_id));
    if(task.blocked_reason) t.append(node('small','','Blocker: '+task.blocked_reason));
    t.draggable = !!task.can_edit;
    t.addEventListener('dragstart',ev=>{ if(!task.can_edit){ev.preventDefault();return;}ev.dataTransfer?.setData('text/plain',String(task.id)); });
    return t;
  }
  const filtered = () => tasks.filter(t =>
    (!current.text || (t.title+' '+t.description+' '+t.owner).toLowerCase().includes(current.text.toLowerCase())) &&
    (!current.status || t.status === current.status) &&
    (!current.owner || String(t.owner_id) === current.owner) &&
    (!current.priority || t.priority === current.priority) &&
    (!current.onlyOverdue || overdue(t,today)));

  function paint() {
    stat.replaceChildren(); views.replaceChildren(); filters.replaceChildren(); body.replaceChildren();
    const n = filtered();
    [
      ['Total', n.length], ['Open', n.filter(x=>!done(x)).length],
      ['Overdue', n.filter(x=>overdue(x,today)).length],
      ['Blocked', n.filter(x=>x.status==='blocked').length],
      ['Unscheduled', n.filter(x=>!x.due_date&&!done(x)).length],
      ['Completed', n.filter(done).length]
    ].forEach(([k,v])=>{const c=node('div','pm-stat');c.append(node('strong','',String(v)),node('small','',k));stat.append(c);});
    ['board','list','timeline','week','team'].forEach(mode=>{
      const b=btn(mode[0].toUpperCase()+mode.slice(1),()=>{current.view=mode;paint();});
      b.setAttribute('aria-pressed',String(current.view===mode));views.append(b);
    });
    const search=control('input','search','Search tasks');search.value=current.text;
    search.addEventListener('input',()=>{current.text=search.value;paint(); const fresh=filters.querySelector('input');fresh?.focus();fresh?.setSelectionRange(current.text.length,current.text.length);});
    const status=control('select'),own=control('select'), pr=control('select');
    [['','All statuses'],...statusNames].forEach(([value,label])=>{const o=node('option','',label);o.value=value;status.append(o);});
    [['','All owners'],...members.map(m=>[String(m.user_id),m.name])].forEach(([value,label])=>{const o=node('option','',label);o.value=value;own.append(o);});
    [['','Any priority'],...['p0','p1','p2','p3'].map(v=>[v,v.toUpperCase()])].forEach(([v,label])=>{const o=node('option','',label);o.value=v;pr.append(o);});
    status.value=current.status;own.value=current.owner;pr.value=current.priority;
    status.onchange=()=>{current.status=status.value;paint();};own.onchange=()=>{current.owner=own.value;paint();};pr.onchange=()=>{current.priority=pr.value;paint();};
    const overdueOnly=btn(current.onlyOverdue?'Overdue only ✓':'Overdue only',()=>{current.onlyOverdue=!current.onlyOverdue;paint();});overdueOnly.setAttribute('aria-pressed',String(current.onlyOverdue));
    filters.append(search,status,own,pr,overdueOnly);
    if(current.view==='board'){
      const cols=node('div','pm-columns');
      [['Backlog','draft',x=>x.status==='draft'],['Doing','active',x=>['active','ready'].includes(x.status)],['Waiting / review','needs_review',x=>['waiting','needs_review','retest','blocked'].includes(x.status)],['Done','done',done]].forEach(([label,target,test])=>{
        const c=node('div','pm-column');c.append(node('h3','',label+' ('+n.filter(test).length+')'));n.filter(test).forEach(t=>c.append(tile(t)));
        c.addEventListener('dragover',ev=>{ev.preventDefault();c.classList.add('pm-drop');});
        c.addEventListener('dragleave',()=>c.classList.remove('pm-drop'));
        c.addEventListener('drop',ev=>{ev.preventDefault();c.classList.remove('pm-drop');const id=Number(ev.dataTransfer?.getData('text/plain'));const task=tasks.find(t=>t.id===id);if(task?.can_edit && task.status!==target)patch(task,{status:target});});
        cols.append(c);
      });body.append(cols);
    }else if(current.view==='list'){
      const list=node('div','pm-list');n.forEach(t=>{const line=node('div','pm-task');line.append(node('span','',t.title+' · '+format(t)),btn('Details',()=>openEditor(t)));list.append(line);});body.append(list);
    }else if(current.view==='timeline'){
      body.append(node('p','pm-note','Deadline timeline. Task start dates and actual duration are not yet tracked, so this is not a duration-based Gantt chart.'));
      const list=node('div','pm-list');
      [...n].sort((a,b)=>day(a.due_date).localeCompare(day(b.due_date))).forEach(t=>{const line=node('div','pm-task');line.append(node('span','',day(t.due_date)||'No deadline'),tile(t));list.append(line);});body.append(list);
    }else if(current.view==='week'){
      body.append(node('p','pm-note','Next seven days grouped by due date; this is not a time-block calendar.'));
      const days=node('div','pm-planner');
      for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()+i);const key=dayKey(d);
        const c=node('div','pm-day');c.append(node('strong','',key));n.filter(t=>day(t.due_date)===key).forEach(t=>c.append(tile(t)));days.append(c);}
      body.append(days);
    }else{
      const cols=node('div','pm-columns');members.forEach(m=>{const assigned=n.filter(t=>String(t.owner_id)===String(m.user_id));const c=node('div','pm-column');
        c.append(node('h3','',m.name),node('p','pm-note',`${assigned.filter(t=>!done(t)).length} open · ${assigned.filter(t=>overdue(t,today)).length} overdue`));
        assigned.forEach(t=>c.append(tile(t)));cols.append(c);});body.append(cols);
    }
    if(cockpit.project?.permissions?.can_edit) body.append(newTask());
  }
  function newTask(){
    const box=node('div','pm-new');box.append(node('h3','','Create task'));
    const name=control('input','text','Task title'),due=control('input','date','Due date'),p=node('select');
    ['p0','p1','p2','p3'].forEach(v=>{const o=node('option','',v.toUpperCase());o.value=v;p.append(o);});p.value='p2';
    box.append(name,due,p,btn('Add to project',async()=>{
      if(!name.value.trim()||!due.value){notice.textContent='Task title and due date are required.';return;}
      try{await P.call(`/platform/projects/${projectId}/tasks/`,{method:'POST',body:{title:name.value.trim(),due_date:due.value,priority:p.value}});
        notice.textContent='Task created in the shared Core/Research model.';await reload();
      }catch(e){notice.textContent=e.message;}
    }));return box;
  }
  function buildPulsar(){
    ai.append(node('h3','','Pulsar · Project assistant'));
    ai.append(node('p','pm-note','Uses this project as its context; respects task and file access permissions. Review proposed mutations before approval.'));
    const q=control('textarea',null,'Ask about project progress, blockers, upcoming tasks or next steps');
    q.value='Summarize the current state of this project, overdue tasks, blockers and recommended next steps. Cite relevant tasks.';
    const out=node('pre','','');const actions=node('div','pm-views');
    let pending=false;
    async function run(confirm=false){
      out.textContent='Pulsar is working…';actions.replaceChildren();
      try {
        const res=await P.call('/platform/pulsar/agent/',{method:'POST',body:{
          message:confirm?'':q.value,confirm,skill:'project_task',surface:'projects',
          thread_id:'project-'+projectId,metadata:{project_id:Number(projectId)}
        }});
        out.textContent=res.reply||'Pulsar returned no explanation.';
        if(res.sources?.length){const cited=node('div','pm-source');cited.append(node('small','','Verified sources:'));res.sources.slice(0,12).forEach(source=>{if(source.href?.startsWith('/workspace/'))cited.append(btn(source.title||'Source',()=>go(source.href)));});actions.append(cited);}
        pending=!!res.approval_required;
        if(pending){const preview=node('p','pm-notice-warning','Proposed action: '+String(res.tool||'unknown')+' · '+JSON.stringify(res.tool_args||{}).slice(0,800));actions.append(preview,btn('Approve proposed action',()=>run(true)),btn('Cancel',async()=>{await P.call('/platform/pulsar/agent/',{method:'POST',body:{cancel:true,message:'',thread_id:'project-'+projectId,skill:'project_task',surface:'projects',metadata:{project_id:Number(projectId)}}});out.textContent='Action cancelled.';actions.replaceChildren();}));}
        if(confirm&&!pending)await reload();
      }catch(e){out.textContent=e.message;}
    }
    ai.append(q,btn('Ask Pulsar',()=>run(false)),out,actions);
  }
  buildPulsar();paint();
  const linkedId = new URLSearchParams(location.search).get('task');
  if(linkedId && /^\d+$/.test(linkedId)){
    const selected = tasks.find(t=>String(t.id)===linkedId);
    if(selected){if(selected.can_edit)openEditor(selected);else notice.textContent='Task #' + linkedId + ' is read only.';}
  }
}
