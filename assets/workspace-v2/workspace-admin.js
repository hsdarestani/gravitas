import {activityCsv,activityMatches,activityType,activityTypes,daysSince,latestStamp,reviewIntervals} from './admin-insights.js';
import {asDate,dayIndex,today} from './timing.js';

const sortTitle=(a,b)=>a.title.localeCompare(b.title);
const plural=(count,unit)=>count+' '+unit+(count===1?'':'s');
const planningViews=[['okrs','OKRs','target'],['milestones','Milestones','timeline'],['decisions','Decisions','message']];

export function administrationUI({data,ui,upcomingMeetings,esc,symbol,button,iconButton,tab,select,area,person,ownerName,avatar,
  project,visibleActivity,projectTasks,visibleWorkReport,isOpen,isBlocked,isOverdue,reportReady,
  objectives,northStar,krData,shortTime,meetingWhen,taskRefVisible,projectStateChip,kpiDisplay,activity}) {
  const active=()=>data.projects.filter(flow=>flow.state==='active');
  const allObjectives=[...objectives,northStar].filter(Boolean);
  const reviewDays=()=>data.adminReviewDays||14;
  const currentDay=()=>today();
  const owner=id=>person(id)?ownerName(id):'Unassigned';
  const status=(label,tone='quiet')=>`<span class="status ${tone}">${esc(label)}</span>`;
  const ownerControl=(id,label,current)=>select(id,label,[['','All owners'],['unassigned','Unassigned'],
    ...data.team.map(member=>[member.id,member.name])],current);
  const matchesOwner=(id,filter)=>!filter||(filter==='unassigned'?!person(id):filter===id);
  const areaControl=(id,label,current)=>select(id,label,[['','All work areas'],...data.areas.map(group=>[group.id,group.title]),
    ['_ideas','Ideas']],current);
  const context=flow=>[area(flow.area)?.title,owner(flow.owner)].filter(Boolean).join(' · ');
  const next=(label,action,icon,value='')=>button(action,label,icon,'ghost',value);
  const toolbar=(title,controls='')=>`<div class="panel-head admin-filter-bar"><h2>${esc(title)}</h2><div>${controls}</div></div>`;
  const nameTile=(title,meta,icon,action,value,tone='')=>`<button type="button" class="admin-name-tile ${tone}"
    data-action="${action}" data-value="${esc(value)}"><span class="tile-icon">${symbol(icon)}</span>
    <span><strong>${esc(title)}</strong><small>${esc(meta)}</small></span></button>`;
  const empty=label=>`<p class="detail-empty">${esc(label)}</p>`;

  function milestones(flows) {
    return flows.flatMap(flow=>(flow.milestones||[]).map(entry=>({flow,entry})))
      .sort((a,b)=>a.entry.deadline.localeCompare(b.entry.deadline)||sortTitle(a.entry,b.entry));
  }
  function decisions(flows) {
    return flows.flatMap(flow=>(flow.updates||[]).filter(entry=>entry.decision&&!entry.resolution).map(entry=>({flow,entry})))
      .sort((a,b)=>a.entry.at.localeCompare(b.entry.at));
  }
  function milestoneStatus(entry,now) {
    const days=dayIndex(entry.deadline)-dayIndex(now);
    if (entry.completed) return ['Reached','done'];
    if (days<0) return [plural(-days,'day')+' overdue','late'];
    if (!days) return ['Due today','attention'];
    if (days<=7) return ['Due in '+plural(days,'day'),'attention'];
    return ['Upcoming','quiet'];
  }
  function signals(flow,items,now) {
    const lastUpdate=latestStamp((flow.updates||[]).map(item=>item.at));
    const age=daysSince(lastUpdate,now);
    const blocked=items.filter(item=>isOpen(item)&&isBlocked(item)).length;
    return {lastUpdate,needsUpdate:age===null||age>=reviewDays(),blocked,overdue:items.filter(isOverdue).length};
  }
  function overview() {
    const flows=active(),now=currentDay(),entries=decisions(flows),dates=milestones(flows);
    const lateMilestones=dates.filter(({entry})=>!entry.completed&&entry.deadline<now);
    const schedule=dates.filter(({entry})=>!entry.completed&&entry.deadline>=now&&dayIndex(entry.deadline)-dayIndex(now)<=7);
    const primary=[],regular=[],updates=[];
    for (const {flow,entry} of lateMilestones) primary.push({
      title:entry.title,meta:flow.title+' · '+milestoneStatus(entry,now)[0],icon:'target',action:'okr-project-milestone',
      value:flow.id+'|'+entry.id,tone:'late'
    });
    for (const {flow,entry} of entries) primary.push({
      title:entry.decision,meta:flow.title+' · '+owner(entry.decider),icon:'message',action:'admin-open-decision',
      value:flow.id+'|'+entry.id,tone:'attention'
    });
    for (const flow of flows) {
      const {blocked,overdue,needsUpdate,lastUpdate}=signals(flow,projectTasks(flow.id),now);
      const base={value:flow.id,title:flow.title,icon:'clock',tone:'attention'};
      if (!person(flow.owner)) primary.push({...base,meta:'Project owner needed',icon:'user',action:flow.area==='_ideas'?'workflow':'project-settings'});
      if (overdue||blocked) regular.push({...base,meta:[overdue&&plural(overdue,'overdue task'),blocked&&plural(blocked,'blocked task')].filter(Boolean).join(' · '),
        tone:overdue?'late':'attention',action:'admin-project-tasks',value:flow.id+'|'+(overdue?'late':'blocked')});
      if (reportReady(flow)) regular.push({...base,meta:'Closing report ready for review',icon:'journal',tone:'done',action:'open-project-summary'});
      if (needsUpdate&&person(flow.owner)) updates.push({...base,meta:lastUpdate?'Project update due':'First project update needed',
        tone:'',action:'admin-open-updates'});
    }
    const queue=[...primary,...regular,...updates];
    const allItems=flows.flatMap(flow=>projectTasks(flow.id));
    const done=allItems.filter(item=>item.status==='done').length;
    const areas=data.areas.map(group=>{
      const items=allItems.filter(item=>project(item.project)?.area===group.id);
      return {group,total:items.length,done:items.filter(item=>item.status==='done').length};
    }).filter(item=>item.total).sort((a,b)=>b.total-a.total).slice(0,6);
    const metrics=[
      ['projects:active','Active projects',flows.length,'briefcase',''],
      ['tasks:late','Overdue tasks',allItems.filter(isOverdue).length,'clock','late'],
      ['planning:decisions','Open decisions',entries.length,'message','attention'],
      ['planning:milestones','Overdue milestones',lateMilestones.length,'target','late']
    ];
    return `<div class="admin-pulse">
      <section class="panel admin-progress admin-pulse-progress">
        <div class="admin-ring" style="--share:${done/Math.max(1,allItems.length)*100}%"><strong>${done}<small> / ${allItems.length}</small></strong></div>
        <div><h2>Task completion</h2><p>Across active projects</p>${next('Team workload','page','timeline','workload')}</div>
      </section>
      <div class="admin-pulse-metrics">${metrics.map(([key,label,count,icon,tone])=>`<button type="button" class="panel admin-pulse-stat ${tone}" data-action="admin-shortcut" data-value="${key}">
        <span class="tile-icon">${symbol(icon)}</span><strong>${count}</strong><span>${label}</span></button>`).join('')}</div>
    </div>
    <div class="admin-command-grid">
      <section class="panel admin-review-queue">
        ${toolbar('Needs attention',select('admin-review-days','Project update review window',reviewIntervals.map(days=>[String(days),'Update cadence · '+days+' days']),String(reviewDays())))}
        <div class="admin-scroll-list">${queue.length?queue.map(item=>nameTile(item.title,item.meta,item.icon,item.action,item.value,item.tone)).join(''):
          empty('No projects need attention.')}</div>
      </section>
      <div class="admin-command-side">
        <section class="panel">${toolbar('Milestones in the next 7 days',next('Planning','admin','target','planning'))}
          ${schedule.length?schedule.map(({flow,entry})=>nameTile(entry.title,flow.title+' · '+asDate(entry.deadline),'target','okr-project-milestone',flow.id+'|'+entry.id)).join(''):
          empty('No milestones due in the next 7 days.')}</section>
        <section class="panel admin-direct"><div class="panel-head"><h2>Workspace tools</h2></div>
          ${[
            ['Meetings','Sessions and follow-ups','people','admin','meetings'],
            ['Reports','Project notebooks and closing reports','journal','admin','reports'],
            ['Templates','Workflow templates','layout','page','templates'],
            ['All work graph','Find related work','flow','page','allgraph']
          ].map(([title,meta,icon,action,value])=>nameTile(title,meta,icon,action,value)).join('')}</section>
      </div>
    </div>
    <div class="admin-command-grid admin-command-end">
      <section class="panel admin-area-health">${toolbar('Progress by area',next('Work areas','admin','layout','areas'))}
        ${areas.map(({group,total,done})=>`<button type="button" class="admin-area-meter" data-action="admin-area-projects" data-value="${esc(group.id)}">
          <span>${symbol(group.icon)}<strong>${esc(group.title)}</strong><small>${done}/${total} done</small></span>
          <span class="health-track"><span style="--share:${done/total*100}%"></span></span></button>`).join('')||empty('No active tasks yet.')}
      </section>
      <section class="panel">${toolbar('Recent activity',next('Activity log','admin','clock','activity'))}
        ${activity(visibleActivity().slice(0,5),true)}</section>
    </div>`;
  }

  function planning() {
    const view=ui.adminPlanning;
    return `<div class="views admin-subtabs" role="tablist" aria-label="Admin planning views">${planningViews.map(([id,label,icon])=>
      tab('admin-plan',id,label,icon,view)).join('')}</div>`+
      (view==='milestones'?milestoneIndex():view==='decisions'?decisionIndex():okrIndex());
  }
  function okrIndex() {
    const now=currentDay();
    return `<div class="admin-okr-grid">${allObjectives.map(item=>{
      const measured=item.results.filter(kr=>krData(kr.id).checkIns.length).length;
      const atTarget=item.results.filter(kr=>krData(kr.id).checkIns.at(-1)?.value>=kr.target).length;
      const stamp=latestStamp(item.results.map(kr=>krData(kr.id).checkIns.at(-1)?.at));
      return `<article class="panel admin-strategy-card">
        <div class="admin-row-head">${nameTile(item.title,owner(data.okrs.owners[item.id]),'target','open-okr',item.id)}
          ${iconButton('okr-edit-owner','Assign owner for '+item.title,'user',item.id)}</div>
        <div class="admin-strategy-meta"><span>${measured} / ${item.results.length} measured</span>
          <span>${atTarget} at target</span>${status(stamp?(daysSince(stamp,now)>=reviewDays()?'Check-in due':shortTime(stamp)):'No check-ins',!stamp||daysSince(stamp,now)>=reviewDays()?'attention':'quiet')}</div>
        <details class="admin-key-results"><summary>Key results and owners</summary>
          ${item.results.map(kr=>{
            const info=krData(kr.id),last=info.checkIns.at(-1);
            const contact=owner(data.okrs.owners[kr.id]||data.okrs.owners[item.id]);
            return `<div class="admin-kr-row">
              <div><strong>${esc(kr.label)}</strong><small>${esc(contact)} · ${last?esc(shortTime(last.at)):'No check-in'}</small></div>
              ${iconButton('okr-edit-owner','Assign owner for '+kr.label,'user',kr.id)}
              ${iconButton('okr-check-in','Log check-in for '+kr.label,'edit',kr.id)}</div>`;
          }).join('')}</details>
      </article>`;
    }).join('')}</div>`;
  }
  function milestoneIndex() {
    const now=currentDay(),filter=ui.adminMilestoneState;
    const rows=milestones(filter==='reached'?data.projects:active()).filter(({flow,entry})=>
      (!ui.adminPlanArea||flow.area===ui.adminPlanArea)&&matchesOwner(entry.owner,ui.adminPlanOwner)&&
      (filter==='reached'?entry.completed:!entry.completed)&&
      (filter!=='late'||entry.deadline<now));
    return `<section class="panel admin-index">
      ${toolbar(plural(rows.length,'milestone'),areaControl('admin-plan-area','Filter milestones by work area',ui.adminPlanArea)+
        ownerControl('admin-plan-owner','Filter milestones by owner',ui.adminPlanOwner)+
        select('admin-milestone-status','Filter milestones by state',[['','Upcoming and overdue'],['late','Overdue'],['reached','Reached']],filter))}
      ${rows.map(({flow,entry})=>{
        const [label,tone]=milestoneStatus(entry,now);
        return `<article class="admin-index-row">${nameTile(entry.title,flow.title+' · '+(area(flow.area)?.title||''),'target','okr-project-milestone',flow.id+'|'+entry.id,tone)}
          <div class="admin-index-meta"><strong>${asDate(entry.deadline,true)}</strong><small>${esc(owner(entry.owner))}</small></div>${status(label,tone)}
          ${flow.state==='active'?iconButton('admin-edit-milestone','Edit milestone '+entry.title,'edit',flow.id+'|'+entry.id):''}</article>`;
      }).join('')||empty('No milestones match these filters.')}</section>`;
  }
  function decisionIndex() {
    const rows=decisions(active()).filter(({flow,entry})=>
      (!ui.adminPlanArea||flow.area===ui.adminPlanArea)&&matchesOwner(entry.decider,ui.adminPlanOwner));
    return `<section class="panel admin-index">${toolbar(plural(rows.length,'open decision'),
      areaControl('admin-plan-area','Filter decisions by work area',ui.adminPlanArea)+ownerControl('admin-plan-owner','Filter decisions by owner',ui.adminPlanOwner))}
      ${rows.map(({flow,entry})=>`<article class="admin-index-row">
        ${nameTile(entry.decision,flow.title+' · '+owner(entry.decider),'message','admin-open-decision',flow.id+'|'+entry.id,'attention')}
        <div class="admin-index-meta"><small>Raised ${esc(shortTime(entry.at))}</small></div>
        ${status('Decision needed','attention')}${iconButton('admin-resolve-decision','Record decision for '+flow.title,'check',flow.id+'|'+entry.id)}
      </article>`).join('')||empty('No open decisions match these filters.')}</section>`;
  }

  function meetingIndex() {
    const now=currentDay(),mode=ui.adminMeetingState;
    const rows=(mode?data.meetings:upcomingMeetings()).filter(item=>matchesOwner(item.owner,ui.adminMeetingOwner)&&
      (mode==='done'?item.completedAt:!item.completedAt&&(mode!=='past'||item.date<now)))
      .sort((a,b)=>mode==='done'?b.completedAt.localeCompare(a.completedAt):(a.date+a.time).localeCompare(b.date+b.time));
    const controls=ownerControl('admin-meeting-owner','Filter meetings by owner',ui.adminMeetingOwner)+
      select('admin-meeting-status','Filter meetings by state',[['','Open meetings'],['past','Past date · still open'],['done','Archived meetings']],mode);
    return `<section class="panel admin-index">${toolbar(plural(rows.length,'meeting'),controls)}
      ${rows.map(item=>{
        const checks=item.agenda.filter(entry=>entry.done).length;
        const followups=item.followups.filter(taskRefVisible).length;
        return `<article class="admin-index-row">
          ${nameTile(item.title,meetingWhen(item)+' · '+owner(item.owner),'people','open-meeting',item.id)}
          <div class="admin-index-meta"><small>${checks}/${item.agenda.length} agenda items · ${plural(followups,'follow-up')}</small><small>${item.note?'Report available':'Report pending'}</small></div>
          ${item.completedAt?status('Archived','done'):item.date<now?status('Past date · open','attention'):status('Scheduled')}
          ${!item.completedAt?iconButton('edit-meeting','Edit '+item.title,'edit',item.id):''}
        </article>`;
      }).join('')||empty('No meetings match these filters.')}</section>`;
  }

  function reportIndex() {
    const mode=ui.adminReportState;
    const rows=data.projects.map(flow=>{
      const notebook=visibleWorkReport(flow);
      const close=flow.state==='active'?flow.draftReport:flow.completions.at(-1);
      const ready=reportReady(flow),filed=flow.state!=='active'&&Boolean(close);
      return {flow,notebook,close,ready,filed,stamp:latestStamp([notebook?flow.workReport.updatedAt:'',close?.closedAt||close?.updatedAt])};
    }).filter(({flow,notebook,close,ready,filed})=>(!ui.adminReportArea||flow.area===ui.adminReportArea)&&
      (mode==='ready'?ready:mode==='filed'?filed:mode==='missing'?flow.state==='active'&&!notebook&&!close:true))
      .sort((a,b)=>Number(b.ready)-Number(a.ready)||b.stamp.localeCompare(a.stamp)||sortTitle(a.flow,b.flow));
    return `<section class="panel admin-index">${toolbar(plural(rows.length,'project'),
      areaControl('admin-report-area','Filter reports by work area',ui.adminReportArea)+
      select('admin-report-status','Filter reports by state',[['','All reports'],['ready','Ready to close'],['filed','Filed'],['missing','No report yet']],mode))}
      ${rows.map(({flow,notebook,close,ready,filed,stamp})=>{
        const measured=flow.kpis.filter(item=>item.result).length;
        const outside=flow.kpis.filter(item=>kpiDisplay(item).tone==='attention').length;
        return `<article class="admin-index-row admin-report-row">
          ${nameTile(flow.title,context(flow),'journal','admin-open-notebook',flow.id)}
          <div class="admin-index-meta">${stamp?`<small>Updated ${esc(shortTime(stamp))}</small>`:''}
            <small>${measured}/${flow.kpis.length} KPI results${outside?' · '+outside+' outside target':''}</small></div>
          <div class="admin-row-status">${projectStateChip(flow)}${status(filed?'Closing report filed':ready?'Ready to close':close?'Closing draft':notebook?'Work report started':'Report pending',filed||ready?'done':'quiet')}</div>
          <div class="admin-index-actions">${next('Work report','admin-open-notebook','journal',flow.id)}${next('KPIs & closing','open-project-summary','target',flow.id)}</div>
        </article>`;
      }).join('')||empty('No reports match these filters.')}</section>`;
  }

  const subject=event=>project(event.project)?.title||data.meetings.find(item=>item.id===event.meeting)?.title||'';
  function activityRows() {
    const filters={project:ui.adminFilter,actor:ui.adminActorFilter,type:ui.adminActivityType,
      window:ui.adminActivityWindow,query:ui.adminActivityQuery.trim().toLocaleLowerCase()};
    const now=currentDay();
    return visibleActivity().filter(event=>activityMatches(event,filters,now,[subject(event),ownerName(event.actor),activityTypes[activityType(event)]]));
  }
  function activityLog() {
    return `<section class="panel admin-index">
      ${toolbar('Workspace activity',next('Export CSV','admin-activity-export','download'))}
      <div class="admin-activity-filters">
        <input type="search" id="admin-activity-query" value="${esc(ui.adminActivityQuery)}" placeholder="Search activity" aria-label="Search activity">
        ${select('admin-log-project','Filter activity by project',[['','All projects'],...data.projects.map(flow=>[flow.id,flow.title])],ui.adminFilter)}
        ${select('admin-log-person','Filter activity by person',[['','All teammates'],...data.team.map(member=>[member.id,member.name])],ui.adminActorFilter)}
        ${select('admin-log-type','Filter activity by category',[['','All categories'],...Object.entries(activityTypes)],ui.adminActivityType)}
        ${select('admin-log-window','Filter activity by date',[['','Any time'],['7','Past 7 days'],['30','Past 30 days'],['90','Past 90 days']],ui.adminActivityWindow)}
      </div><div id="admin-activity-results">${activityTable()}</div></section>`;
  }
  function activityTable() {
    const rows=activityRows(),shown=Math.min(ui.adminActivityLimit,rows.length);
    return `<p class="admin-result-count" role="status">${plural(rows.length,'event')}${shown<rows.length?' · showing '+shown:''}</p>
      ${rows.length?`<div class="admin-activity-table"><table><thead><tr><th>Action</th><th>Actor</th><th>Category</th><th>When · Tehran</th></tr></thead>
        <tbody>${rows.slice(0,shown).map(entry=>`<tr>
          <td>${entry.task?`<button type="button" class="text-button" data-action="open-project-task" data-value="${esc(entry.task)}">${esc(entry.text)}</button>`:
            entry.meeting&&data.meetings.some(item=>item.id===entry.meeting)?`<button type="button" class="text-button" data-action="open-meeting" data-value="${esc(entry.meeting)}">${esc(entry.text)}</button>`:
            `<strong>${esc(entry.text)}</strong>`}
            <small>${esc(subject(entry))}</small></td>
          <td>${avatar(person(entry.actor),'small')} ${esc(ownerName(entry.actor))}</td><td>${esc(activityTypes[activityType(entry)])}</td><td>${esc(shortTime(entry.at))}</td>
        </tr>`).join('')}</tbody></table></div>${shown<rows.length?`<div class="admin-more">${next('Show more','admin-activity-more','down')}</div>`:''}`:
        empty('No activity matches these filters.')}`;
  }
  function exportActivity() {
    const rows=activityRows();
    if (!rows.length) return false;
    const csv=activityCsv(rows.map(entry=>[entry.at,ownerName(entry.actor),activityTypes[activityType(entry)],subject(entry),entry.text]));
    const link=document.createElement('a');
    const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
    link.href=url;
    link.download='graviquest-activity-'+currentDay()+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    return true;
  }
  return {overview,planning,meetingIndex,reportIndex,activityLog,activityTable,exportActivity,signals};
}
