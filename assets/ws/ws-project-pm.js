/* Project command center. All views use the same ACL-scoped OperatingTask
 * objects; canonical Nextcloud documents remain the source of truth.
 * These views do not persist a competing task representation. */
import * as P from './ws-platform.js?v=20261014-r5';
import { mountAnchoredComments } from './ws-anchored-comments.js?v=20261014-r5';

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
.pm-gantt{display:grid;gap:8px;overflow-x:auto}
.pm-gantt-row{display:grid;grid-template-columns:minmax(180px,260px) minmax(280px,1fr);gap:12px;align-items:center;padding:8px;border:1px solid var(--fl-border,#445);border-radius:8px}
.pm-gantt-track{position:relative;height:26px;border-radius:6px;background:var(--fl-border,#394149)}
.pm-gantt-bar{position:absolute;top:3px;bottom:3px;border-radius:6px;background:var(--fl-accent,#7f93db)}
.pm-gantt-date{font-size:12px;opacity:.78}
.pm-schedule-editor{display:flex;flex-wrap:wrap;gap:8px;padding:12px;border:1px solid var(--fl-border,#445);border-radius:9px;margin:10px 0}
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
  let timeSummary = null;
  let scheduleMap = null;
  const members = cockpit.members || [];
  const current = { view: 'board', text: '', status: '', owner: '', priority: '', onlyOverdue: false };
  const today = dayKey(new Date());
  const root = node('section', 'fl-panel wc-card');
  const wrap = node('div', 'fl-panel__body wc-card__body');
  root.append(wrap); doc.append(root);

  async function reload() {
    const latest = await P.projectCockpit(projectId);
    tasks = latest.tasks || [];
    try { timeSummary = await P.call('/platform/projects/'+projectId+'/work-time/'); }
    catch(e) { notice.textContent = 'Work-time summary unavailable: '+e.message; }
    try { const plans=await P.call('/platform/projects/'+projectId+'/schedules/'); scheduleMap=new Map(plans.schedules.map(x=>[Number(x.task_id),x])); }
    catch(e){notice.textContent='Gantt schedule unavailable: '+e.message;}
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
  // The active timer lives in the canonical Markdown note, not the browser.
  async function showTime(task, container) {
    container.replaceChildren(node('p','pm-note','Loading versioned work log…'));
    const url = '/platform/projects/' + projectId + '/tasks/' + task.id + '/time/';
    let state;
    try { state=await P.call(url); }
    catch (error) { container.replaceChildren(node('p','pm-note','Work log unavailable: '+error.message)); return; }
    container.replaceChildren();
    container.append(node('h4','','Time tracking · Task #'+task.id));
    container.append(node('p','pm-note',(state.total_minutes/60).toFixed(2)+' hours recorded · '+state.entry_count+' entries · versioned Markdown in Nextcloud'));
    if (state.my_active_started_at) {
      const since=new Date(state.my_active_started_at);
      const elapsed=Math.max(0,Math.floor((Date.now()-since.getTime())/60000));
      container.append(node('p','pm-notice-warning','Timer active since '+since.toLocaleString()+' ('+elapsed+' minutes elapsed)'));
    }
    const actions=node('div','pm-views');
    const comment=control('input','text','What did you work on?');
    const manual=control('input','number','Minutes (1–720)');manual.min='1';manual.max='720';
    const workday=control('input','date','Work date');workday.value=dayKey(new Date());
    async function change(action, fields={}){
      actions.querySelectorAll('button').forEach(b=>b.disabled=true);
      try {
        await P.call(url,{method:'POST',body:{action,...fields}});
        notice.textContent='Work session saved in project Markdown.';
        await showTime(task,container);
      } catch(error){
        notice.textContent='Work log: '+error.message;
        actions.querySelectorAll('button').forEach(b=>b.disabled=false);
      }
    }
    if(task.can_edit){
      if(state.my_active_started_at){
        actions.append(btn('Stop and save',()=>change('stop',{note:comment.value})),
          btn('Discard timer',()=>{if(confirm('Discard the active timer without recording hours?'))change('discard');}));
      } else actions.append(btn('Start timer',()=>change('start')));
      actions.append(btn('Add manual minutes',()=>change('log',{minutes:Number(manual.value),date:workday.value,note:comment.value})));
      container.append(comment,manual,workday,actions);
    }
    const recent=node('div','pm-list');
    state.entries.slice(0,30).forEach(entry=>{
      const person=members.find(m=>String(m.user_id)===String(entry.owner_id));
      recent.append(node('p','pm-note',day(entry.start)+' · '+entry.minutes+'m · '+(person?.name||'Member')+' · '+entry.note));
    });
    container.append(recent);
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
    owner.disabled=!!cockpit.project?.canonical_enabled;
    owner.title=owner.disabled?'Owner updates require the versioned canonical task schema upgrade.':'';
    const blocked = control('input','text','Blocker or waiting reason'); blocked.value=task.blocked_reason || '';
    const description = control('textarea', null, 'Description'); description.rows=5; description.value=task.description || '';
    const done = control('textarea', null, 'Definition of done'); done.rows=3; done.value=task.definition_of_done || '';
    panel.append(title, description, done, deadline, status, priority, owner, blocked,
      ...(owner.disabled?[node('p','pm-note','Owner and dependency changes are read only for adopted projects until these relations are present in the canonical text schema.')]:[]),
      btn('Save changes', () => { const data = { title: title.value, description:description.value, definition_of_done:done.value, due_date:deadline.value, status:status.value, priority:priority.value, blocked_reason:blocked.value }; if(!owner.disabled && owner.value && owner.value !== String(task.owner_id)) data.owner_id = owner.value; patch(task, data); }),
      btn('Close', () => editor.replaceChildren()));
    mountAnchoredComments({ container: panel, kind: 'task', id: task.id, canEdit: task.can_edit,
      fields: [
        {key:'description', label:'Task description', element:description},
        {key:'definition_of_done', label:'Definition of done', element:done},
        {key:'blocked_reason', label:'Blocked reason', element:blocked},
        {key:'title', label:'Title', element:title},
      ] });
    const time = node('section','pm-editor');panel.append(time);
    editor.append(panel);
    showTime(task,time);
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
      ['Completed', n.filter(done).length],
      ['Time logged', timeSummary ? (timeSummary.total_minutes/60).toFixed(1)+'h' : '—']
    ].forEach(([k,v])=>{const c=node('div','pm-stat');c.append(node('strong','',String(v)),node('small','',k));stat.append(c);});
    ['board','list','timeline','week','team','work logs','matrix','review'].forEach(mode=>{
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
      body.append(node('p','pm-note','Gantt uses explicitly planned start/end dates from versioned Markdown schedule notes. Unscheduled tasks are shown separately. Due dates remain independent. Click Plan to edit.'));
      const scheduled=n.filter(t=>scheduleMap?.has(t.id));
      const starts=scheduled.map(t=>Date.parse(scheduleMap.get(t.id).start_date+'T00:00:00Z'));
      const ends=scheduled.map(t=>Date.parse(scheduleMap.get(t.id).end_date+'T00:00:00Z'));
      const origin=starts.length?Math.min(...starts):Date.now();
      const extent=ends.length?Math.max(...ends):origin+86400000;
      const span=Math.max(86400000,extent-origin+86400000);
      const chart=node('div','pm-gantt');
      scheduled.sort((a,b)=>scheduleMap.get(a.id).start_date.localeCompare(scheduleMap.get(b.id).start_date)).forEach(task=>{
        const plan=scheduleMap.get(task.id), row=node('div','pm-gantt-row');
        const left=node('div');left.append(node('strong','',task.title),node('p','pm-gantt-date',plan.start_date+' → '+plan.end_date+' · '+(plan.estimated_minutes/60).toFixed(1)+'h estimate'));
        if(task.can_edit)left.append(btn('Edit plan',()=>editSchedule(task)));
        const track=node('div','pm-gantt-track'),bar=node('div','pm-gantt-bar');
        const leftPercent=(Date.parse(plan.start_date+'T00:00:00Z')-origin)/span*100;
        const widthPercent=(Date.parse(plan.end_date+'T00:00:00Z')-Date.parse(plan.start_date+'T00:00:00Z')+86400000)/span*100;
        bar.style.left=leftPercent+'%';bar.style.width=Math.max(1,widthPercent)+'%';
        bar.title=task.title+' · '+plan.start_date+' to '+plan.end_date;
        track.append(bar);row.append(left,track);chart.append(row);
      });
      n.filter(t=>!scheduleMap?.has(t.id)).forEach(task=>{
        const row=node('div','pm-task');row.append(node('span','',task.title+' · no plan set'));
        if(task.can_edit)row.append(btn('Plan',()=>editSchedule(task)));chart.append(row);
      });
      body.append(chart);
    }else if(current.view==='week'){
      body.append(node('p','pm-note','Next seven days: tasks active within an explicitly planned date range, plus unscheduled tasks due that day. These are date assignments, not hourly reservations.'));
      const days=node('div','pm-planner');
      for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()+i);const key=dayKey(d);
        const planned=n.filter(t=>{const p=scheduleMap?.get(t.id);return p&&p.start_date<=key&&p.end_date>=key;});
        const due=n.filter(t=>!scheduleMap?.has(t.id)&&day(t.due_date)===key);
        const c=node('div','pm-day');c.append(node('strong','',key),node('p','pm-note',planned.length+' scheduled · '+due.length+' due only'));
        planned.forEach(t=>c.append(tile(t)));due.forEach(t=>c.append(tile(t)));days.append(c);}
      body.append(days);
    }else if(current.view==='matrix'){
      body.append(node('p','pm-note','Priority matrix uses an explicit heuristic: important = P0/P1, urgent = due within seven days. This view does not change task priorities or source files.'));
      const horizon=new Date();horizon.setDate(horizon.getDate()+7);
      const urgentDue=dayKey(horizon);
      const active=n.filter(t=>!done(t));
      const urgent=t=>!!t.due_date&&day(t.due_date)<=urgentDue;
      const important=t=>['p0','p1'].includes(t.priority);
      const cells=node('div','pm-columns');
      [
        ['Important + urgent',t=>important(t)&&urgent(t)],
        ['Important, not urgent',t=>important(t)&&!urgent(t)],
        ['Urgent, lower priority',t=>!important(t)&&urgent(t)],
        ['Other backlog',t=>!important(t)&&!urgent(t)]
      ].forEach(([title,match])=>{
        const c=node('div','pm-column'),found=active.filter(match);
        c.append(node('h3','',title+' ('+found.length+')'));
        found.forEach(t=>c.append(tile(t)));cells.append(c);
      });body.append(cells);
    }else if(current.view==='review'){
      const cutoff=new Date();cutoff.setDate(cutoff.getDate()-7);
      const reviewed=n.filter(t=>t.completed_at&&new Date(t.completed_at)>=cutoff);
      const due=n.filter(t=>overdue(t,today));
      const blocked=n.filter(t=>t.status==='blocked');
      const planned=n.reduce((total,t)=>total+(scheduleMap?.get(t.id)?.estimated_minutes||0),0);
      const actual=n.reduce((total,t)=>total+(timeSummary?.task_minutes?.[String(t.id)]||0),0);
      body.append(node('h3','','Weekly project review'));
      body.append(node('p','pm-note','Current source-backed snapshot. Completed tasks use the past 7 days; estimated and tracked hours cover visible tasks, not just this week.'));
      const overview=node('div','pm-stats');
      [['Done this week',reviewed.length],['Overdue',due.length],['Blocked',blocked.length],['Estimated hours',(planned/60).toFixed(1)],['Recorded hours',(actual/60).toFixed(1)]].forEach(([label,value])=>{
        const c=node('div','pm-stat');c.append(node('strong','',String(value)),node('small','',label));overview.append(c);
      });body.append(overview);
      const rows=node('div','pm-list');
      [['Attention: overdue tasks',due],['Attention: blockers',blocked],['Completed this week',reviewed]].forEach(([title,items])=>{
        rows.append(node('h4','',title));
        if(!items.length)rows.append(node('p','pm-note','No tasks'));
        items.forEach(task=>rows.append(tile(task)));
      });body.append(rows);
    }else if(current.view==='work logs'){
      const logs=node('div','pm-list');
      if(!timeSummary){logs.append(node('p','pm-note','Loading work logs from Nextcloud…'));}
      else{Object.entries(timeSummary.daily_minutes||{}).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,60).forEach(([date,minutes])=>{
        logs.append(node('div','pm-task',date+' · '+(minutes/60).toFixed(2)+' hours'));
      });if(!Object.keys(timeSummary.daily_minutes||{}).length) logs.append(node('p','pm-note','No recorded work yet.'));}
      body.append(logs);
    }else{
      const cols=node('div','pm-columns');members.forEach(m=>{const assigned=n.filter(t=>String(t.owner_id)===String(m.user_id));const c=node('div','pm-column');
        const logged=timeSummary?.owner_minutes?.[String(m.user_id)];
        c.append(node('h3','',m.name),node('p','pm-note',`${assigned.filter(t=>!done(t)).length} open · ${assigned.filter(t=>overdue(t,today)).length} overdue · ${logged===undefined?'—':(logged/60).toFixed(1)+'h'} logged`));
        assigned.forEach(t=>c.append(tile(t)));cols.append(c);});body.append(cols);
    }
    if(cockpit.project?.permissions?.can_edit) body.append(newTask());
  }
  function editSchedule(task){
    editor.replaceChildren();
    const box=node('section','pm-schedule-editor'),plan=scheduleMap?.get(task.id);
    const start=control('input','date','Planned start');start.value=plan?.start_date||dayKey(new Date());
    const end=control('input','date','Planned end');end.value=plan?.end_date||day(task.due_date)||start.value;
    const minutes=control('input','number','Estimated minutes');minutes.min='0';minutes.max='525600';minutes.value=String(plan?.estimated_minutes??120);
    const message=node('p','pm-note','Stored in a human editable, versioned Markdown schedule note in Nextcloud.');
    const save=btn('Save plan',async()=>{
      try {
        const data=await P.call('/platform/projects/'+projectId+'/schedules/',{method:'POST',body:{
          task_id:task.id,start_date:start.value,end_date:end.value,estimated_minutes:Number(minutes.value)
        }});
        scheduleMap=scheduleMap||new Map();scheduleMap.set(task.id,data);
        editor.replaceChildren();paint();notice.textContent='Gantt plan saved to canonical Markdown.';
      } catch(e){message.textContent=e.message;}
    });
    box.append(node('h3','','Plan · '+task.title),start,end,minutes,save,btn('Close',()=>editor.replaceChildren()),message);
    editor.append(box);
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
  P.call('/platform/projects/'+projectId+'/schedules/').then(data=>{scheduleMap=new Map(data.schedules.map(x=>[Number(x.task_id),x]));paint();}).catch(err=>{notice.textContent='Gantt schedule unavailable: '+err.message;});
  P.call('/platform/projects/'+projectId+'/work-time/').then(data=>{timeSummary=data;paint();}).catch(err=>{notice.textContent='Work-time summary unavailable: '+err.message;});
  const linkedId = new URLSearchParams(location.search).get('task');
  if(linkedId && /^\d+$/.test(linkedId)){
    const selected = tasks.find(t=>String(t.id)===linkedId);
    if(selected){if(selected.can_edit)openEditor(selected);else notice.textContent='Task #' + linkedId + ' is read only.';}
  }
}
