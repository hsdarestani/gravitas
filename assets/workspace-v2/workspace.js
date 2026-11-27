import {durationIssue,isDuration,isScheduleDate,maxTaskDays} from './task-schedule.js';
import {workspaceSchedules} from './workflow-schedule.js';
import {administrationUI} from './workspace-admin.js';
import {reviewIntervals} from './admin-insights.js';
import {kpiDisplay} from './kpi-display.js';
import {focusedLayout,relationshipLayout} from './network-layout.js';
import {roadmapUrl,objectives,northStar,objectiveById,resultById,metricValue,resultProgress,setObjectives} from './roadmap-okrs.js';
import {daysLabel,taskDayLoad} from './workload-days.js';
import {uniqueDailyBlocks} from './daily-dedupe.js';
import {allowsProjectLink, linkedHalfWidth, linkedNode, projectGate, projectNodes, unmetWorkflowSteps} from './linked-projects.js';
import {orderedTaskRows} from './task-table-sort.js';
import {templateFlowLayout} from './template-flow.js';
import { attachIdeaWorkflow, ideaArea, isArchivedProject, projectInWork, projectSignals } from './project-lifecycle.js';
import { calendarRange, calendarState, calendarUI, inPeriod, periodChoices } from './calendar.js';


import { downloadReport, httpLinkParts, reportPreview } from './report-export.js';
import { profilePhoto, validPhoto } from './member-profile.js';
import { captureCanvasVersion, restoreCanvasVersion } from './canvas-versions.js';
import { floatingDialog, blockerTooltips } from './workspace-interactions.js';
import { canReadTask, canReadEvent } from './task-access.js';
import { weightedMosaic } from './showroom-layout.js';

import { tidyWorkflow } from './workflow-layout.js';
import { icons, statuses } from './data.js';
import { workspaceApi } from './studio-api.js';
import { canonicalStatus, priorityByImportance, taskDetailsData, workspaceData } from './studio-data.js';
import { asDate, dayAt, dayIndex, planLayout, timeZone, timing, today } from './timing.js';
import {findMeeting, meetingsInWindow, seriesOccurrence, weeklyDay} from './meeting-series.js';
import { containsFrame, containsPoint, frameBox, frameHierarchy, frameKey, groupKey, resizeBox, shapeArrow, shapeId, shapeKind } from './workflow-frames.js';
import { completionRecord, initializeProjectRecords, reportReady, upgradeProjectRecords } from './project-records.js';
import { eventsForDay, markRead, noteRecipients, notifications, recipientsFor, threadNotes } from './journal.js';

import { mountGravityGrid } from './gravity-header.js';
import { captureTemplate, materializeTemplate, milestoneScheduleImpact, reachable, starterTemplate, workflowStages } from './planning.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const taskDialog = document.querySelector('#task-dialog');
const data = {};
let stateLoaded = false;
let writePending = false;
let restoringRoute = false;
const availableDetails = new Map();
const pendingDetails = new Map();
const detailsErrors = new Map();

let projectSchedules;
const newNetworkState=()=>({type:'',area:'',owner:'',query:'',archived:false,inspect:false,focus:'',zoom:100});
const ui = {
  adminPlanning:'okrs', adminPlanArea:'', adminPlanOwner:'', adminMilestoneState:'', adminMeetingState:'',
  adminMeetingOwner:'', adminReportState:'', adminReportArea:'', adminActivityQuery:'', adminActivityType:'',
  adminActivityWindow:'', adminActivityLimit:30,
  okr:'',kr:'',okrsView:'results', allGraph:newNetworkState(), areaGraphs:new Map(), areaViews:new Map(),
  linkReturns:[], periods:{}, tableSort:new Map(), locatedTask:null, calendars:{mine:calendarState(),team:calendarState(),project:calendarState()},
  page:'mine', myView:'focus', area:null, project:null, task:null, view:'flow', detail:'details',
  archiveView:'projects', archiveArea:'', archiveOutcome:'', actor:null, own:'all', admin:'overview', editor:false, ownerFilter:null,
  mobileOpen:false, zoom:null, adminFilter:'', linkStart:null, timeView:'layout', taskReturn:null,
  showroom:{scope:'mine',query:'',area:'',owner:'',status:'',size:'priority',color:'signal',page:0}, idea:null, meeting:null,
  expandedAreas:new Set(), inboxFilter:'all', dailyDate:today(), focusNote:null, replyNote:null, projectReply:null, focusProjectNote:null,
  taskQuery:'', taskStatus:'', taskOrder:'priority', myProject:'', workloadArea:'', workloadProject:'', workloadOwner:'', workloadStatus:'', builderTool:'select', builderSelection:new Set(), canvasUndo:[], placement:null, adminTaskFilter:'', adminOwnerFilter:'', adminProjectFilter:'', adminStateFilter:'', adminAreaFilter:'', adminActorFilter:''
};
let observer;
let unmountGravityGrid;
let toastTimer;
let lastFocus;
let renderedRoute;
let openReport;
const reportImageUrls = new Set();
const imageUrls = new Set();
const noteDrafts = new Map();
const newId = () => crypto.randomUUID();
const area = id => id===ideaArea.id?ideaArea:data.areas.find(item => item.id === id);
const project = id => data.projects.find(item => item.id === id);
const taskRecord = id => data.tasks.find(item => item.id === id);
const canSeeTask = item => canReadTask(item,ui.actor);
const needsSchedule=item=>!isDuration(item.durationDays);
const task = id => {
  const item=taskRecord(id);
  return canSeeTask(item)?item:undefined;
};
const taskRefVisible = ref => !ref.startsWith('task:')||Boolean(task(ref.slice(5)));
const canSeeEvent = event => {
  if (!canReadEvent(event,ui.actor,taskRecord)) return false;
  // Legacy canvas history could include a task name without a task ID.
  if (event.task||event.relatedTasks||!event.project||
    !/^(Connected |Drew layout arrow from |Removed from workflow: )/.test(event.text)) return true;
  return !data.tasks.some(item=>item.project===event.project&&!canSeeTask(item)&&event.text.includes(item.title));
};
const inboxEvents = () => data.notifications.filter(canSeeEvent);
const dailyEvents = () => projectNotebook()
  ? visibleActivity().filter(entry=>entry.task&&entry.project===ui.project&&task(entry.task)).slice(0,40)
  : eventsForDay(data,ui.actor,ui.dailyDate).filter(canSeeEvent);
const visibleActivity = () => data.log.filter(canSeeEvent);
const person = id => data.team.find(member => member.id === id);
const currentProject = () => project(ui.project);
const currentActor = () => person(ui.actor);
const activeTasks = () => data.tasks.filter(item=>!item.archived&&canSeeTask(item));
const projectTasks = id => data.tasks.filter(item=>item.project===id&&!item.archived&&canSeeTask(item));
const workingTasks = () => activeTasks().filter(item=>projectInWork(project(item.project)));
const rawProjectTasks = id => data.tasks.filter(item=>item.project===id&&!item.archived);
function refreshDerivedSchedule() {
  projectSchedules=workspaceSchedules(data);
  for (const item of data.tasks) {
    if (item.archived||isArchivedProject(project(item.project))) continue;
    const dates=projectSchedules.get(item.project)?.dates.get(item.id);
    if (dates && !item.dueDate) Object.assign(item,dates);

  }
}
const isAdmin = () => currentActor()?.role === 'Admin';
const stagingAccounts = () => location.hostname === 'staging.graviquest.com' && isAdmin();
const isActiveProject = flow => flow?.state==='active';
const canManageProject = flow => Boolean(flow?.canEdit && isActiveProject(flow));
const canEdit = id => canManageProject(project(id));
const canCreateTask = id => data.canCreateTask && canManageProject(project(id));
const shapeExists = (flow,id) => {
  if (shapeKind(id)==='frame') return flow.frames.some(frame=>frame.id===shapeId(id));
  if (shapeKind(id)==='group') return flow.groups.some(group=>group.id===shapeId(id));
  if (linkedNode(flow,id)) return true;
  const item=taskRecord(id);
  return Boolean(item?.project===flow.id&&!item.archived&&item.status!=='idea');
};
const idFor = (group, items) => {
  let n = items.length+1;
  while (items.some(item => item.id === group + n)) n++;
  return group + n;
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const symbol = (name, extra = '') => `<svg class="ico ${extra}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.circle}</svg>`;
const button = (action, label, icon, css = '', value = '') => `<button type="button" class="btn ${css}" data-action="${action}" data-value="${esc(value)}">${icon ? symbol(icon) : ''}${esc(label)}</button>`;
const iconButton = (action, label, icon, value = '', css = 'icon-btn') => `<button type="button" class="${css}" data-action="${action}" data-value="${esc(value)}" aria-label="${esc(label)}" title="${esc(label)}">${symbol(icon)}</button>`;
const tab = (group, key, label, icon, active) => `<button type="button" role="tab" aria-selected="${active === key}" class="tab" data-action="${group}" data-value="${key}">${icon ? symbol(icon) : ''}${esc(label)}</button>`;
const initials = member => member.name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase().slice(0,2);
const avatar = (member, css = '') => member ? `<span class="avatar ${css}" style="--person:${esc(member.color)}" aria-label="${esc(member.name)}" title="${esc(member.name)}">${validPhoto(member.photo)?`<img src="${member.photo}" alt="">`:esc(initials(member))}</span>` : '';
const memberAvatars = ids => `<span class="avatars">${ids.map(id => avatar(person(id),'small')).join('') || 'Unassigned'}</span>`;
const roleTitle = member => member.roleTitle || member.role;
const ownerName = id => person(id)?.name || 'Former member';
const dayTime = stamp => new Intl.DateTimeFormat(undefined,{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(stamp));
const shortTime = stamp => new Intl.DateTimeFormat(undefined,{timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp));
const incoming = item => {
  const flow=project(item.project);
  return (flow?.edges||[]).filter(([,to])=>to===item.id).map(([from])=>workflowShape(flow,from)).filter(Boolean);
};
const waitingSteps = item => {
  const flow=project(item.project);
  const unfinished = [...new Set([
    ...unmetWorkflowSteps(flow,item.id,task,node=>linkDetails(node).gate),
    ...(item.predecessorIds||[]).filter(id=>task(id)?.status!=='done'),
  ])];
  if (item.blockedByDependency && !unfinished.length) unfinished.push('restricted');
  if (item.canonicalStatus === 'blocked' && !unfinished.length) unfinished.push('blocked');
  return unfinished;
};
const blockers = item => {
  const flow=project(item.project);
  return waitingSteps(item).map(id=>workflowShape(flow,id)).filter(Boolean);
};
const hasBlockers = item => waitingSteps(item).length>0;
const dialogGrip = () => '<button type="button" class="dialog-grip" aria-label="Move window with arrow keys. Home recenters." title="Drag to move. Double-click to recenter."></button>';
floatingDialog(taskDialog,'.task-modal-head');
floatingDialog(dialog,'.dialog-head');
const hideBlockerTip=blockerTooltips(id=>{
  const item=task(id);
  if (!item || !isOpen(item) || !hasBlockers(item)) return '';
  const names=blockers(item).map(previous=>previous.title);
  const count=waitingSteps(item).length;
  if (count>names.length) names.push('a restricted prerequisite');
  return item.blockedReason || 'Waiting on '+names.join(', ')+'.';
});
const visibleLoop = loop => Boolean(task(loop.from)&&task(loop.to));
const visibleGroup = group => group.members.length>0&&group.members.every(id=>task(id));
const rounds = item => (project(item.project)?.loops ?? []).filter(loop => loop.from === item.id);
const checklistReady = item => item.checklist.every(entry => entry.done);
const involved = item => item.owners.includes(ui.actor) || item.collaboratorIds.includes(ui.actor) || item.notes.some(note => note.mentions.includes(ui.actor));
const readableStatus = item => !isActiveProject(project(item.project))&&item.status!=='done'?'Closed':
  isOpen(item)&&hasBlockers(item)?'Blocked':statuses[item.status];
function statusChip(item) {
  if (item.archived) return '<span class="status">'+symbol('inbox')+'Archived</span>';
  const label = readableStatus(item);
  const tone=label==='Closed'?'quiet':label==='Blocked'?'blocked':item.status;
  const statusIcon=({quiet:'lock',blocked:'lock',idea:'light',backlog:'circle',doing:'play',done:'check'})[tone];
  return `<span class="status ${tone}">${symbol(statusIcon)}${label}</span>`;
}
function save() {
  announce('This change is unavailable in the current preview.','danger');
  return false;
}
function record(text, item = null, projectId = item?.project || ui.project, details = {}, preserveUndo = false) {
  if (!preserveUndo&&ui.canvasUndo.at(-1)?.flow===projectId) ui.canvasUndo=[];
  if (details.recipients) details={...details,recipients:Object.fromEntries(Object.entries(details.recipients).filter(([id])=>id!==ui.actor))};
  data.log.unshift({ id:newId(), actor:ui.actor,text,project:projectId,task:item?.id || null,at:new Date().toISOString(),...details });
  save();
}
function recordTask(text,item,details = {}) {
  record(text,item,item.project,details);
}
function announce(message,tone='') {
  const node = document.querySelector('#toast');
  node.dataset.tone=tone;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3900);
}
function header() {
  const location = ui.page === 'area' ? [area(ui.area)?.title, currentProject()?.title].filter(Boolean) : [{mine:'My work', inbox:'Inbox', daily:'Daily log', showroom:'Showroom', ideas:'Ideas', meetings:'Meetings',calendar:'Calendar',profile:'My profile', admin:'Admin', areas:'All areas', workload:'Team workload', templates:'Templates',archive:'Archive',okrs:'OKRs', allgraph:'All work graph'}[ui.page]];
  const isLight = document.documentElement.dataset.theme === 'light';
  return `<header class="topbar">
    ${iconButton('mobile-nav','Toggle navigation','menu','','icon-btn mobile-nav')}
    <div class="breadcrumbs" aria-label="Current location"><span class="home-crumb">Workspace</span><span class="home-sep">${symbol('chevron')}</span>
    ${location.map((part,i) => i===location.length-1 ? `<strong>${esc(part)}</strong>` : `<span>${esc(part)}</span>${symbol('chevron')}`).join('')}</div>
    <div class="top-actions">
      <button type="button" class="btn top-search" data-action="search" aria-label="Search tasks">${symbol('search')} <span>Search tasks</span><kbd>Ctrl K</kbd></button>
      ${iconButton('theme',isLight?'Use dark theme':'Use light theme',isLight?'moon':'sun')}
    </div>
  </header>`;
}
function navButton(action, key, title, mark, active) {
  return `<button class="nav-button ${active ? 'active' : ''}" data-action="${action}" data-value="${key}" type="button" ${active?'aria-current="page"':''}>${symbol(mark)}<span>${esc(title)}</span>${active ? symbol('chevron','nav-arrow') : ''}</button>`;
}
const projectSignalInfo={
  blocked:['lock','Blocked work assigned to you'],
  overdue:['clock','Overdue work assigned to you'],
  ready:['play','Work ready or in progress for you'],
  completed:['check','Completed'],
  failed:['close','Failed'],
  active:['circle','Active project']
};
function projectNavigation(flow,active) {
  const signals=projectSignals(flow,projectTasks(flow.id),ui.actor,{blocked:hasBlockers,overdue:isOverdue});
  const labels=signals.map(signal=>projectSignalInfo[signal][1]).join(' · ');
  return `<button type="button" class="nav-button project-nav-button ${active?'active':''}" data-action="workflow" data-value="${esc(flow.id)}"
    ${active?'aria-current="page"':''} aria-label="${esc(flow.title)}" aria-description="${esc(labels)}" title="${esc(labels)}">
    <span class="project-nav-name">${esc(flow.title)}</span><span class="project-nav-signals" aria-hidden="true">
      ${signals.map(signal=>`<span class="project-signal ${signal}">${symbol(projectSignalInfo[signal][0])}</span>`).join('')}
    </span></button>`;
}
function archivePage() {
  const archived=data.projects.filter(isArchivedProject).sort((a,b)=>(b.completions.at(-1)?.closedAt||'').localeCompare(a.completions.at(-1)?.closedAt||''));
  const areas=[ideaArea,...data.areas].filter(group=>archived.some(flow=>flow.area===group.id));
  const visible=archived.filter(flow=>(!ui.archiveArea||flow.area===ui.archiveArea)&&(!ui.archiveOutcome||flow.state===ui.archiveOutcome));
  const tabs=`<div class="views" role="tablist" aria-label="Archive views">
    ${tab('archive-view','projects','Projects','briefcase',ui.archiveView)}
    ${tab('archive-view','meetings','Meetings','people',ui.archiveView)}${tab('archive-view','tasks','Tasks','checklist',ui.archiveView)}</div>`;
  const heading=hero('Team workspace','Archive','')+tabs;
  if (ui.archiveView==='meetings') return heading+meetingsPanel(true);
  if (ui.archiveView==='tasks') return heading+taskTable(data.tasks.filter(item=>item.archived),true);
  return heading+
    `<div class="archive-filters">
      ${adminSelect('archive-area','Filter archived projects by work area',[['','All work areas'],...areas.map(group=>[group.id,group.title])],ui.archiveArea)}
      ${adminSelect('archive-outcome','Filter archived projects by outcome',[['','All outcomes'],['done','Done'],['failed','Failed']],ui.archiveOutcome)}
    </div>`+
    (visible.length?projectList(visible,'Archived projects'):`<section class="panel empty archive-empty">
      <span class="tile-icon">${symbol('inbox')}</span><h2>${archived.length?'No matching projects':'No archived projects yet'}</h2></section>`);
}

function areaNavigation(group) {
  const flows=data.projects.filter(flow=>flow.area===group.id&&projectInWork(flow));
  const open=ui.expandedAreas.has(group.id);
  const current=(ui.page==='area'&&ui.area===group.id&&!isArchivedProject(currentProject()))||(ui.page==='ideas'&&group.id===ideaArea.id);
  return `<div class="area-nav">
    <div class="area-nav-main ${current?'current-area':''}">
      <button class="nav-button ${current&&!ui.project?'active':''}" data-action="area" data-value="${group.id}" type="button" ${current&&!ui.project?'aria-current="page"':''} aria-label="${esc(group.id===ideaArea.id?group.title:group.title+' · Owner '+(group.lead?ownerName(group.lead):'unassigned'))}">
        ${symbol(group.icon)}<span class="area-name">${esc(group.title)}${group.id===ideaArea.id?'':`<small title="Work area owner">${group.lead?avatar(person(group.lead),'small')+esc(ownerName(group.lead)):'Unassigned'}</small>`}</span></button>
      ${flows.length?`<button class="area-expand icon-btn" type="button" data-action="toggle-area" data-value="${group.id}" aria-label="${open?'Collapse':'Expand'} ${esc(group.title)} projects" aria-expanded="${open}" aria-controls="projects-${group.id}">${symbol(open?'down':'chevron')}</button>`:''}
    </div>
    ${flows.length?`<div class="area-nav-projects" id="projects-${group.id}" ${open?'':'hidden'}>${flows.map(flow=>
      projectNavigation(flow,current&&ui.project===flow.id)).join('')}</div>`:''}
  </div>`;
}
function sidebar() {
  const member = currentActor();
  const unread=inboxEvents().filter(event=>!event.read).length;
  return `<aside class="sidebar ${ui.mobileOpen?'open':''}">
      <div class="brand"><img src="/assets/workspace-v2/assets/graviquest.svg" alt="GraviQuest"><span>Team workspace</span></div>
      <nav aria-label="Workspace navigation">
        <div class="nav-group">
          ${navButton('page','mine','My work','user',ui.page==='mine')}
          <button class="nav-button ${ui.page==='inbox'?'active':''}" data-action="page" data-value="inbox" type="button" ${ui.page==='inbox'?'aria-current="page"':''}>
            ${symbol('inbox')}<span>Inbox</span>${unread?`<span class="unread-count" aria-label="${unread} unread">${unread}</span>`:''}</button>
          ${navButton('page','daily','Daily log','journal',ui.page==='daily')}
          ${navButton('page','calendar','Calendar','timeline',ui.page==='calendar')}
          ${navButton('page','meetings','Meetings','people',ui.page==='meetings')}
          ${navButton('page','workload','Team workload','people',ui.page==='workload')}
          ${navButton('page','okrs','OKRs','target',ui.page==='okrs')}
          ${navButton('page','allgraph','All work graph','flow',ui.page==='allgraph')}
          ${navButton('page','templates','Templates','layout',ui.page==='templates')}
          ${navButton('page','archive','Archive','inbox',ui.page==='archive'||(ui.page==='area'&&isArchivedProject(currentProject())))}
          ${isAdmin() ? navButton('page','admin','Admin','admin',ui.page==='admin') : ''}
        </div>
        <div class="nav-group">
          <div class="eyebrow">Work areas</div>
          ${areaNavigation(ideaArea)}
          ${data.areas.map(areaNavigation).join('')}
        </div>
      </nav>
      <div class="identity"><button class="nav-button" type="button" data-action="page" data-value="profile" aria-label="My profile">
        ${avatar(member,'large')}<span>${esc(member.name)}<small>${esc(roleTitle(member))}</small></span>${symbol('down','nav-arrow')}</button>${iconButton('page','My profile','edit','profile','icon-btn profile-shortcut')}<small class="local-label">${esc(data.workspace.name)}</small></div>
    </aside>`;
}
const pageSymbols={mine:'user',inbox:'inbox',daily:'journal',showroom:'layout',ideas:'light',meetings:'people',calendar:'timeline',profile:'user',workload:'people',templates:'layout',areas:'briefcase',archive:'inbox',okrs:'target',allgraph:'flow'};
function hero(eyebrow, title, description, actions = '') {
  const icon=ui.page==='area'?area(ui.area)?.icon:pageSymbols[ui.page];
  return `<header class="hero workspace-hero"><div class="workspace-hero-title">${icon?`<span class="workspace-emblem">${symbol(icon)}</span>`:''}
    <div class="hero-copy"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${description?`<p>${esc(description)}</p>`:''}</div></div>
    ${actions?`<div class="hero-actions">${actions}</div>`:''}</header>`;
}
function areaPage() {
  const group = area(ui.area);
  const flow = currentProject();
  const items = flow ? projectTasks(flow.id) : [];
  const filtered=sortProjectTasks(items.filter(matchesProjectTask));
  const done = items.filter(item => item.status === 'done').length;
  const flows = data.projects.filter(item => item.area === ui.area&&projectInWork(item));
  const workflowPicker = iconButton('area',group.title+' projects','layout',group.id);
  const createWorkflow = canManageArea(group.id) ? button('new-workflow','New project','plus','primary',group.id) : '';
  if (!flow) {
    if (group.id===ideaArea.id) return ideasPage();
    return workAreaViews(group,flows,createWorkflow);
  }
  const projectOwner=person(flow.owner);
  const hasCanvasItems=items.some(item=>item.status!=='idea')||flow.frames.length||projectNodes(flow).length;
  const idea=flow.area===ideaArea.id?ideaRecord(flow.ideaId):null;
  const navigation=isArchivedProject(flow)?button('page','Archive','inbox','ghost','archive'):workflowPicker;
  const actions = ui.editor?button('editor','Finish editing','check','primary'):
    (ui.linkReturns.at(-1)?.target===flow.id?button('return-linked-node','Back to '+(project(ui.linkReturns.at(-1).source)?.title||'source workflow'),'left','ghost'):'')+
    navigation + (idea&&isActiveProject(flow)?ideaActions(idea):'') +
    (!idea&&isActiveProject(flow)&&flow.id!=='unassigned'?iconButton('project-files','Project files in Nextcloud','file',flow.id):'') +
    (!idea&&isActiveProject(flow)&&isAdmin()?iconButton('project-settings','Project settings','admin',flow.id):'') +
    (canEdit(flow.id)&&(hasCanvasItems||ui.view!=='flow')?button('editor',hasCanvasItems?'Edit workflow':'Build workflow','edit','primary'):'')+
    (canCreateTask(flow.id)?button('new-task','New task','plus',''):'');
  const pendingDecisions=flow.updates?.filter(entry=>entry.decision&&!entry.resolution).length||0;
  return `<header class="project-hero">
    <canvas class="project-gravity" aria-hidden="true"></canvas>
    <div class="hero">
      <div class="project-hero-title"><span class="project-emblem">${symbol(group.icon)}</span><div class="hero-copy">
        <div class="eyebrow">${esc(flow.sample?group.title+' · Sample project':group.title)}</div>
        <h1>${esc(flow.title)}</h1>${flow.description?`<p>${esc(flow.description)}</p>`:''}
      </div></div>
      ${actions?`<div class="hero-actions">${actions}</div>`:''}
    </div>
    <div class="project-meta">${projectStateChip(flow)}
      <span class="project-owner">${avatar(projectOwner,'small')}${projectOwner?esc(projectOwner.name):'Owner unassigned'}</span>
      <span class="progress-pill">${completionDial(done,items.length,done+' of '+items.length+' tasks done')}<strong>${done}/${items.length}</strong> done</span>
      ${idea?ideaStatus(idea)+button('view','Idea notes','message','ghost','idea-notes'):''}${isArchivedProject(flow)?'<span class="status quiet">'+symbol('inbox')+'Archived</span>':''}
      ${flow.ideaSource?button('open-idea','Source idea','light','ghost',flow.ideaSource):''}
      ${pendingDecisions?button('view','Decisions needed · '+pendingDecisions,'alert','project-decisions','updates'):''}
    </div>
    </header>
    ${ui.view!=='flow'?workflowScheduleCard(flow):''}
    <div class="project-viewbar">
      <div class="views project-views" role="tablist" aria-label="Project views">
        ${tab('view','flow','Flowchart','flow',ui.view)}${tab('view','stages','Stages','list',ui.view)}
        ${tab('view','board','Board','board',ui.view)}${tab('view','updates','Milestones & updates','timeline',ui.view)}
        ${tab('view','project-notes','Notes','message',ui.view)}${tab('view','project-report','Project report','journal',ui.view)}
      </div>
      ${extraProjectViews()}
    </div>
    ${!ui.editor&&!['summary','updates','calendar','idea-notes','project-notes','project-report'].includes(ui.view)?projectFilters(items,filtered):''}
    ${ui.view==='idea-notes'&&idea?ideaNotes(idea):ui.view === 'flow' ? canvas(flow,items) + workflowScheduleCard(flow) + (ui.editor||!isActiveProject(flow)?'':nextWork(items.filter(item=>item.owners.includes(ui.actor)))) :
      ui.view==='stages' ? stagesView(flow,items,filtered) : ui.view==='updates' ? projectUpdates(flow) :
      ui.view==='project-notes' ? projectNotes(flow) : ui.view==='project-report' ? projectNotebookPage(flow) :
      ui.view==='calendar' ? calendar.page(ui.calendars.project,'project') : ui.view==='list' ? taskTable(filtered) : ui.view==='summary' ? projectSummary(flow,items) : taskBoard(filtered)}`;
}
const projectCutoff=flow=>flow.scheduleEndTime||'23:59';
function scheduleFinishText(flow,plan) {
  return plan?.finish?`<time datetime="${plan.finish}T${projectCutoff(flow)}">${asDate(plan.finish,true)} · ${projectCutoff(flow)} Tehran</time>`:'Pending';
}
function workflowScheduleCard(flow) {
  const plan=isArchivedProject(flow)&&flow.closedSchedule?flow.closedSchedule:projectSchedules.get(flow.id);
  const label=plan?.invalid?'Check workflow dependencies':plan?.missing?plan.missing+' '+(plan.missing===1?'task needs':'tasks need')+' a duration':
    plan?.unresolvedGates?'Waiting for a linked project schedule':plan?.hasWork?'Finish unavailable':'Add tasks to calculate';
  return `<section class="panel workflow-schedule" aria-label="Workflow schedule">
    <div class="workflow-schedule-cell"><span class="tile-icon">${symbol('clock')}</span><div><small>Total duration</small>
      <strong>${plan?.days!=null?daysLabel(plan.days):label}</strong></div></div>
    <div class="workflow-schedule-cell"><div><small>Project starts</small><strong>${flow.scheduleStart?asDate(flow.scheduleStart,true):'Choose a start date'}</strong></div></div>
    <div class="workflow-schedule-cell"><div><small>Estimated finish</small><strong>${scheduleFinishText(flow,plan)}</strong></div></div>
    ${canManageProject(flow)&&isActiveProject(flow)?iconButton('workflow-schedule','Edit project schedule','edit',flow.id,'icon-btn workflow-schedule-edit'):''}
    <details class="workflow-schedule-details"><summary>${plan?.reviewDays>0?'Includes '+daysLabel(plan.reviewDays)+' for review loops':'How the schedule is calculated'}</summary>
      <p>All calendar days count. The project starts on day one, and the finish uses the end time for the last day. Dependency arrows set the order. Parallel paths and tasks without dependencies can run at the same time. The estimate includes all configured loop repeats, including optional ones.</p>
    </details>
  </section>`;
}
function workAreaViews(group,flows,createWorkflow) {
  const view=ui.areaViews.get(group.id)||'graph';
  const settings=[['graph','Graph','flow'],['stages','Stages','list'],['board','Board','board'],['projects','Projects','briefcase']];
  const items=view==='board'?flows.flatMap(flow=>projectTasks(flow.id)):[];
  const lead=person(group.lead);
  const actions=lead?`<span class="work-area-lead">${avatar(lead,'small')} ${esc(lead.name)}</span>`+createWorkflow:createWorkflow;
  return hero('Work area',group.title,'',actions)+
    `<div class="views work-area-tabs" role="tablist" aria-label="Work area views">${settings.map(([key,title,icon])=>tab('area-view',key,title,icon,view)).join('')}</div>
    <div class="work-area-content">${view==='graph'?networkPanel():view==='board'?taskBoard(items,{areaView:true}):
      view==='stages'?(flows.length?`<div class="area-stages">${flows.map((flow,index)=>`<details class="panel area-stage-project" ${index===0?'open':''}>
        <summary>${symbol('briefcase')}<strong>${esc(flow.title)}</strong>${projectStateChip(flow)}</summary>
        <div class="area-stage-body">${button('workflow','Open project','flow','ghost',flow.id)}${areaProjectStages(flow)}</div>
      </details>`).join('')}</div>`:'<section class="panel empty"><h2>No projects yet</h2></section>'):
      flows.length?projectList(flows):'<section class="panel empty"><h2>No projects yet</h2></section>'}</div>`;
}
function areaProjectStages(flow) {
  const items=projectTasks(flow.id);
  return stagesView(flow,items,items,{areaView:true});
}
const areaDashboard=()=>ui.page==='area'&&!ui.project&&ui.area!==ideaArea.id;
const areaGraph=()=>areaDashboard()&&(ui.areaViews.get(ui.area)||'graph')==='graph';
function networkState() {
  if (!areaGraph()) return ui.allGraph;
  if (!ui.areaGraphs.has(ui.area)) ui.areaGraphs.set(ui.area,newNetworkState());
  return ui.areaGraphs.get(ui.area);
}
function extraProjectViews() {
  const views=[['summary','KPIs & report','journal'],['list','Task list','list'],['calendar','Calendar','timeline']];
  if (currentProject()?.area===ideaArea.id) views.push(['idea-notes','Idea notes','message']);
  const chosen=views.find(([id])=>id===ui.view);
  return `<details class="extra-views">
    <summary aria-label="${chosen?'More project views, '+chosen[1]+' selected':'More project views'}">${symbol(chosen?.[2]||'more')}${chosen?`<span>${chosen[1]}</span>`:''}</summary>
    <div class="extra-view-menu">${views.map(([id,label,icon])=>`<button class="btn ghost" data-action="view" data-value="${id}" type="button" ${ui.view===id?'aria-current="true"':''}>${symbol(icon)}${label}</button>`).join('')}</div>
  </details>`;
}
function projectStateChip(flow) {
  const [label,tone,icon]=({active:['Active','doing','play'],done:['Done','done','check'],failed:['Failed','late','close']})[flow.state]||['Active','doing','play'];
  return `<span class="status ${tone}">${symbol(icon)}${label}</span>`;
}
function projectSummary(flow,items) {
  const owner=person(flow.owner);
  const canAuthor=owner?.id===ui.actor && flow.state==='active';
  const canClose=flow.owner===ui.actor || isAdmin();
  const canEditKpis=canManagePlan(flow);
  const closed=flow.completions.at(-1);
  const report=flow.state!=='active' ? closed : flow.draftReport;
  const totals=report?.tasksAtClose?.filter(entry=>task(entry.id));
  const countText=totals?`${totals.filter(entry=>entry.done).length}/${totals.length} done`:
    rawProjectTasks(flow.id).every(canSeeTask)&&report?`${report.doneCount}/${report.totalCount} done`:'';
  const failed=flow.state==='failed';
  const open=items.filter(item=>item.status!=='done'&&item.status!=='idea').length;
  const complete=items.filter(item=>item.status==='done').length;
  const kpiRows=flow.kpis.map(entry=>{
    const signal=kpiDisplay(entry);
    return `<article class="kpi-card ${signal.tone}">
      <div class="kpi-card-head"><span class="tile-icon">${symbol('target')}</span><h3>${esc(entry.label)}</h3>
        ${canEditKpis?iconButton('edit-kpi','Edit KPI '+entry.label,'edit',entry.id):''}</div>
      <strong class="kpi-current">${esc(entry.result||'—')}</strong>
      <div class="kpi-target"><span>Target</span><b>${esc(entry.direction==='min'?'≥ ':entry.direction==='max'?'≤ ':'')}${esc(entry.target)}</b></div>
      ${signal.progress!==null?`<span class="kpi-meter" role="progressbar" aria-label="Progress to target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(signal.progress)}"><i style="width:${signal.progress}%"></i></span>`:''}
      <footer><span class="status ${signal.tone==='met'?'done':signal.tone==='attention'?'attention':'quiet'}">${symbol(signal.tone==='met'?'check':signal.tone==='attention'?'alert':'circle')}${signal.label}</span>
        ${entry.measuredAt?`<small>Updated ${shortTime(entry.measuredAt)}</small>`:''}</footer>
    </article>`;
  }).join('');
  return `<div class="project-summary">
    <div class="summary-strip panel">
      <span class="summary-stat">${completionDial(complete,complete+open,complete+' of '+(complete+open)+' scheduled tasks done')}<strong>${complete}/${complete+open}</strong><span>Tasks done</span></span>
      <span class="summary-stat">${symbol('target')}<strong>${flow.kpis.filter(entry=>entry.result).length}/${flow.kpis.length}</strong><span>KPI results</span></span>
      <span class="summary-stat">${symbol(report?'journal':'circle')}<strong>${closed&&flow.state!=='active'?'Filed':report?'Drafted':'Pending'}</strong><span>Closing report</span></span>
    </div>
    <section class="panel project-metrics">
      <div class="panel-head"><h2>${symbol('spark')} Project KPIs</h2>${canEditKpis?button('edit-kpi','Add KPI','plus','ghost'):''}</div>
      ${kpiRows?`<div class="kpi-grid">${kpiRows}</div>`:
        `<div class="empty"><p>${canEditKpis?'Add a metric and its target.':owner?`${esc(owner.name)} can add project KPIs.`:'Assign a project owner to add KPIs.'}</p></div>`}
    </section>
    <section class="panel closing-panel">
      <div class="panel-head"><h2>${symbol('journal')} Closing report</h2><div class="closing-downloads">${report?reportControls('project'): ''}${projectStateChip(flow)}</div></div>
      <div class="closing-body">
        ${report?`<div class="closing-meta">${avatar(person(report.author),'small')} <span>${esc(ownerName(report.author))} · ${shortTime(report.closedAt||report.updatedAt)}</span></div>
          ${failed?'<h3 class="failure-report-label">'+symbol('alert')+'Failure note</h3>':''}
          <p class="report-body">${richText(report.body)}</p>
          ${!isActiveProject(flow)&&countText?`<p class="dim">Workflow tasks at closure · ${countText}</p>`:''}`:
          `<p>${owner?`A report from ${esc(owner.name)} is required to move this project to Done.`:'Assign a project owner to start a closing report.'}</p>`}
        ${report && flow.state==='active' && !reportReady(flow)?'<p class="project-note">The current owner needs to save this report before completion.</p>':''}
        ${flow.state==='active'&&open?`<p class="project-note">${open} ${open===1?'task is':'tasks are'} still open.</p>`:''}
        ${flow.state!=='active'&&report?`<p class="dim">Closed by ${esc(ownerName(report.closedBy))}</p>`:''}
        ${canClose||canAuthor?`<div class="closing-actions">
          ${canAuthor?button('write-report',report?'Edit report':'Write report','edit',report?'':'primary'):''}
          ${canClose&&flow.state==='active'?`<button type="button" class="btn ${reportReady(flow)?'primary':''}" data-action="complete-project" ${reportReady(flow)?'':'disabled'}>${symbol('check')}Mark project done</button>`:''}
          ${canClose&&isActiveProject(flow)?button('fail-project','Close as failed','alert','danger-outline'):''}
          ${canClose&&flow.state!=='active'?button('reopen-project','Reopen project','loop'):''}
        </div>`:''}
      </div>
      ${flow.completions.length > (flow.state!=='active'?1:0)?`<details class="report-history"><summary>Earlier reports</summary>
        ${flow.completions.slice(0,flow.state!=='active'?-1:undefined).reverse().map(item=>`<details><summary>${item.outcome==='failed'?'Failed':'Done'} · ${shortTime(item.closedAt)} · ${esc(ownerName(item.author))}</summary><p class="report-body">${esc(item.body)}</p>${reportControls('history-'+item.closedAt)}</details>`).join('')}</details>`:''}
    </section>
  </div>`;
}
function kpiDialog(id) {
  const flow=currentProject();
  if (!canManagePlan(flow)) return;
  const entry=flow.kpis.find(item=>item.id===id);
  editorDialog(entry?'Edit KPI':'Add KPI','kpi-form','target',
    `<input type="hidden" name="id" value="${entry?.id || ''}"><div class="editor-section">${textField('label','Metric',entry?.label,90)}
    ${textField('target','Target',entry?.target,140)}
    ${selectField('direction','Compare results',option('','Show values only',entry?.direction||'')+
      option('min','Result should be at least the target',entry?.direction)+option('max','Result should be at most the target',entry?.direction))}
    <label class="field">Current result<input type="text" name="result" maxlength="160" value="${esc(entry?.result)}"></label>
    ${entry?button('remove-kpi','Remove KPI','trash','ghost',entry.id):''}</div>`,'Save KPI');
}
function saveKpi(form,fields,flow) {
  if (!canManagePlan(flow)) return;
  const entry=flow.kpis.find(item=>item.id===fields.get('id'));
  const label=fields.get('label').trim(), target=fields.get('target').trim(), result=fields.get('result').trim();
  if (!label || !target) return formError(form,'Enter a metric and its target.');
  if (flow.kpis.some(other=>other!==entry&&other.label.toLowerCase()===label.toLowerCase())) return formError(form,'This metric already exists.');
  const direction=['min','max'].includes(fields.get('direction'))?fields.get('direction'):'';
  const measuredAt=result?(entry?.result===result&&entry.measuredAt||new Date().toISOString()):'';
  const updated={id:entry?.id||newId(),label,target,result,direction,measuredAt};
  const kpis=entry?flow.kpis.map(item=>item===entry?updated:item):[...flow.kpis,updated];
  return runWrite(()=>workspaceApi.project(flow,'kpis',{kpis}),()=>dialog.close(),form);
}

function reportDialog() {
  const flow=currentProject();
  if (flow?.owner!==ui.actor || flow.state!=='active') return;
  formDialog('Closing report','report-form',
    `<label class="field">What was delivered?<textarea name="body" rows="6" maxlength="6000" required placeholder="Summarize the outcome, KPI results, and any open handoffs.">${esc(flow.draftReport?.body)}</textarea></label>`,'Save report');
}
function saveReport(form,fields,flow) {
  if (flow?.owner!==ui.actor || flow.state!=='active') return;
  const body=fields.get('body').trim();
  if (!body) return formError(form,'Write the closing report.');
  return runWrite(()=>workspaceApi.project(flow,'report',{body}),()=>dialog.close(),form);
}
function finishProject() {
  const flow=currentProject();
  if (!canManageProject(flow)||!reportReady(flow)) return;
  return runWrite(()=>workspaceApi.project(flow,'done'));
}

function failProjectDialog() {
  const flow=currentProject();
  if (!isActiveProject(flow)||!canManageProject(flow)) return;
  formDialog('Close as failed','failure-form',`<div class="failure-callout">${symbol('alert')}<div><strong>${esc(flow.title)}</strong>
    <p>The project moves to Archive with its workflow, tasks and report.</p></div></div>
    <label class="field">Failure note<textarea name="body" rows="5" maxlength="6000" required placeholder="What prevented the project from succeeding?"></textarea></label>`,'Close as failed');
  dialog.querySelector('[type=submit]').classList.add('danger-primary');
}
function failProject(form,fields,flow) {
  if (!isActiveProject(flow)||!canManageProject(flow)) return;
  const body=fields.get('body').trim();
  if (!body) return formError(form,'Enter a failure note to close the project.');
  return runWrite(()=>workspaceApi.project(flow,'failed',{body}),()=>dialog.close(),form);
}
function reopenProject() {
  const flow=currentProject();
  if (!flow?.canEdit || isActiveProject(flow)) return;
  return runWrite(()=>workspaceApi.project(flow,'reopen'));
}

function builderSelectionBar() {
  const flow=currentProject();
  const keys=[...ui.builderSelection];
  if (!keys.length) return '';
  const current=keys[0];
  const label=keys.length>1?`${keys.length} selected`:selectionName(flow,current);
  const editable=keys.length===1 && ![current.startsWith('dependency:'),current.startsWith('layout:'),current.startsWith('loop:')].some(Boolean);
  const groupable=keys.length>1 && keys.every(key=>task(key)?.project===flow.id);
  return `<div class="selection-bar" aria-label="Selected workflow items">
    <strong>${esc(label)}</strong>
    ${keys.length===1&&task(current)?button('task','Open task','chevron','ghost',current):''}
    ${keys.length===1&&linkedNode(flow,current)?button('view-project-node','Open link','briefcase','ghost',current):''}
    ${editable?button('edit-selection',task(current)?'Edit task':'Edit','edit','ghost'):''}
    ${groupable?button('builder-group','Group','board','ghost'):''}
    ${button('remove-selection','Remove','trash','ghost remove-shape')}</div>`;
}
function builderToolbar() {
  const tool=ui.builderTool;
  return `<div class="editor-bar" aria-label="Workflow builder tools">
    ${iconButton('builder-tool','Select','pointer','select','icon-btn builder-select '+(tool==='select'?'picked':''))}
    <div class="builder-palette">
      <button type="button" class="builder-tool builder-circle" data-action="builder-tool" data-value="place" draggable="true" aria-pressed="${tool==='place'}" title="Drag onto the canvas or select to place"><span class="palette-circle" aria-hidden="true"></span>Task</button>
      <button type="button" class="builder-tool builder-project" data-action="builder-tool" data-value="project" draggable="true" aria-pressed="${tool==='project'}" title="Link an existing project">${symbol('briefcase')}Project</button>
      <button type="button" class="builder-tool builder-rectangle" data-action="builder-tool" data-value="frame" draggable="true" aria-pressed="${tool==='frame'}" title="Draw a rectangle or drag one onto the canvas"><span class="palette-rectangle" aria-hidden="true"></span>Rectangle</button>
      <button type="button" class="builder-tool" data-action="builder-tool" data-value="connect" aria-pressed="${tool==='connect'}" title="Connect two workflow items">${symbol('link')}Arrow</button>
    </div>
    ${ui.canvasUndo.length?iconButton('undo-canvas','Undo','undo'):''}
    ${iconButton('builder-options','More workflow tools','more','','icon-btn builder-more')}
    ${tool!=='select'?`<small>${({place:'Click to place a task.',project:'Click to place a project.',frame:'Drag to draw.',connect:ui.linkStart?'Choose a destination.':'Choose a starting point.',group:'Select tasks to group.',loop:ui.linkStart?'Choose a return task.':'Choose a review task.'})[tool]||''}</small>`:''}
  </div>`;
}
function builderDraftForm() {
  return ui.placement?`<form class="builder-inspector" id="canvas-task-form">
    <span class="palette-${ui.placement.kind==='frame'?'rectangle':'circle'}" aria-hidden="true"></span><label class="field">${ui.placement.kind==='frame'?'Rectangle name':'Task name'} <input type="text" name="title" ${ui.placement.kind==='frame'?'required':''} maxlength="80"></label>
    ${ui.placement.kind==='frame'?'':presetPicker(currentProject())+durationField('',true)+textField('definition','Definition of Done','',160).replace(' required','')}
    <button class="btn primary" type="submit">Add</button>${iconButton('cancel-placement','Cancel placement','close')}
    <p class="form-error" role="alert" hidden></p></form>`:'';
}
function projectFilters(items,matching) {
  const ownerChoices=[['','All owners'],['mine','My tasks'],['unassigned','Unassigned'],
    ...data.team.filter(member=>items.some(item=>item.owners.includes(member.id))).map(member=>[member.id,member.name])];
  const statusChoices=[['','All statuses'],...Object.entries(statuses),['blocked','Blocked']];
  const orders=[['priority','Priority'],['due','Planned finish'],['name','Name']];
  return `<div class="project-filters" aria-label="Filter project tasks">
    <label class="project-search">${symbol('search')}<input type="search" id="project-query" aria-label="Find project tasks" placeholder="Find a task" value="${esc(ui.taskQuery)}" autocomplete="off"></label>
    ${adminSelect('project-owner-filter','Filter project tasks by owner',ownerChoices,ui.ownerFilter||'',false)}
    ${adminSelect('project-status-filter','Filter project tasks by status',statusChoices,ui.taskStatus,false)}
    ${periodFilter('project')}
    ${['flow','list'].includes(ui.view)?'':adminSelect('project-sort','Sort project tasks',orders,ui.taskOrder,false)}
    <span class="filter-count" role="status">${matching.length}${matching.length!==items.length?' of '+items.length:''} tasks</span>
    ${ui.taskQuery||ui.ownerFilter||ui.taskStatus||ui.periods.project?iconButton('clear-project-filters','Clear task filters','close'):''}
  </div>`;
}
function matchesProjectTask(item) {
  if (!inPeriod(item,ui.periods.project)) return false;
  const owner=ui.ownerFilter;
  if (owner==='unassigned'&&item.owners.length) return false;
  if (owner&&owner!=='unassigned'&&!item.owners.includes(owner==='mine'?ui.actor:owner)) return false;
  if (ui.taskStatus && (ui.taskStatus==='blocked'?readableStatus(item)!=='Blocked':item.status!==ui.taskStatus)) return false;
  const query=ui.taskQuery.trim().toLowerCase();
  return !query||item.title.toLowerCase().includes(query);
}
function sortProjectTasks(items) {
  if (ui.taskOrder==='name') return items.sort((a,b)=>a.title.localeCompare(b.title));
  if (ui.taskOrder==='due') return items.sort((a,b)=>(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99')||ranked(a,b));
  return items.sort(ranked);
}
function completionDial(done,total,label) {
  const share=total?Math.round(done/total*100):0;
  return `<span class="completion-dial" style="--share:${share}%" role="img" aria-label="${esc(label)}" title="${esc(label)}">${symbol(done===total&&total?'check':'circle')}</span>`;
}

function stagesView(flow,items,filtered,{areaView=false}={}) {
  const links=projectNodes(flow).map(node=>linkShape(flow,node));
  const byId=new Map([...filtered,...links].map(item=>[item.id,item]));
  const stages=workflowStages(flow,[...items,...links]);
  return `<div class="stages-view" role="tabpanel" aria-label="Stages">
    ${!areaView&&(isAdmin()||flow.owner===ui.actor)&&items.some(item=>item.visibility!=='private')?`<div class="stages-actions">
      ${button('save-template','Save as template','layout','ghost')}
      ${data.templates.some(entry=>entry.templateId)?button('revise-template','Save template revision','layout','ghost'):''}</div>`:''}
    ${byId.size?`<ol class="stage-rail">${stages.map((stage,index)=>{
      const rows=stage.ids.map(id=>byId.get(id)).filter(Boolean);
      if (!rows.length) return '';
      const count=rows.filter(item=>item.status==='done').length;
      const numbered=Number.isFinite(stage.rank);
      const heading=stage.label||(stage.ids.length>1?'Stage '+(stage.rank+1):'');
      return `<li class="stage-stop">
        <span class="stage-beacon ${count===rows.length?'complete':''}" ${numbered?`aria-label="Stage ${stage.rank+1}"`:'aria-hidden="true"'}>${numbered?stage.rank+1:symbol(stage.rank===null?'light':'alert')}</span>
        <section class="panel stage-panel" ${heading?`aria-labelledby="stage-${esc(flow.id)}-${index}"`:`aria-label="Stage ${stage.rank+1}"`}>
          ${heading?`<header class="panel-head"><h2 id="stage-${esc(flow.id)}-${index}">${esc(heading)}</h2>
            ${stage.rank===null?`<span class="stage-count">${rows.length} ${rows.length===1?'idea':'ideas'}</span>`:
              `<span class="stage-count">${completionDial(count,rows.length,count+' of '+rows.length+' tasks done')}${count}/${rows.length}</span>`}</header>`:''}
          <ul class="stage-tasks ${rows.length===1?'single-task':''}">${rows.map(item=>{
            const link=linkedNode(flow,item.id);
            if (link) return `<li class="stage-task linked-stage">${linkedReference(flow,link)}</li>`;
            const pending=blockers(item);
            const when=timing(item);
            const showBlocker=hasBlockers(item)&&isOpen(item);
            return `<li class="stage-task">
              <button type="button" class="stage-task-open cue-${cardCue(item)}" data-action="task" data-value="${esc(item.id)}">
              <span class="stage-task-title"><span class="stage-task-link"><span class="tile-icon">${symbol(item.icon)}</span>${esc(item.title)}</span>${statusChip(item)}</span>
              <span class="stage-task-meta"><span class="stage-owner">${item.owners.map(id=>`<span><i aria-hidden="true">${avatar(person(id),'small')}</i>${esc(ownerName(id))}</span>`).join('')||`<span class="dim">${symbol('user')}Unassigned</span>`}</span>
              ${item.dueDate?`<span class="table-deadline ${when.tone}">${symbol('clock')}${esc(when.due)}</span>`:''}</span></button>
              ${taskLocateIcon(item)}
              ${showBlocker?`<div class="stage-blockers" aria-label="Blockers"><span class="blocker-mark" title="Blocked by">${symbol('lock')}</span>
                ${pending.map(previous=>`<button type="button" data-action="${previous.targetProjectId?'view-project-node':'task'}" data-value="${esc(previous.id)}" class="text-link" aria-label="Blocker: ${esc(previous.title)}">${esc(previous.title)}</button>`).join('')||'<small>Waiting on a prerequisite</small>'}</div>`:''}
            </li>`;
          }).join('')}</ul>
        </section></li>`;
    }).join('')}</ol>`:`<section class="panel empty visual-empty"><span class="tile-icon">${symbol('list')}</span><h2>${items.length?'No matching tasks':'No workflow tasks yet'}</h2></section>`}
  </div>`;
}

function templateDiagram(template,stages) {
  const size=26, gap=68;
  const top=Math.max(1,...stages.map(stage=>stage.ids.length));
  const width=stages.length*gap+18, height=top*size+16;
  const points=new Map(stages.flatMap((stage,i)=>stage.ids.map((id,j)=>[
    id,{x:i*gap+43,y:(height-(stage.ids.length-1)*size)/2+j*size}
  ])));
  const edges=template.edges.map(([a,b])=>[points.get(a),points.get(b)]).filter(([a,b])=>a&&b);
  return `<svg viewBox="0 0 ${width} ${height}" class="template-diagram" aria-hidden="true">
    ${edges.map(([a,b])=>`<path d="M${a.x+7} ${a.y} C${(a.x+b.x)/2} ${a.y} ${(a.x+b.x)/2} ${b.y} ${b.x-7} ${b.y}"/>`).join('')}
    ${stages.map((stage,i)=>stage.ids.map(id=>{
      const p=points.get(id);
      return `<circle cx="${p.x}" cy="${p.y}" r="6" class="${i===0?'first':i===stages.length-1?'last':''}"/>`;
    }).join('')).join('')}
  </svg>`;
}

const templates = () => [...(data.templates||[]).map(entry=>{
  const tasks=entry.tasks.filter(item=>taskRecord(item.id)?.visibility!=='private');
  if (tasks.length===entry.tasks.length) return entry;
  const ids=new Set(tasks.map(item=>item.id));
  const groups=entry.groups.filter(group=>group.members.every(id=>ids.has(id)));
  const shapes=new Set([...ids,...groups.map(group=>groupKey(group.id)),...entry.frames.map(frame=>frameKey(frame.id))]);
  return {...entry,tasks,groups,edges:entry.edges.filter(edge=>edge.every(id=>ids.has(id))),
    loops:entry.loops.filter(loop=>ids.has(loop.from)&&ids.has(loop.to)),
    layoutArrows:entry.layoutArrows.filter(arrow=>shapes.has(arrow.from)&&shapes.has(arrow.to))};
}).filter(entry=>entry.tasks.length)];
let historicalTemplate;
const templateById = id => templates().find(entry=>entry.id===id) || (historicalTemplate?.id===id ? historicalTemplate : undefined);
const canManagePlan = flow => Boolean(flow?.canEdit && flow.state==='active' && (isAdmin()||flow.owner===ui.actor));
function templateOverview(template) {
  const layout=templateFlowLayout(template);
  const {width,height,positions,nodeWidth,nodeHeight,phases,marks,parallel,edges,loops}=layout;
  const taskMap=new Map(template.tasks.map(item=>[item.id,item]));
  const marker=(id)=>`<marker id="template-${id}" viewBox="0 0 10 10" markerWidth="6" markerHeight="6" refX="8" refY="5" orient="auto"><path d="m1 1 7 4-7 4"/></marker>`;
  return `<div class="template-overview" data-template-flow="${esc(template.id)}">
    <div class="template-flow-panel">
      <div class="template-flow-toolbar">
        <div class="template-flow-phases">${phases.map(phase=>button('template-phase',phase.title,'','ghost',String(phase.x))).join('')}</div>
        <div class="tools">
          ${iconButton('template-pan','Scroll workflow left','left','-1')}${iconButton('template-pan','Scroll workflow right','chevron','1')}
          ${button('template-fit','Fit','fit','ghost')}${button('template-reset','100%','','ghost')}
        </div>
      </div>
      <div class="template-flow-viewport" tabindex="0" aria-label="Workflow diagram. Scroll to explore." style="--preview-height:${Math.min(height+3,426)}px">
        <div class="template-flow-sheet" style="width:${width}px;height:${height}px">
          ${phases.map((phase,index)=>`<div class="template-flow-band" style="--phase-hue:${[202,160,264,39][index%4]};left:${phase.x}px;width:${phase.width}px"><strong>${esc(phase.title)}</strong></div>`).join('')}
          ${!phases.length?marks.map(mark=>`<small class="template-flow-stage" style="left:${mark.x}px">${esc(mark.title)}</small>`).join(''):''}
          ${parallel.map(group=>`<div class="template-flow-group" style="left:${group.x}px;top:${group.y}px;width:${group.width}px;height:${group.height}px"><small>${esc(group.title)}</small></div>`).join('')}
          <svg class="template-flow-wires" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
            <defs>${marker('next')}${marker('loop')}</defs>
            ${edges.map(d=>`<path class="template-edge" d="${d}" marker-end="url(#template-next)"/>`).join('')}
            ${loops.map(loop=>`<path class="template-loop" d="${loop.d}" marker-end="url(#template-loop)"/>`).join('')}
          </svg>
          ${[...positions].map(([id,point])=>{
            const item=taskMap.get(id),owners=item.suggestedOwners||[];
            return `<button type="button" class="template-flow-node" data-action="template-node" data-value="${esc(id)}" aria-pressed="false"
              style="left:${point.x}px;top:${point.y}px;width:${nodeWidth}px;min-height:${nodeHeight}px">
              <span class="template-node-icon">${symbol(item.icon)}</span>
              <span class="template-node-name">${esc(item.title)}</span>
              ${owners.length?`<span class="template-node-owners">${memberAvatars(owners)}</span>`:''}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="template-flow-legend"><span class="template-key">${symbol('chevron')} Dependency</span>
        ${loops.length?`<span class="template-key review">${symbol('loop')} Review loop</span>`:''}
        ${parallel.length?`<span class="template-key">${symbol('rectangle')} Parallel work</span>`:''}</div>
    </div>
    <div class="template-node-detail" data-template-detail aria-live="polite" hidden></div>
  </div>`;
}
function templateControl(action,value,trigger) {
  const root=trigger.closest('[data-template-flow]');
  if (!root) return;
  const viewport=root.querySelector('.template-flow-viewport');
  const sheet=root.querySelector('.template-flow-sheet');
  const scale=()=>Number(sheet.style.zoom)||1;
  if (action==='template-fit') {
    sheet.style.zoom=Math.min(1,viewport.clientWidth/sheet.offsetWidth);
    viewport.scrollTo(0,0);
  } else if (action==='template-reset') {
    const left=viewport.scrollLeft/scale();
    const top=viewport.scrollTop/scale();
    sheet.style.zoom=1;viewport.scrollTo(left,top);
  } else if (action==='template-pan') viewport.scrollBy(Number(value)*viewport.clientWidth*.78,0);
  else if (action==='template-phase') {
    if (scale()<.72) sheet.style.zoom=1;
    viewport.scrollTo(Math.max(0,Number(value)*scale()-12),0);
  } else {
    const entry=templateById(root.dataset.templateFlow);
    const chosen=entry?.tasks.find(item=>item.id===value);
    if (!chosen) return;
    const details=root.querySelector('[data-template-detail]');
    const already=trigger.getAttribute('aria-pressed')==='true';
    root.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
    details.hidden=already;
    if (already) return;
    trigger.setAttribute('aria-pressed','true');
    const review=entry.loops.filter(loop=>loop.from===value).map(loop=>{
      const target=entry.tasks.find(item=>item.id===loop.to);
      return target?`${esc(target.title)} · ${loop.target} ${loop.optional?'optional':'required'} passes`:'';
    }).filter(Boolean);
    details.innerHTML=`<strong>${esc(chosen.title)}</strong>
      ${chosen.description?`<p>${esc(chosen.description)}</p>`:''}
      ${review.length?`<p class="template-review-detail">${symbol('loop')} ${review.join(' · ')}</p>`:''}`;
  }
}

function previewTemplate(id) {
  const entry=templateById(id);
  if (!entry) return;
  const versions=entry.templateId?`<div class="form-actions template-preview-actions">
    ${entry.revision>1?button('template-version','Earlier version','left','ghost',String(entry.revision-1)):''}
    <span>Version ${entry.revision} of ${entry.latestRevision}</span>
    ${entry.revision<entry.latestRevision?button('template-version','Later version','right','ghost',String(entry.revision+1)):''}</div>`:'';
  showDialog(entry.name,`${versions}${templateOverview(entry)}<div class="form-actions template-preview-actions">
    ${button('close-dialog','Close','','ghost')}${isAdmin()?button('use-reviewed-template','Use template','plus','primary',id):''}</div>`,'flow');
  dialog.dataset.templatePreview=id;
  dialog.classList.add('template-preview-dialog');
}

async function previewTemplateVersion(number) {
  const current=dialog.dataset.templatePreview;
  const entry=templateById(current);
  if (!entry?.templateId) return;
  try {
    const {template}=await workspaceApi.templateVersion(entry.templateId,number);
    if (!dialog.open||dialog.dataset.templatePreview!==current) return;
    historicalTemplate=template;
    previewTemplate(template.id);
  } catch (error) {
    announce(error.message,'danger');
  }
}

function templatesPage() {
  return hero('Team workspace','Templates','') +
    `<div class="template-grid">${templates().map(template=>{
      const stages=workflowStages(template,template.tasks.map(item=>({...item,status:item.idea?'idea':'backlog'})));
      const stageCount=stages.filter(stage=>stage.rank!==null).length;
      return `<section class="panel template-card">
        <div class="template-map">${templateDiagram(template,stages)}</div><h2>${esc(template.name)}</h2>
        ${template.description?`<p>${esc(template.description)}</p>`:''}
        ${template.revision?`<span class="dim">Version ${template.revision}</span>`:''}
        ${template.area?`<span class="template-scope">${symbol(area(template.area)?.icon)}${esc(area(template.area)?.title)} · ${esc(ownerName(template.owner))}</span>`:''}
        <div class="template-stats"><span>${template.tasks.length} ${template.tasks.length===1?'task':'tasks'}</span><span>${template.frames.length?`${template.frames.length} phases`:`${stageCount} ${stageCount===1?'stage':'stages'}`}</span></div>
        ${button('preview-template','Preview workflow','flow','template-preview-button',template.id)}
      </section>`;
    }).join('')}</div>`+presetLibrary();
}
const basePresets = [
  {id:'preset-video-qa',area:'video',name:'Review cut',title:'Review the cut',
    checklist:['Watch the cut with captions','Verify claims, sources and credits','Log edits with timestamps'],
    dod:['Reviewer records approval or changes requested']},
  {id:'preset-essay-facts',area:'essays',name:'Fact-check',title:'Fact-check the draft',
    checklist:['Verify each citation against the source','Check figures and technical claims'],
    dod:['Claims have a traceable source and open questions are resolved']},
  {id:'preset-lab-qa',area:'lab',name:'Simulation QA',title:'Test the simulation',
    checklist:['Test controls, reset and replay','Check a narrow screen and keyboard navigation','Record the inputs for any unexpected result'],
    dod:['Test results and remaining issues are linked']},
  {id:'preset-pulsar-qa',area:'pulsar',name:'Answer review',title:'Review Pulsar answers',
    checklist:['Check references against the cited material','Review how Pulsar handles uncertainty'],
    dod:['Reviewer records the tested prompts and outcome']}
];
const taskPresets = areaId => [...basePresets,...(data.taskPresets||[])].filter(entry=>!areaId||entry.area===areaId);
const canManagePresets = areaId => isAdmin()||Boolean(areaId&&area(areaId)?.lead===ui.actor);
function presetLibrary() {
  const managed=data.areas.some(group=>group.id.startsWith('area-')&&canManagePresets(group.id));
  return `<section class="panel preset-library" aria-labelledby="preset-library-title">
    <header class="panel-head"><h2 id="preset-library-title">Task presets</h2>${managed?button('edit-preset','New preset','plus','ghost'):''}</header>
    <div class="preset-grid">${taskPresets().map(entry=>`<article class="preset-card">
      <span class="tile-icon">${symbol(area(entry.area)?.icon)}</span><div><small class="dim">${esc(area(entry.area)?.title)}</small><h3>${esc(entry.name)}</h3></div>
      <details><summary>${entry.checklist.length} checklist · ${entry.dod.length} done criteria</summary>
      <ul>${[...entry.checklist,...entry.dod].map(label=>`<li>${esc(label)}</li>`).join('')}</ul></details>
      ${canManagePresets(entry.area)&&data.taskPresets?.includes(entry)?button('edit-preset','Edit','edit','ghost',entry.id):''}
    </article>`).join('')}</div></section>`;
}
function editPreset(id='') {
  const entry=data.taskPresets?.find(preset=>preset.id===id);
  const areas=data.areas.filter(group=>group.id.startsWith('area-')&&canManagePresets(group.id)&&(!entry||entry.area===group.id));
  if (!areas.length||id&&!canManagePresets(entry?.area)) return;
  formDialog(entry?'Edit task preset':'New task preset','task-preset-form',
    `${entry?`<input type="hidden" name="id" value="${entry.id}">`:''}
    ${textField('name','Preset name',entry?.name,60)}
    ${selectField('area','Work area',areas.map(group=>option(group.id,group.title,entry?.area)).join(''))}
    ${textField('title','Suggested task name',entry?.title,80)}
    ${checkEditor('checklist','Checklist',(entry?.checklist||['']).map(label=>({label})))}
    ${checkEditor('dod','Definition of Done',(entry?.dod||['']).map(label=>({label})))}`,'Save preset');
}
function savePreset(form,fields) {
  const group=area(fields.get('area'));
  const entry=data.taskPresets?.find(item=>item.id===fields.get('id'));
  if (!group||!canManagePresets(group.id)||entry&&!canManagePresets(entry.area)) return;
  const name=fields.get('name').trim(),title=fields.get('title').trim();
  if (!name||!title) return formError(form,'Enter a preset name and a suggested task name.');
  if (taskPresets(group.id).some(item=>item!==entry&&item.name.toLowerCase()===name.toLowerCase())) return formError(form,'This work area already has a preset with that name.');
  const labels=key=>fields.getAll(key).map(value=>value.trim()).filter(Boolean);
  return runWrite(()=>workspaceApi.area(group.id,{action:'preset',preset_id:entry?.id,name,title,
    checklist:labels('checklist'),dod:labels('dod')}),()=>dialog.close(),form);
}
function presetPicker(flow) {
  const presets=taskPresets(flow?.area);
  if (!flow||!presets.length) return '';
  return selectField('preset','Task preset',option('','Start from scratch','')+
    presets.map(entry=>option(entry.id,entry.name,'')).join(''));
}
function applyPreset(form) {
  const preset=taskPresets(currentProject()?.area).find(entry=>entry.id===form.elements.preset?.value);
  if (!preset) return;
  if (!form.elements.title.value.trim()) form.elements.title.value=preset.title;
  for (const key of ['checklist','dod']) {
    const rows=form.querySelector(`[data-items="${key}"]`);
    const present=new Set([...rows.querySelectorAll('input')].map(input=>input.value.trim()));
    for (const label of preset[key]) if (!present.has(label)) {
      rows.insertAdjacentHTML('beforeend',checkFieldRow(key,label));present.add(label);
    }
  }
  updateEditorPreview(form);
  announce('Preset checklist and done criteria added.');
}

function saveTemplateDialog() {
  const flow=currentProject();
  if (!flow || !(isAdmin()||flow.owner===ui.actor) || !projectTasks(flow.id).some(item=>item.visibility!=='private')) return;
  formDialog('Save workflow template','template-form',
    textField('name','Template name',flow.title+' workflow')+areaField('description','Description',flow.description)+
    '<p class="dim">New projects get the task structure and checklists. Assign owners and set dates when you plan the new project.</p>',
    'Save template');
}
function reviseTemplateDialog() {
  const flow=currentProject(), saved=templates().filter(entry=>entry.templateId);
  if (!flow||!saved.length||!(isAdmin()||flow.owner===ui.actor)) return;
  formDialog('Save template revision','template-form',
    selectField('template','Template',saved.map(entry=>option(entry.id,entry.name+' · v'+entry.revision)).join(''))+
    areaField('description','Revision description',flow.description),'Save revision');
}
function saveTemplate(form,fields,flow) {
  if (!flow || !(isAdmin()||flow.owner===ui.actor) || !projectTasks(flow.id).some(item=>item.visibility!=='private')) return;
  const entry=templateById(fields.get('template'));
  if (entry?.templateId) {
    return runWrite(()=>workspaceApi.template({project_id:Number(flow.id),template_id:entry.templateId,
      expected_revision:entry.revision,description:fields.get('description').trim()}),({id})=>previewTemplate(id),form);
  }
  const name=fields.get('name')?.trim();
  if (!name) return formError(form,'Enter a template name.');
  if (templates().some(item=>item.name.toLowerCase()===name.toLowerCase())) return formError(form,'A template with this name already exists.');
  return runWrite(()=>workspaceApi.template({project_id:Number(flow.id),name,description:fields.get('description').trim()}),()=>dialog.close(),form);
}

const decisionOutcomes = {
  recorded:{label:'Decision recorded',tone:'quiet',icon:'file'},
  approved:{label:'Approved',tone:'done',icon:'check'},
  changes:{label:'Changes requested',tone:'attention',icon:'edit'},
  rejected:{label:'Rejected',tone:'late',icon:'close'}
};
function decisionBadge(entry) {
  if (!entry.resolution) return {label:'Decision needed',tone:'attention',icon:'alert'};
  return decisionOutcomes[entry.resolution.outcome]||decisionOutcomes.recorded;
}
function milestoneResults(projectId,milestoneId) {
  return [...objectives,northStar].filter(Boolean).flatMap(objective=>objective.results.filter(result=>
    krData(result.id).links.some(link=>link.projectId===projectId&&link.milestoneId===milestoneId))
    .map(result=>({objective,result})));
}
function milestoneOkrPicker(flow,entry) {
  const linked=new Set(entry?milestoneResults(flow.id,entry.id).map(({result})=>result.id):[]);
  return `<details class="reference-shelf" ${linked.size?'open':''}>
    <summary>${symbol('target')} Linked OKRs ${linked.size?'· '+linked.size:''}</summary>
    <input type="search" data-reference-search aria-label="Find an OKR or key result" placeholder="Find a key result">
    ${referenceChoices('milestone-okr',[...objectives,northStar].filter(Boolean).flatMap(objective=>objective.results.map(result=>({
      value:result.id,label:objective.title+' · '+result.label,search:objective.title+' '+result.label,
      content:simpleReference(result.label,objective.title+' · '+metricValue(result.target,result.unit),'target')
    }))),[...linked])}
  </details>`;
}
function openMilestoneResult(value) {
  const [objectiveId,resultId]=value.split('|');
  const item=objectiveById(objectiveId);
  if (!item?.results.some(result=>result.id===resultId)) return;
  Object.assign(ui,{okr:objectiveId,kr:resultId,okrsView:'results',page:'okrs',task:null,editor:false,mobileOpen:false});
  render();focusControl('select-kr',resultId);
}
function projectUpdates(flow) {
  const editable=canManagePlan(flow);
  const milestones=(flow.milestones||[]).slice().sort((a,b)=>Number(a.completed)-Number(b.completed)||a.deadline.localeCompare(b.deadline));
  const updates=flow.updates||[];
  const pending=updates.filter(update=>update.decision && !update.resolution).length;
  return `<div class="project-planning" role="tabpanel" aria-label="Milestones and updates">
    <section class="panel">
      <div class="panel-head"><h2>${symbol('target')} Milestones</h2>${editable?button('milestone','Add milestone','plus','ghost'):''}</div>
      ${milestones.length?`<ul class="planning-list">${milestones.map(entry=>{
        const links=entry.tasks.map(task).filter(item=>item&&!item.archived);
        const okrs=milestoneResults(flow.id,entry.id);
        const complete=links.filter(item=>item.status==='done').length;
        const days=dayIndex(entry.deadline)-dayIndex(today());
        const tone=entry.completed?'done':days<0?'late':days<=2?'attention':'doing';
        const status=entry.completed?'Reached':tone==='late'?'Overdue':tone==='attention'?'Due soon':'Upcoming';
        return `<li class="milestone-row" data-milestone-id="${esc(entry.id)}" tabindex="-1">
          <span class="milestone-diamond ${tone}" aria-hidden="true">${symbol(entry.completed?'check':tone==='late'?'clock':tone==='attention'?'alert':'target')}</span>
          <div class="milestone-detail">
            <div class="planning-title"><h3>${esc(entry.title)}</h3><span class="status ${tone}">${status}</span></div>
            <p class="planning-meta"><time datetime="${esc(entry.deadline)}">${symbol('clock')}${entry.deadline?asDate(entry.deadline,true):'No planned deadline'}</time>
              <span>${entry.owner?avatar(person(entry.owner),'small')+esc(ownerName(entry.owner)):symbol('user')+'Unassigned'}</span></p>
            ${links.length?`<details class="milestone-linked"><summary>${completionDial(complete,links.length,complete+' of '+links.length+' linked tasks done')}${complete}/${links.length} linked tasks</summary>
              <div class="planning-links">${links.map(item=>`<button type="button" class="text-link" data-action="task" data-value="${esc(item.id)}">${symbol(item.status==='done'?'check':item.icon)}${esc(item.title)}</button>`).join('')}</div></details>`:''}
            ${okrs.length?`<div class="milestone-okr-links">${okrs.map(({objective,result})=>button('milestone-open-okr',objective.title+' · '+result.label,'target','ghost',objective.id+'|'+result.id)).join('')}</div>`:''}
            ${editable?`<div class="planning-actions">${iconButton('milestone','Edit milestone','edit',entry.id)}
              ${button('milestone-status',entry.completed?'Reopen':'Mark reached',entry.completed?'loop':'check',entry.completed?'ghost':'ghost mark-reached',entry.id)}</div>`:''}
          </div></li>`;
      }).join('')}</ul>`:`<div class="planning-empty visual-empty"><span class="tile-icon">${symbol('target')}</span><p>No milestones yet</p></div>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${symbol('message')} Updates</h2>${editable?button('project-update','Post update','plus','ghost'):''}</div>
      ${pending?`<div class="decisions-count">${symbol('alert')}${pending} ${pending===1?'decision':'decisions'} needed</div>`:''}
      ${updates.length?`<ul class="planning-list">${updates.map(entry=>{const badge=decisionBadge(entry);return `<li data-project-update="${esc(entry.id)}" tabindex="-1">
        <div class="update-meta">${avatar(person(entry.author),'small')} <strong>${esc(ownerName(entry.author))}</strong> <time datetime="${esc(entry.at)}">${shortTime(entry.at)}</time></div>
        <p class="update-body">${esc(entry.body)}</p>
        ${entry.decision?`<div class="decision-box ${badge.tone}">
          <span class="status ${badge.tone}">${symbol(badge.icon)}${badge.label}</span>
          <p>${esc(entry.decision)}</p>
          ${entry.decider&&!entry.resolution?`<span class="decision-owner">${avatar(person(entry.decider),'small')}${esc(ownerName(entry.decider))}</span>`:''}
          ${entry.resolution?`<div class="decision-resolution"><strong>${esc(ownerName(entry.resolution.by))}</strong><p>${esc(entry.resolution.body)}</p></div>`:
            canResolveDecision(flow,entry)?button('resolve-decision','Record decision','check','ghost',entry.id):''}
        </div>`:''}
      </li>`;}).join('')}</ul>`:`<div class="planning-empty visual-empty"><span class="tile-icon">${symbol('message')}</span><p>No updates yet</p></div>`}
    </section>
  </div>`;
}
function milestoneDialog(id,flow=currentProject()) {
  if (!canManagePlan(flow)) return;
  const entry=(flow.milestones||[]).find(row=>row.id===id);
  if (id&&!entry) return;
  const candidates=projectTasks(flow.id).filter(item=>item.status!=='idea'||entry?.tasks.includes(item.id));
  formDialog(entry?'Edit milestone':'Add milestone','milestone-form',
    `<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="project-id" value="${esc(flow.id)}">`+
    textField('title','Milestone name',entry?.title)+
    `<label class="field">Deadline<input type="date" name="deadline" value="${esc(entry?.deadline)}" required></label>`+
    selectField('owner','Milestone owner',data.team.map(member=>option(member.id,member.name,entry?entry.owner:flow.owner)).join(''))+
    (candidates.length?visualTaskChoices('milestone-task','Linked tasks',candidates,entry?.tasks):'')+
    milestoneOkrPicker(flow,entry)+'<div data-schedule-impact hidden></div>',entry?'Save milestone':'Add milestone');
}
function saveMilestone(form,fields,flow) {
  if (!canManagePlan(flow)) return;
  const id=fields.get('id');
  const entry=(flow.milestones||[]).find(row=>row.id===id);
  if (id&&!entry) return;
  const title=fields.get('title').trim();
  const deadline=fields.get('deadline');
  if (!title || !deadline || !Number.isFinite(dayIndex(deadline))) return formError(form,'Enter a milestone name and deadline.');
  const items=projectTasks(flow.id);
  const requested=fields.getAll('milestone-task');
  const tasks=items.filter(item=>requested.includes(item.id)).map(item=>item.id);
  const owner=person(fields.get('owner'))?.id || '';
  if (!owner) return formError(form,'Choose a milestone owner.');
  const impact=milestoneScheduleImpact(items,tasks,deadline);
  if (entry && deadline!==entry.deadline && reviewSchedule(form,[id,deadline,...tasks],
    `<p>${displayDateChange(entry.deadline,deadline)}</p>`+
    impactRows('Linked tasks',impact.linked,impact.conflicts,item=>item.dueDate||item.startDate)+
    (impact.conflicts.length?'<p>Highlighted tasks are scheduled after this milestone.</p>':'<p>No linked task is scheduled after this milestone.</p>'))) return;
  runWrite(()=>workspaceApi.milestone(flow,entry,{title,due_date:deadline,owner_id:Number(owner),task_ids:tasks.map(Number),
    result_ids:fields.getAll('milestone-okr').filter(resultById).map(Number)}),()=>dialog.close(),form);
}
function toggleMilestone(id) {
  const flow=currentProject();
  if (!canManagePlan(flow)) return;
  const entry=(flow.milestones||[]).find(row=>row.id===id);
  if (!entry) return;
  runWrite(()=>workspaceApi.milestone(flow,entry,{completed:!entry.completed}));
}
function postUpdateDialog() {
  const flow=currentProject();
  if (!canManagePlan(flow)) return;
  formDialog('Post project update','project-update-form',
    '<label class="field">Short update<textarea name="body" maxlength="500" required></textarea></label>'+
    '<label class="field">Decision needed (optional)<textarea name="decision" maxlength="280"></textarea></label>'+
    selectField('decider','Decision owner',option('','Unassigned','')+data.team.map(member=>option(member.id,member.name,'')).join('')),
    'Post update');
}
function saveProjectUpdate(form,fields,flow) {
  if (!canManagePlan(flow)) return;
  const body=fields.get('body').trim(), decision=fields.get('decision').trim();
  const decider=person(fields.get('decider'))?.id || '';
  if (!body) return formError(form,'Write a short update.');
  if (decider&&!decision) return formError(form,'Describe the decision for the selected owner.');
  runWrite(()=>workspaceApi.project(flow,'post_update',{body,decision,decider_id:decider?Number(decider):null}),
    ()=>dialog.close(),form);
}
const canResolveDecision = (flow,entry) => Boolean(flow?.state==='active'&&entry?.decision&&!entry.resolution&&
  (isAdmin()||flow.owner===ui.actor||entry.decider===ui.actor));
function resolveDecisionDialog(id,flow=currentProject()) {
  const entry=flow?.updates?.find(row=>row.id===id);
  if (!canResolveDecision(flow,entry)) return;
  formDialog('Record decision','decision-form',`<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="project-id" value="${esc(flow.id)}">
    <p>${esc(entry.decision)}</p>
    ${selectField('outcome','Outcome',Object.entries(decisionOutcomes).map(([key,result])=>option(key,result.label,'recorded')).join(''))}
    <label class="field">Decision<textarea name="body" maxlength="500" required></textarea></label>`,'Record decision');
}
function resolveDecision(form,fields,flow) {
  const entry=flow?.updates?.find(row=>row.id===fields.get('id'));
  if (!canResolveDecision(flow,entry)) return;
  const body=fields.get('body').trim();
  if (!body) return formError(form,'Enter the decision before recording it.');
  const outcome=fields.get('outcome');
  if (!Object.hasOwn(decisionOutcomes,outcome)) return formError(form,'Choose a decision outcome.');
  runWrite(()=>workspaceApi.project(flow,'resolve_decision',{body,outcome,update_id:entry.id}),()=>dialog.close(),form);
}

function focusControl(action,value) {
  [...app.querySelectorAll('[data-action="'+action+'"]')].find(el=>el.dataset.value===value)?.focus({preventScroll:true});
}
const krData = id => data.okrs.results[id]||{checkIns:[],links:[]};
const krEdit = id => isAdmin()||data.okrs.owners[id]===ui.actor||
  [...objectives,northStar].filter(Boolean).some(objective=>objective.results.some(kr=>kr.id===id)&&data.okrs.owners[objective.id]===ui.actor);
const roadmapLink = slide => `<a class="btn ghost" href="${roadmapUrl}#${slide}" target="_blank" rel="noopener noreferrer">${symbol('globe')} Roadmap</a>`;
function openOkr(id) {
  const item=objectiveById(id);
  Object.assign(ui,{okr:item?.id||'',kr:item?.results[0]?.id||'',okrsView:'results',page:'okrs',task:null,editor:false,mobileOpen:false});
  render();app.querySelector('main h1')?.focus({preventScroll:true});
}
function krSummary(kr) {
  const value=(krData(kr.id).checkIns.at(-1)?.value ?? krData(kr.id).current);
  const percent=resultProgress(kr,value,krData(kr.id).baseline);
  return `<span class="okr-progress" aria-label="${percent===null?'Awaiting first check-in':Math.round(percent)+'% of target'}"><i style="width:${percent||0}%"></i></span>
    <strong class="okr-value">${metricValue(value,kr.unit)} <small>/ ${metricValue(kr.target,kr.unit)}</small></strong>`;
}
function okrPage() {
  const active=objectiveById(ui.okr);
  if (!active) {
    const north=northStar?.results[0];
    return hero('Team workspace','OKRs','Six-month roadmap',roadmapLink(57))+
      (north?`<section class="okr-north panel">
        <span class="okr-north-mark">${symbol('target')}</span><div><small>North Star · End of month six</small>
        <h2>${esc(northStar.title)}</h2><p>${esc(northStar.subtitle)}</p></div><div class="okr-north-measure">${krSummary(north)}</div>
        ${button('open-okr','Open North Star','target','ghost',northStar.id)}</section>`:'')+
      `
      <div class="okr-overview">${objectives.map(item=>{
        const reached=item.results.filter(kr=>(krData(kr.id).checkIns.at(-1)?.value ?? krData(kr.id).current)>=kr.target).length;
        const measured=item.results.filter(kr=>krData(kr.id).checkIns.length).length;
        const owner=person(data.okrs.owners[item.id]);
        return `<article class="panel okr-overview-card"><span class="tile-icon">${symbol('target')}</span><h2>${esc(item.title)}</h2><p>${esc(item.subtitle)}</p>
          <div class="okr-card-meta"><span>${reached}/${item.results.length} at target · ${measured} measured</span>${owner?avatar(owner,'small'):''}</div>
          ${button('open-okr','Open '+item.title,'target','ghost',item.id)}</article>`;
      }).join('')}</div>`;
  }
  const selected=active.results.find(kr=>kr.id===ui.kr)||active.results[0];
  if (!selected) return hero('Roadmap',active.title,active.subtitle,button('open-okr','All OKRs','left','ghost'))+'<p class="empty">No key results yet.</p>';
  const info=krData(selected.id), latest=info.checkIns.at(-1);
  const own=person(data.okrs.owners[active.id]);
  const keyOwner=person(data.okrs.owners[selected.id]);
  const links=info.links.map(entry=>({entry,flow:project(entry.projectId)})).filter(item=>item.flow);
  const milestones=active.results.flatMap(kr=>krData(kr.id).links).filter(link=>link.milestoneId)
    .map(link=>({flow:project(link.projectId),id:link.milestoneId})).map(entry=>({...entry,milestone:entry.flow?.milestones?.find(m=>m.id===entry.id)}))
    .filter(entry=>entry.milestone);
  const timeline=[...new Map(milestones.map(item=>[item.flow.id+':'+item.id,item])).values()]
    .sort((a,b)=>a.milestone.deadline.localeCompare(b.milestone.deadline));
  return hero('Six-month roadmap',active.title,active.subtitle,button('open-okr','All OKRs','left','ghost')+roadmapLink(57))+
    `<section class="okr-detail-top panel"><span class="tile-icon">${symbol('target')}</span>
      <div><strong>${esc(own?.name||'Unassigned')}</strong><small>Objective owner</small></div>
      ${isAdmin()?button('okr-edit-owner','Assign owner','user','ghost',active.id):''}</section>
    <div class="views" role="tablist" aria-label="OKR views">${tab('okr-view','results','Overview','target',ui.okrsView)}${tab('okr-view','checkins','Check-ins','clock',ui.okrsView)}</div>
    <div class="okr-layout">
      <div class="okr-main">
        <section class="panel okr-results"><div class="panel-head"><h2>Key results</h2></div>
          ${active.results.map(kr=>`<button type="button" class="okr-result" aria-pressed="${selected.id===kr.id}" data-action="select-kr" data-value="${kr.id}">
            <span><strong>${esc(kr.label)}</strong>${data.okrs.owners[kr.id]?`<small>${esc(ownerName(data.okrs.owners[kr.id]))}</small>`:''}</span>${krSummary(kr)}</button>`).join('')}</section>
        ${ui.okrsView==='results'?`<section class="panel okr-milestones">
          <div class="panel-head"><h2>${symbol('timeline')} Milestones</h2></div>
          ${timeline.length?`<ol>${timeline.map(({flow,milestone})=>`<li><button class="okr-milestone" type="button" data-action="okr-project-milestone" data-value="${esc(flow.id+'|'+milestone.id)}">
            <span class="okr-diamond ${milestone.completed?'reached':milestone.deadline<today()?'overdue':''}">${symbol(milestone.completed?'check':'target')}</span>
            <small>${milestone.deadline?asDate(milestone.deadline,true):'No planned deadline'} · ${milestone.completed?'Reached':milestone.deadline<today()?'Overdue':'Upcoming'}</small>
            <strong>${esc(milestone.title)}</strong><span>${esc(flow.title)}</span></button></li>`).join('')}</ol>`:'<p class="detail-empty">Link existing project milestones to a key result to see them here.</p>'}</section>`:
          `<section class="panel okr-milestones"><div class="panel-head"><h2>Check-ins for ${esc(selected.label)}</h2></div>
            ${info.checkIns.length?`<div class="okr-history">${info.checkIns.slice().reverse().map(check=>`<article><strong>${metricValue(check.value,selected.unit)}</strong>
              <small>${esc(ownerName(check.actor))} · ${shortTime(check.at)}</small>${check.note?`<p>${richText(check.note)}</p>`:''}</article>`).join('')}</div>`:
            '<p class="detail-empty">No check-ins for this result yet.</p>'}</section>`}
      </div>
      <aside class="panel okr-inspector" aria-label="Selected key result">
        <div class="panel-head"><h2>${esc(selected.label)}</h2></div>
        ${selected.detail?`<p class="dim">${esc(selected.detail)}</p>`:''}
        <dl><div><dt>Owner</dt><dd>${esc(keyOwner?.name||own?.name||'Unassigned')}</dd></div>
          <div><dt>Baseline</dt><dd>${metricValue(info.baseline,selected.unit)}</dd></div>
          <div><dt>Current</dt><dd>${metricValue(latest?.value ?? info.current,selected.unit)}</dd></div>
          <div><dt>Target</dt><dd>${metricValue(selected.target,selected.unit)}</dd></div></dl>
        <div class="okr-inspector-actions">${krEdit(selected.id)?button('okr-check-in','Log check-in','edit','primary',selected.id)+button('okr-link','Link work','link','ghost',selected.id):''}
          ${isAdmin()?button('okr-edit-owner','Assign result owner','user','ghost',selected.id):''}</div>
        <h3>Linked work</h3>${links.length?links.map(({entry,flow})=>{
          const milestone=flow.milestones?.find(item=>item.id===entry.milestoneId);
          return `<div class="okr-link-row">
            <button type="button" class="reference-tile" data-action="${milestone?'okr-project-milestone':'workflow'}" data-value="${esc(milestone?flow.id+'|'+milestone.id:flow.id)}">
              ${simpleReference(milestone?.title||flow.title,milestone?flow.title:area(flow.area)?.title||'Project',milestone?'target':'briefcase')}
            </button>${krEdit(selected.id)?iconButton('okr-unlink','Remove OKR link','close',selected.id+'|'+entry.projectId+'|'+(entry.milestoneId||'')):''}</div>`;
        }).join(''):'<p class="dim">No linked projects or milestones yet.</p>'}</aside>
    </div>`;
}
function ensureKrData(id) {
  return data.okrs.results[id]||={checkIns:[],links:[]};
}
function okrCheckInDialog(id) {
  const result=resultById(id);
  if (!result||!krEdit(id)) return;
  formDialog('Log check-in','okr-check-in-form',`<input type="hidden" name="id" value="${esc(id)}">
    <p class="dim">${esc(result.label)} · Target ${metricValue(result.target,result.unit)}</p>
    <label class="field">Current value${result.unit?' ('+esc(result.unit)+')':''}<input type="number" name="value" min="0" step="any" required value="${esc(krData(id).checkIns.at(-1)?.value)}"></label>
    <details class="editor-disclosure"><summary>Baseline</summary>
      <label class="field">Starting value<input type="number" name="baseline" min="0" step="any" value="${esc(krData(id).baseline)}"></label>
    </details>${areaField('note','Evidence or note')}`,'Save check-in');
}
function saveOkrCheckIn(form,fields) {
  const id=fields.get('id'),value=Number(fields.get('value'));
  if (!resultById(id)||!krEdit(id)) return;
  if (fields.get('value')===''||!Number.isFinite(value)||value<0) return formError(form,'Enter a valid non-negative value.');
  const baseline=fields.get('baseline')===''?null:Number(fields.get('baseline'));
  if (baseline!==null&&(!Number.isFinite(baseline)||baseline<0)) return formError(form,'Enter a valid non-negative baseline.');
  return runWrite(()=>workspaceApi.result(id,'check_in',{value,baseline,note:fields.get('note').trim()}),()=>dialog.close(),form);
}
function okrOwnerDialog(id) {
  if (!isAdmin()||!objectiveById(id)&&!resultById(id)) return;
  formDialog('Assign OKR owner','okr-owner-form',`<input type="hidden" name="id" value="${esc(id)}">
    ${selectField('owner','Owner',data.team.map(member=>option(member.id,member.name,data.okrs.owners[id])).join(''))}`,'Save owner');
}
function saveOkrOwner(form,fields) {
  const id=fields.get('id'),owner=person(fields.get('owner'));
  if (!isAdmin()||!objectiveById(id)&&!resultById(id)) return;
  if (!owner) return formError(form,'Choose a team member.');
  const objective=Boolean(objectiveById(id));
  return runWrite(()=>workspaceApi.okrOwner(objective?'objective':'result',objective?id.slice('objective-'.length):id,
    Number(owner.id)),()=>dialog.close(),form);
}
function okrLinkDialog(id) {
  if (!resultById(id)||!krEdit(id)) return;
  const flows=data.projects.slice().sort((a,b)=>a.title.localeCompare(b.title));
  formDialog('Link a project or milestone','okr-link-form',`<input type="hidden" name="id" value="${esc(id)}">
    <label class="field">Project or milestone<select name="reference" required>${option('','Choose linked work','')}${flows.map(flow=>`<optgroup label="${esc(flow.title)}">
      ${option(flow.id+'|','Project · '+flow.title)}${(flow.milestones||[]).map(item=>option(flow.id+'|'+item.id,'Milestone · '+item.title)).join('')}</optgroup>`).join('')}</select></label>`,'Link work');
}
function saveOkrLink(form,fields) {
  const id=fields.get('id'),[projectId,milestoneId]=fields.get('reference').split('|');
  if (!resultById(id)||!krEdit(id)) return;
  const flow=project(projectId);
  if (!flow||milestoneId&&!flow.milestones?.some(item=>item.id===milestoneId)) return formError(form,'Choose an available project or milestone.');
  return runWrite(()=>workspaceApi.result(id,'link',{project_id:Number(projectId),milestone_id:milestoneId?Number(milestoneId):null}),()=>dialog.close(),form);
}
function removeOkrLink(value) {
  const [id,projectId,milestoneId]=value.split('|');
  if (!resultById(id)||!krEdit(id)) return;
  return runWrite(()=>workspaceApi.result(id,'unlink',{project_id:Number(projectId),milestone_id:milestoneId?Number(milestoneId):null}));
}
function openOkrMilestone(value) {
  const [id,milestone]=value.split('|');
  openProject(id,null,'updates');
  const row=[...app.querySelectorAll('[data-milestone-id]')].find(el=>el.dataset.milestoneId===milestone);
  row?.scrollIntoView({block:'center'});row?.focus({preventScroll:true});
}

const graphTypes={okr:['OKR','target'],area:['Work area','layout'],project:['Project','briefcase'],task:['Task','circle']};
function graphContent() {
  const state=networkState(), nodes=[],edges=[];
  const scope=areaGraph()?ui.area:null;
  const groups=scope?data.areas.filter(group=>group.id===scope):[ideaArea,...data.areas];
  for (const group of groups) nodes.push({key:'area:'+group.id,id:group.id,kind:'area',title:group.title,owners:group.lead?[group.lead]:[],area:group.id});
  const byProject=Map.groupBy(data.tasks.filter(item=>canSeeTask(item)&&(state.archived||!item.archived)),item=>item.project);
  for (const flow of data.projects) {
    if (!state.archived&&isArchivedProject(flow)) continue;
    const areaKey='area:'+flow.area;
    const projectKey='project:'+flow.id;
    if (!groups.some(group=>group.id===flow.area)) continue;
    nodes.push({key:projectKey,id:flow.id,kind:'project',title:flow.title,parent:areaKey,area:flow.area,
      owners:flow.owner?[flow.owner]:[],description:flow.description,status:flow.state});
    edges.push({from:areaKey,to:projectKey,type:'membership'});
    for (const item of byProject.get(flow.id)||[]) {
      const key='task:'+item.id;
      nodes.push({key,id:item.id,kind:'task',title:item.title,parent:projectKey,area:flow.area,
        owners:item.owners,description:item.description,context:flow.title,status:item.archived?'Archived':readableStatus(item)});
      edges.push({from:projectKey,to:key,type:'membership'});
    }
  }
  for (const objective of [northStar,...objectives].filter(Boolean)) {
    const linked=new Set(objective.results.flatMap(result=>krData(result.id).links).map(link=>link.projectId));
    const linkedAreas=[...linked].map(id=>project(id)?.area).filter(Boolean);
    if (scope&&!linkedAreas.includes(scope)) continue;
    nodes.push({key:'okr:'+objective.id,id:objective.id,kind:'okr',title:objective.title,
      owners:data.okrs.owners[objective.id]?[data.okrs.owners[objective.id]]:[],areas:linkedAreas,description:objective.subtitle});
    for (const id of linked) edges.push({from:'okr:'+objective.id,to:'project:'+id,type:'contribution'});
  }
  return {nodes,edges};
}
function graphSelection(content) {
  const state=networkState();
  const matches=node=>(!state.area||node.area===state.area||node.areas?.includes(state.area))&&
    (!state.owner||node.owners.includes(state.owner))&&(!state.type||node.kind===state.type);
  const query=state.query.trim().toLocaleLowerCase();
  const matchesQuery=node=>!query||[node.title,graphTypes[node.kind][0],area(node.area)?.title].some(value=>value?.toLocaleLowerCase().includes(query));
  const matching=content.nodes.filter(node=>matches(node)&&matchesQuery(node));
  const focused=content.nodes.find(node=>node.key===state.focus);
  if (focused) {
    const related=new Set([focused.key]);
    for (const edge of content.edges) {
      if (edge.from===focused.key) related.add(edge.to);
      if (edge.to===focused.key) related.add(edge.from);
    }
    const nodes=content.nodes.filter(node=>related.has(node.key)&&(node.key===focused.key||matches(node)));
    return {nodes,matching,focused};
  }
  return {nodes:matching,matching};
}
function allGraphPage() {
  return hero('Team workspace','All work graph','')+networkPanel();
}
function networkPanel() {
  const state=networkState();
  return `<section class="panel network-shell" aria-label="All work relationship graph">
      <div class="network-toolbar">
        <label class="sr-only" for="network-search">Search the graph</label><input type="search" id="network-search" value="${esc(state.query)}" placeholder="Search work">
        ${adminSelect('network-type','Filter graph by node type',[['','All types'],...Object.entries(graphTypes).map(([key,value])=>[key,value[0]])],state.type)}
        ${!areaGraph()?adminSelect('network-area','Filter graph by work area',[['','All areas'],...[ideaArea,...data.areas].map(group=>[group.id,group.title])],state.area):''}
        ${adminSelect('network-owner','Filter graph by owner',[['','All owners'],...data.team.map(member=>[member.id,member.name])],state.owner)}
        <label class="network-archived"><input type="checkbox" id="network-inspect" ${state.inspect?'checked':''}> Focus on click</label>
        <label class="network-archived"><input type="checkbox" id="network-archived" ${state.archived?'checked':''}> Include archive</label>
        <div class="network-zoom-tools">${button('network-fit','Fit graph','fit','ghost')}${iconButton('network-zoom','Zoom out','minus','-1')}${iconButton('network-zoom','Zoom in','plus','1')}</div>
      </div>
      <div id="network-content">${graphBody()}</div>
    </section>`;
}
function graphBody() {
  const content=graphContent(),state=networkState();
  const {nodes,matching,focused}=graphSelection(content);
  if (!nodes.length) return '<p class="detail-empty" role="status">No matching work.</p>';
  const subset=!focused&&nodes.length!==content.nodes.length;
  const layout=focused?focusedLayout(nodes,focused.key):subset?filterGraphLayout(nodes):relationshipLayout(nodes);
  const positions=new Map(layout.nodes.map(node=>[node.key,node]));
  const byKey=new Map(content.nodes.map(node=>[node.key,node]));
  const primary=focused||matching.find(node=>node.key===state.selected);
  const edges=content.edges.filter(edge=>positions.has(edge.from)&&positions.has(edge.to));
  const zoom=state.zoom/100;
  return `<div class="network-context">${focused?
      button('network-focus','Clear focus','close','ghost')+'<strong>'+esc(focused.title)+'</strong>':'<small>'+nodes.length+' nodes</small>'}
      <span>${state.zoom}%</span></div>
    ${state.query.trim()?`<div class="network-matches" aria-label="Graph search matches">${matching.slice(0,24).map(node=>
      button('network-reveal',[node.title,byKey.get(node.parent)?.title].filter(Boolean).join(' · '),graphTypes[node.kind][1],'ghost',node.key)).join('')||'<small>No search matches</small>'}</div>`:''}
    <div class="network-grid">
      <div class="network-viewport" tabindex="0" role="region" aria-label="Graph canvas. Scroll or drag empty space to explore.">
        <div class="network-space" style="width:${layout.width*zoom}px;height:${layout.height*zoom}px">
          <div class="network-world" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom})">
            ${layout.clusters.map(item=>`<div class="network-cluster" style="left:${item.left}px;top:${item.top}px;width:${item.width}px;height:${item.height}px"></div>`).join('')}
            <svg class="network-lines" width="${layout.width}" height="${layout.height}" aria-hidden="true">
              ${edges.map(edge=>{
                const from=positions.get(edge.from),to=positions.get(edge.to);
                return `<line class="${edge.type}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
              }).join('')}</svg>
            ${layout.nodes.map(node=>`<button type="button" data-action="network-node" data-value="${esc(node.key)}"
              class="network-node kind-${node.kind} ${primary?.key===node.key?'selected':''}" style="left:${node.x}px;top:${node.y}px"
              aria-label="${esc([graphTypes[node.kind][0],node.title,node.context].filter(Boolean).join(' · '))}" title="${esc([node.title,node.context].filter(Boolean).join(' · '))}">
              <span class="network-node-mark">${symbol(graphTypes[node.kind][1])}</span><strong>${esc(node.title)}</strong>${node.context?`<small class="network-task-project">${esc(node.context)}</small>`:''}</button>`).join('')}
          </div>
        </div>
      </div>
      <aside class="network-inspector" aria-label="Graph selection">
        ${primary?`<div class="network-selection"><small>${graphTypes[primary.kind][0]}</small><h2>${esc(primary.title)}</h2>
          ${primary.context?`<small class="network-project-context">${symbol('briefcase')}${esc(primary.context)}</small>`:''}
          ${primary.status?`<span class="status">${esc(primary.status)}</span>`:''}
          ${primary.owners.length?`<div class="network-owners">${memberAvatars(primary.owners)} ${esc(primary.owners.map(ownerName).join(', '))}</div>`:''}
          ${primary.description?`<p class="dim">${esc(primary.description)}</p>`:''}
          ${button('network-open','Open '+graphTypes[primary.kind][0].toLowerCase(),graphTypes[primary.kind][1],'primary',primary.key)}
          ${primary.kind==='task'?button('task-to-meeting','Add to meeting','people','ghost',primary.id):''}
          ${!focused?button('network-focus','Focus connections','search','ghost',primary.key):''}</div>`:''}
        <div class="network-legend"><strong>Node types</strong>${Object.entries(graphTypes).map(([kind,[label,icon]])=>
          `<span class="kind-${kind}"><i>${symbol(icon)}</i>${label}</span>`).join('')}
          <strong>Connections</strong><span><i class="network-line-mark"></i>Belongs to</span>
          <span><i class="network-line-mark contribution"></i>Supports an OKR</span></div></aside>
    </div>`;
}
function filterGraphLayout(nodes) {
  const width=960, max=5;
  return {nodes:nodes.map((node,i)=>({...node,x:108+i%max*183,y:72+Math.floor(i/max)*88})),
    clusters:[],width,height:Math.max(410,Math.ceil(nodes.length/max)*88+70)};
}
function refreshNetwork({center=false}={}) {
  const parent=app.querySelector('#network-content');
  if (!parent) return;
  const old=parent.querySelector('.network-viewport'),xy=old&&[old.scrollLeft,old.scrollTop];
  parent.innerHTML=graphBody();
  const view=parent.querySelector('.network-viewport');
  if (!view) return;
  if (center) {
    const node=view.querySelector('.network-node.selected');
    if (node) {
      const box=node.getBoundingClientRect(),viewport=view.getBoundingClientRect();
      view.scrollBy(box.left+box.width/2-viewport.left-viewport.width/2,box.top+box.height/2-viewport.top-viewport.height/2);
      node.focus({preventScroll:true});
    }
  } else if (xy) view.scrollTo(...xy);
  bindNetwork(view);
}
function bindNetwork(view) {
  if (!view) return;
  let drag;
  view.addEventListener('pointerdown',event=>{
    if (event.button!==0||event.pointerType==='touch'||event.target.closest('button')) return;
    drag={x:event.clientX,y:event.clientY,left:view.scrollLeft,top:view.scrollTop};
    view.setPointerCapture(event.pointerId);
  });
  view.addEventListener('pointermove',event=>{
    if (drag) view.scrollTo(drag.left+drag.x-event.clientX,drag.top+drag.y-event.clientY);
  });
  view.addEventListener('lostpointercapture',()=>{drag=null;});
}
function openNetworkNode(key) {
  const node=graphContent().nodes.find(item=>item.key===key);
  if (!node) return;
  networkState().selected=key;
  if (node.kind==='task') showTask(node.id);
  else if (node.kind==='project') openProject(node.id);
  else if (node.kind==='area') chooseArea(node.id);
  else openOkr(node.id);
}
function fitNetwork() {
  const viewport=app.querySelector('.network-viewport'),world=viewport?.querySelector('.network-world');
  if (!world) return;
  networkState().zoom=Math.max(8,Math.min(100,Math.floor(100*Math.min(viewport.clientWidth/world.offsetWidth,viewport.clientHeight/world.offsetHeight))));
  refreshNetwork();
  app.querySelector('.network-viewport')?.scrollTo(0,0);
}

function workloadPage() {
  const flows=data.projects.filter(flow=>(!ui.workloadArea||flow.area===ui.workloadArea));
  const ids=new Set(flows.filter(flow=>!ui.workloadProject||flow.id===ui.workloadProject).map(flow=>flow.id));
  const now=today(),period=ui.periods.workload||'';
  const statusLabels={ready:'Ready',doing:'Doing',blocked:'Waiting',done:'Done',overdue:'Overdue',unscheduled:'Unscheduled'};
  const recorded=new Map();
  for (const event of visibleActivity()) {
    if (event.task&&!recorded.has(event.task)&&event.kind==='status'&&event.text.endsWith(' to Done')) {
      recorded.set(event.task,event.at);
    }
  }
  const items=activeTasks().filter(item=>ids.has(item.project)&&(item.status==='done'||isOpen(item))).map(item=>{
    const stamp=item.completedAt||recorded.get(item.id);
    const completed=item.status==='done'&&stamp&&Number.isFinite(Date.parse(stamp))?today(stamp):'';
    return {item,...taskDayLoad(item,period,now,completed),status:item.status==='done'?'done':
      hasBlockers(item)?'blocked':item.status==='doing'?'doing':'ready'};
  }).filter(row=>row.included);
  const rows=[...data.team,{id:'_unassigned',name:'Unassigned'}].map(member=>{
    const owned=items.filter(({item})=>member.id==='_unassigned'?!item.owners.length:item.owners.includes(member.id));
    const segments={ready:0,doing:0,blocked:0,done:0,overdue:0};
    for (const row of owned) {
      segments[row.status]+=row.planDays;
      segments.overdue+=row.overdueDays;
    }
    return {member,owned,segments,total:segments.ready+segments.doing+segments.done+segments.overdue};
  });
  const scale=Math.max(1,...rows.map(row=>row.total));
  const selected=rows.find(({member})=>member.id===ui.workloadOwner)||
    rows.find(row=>row.member.id===ui.actor&&row.owned.length)||rows.find(row=>row.owned.length)||rows[0];
  const selectedTasks=selected.owned.filter(row=>!ui.workloadStatus||
    (ui.workloadStatus==='overdue'?row.overdueDays:ui.workloadStatus==='unscheduled'?!row.scheduled:row.status===ui.workloadStatus))
    .sort((a,b)=>b.overdueDays-a.overdueDays||b.planDays-a.planDays||ranked(a.item,b.item));
  const metric=(icon,label,value,tone='')=>`<div class="panel workload-metric ${tone}"><span class="tile-icon">${symbol(icon)}</span><strong>${value}</strong><span>${label}</span></div>`;
  const indicator=(member,type,label)=>`<button type="button" class="workload-waiting ${type}" data-action="workload-segment"
    data-value="${esc(member.id+':'+type)}" aria-pressed="${member.id===selected.member.id&&ui.workloadStatus===type}">${esc(label)}</button>`;
  return hero('Team workspace','Team workload','')+
    `<div class="workload-filters">
      <label class="field"><span class="sr-only">Work area</span><select id="workload-area">${option('','All work areas',ui.workloadArea)}${[ideaArea,...data.areas].map(group=>option(group.id,group.title,ui.workloadArea)).join('')}</select></label>
      <label class="field"><span class="sr-only">Project</span><select id="workload-project">${option('','All projects',ui.workloadProject)}${flows.map(flow=>option(flow.id,flow.title,ui.workloadProject)).join('')}</select></label>
      ${periodFilter('workload')}
    </div>
    <div class="workload-overview">
      ${metric('timeline','Scheduled task-days',items.reduce((sum,row)=>sum+row.planDays,0))}
      ${metric('alert','Overdue task-days',items.reduce((sum,row)=>sum+row.overdueDays,0),'due')}
      ${metric('check','Tasks done',items.filter(row=>row.completed).length)}
      ${metric('clock','Unscheduled tasks',items.filter(row=>!row.scheduled).length)}
    </div>
    <div class="workload-grid"><section class="panel workload-panel" aria-labelledby="workload-heading">
      <div class="panel-head"><h2 id="workload-heading">Task-days by owner</h2>
        <details class="workload-info"><summary aria-label="How task-days are calculated">${symbol('alert')}</summary>
          <p>Scheduled days = end date − start date + 1, within the selected period. A single date counts as one day. Red adds days after the planned finish through today for open tasks. Green shows the scheduled days of completed work. Planned waiting days are beside the bar. Each owner sees the full schedule of a shared task. Workspace totals count the task once.</p></details></div>
      <div class="workload-chart-key" aria-label="Workload chart key">${Object.entries({ready:'circle',doing:'play',done:'check',overdue:'alert',blocked:'lock'}).map(([key,icon])=>
        `<span class="${key}">${symbol(icon)}${statusLabels[key]}</span>`).join('')}</div>
      <div class="workload-chart">${rows.map(({member,owned,segments,total})=>`
        <div class="workload-chart-row hours-row ${member.id===selected.member.id?'selected':''}">
          <button type="button" class="workload-person" data-action="workload-owner" data-value="${esc(member.id)}" aria-label="${esc(member.name)}" aria-expanded="${member.id===selected.member.id}">${member.color?avatar(member,'small'):symbol('user')}${esc(member.name)}</button>
          <div class="assignment-bar" role="group" aria-label="${esc(member.name)} task-days">
            ${['ready','doing','done','overdue'].filter(type=>segments[type]>0).map(type=>`<button type="button" class="${type}" style="width:${segments[type]/scale*100}%"
              data-action="workload-segment" data-value="${esc(member.id+':'+type)}" aria-pressed="${member.id===selected.member.id&&ui.workloadStatus===type}"
              aria-label="${esc(member.name+': '+daysLabel(segments[type])+' '+statusLabels[type])}" title="${daysLabel(segments[type])} ${statusLabels[type]}">${segments[type]}d</button>`).join('')}
          </div>
          <strong class="assignment-total" title="Total task-days">${total}d</strong>
          <span class="workload-side">
            ${owned.some(row=>row.status==='blocked')?indicator(member,'blocked',segments.blocked?segments.blocked+'d waiting':'Waiting'):''}
            ${owned.some(row=>row.completed)?indicator(member,'done',owned.filter(row=>row.completed).length+' done'):''}
            ${owned.some(row=>!row.scheduled)?indicator(member,'unscheduled',owned.filter(row=>!row.scheduled).length+' undated'):''}
          </span>
        </div>`).join('')}</div>
    </section>
    <section id="workload-tasks" class="panel workload-tasks"><header class="panel-head"><h2>${selected.member.id==='_unassigned'?'Unassigned tasks':esc(selected.member.name)+'’s tasks'}</h2>
      ${ui.workloadStatus?button('workload-owner','Clear '+statusLabels[ui.workloadStatus].toLowerCase(),'close','ghost',selected.member.id):''}</header>
      <div class="workload-task-links">${selectedTasks.length?selectedTasks.map(workloadTask).join(''):
        '<p class="detail-empty">No tasks in this selection.</p>'}</div>
    </section></div>`;
}
function workloadTask(row) {
  const {item,scheduled,total,planDays,overdueDays,lateDays,deadlineDelta,completed,finished,range}=row;
  const schedule=scheduled?(range[0]===range[1]?asDate(range[0],true):asDate(range[0])+' – '+asDate(range[1],true)):'No scheduled dates';
  const timingText=completed?(finished?'Finished '+asDate(finished,true)+(item.dueDate?(lateDays?' · '+daysLabel(lateDays)+' after planned finish':' · On time'):''):'Completion date unavailable'):
    deadlineDelta===null?'No planned finish':deadlineDelta<0?daysLabel(lateDays)+' past plan':deadlineDelta===0?'Planned finish today':daysLabel(deadlineDelta)+' until planned finish';
  return `<article class="effort-task">
    ${taskLinkCard(item)}
    <div class="workload-day-details">
      <span>${symbol('timeline')}${esc(schedule)}</span>
      <strong>${scheduled?daysLabel(planDays)+' of '+daysLabel(total)+' in view':'Outside the day bar'}</strong>
      <span class="${completed?'done':lateDays?'overdue':''}">${symbol(completed?'check':lateDays?'alert':'clock')}${esc(timingText)}</span>
      ${overdueDays?`<strong class="overdue">+${daysLabel(overdueDays)} overdue in view</strong>`:''}
      ${row.status==='blocked'?'<small class="workload-waiting-description">Waiting on prerequisites · scheduled days shown separately</small>':''}
    </div></article>`;
}

function canvas(flow,items) {
  const graphical=flow.frames.length || projectNodes(flow).length || items.some(item=>item.status!=='idea') || task(ui.locatedTask)?.project===flow.id;
  const hasSchedule=canvasItems(flow,items).some(item=>item.startDate||item.dueDate);
  const displayedOwners=data.team.filter(member=>items.some(item=>item.owners.includes(member.id)));
  const live=isActiveProject(flow)?items.filter(item=>item.status==='doing'):[];
  const edit=canEdit(flow.id)&&!ui.editor;
  return `<section class="panel canvas-panel" aria-label="Workflow canvas">
    <div class="panel-head"><div class="label-line">
      ${ui.editor?`<h2 class="canvas-heading">Builder</h2>`:hasSchedule?`<div class="segmented" aria-label="Workflow layout">
        <button type="button" data-action="time-view" data-value="layout" aria-pressed="${ui.timeView==='layout'}">${symbol('flow')} Dependencies</button>
        <button type="button" data-action="time-view" data-value="schedule" aria-pressed="${ui.timeView==='schedule'}">${symbol('clock')} By date</button>
      </div>`:`<h2 class="canvas-heading">Dependencies</h2>`}</div>
      <div class="tools">
        ${hasSchedule&&ui.timeView==='schedule'&&!ui.editor?button('jump-today','Today','','ghost today-button'):''}
        ${graphical||ui.editor?`${iconButton('zoom-out','Zoom out','minus','','toolbar-btn')}<span class="zoom-text mono">100%</span>${iconButton('zoom-in','Zoom in','plus','','toolbar-btn')}${iconButton('fit','Fit workflow to canvas','fit','','toolbar-btn')}`:''}
        ${(edit||ui.editor)&&(graphical||flow.canvasVersions?.length)?iconButton('canvas-versions','Canvas versions','clock','','toolbar-btn'):''}
      </div>
    </div>
    ${ui.editor?builderToolbar():live.length?`<div class="mission-strip">
      <span class="mission-label"><span class="mission-dot" aria-hidden="true"></span>In progress</span>
      ${live.map(item=>button('locate-mission',item.title,item.icon,'mission-task',item.id)).join('')}</div>`:''}
    <div class="canvas-shell canvas-space">
      <canvas class="canvas-sky" aria-hidden="true"></canvas>
      ${graphical||ui.editor?`<div class="canvas ${ui.editor?'builder-canvas '+ui.builderTool:''}" tabindex="0" aria-label="${hasSchedule&&ui.timeView==='schedule'&&!ui.editor?'Workflow by date. Today is '+asDate(today(),true)+'.':'Workflow diagram.'} Scroll to see more."><div class="graph-space"><div class="graph"></div></div></div>`:
        `<div class="canvas empty visual-empty"><span class="tile-icon">${symbol('flow')}</span><h2>Start with a task circle</h2>
          ${edit?button('editor','Build workflow','plus','primary'):`<p>${isActiveProject(flow)?'The project owner can build this workflow.':'This project is closed.'}</p>`}</div>`}
      ${graphical&&!ui.editor?'<div class="canvas-minimap" hidden><button type="button" aria-label="Workflow map. Press Enter to center the view." title="Click the map to pan"></button></div>':''}
      ${ui.editor&&!graphical&&!ui.placement&&ui.builderTool==='select'?`<div class="canvas-starter">
        <button class="canvas-seed-circle" type="button" data-action="first-circle" aria-label="Add first task circle">${symbol('plus')}</button>
        <strong>Add the first task</strong><small>Use the circle or drag Task from the toolbar.</small></div>`:''}
      ${ui.editor?builderSelectionBar()+builderDraftForm():''}
    </div>
    ${graphical&&!ui.editor?`<div class="canvas-bottom">
      ${displayedOwners.length?`<div class="legend-owners" role="group" aria-label="Filter by owner">${displayedOwners.map(member=>`<button type="button" class="legend-btn" aria-pressed="${ui.ownerFilter===member.id}" data-action="filter" data-value="${member.id}">${avatar(member,'small')}${esc(member.name)}</button>`).join('')}</div>`:''}
      <div class="state-key">${flow.layoutArrows.length&&ui.timeView==='layout'?'<span><i class="layout-key"></i>Layout arrow</span>':''}<span class="doing">${symbol('play')}Doing</span><span class="done">${symbol('check')}Done</span><span class="blocked">${symbol('lock')}Blocked</span></div>
    </div>`:''}
  </section>`;
}

function nextWork(items) {
  const next = items.filter(item => item.status === 'backlog' && !hasBlockers(item));
  const blocked = items.filter(item => item.status === 'backlog' && hasBlockers(item));
  if (!next.length && !blocked.length) return '';
  return `<section class="next"><div class="detail-line"><h2 class="section-title">Next handoffs</h2><small class="dim">${next.length} ready · ${blocked.length} blocked</small></div><div class="handoffs">
    ${[...next.sort(ranked),...blocked.sort(ranked)].map(item=>`<button type="button" class="handoff" data-action="task" data-value="${item.id}">
      <span class="lead">${symbol(hasBlockers(item)?'lock':item.icon)}</span><span><strong>${esc(item.title)}</strong><small>${esc(hasBlockers(item)?'Waiting on prerequisites':`Ready to start · ${item.owners.map(ownerName).join(', ') || 'Unassigned'}`)}</small></span>${symbol('chevron')}</button>`).join('')}
    </div></section>`;
}
const tableColumns=[['title','Task'],['status','Status'],['owners','Owners'],['duration','Duration'],['deadline','Planned finish']];
const defaultTableSort={column:'deadline',direction:'ascending'};
const tableScope=()=>ui.page==='area'?'project:'+ui.project:ui.page;
const tableSort=()=>ui.tableSort.get(tableScope())||defaultTableSort;
function taskTable(items, withProject = false) {
  if (!items.length) return '<div class="panel empty"><h2>No tasks here yet</h2><p>Tasks will appear here as they are added or assigned.</p></div>';
  const sort=tableSort();
  const rows=orderedTaskRows(items,sort,item=>item.archived?'Archived':readableStatus(item),ownerName);
  return `<div class="panel task-table task-table-scroll" tabindex="0" role="region" aria-label="Task list">
    <table aria-label="Tasks"><thead><tr>
      ${tableColumns.map(([key,label])=>{
        const selected=sort.column===key;
        const direction=selected?sort.direction:'';
        return `<th scope="col" ${selected?`aria-sort="${direction}"`:''}><button type="button" class="task-sort" data-action="task-sort" data-value="${key}">
          ${label}<span class="task-sort-arrow ${direction}" aria-hidden="true">${symbol(selected?'down':'sort')}</span></button></th>`;
      }).join('')}
    </tr></thead><tbody>
    ${rows.map(item=>`<tr class="task-table-row" data-action="task" data-value="${esc(item.id)}">
      <td><button type="button" class="task-title task-title-link" data-action="task" data-value="${esc(item.id)}">${esc(item.title)}${withProject ? `<small>${esc(project(item.project)?.title)}</small>` : ''}</button></td>
      <td>${statusChip(item)}</td>
      <td>${memberAvatars(item.owners)}</td><td>${taskDurationText(item)}</td><td>${taskFinish(item)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function sortTaskTable(column) {
  if (!tableColumns.some(([key])=>key===column)) return;
  const previous=tableSort();
  const direction=previous.column===column&&previous.direction==='ascending'?'descending':'ascending';
  const left=app.querySelector('.task-table-scroll')?.scrollLeft;
  ui.tableSort.set(tableScope(),{column,direction});
  render();
  if (left) app.querySelector('.task-table-scroll').scrollLeft=left;
  app.querySelector(`.task-sort[data-value="${column}"]`)?.focus({preventScroll:true});
}
function goToFlowTask(id) {
  const item=task(id);
  if (!item||!project(item.project)) return;
  ui.taskTrail=[];ui.taskReturn=null;ui.focusNote=null;ui.periods.project='';
  openProject(item.project,null,'flow',false,id);
  focusGraphTask(id);
}
function focusGraphTask(id) {
  const node=[...app.querySelectorAll('.canvas .node[data-value]')].find(element=>element.dataset.value===id);
  if (!node) return false;
  node.focus({preventScroll:true});
  node.scrollIntoView({block:'nearest',inline:'center'});
  return true;
}
function taskLocateIcon(item) {
  return iconButton('locate-task','Show '+item.title+' in flowchart','flow',item.id,'icon-btn task-locate-button');
}
function taskMeetingIcon(item) {
  return iconButton('task-to-meeting','Add '+item.title+' to meeting','people',item.id,'icon-btn task-meeting-button');
}

function taskBoard(items,{areaView=false}={}) {
  return `<div class="board" aria-label="Task status board">${Object.entries(statuses).map(([key,label])=>{
    const lane=items.filter(item=>item.status===key);
    const mark={idea:'light',backlog:'circle',doing:'play',done:'check'}[key];
    return `<section class="lane lane-${key}" data-board-lane="${key}" aria-label="${label}"><div class="detail-line lane-head"><h2>${symbol(mark)}${label} <small>${lane.length}</small></h2>
      ${canCreateTask(ui.project)&&(key==='idea'||key==='backlog')?iconButton('new-task',`Add to ${label}`,'plus',key):''}</div>
      ${lane.map(item=>{
        const checks=item.checklist.length, completed=item.checklist.filter(entry=>entry.done).length;
        const blocked=isOpen(item)&&hasBlockers(item);
        return `<div class="board-task-actions"><button class="task-card cue-${cardCue(item)}" type="button" data-action="task" data-value="${item.id}" draggable="${canChange(item)}">
          <span class="board-card-title">${symbol(item.icon)}<strong>${esc(item.title)}</strong>${blocked?`<span class="board-blockers" title="Waiting on prerequisites" aria-label="Waiting on prerequisites">${symbol('lock')}</span>`:''}</span>
          ${areaView?`<small class="board-project-context">${symbol('briefcase')}${esc(project(item.project)?.title)}</small>`:''}
          <span class="task-reference-state">${durationBadge(item)}${taskFinish(item)}</span>
          <span class="task-reference-footer">${compactTaskOwners(item)}
            ${checks?`<small class="reference-progress">${symbol('checklist')}${completed}/${checks}</small>`:''}</span>
          ${checks?`<span class="tile-meter ${completed===checks?'complete':''}" role="progressbar" aria-label="Checklist" aria-valuemin="0" aria-valuemax="${checks}" aria-valuenow="${completed}"><span style="width:${completed/checks*100}%"></span></span>`:''}
        </button>${taskLocateIcon(item)}${taskMeetingIcon(item)}</div>`;
      }).join('')}
    </section>`;
  }).join('')}</div>`;
}
function bindBoard() {
  const board=app.querySelector('.board');
  if (!board) return;
  let dragged=null;
  const clear=()=>{
    dragged=null;
    board.classList.remove('dragging-board');
    board.querySelectorAll('.drop-target,.drop-denied,.dragged-card').forEach(node=>node.classList.remove('drop-target','drop-denied','dragged-card'));
  };
  board.addEventListener('dragstart',event=>{
    const card=event.target.closest('.task-card[draggable="true"]');
    const item=task(card?.dataset.value);
    if (!item||!canChange(item)) {event.preventDefault();return;}
    dragged=item;
    event.dataTransfer.setData('application/x-graviquest-board-task',item.id);
    event.dataTransfer.effectAllowed='move';
    board.classList.add('dragging-board');
    card.classList.add('dragged-card');
    for (const lane of board.querySelectorAll('.lane')) {
      lane.classList.toggle('drop-denied',Boolean(taskMoveError(item,lane.dataset.boardLane)));
    }
  });
  board.addEventListener('dragover',event=>{
    const lane=event.target.closest('[data-board-lane]');
    if (!dragged||!lane) return;
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    if (board.querySelector('.drop-target')!==lane) {
      board.querySelector('.drop-target')?.classList.remove('drop-target');
      lane.classList.add('drop-target');
    }
  });
  board.addEventListener('drop',event=>{
    const lane=event.target.closest('[data-board-lane]');
    if (!dragged||!lane) return;
    event.preventDefault();
    const item=dragged,target=lane.dataset.boardLane;
    clear();
    changeStatus(item,target);
  });
  board.addEventListener('dragend',clear);
}
function taskModal(item) {
  const pending = blockers(item);
  const ownRounds = rounds(item).filter(visibleLoop);
  const loop = rounds(item).find(entry => !entry.optional && entry.count < entry.target);
  const revision = ownRounds.find(entry=>entry.optional&&entry.count<entry.target);
  const canWork = !hasBlockers(item);
  const editable = canChange(item);
  const clock = timing(item);
  const flow = project(item.project);
  const needsDuration=item.status!=='idea'&&needsSchedule(item);
  const primaryAction = {
    idea: button('status','Move to backlog','inbox','primary','backlog'),
    backlog: `<button type="button" class="btn primary" data-action="status" data-value="doing" ${canWork?'':'disabled'}>${symbol('play')}Start task</button>`,
    doing: loop
      ? `<button type="button" class="btn primary" data-action="run-loop" data-value="${loop.id}" ${checklistReady(item)&&visibleLoop(loop)&&canWork?'':'disabled'}>${symbol('loop')}${!visibleLoop(loop)?'Restricted review step':loop.from===loop.to?'Record pass':'Send back to '+esc(task(loop.to)?.title)}</button>`
      : `<button type="button" class="btn primary approval" data-action="status" data-value="done" ${checklistReady(item)&&canWork?'':'disabled'}>${symbol('check')}Mark done</button>`,
    done: button('reopen','Reopen task','loop')
  }[item.status];
  const statusAction=item.workflowState==='pending'
    ? button('detail','Workflow & QA','flow','primary','workflow')
    : needsDuration&&item.status!=='done'?button('schedule-task','Set duration','timeline','primary',item.id):primaryAction;
  return `<div class="task-modal-head task-hero" style="--task-tone:${esc(person(item.owners[0])?.color||'#78bee8')}">${dialogGrip()}
    <div class="task-hero-mark" aria-hidden="true">${symbol(item.icon)}</div>
    <div class="task-modal-title">
      <div class="task-hero-crumb">${esc(area(flow.area)?.title)} ${symbol('chevron')} ${esc(flow.title)}</div>
      <h2 id="task-dialog-title">${esc(item.title)}</h2>
      <div class="task-hero-state">${statusChip(item)}${item.visibility==='private'?'<span class="status private-badge">'+symbol('lock')+'Private</span>':''}
        ${needsDuration?'<span class="status attention">'+symbol('timeline')+'Needs duration</span>':''}</div>
    </div>
    <div class="tools task-hero-tools">${ui.taskTrail?.length?iconButton('task-back','Go back to previous task','left'): ''}
      ${editable?iconButton('edit-task','Edit task','edit',item.id):''}${iconButton('close-task','Close task details','close')}</div>
  </div>
  <div class="task-facts">
    <section class="task-fact">
      <h3>${symbol('people')} ${item.owners.length===1?'Owner':'Owners'}</h3>
      <div class="task-fact-owners">${item.owners.length?item.owners.map(id=>`<span><i aria-hidden="true">${avatar(person(id),'small')}</i>${esc(ownerName(id))}</span>`).join(''):'<strong>Unassigned</strong>'}</div>
    </section>
    <section class="task-fact">
      <h3>${symbol('timeline')} Duration</h3>
      <strong>${taskDurationText(item)}</strong>
      <small class="task-planned-range">${taskScheduleRange(item)}</small>
      ${item.handoffDate&&item.handoffDate!==item.dueDate?`<small>Reviews through ${asDate(item.handoffDate)}</small>`:taskFinish(item,true)}
    </section>
    <section class="task-fact task-priority">
      <h3>${symbol('spark')} Importance</h3>
      <div><strong>${clock.importance}<small> / 10</small></strong><span class="task-priority-track" aria-hidden="true"><i style="--importance:${clock.importance*10}%"></i></span></div>
    </section>
  </div>
  <div class="task-card-actions">
    ${button('locate-task','Show in flowchart','flow','ghost',item.id)}
    ${button('task-to-meeting','Add to meeting','people','ghost',item.id)}
  </div>
  <div class="views task-tabs" role="tablist" aria-label="Task views">${tab('detail','details','Overview','',ui.detail)}${tab('detail','notes',`Notes (${item.notes.length})`,'message',ui.detail)}${tab('detail','history','History','clock',ui.detail)}${tab('detail','workflow','Workflow & QA','flow',ui.detail)}</div>
  <div class="task-scroll">${studioTaskBody(item,pending,ownRounds,editable)}</div>
  ${ui.detail === 'details' && editable ? `<div class="task-modal-footer">
    ${needsDuration?'<p>A duration is required to continue.</p>':item.status==='doing'&&!checklistReady(item)?'<p>Complete the checklist and Definition of Done.</p>':'<span></span>'}
    <div class="tools">${item.status==='doing' ? button('status','Return to backlog','','ghost','backlog') : ''}
      ${item.status==='doing'&&revision&&canWork&&!needsDuration?`<button type="button" class="btn" data-action="run-loop" data-value="${esc(revision.id)}" ${checklistReady(item)?'':'disabled'}>${symbol('loop')}Request revision</button>`:''}${statusAction}</div>
  </div>` : item.archived && item.canEdit ? `<div class="task-modal-footer">${button('restore-task','Restore task','loop')}</div>` : ''}`;
}
function checkRows(item, key, editable) {
  return `<ul class="checks check-items">${item[key].map((entry,i)=>`<li><label for="${key}-${i}"><input type="checkbox" id="${key}-${i}" data-check="${key}" data-index="${i}" ${entry.done?'checked':''} ${editable&&item.status!=='done'?'':'disabled'}><span>${esc(entry.label)}</span></label></li>`).join('')}</ul>`;
}
function taskDetails(item,pending,ownRounds,editable) {
  const entryCount = item.checklist.filter(entry=>entry.done).length;
  return `<div class="task-overview">
    <div>
      <section class="detail-section"><h3>Description</h3><p>${richText(item.description || 'No description yet.')}</p></section>
      ${hasBlockers(item) ? `<section class="detail-section"><h3>${symbol('lock')} Waiting on</h3><div class="blocklist">${pending.map(dependencyReference).join('')||'<p>A prerequisite is still open.</p>'}</div></section>` : ''}
      ${ownRounds.length ? `<section class="detail-section"><h3>${symbol('loop')} Review loops</h3><div class="blocklist">${ownRounds.map(loop=>`<button type="button" data-action="loop-info" data-value="${loop.id}">${esc(task(loop.to)?.title)} · ${loop.count}/${loop.target}</button>`).join('')}</div></section>` : ''}
      ${taskRelationships(item,pending)}
      ${studioAttachments(item,editable)}
      ${item.collaboratorIds.length?`<section class="detail-section"><h3>${symbol('people')} Collaborators</h3>
        <p>${esc(item.collaboratorIds.map(ownerName).join(', '))}</p></section>`:''}
    </div>
    <div>
      <section class="detail-section"><div class="detail-line"><h3>Checklist</h3><small class="dim mono">${entryCount}/${item.checklist.length}</small></div>
        ${item.checklist.length ? '<div class="check-progress"><span style="width:'+entryCount/item.checklist.length*100+'%"></span></div>'+checkRows(item,'checklist',editable) : '<p>No items yet.</p>'}
        ${editable&&item.status!=='done' ? `<form class="inline-check-form" id="quick-check-form">
          <input type="text" name="label" aria-label="New checklist item" placeholder="Add a checklist item" maxlength="160" required>
          <button type="submit" class="icon-btn" aria-label="Add checklist item" title="Add checklist item">${symbol('plus')}</button></form>` : ''}
      </section>
      <section class="detail-section"><h3>Definition of Done</h3><div class="dod-box">${item.dod.length ? `<p>${item.dod.map(entry=>esc(entry.label)).join('<br>')}</p>` : '<p>No criteria added.</p>'}</div></section>
    </div></div>`;
}
function markMentions(text) {
  return esc(text).replace(/(^|[\s(])(@[a-z0-9-]+)/gi,(all,before,handle) => data.team.some(member=>member.handle===handle.slice(1).toLowerCase()) ? before + `<span class="mention">${handle}</span>` : all);
}
const noteDraftKey = (scope,parent='') => ui.actor+'/'+scope+'/'+(parent||'');
function noteComposer(scope,parent,members) {
  const projectNote=scope.startsWith('project/');
  const label=parent?'Reply to '+ownerName(parent.actor):projectNote?'Add a project note':'Add a note';
  return `<form class="note-form ${parent?'reply-composer':''}" id="${projectNote?'project-note-form':'note-form'}">
    <input type="hidden" name="parentId" value="${esc(parent?.id)}">
    <label class="field">${esc(label)}<textarea name="body" data-note-scope="${esc(scope)}" id="${projectNote?'project-note-text':'note-text'}" placeholder="${parent?'Write your reply':'Write a note or @mention someone'}" required maxlength="1500">${esc(noteDrafts.get(noteDraftKey(scope,parent?.id)))}</textarea></label>
    <div class="note-compose-actions">
      <select data-mention-picker aria-label="Insert a mention"><option value="">Mention a teammate</option>${members.map(member=>`<option value="${esc(member.handle)}">${esc(member.name)} (@${esc(member.handle)})</option>`).join('')}</select>
      ${parent?button(projectNote?'cancel-project-reply':'cancel-reply','Cancel','', 'ghost'):''}
      <button type="submit" class="btn primary">${symbol('send')}${parent?'Post reply':'Post note'}</button>
    </div></form>`;
}
function noteThread(entries,{scope,replyId,focusId,canPost,members}) {
  const replying=entries.find(note=>note.id===replyId);
  const replyAction=scope.startsWith('project/')?'reply-project-note':'reply-note';
  return `<div class="task-notes">${threadNotes(entries).map(({note,depth,parent})=>`<div class="note-thread-row ${parent?'thread-reply':''}" style="--depth:${Math.min(depth,3)}">
    <article class="note ${focusId===note.id?'focused-note':''}" data-note-id="${esc(note.id)}" tabindex="-1">
      <div class="detail-line">${avatar(person(note.actor),'small')}<strong>${esc(ownerName(note.actor))}</strong><time datetime="${esc(note.at)}">${shortTime(note.at)}</time></div>
      ${parent?`<small class="reply-to">${symbol('reply')} ${esc(ownerName(parent.actor))}</small>`:''}
      <p>${richText(note.body,true)}</p>
      ${canPost?button(replyAction,'Reply','reply','ghost reply-button',note.id):''}
    </article>
    ${canPost&&replying===note?noteComposer(scope,note,members):''}
  </div>`).join('') || '<p class="detail-section dim">No notes yet.</p>'}
  ${canPost&&!replying?noteComposer(scope,null,members):''}</div>`;
}
function notes(item) {
  return noteThread(item.notes,{scope:'task/'+item.id,replyId:ui.replyNote,focusId:ui.focusNote,
    canPost:item.canComment&&isActiveProject(project(item.project)),members:data.team.filter(member=>canReadTask(item,member.id))});
}
function projectNotes(flow) {
  const entries=flow.notes||[];
  return `<section class="panel project-notes" aria-label="Project notes">
    <header class="panel-head"><span class="tile-icon">${symbol('message')}</span><h2>Project notes</h2><small class="dim">${entries.length}</small></header>
    ${noteThread(entries,{scope:'project/'+flow.id,replyId:ui.projectReply,focusId:ui.focusProjectNote,
      canPost:isActiveProject(flow),members:data.team})}</section>`;
}
function saveProjectNote(fields,flow) {
  if (!flow||ui.page!=='area'||ui.view!=='project-notes'||!isActiveProject(flow)) return;
  const body=fields.get('body').trim(),parentId=fields.get('parentId');
  if (!body||body.length>1500) return announce('Write a note up to 1,500 characters.');
  return runWrite(()=>workspaceApi.projectNote(flow,body,parentId),result=>{
    noteDrafts.delete(noteDraftKey('project/'+flow.id,parentId));
    ui.projectReply=null;ui.focusProjectNote=String(result.id);
  });
}
function focusProjectNote() {
  const note=app.querySelector('.project-notes .focused-note');
  note?.scrollIntoView({block:'nearest'});note?.focus({preventScroll:true});
}
function workspaceCards() {
  return `<div class="workspace-cards">${data.areas.map(group=>`<button type="button" class="workspace-card" data-action="area" data-value="${group.id}">
    ${symbol(group.icon)}<strong>${esc(group.title)}</strong><small>${data.projects.filter(flow=>flow.area===group.id&&projectInWork(flow)).length} workflows · ${esc(ownerName(group.lead))}</small></button>`).join('')}</div>`;
}
function projectList(flows,label='Projects') {
  return `<section class="panel project-list" aria-label="${label}">
    <div class="panel-head"><h2>${label}</h2><small class="dim">${flows.length}</small></div>
    ${flows.map(flow=>{
      const items=projectTasks(flow.id);
      const done=items.filter(item=>item.status==='done').length;
      const owner=person(flow.owner);
      return `<button class="project-row" type="button" data-action="${isArchivedProject(flow)?'open-project-summary':'workflow'}" data-value="${esc(flow.id)}">
        <span class="tile-icon">${symbol('flow')}</span><span class="project-row-name"><strong>${esc(flow.title)}</strong>${flow.description?`<small>${esc(flow.description)}</small>`:''}${isArchivedProject(flow)?`<small>${esc(area(flow.area)?.title)}${flow.completions.at(-1)?.closedAt?' · '+esc(shortTime(flow.completions.at(-1).closedAt)):''}</small>`:''}</span>
        <span class="project-row-owner">${avatar(owner,'small')}${owner?esc(owner.name):'Unassigned'}</span>
        <span class="project-count">${flow.state!=='active'?projectStateChip(flow):items.length?`<span class="progress-track" aria-hidden="true"><span style="width:${done/items.length*100}%"></span></span><small>${done}/${items.length}</small>`:'<small>No tasks</small>'}</span>${symbol('chevron','project-row-icon')}
      </button>`;
    }).join('')}
  </section>`;
}
const ranked = (a,b) => timing(b).score-timing(a).score || (timing(a).days ?? Infinity)-(timing(b).days ?? Infinity) || a.title.localeCompare(b.title);
const cardCues = {
  ready:{label:'Ready / doing',icon:'play'},
  attention:{label:'Needs attention',icon:'alert'},
  overdue:{label:'Overdue',icon:'clock'},
  closed:{label:'Closed',icon:'lock'},
  done:{label:'Completed',icon:'check'}
};
function cardCue(item) {
  if (item.status==='done') return 'done';
  if (!isActiveProject(project(item.project))) return 'closed';
  if (!isOpen(item)) return 'idea';
  const {tone}=timing(item);
  if (tone==='late') return 'overdue';
  return tone==='near'||hasBlockers(item)?'attention':'ready';
}

function miniWorkflow(flow, relevant) {
  const items=projectTasks(flow.id).filter(item=>item.status!=='idea');
  const diagramItems=canvasItems(flow,items);
  const model=graphParts(flow,diagramItems);
  const completed=items.filter(item=>item.status==='done').length;
  const focused=new Set(relevant.map(item=>item.id));
  return `<button type="button" class="bento-flow" data-action="workflow" data-value="${flow.id}">
    <span class="bento-top"><span class="tile-icon">${symbol('flow')}</span><strong>${esc(flow.title)}</strong></span>
    <span class="mini-map"><svg aria-hidden="true" viewBox="0 0 ${model.width} ${model.height}">
      ${model.frames.map(({frame})=>`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="12" class="mini-frame"/>`).join('')}
      ${model.groups.map(g=>`<rect x="${g.x}" y="${g.y}" width="${g.right-g.x}" height="${g.bottom-g.y}" rx="12" class="mini-group"/>`).join('')}
      ${[...model.visEdges.values()].map(edge=>`<path d="${edge.d}" class="mini-wire"/>`).join('')}
      ${model.loops.map(loop=>`<path d="${loop.d}" class="mini-wire mini-loop"/>`).join('')}
      ${diagramItems.filter(item=>item.targetProjectId).map(item=>`<rect x="${item.x-31}" y="${item.y-19}" width="62" height="38" rx="6" class="mini-linked-project"/>`).join('')}
      ${items.map(item=>`<circle cx="${item.x}" cy="${item.y}" r="${focused.has(item.id)?29:23}" class="mini-node ${focused.has(item.id)?'focused':''} ${item.status==='doing'&&!item.owners.includes(ui.actor)?'':item.status}" style="--task-accent:${person(item.owners[0])?.color || 'var(--accent)'}"/>`).join('')}
    </svg>${diagramItems.length||flow.frames.length?'':'<span>No scheduled tasks</span>'}</span>
    <span class="bento-bottom">${completionDial(completed,items.length,completed+' of '+items.length+' tasks done')}<span>${completed}/${items.length} complete</span></span>
  </button>`;
}
function focusRow(item,context='') {
  return `<button class="focus-task" type="button" data-action="task" data-value="${esc(item.id)}">
    <span class="reference-icon cue-${cardCue(item)}">${symbol(item.icon)}</span>
    <span class="focus-task-copy"><strong>${esc(item.title)}</strong><small>${esc(project(item.project)?.title)}</small>
      ${context||''}</span>
    <span class="focus-task-meta">${statusChip(item)}${taskFinish(item)}</span>
  </button>`;
}
function focusSection(title,icon,items,empty,tone='',context=()=>'',limit=4) {
  return `<section class="panel focus-section ${tone}" aria-label="${title}">
    <header class="panel-head"><span class="tile-icon">${symbol(icon)}</span><h2>${title}</h2><small>${items.length}</small></header>
    <div class="focus-rows">${items.slice(0,limit).map(item=>focusRow(item,context(item))).join('')||`<p class="focus-empty">${empty}</p>`}
      ${items.length>limit?`<details class="focus-more"><summary>Show ${items.length-limit} more</summary>
        ${items.slice(limit).map(item=>focusRow(item,context(item))).join('')}</details>`:''}
    </div></section>`;
}
function focusView() {
  const now=today();
  const open=workingTasks().filter(isOpen);
  const owned=open.filter(item=>item.owners.includes(ui.actor));
  const mine=open.filter(involved);
  const blocked=new Map(open.map(item=>[item.id,waitingSteps(item)]));
  const actionable=owned.filter(item=>!blocked.get(item.id).length);
  const order=(a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||(b.importance??5)-(a.importance??5)||a.title.localeCompare(b.title);
  const todayList=actionable.filter(item=>needsSchedule(item)||item.status==='doing'||item.dueDate&&item.dueDate<=now||item.startDate===now).sort(order);
  const next=actionable.filter(item=>!todayList.includes(item)).sort(order);
  const waiting=mine.filter(item=>blocked.get(item.id).length).sort(order);
  const ownIds=new Set(owned.map(item=>item.id));
  const holds=new Map();
  for (const downstream of open) {
    for (const step of blocked.get(downstream.id)) {
      if (!ownIds.has(step)) continue;
      if (!holds.has(step)) holds.set(step,[]);
      holds.get(step).push(downstream);
    }
  }
  const impact=owned.filter(item=>holds.has(item.id)).sort((a,b)=>holds.get(b.id).length-holds.get(a.id).length||order(a,b));
  const candidate=todayList[0]||next.find(item=>!item.startDate||item.startDate<=now);
  const handoffs=candidate?(holds.get(candidate.id)?.length||0):0;
  const blockersCopy=item=>{
    const visible=blockers(item),labels=visible.slice(0,2).map(step=>step.title+' · '+(step.owners.map(ownerName).join(', ')||'Unassigned'));
    if (visible.length>2) labels.push('+'+(visible.length-2)+' more');
    if (blocked.get(item.id).length>visible.length) labels.push('Restricted prerequisite');
    return `<small class="focus-context">${symbol('lock')}<span>Waiting on ${esc(labels.join(' / '))}</span></small>`;
  };
  const holdingCopy=item=>{
    const tasks=holds.get(item.id);
    const first=tasks[0];
    return `<small class="focus-context">${symbol('flow')}<span>Blocks ${esc(first.title)}${tasks.length>1?' and '+(tasks.length-1)+' more':''}</span></small>`;
  };
  return `<section class="focus-lead" aria-label="Next action">
    <span class="focus-lead-icon">${symbol(candidate?.icon||'check')}</span><div class="focus-lead-copy">
      <h2>Next action</h2>
      ${candidate?`<strong>${esc(candidate.title)}</strong><p>${esc(project(candidate.project)?.title)} · ${needsSchedule(candidate)?'Needs a duration':candidate.status==='doing'?'In progress':'Ready to start'}</p>
        <div class="focus-lead-signals">${needsSchedule(candidate)?'':taskFinish(candidate)}
          ${handoffs?`<span>${symbol('flow')} ${handoffs} ${handoffs===1?'task':'tasks'} waiting on this</span>`:''}</div>`:
        `<strong>${waiting.length?'Your work is waiting on prerequisites':'Nothing ready to start right now'}</strong>`}
    </div>
    ${candidate?button('task',needsSchedule(candidate)?'Open to set duration':candidate.status==='doing'?'Continue task':'Open task','', 'focus-lead-action',candidate.id):''}
  </section>
  <div class="focus-grid">
    ${focusSection('Today','timeline',todayList,'No active or due tasks.','focus-today')}
    ${focusSection('Next','play',next,'No upcoming tasks are ready.')}
    ${focusSection('Waiting','lock',waiting,'No work is waiting on prerequisites.','focus-waiting',blockersCopy)}
    ${focusSection('Blocked by your work','flow',impact,'No tasks are waiting on you.','focus-impact',holdingCopy)}
  </div>`;
}
function myWork() {
  const date=asDate(today(),true);
  const dateChip=`<time class="date-chip" datetime="${today()}" title="Workspace time · Tehran">${symbol('timeline')}${date}</time>`;
  const views=`<div class="views my-work-views" role="tablist" aria-label="My work views">${tab('my-view','focus','Focus','target',ui.myView)}${tab('my-view','tasks','Tasks','checklist',ui.myView)}${tab('my-view','calendar','Calendar','timeline',ui.myView)}${tab('my-view','showroom','Showroom','layout',ui.myView)}</div>`;
  const heading=hero('Personal workspace','My work','',dateChip)+views;
  if (ui.myView==='focus') return heading+focusView();
  if (ui.myView==='calendar') return heading+calendar.page(ui.calendars.mine,'mine');
  if (ui.myView==='showroom') return heading+showroomPage();
  const own = workingTasks().filter(item=>item.owners.includes(ui.actor));
  const included = workingTasks().filter(item=>involved(item)&&!item.owners.includes(ui.actor));
  const relevant = ui.own==='all'?[...own,...included]:ui.own==='assigned'?own:included;
  const projects=data.projects.filter(projectInWork).filter(flow=>[...own,...included].some(item=>item.project===flow.id)||flow.owner===ui.actor);
  const selected = relevant.filter(item=>(!ui.myProject||item.project===ui.myProject)&&inPeriod(item,ui.periods.mine)).sort(ranked);
  const flows=projects.filter(flow=>(!ui.myProject||flow.id===ui.myProject)&&(selected.some(item=>item.project===flow.id)||flow.owner===ui.actor&&ui.own==='all'));
  return heading+`<div class="views my-work-filters" role="tablist" aria-label="My work filters">${tab('own','all',`All work (${own.length+included.length})`,'board',ui.own)}${tab('own','assigned',`Assigned (${own.length})`,'user',ui.own)}${tab('own','involved',`Involved (${included.length})`,'people',ui.own)}</div>
    <div class="my-work-filter">${projects.length>1?adminSelect('my-project-filter','Filter My work by project',[['','All projects'],...projects.map(flow=>[flow.id,flow.title])],ui.myProject,false):''}${periodFilter('mine')}</div>
    ${taskTable(selected,true)}
    ${flows.length?`<section class="work-card-section"><h2>${symbol('flow')} Workflows</h2><div class="work-card-grid">${flows.map(flow=>miniWorkflow(flow,selected.filter(item=>item.project===flow.id))).join('')}</div></section>`:''}`;
}
const inboxReasons = {
  mention:['message','Mentioned you'],
  'owned-note':['message','Added a note to your task'],
  'project-note':['message','Added a note to your project'],
  reply:['reply','Replied to your note'],
  assigned:['user','Assigned you a task'],
  done:['check','Completed your task'],
  'idea-referral':['light','Sent you an idea'],
  'idea-accepted':['check','Brought your idea into a work area']
};
function inbox() {
  const all = inboxEvents();
  const unread=all.filter(event=>!event.read);
  const entries=ui.inboxFilter==='unread'?unread:all;
  return hero('Personal workspace','Inbox','',unread.length?button('inbox-read-all','Mark all read','check'):'')+
    `<div class="views" role="tablist" aria-label="Inbox filters">${tab('inbox-filter','all',`All (${all.length})`,'inbox',ui.inboxFilter)}${tab('inbox-filter','unread',`Unread (${unread.length})`,'circle',ui.inboxFilter)}</div>
    <section class="panel inbox-feed" aria-label="Notifications">
      ${entries.map(event=>{
        const [icon,label]=inboxReasons[event.reason] || ['inbox','Sent an update'];
        const item=task(event.task),idea=ideaRecord(event.idea);
        return `<article class="inbox-event ${event.read?'read':'unread'}">
          <button type="button" class="inbox-open" data-action="inbox-open" data-value="${event.id}">
            <span class="inbox-mark">${symbol(icon)}</span><span class="inbox-event-copy">
              <strong>${esc(ownerName(event.actor))} <span>${esc(label.toLowerCase())}</span></strong>
              <span class="inbox-reference">${esc(idea?area(idea.area)?.title:!event.task?area(project(event.project)?.area)?.title:project(event.project)?.title)} / ${esc(idea?.title||item?.title||project(event.project)?.title||'Workspace')}</span>
              ${event.body?`<span class="inbox-snippet">${markMentions(event.body)}</span>`:''}</span>
            <time datetime="${event.at}">${shortTime(event.at)}</time>
          </button>
          ${event.read?'':iconButton('inbox-read','Mark notification read','check',event.id)}
        </article>`;
      }).join('') || `<div class="empty inbox-empty">${symbol('inbox')}<h2>${ui.inboxFilter==='unread'?'You’re caught up':'No notifications yet'}</h2></div>`}
    </section>`;
}
const projectNotebook=()=>ui.page==='area'&&ui.view==='project-report'&&currentProject();
const canEditNotebook=()=>ui.page==='daily'||Boolean(projectNotebook()&&canManagePlan(currentProject()));
function currentLog(actor=ui.actor,date=ui.dailyDate) {
  if (arguments.length===0&&projectNotebook()) return currentProject().workReport;
  return data.dailyLogs[actor]?.[date];
}
function editLog(actor=ui.actor,date=ui.dailyDate) {
  if (arguments.length===0&&projectNotebook()) return currentProject().workReport||={blocks:[],author:ui.actor,revision:0};
  data.dailyLogs[actor] ||= {};
  return data.dailyLogs[actor][date] ||= {blocks:[],revision:0};
}
function logBlock(id) {
  return currentLog()?.blocks.find(block=>block.id===id);
}
const notebookPending=new Map();
function saveLog(report=currentLog(),flow=projectNotebook(),day=ui.dailyDate) {
  report.blocks=uniqueDailyBlocks(report.blocks);
  const descriptor=flow?{project_id:Number(flow.id)}:{date:day};
  const key=flow?'project:'+flow.id:day;
  const prior=notebookPending.get(key);
  if (prior?.timer) clearTimeout(prior.timer);
  const pending=prior||{};
  pending.report=report;
  pending.timer=setTimeout(()=>{
    pending.timer=null;
    const latest=(pending.inflight||Promise.resolve()).then(async()=>{
      const blocks=report.blocks.map(({id,type,text,task,items,filename,caption,event})=>({id,type,text,task,items,filename,caption,event}));
      const result=await workspaceApi.notebook({...descriptor,revision:report.revision||0,blocks});
      report.revision=result.revision;
      report.updatedAt=new Date().toISOString();
      if (!pending.timer&&pending.inflight===latest&&currentLog()===report) {
        const status=document.querySelector('#daily-save-status');
        if (status) status.textContent='Saved';
      }
    }).catch(error=>{
      const status=document.querySelector('#daily-save-status');
      if (currentLog()===report&&status) status.textContent='Unsaved';
      announce(error.message,'danger');
    }).finally(()=>{
      if (pending.inflight===latest) {
        pending.inflight=null;
        if (!pending.timer) notebookPending.delete(key);
      }
    });
    pending.inflight=latest;
  },350);
  notebookPending.set(key,pending);
  const status=document.querySelector('#daily-save-status');
  if (currentLog()===report&&status) status.textContent='Saving…';
  return true;
}

function appendLogBlock(type, attributes={}) {
  if (!canEditNotebook()) return;
  const report=editLog();
  const block={id:newId(),type,addedAt:new Date().toISOString(),...attributes};
  report.blocks.push(block);
  saveLog(report);
  render();
  const added=document.getElementById('block-'+block.id);
  added?.querySelector('textarea,input[type="text"]')?.focus();
  return block;
}
function taskReference(id) {
  const item=task(id);
  if (!item) return '<span class="dim">Task unavailable</span>';
  return `<button type="button" class="daily-reference" data-action="task" data-value="${item.id}">
    ${symbol(item.icon)}<span><strong>${esc(item.title)}</strong><small>${esc(project(item.project)?.title)}</small></span>
    ${symbol('chevron')}</button>`;
}
const logIcons={heading:'file',meeting:'people',text:'file',note:'message',checklist:'checklist',image:'image',task:'link',activity:'clock'};
const logNames={heading:'Heading',meeting:'Meeting follow-up',text:'Text',note:'Note',checklist:'Checklist',image:'Image',task:'Task link',activity:'Task activity'};
function dailyBlock(block,editable=true) {
  let content='';
  if (block.type==='heading') {
    content=`<input class="notebook-heading" ${editable?'':'readonly'} aria-label="Section heading" data-daily-field="text" data-block="${block.id}" maxlength="120" value="${esc(block.text)}" placeholder="Section heading">`;
  } else if (block.type==='text'||block.type==='note') {
    const label=block.type==='note'?'Note':'Work summary';
    content=`<textarea ${editable?'':'readonly'} aria-label="${label}" data-daily-field="text" data-block="${block.id}" rows="3" maxlength="6000" placeholder="${block.type==='note'?'Add context, findings, or follow-up':'Write what you worked on'}">${esc(block.text)}</textarea>`;
  } else if (block.type==='checklist') {
    const count=block.items.filter(item=>item.done).length;
    content=`<div class="daily-check-summary"><span>Checklist</span><small class="dim mono" data-daily-check-count>${count}/${block.items.length}</small></div>
      <div class="check-progress"><span style="width:${block.items.length?100*count/block.items.length:0}%"></span></div>
      <div class="daily-checks">${block.items.map((item,i)=>`<div class="daily-check">
      <input type="checkbox" aria-label="${esc('Complete '+(item.text || 'checklist item '+(i+1)))}" data-daily-check data-block="${block.id}" data-index="${i}" ${item.done?'checked':''} ${editable?'':'disabled'}>
      <input type="text" ${editable?'':'readonly'} aria-label="Checklist item ${i+1}" placeholder="Checklist item" maxlength="180" data-daily-field="item" data-block="${block.id}" data-index="${i}" value="${esc(item.text)}">
      ${editable?iconButton('daily-remove-check','Remove checklist item','close',block.id+':'+i):''}
    </div>`).join('')}${editable?button('daily-add-check','Add item','plus','ghost',block.id):''}</div>`;
  } else if (block.type==='image') {
    content=`<div class="daily-image">
      <img data-daily-image="${block.id}" alt="${esc(block.caption || block.filename)}" hidden>
      <div class="daily-image-fallback">${symbol('image')} <span>Loading image</span></div>
      <input type="text" ${editable?'':'readonly'} aria-label="Image caption" data-daily-field="caption" data-block="${block.id}" value="${esc(block.caption)}" maxlength="180" placeholder="Add a caption">
    </div>`;
  } else if (block.type==='task'||block.type==='meeting') {
    content=task(block.task)?taskLinkCard(task(block.task)):taskReference(block.task);
    if (block.type==='meeting') content=`<p class="notebook-source">${symbol('people')}${esc(meetingRecord(block.meeting)?.title||'Meeting follow-up')}</p>`+content;
  } else if (block.type==='activity') {
    const event=visibleActivity().find(item=>item.id===block.event);
    content=event ? `<div class="daily-import"><strong>${esc(event.text)}</strong>
      ${event.body?`<p>${markMentions(event.body)}</p>`:''}
      ${taskReference(event.task)}<time datetime="${event.at}">${dayTime(event.at)}</time></div>` : '<span class="dim">Activity unavailable</span>';
  }
  return `<section class="log-block ${block.type}" id="block-${block.id}">
    <div class="log-block-bar">${editable?`<span class="notebook-handle" data-log-drag="${block.id}" aria-label="Drag ${logNames[block.type]} to reorder" title="Drag to reorder">⠿</span>`:''}
      <span>${symbol(logIcons[block.type])}${logNames[block.type]}</span>
      ${editable?`<details class="notebook-menu"><summary aria-label="Block options">${symbol('more')}</summary><div>
        ${button('daily-move','Move up','left','ghost',block.id+':-1')}${button('daily-move','Move down','down','ghost',block.id+':1')}
        ${button('daily-remove-block','Remove block','trash','ghost',block.id)}</div></details>`:''}</div>${content}
  </section>`;
}
function dailyPage() {
  return hero('Personal workspace','Daily log','',
    `<div class="daily-date-switch">${iconButton('daily-day','Previous day','left','-1')}
      <input type="date" id="daily-date" aria-label="Daily log date" value="${ui.dailyDate}">
      ${iconButton('daily-day','Next day','chevron','1')}
      ${ui.dailyDate!==today()?button('daily-today','Today','clock','ghost'):''}</div>`)+notebook();
}
function projectNotebookPage(flow) {
  return notebook(flow);
}
function notebook(flow=null) {
  const editable=canEditNotebook();
  const source=flow?'project-notebook':'daily';
  const report=currentLog();
  const visibleLog=new Set(visibleActivity().map(entry=>entry.id));
  const blocks=(report?.blocks||[]).map((block,index)=>({block,index})).filter(({block})=>
    (!block.task||Boolean(task(block.task)))&&(!block.event||visibleLog.has(block.event)));
  const entries=dailyEvents();
  const alreadyAdded=new Set(report?.blocks.filter(block=>block.type==='activity').map(block=>block.event));
  const author=person(flow?report?.author||flow.owner:ui.actor);
  return `<div class="daily-layout ${!editable?'notebook-readonly':''}">
      <section class="panel daily-doc" aria-label="${flow?'Project work report':'Daily work document'}">
        <div class="daily-doc-heading"><div class="daily-document-meta">${avatar(author,'large')}
          <div><h2>${esc(flow?'Project report':asDate(ui.dailyDate,true))}</h2><small>${esc(author?.name||'Unassigned')}${flow&&report?.updatedAt?' · '+shortTime(report.updatedAt):''}</small></div></div>
          <div class="daily-export"><span class="daily-save" id="daily-save-status" role="status">${report?.updatedAt?'Saved':''}</span>${blocks.length?reportControls(source):''}</div>
        </div>
        ${editable?`<div class="daily-toolbar" aria-label="Add to report">
          ${button('daily-block','Heading','file','ghost','heading')}${button('daily-block','Text','file','ghost','text')}${button('daily-block','Note','message','ghost','note')}
          ${button('daily-block','Checklist','checklist','ghost','checklist')}
          ${button('daily-image','Image','image','ghost')}${button('daily-task','Link task','link','ghost')}
          <input type="file" id="daily-image-input" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden>
        </div>`:''}
        ${!flow?(data.confirmedReports[ui.dailyDate]||[]).map(entry=>dailyBlock({id:entry.id,type:'text',text:entry.text},false)).join(''):''}
        <div class="daily-blocks">${blocks.length ? blocks.map(({block,index})=>(editable?dailyDrop(index):'')+dailyBlock(block,editable)).join('')+ (editable?dailyDrop(report.blocks.length):'') : dailyDrop(report?.blocks.length||0)+
          `<div class="daily-blank">${symbol('journal')}<h3>${flow?'Project progress and evidence':'What did you work on?'}</h3>${editable?button('daily-block','Write a summary','plus','primary','text'):'<p>No report entries yet.</p>'}</div>`}</div>
      </section>
      ${editable?`<section class="panel daily-activity" aria-label="Task activity">
        <div class="panel-head"><h2>${symbol('clock')} Task activity <small class="dim">${entries.length}</small></h2>
          ${entries.some(entry=>!alreadyAdded.has(entry.id))?button('daily-import-all','Add all','plus','ghost'):''}
        </div>
        ${entries.map(entry=>{
          const added=alreadyAdded.has(entry.id);
          const icon=entry.kind==='reply'?'reply':entry.kind==='note'||entry.kind==='review'?'message':entry.kind==='checklist'?'checklist':'flow';
          return `<article class="daily-event"><span class="daily-event-icon" ${added?'':`data-activity-drag="${entry.id}" title="Drag into the report"`}>${symbol(added?icon:'menu')}</span><div>
            <small>${esc(project(entry.project)?.title)} · <time datetime="${entry.at}">${flow?shortTime(entry.at):dayTime(entry.at)}</time></small>
            <strong>${esc(entry.text)}</strong>${entry.body?`<p>${markMentions(entry.body)}</p>`:''}
          </div>${added?`<span class="daily-added" title="Added to report" aria-label="Added to report">${symbol('check')}</span>`:
              iconButton('daily-import','Add this activity to report','plus',entry.id)}</article>`;
        }).join('')||'<div class="empty daily-activity-empty"><p>No task activity to show.</p></div>'}
      </section>`:''}
    </div>`;
}
function dailyDrop(index) {return `<div class="notebook-drop" data-daily-drop="${index}" aria-hidden="true"></div>`;}
function importDaily(ids,index) {
  if (!canEditNotebook()) return;
  const available=dailyEvents().filter(entry=>ids.includes(entry.id));
  if (!available.length) return;
  const report=editLog();
  const recorded=new Set(report.blocks.filter(block=>block.type==='activity').map(block=>block.event));
  for (const entry of available.slice().reverse()) {
    if (!recorded.has(entry.id)) {
      report.blocks.splice(index??report.blocks.length,0,{id:newId(),type:'activity',event:entry.id,addedAt:new Date().toISOString()});
      if (index!==undefined) index++;
    }
  }
  saveLog(report);
  render();
}
function dailyTaskDialog() {
  if (!canEditNotebook()) return;
  const linked=new Set(currentLog()?.blocks.filter(block=>block.type==='task'||block.type==='meeting').map(block=>block.task));
  const choices=activeTasks().filter(item=>(!projectNotebook()||item.project===ui.project)&&!linked.has(item.id)).sort((a,b)=>Number(involved(b))-Number(involved(a)) || a.title.localeCompare(b.title));
  if (!choices.length) {
    showDialog('Link a task','<p class="dim">All available tasks are already linked.</p>');
    return;
  }
  showDialog('Link a task',`<div class="reference-shelf"><input type="search" data-reference-search placeholder="Find a task" aria-label="Find a task to link">
    <div class="reference-picker">${choices.map(item=>`<div data-ref-search="${esc(item.title+' '+project(item.project)?.title+' '+item.owners.map(ownerName).join(' '))}">${taskLinkCard(item,'daily-link-task')}</div>`).join('')}</div></div>`);
  dialog.classList.add('workspace-picker-dialog');
}
async function getImage(id) {
  const response=await fetch('/api/workspace-v2/notebook/images/'+encodeURIComponent(id)+'/',{cache:'no-store'});
  if (!response.ok) return null;
  return response.blob();
}

function hydrateDailyImages() {
  for (const image of app.querySelectorAll('[data-daily-image]')) {
    const fallback=image.parentElement.querySelector('.daily-image-fallback');
    getImage(image.dataset.dailyImage).then(blob=>{
      if (!image.isConnected) return;
      if (!blob) throw new Error('Image unavailable');
      const url=URL.createObjectURL(blob);
      imageUrls.add(url);
      image.src=url;
      image.hidden=false;
      fallback.hidden=true;
    }).catch(()=>{
      if (image.isConnected) fallback.querySelector('span').textContent='Image unavailable';
    });
  }
}
async function attachDailyImage(file) {
  if (!file||!canEditNotebook()) return;
  const actor=ui.actor,date=ui.dailyDate,flow=projectNotebook();
  let upload;
  try { upload=await workspaceApi.notebookImage(file,flow?{project_id:Number(flow.id)}:{date}); }
  catch (error) { announce(error.message || 'The image could not be attached.'); return; }
  const report=flow?(flow.workReport||={blocks:[],author:actor}):editLog(actor,date);
  report.blocks.push({id:upload.id,type:'image',filename:upload.filename,caption:'',addedAt:new Date().toISOString()});
  if (flow) report.lastEditor=actor;
  saveLog(report,flow,date);
  if (currentLog()===report) render();
  announce(flow?'Image added to the project report.':'Image added to '+asDate(date)+'.');
}

function resizeLogFields() {
  for (const input of app.querySelectorAll('textarea[data-daily-field]')) {
    input.style.height='auto';
    input.style.height=Math.min(720,input.scrollHeight+2)+'px';
  }
}

function activity(entries, inside = false) {
  if (!entries.length) return '<p class="detail-empty">No activity yet.</p>';
  return `<div class="admin-list">${entries.map(entry=>`<article class="activity-line">${avatar(person(entry.actor),'small')}
    <div><strong>${esc(entry.text)}</strong><small>${esc(ownerName(entry.actor))}${!inside && project(entry.project)?' · '+esc(project(entry.project).title):''}</small>
    ${!inside && task(entry.task) ? `<button type="button" class="btn ghost" data-action="open-project-task" data-value="${entry.task}">Open task</button>` : ''}</div>
    <time datetime="${entry.at}">${shortTime(entry.at)}</time></article>`).join('')}</div>`;
}
const adminTaskFilters = [
  ['','All statuses'],['open','Open'],['idea','Idea basket'],['backlog','Backlog'],['doing','Doing'],['done','Done'],
  ['blocked','Blocked'],['late','Overdue'],['schedule','Needs duration'],['unassigned','Unassigned'],['archived','Archived']
];
const adminProjectStates = [['','Current projects'],['active','Active'],['done','Done'],['failed','Failed'],['unassigned','Unassigned'],['report','Report ready']];
const isOpen = item => isActiveProject(project(item.project))&&['backlog','doing'].includes(item.status);
const isOverdue = item => isOpen(item) && timing(item).tone==='late';
const isBlocked = item => isOpen(item)&&hasBlockers(item);
function adminSelect(id,label,values,selected,admin=true) {
  return `<select id="${id}" aria-label="${label}" ${admin?'data-admin-filter':'data-work-filter'}>${values.map(([key,title])=>option(key,title,selected)).join('')}</select>`;
}
function adminProjects() {
  const flows=data.projects.filter(flow=>(!ui.adminAreaFilter||flow.area===ui.adminAreaFilter)&&(ui.adminStateFilter?true:projectInWork(flow))&&(
    !ui.adminStateFilter||flow.state===ui.adminStateFilter||ui.adminStateFilter==='unassigned'&&!flow.owner||
    ui.adminStateFilter==='report'&&reportReady(flow)));
  return `<section class="panel">
    <div class="panel-head admin-filter-bar"><h2>${flows.length} ${flows.length===1?'project':'projects'}</h2><div>
      ${adminSelect('admin-area','Filter projects by work area',[['','All work areas'],...data.areas.map(group=>[group.id,group.title])],ui.adminAreaFilter)}
      ${adminSelect('admin-state','Filter projects by state',adminProjectStates,ui.adminStateFilter)}
    </div></div>
    ${flows.map(flow=>{
      const owner=person(flow.owner);
      const all=projectTasks(flow.id);
      const complete=all.filter(item=>item.status==='done').length;
      const {lastUpdate,needsUpdate}=adminUI.signals(flow,all,today());
      const updated=lastUpdate?shortTime(lastUpdate):'No update yet';
      return `<article class="admin-project-row">
        <div class="admin-project-name"><span class="tile-icon">${symbol(area(flow.area)?.icon)}</span><div><button class="text-button" data-action="workflow" data-value="${flow.id}" type="button">${esc(flow.title)}</button><small>${esc(area(flow.area)?.title)}</small></div></div>
        <div class="project-row-owner">${avatar(owner,'small')}${owner?esc(owner.name):'Unassigned'}</div>
        <div>${projectStateChip(flow)}<small class="project-task-count">${complete}/${all.length} tasks done</small>
          ${flow.state==='active'?`<small class="project-task-count ${needsUpdate?'admin-update-due':''}" title="${esc(updated)}">${lastUpdate&&needsUpdate?'Update due':esc(updated)}</small>`:''}</div>
        <div class="admin-project-actions">
          ${button('open-project-summary',flow.state!=='active'?'Closing report':reportReady(flow)?'Review report':'KPIs & report','journal','ghost',flow.id)}
          ${iconButton('admin-open-updates','Milestones and updates for '+flow.title,'timeline',flow.id)}
          ${iconButton('admin-project-tasks','Tasks for '+flow.title,'checklist',flow.id)}
          ${isActiveProject(flow)&&flow.area!==ideaArea.id?iconButton('project-settings','Project settings for '+flow.title,'edit',flow.id):''}
        </div></article>`;
    }).join('')||'<p class="detail-empty">No projects match these filters.</p>'}
  </section>`;
}
function adminTasks() {
  const rows=data.tasks.filter(item=>{
    if (!canSeeTask(item)||!inPeriod(item,ui.periods.admin)) return false;
    const status=ui.adminTaskFilter;
    if (Boolean(item.archived||isArchivedProject(project(item.project)))!==(status==='archived')) return false;
    return (!ui.adminProjectFilter||item.project===ui.adminProjectFilter) &&
      (!ui.adminOwnerFilter||item.owners.includes(ui.adminOwnerFilter)||ui.adminOwnerFilter==='unassigned'&&!item.owners.length) &&
      (!status||status==='archived'||item.status===status||status==='open'&&isOpen(item)||status==='late'&&isOverdue(item)||status==='schedule'&&isOpen(item)&&needsSchedule(item)||status==='blocked'&&isBlocked(item)||status==='unassigned'&&!item.owners.length);
  }).sort(ranked);
  return `<div class="admin-filter-bar"><h2>${rows.length} ${rows.length===1?'task':'tasks'}</h2><div>
    ${adminSelect('admin-task-status','Filter tasks by status',adminTaskFilters,ui.adminTaskFilter)}
    ${adminSelect('admin-task-owner','Filter tasks by owner',[['','All owners'],['unassigned','Unassigned'],...data.team.map(member=>[member.id,member.name])],ui.adminOwnerFilter)}
    ${adminSelect('admin-task-project','Filter tasks by project',[['','All projects'],...data.projects.map(flow=>[flow.id,flow.title])],ui.adminProjectFilter)}${periodFilter('admin')}
  </div></div>${taskTable(rows,true)}`;
}
function admin() {
  const view=ui.admin;
  const actions = view==='people' ? (stagingAccounts()?button('manage-staging-accounts','Manage access','people','ghost'):'')+
    button('new-person','Add teammate','plus','primary') :
    view==='areas' ? button('new-area','Add work area','plus','primary') : view==='projects'||view==='overview'?button('admin-new-project','New project','plus','primary'):
    view==='meetings'?button('edit-meeting','New meeting','plus','primary'):'';
  return `<header class="admin-hero"><div><div class="eyebrow">Workspace administration</div><h1>Admin</h1>
    <div class="admin-hero-meta">${avatar(currentActor(),'small')}${esc(currentActor().name)} <span>·</span> ${data.team.length} teammates <span>·</span> ${data.areas.length} work areas</div>
    </div><div class="admin-hero-tools">${actions}</div></header>` +
    `<div class="views admin-tabs" role="tablist" aria-label="Admin views">
      ${tab('admin','overview','Overview','admin',view)}${tab('admin','projects','Projects','flow',view)}
      ${tab('admin','tasks','Tasks','checklist',view)}${tab('admin','planning','Planning','target',view)}
      ${tab('admin','meetings','Meetings','people',view)}${tab('admin','reports','Reports','journal',view)}
      ${tab('admin','people','People','user',view)}${tab('admin','areas','Work areas','layout',view)}
      ${tab('admin','activity','Activity log','clock',view)}</div>`+
    (view==='overview'?adminUI.overview():view==='projects'?adminProjects():view==='tasks'?adminTasks():
      view==='planning'?adminUI.planning():view==='meetings'?adminUI.meetingIndex():view==='reports'?adminUI.reportIndex():
      view==='activity'?adminUI.activityLog():`<section class="panel">
      ${view==='people'?data.team.map(member=>`<div class="person-line">${avatar(member,'large')}<div><strong>${esc(member.name)}</strong><small>@${esc(member.handle)} · ${esc(roleTitle(member))}${member.roleTitle?' · '+esc(member.role)+' access':''}</small></div>
          ${button('admin-member-tasks',`${activeTasks().filter(item=>item.owners.includes(member.id)&&isOpen(item)).length} open`,'checklist','ghost',member.id)}
          ${iconButton('edit-person',`Edit ${member.name}`,'edit',member.id)}</div>`).join('') :
        data.areas.map(group=>`<div class="person-line">${symbol(group.icon)}<div><strong>${esc(group.title)}</strong><small>Lead · ${esc(ownerName(group.lead))}</small></div>
          ${button('admin-area-projects',`${data.projects.filter(flow=>flow.area===group.id).length} projects`,'flow','ghost',group.id)}
          ${group.id.startsWith('area-')?iconButton('edit-area',`Edit ${group.title}`,'edit',group.id):''}</div>`).join('')}
      </section>`);
}
function viewPage() {
  if (ui.page==='mine') return myWork();
  if (ui.page==='calendar') return hero('Team workspace','Calendar','')+calendar.page(ui.calendars.team,'team');
  if (ui.page==='profile') return profilePage();
  if (ui.page==='ideas') return ideasPage();
  if (ui.page==='archive') return archivePage();
  if (ui.page==='meetings') return meetingsPage();
  if (ui.page==='okrs') return okrPage();
  if (ui.page==='allgraph') return allGraphPage();
  if (ui.page==='inbox') return inbox();
  if (ui.page==='daily') return dailyPage();
  if (ui.page==='workload') return workloadPage();
  if (ui.page==='templates') return templatesPage();
  if (ui.page==='admin' && isAdmin()) return admin();
  if (ui.page==='areas') return hero('Team workspace','Work areas','Choose a work area to see its workflows and tasks.') + workspaceCards();
  return area(ui.area) ? areaPage() : myWork();
}
function render() {
  if (!stateLoaded) return;
  refreshDerivedSchedule();
  hideBlockerTip();
  const route=ui.page==='area'?`${ui.area}/${ui.project || ''}`:ui.page;
  const navigate=renderedRoute!==undefined && renderedRoute!==route;
  renderedRoute=route;
  const focused = document.activeElement;
  const previousNetwork=app.querySelector('.network-viewport');
  const networkScroll=!navigate&&previousNetwork&&[previousNetwork.scrollLeft,previousNetwork.scrollTop];
  const graphScroll = document.querySelector('.canvas');
  const previousScroll = graphScroll && [graphScroll.scrollLeft,graphScroll.scrollTop];
  const taskScroll = taskDialog.querySelector('.task-scroll')?.scrollTop;
  const navScroll=app.querySelector('.sidebar nav')?.scrollTop || 0;
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls.clear();
  if (observer) observer.disconnect();
  unmountGravityGrid?.();
  app.innerHTML = sidebar() + header() + `<main class="main" id="main" tabindex="-1">${viewPage()}</main>`;
  app.querySelector('.sidebar nav').scrollTop=navScroll;
  const grids=[...app.querySelectorAll('.project-gravity,.canvas-sky')].map(grid=>mountGravityGrid(grid,{sky:grid.classList.contains('canvas-sky')}));
  unmountGravityGrid=()=>grids.forEach(unmount=>unmount());
  if (ui.page==='daily'||projectNotebook()) {hydrateDailyImages();resizeLogFields();}
  if (ui.page==='allgraph'||areaGraph()) {
    const viewport=app.querySelector('.network-viewport');
    bindNetwork(viewport);
    if (networkScroll) viewport?.scrollTo(...networkScroll);
  }
  if (ui.page==='mine'&&ui.myView==='showroom') bindShowroom();
  if (ui.page==='area' && currentProject() && ui.view==='flow') setupGraph(navigate?null:previousScroll);
  if (ui.page==='area' && currentProject() && ui.view==='board' && isActiveProject(currentProject()) ||
    areaDashboard()&&ui.areaViews.get(ui.area)==='board') bindBoard();
  const item=task(ui.task);
  if (item) {
    if (!availableDetails.has(item.id) && !detailsErrors.has(item.id)) loadTaskDetails(item);
    const reopening=taskDialog.open;
    taskDialog.innerHTML=taskModal(item);
    if (!reopening) taskDialog.showModal();
    const scroll=taskDialog.querySelector('.task-scroll');
    if (scroll&&taskScroll) scroll.scrollTop=taskScroll;
  } else {
    if (taskDialog.open) taskDialog.close();
    taskDialog.replaceChildren();
  }
  if (navigate) window.scrollTo(0,0);
  updateStudioRoute();
  markUnsupported(app);
  markUnsupported(taskDialog);
  if (focused?.matches('[data-check]')) document.getElementById(focused.id)?.focus({preventScroll:true});
  else if (focused?.closest('.extra-view-menu')) app.querySelector('.extra-views summary')?.focus({preventScroll:true});
  else if (focused?.matches('.tab,.node,.legend-btn,.wire-hit,.frame-label,.parallel-shape,.toolbar-btn,.segmented button')) {
    const controlArea = focused.closest('#task-dialog') ? taskDialog : app;
    const match = [...controlArea.querySelectorAll('[data-action]')].find(element=>element.dataset.action===focused.dataset.action && element.dataset.value===focused.dataset.value);
    match?.focus({preventScroll:true});
  }
}
const bounds = (group, nodes) => {
  const members = group.members.map(id=>nodes.get(id)).filter(Boolean);
  if (!members.length) return null;
  return { x: Math.min(...members.map(n=>n.x))-66, y: Math.min(...members.map(n=>n.y))-61,
    right:Math.max(...members.map(n=>n.x))+66, bottom:Math.max(...members.map(n=>n.y))+53,
    middle:(Math.min(...members.map(n=>n.y)) + Math.max(...members.map(n=>n.y))) / 2,
    members:group.members,title:group.title,id:group.id };
};
function flowPath(from,to,fromGroup,toGroup) {
  const dir = Math.sign(to.x - from.x) || 1;
  if (!fromGroup && !toGroup && Math.abs(from.x-to.x)<60) {
    const step = Math.sign(to.y-from.y)||1;
    const y1 = from.y + step*39;
    const y2 = to.y - step*42;
    return `M${from.x} ${y1} C${from.x} ${(y1+y2)/2} ${to.x} ${(y1+y2)/2} ${to.x} ${y2}`;
  }
  const x1=fromGroup?(dir>0?fromGroup.right:fromGroup.x):from.x+dir*(from.targetProjectId?linkedHalfWidth:39);
  const y1=fromGroup?.middle ?? from.y;
  const x2=toGroup?(dir>0?toGroup.x-4:toGroup.right+4):to.x-dir*(to.targetProjectId?linkedHalfWidth+3:42);
  const y2=toGroup?.middle ?? to.y;
  const center = x1+(x2-x1)*.5;
  if (Math.abs(y1-y2)<3) return `M${x1} ${y1} L${x2} ${y2}`;
  const stepY = Math.sign(y2-y1);
  const curve = Math.max(2,Math.min(13,Math.abs(x1-x2)*.23,Math.abs(y2-y1)/2));
  return `M${x1} ${y1} H${center-dir*curve} Q${center} ${y1} ${center} ${y1+stepY*curve} V${y2-stepY*curve} Q${center} ${y2} ${center+dir*curve} ${y2} H${x2}`;
}
function loopPath(from,to,offset,groups) {
  if (from.id===to.id) {
    const startX=from.x+16, endX=from.x-25, y=from.y+68+offset*14;
    return {d:`M${startX} ${from.y+35} V${y-13} Q${startX} ${y} ${startX-13} ${y} H${endX-12} Q${endX-26} ${y} ${endX-26} ${y-14} V${from.y+43} Q${endX-26} ${from.y+26} ${endX-10} ${from.y+26} H${endX-6}`,x:from.x-11,y:y+16};
  }
  const y=Math.max(from.y+87,to.y+87,...groups.filter(group=>group.x<Math.max(from.x,to.x)&&group.right>Math.min(from.x,to.x)).map(group=>group.bottom+25))+offset*15;
  const x1=from.x, x2=to.x;
  const dir = Math.sign(x2-x1)||1;
  return {d:`M${x1} ${from.y+39} V${y-13} Q${x1} ${y} ${x1+13*dir} ${y} H${x2-13*dir} Q${x2} ${y} ${x2} ${y-13} V${to.y+43}`,x:(x1+x2)/2,y};
}
function graphParts(flow,items,showFrames=true) {
  const frames=showFrames?frameHierarchy(flow.frames):[];
  const placement=showFrames?ui.placement:null;
  const nodes = new Map(items.map(item=>[item.id,item]));
  const groups = flow.groups.filter(visibleGroup).map(group=>bounds(group,nodes)).filter(Boolean);
  const groupFor = id=>groups.find(group=>group.members.includes(id));
  const visEdges = new Map();
  for (const [start,end] of flow.edges) {
    const from = nodes.get(start), to = nodes.get(end);
    if (!from || !to) continue;
    const sourceGroup=groupFor(start), destinationGroup=groupFor(end);
    if (sourceGroup && sourceGroup===destinationGroup) continue;
    const fromGroup=sourceGroup?.members.every(id=>flow.edges.some(([a,b])=>a===id&&b===end)) ? sourceGroup : null;
    const toGroup=destinationGroup?.members.every(id=>flow.edges.some(([a,b])=>a===start&&b===id)) ? destinationGroup : null;
    const id = `${fromGroup?.id || start}/${toGroup?.id || end}`;
    const hot = from.status==='done' && to.status==='doing' && to.owners.includes(ui.actor);
    const entry=visEdges.get(id);
    if (entry) {entry.hot ||= hot;entry.edges.push([start,end]);}
    else visEdges.set(id,{d:flowPath(from,to,fromGroup,toGroup),hot,edges:[[start,end]],
      fromTitle:fromGroup?.title || from.title,toTitle:toGroup?.title || to.title});
  }
  const loops = flow.loops.filter(loop=>nodes.has(loop.from)&&nodes.has(loop.to)).map((loop,i)=>({ ...loop,...loopPath(nodes.get(loop.from),nodes.get(loop.to),flow.id==='video1'&&i<2?0:i,groups) }));
  const width = Math.max(870,...items.map(item=>item.x+(item.targetProjectId?linkedHalfWidth+18:57)),(placement?.x||0)+(placement?.width||40)+17,...frames.map(({frame})=>frame.x+frame.width+16),...groups.map(group=>group.right+16));
  const height = Math.max(478,...items.map(item=>item.y+61),(placement?.y||0)+(placement?.height||45)+16,...frames.map(({frame})=>frame.y+frame.height+16),...groups.map(group=>group.bottom+16),...loops.map(loop=>loop.y+21));
  return { frames,groups,visEdges,loops,width,height };
}
function nodeView(item) {
  const owners = item.owners.map(person).filter(Boolean);
  const tints = owners.map(member=>`color-mix(in srgb,${member.color} 30%,var(--surface))`);
  const fill = tints.length>1 ? `conic-gradient(from 0deg,${tints.map((tint,i)=>`${tint} ${i/tints.length*100}% ${(i+1)/tints.length*100}%`).join(',')})` : tints[0] || 'var(--surface)';
  const state = readableStatus(item);
  const clock=timing(item);
  const blocked=isOpen(item)&&hasBlockers(item);
  const signal=item.status==='done'?'check':clock.tone==='late'?'clock':blocked?'lock':clock.tone==='near'?'alert':item.status==='doing'?'play':'';
  const tone=item.status==='done'?'done':blocked?'blocked':item.status;
  const stateLabel=blocked&&item.status==='doing'?state+', blocked by dependencies':state;
  const located=item.id===ui.locatedTask&&!ui.editor;
  if (!ui.editor&&!located&&!matchesProjectTask(item)) {
    return `<span class="node node-context" style="left:${item.x-39}px;top:${item.y-39}px" aria-hidden="true"></span>`;
  }
  const active=isActiveProject(project(item.project))&&item.status==='doing';
  const shiny=active;
  const mine=active&&item.owners.includes(ui.actor);
  const classes = ['node','orbit-'+tone,clock.tone,shiny?'active-node':'',mine?'mission-mine':'',state==='Blocked'?'blocked-node':'',item.id===ui.task?'selected':'',located?'located-task':'',
    ui.editor?'in-editor':'',ui.editor&&ui.builderTool!=='select'?'connecting':'',
    ui.editor&&(ui.linkStart===item.id||ui.builderSelection.has(item.id))?'connect-source':''].join(' ');
  return `<button type="button" class="${classes}" data-action="task" data-value="${item.id}" aria-label="${esc(item.title+', '+stateLabel+', '+(owners.map(member=>member.name).join(', ')||'unassigned')+', '+(isDuration(item.durationDays)?taskDurationText(item)+', ':'')+clock.due)}" aria-pressed="${item.id===ui.task||ui.builderSelection.has(item.id)}"
    style="left:${item.x-39}px;top:${item.y-39}px;--node-fill:${fill};--node-owner-stroke:${owners.length?owners[0].color+'99':'var(--border-strong)'}">
    ${active?`<span class="node-dial" aria-hidden="true"></span><span class="node-now" aria-hidden="true">Now</span>`:''}
    ${located?`<span class="located-task-flag">${item.archived?'Archived':item.status==='idea'?'Idea basket':'Selected task'}</span>`:''}${symbol(item.icon,'node-type')}<span class="node-label">${esc(item.title)}</span>
    ${owners.length||isDuration(item.durationDays)?`<span class="tiny-owners" aria-hidden="true">${[owners.map(initials).join(' · '),isDuration(item.durationDays)?item.durationDays+'d':''].filter(Boolean).join(' / ')}</span>`:''}
    ${signal?`<span class="node-signal" aria-hidden="true">${symbol(signal)}</span>`:''}</button>`+
    (ui.editor?shapePort(item.id,item.title,`left:${item.x+35}px;top:${item.y-8}px`):'');
}
function rectangleStyle(frame) {
  return `left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px`;
}
function shapePort(id,title,style='') {
  return `<button type="button" class="graph-port" data-action="builder-port" data-value="${id}" ${style?`style="${style}"`:''} aria-label="${esc('Draw arrow from '+title)}" title="Drag to another shape"></button>`;
}
function frameView({frame,parent}) {
  const key=frameKey(frame.id);
  return `<div class="workflow-frame ${parent?'is-nested':''} ${ui.linkStart===key||ui.builderSelection.has(key)?'shape-source':''}" data-frame-id="${frame.id}" data-frame-parent="${parent}" style="${rectangleStyle(frame)}">
    ${ui.editor?`<button class="frame-label" type="button" data-action="builder-shape" data-value="${key}" aria-label="${esc('Rectangle '+frame.title)}">${symbol('rectangle')}${esc(frame.title)}</button>${shapePort(key,frame.title)}
      <button type="button" class="frame-resize" data-action="edit-frame" data-value="${frame.id}" aria-label="${esc('Resize '+frame.title)}" title="Drag to resize">${symbol('fit')}</button>`:
      `<span class="frame-label">${esc(frame.title)}</span>`}
  </div>`;
}
function parallelView(group) {
  const key=groupKey(group.id);
  return `<div class="parallel ${ui.linkStart===key||ui.builderSelection.has(key)?'shape-source':''}" style="left:${group.x}px;top:${group.y}px;width:${group.right-group.x}px;height:${group.bottom-group.y}px">
    ${ui.editor?`<button class="parallel-title parallel-shape" data-action="builder-shape" data-value="${key}" type="button">${esc(group.title)}</button>${shapePort(key,group.title)}`:
      `<span class="parallel-title">${esc(group.title)}</span>`}</div>`;
}
function diagramPaths(flow,model,items) {
  const shapes=new Map(items.map(item=>[item.id,item.targetProjectId?{...item,width:linkedHalfWidth*2,height:78}:{...item,radius:41}]));
  for (const {frame} of model.frames) {
    shapes.set(frameKey(frame.id),{x:frame.x+frame.width/2,y:frame.y+frame.height/2,width:frame.width,height:frame.height});
  }
  for (const group of model.groups) {
    shapes.set(groupKey(group.id),{x:(group.x+group.right)/2,y:(group.y+group.bottom)/2,width:group.right-group.x,height:group.bottom-group.y});
  }
  return flow.layoutArrows.map(({id,from,to})=>({
    id,label:`${shapeTitle(flow,from)} to ${shapeTitle(flow,to)}`,
    d:shapes.has(from)&&shapes.has(to)?shapeArrow(shapes.get(from),shapes.get(to)):''
  })).filter(arrow=>arrow.d);
}
function drawGraph(flow,items,graph,schedule=null) {
  const visibleItems=schedule?.items || items;
  const model = graphParts(flow,visibleItems,!schedule);
  if (schedule) model.height=Math.max(510,model.height);
  if (schedule?.ticks.length) model.width=Math.max(model.width,Math.max(...schedule.ticks.map(tick=>tick.x))+65);
  if (schedule) model.width=Math.max(model.width,schedule.xToday+95);
  const located=task(ui.locatedTask);
  const detached=located?.project===flow.id&&!ui.editor&&!visibleItems.some(item=>item.id===located.id);
  const detachedNode=detached?{...located,x:model.width-25,y:100}:null;
  if (detachedNode) model.width+=72;
  const { frames,groups,visEdges,loops,width,height } = model;
  graph.style.width = width+'px';
  graph.style.height = height+'px';
  const pointer = (id,paint) => `<marker id="${id}" viewBox="0 0 10 10" markerWidth="5.5" markerHeight="5.5" refX="8" refY="5" orient="auto"><path d="m1 1 7 4-7 4" fill="none" stroke="${paint}" stroke-width="1.55" stroke-linecap="round"/></marker>`;
  const axis = schedule ? `<div class="time-axis" aria-hidden="true">
    ${schedule.ticks.map(tick=>`<div class="date-tick" style="--axis-x:${tick.x}px"><span>${asDate(tick.date)}</span></div>`).join('')}
    <div class="date-tick now-tick" style="--axis-x:${schedule.xToday}px"><span>Today · ${asDate(schedule.date)}</span></div>
    ${schedule.unplannedAt?`<div class="date-tick undated" style="--axis-x:${schedule.unplannedAt}px"><span>Unscheduled</span></div>`:''}</div>` : '';
  const arrowMarkup=(key,d,category,marker,label)=>`<path class="wire ${category} ${ui.builderSelection.has(key)?'wire-selected':''}" marker-end="url(#${marker})" d="${d}"/>
    ${ui.editor?`<path class="wire-hit" d="${d}" role="button" tabindex="0" data-action="select-arrow" data-value="${key}" aria-label="${esc(label)}" aria-pressed="${ui.builderSelection.has(key)}"/>`:''}`;
  graph.innerHTML = axis + frames.map(frameView).join('') + groups.map(parallelView).join('') + `<svg class="wires" ${ui.editor?'aria-label="Workflow arrows"':'aria-hidden="true"'} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>
      ${pointer('arrow','var(--wire)')}${pointer('hot-arrow','var(--accent)')}${pointer('loop-arrow','var(--loop)')}${pointer('layout-arrow','var(--layout-wire)')}</defs>
      ${[...visEdges.entries()].map(([key,edge])=>arrowMarkup('dependency:'+key,edge.d,edge.hot?'hot':'',edge.hot?'hot-arrow':'arrow',`Task arrow from ${edge.fromTitle} to ${edge.toTitle}`)).join('')}
      ${schedule?'':diagramPaths(flow,model,visibleItems).map(arrow=>arrowMarkup('layout:'+arrow.id,arrow.d,'diagram-wire','layout-arrow','Layout arrow from '+arrow.label)).join('')}
      ${loops.map(loop=>arrowMarkup('loop:'+loop.id,loop.d,'loop','loop-arrow','Review loop from '+task(loop.from)?.title)).join('')}</svg>
      ${visibleItems.map(item=>item.targetProjectId?projectNodeView(flow,item):nodeView(item)).join('')}${detachedNode?nodeView(detachedNode):''}
      ${ui.editor&&ui.placement?.kind==='frame'?`<span class="draft-frame" aria-hidden="true" style="${rectangleStyle(ui.placement)}">${symbol('rectangle')}</span>`:''}
      ${ui.editor&&ui.placement?.kind==='circle'?`<span class="node draft-node" style="left:${ui.placement.x-39}px;top:${ui.placement.y-39}px" aria-hidden="true">${symbol('plus')}</span>`:''}
      ${loops.map(loop=>`<button type="button" class="loop-chip" data-action="${ui.editor?'select-arrow':'loop-info'}" data-value="${ui.editor?'loop:'+loop.id:loop.id}" aria-label="${esc(task(loop.from)?.title+' review loop, '+loop.count+' of '+loop.target+' passes')} " style="left:${loop.x}px;top:${loop.y}px">${symbol('loop')}${loop.count}/${loop.target} passes</button>`).join('')}`;
  return model;
}
function renderCanvasMap(container,viewport,items,layout) {
  if (!container) return null;
  const control=container.querySelector('button');
  const {width,height}=layout;
  control.innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" preserveAspectRatio="none">
    ${[...layout.visEdges.values()].map(edge=>`<path d="${edge.d}"/>`).join('')}
    ${items.map(item=>item.targetProjectId?`<rect x="${item.x-25}" y="${item.y-12}" width="50" height="24" rx="4" class="mini-linked-project"/>`:`<circle cx="${item.x}" cy="${item.y}" r="15" class="${item.status}"/>`).join('')}
    <rect class="minimap-window" rx="15" vector-effect="non-scaling-stroke"/>
  </svg>`;
  const windowMark=control.querySelector('rect');
  let scale,xOffset,yOffset;
  function updateWindow() {
    windowMark.setAttribute('x',Math.max(0,(viewport.scrollLeft-xOffset)/scale));
    windowMark.setAttribute('y',Math.max(0,(viewport.scrollTop-yOffset)/scale));
    windowMark.setAttribute('width',Math.min(width,viewport.clientWidth/scale));
    windowMark.setAttribute('height',Math.min(height,viewport.clientHeight/scale));
  }
  viewport.addEventListener('scroll',updateWindow,{passive:true});
  control.addEventListener('click',event=>{
    const rect=control.getBoundingClientRect();
    const x=event.detail?(event.clientX-rect.left)/rect.width:.5;
    const y=event.detail?(event.clientY-rect.top)/rect.height:.5;
    viewport.scrollTo(xOffset+x*width*scale-viewport.clientWidth/2,yOffset+y*height*scale-viewport.clientHeight/2);
  });
  return (zoom,x,y)=>{
    scale=zoom;xOffset=x;yOffset=y;
    container.hidden=viewport.scrollWidth<=viewport.clientWidth+2&&viewport.scrollHeight<=viewport.clientHeight+2;
    updateWindow();
  };
}

function setupGraph(previousScroll) {
  const graph = document.querySelector('.graph');
  if (!graph) return;
  const flow = currentProject();
  const items = canvasItems(flow);
  const canvasNode = graph.closest('.canvas');
  const spacer = graph.parentElement;
  const zoomText = document.querySelector('.zoom-text');
  const schedule=ui.timeView==='schedule'&&!ui.editor?planLayout(items):null;
  let layout = drawGraph(flow,items,graph,schedule);
  const minimap=canvasNode.parentElement.querySelector('.canvas-minimap');
  const map=renderCanvasMap(minimap,canvasNode,schedule?.items||items,layout);
  const resize = () => {
    const fit = Math.min(1,canvasNode.clientWidth/layout.width);
    const scale = ui.zoom ?? Math.max(.66,fit);
    const offset = Math.max(0,(canvasNode.clientWidth-layout.width*scale)/2);
    const yOffset = schedule ? 0 : Math.max(0,(canvasNode.clientHeight-layout.height*scale)/2);
    graph.style.transform = `translate(${offset}px,${yOffset}px) scale(${scale})`;
    spacer.style.width = Math.ceil(Math.max(canvasNode.clientWidth,layout.width*scale))+'px';
    spacer.style.height = Math.ceil(Math.max(canvasNode.clientHeight,layout.height*scale))+'px';
    canvasNode.dataset.scale = scale;
    canvasNode.dataset.fit = fit;
    if (schedule) canvasNode.dataset.today = offset+schedule.xToday*scale;
    zoomText.textContent = Math.round(scale*100)+'%';
    map?.(scale,offset,yOffset);
  };
  observer = new ResizeObserver(resize);
  observer.observe(canvasNode);
  resize();
  if (previousScroll) [canvasNode.scrollLeft,canvasNode.scrollTop] = previousScroll;
  else if (schedule && canvasNode.clientWidth < 700) jumpToday();
  if (ui.editor) bindBuilder(canvasNode,graph,flow,items,()=>{
    layout = drawGraph(flow,items,graph);
    resize();
  });
}
const shapeMime = 'application/x-graviquest-workflow-shape';
function bindBuilder(canvasNode,graph,flow,items,redraw) {
  let gesture=null;
  let skipClick=false;
  const pointerWire=document.createElementNS('http://www.w3.org/2000/svg','path');
  pointerWire.classList.add('builder-preview-wire');
  const marquee=document.createElement('div');
  marquee.className='builder-marquee';
  const point=event=>{
    const bounds=graph.getBoundingClientRect();
    const scale=Number(canvasNode.dataset.scale);
    return {x:(event.clientX-bounds.left)/scale,y:(event.clientY-bounds.top)/scale};
  };
  const nodeLookup=id=>graph.querySelector(`.node[data-value="${id}"]`);
  const rectLookup=id=>graph.querySelector(`[data-frame-id="${id}"]`);
  const place=(kind,p)=>{
    if (kind==='project') return editProjectNode('',p);
    if (kind==='frame') return startRectangle(frameBox({x:p.x-105,y:p.y-66},{x:p.x+105,y:p.y+66}));
    startCircle(p);
  };
  for (const palette of canvasNode.closest('.canvas-panel').querySelectorAll('.builder-palette [draggable]')) {
    palette.addEventListener('dragstart',event=>{
      event.dataTransfer.setData(shapeMime,palette.dataset.value);
      event.dataTransfer.effectAllowed='copy';
      canvasNode.classList.add('palette-drag');
    });
    palette.addEventListener('dragend',()=>canvasNode.classList.remove('palette-drag'));
  }
  canvasNode.addEventListener('dragover',event=>{
    if (!event.dataTransfer.types.includes(shapeMime)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect='copy';
  });
  canvasNode.addEventListener('drop',event=>{
    if (!event.dataTransfer.types.includes(shapeMime)) return;
    event.preventDefault();
    place(event.dataTransfer.getData(shapeMime),point(event));
  });
  canvasNode.addEventListener('keydown',event=>{
    if (event.target!==canvasNode||!['place','frame','project'].includes(ui.builderTool)||event.key!=='Enter') return;
    event.preventDefault();
    place(ui.builderTool,freeTaskPosition(flow.id));
  });
  canvasNode.addEventListener('click',event=>{
    if (skipClick) {
      event.preventDefault();event.stopPropagation();
      return;
    }
    if (!event.target.closest('button,.wire-hit')&&['place','frame','project'].includes(ui.builderTool)) {
      place(ui.builderTool,point(event));
    } else if (ui.builderTool==='select'&&!event.target.closest('button,.wire-hit')&&ui.builderSelection.size) {
      ui.builderSelection.clear();render();
    }
  },true);
  graph.addEventListener('pointerdown',event=>{
    if (event.button!==0) return;
    const node=event.target.closest('.node[data-value]');
    const port=event.target.closest('.graph-port');
    const label=event.target.closest('.workflow-frame button.frame-label');
    const handle=event.target.closest('.frame-resize');
    const p=point(event);
    if (port) gesture={mode:'wire',from:port.dataset.value,p};
    else if (handle&&ui.builderTool==='select') {
      const frame=flow.frames.find(frame=>frame.id===handle.dataset.value);
      gesture={mode:'resize',frame,p,base:{width:frame.width,height:frame.height}};
    } else if (label&&ui.builderTool==='select') {
      const frame=flow.frames.find(frame=>frame.id===shapeId(label.dataset.value));
      const carry=frameContents(flow,frame).map(item=>({item,x:item.x,y:item.y}));
      gesture={mode:'frame-move',frame,carry,p,base:{x:frame.x,y:frame.y}};
    } else if (ui.builderTool==='select'&&node) {
      const item=linkedNode(flow,node.dataset.value)||task(node.dataset.value);
      if (!item) return;
      gesture={mode:'move',item,node,p,base:{x:item.x,y:item.y}};
    } else if (['select','group','frame'].includes(ui.builderTool)&&!event.target.closest('button,.wire-hit')) {
      gesture={mode:ui.builderTool==='frame'?'draw-frame':'box',p};
    } else return;
    gesture.id=event.pointerId;
  });
  function moveTaskNode(item) {
    const node=nodeLookup(item.id);
    const half=item.targetProjectId?linkedHalfWidth:39;
    if (node) {node.style.left=item.x-half+'px';node.style.top=item.y-39+'px';}
    const handle=graph.querySelector(`.graph-port[data-value="${item.id}"]`);
    if (handle) {handle.style.left=item.x+half-4+'px';handle.style.top=item.y-8+'px';}
  }
  graph.addEventListener('pointermove',event=>{
    if (!gesture||event.pointerId!==gesture.id||!(event.buttons&1)) return;
    const p=point(event),dx=p.x-gesture.p.x,dy=p.y-gesture.p.y;
    if (!gesture.started&&Math.hypot(dx,dy)<5) return;
    if (!gesture.started) {
      gesture.started=true;
      graph.setPointerCapture(event.pointerId);
      if (gesture.mode==='wire') graph.querySelector('.wires').append(pointerWire);
      if (['box','draw-frame'].includes(gesture.mode)) graph.append(marquee);
      if (gesture.mode==='move') gesture.node.classList.add('moving');
    }
    if (gesture.mode==='move') {
      gesture.item.x=Math.min(3900,Math.max(gesture.item.targetProjectId?75:50,Math.round(gesture.base.x+dx)));
      gesture.item.y=Math.min(3900,Math.max(56,Math.round(gesture.base.y+dy)));
      moveTaskNode(gesture.item);
    }
    if (gesture.mode==='frame-move') {
      const frame=gesture.frame;
      const x=Math.min(3900-frame.width,Math.max(16,Math.round(gesture.base.x+dx)));
      const y=Math.min(3900-frame.height,Math.max(16,Math.round(gesture.base.y+dy)));
      for (const entry of gesture.carry) {
        entry.item.x=entry.x+x-gesture.base.x;entry.item.y=entry.y+y-gesture.base.y;
        const rect=rectLookup(entry.item.id);
        if (rect) rect.style.cssText=rectangleStyle(entry.item);
        else moveTaskNode(entry.item);
      }
    }
    if (gesture.mode==='resize') {
      Object.assign(gesture.frame,resizeBox(gesture.frame,p));
      rectLookup(gesture.frame.id).style.cssText=rectangleStyle(gesture.frame);
    }
    if (gesture.mode==='wire') {
      const start=gesture.p,offset=Math.max(26,Math.abs(p.x-start.x)*.38);
      pointerWire.setAttribute('d',`M${start.x} ${start.y} C${start.x+offset} ${start.y} ${p.x-offset} ${p.y} ${p.x} ${p.y}`);
    }
    if (['box','draw-frame'].includes(gesture.mode)) {
      marquee.style.left=Math.min(p.x,gesture.p.x)+'px';
      marquee.style.top=Math.min(p.y,gesture.p.y)+'px';
      marquee.style.width=Math.abs(dx)+'px';
      marquee.style.height=Math.abs(dy)+'px';
    }
  });
  graph.addEventListener('pointerup',event=>{
    const action=gesture;
    gesture=null;
    if (!action?.started) return;
    skipClick=true;
    setTimeout(()=>{skipClick=false;},0);
    pointerWire.remove();marquee.remove();
    if (action.mode==='move') {
      ui.builderSelection=new Set([action.item.id]);
      persistCanvas(flow);
    }
    if (action.mode==='frame-move'||action.mode==='resize') {
      ui.builderSelection=new Set([frameKey(action.frame.id)]);
      persistCanvas(flow);
    }
    if (action.mode==='wire') {
      const hit=document.elementFromPoint(event.clientX,event.clientY);
      const target=hit?.closest('.node[data-value],.graph-port,.parallel-shape,button.frame-label');
      const key=target?.dataset.value || frameAtPoint(flow,point(event));
      if (key&&key!==action.from) connectShapes(flow,action.from,key);
    }
    if (action.mode==='draw-frame') startRectangle(frameBox(action.p,point(event)));
    if (action.mode==='box') {
      const p=point(event);
      const selected=items.filter(item=>item.x>=Math.min(p.x,action.p.x)&&item.x<=Math.max(p.x,action.p.x)&&
        item.y>=Math.min(p.y,action.p.y)&&item.y<=Math.max(p.y,action.p.y));
      ui.builderSelection=new Set(selected.map(item=>item.id));
      render();
    }
  });
  graph.addEventListener('pointercancel',()=>{
    if (gesture?.mode==='move') Object.assign(gesture.item,gesture.base);
    if (gesture?.mode==='resize') Object.assign(gesture.frame,gesture.base);
    if (gesture?.mode==='frame-move') for (const {item,x,y} of gesture.carry) Object.assign(item,{x,y});
    gesture=null;pointerWire.remove();marquee.remove();redraw();
  });
}
function showDialog(title,content,editorIcon='') {
  if (!dialog.open) lastFocus=document.activeElement;
  clearReportPreview();
  dialog.classList.remove('workspace-picker-dialog','template-preview-dialog','report-preview-dialog');
  delete dialog.dataset.templatePreview;
  dialog.classList.toggle('editor-dialog',Boolean(editorIcon));
  dialog.innerHTML=`<div class="dialog-head">${dialogGrip()}<div class="dialog-heading">${editorIcon?`<span class="editor-mark">${symbol(editorIcon)}</span>`:''}
    <h2 id="dialog-title">${esc(title)}</h2></div>${iconButton('close-dialog','Close dialog','close')}</div><div class="dialog-body">${content}</div>`;
  markUnsupported(dialog);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[autofocus],input[type="text"],input[type="search"],select')?.focus();
}
dialog.addEventListener('close',()=>{
  if (dialog.open) return;
  clearReportPreview();
  dialog.replaceChildren();
  if (lastFocus?.isConnected) lastFocus.focus({preventScroll:true});
});
const option = (value,label,selected) => `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
const textField = (name,label,value='',max=80) => `<label class="field">${label}<input type="text" name="${name}" value="${esc(value)}" maxlength="${max}" required></label>`;
const areaField = (name,label,value='',hint='') => `<label class="field">${label}<textarea name="${name}" maxlength="1600">${esc(value)}</textarea>${hint?'<span class="help">'+esc(hint)+'</span>':''}</label>`;
const selectField = (name,label,choices) => `<label class="field">${label}<select name="${name}">${choices}</select></label>`;

function formDialog(title,id,content,submit) {
  showDialog(title,`<form id="${id}">${content}<p role="alert" class="form-error" hidden></p>
  <div class="form-actions">${button('close-dialog','Cancel','')}<button type="submit" class="btn primary">${esc(submit)}</button></div></form>`);
}
function formError(form,message) {
  const element = form.querySelector('.form-error');
  element.textContent=message; element.hidden=false;
}
function checkFieldRow(key,value='') {
  const label=key==='agenda'?'Discussion item':key==='checklist'?'Checklist item':'Acceptance criterion';
  return `<div class="check-field-row">${symbol('circle')}<input type="text" name="${key}" aria-label="${label}" value="${esc(value)}" placeholder="${label}" maxlength="160">
    ${iconButton('row-remove',`Remove ${label.toLowerCase()}`,'close')}</div>`;
}
function checkEditor(key,label,items) {
  return `<fieldset class="check-editor"><legend>${label}</legend>
    <div class="check-fields" data-items="${key}">${items.map(entry=>checkFieldRow(key,entry.label)).join('')}</div>
    ${button('row-add',key==='agenda'?'Add discussion item':key==='checklist'?'Add checklist item':'Add criterion','plus','ghost',key)}</fieldset>`;
}
function editorDialog(title,formId,icon,fields,submit,{navigation='',kickoff=false,status=''}={}) {
  showDialog(title,`<form id="${formId}" class="editor-form" data-preview-status="${status}" ${formId==='frame-form'?'':'novalidate'}>
    ${navigation}<div class="editor-layout"><div class="editor-fields">${fields}</div>
      <section class="editor-preview" aria-label="Preview"><div data-editor-preview></div></section></div>
    <div class="editor-footer"><p role="alert" class="form-error" hidden></p><div class="form-actions">
      ${kickoff?button('project-back','Back','left','ghost')+button('close-dialog','Cancel','','ghost'):button('close-dialog','Cancel','','ghost')}
      <button type="submit" class="btn primary">${esc(submit)}${kickoff?symbol('chevron'):''}</button>
    </div></div></form>`,icon);
  updateEditorPreview(dialog.querySelector('form'));
}
function personTiles(name,label,selected,single=false) {
  const members=single?[...data.team,{id:'',name:'Unassigned'}]:data.team;
  return `<fieldset class="editor-people"><legend>${label}</legend><div class="person-tiles">
    ${members.map(member=>`<label class="person-tile">
      <input type="${single?'radio':'checkbox'}" name="${name}" value="${esc(member.id)}" ${selected.includes(member.id)?'checked':''}>
      ${member.id?`<span class="person-tile-avatar" aria-hidden="true">${avatar(member)}</span>`:`<span class="avatar unassigned" aria-hidden="true">${symbol('user')}</span>`}
      <span class="person-tile-name">${esc(member.name)}</span><span class="person-tile-check" aria-hidden="true">${symbol('check')}</span>
    </label>`).join('')}</div></fieldset>`;
}
const taskSections=[['details','Details','file'],['schedule','Schedule','clock'],['checklist','Checklist','checklist'],['access','Access','lock']];
function taskEditorSection(key,content) {
  return `<section class="editor-section" data-editor-section="${key}" id="task-editor-${key}" role="tabpanel" aria-labelledby="task-tab-${key}" ${key==='details'?'':'hidden'}>${content}</section>`;
}
function durationField(value='',required=true) {
  return `<label class="field duration-field">Duration (days)<input type="number" name="durationDays" min="1" max="${maxTaskDays}" step="1"
    inputmode="numeric" value="${esc(value)}" ${required?'required':''}></label>`;
}
function editTaskDialog(item,startingStatus = 'backlog') {
  if (item ? !canChange(item) : !canCreateTask(ui.project)) return;
  const navigation=`<div class="editor-tabs" role="tablist" aria-label="Task fields">
    ${taskSections.map(([key,label,icon],i)=>`<button type="button" role="tab" id="task-tab-${key}" aria-controls="task-editor-${key}"
      aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-action="task-editor-tab" data-value="${key}">${symbol(icon)}${label}</button>`).join('')}
  </div>`;
  if (item && !availableDetails.has(item.id)) return announce('Wait for task details to load.');
  editorDialog(item?'Edit task':'New task','task-form',item?.icon||'circle',
    `${item?`<input type="hidden" name="id" value="${item.id}">`:`<input type="hidden" name="startingStatus" value="${startingStatus}">`}
    ${taskEditorSection('details',`${!item&&taskPresets(currentProject()?.area).length?`<div class="preset-apply">${presetPicker(currentProject())}${button('apply-preset','Apply','plus','ghost')}</div>`:''}
      ${textField('title','Task name',item?.title)}
      ${areaField('description','Description',item?.description)}
      ${personTiles('owners','Owner',item?.owners || [ui.actor],true)}
      ${personTiles('contributors','Contributors',item?.collaboratorIds || [])}
      `)}
    ${taskEditorSection('schedule',`${durationField(item?.durationDays,(item?.status||startingStatus)!=='idea')}
      <small class="dim">Planned dates follow the project start and dependencies.</small>
      <label class="field importance-field"><span>Importance <output for="task-importance">${item?.importance ?? 5} / 10</output></span>
      <input id="task-importance" type="range" name="importance" min="1" max="10" value="${item?.importance ?? 5}">
      <span class="importance-ends"><small>Low</small><small>Critical</small></span></label>
      <div data-schedule-impact hidden></div>`)}
    ${taskEditorSection('checklist',checkEditor('checklist','Checklist',item?.checklist || [])+checkEditor('dod','Definition of Done',item?.dod || []))}
    ${taskEditorSection('access',!item||item.canEditAccess?taskAccessSection(item):'<p class="dim">Task access follows GraviQuest permissions.</p>')}`,
    item?'Save changes':'Create task',{navigation,status:item?.status || startingStatus});
}
function taskAccessSection(item) {
  const privateTask=item?.visibility==='private';
  return `<label class="field">Visibility<select name="visibility">
      ${option('workspace','Public · Workspace members',privateTask?'private':'workspace')}
      ${option('private','Private · Selected members',privateTask?'private':'workspace')}
    </select></label>
    <div class="task-access-scope" data-private-members ${privateTask?'':'hidden'}>
      <p class="dim">Task owners, collaborators, the person who set access, and people selected here can see the task.</p>
      ${personTiles('allowedMembers','Additional access',item?.allowedMembers||[])}
    </div>`;
}
function showEditorSection(form,key) {
  form.dataset.section=key;
  form.querySelectorAll('[data-editor-section]').forEach(panel=>{panel.hidden=panel.dataset.editorSection!==key;});
  form.querySelectorAll('[role="tab"]').forEach(control=>{
    const selected=control.dataset.value===key;
    control.setAttribute('aria-selected',String(selected));
    control.tabIndex=selected?0:-1;
  });
  form.querySelector('.form-error').hidden=true;
}
function editorError(form,section,message,field) {
  if (section) showEditorSection(form,section);
  field?.focus();
  formError(form,message);
}
function kickoffRow() {
  return `<div class="kickoff-row">
    <label class="field">Metric<input type="text" name="kpi-label" placeholder="Videos passing QA" maxlength="90"></label>
    <label class="field">Target<input type="text" name="kpi-target" placeholder="100% before release" maxlength="140"></label>
    ${iconButton('kickoff-remove','Remove KPI','trash')}
  </div>`;
}
function kickoffMetrics(fields) {
  const targets=fields.getAll('kpi-target');
  return fields.getAll('kpi-label').map((label,i)=>({label:label.trim(),target:targets[i].trim()}));
}
function setKickoffStep(form,step) {
  showEditorSection(form,step);
  const kpis=step==='kpis',review=step==='template-preview';
  const scheduled=form.querySelector('[data-template-duration]');
  if (scheduled) scheduled.hidden=!kpis||!templateById(form.elements.template.value)?.tasks.some(item=>!item.idea&&!isDuration(item.durationDays));
  form.querySelectorAll('[data-kickoff-step]').forEach(entry=>{
    if (entry.dataset.kickoffStep===step) entry.setAttribute('aria-current','step');
    else entry.removeAttribute('aria-current');
  });
  form.querySelector('[data-action="project-back"]').hidden=step==='details';
  form.querySelector('.editor-footer [data-action="close-dialog"]').hidden=step!=='details';
  form.querySelector('[type="submit"]').innerHTML=kpis?'Create project'+symbol('check'):review?'Use template'+symbol('check'):'Continue'+symbol('chevron');
  form.querySelector(kpis?'[name="kpi-label"],[data-action="kickoff-add"]':review?'[type=submit]':'[name="title"]')?.focus();
}
const canManageArea = id => isAdmin() && id!==ideaArea.id && Boolean(area(id));
function newFlowDialog(id,flow=null,templateId='') {
  if (!isAdmin() || id&&!canManageArea(id) || flow&&!isActiveProject(flow)) return;
  const chosenTemplate=flow?null:templateById(templateId);
  const choices=templates();
  if (chosenTemplate&&!choices.some(entry=>entry.id===chosenTemplate.id)) choices.unshift(chosenTemplate);
  const navigation=flow?'':`<ol class="kickoff-steps" aria-label="Project setup">
    <li data-kickoff-step="details" aria-current="step">${symbol('briefcase')}<span>Project details</span></li>
    <li data-kickoff-step="kpis">${symbol('target')}<span>Kickoff KPIs</span></li></ol>`;
  editorDialog(flow?'Project settings':'New project','workflow-form','briefcase',
    `<input type="hidden" name="id" value="${flow?.id || ''}">
    <section class="editor-section" data-editor-section="details">
      ${textField('title','Project name',flow?.title)}
      ${flow?'':selectField('template','Workflow template',option('','Start empty',templateId)+choices.map(template=>
        option(template.id,template.name+(template.revision?' · v'+template.revision:''),templateId)).join(''))}
      ${id&&!flow?`<input type="hidden" name="area" value="${esc(id)}">`:selectField('area','Work area',data.areas.map(group=>option(group.id,group.title,flow?.area||chosenTemplate?.area)).join(''))}
      ${areaField('description','Description',flow?.description)}
      ${flow?'':`<label class="field">Project start date<input type="date" name="scheduleStart" value="${today()}" required></label>`}
      ${flow?`<input type="hidden" name="owner" value="${esc(flow.owner)}"><p class="dim">Project owner · ${esc(ownerName(flow.owner))}</p>`:
        personTiles('owner','Project owner',[chosenTemplate?.owner || area(id)?.lead || ui.actor],true)}
    </section>
    ${flow?'':`<section class="editor-section" data-editor-section="template-preview" hidden></section>
    <section class="editor-section" data-editor-section="kpis" hidden>
      <div class="kickoff-intro"><h3>How will you measure success?</h3><p>Set a metric and target. You can leave this blank and let the project owner add KPIs later.</p></div>
      <label class="field" data-template-duration hidden>Default duration for template tasks (days)
        <input type="number" name="templateDuration" min="1" max="${maxTaskDays}" step="1" inputmode="numeric" value="1"><small>Used for tasks without an estimate. You can change each task individually.</small>
      </label>
      <div class="kickoff-metrics">${kickoffRow()}</div>
      ${button('kickoff-add','Add KPI','plus','ghost')}</section>`}`,flow?'Save project':'Continue',{navigation,kickoff:!flow});
  if (!flow) {
    const form=dialog.querySelector('form');
    form.dataset.reviewedTemplate=chosenTemplate?.id||'';
    setKickoffStep(form,'details');
  }
}
function updateEditorPreview(form) {
  const fields=new FormData(form);
  const title=fields.get('title')?.trim();
  const box=form.querySelector('[data-editor-preview]');
  switch (form.getAttribute('id')) {
    case 'workflow-form': {
      const edited=project(fields.get('id'));
      const group=area(fields.get('area'));
      const owner=person(fields.get('owner'));
      const metrics=(edited?.kpis || kickoffMetrics(fields)).filter(({label,target})=>label||target);
      const template=templateById(fields.get('template'));
      box.innerHTML=`<div class="preview-context">${symbol(group?.icon || 'briefcase')}${esc(group?.title || 'Project')}</div>
        <h3>${esc(title || 'Untitled project')}</h3>
        ${fields.get('description').trim()?`<p class="preview-description">${esc(fields.get('description').trim())}</p>`:''}
        <div class="preview-person">${avatar(owner)}<span>${owner?esc(owner.name):'Owner unassigned'}</span></div>
        ${template?`<p class="preview-template">${esc(template.name)} · ${template.tasks.length} ${template.tasks.length===1?'task':'tasks'}</p>`:''}
        ${metrics.length?`<ul class="preview-metrics">${metrics.slice(0,3).map(entry=>`<li>
          <span>${symbol('target')}${esc(entry.label || 'Metric')}</span><strong>${esc(entry.target || 'Target')}</strong></li>`).join('')}</ul>
          ${metrics.length>3?`<small>+${metrics.length-3} more KPIs</small>`:''}`:''}`;
      break;
    }
    case 'kpi-form': {
      box.innerHTML=`<div class="preview-context">${symbol('briefcase')}${esc(currentProject()?.title)}</div>
        <h3>${esc(fields.get('label').trim() || 'Untitled KPI')}</h3>
        <ul class="preview-metrics"><li><span>${symbol('target')}Target</span><strong>${esc(fields.get('target').trim() || 'Set a target')}</strong></li>
          <li><span>${symbol('checklist')}Result</span><strong>${esc(fields.get('result').trim() || 'Pending')}</strong></li></ul>`;
      break;
    }
    case 'task-form': {
      const item=task(fields.get('id'));
      const flow=item?project(item.project):currentProject();
      const status=form.dataset.previewStatus;
      const duration=fields.get('durationDays');
      const importance=Number(fields.get('importance'));
      const owners=fields.getAll('owners');
      const checks=[...fields.getAll('checklist'),...fields.getAll('dod')].filter(label=>label.trim()).length;
      box.innerHTML=`<div class="preview-context">${symbol('briefcase')}${esc(flow?.title || 'Project')}</div>
        <h3>${esc(title || 'Untitled task')}</h3>
        <div class="preview-person">${memberAvatars(owners)}${owners.length?`<span>${esc(owners.map(ownerName).join(', '))}</span>`:''}</div>
        <div class="preview-task-meta">${statusChip(item || {status,project:flow?.id})}
          ${fields.get('visibility')==='private'?'<span class="status private-badge">'+symbol('lock')+'Private</span>':''}
          ${isDuration(duration)?`<span>${symbol('clock')}${daysLabel(Number(duration))}</span>`:''}
          ${checks?`<span>${symbol('checklist')}${checks} ${checks===1?'item':'items'}</span>`:''}</div>
        <div class="preview-importance"><span>Importance</span><strong>${importance}/10</strong><meter min="0" max="10" value="${importance}" aria-label="Importance"></meter></div>`;
      form.querySelector('output').value=`${importance} / 10`;
      break;
    }
    case 'frame-form': {
      const width=Number(fields.get('width')),height=Number(fields.get('height'));
      const aspect=height>0?Math.max(.75,Math.min(3,width/height)):1.7;
      box.innerHTML=`<div class="preview-context">${symbol('rectangle')}Workflow rectangle</div>
        <div class="preview-frame" style="--frame-ratio:${aspect}"><strong>${esc(title || 'Untitled rectangle')}</strong></div>
        <p class="preview-frame-size">${width} × ${height}</p>`;
      break;
    }
  }
}
function editGroupDialog(flow,id) {
  const existing=flow.groups.find(group=>group.id===id);
  if (id&&(!existing||!visibleGroup(existing))) return;
  const available=projectTasks(flow.id).filter(item=>item.status!=='idea' && !flow.groups.some(group=>group!==existing && group.members.includes(item.id)));
  if (!available.length) { announce('Add tasks before creating a parallel group.'); return; }
  formDialog(existing?'Edit parallel group':'New parallel group','group-form',
    `<input type="hidden" name="id" value="${existing?.id || ''}">${textField('title','Group name',existing?.title || '',40)}
    ${visualTaskChoices('members','Parallel tasks',available,existing?.members)}`, 'Save parallel group');
  dialog.classList.add('workspace-picker-dialog');
}
function showGroups(flow) {
  showDialog('Parallel groups', `<div class="search-results">${flow.groups.filter(visibleGroup).map(group=>`<div class="detail-line"><div><strong>${esc(group.title)}</strong><div class="parallel-list-preview">${group.members.map(task).filter(Boolean).map(item=>`<span title="${esc(item.title)}">${symbol(item.icon)}${esc(item.title)}</span>`).join('')}</div></div>
    ${button('edit-group','Edit','edit','',group.id)}${iconButton('remove-group','Remove parallel group','close',group.id)}</div>`).join('') || '<p class="dim">Create a group to show tasks that can run in parallel.</p>'}</div>
    <div class="form-actions" style="margin-top:11px">${button('edit-group','Add parallel group','plus','primary')}</div>`);
}
function endpointChoices(flow, selected='') {
  const groups=flow.groups.filter(visibleGroup).map(group=>option('group:'+group.id,group.title+' (all tasks)',selected));
  const children=canvasItems(flow).map(item=>option(item.id,item.title+(item.targetProjectId?' · Linked project':''),selected));
  return option('','Choose an endpoint',selected)+groups.join('')+children.join('');
}
function endpointMembers(flow,id) {
  return id.startsWith('group:') ? flow.groups.find(group=>group.id===id.slice(6)&&visibleGroup(group))?.members || [] : workflowShape(flow,id)?.project===flow.id ? [id] : [];
}
function dependencyDialog(flow,start='',end='') {
  const removals=flow.edges.flatMap(([from,to],i)=>{
    const a=workflowShape(flow,from),b=workflowShape(flow,to);
    return a&&b?[option(String(i),`${a.title} → ${b.title}`)]:[];
  });
  formDialog('Workflow dependencies','dependency-form',`${selectField('from','Prerequisite',endpointChoices(flow,start))}${selectField('to','Step that waits',endpointChoices(flow,end))}
    <small class="dim">Selecting a group connects every task in that group.</small>
    ${removals.length?`${selectField('remove','Remove an existing dependency',option('','Keep existing dependencies','')+removals.join(''))}`:''}
    <div data-endpoint-preview></div>`,'Save dependency');
  dialog.classList.add('workspace-picker-dialog');
  updateEndpoints(dialog.querySelector('form'),flow);
}
function showLoops(flow) {
  showDialog('Review loops', `<div class="search-results">${flow.loops.filter(visibleLoop).map(loop=>`<div class="detail-line"><div><strong>${esc(task(loop.from)?.title)} to ${esc(task(loop.to)?.title)}</strong><p class="dim">${loop.count} of ${loop.target} passes</p></div>
    ${button('edit-loop','Edit','edit','',loop.id)}${iconButton('remove-loop','Remove review loop','close',loop.id)}</div>`).join('') || '<p class="dim">Set how many times a task repeats or returns to an earlier task.</p>'}</div>
    <div class="form-actions" style="margin-top:11px">${button('edit-loop','Add review loop','plus','primary')}</div>`);
}
function editLoopDialog(flow,id,preset=null) {
  const existing=flow.loops.find(loop=>loop.id===id);
  if (id&&(!existing||!visibleLoop(existing))) return;
  const items=projectTasks(flow.id).filter(item=>item.status!=='idea');
  if (!items.length) { announce('Add a task before creating a review loop.'); return; }
  const from=items.map(item=>option(item.id,item.title,existing?.from || preset?.from)).join('');
  const to=items.map(item=>option(item.id,item.title,existing?.to || preset?.to)).join('');
  formDialog(existing?'Edit review loop':'New review loop','loop-form',
    `<input type="hidden" name="id" value="${existing?.id || ''}">${selectField('from','Review task',from)}${selectField('to','Return to',to)}
    <label class="field">Repeat passes<input type="number" name="target" required min="${Math.max(1,existing?.count||0)}" max="20" value="${existing?.target || 2}"></label>
    <label class="calendar-done"><input type="checkbox" name="optional" ${existing?.optional?'checked':''}> Request revisions only when needed</label><div data-endpoint-preview></div>`, 'Save review loop');
  dialog.classList.add('workspace-picker-dialog');
  updateEndpoints(dialog.querySelector('form'),flow);
}
function showLoopInfo(flow,id) {
  const loop=flow?.loops.find(entry=>entry.id===id);
  if (!loop||!visibleLoop(loop)) return;
  const from=task(loop.from), to=task(loop.to);
  showDialog('Review loop',`<p><strong>${esc(from.title)}${from!==to?' to '+esc(to.title):''}</strong></p>
    <p class="dim">${loop.count} of ${loop.target} ${loop.optional?'optional revisions':'required passes'} recorded.</p>
    <p class="detail-section dim">${from===to?'Recording a pass resets this task’s checklist and acceptance criteria.':'Sending a pass back reopens the earlier task and resets the dependent tasks on the route back to review.'}</p>
    <div class="form-actions">${ui.editor?button('edit-loop','Edit loop','edit','',id):''}${button('open-project-task','Open review task','flow','primary',from.id)}</div>`);
}
function moveTaskDialog(flow) {
  const items=projectTasks(flow.id).filter(item=>item.status!=='idea');
  const selected=items.find(item=>item.id===ui.task) ?? items[0];
  if (!selected) { announce('Add a task first.'); return; }
  formDialog('Move task','move-form',`${selectField('id','Task',items.map(item=>option(item.id,item.title,selected.id)).join(''))}
    <label class="field">Horizontal position<input type="number" name="x" required min="48" max="3900" value="${selected.x}"></label>
    <label class="field">Vertical position<input type="number" name="y" required min="55" max="3900" value="${selected.y}"></label>`, 'Move task');
}
const temporaryPasswordField = '<label class="field">Temporary staging password<input name="password" type="password" autocomplete="new-password" required></label>';

function newStagingAccountDialog() {
  if (!stagingAccounts()) return;
  formDialog('Create staging account','create-staging-account-form',
    textField('name','Display name','',150)+
    '<label class="field">Email address<input name="email" type="email" autocomplete="off" maxlength="254" required></label>'+
    selectField('role','Access level',option('member','Member','member')+option('admin','Admin'))+
    temporaryPasswordField+
    '<p class="dim">Share the temporary password through the team’s secure channel.</p>', 'Create account');
}

async function manageStagingAccounts() {
  if (!stagingAccounts()) return;
  showDialog('Manage staging access','<p role="status" data-staging-account-loading>Loading accounts…</p>');
  const loading = dialog.querySelector('[data-staging-account-loading]');
  try {
    const {members,viewer} = await workspaceApi.teamAccounts();
    if (!dialog.open || !loading.isConnected) return;
    formDialog('Manage staging access','choose-staging-account-form',
      selectField('id','Core account',members.map(member=>
        option(member.id,member.name+' · '+member.email+(member.is_active?'':' · Inactive'))).join('')), 'Open account');
    dialog.querySelector('form').onchooseaccount = id => {
      const member=members.find(account=>String(account.id)===id);
      if (member) stagingAccountDialog(member,viewer);
    };
  } catch (error) {
    if (dialog.open && loading.isConnected) loading.textContent=error.message;
  }
}

function stagingAccountDialog(member,viewer) {
  const canSetRole = member.role!=='owner' && (viewer.role==='owner'||viewer.is_superuser);
  const title = 'Access for '+member.name;
  formDialog(title,'staging-account-access-form',`
    <input type="hidden" name="id" value="${Number(member.id)}">
    <p class="dim">${esc(member.email)}</p>
    ${canSetRole?selectField('role','Access level',option('member','Member',member.role)+option('admin','Admin',member.role)):
      '<p class="dim">Access level · '+esc(member.role)+'</p>'}
    <label class="field"><span><input type="checkbox" name="active" ${member.is_active?'checked':''}> Account active</span></label>
    ${button('reset-staging-account','Set temporary password','edit','ghost',member.id)}`, 'Save access');
}

function resetStagingAccountDialog(id) {
  if (!stagingAccounts()) return;
  formDialog('Set temporary password','reset-staging-account-form',
    `<input type="hidden" name="id" value="${Number(id)}">`+temporaryPasswordField, 'Set password');
}

function personDialog(member) {
  if (!member && stagingAccounts()) return showDialog('Add teammate',
    '<div class="form-actions">'+button('add-existing-staging-account','Add existing account','plus')+
    button('create-staging-account','Create staging account','user','primary')+'</div>');
  if (!member) return addExistingAccountDialog();
  formDialog('Edit teammate','person-form',`<input type="hidden" name="id" value="${member.id}">
    ${textField('name','Display name',member.name,38)}${textField('handle','Mention handle',member.handle,25)}
    <label class="field">Role title<input type="text" name="roleTitle" maxlength="60" value="${esc(member.roleTitle)}" placeholder="e.g. Video Editor"></label>
    ${selectField('role','Access level',option('Member','Member',member.role)+option('Admin','Admin',member.role))}
    <label class="field">Owner color<input type="color" name="color" value="${member.color || '#d6a3b0'}"></label>`, 'Save teammate');
}
function addExistingAccountDialog() {
  return formDialog('Add teammate','add-member-form',
    '<label class="field">GraviQuest account email<input name="email" type="email" autocomplete="off" required></label>'+
    selectField('role','Access level',option('member','Member','member')+option('admin','Admin')),'Add teammate');
}
function areaDialog(group) {
  formDialog(group?'Edit work area':'Add work area','area-form',`<input type="hidden" name="id" value="${group?.id || ''}">
    ${textField('title','Work area name',group?.title,46)}
    ${selectField('lead','Work area lead',option('','Unassigned',group?.lead||'')+data.team.map(member=>option(member.id,member.name,group?.lead)).join(''))}`,'Save work area');
}
function identityDialog() {
  showDialog('Switch demo teammate',`<p class="dim" style="margin-bottom:9px">Try each person’s assignments and permissions in this browser.</p>
    ${data.team.map(member=>`<button type="button" class="person-choice" data-action="switch-person" data-value="${member.id}">${avatar(member)}<span>${esc(member.name)} · ${esc(roleTitle(member))}</span>${member.id===ui.actor?symbol('check'):''}</button>`).join('')}`);
}
function searchDialog() {
  showDialog('Search tasks',`<input id="search-field" type="search" aria-label="Search by task, workflow, or area" autofocus placeholder="Task, workflow, or area"><div class="search-results" id="search-results"></div>`);
  updateSearch('');
}
function updateSearch(query) {
  const normalized=query.trim().toLowerCase();
  const matches=workingTasks().filter(item=>{
    const flow=project(item.project);
    return [item.title,flow?.title,area(flow?.area)?.title].some(value=>value?.toLowerCase().includes(normalized));
  }).slice(0,15);
  document.querySelector('#search-results').innerHTML=matches.map(item=>`<button type="button" data-action="open-project-task" data-value="${item.id}"><span>${esc(item.title)}</span><small class="dim">${esc(project(item.project)?.title)}</small></button>`).join('')||'<p class="dim">No matching tasks.</p>';
}
function chooseArea(id) {
  if (!area(id)) return;
  resetBuilder();ui.canvasUndo=[];ui.idea=null;
  ui.expandedAreas.add(id);
  Object.assign(ui,{page:'area',area:id,project:null,task:null,locatedTask:null,view:'flow',editor:false,mobileOpen:false,ownerFilter:null,zoom:null,taskQuery:'',taskStatus:'',taskOrder:'priority',linkStart:null});
  render();
}
function openProject(id,item=null,view='',startBuilding=false,locatedTask=null) {
  const flow=project(id);
  if (!flow) return;
  resetBuilder();
  if (ui.project!==id) {ui.canvasUndo=[];ui.periods.project='';ui.calendars.project=calendarState();}
  ui.replyNote=null;ui.projectReply=null;ui.focusProjectNote=null;
  ui.expandedAreas.add(flow.area);
  const preserveView=ui.project===id && ui.page==='area';
  const building=startBuilding&&canEdit(id);
  if (building) ui.viewBeforeEdit='flow';
  ui.initialBuilder=building&&flow.owner!==ui.actor?id:null;
  Object.assign(ui,{page:'area',area:flow.area,project:id,task:item?.id || null,locatedTask,view:startBuilding?'flow':view||(preserveView?ui.view:isArchivedProject(flow)?'summary':'flow'),detail:'details',editor:building,mobileOpen:false,ownerFilter:null,zoom:null,taskQuery:'',taskStatus:'',taskOrder:'priority',timeView:'layout',linkStart:null});
  if (dialog.open) dialog.close();
  if (item) showTask(item.id);
  else render();
}
function closeTask() {
  const opener=ui.taskReturn;
  ui.task=null;ui.taskReturn=null;ui.taskTrail=[];ui.focusNote=null;ui.replyNote=null;render();
  if (!opener) return;
  [...app.querySelectorAll('[data-action]')].find(node=>node.dataset.action===opener.action&&node.dataset.value===opener.value)?.focus({preventScroll:true});
}
taskDialog.addEventListener('cancel',event=>{event.preventDefault();closeTask();});
function showTask(id,detail='details') {
  if (!task(id)) return;
  if (!taskDialog.open) {
    ui.taskTrail=[];
    const trigger=document.activeElement?.closest('[data-action]');
    ui.taskReturn=trigger ? {action:trigger.dataset.action,value:trigger.dataset.value} : null;
  }
  const different=ui.task!==id || ui.detail!==detail;
  if (different && taskDialog.querySelector('.task-scroll')) taskDialog.querySelector('.task-scroll').scrollTop=0;
  if (ui.task!==id) ui.replyNote=null;
  ui.task=id; ui.detail=detail;
  render();
  if (different) taskDialog.querySelector('[data-action="close-task"]')?.focus({preventScroll:true});
}
const canChange = item => Boolean(item?.canEdit && !item.archived && isActiveProject(project(item.project)));
function taskMoveError(item,target) {
  if (!canChange(item)) return 'Only a task owner, project owner or admin can move this task.';
  const flow=project(item.project);
  if (!Object.hasOwn(statuses,target)) return 'Choose a valid status.';
  if (item.status===target) return '';
  if (item.status==='idea' && target!=='backlog') return 'Move the idea to Backlog first.';
  if (target==='idea' && (item.status!=='backlog'||flow.edges.some(edge=>edge.includes(item.id))||
      flow.loops.some(loop=>loop.from===item.id||loop.to===item.id)||flow.layoutArrows.some(arrow=>arrow.from===item.id||arrow.to===item.id)||flow.groups.some(group=>group.members.includes(item.id)))) {
    return 'Ideas need to be in Backlog with no workflow connections.';
  }
  if (item.status==='done') {
    if (target!=='backlog') return 'Reopen this task in Backlog first.';
    const downstream=[...reachable(flow,item.id)].slice(1).map(taskRecord);
    if (downstream.some(dependent=>['doing','done'].includes(dependent?.status))) return 'Reopen the downstream work before reopening this task.';
  }
  if ((target==='doing'||target==='done') && hasBlockers(item)) return 'Finish the prerequisite tasks first.';
  if (target==='done') {
    if (!availableDetails.has(item.id) && ui.task===item.id) return 'Wait for task details to load.';
    if (item.status!=='doing') return 'Start this task before moving it to Done.';
    if (!checklistReady(item)||rounds(item).some(loop=>!loop.optional&&loop.count<loop.target)) {
      return 'Complete the checklist, Definition of Done and review rounds first.';
    }
  }
  return '';
}
function changeStatus(item,target) {
  if (!item||item.status===target) return;
  const error=taskMoveError(item,target);
  if (error) return announce(error,'danger');
  if (target!=='idea'&&needsSchedule(item)) return scheduleTaskDialog(item.id,target);
  runWrite(()=>workspaceApi.patch(item,{status:canonicalStatus[target]}));
}
function passDialog(item,loop) {
  formDialog(loop.from===loop.to?'Record review pass':'Send back for review changes','pass-form',
    `<input type="hidden" name="id" value="${loop.id}"><p class="dim">Pass ${loop.count+1} of ${loop.target}. A note will be added to ${esc(item.title)}.</p>
    <label class="field">Review findings<textarea name="findings" required maxlength="1500" placeholder="What changed or what should the next pass address?"></textarea></label>`,'Record pass');
}
function mentionIds(body) {
  return data.team.filter(member=>[...body.matchAll(/(^|[\s(])@([a-z0-9-]+)/gi)].some(match=>match[2].toLowerCase()===member.handle)).map(member=>member.id);
}
function addNote(item,body,parentId=null) {
  const note={id:newId(),actor:ui.actor,body,at:new Date().toISOString(),mentions:mentionIds(body),parentId};
  item.notes.push(note);
  return note;
}
function repeatedTasks(flow,loop) {
  const backwards=reachable(flow,loop.from,true);
  return [...reachable(flow,loop.to)].filter(id=>backwards.has(id)).map(taskRecord).filter(Boolean);
}
function recordPass(form,fields) {
  const item=task(ui.task);
  const loop=rounds(item).find(candidate=>candidate.id===fields.get('id'));
  const findings=fields.get('findings').trim();
  if (!canChange(item) || !loop || !visibleLoop(loop) || item.status!=='doing' || hasBlockers(item) || !checklistReady(item) || loop.count>=loop.target) return formError(form,'This pass can no longer be recorded.');
  if (!findings) return formError(form,'Write the review findings.');
  const flow=project(item.project);
  return runWrite(()=>workspaceApi.review(flow,loop.id,findings),result=>{dialog.close();showTask(String(result.task_id));},form);
}
function reopenTask(item) {
  changeStatus(item,'backlog');
}
function selectionName(flow,key) {
  if (key.startsWith('dependency:')) {
    const edge=graphParts(flow,canvasItems(flow)).visEdges.get(key.slice(11));
    return edge?`${edge.fromTitle} → ${edge.toTitle}`:'Task arrow';
  }
  if (key.startsWith('layout:')) {
    const arrow=flow.layoutArrows.find(arrow=>arrow.id===key.slice(7));
    return arrow?`${shapeTitle(flow,arrow.from)} → ${shapeTitle(flow,arrow.to)}`:'Layout arrow';
  }
  if (key.startsWith('loop:')) return 'Review loop';
  return shapeTitle(flow,key) || 'Workflow item';
}
function setBuilderSelection(key,extend=false) {
  if (!extend) ui.builderSelection.clear();
  if (key) {
    if (extend&&ui.builderSelection.has(key)) ui.builderSelection.delete(key);
    else ui.builderSelection.add(key);
  }
  render();
}
function editBuilderSelection() {
  const [key]=ui.builderSelection;
  const flow=currentProject();
  if (!key||ui.builderSelection.size!==1||!canEdit(flow?.id)) return;
  const kind=shapeKind(key);
  if (kind==='frame') editFrameDialog(shapeId(key));
  else if (kind==='group') editGroupDialog(flow,shapeId(key));
  else if (linkedNode(flow,key)) editProjectNode(key);
  else if (task(key)) editTaskDialog(task(key));
}
function canvasVersionTasks(flow) {
  return canvasItems(flow);
}
function versionPreview(snapshot,flow) {
  const available=new Set(canvasVersionTasks(flow).map(item=>item.id));
  const nodes=new Map(snapshot.nodes.filter(node=>available.has(node.id)).map(node=>[node.id,node]));
  const points=[...nodes.values()];
  const boxes=[...points.map(point=>({...point,width:0,height:0})),...snapshot.frames];
  if (!boxes.length) return '<p class="detail-empty">This canvas was empty.</p>';
  const x=Math.min(...boxes.map(point=>point.x))-56,y=Math.min(...boxes.map(point=>point.y))-56;
  const w=Math.max(...boxes.map(point=>point.x+point.width))-x+56,h=Math.max(...boxes.map(point=>point.y+point.height))-y+56;
  const position=box=>'<rect x="'+box.x+'" y="'+box.y+'" width="'+box.width+'" height="'+box.height+'" rx="10"/>';
  return `<svg class="canvas-version-map" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Saved positions of ${points.length} visible task circles and ${snapshot.frames.length} frames">
    ${snapshot.frames.map(position).join('')}
    ${snapshot.edges.filter(([a,b])=>nodes.has(a)&&nodes.has(b)).map(([a,b])=>{
      const from=nodes.get(a),to=nodes.get(b);
      return `<path d="M${from.x} ${from.y} L${to.x} ${to.y}"/>`;
    }).join('')}
    ${points.map(point=>`<circle cx="${point.x}" cy="${point.y}" r="29"><title>${esc(workflowShape(flow,point.id)?.title)}</title></circle>`).join('')}
  </svg>`;
}
function showCanvasVersions(id='') {
  const flow=currentProject();
  if (!canEdit(flow?.id)) return;
  const versions=flow.canvasVersions||[];
  const version=versions.find(entry=>entry.id===id)||versions[0];
  showDialog('Canvas versions',`<form id="canvas-version-form" class="canvas-version-save">
    ${textField('name','Name this layout','',70)}<button type="submit" class="btn primary">${symbol('plus')} Save version</button>
    <p class="form-error" role="alert" hidden></p></form>
    ${version?`<div class="canvas-version-list">${versions.map(entry=>`<button type="button" class="version-choice" data-action="canvas-versions" data-value="${entry.id}" aria-pressed="${version.id===entry.id}"><strong>${esc(entry.name)}</strong><small>${esc(ownerName(entry.actor))} · ${esc(shortTime(entry.at))}</small></button>`).join('')}</div>
      <div class="canvas-version-preview">${versionPreview(version.snapshot,flow)}</div>
      <p class="dim version-scope">Restore the layout, arrows and groups. Task details, progress and access stay current.</p>
      <div class="form-actions">${button('restore-canvas-version','Review restore','undo','',version.id)}</div>`:'<div class="detail-empty">Save a version to preview or restore this layout later.</div>'}`);
  if (id) dialog.querySelector(`[data-action="canvas-versions"][data-value="${version?.id}"]`)?.focus({preventScroll:true});
}
function saveCanvasVersion(form,fields,flow) {
  if (!canEdit(flow?.id)) return;
  const name=fields.get('name').trim();
  if (!name) return formError(form,'Enter a version name.');
  return runWrite(()=>workspaceApi.canvasVersion(flow,'version',{name}),result=>showCanvasVersions(result.id),form);

}
function confirmCanvasRestore(id) {
  const flow=currentProject();
  const version=flow?.canvasVersions?.find(entry=>entry.id===id);
  if (!canEdit(flow?.id)||!version) return;
  formDialog('Restore canvas layout?','canvas-restore-form',
    `<input type="hidden" name="id" value="${version.id}">
      <p class="version-scope">Restore <strong>${esc(version.name)}</strong> for tasks still on this canvas. A backup of the current version will be saved first.</p>`,'Restore layout');
}
function applyCanvasRestore(form,fields,flow) {
  const version=flow?.canvasVersions?.find(entry=>entry.id===fields.get('id'));
  if (!canEdit(flow?.id)||!version) return;
  return runWrite(()=>workspaceApi.canvasVersion(flow,'restore',{version_id:version.id}),()=>dialog.close(),form);
}

function canvasSnapshot(flow) {
  ui.canvasUndo.push({
    flow:flow.id,
    shape:structuredClone({edges:flow.edges,groups:flow.groups,frames:flow.frames,loops:flow.loops,projectNodes:projectNodes(flow),
      layoutArrows:flow.layoutArrows,removedLoops:flow.removedLoops || [],layoutReady:Boolean(flow.layoutReady)}),
    nodes:data.tasks.filter(item=>item.project===flow.id).map(item=>({id:item.id,x:item.x,y:item.y,archived:Boolean(item.archived)}))
  });
}
function undoCanvas() {
  const flow=currentProject(), snapshot=ui.canvasUndo.at(-1);
  if (!canEdit(flow?.id)||snapshot?.flow!==flow.id) return;
  if (!snapshot.canvas||snapshot.revision!==flow.canvasRevision) {
    ui.canvasUndo=[];
    render();
    return announce('The canvas changed elsewhere. Reopen the canvas to continue.','danger');
  }
  runWrite(()=>workspaceApi.canvas(flow,snapshot.canvas),()=>{
    ui.canvasUndo.pop();
    const previous=ui.canvasUndo.at(-1);
    if (previous?.flow===flow.id) previous.revision=project(flow.id).canvasRevision;
    resetBuilder();
  });
}
function removeBuilderSelection() {
  const flow=currentProject();
  if (!ui.editor||!canEdit(flow?.id)||!ui.builderSelection.size) return;
  const keys=[...ui.builderSelection];
  const nodes=projectTasks(flow.id).filter(item=>keys.includes(item.id));
  const edgeKeys=new Set();
  const model=graphParts(flow,canvasItems(flow));
  for (const key of keys.filter(key=>key.startsWith('dependency:'))) {
    for (const edge of model.visEdges.get(key.slice(11))?.edges || []) edgeKeys.add(edge.join('/'));
  }
  canvasSnapshot(flow);
  for (const node of nodes) node.archived=true;
  if (flow.projectNodes) flow.projectNodes=flow.projectNodes.filter(node=>!ui.builderSelection.has(node.id));
  flow.edges=flow.edges.filter(edge=>!edgeKeys.has(edge.join('/'))&&!edge.some(id=>ui.builderSelection.has(id)));
  flow.groups=flow.groups.filter(group=>!ui.builderSelection.has(groupKey(group.id))).map(group=>({
    ...group,members:group.members.filter(id=>!ui.builderSelection.has(id))
  })).filter(group=>group.members.length>=2);
  flow.frames=flow.frames.filter(frame=>!ui.builderSelection.has(frameKey(frame.id)));
  flow.layoutArrows=flow.layoutArrows.filter(arrow=>!ui.builderSelection.has('layout:'+arrow.id)&&shapeExists(flow,arrow.from)&&shapeExists(flow,arrow.to));
  const removedLoops=flow.loops.filter(loop=>ui.builderSelection.has('loop:'+loop.id)||ui.builderSelection.has(loop.from)||
    ui.builderSelection.has(loop.to)||loop.from!==loop.to&&!reachable(flow,loop.to).has(loop.from));
  if (removedLoops.length) {
    flow.removedLoops ||= [];
    flow.removedLoops.push(...removedLoops);
    flow.loops=flow.loops.filter(loop=>!removedLoops.includes(loop));
  }
  resetBuilder();
  record(nodes.length===1?'Removed task '+nodes[0].title:'Removed workflow items',nodes.length===1?nodes[0]:null,flow.id,{relatedTasks:nodes.map(item=>item.id)},true);
  render();announce(nodes.length?'Task removed from the workflow and archived.':'Removed from the workflow.');
  document.querySelector('[data-action="undo-canvas"]')?.focus({preventScroll:true});
}
function tidyCanvas() {
  const flow=currentProject();
  if (!canEdit(flow?.id)) return false;
  const items=[...rawProjectTasks(flow.id),...projectNodes(flow)];
  const improved=tidyWorkflow(flow,items);
  const changes=[
    ...[...improved.tasks].map(([id,box])=>[linkedNode(flow,id)||taskRecord(id),box]),
    ...[...improved.frames].map(([id,box])=>[flow.frames.find(item=>item.id===id),box])
  ].filter(([item,box])=>Object.entries(box).some(([field,value])=>item[field]!==value));
  if ((items.length||flow.frames.length)&&(changes.length||!flow.layoutReady)) {
    canvasSnapshot(flow);
    for (const [item,box] of changes) Object.assign(item,box);
    flow.layoutReady=true;
    persistCanvas(flow);
  }
  ui.timeView='layout';ui.zoom=null;
  document.querySelector('.canvas')?.scrollTo(0,0);
  return changes.length>0;
}

function resetBuilder() {
  ui.placement=null;
  ui.builderTool='select';
  ui.builderSelection.clear();
  ui.linkStart=null;
}
function freeTaskPosition(projectId) {
  const used=[...rawProjectTasks(projectId),...projectNodes(project(projectId))];
  let index=0,x=90,y=100;
  while (used.some(other=>Math.hypot(x-other.x,y-other.y)<85)) {
    index++;x=90+index%7*111;y=100+Math.floor(index/7)*99;
  }
  return {x,y};
}
function startCircle(point) {
  if (!ui.editor || !canEdit(ui.project)) return;
  resetBuilder();
  ui.placement={kind:'circle',x:Math.min(3900,Math.max(53,Math.round(point.x))),y:Math.min(3900,Math.max(56,Math.round(point.y)))};
  render();
  document.querySelector('#canvas-task-form input')?.focus();
}
function frameContents(flow,frame,items=[...rawProjectTasks(flow.id).filter(item=>item.status!=='idea'),...projectNodes(flow)]) {
  return [frame,...flow.frames.filter(other=>containsFrame(frame,other)),...items.filter(item=>containsPoint(frame,item))];
}
function frameAtPoint(flow,point) {
  const nearest=frameHierarchy(flow.frames).slice().reverse().find(({frame})=>containsPoint(frame,point));
  return nearest ? frameKey(nearest.frame.id) : '';
}
function startRectangle(box) {
  if (!ui.editor||!canEdit(ui.project)) return;
  resetBuilder();
  ui.placement={kind:'frame',...box};
  render();
  document.querySelector('#canvas-task-form input')?.focus();
}
function editFrameDialog(id) {
  const flow=currentProject();
  if (!ui.editor||!canEdit(flow?.id)) return;
  const frame=flow.frames.find(item=>item.id===id);
  if (!frame) return;
  editorDialog('Edit rectangle','frame-form','rectangle',`<input type="hidden" name="id" value="${frame.id}">
    <div class="editor-section">${textField('title','Rectangle name',frame.title,80)}
    <div class="frame-fields">${[['x','Left',16,3790],['y','Top',16,3824],['width','Width',110,3884],['height','Height',76,3884]].map(([key,label,min,max])=>
      `<label class="field">${label}<input type="number" name="${key}" required min="${min}" max="${max}" value="${frame[key]}"></label>`).join('')}</div>
    ${button('remove-frame','Remove rectangle','trash','ghost',frame.id)}</div>`,'Save rectangle');
}
function saveFrame(form,fields,flow) {
  if (!ui.editor||!canEdit(flow.id)) return;
  const frame=flow.frames.find(item=>item.id===fields.get('id'));
  if (!frame) return;
  const title=fields.get('title').trim();
  if (!title) return formError(form,'Name the rectangle.');
  const x=Number(fields.get('x')),y=Number(fields.get('y'));
  const resized=frameBox({x,y},{x:x+Number(fields.get('width')),y:y+Number(fields.get('height'))});
  const dx=resized.x-frame.x,dy=resized.y-frame.y;
  for (const item of frameContents(flow,frame)) {item.x+=dx;item.y+=dy;}
  Object.assign(frame,resized,{title});
  persistCanvas(flow,()=>dialog.close(),form);
}
function shapeTitle(flow,key) {
  if (shapeKind(key)==='frame') return flow.frames.find(item=>item.id===shapeId(key))?.title;
  if (shapeKind(key)==='group') return flow.groups.find(item=>item.id===shapeId(key)&&visibleGroup(item))?.title;
  const item=workflowShape(flow,key);
  return item?.project===flow.id&&!item.archived&&item.status!=='idea'?item.title:undefined;
}
function connectShapes(flow,from,to) {
  if (!canEdit(flow.id)||!shapeTitle(flow,from)||!shapeTitle(flow,to)) return;
  if (shapeKind(from)==='frame'||shapeKind(to)==='frame') {
    if (from===to || flow.layoutArrows.some(arrow=>arrow.from===from&&arrow.to===to)) return;
    flow.layoutArrows.push({id:newId(),from,to});
    return persistCanvas(flow,()=>{ui.linkStart=null;});
  }
  const result=connectEdges(flow,endpointMembers(flow,from),endpointMembers(flow,to));
  if (result.error) return announce(result.error,'danger');
  if (linkedNode(flow,from)||linkedNode(flow,to)) {
    flow.edges=result.edges;
    return persistCanvas(flow,()=>{ui.linkStart=null;});
  }
  const edges=result.edges.filter(([a,b])=>!flow.edges.some(([prior,next])=>prior===a&&next===b));
  runWrite(()=>workspaceApi.dependencies(edges.map(([a,b])=>({from:a,to:b,action:'add'}))),()=>{
    ui.linkStart=null;
  });
}
function showLayoutArrows() {
  const flow=currentProject();
  if (!canEdit(flow?.id)) return;
  showDialog('Layout arrows',`<div class="search-results">${flow.layoutArrows.filter(arrow=>shapeTitle(flow,arrow.from)&&shapeTitle(flow,arrow.to)).map(arrow=>`<div class="detail-line">
    <span>${esc(shapeTitle(flow,arrow.from))} → ${esc(shapeTitle(flow,arrow.to))}</span>
    ${iconButton('remove-layout-arrow','Remove layout arrow','close',arrow.id)}</div>`).join('')||'<p class="dim">Draw an arrow from or to a rectangle.</p>'}</div>`);
}

function createWorkflowTask(flow,status,point,fields) {
  const created={id:idFor('task',data.tasks),project:flow.id,icon:'circle',status,x:point.x,y:point.y,notes:[],...fields};
  data.tasks.push(created);
  recordTask('Created '+created.title,created,{kind:'create',recipients:recipientsFor(created.owners,'assigned')});
  return created;
}
function saveCanvasTask(form,fields,flow) {
  if (!flow||!canEdit(flow.id)||!ui.placement) return;
  const preset=taskPresets(flow.area).find(entry=>entry.id===fields.get('preset'));
  const title=fields.get('title').trim()||preset?.title;
  if (!title) return formError(form,ui.placement.kind==='frame'?'Name the rectangle.':'Enter a task name.');
  if (ui.placement.kind==='frame') {
    const {x,y,width,height}=ui.placement;
    const frame={id:idFor('rectangle',flow.frames),title,x,y,width,height};
    flow.frames.push(frame);
    resetBuilder();ui.builderSelection.add(frameKey(frame.id));ui.timeView='layout';
    record('Drew rectangle '+title,null,flow.id);
    render();announce('Rectangle added.');
    return;
  }
  const duration=fields.get('durationDays');
  const issue=durationIssue(duration);
  if (issue) return formError(form,issue);
  const created=createWorkflowTask(flow,'backlog',ui.placement,{
    title,description:'', owners:[flow.owner||ui.actor],collaboratorIds:[],durationDays:Number(duration),importance:5,
    checklist:(preset?.checklist||[]).map(label=>({label,done:false})),
    dod:(preset?.dod||[]).map(label=>({label,done:false}))
  });
  resetBuilder();ui.builderSelection.add(created.id);
  render();
  document.querySelector(`.node[data-value="${created.id}"]`)?.focus({preventScroll:true});
  announce('Task circle added.');
}
function connectEdges(flow,from,to) {
  const next={...flow,edges:flow.edges.slice()};
  for (const start of from) for (const end of to) {
    const fromItem=workflowShape(flow,start),toItem=workflowShape(flow,end);
    if (fromItem?.project!==flow.id||toItem?.project!==flow.id) return {error:'Choose two steps in this workflow.'};
    if (reachable(next,end).has(start)) return {error:'This dependency would create a cycle. Use a review loop for repeated work.'};
    if (next.edges.some(([a,b])=>a===start&&b===end)) continue;
    if (!toItem.targetProjectId&&['doing','done'].includes(toItem.status)&&(fromItem.status!=='done'||hasBlockers(fromItem))) return {error:'A task already started cannot gain an unfinished prerequisite.'};
    next.edges.push([start,end]);
  }
  if (next.edges.length===flow.edges.length) return {error:'These tasks are already connected.'};
  if (flow.groups.some(group=>group.members.some(id=>group.members.some(other=>other!==id&&reachable(next,id).has(other))))) {
    return {error:'This dependency makes two tasks in a parallel group wait on one another.'};
  }
  return {edges:next.edges};
}
function selectBuilderShape(id,extend=false) {
  const flow=currentProject();
  const tool=ui.builderTool;
  const kind=shapeKind(id);
  if (tool==='select') {setBuilderSelection(id,extend);return;}
  if (tool==='group') {
    if (kind!=='task'||linkedNode(flow,id)) return;
    if (ui.builderSelection.has(id)) ui.builderSelection.delete(id);
    else ui.builderSelection.add(id);
    render();
    return;
  }
  if (['frame','place','project'].includes(tool)) return;
  if (tool==='loop'&&(kind!=='task'||linkedNode(flow,id))) {announce('Select a task circle for the review loop.');return;}
  if (!ui.linkStart) {ui.linkStart=id;render();return;}
  if (tool==='connect') {
    if (ui.linkStart===id) {ui.linkStart=null;render();return;}
    connectShapes(flow,ui.linkStart,id);
  }
  if (tool==='loop') {
    const from=ui.linkStart;
    if (from!==id&&!reachable(flow,id).has(from)) {
      announce('Choose an earlier task that leads to the review task.');
      return;
    }
    ui.linkStart=null;render();
    editLoopDialog(flow,'',{from,to:id});
  }
}
function builderGroup() {
  const flow=currentProject();
  if (!flow||!canEdit(flow.id)) return;
  const members=[...ui.builderSelection];
  if (members.length<2||members.some(id=>linkedNode(flow,id))) return;
  if (flow.groups.some(group=>group.members.some(id=>members.includes(id)))) {
    announce('Choose tasks that do not already belong to a parallel group.');
    return;
  }
  if (members.some(id=>members.some(other=>other!==id&&reachable(flow,id).has(other)))) {
    announce('Parallel tasks must be independent.');
    return;
  }
  const named=flow.groups.length?'Parallel tasks '+(flow.groups.length+1):'Parallel tasks';
  flow.groups.push({id:newId(),title:named,members});
  resetBuilder();
  persistCanvas(flow);
}
function builderOptions() {
  if (!canEdit(ui.project)) return;
  showDialog('Manage workflow',
    `<div class="builder-settings">
      ${button('tidy-canvas','Tidy layout','fit')}
      ${button('builder-tool','Draw review loop','loop','','loop')}
      ${button('dependencies','Task dependencies','link')}${button('layout-arrows','Layout arrows','flow')}
      ${button('groups','Parallel groups','board')}${button('loops','Review loops','loop')}
      ${button('move-task','Move by coordinates','fit')}
    </div>`);
}

function displayDateChange(previous,next) {
  const label=date=>date?asDate(date,true):'Unscheduled';
  return `<span class="date-comparison"><span class="date-before"><small>Current</small><del>${label(previous)}</del></span>${symbol('chevron')}<span class="date-after"><small>Proposed</small><strong>${label(next)}</strong></span></span>`;
}
function impactRows(title,rows,conflicts,dateFor) {
  if (!rows.length) return '';
  const conflictIds=new Set(conflicts.map(item=>item.id));
  return `<div class="impact-group"><h4>${title} <span>${rows.length}</span></h4><ul>
    ${rows.map(row=>{
      const date=dateFor(row);
      const conflict=conflictIds.has(row.id);
      return `<li class="${conflict?'impact-warning':''}"><span>${esc(row.title)}</span>
        <span>${conflict?symbol('alert')+' Conflict · ':''}${date?asDate(date,true):'Unscheduled'}</span></li>`;
    }).join('')}</ul></div>`;
}
function scheduleImpactMarkup(flow,nextPlans,changedTask=null,durationDays=null) {
  const before=projectSchedules.get(flow.id),after=nextPlans.get(flow.id);
  const moved=projectTasks(flow.id).filter(item=>{
    const from=before.dates.get(item.id), to=after.dates.get(item.id);
    return item!==changedTask&&(from?.startDate!==to?.startDate||from?.dueDate!==to?.dueDate);
  });
  const affected=[...(flow.milestones||[])].filter(entry=>!entry.completed && entry.tasks.some(id=>{
    const next=after.dates.get(id)?.handoffDate;
    return next>entry.deadline&&next!==before.dates.get(id)?.handoffDate;
  }));
  const linkedProjects=data.projects.filter(other=>other!==flow&&isActiveProject(other)&&
    projectSchedules.get(other.id)?.finish!==nextPlans.get(other.id)?.finish);
  const deferred=affected.length?`<p class="impact-warning">${symbol('alert')} Planned work would finish after ${affected.length} milestone ${affected.length===1?'target':'targets'}.</p>`:'';
  return `<div class="impact-dates">
    ${changedTask?`<p><span>Task duration</span> <strong>${durationDays?daysLabel(durationDays):'Not estimated'}</strong></p>`:''}
    <p><span>Estimated project finish</span> ${displayDateChange(before.finish,after.finish)}</p>
    </div>
    ${impactRows('Tasks with shifted dates',moved,[],item=>after.dates.get(item.id)?.dueDate)}
    ${impactRows('Milestone targets',affected,affected,entry=>entry.deadline)}
    ${impactRows('Linked projects with shifted finishes',linkedProjects,[],other=>nextPlans.get(other.id)?.finish)}
    ${deferred}`;
}
function scheduleTaskDialog(id,target='') {
  const item=task(id);
  if (!canChange(item)) return;
  formDialog('Set task duration','task-schedule-form',`<input type="hidden" name="id" value="${esc(item.id)}">
    <input type="hidden" name="target" value="${esc(target)}">
    <p class="schedule-task-name">${symbol(item.icon)} <strong>${esc(item.title)}</strong></p>
    ${durationField(item.durationDays)}<div data-schedule-impact hidden></div>`,target&&statuses[target]?'Set duration and move to '+statuses[target]:'Save duration');
  dialog.querySelector('[name="durationDays"]').focus();
}
function saveTaskSchedule(form,fields) {
  const item=task(fields.get('id'));
  if (!canChange(item)) return;
  const duration=fields.get('durationDays'), target=fields.get('target');
  const issue=durationIssue(duration);
  if (issue) return formError(form,issue);
  return runWrite(()=>workspaceApi.patch(item,{duration_days:Number(duration),
    ...(target?{status:canonicalStatus[target]}:{})}),()=>dialog.close(),form);
}
function workflowScheduleDialog(id) {
  const flow=project(id);
  if (!isActiveProject(flow)||!canManageProject(flow)) return;
  formDialog('Project schedule','workflow-schedule-form',`<input type="hidden" name="id" value="${esc(id)}">
    <label class="field">Project start date<input type="date" name="scheduleStart" value="${esc(flow.scheduleStart)}" required></label>
    <label class="field">Finish time on the last day (Tehran)<input type="time" name="scheduleEndTime" value="${esc(projectCutoff(flow))}" required></label>
    <p class="dim">Task durations, dependencies, and review loops determine the finish date.</p>
    <div data-schedule-impact hidden></div>`,'Save project schedule');
}
function saveWorkflowSchedule(form,fields) {
  const flow=project(fields.get('id'));
  if (!isActiveProject(flow)||!canManageProject(flow)) return;
  const startDate=fields.get('scheduleStart'),endTime=fields.get('scheduleEndTime');
  if (!isScheduleDate(startDate)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return formError(form,'Set a valid project start date and finish time.');
  if (flow.scheduleStart!==startDate&&reviewSchedule(form,[flow.id,startDate,endTime],()=>scheduleImpactMarkup(flow,
    workspaceSchedules(data,{projectId:flow.id,startDate})))) return;

  flow.scheduleStart=startDate;flow.scheduleEndTime=endTime;
  persistCanvas(flow,()=>dialog.close(),form);
}
function reviewSchedule(form,values,content) {
  const signature=JSON.stringify(values);
  if (form.dataset.approvedImpact===signature) return false;
  const preview=form.querySelector('[data-schedule-impact]');
  if (form.getAttribute('id')==='task-form') showEditorSection(form,'schedule');
  form.dataset.reviewImpact=signature;
  form.querySelector('[type="submit"]').hidden=true;
  form.querySelector('.form-error').hidden=true;
  preview.hidden=false;
  preview.className='schedule-impact';
  preview.innerHTML=`<h3 tabindex="-1">Schedule impact preview</h3>
    ${typeof content==='function'?content():content}
    <div class="impact-actions">${button('apply-schedule','Apply schedule change','check','primary')}</div>`;
  preview.querySelector('h3').focus();
  return true;
}
function resetScheduleReview(form) {
  delete form.dataset.reviewImpact;
  delete form.dataset.approvedImpact;
  form.querySelector('[data-schedule-impact]').hidden=true;
  form.querySelector('[type="submit"]').hidden=false;
}

function saveTask(form,fields) {
  const item=task(fields.get('id'));
  const flow=item ? project(item.project) : currentProject();
  if (item ? !canChange(item) : !canCreateTask(flow?.id)) return;
  const title=fields.get('title').trim();
  const owners=fields.getAll('owners');
  const status=fields.get('startingStatus')||'backlog';
  const duration=fields.get('durationDays');
  const issue=durationIssue(duration,(item?.status||status)!=='idea');
  if (issue) return editorError(form,'schedule',issue,form.elements.durationDays);
  const definition=fields.getAll('dod').map(label=>label.trim()).filter(Boolean).join('\n');
  if (!title) return editorError(form,'details','Enter a task name.',form.elements.title);
  if (owners.length!==1) return editorError(form,'details','Select one accountable owner.');
  if (!definition) return editorError(form,'checklist','Enter the Definition of Done.');
  const changes={
    title,description:fields.get('description').trim(),owner_id:Number(owners[0]),
    contributor_ids:fields.getAll('contributors').map(Number),
    priority:priorityByImportance(Number(fields.get('importance'))),
    definition_of_done:definition, duration_days:duration ? Number(duration) : null,
    checklist:fields.getAll('checklist').map(text=>text.trim()).filter(Boolean),
  };
  if (fields.has('visibility')) {
    changes.visibility=fields.get('visibility');
    changes.allowed_members=changes.visibility==='private'?fields.getAll('allowedMembers').map(Number):[];
  }
  const request=()=>item ? workspaceApi.patch(item,changes) : workspaceApi.create({...changes,
    project_id:flow.id==='unassigned'?null:Number(flow.id), status:canonicalStatus[status],
    client_create_id:form.dataset.createId ||= newId(),
  });
  return runWrite(request,result=>{
    dialog.close();
    ui.task=String(result.id);
    ui.detail='details';
  },form);
}
function saveWorkflow(form,fields) {
  const areaId=fields.get('area');
  if (!canManageArea(areaId)) return;
  const title=fields.get('title').trim();
  const draft=project(fields.get('id'));
  const owner=person(fields.get('owner'))?.id || '';
  const error=!title?'Enter a project name.':data.projects.some(flow=>flow!==draft&&flow.area===areaId&&flow.title.toLowerCase()===title.toLowerCase())?'A project with this name already exists in this area.':'';
  if (error) {
    if (!draft) setKickoffStep(form,'details');
    return editorError(form,'details',error,form.elements.title);
  }
  const template=draft?null:templateById(fields.get('template'));
  if (!draft&&template&&form.dataset.reviewedTemplate!==template.id) {
    if (form.dataset.section==='template-preview') {
      form.dataset.reviewedTemplate=template.id;
      return setKickoffStep(form,'kpis');
    }
    form.querySelector('[data-editor-section="template-preview"]').innerHTML=templateOverview(template);
    return setKickoffStep(form,'template-preview');
  }
  if (!draft && form.dataset.section!=='kpis') return setKickoffStep(form,'kpis');
  const scheduleStart=fields.get('scheduleStart'),templateDuration=fields.get('templateDuration');
  if (!draft&&!isScheduleDate(scheduleStart)) {
    setKickoffStep(form,'details');
    return editorError(form,'details','Set the project start date.',form.elements.scheduleStart);
  }
  if (template?.tasks.some(item=>!item.idea&&!isDuration(item.durationDays))&&!isDuration(templateDuration))
    return editorError(form,'kpis','Set a default duration in days for the template tasks.',form.elements.templateDuration);
  const kpis=[];
  if (!draft) {
    const names=new Set();
    for (const [i,{label,target}] of kickoffMetrics(fields).entries()) {
      if (!label&&!target) continue;
      const name=label.toLowerCase();
      const row=form.querySelectorAll('.kickoff-row')[i];
      if (!label||!target) return editorError(form,null,'Enter both a metric and its target.',row.querySelector(label?'[name="kpi-target"]':'[name="kpi-label"]'));
      if (names.has(name)) return editorError(form,null,'This metric already exists.',row.querySelector('[name="kpi-label"]'));
      names.add(name);kpis.push({label,target,id:newId(),result:''});
    }
  }
  if (!owner) return editorError(form,'details','Choose a project owner.');
  const changes={
    title,description:fields.get('description').trim(),owner_id:Number(owner),
    process_id:areaId.startsWith('area-')?Number(areaId.slice(5)):null,
    start_date:scheduleStart,kpis,template:template?.id,duration:Number(templateDuration)||1,
  };
  return runWrite(()=>workspaceApi.project(draft,draft?'edit':'create',changes),result=>{
    dialog.close();
    openProject(String(result.id),null,'',!draft&&!template);
  },form);
}

function saveGroup(form,fields,flow) {
  const title=fields.get('title').trim();
  const members=fields.getAll('members');
  const existing=flow.groups.find(item=>item.id===fields.get('id'));
  if (!title) return formError(form,'Enter a group name.');
  if ((existing&&!visibleGroup(existing))||members.some(id=>task(id)?.project!==flow.id)) return formError(form,'Choose visible tasks in this workflow.');
  if (members.length<2) return formError(form,'Select at least two parallel tasks.');
  if (members.some(id=>members.some(other=>other!==id&&reachable(flow,id).has(other)))) return formError(form,'These tasks depend on one another. Parallel tasks must be independent.');
  const group={id:existing?.id||newId(),title,members};
  if (existing) Object.assign(existing,group);
  else flow.groups.push(group);
  persistCanvas(flow,()=>dialog.close(),form);
}
function saveDependency(form,fields,flow) {
  const remove=fields.get('remove');
  const from=endpointMembers(flow,fields.get('from'));
  const to=endpointMembers(flow,fields.get('to'));
  if (remove && (from.length || to.length)) return formError(form,'Add or remove a dependency in a single change.');
  const edge=remove ? flow.edges[Number(remove)] : null;
  if (!edge && (!from.length || !to.length)) return formError(form,'Choose both endpoints or an existing dependency to remove.');
  const changes=edge ? [{from:edge[0],to:edge[1],action:'remove'}]
    : from.flatMap(a=>to.map(b=>({from:a,to:b,action:'add'})));
  if (changes.every(change=>linkedNode(flow,change.from)||linkedNode(flow,change.to))) {
    if (edge) flow.edges=flow.edges.filter(item=>item!==edge);
    else flow.edges=[...flow.edges,...changes.map(change=>[change.from,change.to])];
    return persistCanvas(flow,()=>{ui.linkStart=null;dialog.close();},form);
  }
  return runWrite(()=>workspaceApi.dependencies(changes),()=>{ui.linkStart=null;dialog.close();},form);
}
function saveLoop(form,fields,flow) {
  const existing=flow.loops.find(loop=>loop.id===fields.get('id'));
  const from=fields.get('from'), to=fields.get('to'), target=Number(fields.get('target'));
  const count=existing?.count || 0;
  if (task(from)?.project!==flow.id||task(to)?.project!==flow.id||(existing&&!visibleLoop(existing))) return formError(form,'Choose visible tasks in this workflow.');
  if (from!==to&&!reachable(flow,to).has(from)) return formError(form,'Choose an earlier task that has a dependency path to the review task.');
  if (flow.loops.some(loop=>loop!==existing&&loop.from===from&&loop.to===to)) return formError(form,'This review loop already exists.');
  if (count>0&&(from!==existing.from||to!==existing.to)) return formError(form,'Keep the endpoints of a review loop once a pass has been recorded.');
  const optional=fields.has('optional');
  if (!optional&&task(from)?.status==='done'&&target>count) return formError(form,'Reopen the review task before requiring another pass.');
  const loop={ id:existing?.id||idFor('loop',flow.loops),from,to,target,count,optional };
  if (existing) Object.assign(existing,loop);
  else flow.loops.push(loop);
  return persistCanvas(flow,()=>dialog.close(),form);
}
function savePerson(form,fields) {
  if (!isAdmin()) return;
  const member=person(fields.get('id'));
  const name=fields.get('name').trim(), handle=fields.get('handle').trim().toLowerCase();
  const role=fields.get('role'), roleTitle=fields.get('roleTitle').trim(), color=fields.get('color');
  if (!name||!/^[a-z0-9-]+$/.test(handle)) return formError(form,'Enter a name and a handle using letters, digits or hyphens.');
  if (!['Admin','Member'].includes(role)) return formError(form,'Choose an available access level.');
  if (data.team.some(item=>item!==member&&item.handle===handle)) return formError(form,'That mention handle is already in use.');
  if (member?.id===ui.actor&&role!=='Admin') return formError(form,'Switch to another admin before changing your own admin role.');
  if (!member) return formError(form,'Choose an existing member.');
  return runWrite(()=>workspaceApi.profile(member.id,{name,handle,roleTitle,color,role:role.toLowerCase()}),()=>dialog.close(),form);
}
function saveArea(form,fields) {
  if (!isAdmin()) return;
  const group=area(fields.get('id'));
  const title=fields.get('title').trim(), lead=fields.get('lead');
  if (!title) return formError(form,'Enter a work area name.');
  if (data.areas.some(item=>item!==group&&item.title.toLowerCase()===title.toLowerCase())) return formError(form,'That work area already exists.');
  if (group&&!group.id.startsWith('area-')) return formError(form,'Choose a work area to edit.');
  return runWrite(()=>workspaceApi.area(group?.id,{action:'area',title,owner_id:lead?Number(lead):null}),()=>dialog.close(),form);
}
function periodFilter(scope) {
  return `<label class="period-control"><span class="sr-only">Filter by period</span><select data-period-filter="${scope}">${periodChoices.map(([id,label])=>option(id,label,ui.periods[scope]||'')).join('')}</select></label>`;
}
function activeCalendar() {
  const scope=ui.page==='calendar'?'team':ui.page==='mine'&&ui.myView==='calendar'?'mine':'project';
  return {scope,state:ui.calendars[scope]};
}
function calendarSource(scope,start,end) {
  const own=scope==='mine',specific=scope==='project';
  const flows=data.projects.filter(flow=>specific?flow.id===ui.project:projectInWork(flow));
  const included=new Set(flows.map(flow=>flow.id));
  const tasks=activeTasks().filter(item=>included.has(item.project)&&(!own||involved(item))&&item.status!=='idea');
  const taskIds=new Set(tasks.map(item=>item.id));
  const entries=tasks.map(item=>{
    const flow=project(item.project);
    return {kind:'task',action:'task',id:item.id,title:item.title,context:flow?.title,date:item.dueDate||item.startDate,
      startDate:item.startDate,durationDays:item.durationDays,deadline:isScheduleDate(item.dueDate),done:item.status==='done',needsSchedule:isOpen(item)&&!item.dueDate,
      owners:item.owners,area:flow?.area};
  });
  for (const flow of flows) for (const milestone of flow.milestones||[]) {
    if (own&&flow.owner!==ui.actor&&!milestone.tasks.some(id=>taskIds.has(id))) continue;
    entries.push({kind:'milestone',action:'calendar-project',id:flow.id,title:milestone.title,context:flow.title,
      date:milestone.deadline,done:milestone.completed,area:flow.area,owners:flow.owner?[flow.owner]:[]});
  }
  for (const meeting of meetingsInWindow(data,start,end)) {
    const refs=[...meeting.refs,...meeting.followups].filter(taskRefVisible);
    const related=refs.map(ref=>ref.startsWith('workflow:')?project(ref.slice(9)):ref.startsWith('task:')?project(task(ref.slice(5))?.project):null).filter(Boolean);
    if (own&&meeting.owner!==ui.actor&&!related.some(flow=>flow.owner===ui.actor)&&!refs.some(ref=>ref.startsWith('task:')&&taskIds.has(ref.slice(5)))) continue;
    if (specific&&!related.some(flow=>included.has(flow.id))) continue;
    const meta={id:meeting.id,title:meeting.title,date:meeting.date,owners:[meeting.owner],area:related[0]?.area,areas:related.map(flow=>flow.area)};
    if (!meeting.completedAt) entries.push({...meta,kind:'meeting',action:'open-meeting',context:ownerName(meeting.owner),
      time:meeting.time,end:meeting.end,repeat:Boolean(meeting.seriesId)});
    if (meeting.pinnedNote&&meeting.note?.trim()) entries.push({...meta,kind:'note',action:'open-pinned-meeting',
      context:meeting.time+' · '+ownerName(meeting.owner),pinned:true,text:meeting.note});
  }
  if (!specific) for (const note of data.calendarNotes) {
    if (own?note.actor!==ui.actor:note.visibility!=='team') continue;
    entries.push({kind:'note',action:'calendar-note',id:note.id,title:note.text.trim().split('\n')[0].slice(0,95),
      context:ownerName(note.actor)+(note.visibility==='personal'?' · Private':''),date:note.date,owners:[note.actor],pinned:note.pinned,text:note.text});
  }
  return {entries,areas:data.areas,team:data.team};
}
function getCalendarNote(id) {
  const note=data.calendarNotes.find(entry=>entry.id===id&&(entry.visibility==='team'||entry.actor===ui.actor));
  return note?{...note,editable:note.actor===ui.actor}:undefined;
}
function saveCalendarNote(form,{id,...fields}) {
  const entry=id?getCalendarNote(id):null;
  if (id&&!entry?.editable) return;
  runWrite(()=>workspaceApi.calendarNote(entry,entry?'PATCH':'POST',fields),()=>dialog.close(),form);
}
function removeCalendarNote(id) {
  const entry=getCalendarNote(id);
  if (!entry?.editable) return;
  runWrite(()=>workspaceApi.calendarNote(entry,'DELETE'),()=>dialog.close());
}
function createCalendar() {
  return calendarUI({esc,symbol,option,button,iconButton,userName:ownerName,formDialog,render,dialog,formError,
    saveNote:saveCalendarNote,removeNote:removeCalendarNote,getNote:getCalendarNote,source:calendarSource,getScope:activeCalendar,
    isDateEditor:scope=>scope!=='project',canPin:isAdmin});
}

function profilePage() {
  const member=currentActor();
  return hero('Personal workspace','My profile','')+
    `<div class="profile-layout"><aside class="panel profile-cover" style="--person:${esc(member.color)}">
      ${avatar(member,'large')}<h2>${esc(member.name)}</h2>
      ${member.pronouns?`<p>${esc(member.pronouns)}</p>`:''}<p>${esc(roleTitle(member))}</p>
      <span class="status">${symbol(member.role==='Admin'?'admin':'user')}${esc(member.role)}</span>
      </aside><section class="panel">
        <header class="panel-head"><h2>Profile settings</h2></header>
        <form id="profile-form" class="profile-fields">
          ${textField('name','Display name',member.name,80)}
          <label class="field">Pronouns <input type="text" name="pronouns" maxlength="40" autocomplete="off" value="${esc(member.pronouns)}" placeholder="Optional"></label>
          <label class="field">Gender <small>Optional · visible in this profile</small><input type="text" name="gender" maxlength="60" autocomplete="off" value="${esc(member.gender)}" placeholder="Prefer not to say"></label>
          <label class="field">Profile color <input type="color" name="color" value="${esc(member.color)}"></label>
          <div class="avatar-picker">
            <label class="field">Profile photo <input type="file" name="photo" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>
            ${member.photo?button('profile-remove-photo','Remove photo','trash','ghost'):''}
          </div>
          <p class="form-error" role="alert" hidden></p>
          <div class="form-actions"><button type="submit" class="btn primary">${symbol('check')} Save profile</button></div>
        </form>
      </section></div>`;
}
async function saveProfile(form,fields) {
  const submit=form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  const member=currentActor();
  const name=fields.get('name').trim();
  const pronouns=fields.get('pronouns').trim(),gender=fields.get('gender').trim(),color=fields.get('color');
  if (!name||!/^#[a-f\d]{6}$/i.test(color)) return formError(form,'Enter a display name and profile color.');
  const file=fields.get('photo');
  submit.disabled=true;
  try {
    const photo=file?.size?await profilePhoto(file):member.photo;
    await runWrite(()=>workspaceApi.profile(null,{name,pronouns,gender,color,photo}),null,form);
  } catch (error) {
    if (form.isConnected) formError(form,error.message||'The photo could not be opened.');
  } finally { submit.disabled=false; }
}

function reportControls(source) {
  return `<div class="report-download" role="group" aria-label="Report preview and downloads">
    ${button('preview-report','Preview','journal','ghost',source)}
    ${reportDownloads(source)}</div>`;
}
const reportDownloads=source=>
  button('export-report','PDF','download','ghost',source+'|pdf')+
  button('export-report','Markdown','download','ghost',source+'|md');
const reportText=(text,kind='text')=>({kind,text});
const reportHeading=text=>reportText(text,'heading');
const reportCheck=(text,done)=>({kind:'check',text,done});
const reportMeta=(...rows)=>rows.filter(([,value])=>value).map(([label,value])=>({label,value}));
const localReportTime=stamp=>stamp&&Number.isFinite(Date.parse(stamp))?
  asDate(today(stamp),true)+' · '+dayTime(stamp)+' (Tehran)':'';
function reportReference(ref,extras={}) {
  const [kind,id]=ref.split(':');
  if (kind==='task') {
    const item=task(id);
    if (!item) return null;
    const detail=[project(item.project)?.title,readableStatus(item),extras.detail].filter(Boolean).join(' · ');
    return {kind:extras.kind||kind,ref,text:item.title,detail};
  }
  const item=kind==='idea'?ideaRecord(id):kind==='workflow'?project(id):null;
  return item?{kind,ref,text:item.title,detail:area(item.area)?.title}:null;
}
async function buildReport(source,includeImages) {
  if (source==='daily'||source==='project-notebook') {
    const flow=source==='project-notebook'?currentProject():null;
    const entry=flow?flow.workReport:currentLog(ui.actor,ui.dailyDate),date=ui.dailyDate;
    if (!entry) return null;
    const events=new Map(visibleActivity().map(event=>[event.id,event]));
    const sections=[];
    for (const block of entry?.blocks||[]) {
      if (block.type==='heading'&&block.text) sections.push(reportHeading(block.text));
      if (['text','note'].includes(block.type)&&block.text) sections.push(reportText(block.text,block.type));
      if (block.type==='checklist') sections.push(...block.items.filter(item=>item.text.trim()).map(item=>reportCheck(item.text,item.done)));
      if (block.type==='image') {
        sections.push({kind:'image',text:block.caption||block.filename||'Attached image',imageId:block.id});
      }
      if (['task','meeting'].includes(block.type)) {
        const reference=reportReference('task:'+block.task,{kind:block.type,detail:meetingRecord(block.meeting)?.title});
        if (reference) sections.push(reference);
      }
      if (block.type==='activity'&&events.has(block.event)) {
        const event=events.get(block.event),related=task(event.task);
        sections.push({kind:'activity',text:event.text,body:event.body,ref:related?'task:'+related.id:'',
          detail:[project(event.project)?.title,localReportTime(event.at)].filter(Boolean).join(' · ')});
      }
    }
    const meta=reportMeta(['Writer',flow?ownerName(entry.author):currentActor().name],['Project',flow?.title],
      ['Report date',flow?'':asDate(date,true)],['Last saved',localReportTime(entry?.updatedAt)]);
    if (includeImages) await Promise.all(sections.filter(section=>section.imageId).map(async section=>{
      section.blob=await getImage(section.imageId).catch(()=>null);
    }));
    return {title:flow?'Project work report':'Daily work report',meta,sections,file:flow?flow.title+'-work-report':'daily-report-'+date};
  }
  if (source==='meeting') {
    const meeting=meetingRecord(ui.meeting);
    if (!meeting) return null;
    const sections=[];
    if (meeting.agenda.length) sections.push(reportHeading('Agenda'),...meeting.agenda.map(item=>reportCheck(item.text,item.done)));
    const links=meeting.refs.map(ref=>reportReference(ref)).filter(Boolean);
    const followups=meeting.followups.map(ref=>reportReference(ref)).filter(Boolean);
    if (links.length) sections.push(reportHeading('Discussion material'),...links);
    if (meeting.note) sections.push(reportText(meeting.note,'note'));
    if (followups.length) sections.push(reportHeading('Follow-up tasks'),...followups);
    const meta=reportMeta(['Writer',meeting.reportAuthor&&ownerName(meeting.reportAuthor)],
      ['Meeting owner',!meeting.reportAuthor||meeting.reportAuthor!==meeting.owner?ownerName(meeting.owner):''],
      ['Meeting date',asDate(meeting.date,true)],['Time',meeting.time+(meeting.end?' – '+meeting.end:'')+' (Tehran)'],
      ['Last saved',localReportTime(meeting.reportUpdatedAt)]);
    return {title:meeting.title,meta,sections,file:meeting.title+'-meeting-'+meeting.date};
  }
  const flow=currentProject();
  const report=source.startsWith('history-')?flow?.completions.find(item=>item.closedAt===source.slice(8)):
    isActiveProject(flow)?flow.draftReport:flow?.completions.at(-1);
  if (!flow||!report) return null;
  const closed=report.closedAt;
  const stats=report.tasksAtClose?.filter(row=>task(row.id));
  const meta=reportMeta(['Writer',ownerName(report.author)],['Written',localReportTime(report.updatedAt||closed)],
    ['Closed',closed!==report.updatedAt&&report.updatedAt?localReportTime(closed):''],['Work area',area(flow.area)?.title],
    ['Outcome',closed?(report.outcome==='failed'?'Failed':'Done'):'Draft']);
  const sections=[reportHeading(report.outcome==='failed'?'Failure reason':'Outcome summary'),reportText(report.body,'note')];
  if (stats?.length) sections.push(reportText(stats.filter(item=>item.done).length+'/'+stats.length+' visible tasks completed at closure.'));
  const kpis=report.kpis||flow.kpis;
  if (kpis.length) sections.push(reportHeading('Project KPIs'),...kpis.map(item=>reportText(item.label+' · Target '+item.target+' · '+(item.result||'Pending'))));
  return {title:flow.title,meta,sections,file:flow.title+'-closing-report'+(closed?'-'+today(closed):'')};
}
function clearReportPreview() {
  openReport=null;
  for (const url of reportImageUrls) URL.revokeObjectURL(url);
  reportImageUrls.clear();
}
async function previewWorkspaceReport(source,trigger) {
  trigger.disabled=true;
  try {
    const report=await buildReport(source,true);
    if (!report||!trigger.isConnected) return;
    trigger.disabled=false;
    showDialog('Report preview',`<div class="report-preview-toolbar" role="group" aria-label="Download this report">
      ${reportDownloads('preview')}</div><div class="report-preview-scroll">${reportPreview(report,{esc,symbol})}</div>`);
    dialog.classList.add('report-preview-dialog');
    openReport=report;
    for (const image of dialog.querySelectorAll('[data-report-image]')) {
      const url=URL.createObjectURL(report.sections[Number(image.dataset.reportImage)].blob);
      reportImageUrls.add(url);
      image.src=url;
    }
    dialog.querySelector('[data-action="close-dialog"]').focus({preventScroll:true});
  } catch { announce('The report preview could not be opened. Try again.','danger'); }
  finally { trigger.disabled=false; }
}
function openReportReference(ref) {
  const reference=reportReference(ref);
  if (!reference) return;
  const [kind,id]=ref.split(':');
  dialog.close();
  if (kind==='task') showTask(id);
  else if (kind==='idea') openIdea(id);
  else openProject(id);
}
async function exportWorkspaceReport(value,trigger) {
  const [source,format]=value.split('|');
  if (!['pdf','md'].includes(format)) return;
  trigger.disabled=true;
  try {
    const report=source==='preview'?openReport:await buildReport(source,format==='pdf');
    if (report) await downloadReport(report,format);
  } catch { announce('The report could not be downloaded. Try again.','danger'); }
  finally { trigger.disabled=false; }
}

function meetingChecklist(meeting) {
  const editable=Boolean(!meeting.completedAt&&data.canCreateTask);
  const complete=meeting.agenda.filter(entry=>entry.done).length;
  return `<div class="detail-line"><h3>${symbol('checklist')} Agenda</h3><small class="dim mono">${complete}/${meeting.agenda.length}</small></div>
    ${meeting.agenda.length?`<div class="check-progress"><span style="width:${100*complete/meeting.agenda.length}%"></span></div>
      <ul class="checks check-items">${meeting.agenda.map((entry,i)=>`<li><label for="agenda-${i}">
        <input type="checkbox" id="agenda-${i}" data-meeting-check="${esc(meeting.id)}" data-index="${i}" ${entry.done?'checked':''} ${editable?'':'disabled'}>
        <span>${esc(entry.text)}</span></label></li>`).join('')}</ul>`:'<p class="dim">No discussion items yet.</p>'}
    ${editable?`<form id="meeting-quick-check" class="inline-check-form">
      <input type="hidden" name="id" value="${esc(meeting.id)}">
      <input type="text" name="label" aria-label="New discussion item" placeholder="Add a discussion item" maxlength="160" required>
      <button type="submit" class="icon-btn" aria-label="Add discussion item" title="Add discussion item">${symbol('plus')}</button></form>`:''}`;
}
function addMeetingCheck(form,fields) {
  const meeting=meetingRecord(fields.get('id')),text=fields.get('label').trim();
  if (!meeting||meeting.completedAt||!text) return;
  if (meeting.agenda.some(entry=>entry.text.toLowerCase()===text.toLowerCase())) return announce('This item is already on the agenda.');
  return runWrite(()=>workspaceApi.meeting(meeting.id,{agenda_action:'add',agenda_text:text}),null,form);
}

const calendar=createCalendar();
function linkDetails(node) {
  const target=project(node.targetProjectId);
  const gate=projectGate(node,target);
  return {target,gate,requirement:gate.milestone?.title||(node.milestoneId?'Selected milestone':'Project complete')};
}
function linkPresentation(flow,node,gate) {
  return gate.state==='ready'&&hasBlockers({id:node.id,project:flow.id})
    ? {state:'waiting',label:'Waiting on earlier steps'} : gate;
}
function linkShape(flow,node) {
  const {target,gate}=linkDetails(node);
  return {...node,project:flow.id,title:target?.title||'Project unavailable',icon:'briefcase',
    owners:target?.owner?[target.owner]:[],status:linkPresentation(flow,node,gate).state==='ready'?'done':'backlog',
    startDate:'',dueDate:projectSchedules.get(flow.id)?.dates.get(node.id)?.dueDate||gate.milestone?.deadline||''};
}
function canvasItems(flow,items=projectTasks(flow.id)) {
  return [...items.filter(item=>item.status!=='idea'),...projectNodes(flow).map(node=>linkShape(flow,node))];
}
function workflowShape(flow,id) {
  const node=linkedNode(flow,id);
  return node?linkShape(flow,node):task(id);
}
function projectNodeView(flow,node) {
  const {target,gate}=linkDetails(node);
  const {label,state:tone}=linkPresentation(flow,node,gate);
  const selected=ui.builderSelection.has(node.id)||ui.linkStart===node.id;
  return `<button type="button" class="node linked-project-node gate-${tone} ${selected?'connect-source':''}"
    data-action="${ui.editor?'builder-shape':'view-project-node'}" data-value="${esc(node.id)}"
    aria-label="${esc(node.title+' · Linked project · '+label)}" title="${esc(target?.title||node.title)}"
    style="left:${node.x-linkedHalfWidth}px;top:${node.y-39}px">
    <span class="linked-node-mark">${symbol('briefcase')}${symbol('link','linked-node-chain')}</span>
    <strong>${esc(node.title)}</strong><small>${esc(label)}</small></button>
    ${ui.editor?shapePort(node.id,node.title,`left:${node.x+linkedHalfWidth-4}px;top:${node.y-8}px`):''}`;
}
function linkedReference(flow,node,interactive=true) {
  const {target,gate,requirement}=linkDetails(node);
  const {label,state}=linkPresentation(flow,node,gate);
  const content=simpleReference(target?.title||'Project unavailable',(area(target?.area)?.title||'Linked project')+' · '+requirement,'briefcase',
    `<small class="linked-reference-state gate-${state}">${esc(label)}</small>`);
  return interactive?`<button type="button" class="reference-tile" data-action="view-project-node" data-value="${esc(node.id)}">${content}</button>`:
    `<div class="reference-tile">${content}</div>`;
}
function dependencyReference(item) {
  const flow=project(item.project);
  const node=linkedNode(flow,item.id);
  return node?linkedReference(flow,node):taskLinkCard(item);
}
function showProjectNode(id) {
  const flow=data.projects.find(item=>linkedNode(item,id));
  const node=linkedNode(flow,id);
  if (!node) return;
  const {target,gate,requirement}=linkDetails(node);
  const {label,state}=linkPresentation(flow,node,gate);
  showDialog(target?.title||'Linked project',`<div class="linked-project-detail">
    <div class="linked-detail-top"><span class="status">${symbol('briefcase')}Linked project</span>
      ${target?projectStateChip(target):''}
      <span class="status gate-${state}">${symbol(state==='ready'?'check':state==='failed'?'alert':'lock')}${esc(label)}</span></div>
    ${target?`<p class="dim">${esc([area(target.area)?.title,target.owner?ownerName(target.owner):'Unassigned'].filter(Boolean).join(' · '))}</p>`:''}
    <div class="linked-requirement">${symbol('target')}<div><small>Handoff for ${esc(flow.title)}</small><strong>${esc(requirement)}</strong></div></div>
    <div class="form-actions">
      ${ui.editor&&ui.project===flow.id&&canEdit(flow.id)?button('edit-project-node','Edit link','edit','ghost',id):''}
      ${target?button('open-linked-project','Open project workflow','flow','primary',id):''}
    </div></div>`,'briefcase');
}
function milestoneOptions(target,selected='') {
  return option('','Whole project marked Done',selected)+(target?.milestones||[]).map(entry=>
    option(entry.id,entry.title+(entry.completed?' · Reached':''),selected)).join('');
}
function editProjectNode(id='',point=null) {
  const flow=currentProject();
  if (!ui.editor||!canEdit(flow?.id)) return;
  const prior=linkedNode(flow,id);
  if (id&&!prior) return;
  const candidates=data.projects.filter(item=>allowsProjectLink(data.projects,flow.id,item.id));
  if (!candidates.length) return announce('There are no eligible projects to link.');
  const selected=candidates.find(item=>item.id===prior?.targetProjectId);
  const options=option('','Choose a project',selected?.id||'')+candidates.map(item=>
    option(item.id,(area(item.area)?.title||'Workspace')+' / '+item.title,selected?.id)).join('');
  const location=point||prior||freeTaskPosition(flow.id);
  formDialog(prior?'Edit project link':'Add project node','linked-project-form',`
      <input type="hidden" name="id" value="${esc(id)}">
      <input type="hidden" name="x" value="${location.x}"><input type="hidden" name="y" value="${location.y}">
      ${selectField('target','Linked project',options)}
      ${selectField('milestone','Unlock following steps when',milestoneOptions(selected,prior?.milestoneId))}
      <p class="dim">Connect the project node with arrows to set the handoff order.</p>`,
    prior?'Save link':'Add project node');
}
function saveProjectNode(form,fields,flow) {
  if (!ui.editor||!canEdit(flow?.id)) return;
  const id=fields.get('id'),prior=linkedNode(flow,id);
  if (id&&!prior) return;
  const target=project(fields.get('target')),milestoneId=fields.get('milestone');
  if (!target) return formError(form,'Choose a project to link.');
  if (!allowsProjectLink(data.projects,flow.id,target.id)) return formError(form,'Choose a project that does not lead back to this workflow.');
  if (milestoneId&&!(target.milestones||[]).some(item=>item.id===milestoneId)) return formError(form,'Choose a milestone from the linked project.');
  const x=Number(fields.get('x')),y=Number(fields.get('y'));
  if (!Number.isFinite(x)||!Number.isFinite(y)) return;
  const node=prior||{id:'project-link-'+newId(),x:Math.min(3900,Math.max(75,Math.round(x))),y:Math.min(3900,Math.max(56,Math.round(y)))};
  canvasSnapshot(flow);
  Object.assign(node,{targetProjectId:target.id,milestoneId});
  if (!prior) {flow.projectNodes ||= [];flow.projectNodes.push(node);}
  resetBuilder();ui.builderSelection.add(node.id);
  return persistCanvas(flow,()=>dialog.close(),form);
}
function openLinkedProject(id) {
  const flow=data.projects.find(item=>linkedNode(item,id));
  const node=linkedNode(flow,id);
  if (!project(node?.targetProjectId)) return;
  const canvas=document.querySelector('.canvas');
  const atSource=ui.page==='area'&&ui.project===flow.id&&ui.view==='flow';
  ui.linkReturns.push({source:flow.id,target:node.targetProjectId,id,
    position:atSource&&canvas?[canvas.scrollLeft,canvas.scrollTop]:null,zoom:atSource?ui.zoom:null,timeView:atSource?ui.timeView:'layout'});
  openProject(node.targetProjectId,null,'flow');
}
function returnToLinkedNode() {
  const previous=ui.linkReturns.at(-1);
  if (!previous||previous.target!==ui.project) return;
  ui.linkReturns.pop();
  openProject(previous.source,null,'flow');
  if (previous.zoom!==null||previous.timeView!=='layout') {ui.zoom=previous.zoom;ui.timeView=previous.timeView;render();}
  const canvas=document.querySelector('.canvas');
  if (!canvas) return;
  if (previous.position) canvas.scrollTo(...previous.position);
  const node=[...canvas.querySelectorAll('.linked-project-node')].find(control=>control.dataset.value===previous.id);
  if (node) {
    node.classList.add('located-task');
    if (!previous.position) node.scrollIntoView({block:'nearest',inline:'center'});
    node.focus({preventScroll:true});
  }
}

const handlers = {
  ...calendar.handlers,
  'calendar-project':id=>openProject(id,null,'updates'),
  'profile-remove-photo':()=>runWrite(()=>workspaceApi.profile(null,{photo:null})),
  'preview-report':previewWorkspaceReport,
  'report-reference':openReportReference,
  'export-report':exportWorkspaceReport,
  'showroom-page':delta=>{ui.showroom.page+=Number(delta);refreshShowroom();document.querySelector('.showroom-tile')?.focus({preventScroll:true});},
  'showroom-reset':()=>{resetShowroom();render();},
  'showroom-reset-colors':()=>{
    const prefix=ui.showroom.color+':';
    const colors=Object.fromEntries(Object.entries(data.showroomColors).filter(([key])=>!key.startsWith(prefix)));
    runWrite(()=>workspaceApi.preferences(colors));
  },
  'open-idea':openIdea,
  'edit-idea':editIdeaDialog,
  'refer-idea':referIdea,
  'bring-idea':bringIdeaDialog,
  'open-meeting':openMeeting,
  'open-pinned-meeting':id=>{
    openMeeting(id);
    const note=app.querySelector('#meeting-report');
    note?.scrollIntoView({block:'start'});note?.focus({preventScroll:true});
  },
  'pin-meeting-note':toggleMeetingPin,
  'open-okr':openOkr,
  'network-open':openNetworkNode,
  'network-node':key=>{
    if (!networkState().inspect) return openNetworkNode(key);
    Object.assign(networkState(),{focus:key,selected:key});refreshNetwork({center:true});
  },
  'network-reveal':key=>{networkState().selected=key;networkState().focus=key;refreshNetwork({center:true});},
  'network-focus':key=>{networkState().focus=key||'';refreshNetwork({center:Boolean(key)});},
  'network-fit':fitNetwork,
  'network-zoom':step=>{networkState().zoom=Math.max(8,Math.min(160,networkState().zoom+Number(step)*15));refreshNetwork();},
  'select-kr':id=>{if (resultById(id)) {ui.kr=id;render();focusControl('select-kr',id);}},
  'okr-view':value=>{ui.okrsView=value;render();focusControl('okr-view',value);},
  'okr-check-in':okrCheckInDialog,
  'okr-edit-owner':okrOwnerDialog,
  'okr-link':okrLinkDialog,
  'okr-unlink':removeOkrLink,
  'okr-project-milestone':openOkrMilestone,
  'task-to-meeting':taskMeetingDialog,
  'meeting-done':toggleMeetingDone,
  'archive-view':view=>{if (['projects','meetings','tasks'].includes(view)) {ui.archiveView=view;render();}},
  'edit-meeting':editMeetingDialog,
  'meeting-series-window':repeatWindowDialog,
  'meeting-to-daily':meetingToDaily,
  'mobile-nav':()=>{ui.mobileOpen=!ui.mobileOpen;render();},
  theme:()=>{
    const theme=document.documentElement.dataset.theme==='light'?'dark':'light';
    document.documentElement.dataset.theme=theme;
    try {localStorage.setItem('gq-flow-theme',theme);} catch {}
    render();
  },
  search:searchDialog,
  'close-dialog':()=>dialog.close(),
  identity:identityDialog,
  'switch-person':id=>{
    if (!person(id)) return;
    ui.actor=id;ui.myView='focus';ui.projectReply=null;ui.focusProjectNote=null;ui.calendars.mine=calendarState();ui.inboxFilter='all';ui.mobileOpen=false;ui.editor=false;resetBuilder();ui.canvasUndo=[];ui.ownerFilter=null;ui.taskQuery='';ui.taskStatus='';ui.myProject='';ui.task=null;
    if (ui.page==='admin'&&!isAdmin()) ui.page='mine';
    dialog.close();dialog.replaceChildren();render();announce('Viewing as '+currentActor().name+'.');
  },
  page:id=>{ if (id==='admin'&&!isAdmin()) return; ui.page=id;ui.task=null;ui.editor=false;resetBuilder();ui.mobileOpen=false;render(); },
  area:chooseArea,
  'area-view':value=>{if (areaDashboard()) {ui.areaViews.set(ui.area,value);render();focusControl('area-view',value);}},
  'toggle-area':id=>{
    if (ui.expandedAreas.has(id)) ui.expandedAreas.delete(id);
    else ui.expandedAreas.add(id);
    render();
    app.querySelector(`[data-action="toggle-area"][data-value="${id}"]`)?.focus({preventScroll:true});
  },
  'inbox-filter':id=>{ui.inboxFilter=id;render();},
  'inbox-read-all':()=>{
    markRead(data,ui.actor,inboxEvents().filter(event=>!event.read).map(event=>event.id));
    save();render();
  },
  'inbox-read':id=>{
    if (!inboxEvents().some(event=>event.id===id)) return;
    markRead(data,ui.actor,[id]);save();render();
  },
  'daily-day':step=>{
    ui.dailyDate=dayAt(dayIndex(ui.dailyDate)+Number(step));render();
    app.querySelector(`[data-action="daily-day"][data-value="${step}"]`)?.focus();
  },
  'daily-today':()=>{ui.dailyDate=today();render();document.querySelector('#daily-date')?.focus();},
  'daily-block':type=>{
    if (type==='checklist') appendLogBlock(type,{items:[{text:'',done:false}]});
    if (['text','note','heading'].includes(type)) appendLogBlock(type,{text:''});
  },
  'daily-task':dailyTaskDialog,
  'daily-link-task':id=>{
    if (!canEditNotebook()||!task(id)||(projectNotebook()&&task(id).project!==ui.project)||currentLog()?.blocks.some(block=>['task','meeting'].includes(block.type)&&block.task===id)) return;
    dialog.close();appendLogBlock('task',{task:id});
  },
  'daily-image':()=>document.querySelector('#daily-image-input')?.click(),
  'daily-import':id=>importDaily([id]),
  'daily-move':value=>{
    const [id,step]=value.split(':');
    const report=currentLog();
    const from=report?.blocks.findIndex(block=>block.id===id);
    if (from>=0) {
      moveDailyBlock(id,from+Number(step)+(Number(step)>0?1:0));
      document.querySelector('#block-'+id+' .notebook-menu summary')?.focus();
    }
  },
  'daily-import-all':()=>importDaily(dailyEvents().map(entry=>entry.id)),
  'daily-add-check':id=>{
    const block=logBlock(id);
    if (!canEditNotebook()||block?.type!=='checklist') return;
    block.items.push({text:'',done:false});saveLog();render();
    const row=document.getElementById('block-'+id)?.querySelector('.daily-check:last-of-type');
    row?.querySelector('input[type="text"]')?.focus();
  },
  'daily-remove-check':ref=>{
    const [id,index]=ref.split(':');
    const block=logBlock(id);
    if (!canEditNotebook()||block?.type!=='checklist') return;
    block.items.splice(Number(index),1);saveLog();render();
    document.getElementById('block-'+id)?.querySelector('[data-action="daily-add-check"]')?.focus();
  },
  'daily-remove-block':id=>{
    const report=currentLog();
    const block=logBlock(id);
    if (!canEditNotebook()||!block) return;
    const index=report.blocks.indexOf(block);
    report.blocks.splice(index,1);
    saveLog(report);render();
    app.querySelector('.daily-toolbar button')?.focus({preventScroll:true});
  },
  'inbox-open':id=>{
    const event=inboxEvents().find(entry=>entry.id===id);
    if (!event) return;
    markRead(data,ui.actor,[id]);save();
    if (event.idea) return openIdea(event.idea);
    if (!event.task&&event.noteId&&project(event.project)?.notes?.some(note=>note.id===event.noteId)) {
      openProject(event.project,null,'project-notes');
      ui.focusProjectNote=event.noteId;
      render();focusProjectNote();return;
    }
    const openNote=['mention','owned-note','reply'].includes(event.reason);
    ui.focusNote=openNote ? event.noteId || null : null;
    showTask(event.task,openNote?'notes':'details');
    taskDialog.querySelector('.focused-note')?.scrollIntoView({block:'nearest'});

  },
  workflow:id=>openProject(id),
  'new-workflow':id=>newFlowDialog(id),
  'preview-template':previewTemplate,
  'task-sort':sortTaskTable,
  'locate-task':goToFlowTask,
  ...Object.fromEntries(['template-fit','template-reset','template-pan','template-phase','template-node'].map(action=>[
    action,(value,trigger)=>templateControl(action,value,trigger)
  ])),
  'use-reviewed-template':id=>{if (dialog.dataset.templatePreview===id) newFlowDialog('',null,id);},
  'save-template':saveTemplateDialog,
  'revise-template':reviseTemplateDialog,
  'template-version':previewTemplateVersion,
  'edit-preset':editPreset,
  'apply-preset':(_id,trigger)=>applyPreset(trigger.form),
  milestone:id=>milestoneDialog(id),
  'milestone-open-okr':openMilestoneResult,
  'milestone-status':toggleMilestone,
  'project-update':postUpdateDialog,
  'resolve-decision':id=>resolveDecisionDialog(id),
  'apply-schedule':(_value,trigger)=>{
    const form=trigger.form;
    if (!form?.dataset.reviewImpact) return;
    form.dataset.approvedImpact=form.dataset.reviewImpact;
    form.requestSubmit();
  },
  'workload-owner':id=>{
    ui.workloadOwner=id; ui.workloadStatus='';
    render();
    app.querySelector(`[data-action="workload-owner"][data-value="${id}"]`)?.focus({preventScroll:true});
  },
  'workload-segment':value=>{
    const [owner,status]=value.split(':');
    const same=owner===ui.workloadOwner&&status===ui.workloadStatus;
    ui.workloadOwner=owner;ui.workloadStatus=same?'':status;
    render();
    app.querySelector(`[data-action="workload-segment"][data-value="${value}"]`)?.focus({preventScroll:true});
  },
  'new-task':status=>editTaskDialog(null,status==='idea'?'idea':'backlog'),
  'edit-kpi':kpiDialog,
  'remove-kpi':id=>{
    const flow=currentProject();
    if (!canManagePlan(flow)) return;
    const entry=flow.kpis.find(item=>item.id===id);
    if (!entry) return;
    const kpis=flow.kpis.filter(item=>item!==entry);
    runWrite(()=>workspaceApi.project(flow,'kpis',{kpis}),()=>dialog.close());
  },
  'write-report':reportDialog,
  'complete-project':finishProject,
  'fail-project':failProjectDialog,
  'reopen-project':reopenProject,
  'project-settings':id=>{if (isAdmin()) newFlowDialog(project(id)?.area,project(id));},
  'task-editor-tab':(key,trigger)=>showEditorSection(trigger.form,key),
  'project-back':(_value,trigger)=>setKickoffStep(trigger.form,'details'),
  'kickoff-add':(_value,trigger)=>{
    const rows=trigger.form.querySelector('.kickoff-metrics');
    rows.insertAdjacentHTML('beforeend',kickoffRow());
    rows.lastElementChild.querySelector('input').focus();
  },
  'kickoff-remove':(_value,trigger)=>{
    const form=trigger.form;
    trigger.closest('.kickoff-row').remove();
    updateEditorPreview(form);
    form.querySelector('.form-error').hidden=true;
    form.querySelector('[data-action="kickoff-add"]').focus();
  },
  'row-add':key=>{
    const rows=dialog.querySelector(`[data-items="${key}"]`);
    if (!rows) return;
    rows.insertAdjacentHTML('beforeend',checkFieldRow(key));
    rows.lastElementChild.querySelector('input').focus();
  },
  'row-remove':(_value,trigger)=>{
    const form=trigger.form;
    const row=trigger.closest('.check-field-row');
    const editor=row.closest('fieldset');
    row.remove();
    if (form?.matches('.editor-form')) updateEditorPreview(form);
    editor.querySelector('[data-action="row-add"]').focus();
  },
  'edit-task':id=>{ if (canChange(task(id))) editTaskDialog(task(id)); },
  'schedule-task':id=>scheduleTaskDialog(id),
  'workflow-schedule':workflowScheduleDialog,
  'open-project-task':id=>{const item=task(id); if(item) openProject(item.project,item);},
  task:(id,trigger,event)=>{
    if (ui.editor&&trigger.classList.contains('in-editor')) selectBuilderShape(id,event.shiftKey);
    else if (task(id)) {
      if (trigger.closest('#task-dialog')&&id!==ui.task) {
        ui.taskTrail||=[];
        ui.taskTrail.push({id:ui.task,detail:ui.detail,scroll:taskDialog.querySelector('.task-scroll')?.scrollTop});
      }
      showTask(id);
    }
  },
  'task-back':()=>{
    const previous=ui.taskTrail?.pop();
    if (!previous) return;
    showTask(previous.id,previous.detail);
    const scroller=taskDialog.querySelector('.task-scroll');
    if (scroller&&previous.scroll) scroller.scrollTop=previous.scroll;
    taskDialog.querySelector('[data-action="task-back"],[data-action="close-task"]')?.focus({preventScroll:true});
  },
  'reply-note':id=>{
    if (!task(ui.task)?.notes.some(note=>note.id===id)) return;
    ui.replyNote=id;render();
    taskDialog.querySelector('#note-text')?.focus();
  },
  'cancel-reply':()=>{
    const id=ui.replyNote;
    ui.replyNote=null;render();
    taskDialog.querySelector(`[data-action="reply-note"][data-value="${id}"]`)?.focus();
  },
  'reply-project-note':id=>{
    const flow=currentProject();
    if (ui.view!=='project-notes'||!isActiveProject(flow)||!flow.notes?.some(note=>note.id===id)) return;
    ui.projectReply=id;render();app.querySelector('#project-note-text')?.focus();
  },
  'cancel-project-reply':()=>{
    const id=ui.projectReply;
    ui.projectReply=null;render();focusControl('reply-project-note',id);
  },
  'close-task':closeTask,
  detail:id=>{if(taskDialog.querySelector('.task-scroll'))taskDialog.querySelector('.task-scroll').scrollTop=0;ui.detail=id;render();},
  view:id=>{
    if (ui.editor&&id!=='flow') {ui.editor=false;ui.initialBuilder=null;resetBuilder();}
    ui.view=id;render();
  },
  'my-view':id=>{if (['focus','tasks','calendar','showroom'].includes(id)) {ui.myView=id;ui.task=null;render();focusControl('my-view',id);}},
  own:id=>{ui.own=id;ui.task=null;render();},

  admin:id=>{if(isAdmin()){ui.admin=id;render();}},
  'admin-new-project':()=>{if(isAdmin())newFlowDialog('');},
  'admin-plan':id=>{
    if (!isAdmin()||!['okrs','milestones','decisions'].includes(id)) return;
    ui.adminPlanning=id;render();focusControl('admin-plan',id);
  },
  'admin-open-updates':id=>{if (isAdmin()) openProject(id,null,'updates');},
  'admin-open-notebook':id=>{if (isAdmin()) openProject(id,null,'project-report');},
  'admin-open-decision':value=>{
    if (!isAdmin()) return;
    const [id,decision]=value.split('|');
    openProject(id,null,'updates');
    const row=[...app.querySelectorAll('[data-project-update]')].find(el=>el.dataset.projectUpdate===decision);
    row?.scrollIntoView({block:'center'});row?.focus({preventScroll:true});
  },
  'admin-edit-milestone':value=>{
    if (!isAdmin()) return;
    const [id,milestone]=value.split('|');
    milestoneDialog(milestone,project(id)||null);
  },
  'admin-resolve-decision':value=>{
    if (!isAdmin()) return;
    const [id,decision]=value.split('|');
    resolveDecisionDialog(decision,project(id)||null);
  },
  'admin-activity-more':()=>{
    if (!isAdmin()) return;
    const previous=ui.adminActivityLimit;
    ui.adminActivityLimit+=30;
    refreshAdminActivity();
    const row=app.querySelectorAll('.admin-activity-table tbody tr')[previous];
    row?.setAttribute('tabindex','-1');row?.focus();
  },
  'admin-activity-export':()=>{
    if (!isAdmin()) return;
    if (!adminUI.exportActivity()) announce('No activity matches these filters.');
  },
  'open-project-summary':id=>openProject(id,null,'summary'),
  'admin-shortcut':key=>{
    if (!isAdmin()) return;
    const [view,filter]=key.split(':');
    ui.admin=view;
    if (view==='projects') {ui.adminAreaFilter='';ui.adminStateFilter=filter;}
    if (view==='planning') {
      ui.adminPlanning=filter;ui.adminPlanArea='';ui.adminPlanOwner='';
      ui.adminMilestoneState=filter==='milestones'?'late':'';
    }
    if (view==='tasks') {ui.adminTaskFilter=filter;ui.adminOwnerFilter='';ui.adminProjectFilter='';ui.periods.admin='';}
    render();
  },
  'admin-member-tasks':id=>{
    if (!isAdmin()) return;
    ui.admin='tasks';ui.adminOwnerFilter=id;ui.adminTaskFilter='open';ui.adminProjectFilter='';
    render();
  },
  'admin-project-tasks':value=>{
    if (!isAdmin()) return;
    const [id,status='']=value.split('|');
    ui.admin='tasks';ui.adminProjectFilter=id;ui.adminOwnerFilter='';ui.adminTaskFilter=status;ui.periods.admin='';
    render();
  },
  'admin-area-projects':id=>{
    if (!isAdmin()) return;
    ui.admin='projects';ui.adminAreaFilter=id;ui.adminStateFilter='';
    render();
  },
  'first-circle':()=>startCircle(freeTaskPosition(ui.project)),
  editor:()=>{
    if (!canEdit(ui.project)) return;
    const finishing=ui.editor;
    if (finishing) tidyCanvas();
    else ui.viewBeforeEdit=ui.view;
    ui.initialBuilder=!finishing&&isAdmin()&&currentProject().owner!==ui.actor?ui.project:null;
    ui.editor=!finishing;ui.view=finishing?(ui.viewBeforeEdit||'flow'):'flow';
    resetBuilder();render();
    if (finishing) announce('Workflow arranged and saved.');
    else document.querySelector('[data-action="first-circle"],.builder-palette .builder-circle')?.focus({preventScroll:true});
  },
  'clear-project-filters':()=>{ui.ownerFilter=null;ui.taskQuery='';ui.taskStatus='';ui.periods.project='';render();},
  filter:id=>{ui.ownerFilter=ui.ownerFilter===id?null:id;render();},
  'time-view':id=>{
    ui.timeView=id;ui.zoom=null;
    document.querySelector('.canvas')?.scrollTo(0,0);
    render();
    if (id==='schedule' && matchMedia('(max-width:720px)').matches) jumpToday();
  },
  'locate-mission':id=>{
    if (focusGraphTask(id)) return;
    if (!task(id)||(!ui.ownerFilter&&!ui.taskQuery&&!ui.taskStatus&&!ui.periods.project)) return;
    ui.ownerFilter=null;ui.taskQuery='';ui.taskStatus='';ui.periods.project='';render();focusGraphTask(id);
  },
  'jump-today':jumpToday,
  'zoom-in':()=>changeZoom(.14),
  'zoom-out':()=>changeZoom(-.14),
  fit:()=>{const canvas=document.querySelector('.canvas');if (!canvas?.dataset.fit) return; ui.zoom=Number(canvas.dataset.fit);canvas.scrollTo(0,0);render();},
  'builder-tool':id=>{
    if (!ui.editor||!canEdit(ui.project)) return;
    if (dialog.open) dialog.close();
    const previous=ui.builderTool;
    resetBuilder();ui.builderTool=previous===id?'select':id;render();
    if (['place','frame','project'].includes(ui.builderTool)) document.querySelector('.canvas')?.focus({preventScroll:true});
    else document.querySelector(`[data-action="builder-tool"][data-value="${id}"]`)?.focus({preventScroll:true});
  },
  'cancel-placement':()=>{resetBuilder();render();},
  'builder-port':id=>{
    if (!ui.editor||!canEdit(ui.project)) return;
    resetBuilder();ui.builderTool='connect';ui.linkStart=id;render();
    document.querySelector(`.graph-port[data-value="${id}"]`)?.focus({preventScroll:true});
  },
  'view-project-node':showProjectNode,
  'edit-project-node':editProjectNode,
  'open-linked-project':openLinkedProject,
  'return-linked-node':returnToLinkedNode,
  'builder-shape':(id,_trigger,event)=>{if(ui.editor&&canEdit(ui.project))selectBuilderShape(id,event.shiftKey);},
  'select-arrow':(id,_trigger,event)=>{
    if (!ui.editor||!canEdit(ui.project)) return;
    ui.builderTool='select';ui.linkStart=null;setBuilderSelection(id,event.shiftKey);
  },
  'edit-selection':editBuilderSelection,
  'remove-selection':removeBuilderSelection,
  'undo-canvas':undoCanvas,
  'tidy-canvas':()=>{
    if (!canEdit(ui.project)) return;
    if (dialog.open) dialog.close();
    tidyCanvas();resetBuilder();render();announce('Workflow arranged.');
  },
  'edit-frame':editFrameDialog,
  'remove-frame':id=>{
    const flow=currentProject();
    if (!ui.editor||!canEdit(flow?.id)) return;
    const frame=flow.frames.find(item=>item.id===id);
    if (!frame) return;
    flow.frames=flow.frames.filter(item=>item!==frame);
    flow.layoutArrows=flow.layoutArrows.filter(arrow=>arrow.from!==frameKey(id)&&arrow.to!==frameKey(id));
    persistCanvas(flow,()=>dialog.close());
  },
  'layout-arrows':showLayoutArrows,
  'remove-layout-arrow':id=>{
    const flow=currentProject();
    if (!canEdit(flow?.id)) return;
    flow.layoutArrows=flow.layoutArrows.filter(arrow=>arrow.id!==id);
    persistCanvas(flow,()=>dialog.close());
  },
  'builder-group':builderGroup,
  'builder-options':builderOptions,
  'canvas-versions':showCanvasVersions,
  'restore-canvas-version':confirmCanvasRestore,
  dependencies:()=>{if (canEdit(ui.project)) dependencyDialog(currentProject());},
  groups:()=>{if (canEdit(ui.project)) showGroups(currentProject());},
  'edit-group':id=>{if (canEdit(ui.project)) editGroupDialog(currentProject(),id);},
  'remove-group':id=>{
    if (!canEdit(ui.project)) return;
    const flow=currentProject();
    const chosen=flow.groups.find(group=>group.id===id);
    if (!chosen||!visibleGroup(chosen)) return;
    flow.groups=flow.groups.filter(group=>group.id!==id);
    flow.layoutArrows=flow.layoutArrows.filter(arrow=>arrow.from!==groupKey(id)&&arrow.to!==groupKey(id));
    persistCanvas(flow,()=>dialog.close());
  },
  loops:()=>{if (canEdit(ui.project)) showLoops(currentProject());},
  'edit-loop':id=>{if (canEdit(ui.project)) editLoopDialog(currentProject(),id);},
  'remove-loop':id=>{
    if (!canEdit(ui.project)) return;
    const flow=currentProject();
    const loop=flow.loops.find(item=>item.id===id);
    if (!loop||!visibleLoop(loop)) return;
    if (loop.count) {
      showDialog('Review pass history','<p>Review loops with recorded passes stay on the workflow.</p>');
      return;
    }
    flow.loops=flow.loops.filter(loop=>loop.id!==id);
    persistCanvas(flow,()=>showLoops(currentProject()));
  },
  'loop-info':id=>showLoopInfo(task(ui.task)?project(task(ui.task).project):currentProject(),id),
  'move-task':()=>{if (canEdit(ui.project)) moveTaskDialog(currentProject());},
  'new-person':()=>{if (isAdmin()) personDialog(null);},
  'add-existing-staging-account':()=>{if (stagingAccounts()) addExistingAccountDialog();},
  'create-staging-account':newStagingAccountDialog,
  'manage-staging-accounts':manageStagingAccounts,
  'reset-staging-account':resetStagingAccountDialog,
  'edit-person':id=>{if (isAdmin()) personDialog(person(id));},
  'new-area':()=>{if (isAdmin()) areaDialog(null);},
  'edit-area':id=>{if (isAdmin()) areaDialog(area(id));},
  status:id=>changeStatus(task(ui.task),id),
  reopen:()=>reopenTask(task(ui.task)),
  'run-loop':id=>{
    const item=task(ui.task), loop=rounds(item).find(entry=>entry.id===id);
    if (!loop||!visibleLoop(loop)||!canChange(item)) return;
    const unscheduled=[item,...repeatedTasks(project(item.project),loop)].filter(needsSchedule);
    const editable=unscheduled.find(canChange);
    if (editable) return scheduleTaskDialog(editable.id);
    if (unscheduled.length) return announce('Ask the project owner to estimate the remaining review steps.','danger');
    passDialog(item,loop);
  }
};
function jumpToday() {
  const canvas=document.querySelector('.canvas');
  if (!canvas?.dataset.today) return;
  canvas.scrollLeft=Number(canvas.dataset.today)-canvas.clientWidth/2;
}
function changeZoom(step) {
  const canvas=document.querySelector('.canvas');
  if (!canvas?.dataset.scale) return;
  const next=Number(canvas.dataset.scale)+step;
  ui.zoom=Math.min(1.65,Math.max(.20,next));
  render();
}
document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-action]');
  if (trigger && !trigger.disabled) {
    if (trigger.dataset.studioPending||unsupportedActions.has(trigger.dataset.action)) return announce('This action is unavailable in the current preview.','danger');
    handlers[trigger.dataset.action]?.(trigger.dataset.value ?? '',trigger,event);
  }

});
document.addEventListener('keydown',event=>{
  if (ui.editor&&!dialog.open&&!taskDialog.open&&!event.target.closest('input,textarea,select,[contenteditable]')) {
    const arrow=event.target.closest('.wire-hit');
    if (arrow&&['Enter',' '].includes(event.key)) {event.preventDefault();handlers['select-arrow'](arrow.dataset.value,arrow,event);return;}
    if (['Delete','Backspace'].includes(event.key)&&ui.builderSelection.size) {event.preventDefault();removeStudioSelection();return;}
    if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&ui.canvasUndo.length) {event.preventDefault();undoCanvas();return;}
  }
  if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {event.preventDefault();searchDialog();}
  if (event.key==='Escape'&&!dialog.open && ui.mobileOpen) {ui.mobileOpen=false;render();}
  const active=event.target.closest('[role="tab"]');
  if (!active||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const tabs=[...active.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const at=tabs.indexOf(active);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(at+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
  const chosen=tabs[next];
  const selector=`[data-action="${chosen.dataset.action}"][data-value="${chosen.dataset.value}"]`;
  chosen.click();
  (active.closest('dialog')||app).querySelector(selector)?.focus();
});
document.addEventListener('input',event=>{
  const field=event.target;
  if (!stateLoaded) return;
  if (field.id==='admin-activity-query'&&isAdmin()) {
    ui.adminActivityQuery=field.value;ui.adminActivityLimit=30;refreshAdminActivity();return;
  }
  if (field.id==='network-search') {
    Object.assign(networkState(),{query:field.value,focus:'',selected:''});refreshNetwork();return;
  }
  if (field.id==='showroom-query') {
    ui.showroom.query=field.value;ui.showroom.page=0;refreshShowroom();return;
  }
  if (field.hasAttribute('data-reference-search')) {
    const query=field.value.trim().toLowerCase();
    for (const tile of field.parentElement.querySelectorAll('[data-ref-search]')) {
      tile.hidden=Boolean(query&&!tile.dataset.refSearch.toLowerCase().includes(query));
    }
  }
  if (field.matches('[name="durationDays"],[name="scheduleStart"],[name="scheduleEndTime"],[name="deadline"],[name="milestone-task"]')&&field.form?.dataset.reviewImpact) resetScheduleReview(field.form);
  if (field.form?.matches('.editor-form')) updateEditorPreview(field.form);
  if (field.id==='project-query') {
    const start=field.selectionStart, end=field.selectionEnd;
    ui.taskQuery=field.value;
    render();
    const next=document.getElementById(field.id);
    next?.focus({preventScroll:true});
    next?.setSelectionRange(start,end);
    return;
  }
  if (field.dataset.noteScope) noteDrafts.set(noteDraftKey(field.dataset.noteScope,field.form.elements.parentId.value),field.value);
  if (field.dataset.dailyField) {
    const block=logBlock(field.dataset.block);
    if (!canEditNotebook()||!block) return;
    if (field.dataset.dailyField==='item') {
      const entry=block.items[Number(field.dataset.index)];
      if (!entry) return;
      entry.text=field.value;
      field.closest('.daily-check').querySelector('[type="checkbox"]').setAttribute('aria-label','Complete '+(entry.text||'checklist item '+(Number(field.dataset.index)+1)));
    } else {
      block[field.dataset.dailyField]=field.value;
      if (field.dataset.dailyField==='caption') {
        const image=field.closest('.daily-image')?.querySelector('img');
        if (image) image.alt=field.value||block.filename;
      }
      if (field.tagName==='TEXTAREA') resizeLogFields();
    }
    saveLog();
    return;
  }
  if (event.target.id==='search-field') updateSearch(event.target.value);
  if (event.target.form?.getAttribute('id')==='quick-check-form') event.target.setCustomValidity('');
});
document.addEventListener('change',event=>{
  const field=event.target;
  if (['network-type','network-area','network-owner','network-archived','network-inspect'].includes(field.id)) {
    networkState()[field.id.slice(8)]=field.type==='checkbox'?field.checked:field.value;
    networkState().focus='';refreshNetwork();return;
  }
  if (field.id==='archive-area'||field.id==='archive-outcome') {
    ui[field.id==='archive-area'?'archiveArea':'archiveOutcome']=field.value;
    render();document.getElementById(field.id)?.focus({preventScroll:true});return;
  }
  if (field.matches('#linked-project-form select[name=target]')) {
    field.form.elements.milestone.innerHTML=milestoneOptions(project(field.value));
  }
  if (field.matches('[data-calendar-filter],[data-calendar-date]')) return calendar.change(field);
  if (field.dataset.periodFilter) {
    ui.periods[field.dataset.periodFilter]=field.value;render();
    document.querySelector('[data-period-filter="'+field.dataset.periodFilter+'"]')?.focus({preventScroll:true});return;
  }
  if (field.name==='visibility'&&field.form?.querySelector('[data-private-members]')) {
    field.form.querySelector('[data-private-members]').hidden=field.value!=='private';
  }
  if (field.dataset.showroom) {
    const setting=field.dataset.showroom;
    ui.showroom[setting]=field.value;
    if (['scope','size','color'].includes(setting)) {
      const {scope,size,color}=ui.showroom;
      runWrite(()=>workspaceApi.showroomView({scope,size,color}));
    }
    ui.showroom.page=0;render();
    document.querySelector('[data-showroom="'+field.dataset.showroom+'"]')?.focus({preventScroll:true});return;
  }
  if (field.dataset.showroomSwatch) {
    const colors={...data.showroomColors,[ui.showroom.color+':'+field.dataset.showroomSwatch]:field.value};
    runWrite(()=>workspaceApi.preferences(colors));return;
  }
  if (['from','to','remove'].includes(field.name)&&field.form?.querySelector('[data-endpoint-preview]')) updateEndpoints(field.form,currentProject());
  const item=task(ui.task);
  if (field.id==='workload-area'||field.id==='workload-project') {
    if (field.id==='workload-area') {ui.workloadArea=field.value;ui.workloadProject='';}
    else ui.workloadProject=field.value;
    render();document.getElementById(field.id)?.focus({preventScroll:true});
  }
  if (field.id==='daily-date' && field.value && Number.isFinite(dayIndex(field.value))) {
    ui.dailyDate=field.value;render();document.querySelector('#daily-date')?.focus();
  }
  if (field.id==='daily-image-input') {
    const file=field.files?.[0];
    field.value='';
    attachDailyImage(file);
  }
  if (field.dataset.meetingCheck) {
    const meeting=meetingRecord(field.dataset.meetingCheck),index=Number(field.dataset.index);
    const entry=meeting?.agenda[index];
    if(entry) runWrite(()=>workspaceApi.meeting(meeting.id,{agenda_action:'check',agenda_index:index,agenda_text:entry.text,agenda_done:field.checked}));
    return;
  }
  if (field.hasAttribute('data-daily-check')) {
    const block=logBlock(field.dataset.block);
    const entry=block?.items[Number(field.dataset.index)];
    if (canEditNotebook()&&entry) {
      entry.done=field.checked;saveLog();
      const checklist=field.closest('.log-block');
      const count=block.items.filter(item=>item.done).length;
      checklist.querySelector('[data-daily-check-count]').textContent=count+'/'+block.items.length;
      checklist.querySelector('.check-progress>span').style.width=(100*count/block.items.length)+'%';
    }
  }
  if (field.matches('[data-check]') && canChange(item) && item.status!=='done') {
    const entry=item[field.dataset.check][Number(field.dataset.index)];
    if (!entry) return;
    if (!entry.id) return;
    return runWrite(()=>workspaceApi.check(item.id,entry.id,field.checked));
  }
  if (field.form?.getAttribute('id')==='meeting-form'&&['date','time','repeat'].includes(field.name)) updateRepeatFields(field.form);
  if (field.hasAttribute('data-mention-picker')&&field.value) {
    const input=field.form.elements.body;
    const handle='@'+field.value+' ';
    const location=input.selectionEnd;
    const gap=location>0&&!/\s/.test(input.value[location-1])?' ':'';
    input.setRangeText(gap+handle,input.selectionStart,location,'end');
    noteDrafts.set(noteDraftKey(input.dataset.noteScope,field.form.elements.parentId.value),input.value);
    field.value=''; input.focus();
  }
  if (field.hasAttribute('data-work-filter')) {
    const keys={'project-owner-filter':'ownerFilter','project-status-filter':'taskStatus','project-sort':'taskOrder','my-project-filter':'myProject'};
    ui[keys[field.id]]=field.value;render();document.getElementById(field.id)?.focus({preventScroll:true});
  }
  if (field.hasAttribute('data-admin-filter') && isAdmin()) {
    const keys={'admin-area':'adminAreaFilter','admin-state':'adminStateFilter','admin-task-status':'adminTaskFilter',
      'admin-task-owner':'adminOwnerFilter','admin-task-project':'adminProjectFilter','admin-log-project':'adminFilter','admin-log-person':'adminActorFilter',
      'admin-log-type':'adminActivityType','admin-log-window':'adminActivityWindow','admin-plan-area':'adminPlanArea',
      'admin-plan-owner':'adminPlanOwner','admin-milestone-status':'adminMilestoneState','admin-meeting-owner':'adminMeetingOwner',
      'admin-meeting-status':'adminMeetingState','admin-report-area':'adminReportArea','admin-report-status':'adminReportState'};
    if (field.id==='admin-review-days') {
      const value=Number(field.value);
      if (!reviewIntervals.includes(value)) return;
      return runWrite(()=>workspaceApi.reviewInterval(value));
    } else {
      const key=keys[field.id];
      if (!key) return;
      ui[key]=field.value;
      if (field.id.startsWith('admin-log-')) {ui.adminActivityLimit=30;refreshAdminActivity();return;}
    }
    render();document.getElementById(field.id)?.focus();
  }
  if (field.name==='id'&&field.form?.getAttribute('id')==='move-form') {
    const selected=task(field.value);
    field.form.elements.x.value=selected.x;
    field.form.elements.y.value=selected.y;
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  event.preventDefault();
  const fields=new FormData(form);
  const formId=form.getAttribute('id');
  const flow=currentProject();
  const item=task(ui.task);
  if (studioForms.has(formId)) return studioForms.get(formId)(form,fields,item,flow);
  if (formId==='calendar-note-form'||formId==='calendar-read-note') return calendar.submit(form,fields);
  return formError(form,'This action is unavailable in the current preview.');
});
const showroomDefaults={
  overdue:'#fa908c',attention:'#eac171',done:'#85d7a4',ready:'#7dbdeb',idea:'#b6a9da',closed:'#a3a5b6',unassigned:'#8a9cab'
};
const areaColors=['#8fcfe7','#91d9b8','#bfaae8','#f2bc83','#e9a5b9','#9cb5ea','#d8cb86'];

function showroomColor(key,mode) {
  const custom=data.showroomColors[mode+':'+key];
  if (/^#[0-9a-f]{6}$/i.test(custom||'')) return custom;
  if (mode==='owner') return person(key)?.color||showroomDefaults.unassigned;
  if (mode==='area') return areaColors[Math.max(0,data.areas.findIndex(group=>group.id===key))%areaColors.length];
  return showroomDefaults[key]||showroomDefaults.ready;
}
function showroomKey(item) {
  return ui.showroom.color==='owner'?item.owners[0]||'unassigned':
    ui.showroom.color==='area'?project(item.project)?.area||'unassigned':cardCue(item);
}
function showroomWeight(item) {
  if (ui.showroom.size==='importance') return timing(item).importance;
  if (ui.showroom.size==='checklist') return Math.max(1,item.checklist.length+item.dod.length);
  return Math.max(1,isOpen(item)?timing(item).score:timing(item).importance);
}
function showroomTile(item,bounds) {
  const color=showroomColor(showroomKey(item),ui.showroom.color);
  const size=bounds.w<(showroomMedia.matches?31:13.75)||bounds.h<18.6?'compact':'';
  const cue=cardCue(item),flow=project(item.project);
  return `<button type="button" class="showroom-tile ${size}" data-action="task" data-value="${esc(item.id)}"
    style="--tile-ink:${esc(color)};--tile-x:${bounds.x}%;--tile-y:${bounds.y}%;--tile-w:${bounds.w}%;--tile-h:${bounds.h}%"
    aria-label="${esc(item.title+', '+flow?.title+', '+readableStatus(item)+', '+showroomWeight(item)+' '+ui.showroom.size)}">
    <span class="showroom-tile-top">${symbol(item.icon)}<span>${esc(area(flow?.area)?.title)}</span><b>${showroomWeight(item)}</b></span>
    <strong>${esc(item.title)}</strong>
    <span class="showroom-tile-bottom">${memberAvatars(item.owners)}<span>${symbol(cardCues[cue].icon)}${esc(timing(item).due)}</span></span>
  </button>`;
}
function showroomPeek(item) {
  if (!item) return `<span class="peek-emblem">${symbol('layout')}</span><div><strong>Preview a task</strong><small>Hover or focus a tile for context. Open it to see the full task.</small></div>`;
  const flow=project(item.project),pending=blockers(item);
  const outgoing=(flow?.edges||[]).filter(([from])=>from===item.id).map(([,to])=>task(to)).filter(Boolean);
  return `<span class="peek-emblem" style="--tile-ink:${esc(showroomColor(showroomKey(item),ui.showroom.color))}">${symbol(item.icon)}</span>
    <div><strong>${esc(item.title)}</strong><small>${esc(area(flow?.area)?.title)} / ${esc(flow?.title)} · ${esc(item.owners.map(ownerName).join(', ')||'Unassigned')}</small></div>
    <div class="peek-facts">${statusChip(item)}<span class="card-date ${timing(item).tone}">${symbol('clock')}${esc(timing(item).due)}</span>
      ${pending.length?`<span class="peek-blocked">${symbol('lock')}${esc(pending.map(entry=>entry.title).join(', '))}</span>`:`<span>${symbol('flow')}${outgoing.length} handoffs</span>`}${button('locate-task','Show in flowchart','flow','ghost',item.id)}</div>`;
}
function showroomItems() {
  const f=ui.showroom;
  const query=f.query.trim().toLowerCase();
  return workingTasks().filter(item=>{
    const flow=project(item.project);
    return (f.scope==='workspace'||involved(item))&&(!f.area||flow?.area===f.area)&&(!f.owner||item.owners.includes(f.owner))&&
      inPeriod(item,f.period)&&(!f.status||cardCue(item)===f.status)&&(!query||[item.title,flow?.title,area(flow?.area)?.title].some(value=>value?.toLowerCase().includes(query)));
  }).sort((a,b)=>showroomWeight(b)-showroomWeight(a)||ranked(a,b));
}
function showroomResults() {
  const items=showroomItems(),small=showroomMedia.matches;
  const showroomPageSize=small?8:14;
  const pages=Math.max(1,Math.ceil(items.length/showroomPageSize));
  ui.showroom.page=Math.min(ui.showroom.page,pages-1);
  const visible=items.slice(ui.showroom.page*showroomPageSize,(ui.showroom.page+1)*showroomPageSize);
  if (!visible.length) return '<section class="panel empty"><h2>No matching tasks</h2></section>';
  const presets=visible.map(item=>({item,weight:showroomWeight(item)}));
  const width=small?440:960,height=small?670:510;
  const tiles=weightedMosaic(presets,width,height);
  return `<div class="showroom-peek" id="showroom-peek">${showroomPeek(visible[0])}</div>
    <div class="showroom-map ${visible.length<4?'showroom-map-short':''}" aria-label="Tasks sized by ${esc(ui.showroom.size)}">
      ${tiles.map(({item,x,y,w,h})=>showroomTile(item,{x:x/width*100,y:y/height*100,w:w/width*100,h:h/height*100})).join('')}
    </div><div class="showroom-footer"><span>${items.length} ${items.length===1?'task':'tasks'}</span>
      <div>${pages>1?`<button class="icon-btn" data-action="showroom-page" data-value="-1" type="button" aria-label="Previous tasks" ${ui.showroom.page?'':'disabled'}>${symbol('left')}</button>
      <span>${ui.showroom.page+1} / ${pages}</span><button class="icon-btn" data-action="showroom-page" data-value="1" type="button" aria-label="Next tasks" ${ui.showroom.page+1<pages?'':'disabled'}>${symbol('chevron')}</button>`:''}</div></div>`;
}
function showroomPage() {
  const f=ui.showroom;
  const palette=f.color==='owner'?data.team.map(member=>[member.id,member.name]).concat([['unassigned','Unassigned']]):
    f.color==='area'?data.areas.map(group=>[group.id,group.title]):Object.entries(cardCues).map(([key,entry])=>[key,entry.label]);
  const select=(key,label,values)=>`<label class="field"><span>${label}</span><select data-showroom="${key}">${values.map(([id,name])=>option(id,name,f[key])).join('')}</select></label>`;
  return `<div class="showroom-toolbar panel">
      <label class="project-search">${symbol('search')}<input type="search" id="showroom-query" aria-label="Search showroom tasks" placeholder="Search tasks" value="${esc(f.query)}"></label>
      ${select('scope','Scope',[['mine','My work'],['workspace','Workspace']])}
      ${select('area','Area',[['','All areas'],...data.areas.map(group=>[group.id,group.title])])}
      ${select('owner','Owner',[['','All teammates'],...data.team.map(member=>[member.id,member.name])])}
      ${select('status','Signal',[['','All signals'],...Object.entries(cardCues).map(([key,entry])=>[key,entry.label])])}
      ${select('period','Period',periodChoices)}
      ${select('size','Size by',[['priority','Priority'],['importance','Importance'],['checklist','Checklist size']])}
      ${select('color','Color by',[['signal','Signal'],['owner','Owner'],['area','Area']])}
      <details class="showroom-palette"><summary>${symbol('sun')} Palette</summary>
        <div class="palette-pop">${palette.map(([key,label])=>`<label title="${esc(label)}"><span>${esc(label)}</span>
          <input aria-label="${esc(label+' color')}" type="color" data-showroom-swatch="${esc(key)}" value="${esc(showroomColor(key,f.color))}"></label>`).join('')}
          ${button('showroom-reset-colors','Restore palette','undo','ghost')}</div></details>
      ${iconButton('showroom-reset','Reset showroom filters','undo')}
    </div><section class="showroom-region panel" id="showroom-results">${showroomResults()}</section>`;
}
function resetShowroom() {
  ui.showroom={scope:'mine',query:'',area:'',owner:'',status:'',size:'priority',color:'signal',page:0};
}
const showroomMedia=matchMedia('(max-width: 640px)');
showroomMedia.addEventListener('change',()=>{if(ui.page==='mine'&&ui.myView==='showroom')refreshShowroom();});
function refreshShowroom() {
  const region=document.querySelector('#showroom-results');
  if (region) region.innerHTML=showroomResults();
}
function bindShowroom() {
  const region=document.querySelector('#showroom-results');
  const update=event=>{
    const tile=event.target.closest('.showroom-tile');
    if (!tile) return;
    const peek=region.querySelector('#showroom-peek');
    const item=task(tile.dataset.value);
    if (peek&&item&&peek.dataset.task!==item.id) {
      peek.dataset.task=item.id;
      peek.innerHTML=showroomPeek(item);
    }
  };
  region.addEventListener('pointerover',update);
  region.addEventListener('focusin',update);
}
function richText(value,mentions=false) {
  return httpLinkParts(value).map(part=>part.href?
    `<a class="visual-link" href="${esc(part.href)}" target="_blank" rel="noopener noreferrer">${symbol('globe')}<span>${esc(part.host)}<small>${esc(part.path==='/'?'Open website':part.path)}</small></span>${symbol('chevron')}</a>`:
    mentions?markMentions(part.text):esc(part.text)).join('');
}
function taskRelationships(item,pending) {
  const flow=project(item.project);
  if (!flow) return '';
  const waiting=new Set(pending.map(entry=>entry.id));
  const prerequisites=incoming(item).filter(entry=>!waiting.has(entry.id));
  const handoffs=flow.edges.filter(([from])=>from===item.id).map(([,to])=>workflowShape(flow,to)).filter(Boolean);
  const peers=[...new Set(flow.groups.filter(group=>group.members.includes(item.id)).flatMap(group=>group.members))]
    .filter(id=>id!==item.id).map(task).filter(Boolean);
  const sections=[['Prerequisites','check',prerequisites],['Next handoffs','flow',handoffs],['Parallel tasks','rectangle',peers]];
  return sections.filter(([, ,items])=>items.length).map(([label,icon,items])=>`<details class="detail-section task-relations" ${label==='Next handoffs'?'open':''}>
    <summary>${symbol(icon)} ${label}<small>${items.length}</small></summary><div class="blocklist">${items.map(dependencyReference).join('')}</div>
  </details>`).join('');
}
function durationBadge(item) {
  return isDuration(item.durationDays)?`<span class="task-duration-badge">${symbol('clock')}${taskDurationText(item)}</span>`:'';
}
function taskDurationText(item) {
  return isDuration(item.durationDays)?daysLabel(Number(item.durationDays)):'—';
}
function taskScheduleRange(item) {
  const start=isScheduleDate(item.startDate)?item.startDate:'';
  const due=isScheduleDate(item.dueDate)?item.dueDate:'';
  if (start&&due&&start!==due) return asDate(start)+' – '+asDate(due,true);
  if (due) return asDate(due,true);
  return start?'Starts '+asDate(start,true):'No planned dates';
}
function taskFinish(item,relative=false) {
  if (needsSchedule(item)) return relative?'':`<span class="task-deadline-label ${isOpen(item)?'near':''}">${symbol('timeline')}
    ${isOpen(item)?'Needs duration':'—'}</span>`;
  if (!isScheduleDate(item.dueDate)) return relative?'':'<span class="task-deadline-label">Pending</span>';
  const {tone,due,days}=timing(item);
  if (relative&&(days===null||item.status==='done')) return '';
  const label=days<0&&item.status!=='done'?daysLabel(-days)+' past plan':relative&&days>0?'Finishes in '+daysLabel(days):relative?'Planned finish today':due;
  return `<span class="task-deadline-label ${tone}" title="Planned finish · ${asDate(item.dueDate,true)}">${symbol(tone==='late'?'alert':'clock')}
    ${esc(label)}</span>`;
}
function compactTaskOwners(item) {
  if (!item.owners.length) return '<span class="task-owner-summary dim">'+symbol('user')+'Unassigned</span>';
  const [first,...others]=item.owners;
  return `<span class="task-owner-summary" title="${esc(item.owners.map(ownerName).join(', '))}">
    <i aria-hidden="true">${avatar(person(first),'small')}</i><span>${esc(ownerName(first))}</span>${others.length?`<small>+${others.length}</small>`:''}</span>`;
}
function taskContext(item) {
  const flow=project(item.project);
  const specs=[...item.checklist,...item.dod];
  const complete=specs.filter(entry=>entry.done).length;
  return `<span class="reference-core task-reference-heading"><span class="reference-icon cue-${cardCue(item)}">${symbol(item.icon)}</span>
    <span class="reference-copy"><strong>${esc(item.title)}</strong><small>${esc(flow?.title||area(flow?.area)?.title)}</small></span></span>
    <span class="reference-meta task-reference-state">${statusChip(item)}${durationBadge(item)}${taskFinish(item)}</span>
    <span class="task-reference-footer">${compactTaskOwners(item)}
    ${specs.length?`<span class="reference-progress" title="Checklist and Definition of Done">${symbol('checklist')}${complete}/${specs.length}</span>`:''}</span>`;
}
function taskLinkCard(item,action='task') {
  return `<div class="reference-task-actions ${action==='task'?'with-meeting-action':''}"><button type="button" class="reference-tile" data-action="${action}" data-value="${esc(item.id)}">
    ${taskContext(item)}${item.description?`<span class="reference-description">${esc(item.description)}</span>`:''}</button>${taskLocateIcon(item)}${action==='task'?taskMeetingIcon(item):''}</div>`;
}
function referenceChoices(name,items,selected=[]) {
  return `<div class="reference-picker">${items.map(({value,label,content,search})=>`<label class="reference-choice" data-ref-search="${esc(search||label)}">
    <input type="checkbox" name="${name}" value="${esc(value)}" aria-label="${esc(label)}" ${selected.includes(value)?'checked':''}>
    <span class="reference-tile">${content}</span></label>`).join('')}</div>`;
}
function visualTaskChoices(name,label,items,selected=[]) {
  return `<fieldset class="reference-shelf"><legend>${esc(label)}</legend>
    <input type="search" data-reference-search aria-label="Find a task by name, owner, or status" placeholder="Find a task by name, owner, or status">
    ${referenceChoices(name,items.map(item=>({value:item.id,label:item.title,content:taskContext(item)+
      (item.description?`<span class="reference-description">${esc(item.description)}</span>`:''),search:[item.title,item.description,readableStatus(item),...item.owners.map(ownerName)].join(' ')})),selected)}
  </fieldset>`;
}
function updateEndpoints(form,flow) {
  if (!flow) return;
  const fields=new FormData(form),remove=fields.get('remove');
  const selected=remove?flow.edges[Number(remove)]:[fields.get('from'),fields.get('to')];
  const preview=form.querySelector('[data-endpoint-preview]');
  if (!selected?.some(Boolean)) {preview.innerHTML='';return;}
  const labels=form.getAttribute('id')==='loop-form'?['Review task','Return to']:['Prerequisite','Task that waits'];
  preview.innerHTML=`<div class="reference-grid">${selected.map((id,index)=>{
    const items=endpointMembers(flow,id||'').map(key=>workflowShape(flow,key)).filter(Boolean);
    return `<section class="endpoint-preview"><h3>${labels[index]}</h3>
      ${items.map(item=>item.targetProjectId?linkedReference(flow,item,false):`<div class="reference-tile">${taskContext(item)}${item.description?`<span class="reference-description">${esc(item.description)}</span>`:''}</div>`).join('')||'<small class="dim">Choose a task</small>'}</section>`;
  }).join('')}</div>`;
}
const ideaRecord=id=>data.ideas.find(item=>item.id===id);
const meetingRecord=id=>findMeeting(data,id);
const meetingSeriesRecord=id=>data.meetingSeries.find(item=>item.id===id);
function storeMeeting(item) {
  if (!data.meetings.some(entry=>entry.id===item.id)) data.meetings.push(item);
}
function upcomingMeetings() {
  const now=today();
  return meetingsInWindow(data,now,dayAt(dayIndex(now)+55));
}
function listedMeetings(period) {
  const now=today();
  if (!period) return upcomingMeetings();
  const view={'week':'week','month':'month','quarter':'quarter','year':'year'}[period];
  return view?meetingsInWindow(data,...calendarRange(now,view)):data.meetings;
}
function meetingRepeatLabel(item) {
  const series=meetingSeriesRecord(item.seriesId);
  return series?'Weekly on '+weeklyDay(series.start):'';
}
const ideaStates={draft:['Draft','dim'],sent:['Awaiting review','attention'],brought:['In work area','done']};
function ideaStatus(item) {
  const [label,tone]=ideaStates[item.state];
  return `<span class="status ${tone}">${symbol(item.state==='brought'?'check':item.state==='sent'?'send':'light')}${label}</span>`;
}
function simpleReference(name,subtitle,icon,extra='') {
  return `<span class="reference-core"><span class="reference-icon">${symbol(icon)}</span>
    <span class="reference-copy"><strong>${esc(name)}</strong><small>${esc(subtitle)}</small></span></span>${extra}`;
}
function objectLink(ref) {
  const [kind,id]=ref.split(':');
  const item=kind==='task'?task(id):kind==='workflow'?project(id):kind==='idea'?ideaRecord(id):meetingRecord(id);
  if (!item) return '<span class="dim">Reference unavailable</span>';
  if (kind==='task') return taskLinkCard(item);
  const group=area(item.area);
  const subtitle=kind==='meeting'?meetingWhen(item):`${group?.title||'Workspace'} · ${projectTasks(kind==='idea'?(item.project||item.draftProject):id).length} tasks`;
  const detail=kind==='idea'?ideaStatus(item):kind==='workflow'?projectStateChip(item):'';
  const action=kind==='idea'?'open-idea':kind==='meeting'?'open-meeting':'workflow';
  return `<button type="button" class="reference-tile" data-action="${action}" data-value="${esc(id)}">${simpleReference(item.title,subtitle,kind==='idea'?'light':kind==='meeting'?'people':group?.icon||'flow',detail)}${symbol('chevron','reference-arrow')}</button>`;
}
function openIdea(id) {
  const item=ideaRecord(id);
  if (!item) return;
  if (item.state!=='brought') return openProject(item.draftProject);
  if (dialog.open) dialog.close();
  Object.assign(ui,{page:'ideas',idea:id,project:null,task:null,editor:false,mobileOpen:false});
  render();
}
function ideasPage() {
  const source=ideaRecord(ui.idea);
  const promoted=data.ideas.filter(idea=>idea.state==='brought'&&project(idea.project));
  const drafts=data.projects.filter(flow=>flow.area===ideaArea.id&&projectInWork(flow));
  return hero('Work area','Ideas','',button('edit-idea','New idea','plus','primary'))+
    (drafts.length?projectList(drafts,'Idea workflows'):`<section class="panel empty"><span class="tile-icon">${symbol('light')}</span>
      <h2>No open ideas</h2>${button('edit-idea','Start an idea','plus','ghost')}</section>`)+
    (source?.state==='brought'?`<section class="panel project-document source-idea">
      <header class="panel-head"><h2>${esc(source.title)}</h2>${ideaStatus(source)}</header>
      ${source.body?`<p class="document-note">${richText(source.body)}</p>`:''}
      ${button('workflow','Open project','flow','primary',source.project)}
      ${ideaNotes(source)}</section>`:'')+
    (promoted.length?`<details class="panel promoted-ideas"><summary>${symbol('check')} Promoted ideas <span>${promoted.length}</span></summary>
      <div class="reference-grid">${promoted.map(item=>objectLink('idea:'+item.id)).join('')}</div></details>`:'');
}
function ideaNotes(item) {
  return `<section class="panel document-section idea-notes"><h3>${symbol('message')} Idea notes</h3>
    ${item.notes.map(entry=>`<div class="document-comment">${avatar(person(entry.author),'small')}<div><strong>${esc(ownerName(entry.author))}</strong><p>${richText(entry.body)}</p></div></div>`).join('')||'<p class="dim">No notes yet.</p>'}
    <form id="idea-note-form" class="document-inline"><input type="hidden" name="id" value="${esc(item.id)}">
      <label class="field"><span class="sr-only">Idea note</span><textarea name="body" rows="2" maxlength="1600" required placeholder="Add a note"></textarea></label><button type="submit" class="btn">${symbol('send')}Post note</button><p class="form-error" hidden role="alert"></p></form>
  </section>`;
}
function ideaActions(item) {
  const destination=area(item.area);
  const edit=item.author===ui.actor||isAdmin();
  return (edit?iconButton('edit-idea','Edit idea details','edit',item.id):'')+
    (item.state==='draft'&&edit?button('refer-idea','Send to work area','send','',item.id):'')+
    (item.state==='sent'&&destination&&(destination.lead===ui.actor||isAdmin())?button('bring-idea','Promote to '+destination.title,'send','primary',item.id):'');
}
function editIdeaDialog(id) {
  const item=ideaRecord(id),flow=project(item?.draftProject);
  if (item&&(!isActiveProject(flow)||item.state==='brought'||!canManageProject(flow))) return;
  formDialog(item?'Edit idea':'New idea','idea-form',`<input type="hidden" name="id" value="${esc(id)}">
    ${textField('title','Idea name',item?.title,90)}${areaField('body','Pitch or notes',item?.body)}`,item?'Save idea':'Create idea');
}
function saveIdea(form,fields) {
  const item=ideaRecord(fields.get('id')),flow=project(item?.draftProject);
  if (item&&(!isActiveProject(flow)||item.state==='brought'||!canManageProject(flow))) return;
  const title=fields.get('title').trim(),body=fields.get('body').trim();
  if (!title) return formError(form,'Enter an idea name.');
  return runWrite(()=>workspaceApi.idea(item?.id,item?'edit':'create',{title,body}),result=>{
    dialog.close();openProject(String(result.project_id),null,'',!item);
  },form);
}
function referIdea(id) {
  const item=ideaRecord(id),flow=project(item?.draftProject);
  if (!isActiveProject(flow)||flow.area!==ideaArea.id||item.state!=='draft'||!canManageProject(flow)) return;
  const options=data.areas.filter(group=>person(group.lead)).map(group=>
    option(group.id,group.title+' · '+ownerName(group.lead),item.area));
  formDialog('Send idea to a work area','refer-idea-form',`<input type="hidden" name="id" value="${esc(id)}">
    ${selectField('area','Destination work area',option('','Choose a work area',item.area||'')+options.join(''))}`,'Send for review');
}
function sendIdea(form,fields) {
  const item=ideaRecord(fields.get('id')),flow=project(item?.draftProject),group=area(fields.get('area'));
  if (!isActiveProject(flow)||flow.area!==ideaArea.id||item.state!=='draft'||!canManageProject(flow)) return;
  if (!group||group.id===ideaArea.id||!person(group.lead)) return formError(form,'Choose a destination with a work area owner.');
  return runWrite(()=>workspaceApi.idea(item.id,'refer',{process_id:Number(group.id.slice(5))}),()=>dialog.close(),form);
}
function ideaPromotion(id) {
  const item=ideaRecord(id),flow=project(item?.draftProject),group=area(item?.area);
  if (item?.state!=='sent'||!isActiveProject(flow)||flow.area!==ideaArea.id||!group?.lead||
    (group.lead!==ui.actor&&!isAdmin())) return null;
  return {item,flow,group};
}
function bringIdeaDialog(id) {
  const ready=ideaPromotion(id);
  if (!ready) return;
  const {item,flow,group}=ready;
  formDialog('Promote idea to '+group.title,'bring-idea-form',
    `<input type="hidden" name="id" value="${esc(id)}">${textField('title','Project name',flow.title,90)}
    <div class="idea-promotion-note">${symbol('flow')}<p>The workflow moves into ${esc(group.title)} with its tasks, owners, dates, and progress. ${esc(ownerName(group.lead))} becomes the project owner.</p></div>`,'Promote to project');
}
function bringIdea(form,fields) {
  const ready=ideaPromotion(fields.get('id'));
  if (!ready) return;
  const {item,flow,group}=ready,title=fields.get('title').trim();
  if (!title||data.projects.some(project=>project.area===group.id&&project.title.toLowerCase()===title.toLowerCase())) return formError(form,'Choose a unique project name in '+group.title+'.');
  return runWrite(()=>workspaceApi.idea(item.id,'promote',{title}),result=>{
    dialog.close();openProject(String(result.project_id),null,'flow');
  },form);
}
function meetingWhen(item) {
  return [item.date?asDate(item.date,true):'Unscheduled',item.time||'',item.end?'– '+item.end:''].filter(Boolean).join(' ');
}
function meetingOwnerCanEdit(item) {
  return Boolean(item&&!item.completedAt&&(isAdmin()||item.owner===ui.actor));
}
function openMeeting(id) {
  const meeting=meetingRecord(id);
  if (!meeting) return;
  if (dialog.open) dialog.close();
  if (meeting.completedAt) ui.archiveView='meetings';
  Object.assign(ui,{page:meeting.completedAt?'archive':'meetings',meeting:id,task:null,editor:false,mobileOpen:false});
  render();
}
function meetingsPage() {
  return hero('Workspace','Meetings','',button('edit-meeting','New meeting','plus','primary'))+meetingsPanel();
}
function meetingsPanel(archived=false) {
  const current=meetingRecord(ui.meeting);
  const selected=current&&Boolean(current.completedAt)===archived?current:null;
  const series=selected&&meetingSeriesRecord(selected.seriesId);
  const linked=selected?.refs.filter(taskRefVisible)||[];
  const followups=selected?.followups.filter(taskRefVisible)||[];
  const now=today(), period=ui.periods.meetings;
  const available=archived?data.meetings:listedMeetings(period);
  const ordered=available.filter(item=>Boolean(item.completedAt)===archived&&(archived||inPeriod({dueDate:item.date},period)));
  if (selected?.seriesId&&!ordered.some(item=>item.id===selected.id)) ordered.push(selected);
  ordered.sort((a,b)=>archived?b.completedAt.localeCompare(a.completedAt):
    Number(a.date<now)-Number(b.date<now)||(a.date<now?b.date.localeCompare(a.date):a.date.localeCompare(b.date))||a.time.localeCompare(b.time));
  return `<div class="workspace-split"><section class="panel meetings-list"><div class="panel-head"><h2>${archived?'Archived meetings':'Sessions'}</h2>${archived?'':periodFilter('meetings')}</div>
    ${ordered.map(item=>`<button class="meeting-preview ${item.id===selected?.id?'current':''}" data-action="open-meeting" data-value="${esc(item.id)}" type="button">
      <span class="meeting-date-tile"><strong>${esc(item.date.slice(8))}</strong><small>${esc(asDate(item.date).split(' ')[0])}</small></span>
      <span class="reference-copy"><strong>${esc(item.title)}</strong><small>${esc(item.time)} · ${esc(ownerName(item.owner))}${item.seriesId?` <span class="meeting-repeat-tag">${symbol('loop')} Weekly</span>`: ''}</small></span>
      ${symbol('chevron')}</button>`).join('')||`<p class="detail-empty">${archived?'No archived meetings yet.':'No meetings scheduled yet.'}</p>`}</section>
    <section class="panel project-document">${selected?`<header class="project-document-head"><span class="document-mark">${symbol('people')}</span><div>
      <div class="eyebrow">${esc(meetingWhen(selected))}</div><h2>${esc(selected.title)}</h2>
      <div class="document-meta">${avatar(person(selected.owner),'small')}${esc(ownerName(selected.owner))}
        ${series?`<span class="meeting-repeat-tag">${symbol('loop')}${esc(meetingRepeatLabel(selected))}</span>`:''}</div></div>
      <div class="meeting-record-actions">
        ${archived?`<span class="status done">${symbol('check')} Done</span>`:
          meetingOwnerCanEdit(selected)?iconButton('edit-meeting','Edit meeting','edit',selected.id):''}
        ${series&&!archived&&(isAdmin()||series.owner===ui.actor)?button('meeting-series-window','Manage repeat','loop','ghost',selected.id):''}
        ${isAdmin()||selected.owner===ui.actor?
          button('meeting-done',archived?'Reopen meeting':'Mark meeting done',archived?'loop':'check','ghost',selected.id):''}
      </div></header>
      <section class="document-section meeting-checklist">${meetingChecklist(selected)}</section>
      ${linked.length?`<section class="document-section"><h3>${symbol('link')} Discussion material</h3><div class="reference-grid">${linked.map(objectLink).join('')}</div></section>`:''}
      <section class="document-section" id="meeting-report" tabindex="-1">
        <div class="detail-line meeting-report-head"><h3>${symbol('journal')} Meeting report</h3>${reportControls('meeting')}</div>
        ${selected.note?`<div class="meeting-note-shell ${selected.pinnedNote?'is-pinned':''}">
          ${selected.pinnedNote||isAdmin()?`<div class="meeting-pin-row">
            ${selected.pinnedNote?`<span class="meeting-note-pin">${symbol('pin')} Pinned on ${asDate(selected.date)}</span>`:'<span></span>'}
            ${isAdmin()?button('pin-meeting-note',selected.pinnedNote?'Unpin note':'Pin to calendar','pin','ghost',selected.id):''}
          </div>`:''}
          <p class="document-note">${richText(selected.note)}</p></div>`:'<p class="dim">No meeting notes yet.</p>'}
        ${followups.length?`<h4>Follow-up tasks</h4><div class="reference-grid">${followups.map(objectLink).join('')}</div>
          <div class="report-import">${button('meeting-to-daily','Add follow-ups to Daily log','journal','',selected.id)}</div>`:''}</section>`:
        `<div class="empty feature-empty">${symbol('people')}<h2>Choose a session</h2><p>Open a meeting to see its agenda, linked work, and report.</p></div>`}</section></div>`;
}
function toggleMeetingPin(id) {
  const meeting=meetingRecord(id);
  if (!isAdmin()||!meeting?.note?.trim()) return;
  return runWrite(()=>workspaceApi.meeting(id,{pinned:!meeting.pinnedNote}));
}
function toggleMeetingDone(id) {
  const meeting=meetingRecord(id);
  if (!meeting||(meeting.owner!==ui.actor&&!isAdmin())) return;
  const reopened=Boolean(meeting.completedAt);
  if (reopened) { delete meeting.completedAt;delete meeting.completedBy; }
  else {meeting.completedAt=new Date().toISOString();meeting.completedBy=ui.actor;}
  storeMeeting(meeting);
  record((reopened?'Reopened meeting ':'Completed meeting ')+meeting.title,null,null,{meeting:id,kind:'meeting'});
  openMeeting(id);
  announce(reopened?'Meeting reopened.':'Meeting moved to Archive.','success');
}
function taskMeetingDialog(id) {
  const item=task(id);
  if (!item) return;
  const meetings=upcomingMeetings().filter(meetingOwnerCanEdit).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  if (!meetings.length) return showDialog('Add to meeting','<p class="dim">No open meetings you manage are available.</p>');
  formDialog('Add to meeting','task-meeting-form',`<input type="hidden" name="task" value="${esc(id)}">
    <div class="reference-tile">${taskContext(item)}</div>
    ${selectField('meeting','Meeting',meetings.map(entry=>option(entry.id,entry.title+' · '+meetingWhen(entry))).join(''))}
    ${selectField('section','Add to',option('refs','Discussion')+option('followups','Follow-ups'))}`,'Add task');
}
function saveTaskMeeting(form,fields) {
  const item=task(fields.get('task')),meeting=meetingRecord(fields.get('meeting')),section=fields.get('section');
  if (!item||!meetingOwnerCanEdit(meeting)||!['refs','followups'].includes(section))
    return formError(form,'Choose an open meeting you manage.');
  const ref='task:'+item.id;
  if (meeting[section].includes(ref)) return formError(form,'This task is already in that section.');
  meeting[section].push(ref);
  storeMeeting(meeting);
  recordTask('Added '+item.title+' to a meeting',item,{meeting:meeting.id,kind:'meeting'});
  dialog.close();
  announce('Added to '+meeting.title+' · '+(section==='refs'?'Discussion':'Follow-ups')+'.','success');
}
function meetingReferences() {
  const workflows=data.projects.map(flow=>({value:'workflow:'+flow.id,label:flow.title+' · Workflow',content:simpleReference(flow.title,area(flow.area)?.title+' · Workflow','flow',projectStateChip(flow)),search:flow.title+' '+area(flow.area)?.title+' workflow'}));
  const ideas=data.ideas.map(item=>({value:'idea:'+item.id,label:item.title+' · Idea',content:simpleReference(item.title,area(item.area)?.title+' · Idea','light',ideaStatus(item)),search:item.title+' '+area(item.area)?.title+' idea'}));
  const tasks=activeTasks().map(item=>({value:'task:'+item.id,label:item.title+' · '+project(item.project)?.title,content:taskContext(item),
    search:item.title+' '+project(item.project)?.title+' '+area(project(item.project)?.area)?.title+' task'}));
  return {all:[...workflows,...ideas,...tasks],tasks};
}
function editMeetingDialog(id) {
  const item=meetingRecord(id);
  if (item&&!meetingOwnerCanEdit(item)) return;
  const refs=meetingReferences();
  formDialog(item?.seriesId?'Edit this session':item?'Edit meeting':'New meeting','meeting-form',`<input type="hidden" name="id" value="${esc(id)}">
    ${textField('title','Meeting name',item?.title,100)}
    <div class="meeting-fields"><label class="field">Date<input type="date" name="date" required value="${esc(item?.date||today())}"></label>
     <label class="field">Start time<input type="time" name="time" required value="${esc(item?.time||'10:00')}"></label>
     <label class="field">End time<input type="time" name="end" value="${esc(item?.end)}"></label></div>
    ${item?.seriesId?`<p class="meeting-repeat-tag">${symbol('loop')}${esc(meetingRepeatLabel(item))} · Changes apply to this session</p>`:`
      <div class="meeting-repeat-editor">${selectField('repeat','Repeat',option('','Does not repeat')+option('weekly','Every week'))}
        <div data-repeat-options hidden>
          <p class="meeting-repeat-hint" data-repeat-hint></p>
          <label class="field">Repeat through <small>Optional</small><input type="date" name="repeatEnd"></label>
        </div>
      </div>`}
    ${selectField('owner','Meeting owner',data.team.map(member=>option(member.id,member.name,item?.owner||ui.actor)).join(''))}
    ${checkEditor('agenda','Agenda checklist',(item?.agenda||[]).map(entry=>({label:entry.text})))}

    ${areaField('note','Meeting report',item?.note)}
    <details class="reference-shelf" ${item?.refs.length?'open':''}><summary>${symbol('link')} Discussion material</summary>
      <input type="search" class="reference-search" data-reference-search placeholder="Find a workflow, idea, or task" aria-label="Search discussion material">
      ${referenceChoices('refs',refs.all,item?.refs)}</details>
    <details class="reference-shelf" ${item?.followups.length?'open':''}><summary>${symbol('checklist')} Report follow-ups</summary>
      <input type="search" class="reference-search" data-reference-search placeholder="Find a task" aria-label="Search follow-up tasks">
      ${referenceChoices('followups',refs.tasks,item?.followups)}</details>`, 'Save meeting');
  dialog.classList.add('workspace-picker-dialog');
  updateRepeatFields(dialog.querySelector('#meeting-form'));
}
function saveMeeting(form,fields) {
  const item=meetingRecord(fields.get('id'));
  if (item&&!meetingOwnerCanEdit(item)) return;
  const title=fields.get('title').trim(),date=fields.get('date'),time=fields.get('time'),end=fields.get('end');
  const owner=person(fields.get('owner'));
  if (!title||!isScheduleDate(date)||!time||!owner) return formError(form,'Set the meeting name, date, start time, and owner.');
  const weekly=!item?.seriesId&&fields.get('repeat')==='weekly';
  const repeatEnd=weekly?fields.get('repeatEnd')||'':'';
  if (repeatEnd&&(!isScheduleDate(repeatEnd)||repeatEnd<date)) return formError(form,'Choose a repeat end date on or after the first meeting.');
  if (end&&end<=time) return formError(form,'End time must be after start time on the same day.');
  const agenda=fields.getAll('agenda').map(text=>text.trim()).filter(Boolean);
  return runWrite(()=>workspaceApi.meeting(item?.id,{
    title,date,time,end,owner_id:Number(owner.id),agenda,notes:fields.get('note').trim(),
    refs:fields.getAll('refs'),followups:fields.getAll('followups'),repeat:weekly?'weekly':'',repeat_end:repeatEnd,
  }),result=>{dialog.close();openMeeting(result.studio_id||String(result.meeting.id));},form);
}
function updateRepeatFields(form) {
  const options=form.querySelector('[data-repeat-options]');
  if (!options) return;
  const date=form.elements.date.value;
  options.hidden=form.elements.repeat.value!=='weekly';
  form.elements.repeatEnd.disabled=options.hidden;
  form.elements.repeatEnd.min=date;
  options.querySelector('[data-repeat-hint]').textContent=isScheduleDate(date)?'Every '+weeklyDay(date)+' at '+(form.elements.time.value||'the selected time')+'.':'Choose the first meeting date.';
}
function repeatWindowDialog(id) {
  const item=meetingRecord(id),series=item&&meetingSeriesRecord(item.seriesId);
  if (!series||(!isAdmin()&&series.owner!==ui.actor)) return;
  formDialog('Manage weekly repeat','meeting-series-form',`<input type="hidden" name="id" value="${esc(series.id)}">
    <p class="schedule-task-name">${symbol('loop')} <strong>${esc(meetingRepeatLabel(item))}</strong></p>
    <label class="field">Repeat through <small>Optional</small><input type="date" name="date" min="${esc(series.start)}" value="${esc(series.endDate)}"></label>
    <p class="dim">Leave the date empty to keep repeating. Previously saved sessions keep their dates and reports.</p>
    `,'Save repeat');
}
function saveRepeatWindow(form,fields) {
  const series=meetingSeriesRecord(fields.get('id'));
  if (!series||(!isAdmin()&&series.owner!==ui.actor)) return;
  const date=fields.get('date');
  if (date&&(!isScheduleDate(date)||date<series.start)) return formError(form,'Choose a date on or after the first meeting.');
  return runWrite(()=>workspaceApi.meetingSeries(series.id,date),()=>dialog.close(),form);
}
function meetingToDaily(id) {
  const item=meetingRecord(id);
  if (!item) return;
  const current=currentLog(ui.actor,item.date);
  const used=new Set(current?.blocks.filter(block=>block.task).map(block=>block.task));
  const targets=item.followups.map(ref=>task(ref.slice(5))).filter(task=>task&&!used.has(task.id));
  if (!targets.length) return announce('These follow-ups are already in your daily log.');
  Object.assign(ui,{page:'daily',dailyDate:item.date,task:null});
  const report=editLog(ui.actor,item.date);
  report.blocks.push(...targets.map(task=>({id:newId(),type:'task',task:task.id,addedAt:new Date().toISOString()})));
  saveLog(report);
  announce('Added '+targets.length+' follow-up '+(targets.length===1?'task':'tasks')+' to your '+asDate(item.date)+' log.','success');
  Object.assign(ui,{page:'daily',dailyDate:item.date,task:null});render();
}

function moveDailyBlock(id,index) {
  if (!canEditNotebook()) return;
  const report=currentLog(),blocks=report?.blocks;
  const from=blocks?.findIndex(block=>block.id===id);
  if (!(from>=0)) return;
  const target=Math.max(0,Math.min(index,blocks.length));
  if (target===from||target===from+1) return;
  const [block]=blocks.splice(from,1);
  blocks.splice(target>from?target-1:target,0,block);
  saveLog(report);render();
}
let dailyDrag;
function clearDailyDrag() {
  dailyDrag=null;
  document.querySelector('.daily-doc')?.classList.remove('notebook-dragging');
  document.querySelector('.notebook-target')?.classList.remove('notebook-target');
}
function dropIndex(x,y) {
  const doc=document.elementFromPoint(x,y)?.closest('.daily-blocks');
  if (!doc) return null;
  const blocks=[...doc.querySelectorAll('.log-block')];
  const index=blocks.findIndex(block=>{
    const box=block.getBoundingClientRect();
    return y<box.top+box.height/2;
  });
  const drops=doc.querySelectorAll('[data-daily-drop]');
  return Number(drops[index===-1?drops.length-1:index]?.dataset.dailyDrop);
}
document.addEventListener('pointerdown',event=>{
  const source=event.target.closest('[data-log-drag],[data-activity-drag]');
  if (!canEditNotebook()||!source||event.button!==0||!event.isPrimary) return;
  dailyDrag={block:source.dataset.logDrag,activity:source.dataset.activityDrag,
    x:event.clientX,y:event.clientY,pointer:event.pointerId};
  source.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener('pointermove',event=>{
  const drag=dailyDrag;
  if (drag?.pointer!==event.pointerId) return;
  if (!drag.started&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5) return;
  drag.started=true;
  document.querySelector('.daily-doc')?.classList.add('notebook-dragging');
  const index=dropIndex(event.clientX,event.clientY);
  document.querySelector('.notebook-target')?.classList.remove('notebook-target');
  if (Number.isInteger(index)) document.querySelector('[data-daily-drop="'+index+'"]')?.classList.add('notebook-target');
});
document.addEventListener('pointerup',event=>{
  const drag=dailyDrag;
  if (drag?.pointer!==event.pointerId) return;
  const index=dropIndex(event.clientX,event.clientY);
  clearDailyDrag();
  if (!drag.started||!Number.isInteger(index)) return;
  if (drag.activity) importDaily([drag.activity],index);
  if (drag.block) moveDailyBlock(drag.block,index);
});
document.addEventListener('pointercancel',clearDailyDrag);

function visibleWorkReport(flow) {
  return flow.workReport?.blocks.some(block=>
    (block.task?Boolean(task(block.task)):block.event?data.log.some(event=>event.id===block.event&&canSeeEvent(event)):
      block.type==='checklist'?block.items.some(item=>item.text.trim()):block.type==='image'||Boolean(block.text?.trim())));
}
function refreshAdminActivity() {
  const results=app.querySelector('#admin-activity-results');
  if (results) results.innerHTML=adminUI.activityTable();
}
let adminUI;


const unsupportedActions = new Set([
  'identity', 'switch-person',
]);
function markUnsupported(root) {
  for (const control of root.querySelectorAll('[data-action]')) {
    if (unsupportedActions.has(control.dataset.action)||
        control.dataset.action==='builder-tool'&&['project','frame'].includes(control.dataset.value)&&ui.project==='unassigned') {
      control.dataset.studioPending='true';
      control.setAttribute('aria-disabled','true');
    }
  }
}

function updateStudioRoute() {
  if (restoringRoute) return;
  const route = new URLSearchParams();
  if (ui.page !== 'mine') route.set('page',ui.page);
  if (ui.page === 'mine' && ui.myView !== 'focus') route.set('view',ui.myView);
  if (ui.page === 'area') {
    if (ui.area) route.set('area',ui.area);
    if (ui.project) route.set('project',ui.project);
    if (ui.view !== 'flow') route.set('view',ui.view);
  }
  if (ui.task) route.set('task',ui.task);
  const hash = route.size ? '#'+route : '';
  if (location.hash !== hash) history.pushState(null,'',location.pathname+location.search+hash);
}

function restoreStudioRoute() {
  const route = new URLSearchParams(location.hash.slice(1));
  const page = route.get('page');
  const views = ['flow','stages','board','updates','project-notes','project-report','calendar','list','summary'];
  const flow = project(route.get('project'));
  const group = area(flow?.area||route.get('area'));
  restoringRoute = true;
  ui.page = page==='area'&&group ? 'area' : page==='admin'&&isAdmin() ? page : Object.hasOwn(pageSymbols,page) ? page : 'mine';
  ui.myView = ['focus','tasks','calendar','showroom'].includes(route.get('view')) ? route.get('view') : 'focus';
  ui.project = flow?.id || null;
  ui.area = group?.id || null;
  ui.view = views.includes(route.get('view')) ? route.get('view') : 'flow';
  ui.task = task(route.get('task'))?.id || null;
  ui.detail = 'details';
  ui.editor = false;
  if (group) ui.expandedAreas.add(group.id);
  render();
  restoringRoute = false;
}

function setStudioState(payload) {
  if (!stateLoaded) Object.assign(ui.showroom,payload.showroomView);
  for (const [key,pending] of notebookPending) {
    if (key.startsWith('project:')) {
      const flow=payload.projects.find(project=>project.id===key.slice(8));
      if (flow) flow.workReport=pending.report;
    } else {
      (payload.dailyLogs[payload.actor] ||= {})[key]=pending.report;
    }
  }
  for (const item of payload.tasks) {
    if (availableDetails.has(item.id)) Object.assign(item,availableDetails.get(item.id));
  }
  Object.assign(data,payload);
  setObjectives(data.objectives);
  ui.actor = data.actor;
  adminUI = administrationUI({data,ui,upcomingMeetings,esc,symbol,button,iconButton,tab,select:adminSelect,
    area,person,ownerName,avatar,project,visibleActivity,projectTasks,visibleWorkReport,isOpen,isBlocked,isOverdue,
    reportReady,objectives,northStar,krData,shortTime,meetingWhen,taskRefVisible,projectStateChip,kpiDisplay,activity});
  stateLoaded = true;
}

async function loadTaskDetails(item) {
  if (pendingDetails.has(item.id)) return pendingDetails.get(item.id);
  const promise = workspaceApi.detail(item.id).then(response=>{
    if (task(item.id)?.updatedAt !== item.updatedAt) return;
    const details = taskDetailsData(response);
    availableDetails.set(item.id,details);
    Object.assign(task(item.id),details);
    detailsErrors.delete(item.id);
  }).catch(error=>{
    detailsErrors.set(item.id,error.message);
  }).finally(()=>{
    pendingDetails.delete(item.id);
    if (ui.task === item.id) render();
  });
  pendingDetails.set(item.id,promise);
  return promise;
}

async function runWrite(request, complete, form) {
  if (writePending) return;
  writePending = true;
  form?.setAttribute('aria-busy','true');
  let committed = false;
  try {
    const result=await request();
    committed = true;
    const next=workspaceData(await workspaceApi.load());
    availableDetails.clear();
    detailsErrors.clear();
    setStudioState(next);
    complete?.(result);
    render();
    announce('Saved.','success');
  } catch (error) {
    const message = committed ? 'Saved. Reload the workspace to see the updated records.' : error.message;
    if (form?.querySelector('.form-error') && !committed) formError(form,message);
    else announce(message,'danger');
    if (!form && !committed) render();
  } finally {
    form?.removeAttribute('aria-busy');
    writePending = false;
  }
}

function studioTaskBody(item,pending,ownRounds,editable) {
  if (!availableDetails.has(item.id)) {
    const error = detailsErrors.get(item.id);
    return '<section class="detail-section" role="status">'+(error
      ? `<p>${esc(error)}</p>${button('retry-task-details','Retry','loop')}`
      : '<p>Loading task details…</p>')+'</section>';
  }
  if (ui.detail==='details') return taskDetails(item,pending,ownRounds,editable);
  if (ui.detail==='notes') return notes(item);
  if (ui.detail==='workflow') return studioWorkflow(item);
  return activity(item.history,true);
}

function studioAttachments(item,editable) {
  return `<section class="detail-section"><h3>${symbol('file')} Attachments</h3>
    ${item.attachments.map(file=>`<p><a class="text-link" href="${esc(file.download_url)}">${esc(file.name)}</a></p>`).join('')||'<p>No attachments yet.</p>'}
    ${item.project!=='unassigned'&&project(item.project)?.area!==ideaArea.id&&isActiveProject(project(item.project))
      ?button('project-files','Browse Nextcloud project files','file','ghost',item.project):''}
    ${editable?`<form id="task-attachment-form" class="inline-check-form"><input type="file" name="file"
      aria-label="Choose a task attachment" required><button class="btn" type="submit">Upload</button></form>`:''}</section>`;
}

let fileBrowserRequest=0;
function nextcloudFileLink(nativeFolder,fileId) {
  const file=new URL(nativeFolder);
  if (!['http:','https:'].includes(file.protocol)) return '';
  if (fileId) {
    if (!/^\d+$/.test(fileId)) return '';
    const index=file.pathname.indexOf('/index.php/');
    if (index<0) return '';
    file.pathname=file.pathname.slice(0,index)+'/index.php/f/'+fileId;
    file.search='';
  }
  return '/api/platform/nextcloud/sso/?next='+encodeURIComponent(file.href);
}

async function projectFilesDialog(id,path='',attempt=0) {
  const flow=project(id);
  if (!flow) return;
  const sequence=++fileBrowserRequest;
  const context=JSON.stringify({id,path});
  showDialog('Nextcloud project files','<p class="dim" data-file-status>Loading files…</p>','file');
  try {
    const {items,native_url,can_edit}=await workspaceApi.projectFiles(id,path);
    if (sequence!==fileBrowserRequest||!dialog.open||!dialog.querySelector('[data-file-status]')) return;
    const folder=nextcloudFileLink(native_url);
    const fileRow=item=>{
      if (item.folder) return button('project-files-folder',item.name,'file','ghost',JSON.stringify({id,path:item.path}));
      const link=item.file_id?nextcloudFileLink(native_url,item.file_id):'';
      const title=link?`<a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>`:
        `<span>${esc(item.name)}</span>`;
      return title+(item.canonical?button('project-file-history','Version history','clock','ghost',
        JSON.stringify({id,folder:path,path:item.path})):'');
    };
    showDialog('Nextcloud project files',`<p class="dim">${esc(path||flow.title)}</p>
      <div class="form-actions">
      ${path?button('project-files-folder','Parent folder','left','ghost',JSON.stringify({id,path:path.split('/').slice(0,-1).join('/')})):''}
      ${folder?`<a class="btn" href="${esc(folder)}" target="_blank" rel="noopener noreferrer">Open folder in Nextcloud</a>`:''}</div>
      <ul class="checks">${items.map(item=>`<li>${fileRow(item)}</li>`).join('')||'<li>This folder is empty.</li>'}</ul>
      ${can_edit?`<form id="native-file-form" class="inline-check-form"><p class="form-error" role="alert" hidden></p>
        <input type="hidden" name="context" value="${esc(context)}"><input type="file" name="file"
        aria-label="Choose a Nextcloud file" required><button type="submit" class="btn">Upload to Nextcloud</button></form>`:''}`,'file');
  } catch (error) {
    if (sequence!==fileBrowserRequest||!dialog.open||!dialog.querySelector('[data-file-status]')) return;
    if (error.code==='studio_project_storage_pending'&&attempt<40) {
      dialog.querySelector('[data-file-status]').textContent='Preparing this project’s Nextcloud Team Folder…';
      setTimeout(()=>{
        if (sequence===fileBrowserRequest&&dialog.open&&dialog.querySelector('[data-file-status]'))
          projectFilesDialog(id,path,attempt+1);
      },3000);
      return;
    }
    showDialog('Nextcloud project files',`<p role="alert">${esc(error.status===503?'Nextcloud storage is unavailable.':error.message)}</p>
      ${button('project-files-folder','Retry','loop','ghost',context)}`,'file');
  }
}

async function projectFileHistory({id,folder,path,version}) {
  const sequence=++fileBrowserRequest;
  const back=version?button('project-file-history','Back to versions','left','ghost',JSON.stringify({id,folder,path})):
    button('project-files-folder','Back to files','left','ghost',JSON.stringify({id,path:folder}));
  showDialog('Project file versions','<p class="dim" data-file-status>Loading versions…</p>','file');
  try {
    const result=await workspaceApi.fileRevisions(id,path,version);
    if (sequence!==fileBrowserRequest||!dialog.open||!dialog.querySelector('[data-file-status]')) return;
    const content=version?`<p class="dim">Read-only snapshot · ${esc(shortTime(result.revision.created_at))}</p>
      <textarea class="note-body" readonly rows="12" aria-label="Historical file content">${esc(result.revision.content)}</textarea>`:
      `<ul class="checks">${result.revisions.map(entry=>`<li>${button('project-file-history',
        shortTime(entry.created_at)+' · '+entry.source,'clock','ghost',JSON.stringify({id,folder,path,version:entry.id}))}</li>`).join('')||
        '<li>No previous snapshots recorded.</li>'}</ul>`;
    showDialog('Project file versions',`<p class="dim">${esc(path)}</p>${content}<div class="form-actions">${back}</div>`,'file');
  } catch (error) {
    if (sequence===fileBrowserRequest&&dialog.open&&dialog.querySelector('[data-file-status]'))
      showDialog('Project file versions',`<p role="alert">${esc(error.message)}</p><div class="form-actions">${back}</div>`,'file');
  }
}

function studioWorkflow(item) {
  const workflow = item.workflow;
  if (!workflow) return `<section class="detail-section"><p>No workflow attached.</p>
    ${item.canEdit&&!item.archived&&!item.parentId&&item.status!=='done'?button('install-workflow','Attach workflow','flow','primary',item.id):''}</section>`;
  const steps = workflow.steps.map(step=>`<li class="detail-line"><span>${esc(step.title)} · ${esc(step.status)}</span>
    ${step.can_edit&&step.status!=='done'&&!workflow.final_approval?button('workflow-step','Mark step done','check','ghost',step.id):''}</li>`).join('');
  const finalReviewer=workflow.assigned_reviewers?.final;
  const mayFinalize=workflow.can_edit&&(!finalReviewer||finalReviewer===workflow.viewer_id);
  return `<section class="detail-section"><h3>${esc(workflow.template)}</h3><ul class="checks">${steps}</ul>
    ${workflow.can_assign_reviewers&&!workflow.final_approval&&!item.archived
      ?button('workflow-reviewers','Assign reviewers','people','ghost'):''}
    ${finalReviewer?`<p>Final approver · ${esc(ownerName(String(finalReviewer)))}</p>`:''}
    ${workflow.steps_done?workflow.parts.map(part=>studioQaPart(workflow,part)).join(''):'<p>Complete the workflow steps to open QA.</p>'}
    ${workflow.final_approval?`<p>Final approval by ${esc(workflow.final_approval.by.name)} · ${shortTime(workflow.final_approval.at)}</p>`:
      mayFinalize&&workflow.steps_done&&workflow.parts.every(part=>part.iterations.at(-1)?.status==='approved')
        ?button('workflow-finalize','Final approval','check','primary'):''}</section>`;
}

const qaNumber = number => 'QA '+String(number).padStart(3,'0');
function studioQaPart(workflow,part) {
  const iteration = part.iterations.at(-1);
  const assigned = workflow.assigned_reviewers?.[part.id];
  const reviewer = workflow.can_edit && (!assigned||assigned===workflow.viewer_id) && iteration.submitted?.by.id !== workflow.viewer_id;
  const stamp = record => record ? `${esc(record.by.name)} · ${shortTime(record.at)}` : '';
  const evidence = url => {
    try {
      if (['http:','https:'].includes(new URL(url).protocol)) {
        return `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
      }
    } catch {}
    return '—';
  };
  return `<section class="detail-section"><h3>${esc(part.label||part.name||'Review')}</h3>
    ${assigned?`<p>Reviewer · ${esc(ownerName(String(assigned)))}</p>`:''}
    ${part.iterations.map(entry=>`<details ${entry===iteration?'open':''}><summary>${qaNumber(entry.number)} · ${esc(entry.status.replaceAll('_',' '))}</summary>
      <ul class="checks">${entry.items.map(check=>`<li>${check.done?'✓':'○'} ${esc(check.text)}</li>`).join('')}</ul>
      ${entry.preview?`<p>Preview ${evidence(entry.preview)}</p>`:''}
      ${entry.reference?`<p>Reference ${evidence(entry.reference)}</p>`:''}
      ${entry.submitted?`<p>Submitted by ${stamp(entry.submitted)}</p>`:''}
      ${entry.reviewed?`<p>Reviewed by ${stamp(entry.reviewed)}</p>`:''}
      ${entry.comments.map(comment=>`<p>${esc(comment.text)} <small>${stamp(comment)}</small></p>`).join('')}</details>`).join('')}
    ${workflow.can_edit&&iteration.status==='draft'?button('workflow-qa','Edit '+qaNumber(iteration.number),'edit','ghost',part.id):''}
    ${iteration.status==='in_review'?(workflow.can_comment?button('workflow-feedback','Comment','message','ghost',part.id):'')+
      (reviewer?button('workflow-request-changes','Request changes','loop','ghost',part.id)+
        button('workflow-approve','Approve QA','check','primary',part.id):''):''}
  </section>`;
}

function workflowReviewersDialog() {
  const workflow=task(ui.task)?.workflow;
  if (!workflow?.can_assign_reviewers) return;
  const field=(key,label)=>{
    const current=String(workflow.assigned_reviewers?.[key]||'');
    const choices=option('','Any eligible reviewer',current)+data.team.map(member=>option(member.id,member.name,current)).join('');
    return selectField('reviewer-'+key,label,choices);
  };
  formDialog('Assign reviewers','workflow-reviewers-form',
    workflow.parts.map(part=>field(part.id,part.name)).join('')+field('final','Final approver'),'Save assignments');
}

function qaDialog(partId,action) {
  const item=task(ui.task);
  const part=item?.workflow?.parts.find(entry=>String(entry.id)===partId);
  if (!part) return;
  const iteration=part.iterations.at(-1);
  const context=`<input type="hidden" name="part" value="${part.id}"><input type="hidden" name="iteration" value="${iteration.number}">
    <input type="hidden" name="revision" value="${item.workflow.revision}">`;
  if (action==='edit') {
    formDialog(qaNumber(iteration.number),'workflow-qa-form',context+
      `<label class="field">Preview URL<input name="preview" type="url" value="${esc(iteration.preview)}"></label>
      <label class="field">Reference URL<input name="reference" type="url" value="${esc(iteration.reference)}"></label>
      <ul class="checks">${iteration.items.map(check=>`<li><label><input type="checkbox" name="done"
        value="${esc(check.id)}" ${check.done?'checked':''}>${esc(check.text)}</label></li>`).join('')}</ul>
      ${selectField('action','Action',option('save','Save draft')+option('submit','Submit for review'))}`, 'Save');
  } else {
    const label={comment:'Comment',request_changes:'Request changes',approve:'Approve QA'}[action];
    formDialog(label,'workflow-feedback-form',context+
      `<input type="hidden" name="action" value="${action}">${areaField('feedback',action==='request_changes'?'Required corrections (one per line)':'Findings','')}`,label);
  }
}

async function installWorkflowDialog(id) {
  try {
    const {templates} = await workspaceApi.workflowTemplates();
    if (ui.task !== id) return;
    formDialog('Attach workflow','workflow-install-form',
      selectField('template','Template',templates.filter(template=>template.steps.length).map(template=>option(template.id,template.label)).join('')),
      'Attach workflow');
  } catch (error) {
    announce(error.message,'danger');
  }
}

function readInbox(ids, open) {
  runWrite(()=>workspaceApi.markRead(ids),open);
}

const studioForms = new Map(Object.entries({
  'task-form': saveTask,
  'add-member-form': (form,fields)=>runWrite(()=>workspaceApi.addMember({
    email:fields.get('email').trim(),role:fields.get('role'),
  }),()=>dialog.close(),form),
  'create-staging-account-form': (form,fields)=>runWrite(()=>workspaceApi.addMember({
    create_account:true,name:fields.get('name').trim(),email:fields.get('email').trim(),
    role:fields.get('role'),password:fields.get('password'),
  }),()=>dialog.close(),form),
  'choose-staging-account-form': (form,fields)=>form.onchooseaccount?.(fields.get('id')),
  'staging-account-access-form': (form,fields)=>runWrite(()=>workspaceApi.updateTeamAccount(fields.get('id'),{
    ...(fields.has('role')?{role:fields.get('role')}:{}),is_active:fields.has('active'),
  }),()=>dialog.close(),form),
  'reset-staging-account-form': (form,fields)=>runWrite(()=>workspaceApi.resetTeamPassword(fields.get('id'),fields.get('password')),()=>dialog.close(),form),
  'area-form':saveArea,
  'task-preset-form':savePreset,
  'okr-owner-form':saveOkrOwner,
  'move-form':(form,fields,_item,flow)=>{
    const item=task(fields.get('id'));
    const x=Number(fields.get('x')),y=Number(fields.get('y'));
    if (!canEdit(flow?.id)||item?.project!==flow.id||!item.canEdit||!Number.isInteger(x)||!Number.isInteger(y))
      return formError(form,'Choose a task and enter valid coordinates.');
    Object.assign(item,{x,y});
    return persistCanvas(flow,()=>dialog.close(),form);
  },
  'native-file-form': async (form,fields)=>{
    const {id,path}=JSON.parse(fields.get('context'));
    const file=fields.get('file');
    if (!file?.size || form.dataset.saving) return;
    form.dataset.saving='true';
    try {
      await workspaceApi.projectUpload(id,path,file);
      if (form.isConnected) projectFilesDialog(id,path);
    } catch (error) {
      if (form.isConnected) formError(form,error.message);
    } finally {
      delete form.dataset.saving;
    }
  },
  'workflow-form': saveWorkflow,
  'project-note-form': (_form,fields,_item,flow)=>saveProjectNote(fields,flow),
  'milestone-form': (form,fields,_item,flow)=>saveMilestone(form,fields,flow),
  'project-update-form': (form,fields,_item,flow)=>saveProjectUpdate(form,fields,flow),
  'decision-form': (form,fields,_item,flow)=>resolveDecision(form,fields,flow),
  'okr-check-in-form': saveOkrCheckIn,
  'okr-link-form': saveOkrLink,
  'idea-form': saveIdea,
  'refer-idea-form': sendIdea,
  'bring-idea-form': bringIdea,
  'idea-note-form': (form,fields)=>runWrite(()=>workspaceApi.idea(fields.get('id'),'note',{body:fields.get('body').trim()}),null,form),
  'kpi-form': (form,fields,_item,flow)=>saveKpi(form,fields,flow),
  'report-form': (form,fields,_item,flow)=>saveReport(form,fields,flow),
  'failure-form': (form,fields,_item,flow)=>failProject(form,fields,flow),
  'workflow-reviewers-form': (form,fields,item)=>{
    const reviewers=Object.fromEntries([...fields.entries()].filter(([,value])=>value)
      .map(([name,value])=>[name.slice('reviewer-'.length),Number(value)]));
    runWrite(()=>workspaceApi.workflow(item.id,{action:'assign_reviewers',revision:item.workflow.revision,reviewers}),
      ()=>dialog.close(),form);
  },
  'linked-project-form': (form,fields,_item,flow)=>saveProjectNode(form,fields,flow),
  'canvas-version-form': (form,fields,_item,flow)=>saveCanvasVersion(form,fields,flow),
  'canvas-restore-form': (form,fields,_item,flow)=>applyCanvasRestore(form,fields,flow),
  'loop-form': (form,fields,_item,flow)=>saveLoop(form,fields,flow),
  'pass-form': recordPass,
  'task-schedule-form': saveTaskSchedule,
  'dependency-form': (form,fields,_item,flow)=>saveDependency(form,fields,flow),
  'frame-form': (form,fields,_item,flow)=>saveFrame(form,fields,flow),
  'group-form': (form,fields,_item,flow)=>saveGroup(form,fields,flow),
  'workflow-schedule-form': saveWorkflowSchedule,
  'template-attach-form': (form,fields)=>{
    const item=task(fields.get('task'));
    if (!item?.canEdit) return formError(form,'Choose a task you can edit.');
    runWrite(()=>workspaceApi.workflow(item.id,{
      action:'install',workflow:{template:fields.get('template')},
    }),()=>{dialog.close();ui.task=item.id;ui.detail='workflow';},form);
  },
  'quick-check-form': (form,fields,item)=>runWrite(()=>workspaceApi.addCheck(item.id,fields.get('label').trim()),null,form),
  'note-form': (form,fields,item)=>{
    const body=fields.get('body').trim();
    if (!body) return announce('Write a note before posting.','danger');
    runWrite(()=>workspaceApi.note(item.id,body,mentionIds(body),fields.get('parentId')),()=>{
      noteDrafts.delete(noteDraftKey('task/'+item.id,fields.get('parentId')));
      ui.replyNote=null;
    },form);
  },
  'task-block-form': (form,fields,item)=>{
    const reason=fields.get('reason').trim();
    if (!reason) return formError(form,'Explain what is blocking this task.');
    runWrite(()=>workspaceApi.patch(item,{status:'blocked',blocked_reason:reason}),()=>dialog.close(),form);
  },
  'meeting-form': saveMeeting,
  'meeting-series-form': saveRepeatWindow,
  'meeting-quick-check': addMeetingCheck,
  'profile-form': saveProfile,
  'person-form': savePerson,
  'template-form': (form,fields,_item,flow)=>saveTemplate(form,fields,flow),
  'task-attachment-form': (form,fields,item)=>runWrite(()=>workspaceApi.upload(item.id,fields.get('file')),null,form),
  'workflow-install-form': (form,fields,item)=>runWrite(()=>workspaceApi.workflow(item.id,{
    action:'install',workflow:{template:fields.get('template')},
  }),()=>dialog.close(),form),
  'workflow-qa-form': (form,fields,item)=>{
    const part=item.workflow.parts.find(entry=>entry.id===Number(fields.get('part')));
    const iteration=part.iterations.at(-1);
    const done=new Set(fields.getAll('done'));
    runWrite(()=>workspaceApi.workflow(item.id,{
      action:fields.get('action'), revision:Number(fields.get('revision')),
      part:part.id, iteration:Number(fields.get('iteration')),
      preview:fields.get('preview'), reference:fields.get('reference'),
      items:iteration.items.map(check=>({id:check.id,text:check.text,done:done.has(check.id)})),
    }),()=>dialog.close(),form);
  },
  'workflow-feedback-form': (form,fields,item)=>runWrite(()=>workspaceApi.workflow(item.id,{
    action:fields.get('action'), revision:Number(fields.get('revision')), part:Number(fields.get('part')),
    iteration:Number(fields.get('iteration')), feedback:fields.get('feedback'),
  }),()=>dialog.close(),form),
  'task-meeting-form': (form,fields)=>{
    const item=task(fields.get('task')),meeting=meetingRecord(fields.get('meeting')),key=fields.get('section')==='refs'?'refs':'followups';
    if (!item || !meeting || !meetingOwnerCanEdit(meeting)) return formError(form,'Choose a meeting you can edit.');
    const references=[...new Set([...(meeting[key]||[]),'task:'+item.id])];
    runWrite(()=>workspaceApi.meeting(meeting.id,{
      title:meeting.title,date:meeting.date,time:meeting.time,end:meeting.end,owner_id:Number(meeting.owner),
      notes:meeting.note,agenda:meeting.agenda.map(entry=>entry.text),refs:meeting.refs,followups:meeting.followups,[key]:references,
    }),()=>dialog.close(),form);
  },
  'canvas-task-form': (form,fields,_item,flow)=>{
    if (!flow || !ui.placement) return formError(form,'Choose a position.');
    const title=fields.get('title').trim();
    if (ui.placement.kind==='frame') {
      if (!title) return formError(form,'Name the rectangle.');
      const {x,y,width,height}=ui.placement;
      const frame={id:newId(),title,x,y,width,height};
      flow.frames.push(frame);
      return persistCanvas(flow,()=>{resetBuilder();ui.builderSelection.add(frameKey(frame.id));},form);
    }
    const duration=fields.get('durationDays');
    const preset=taskPresets(flow.area).find(entry=>entry.id===fields.get('preset'));
    const definition=(preset?.dod||[]).join('\n') || fields.get('definition')?.trim();
    if (!title || durationIssue(duration) || !definition) return formError(form,'Set the task name, duration, and Definition of Done.');
    runWrite(()=>workspaceApi.create({
      title, owner_id:Number(flow.owner||ui.actor), status:'ready', duration_days:Number(duration),
      project_id:flow.id==='unassigned'?null:Number(flow.id), priority:'p2',
      definition_of_done:definition, checklist:preset?.checklist||[],
      client_create_id:form.dataset.createId ||= newId(),
    }),result=>{resetBuilder();ui.builderSelection.add(String(result.id));},form);
  },
}));

Object.assign(handlers,{
  'retry-task-details':()=>loadTaskDetails(task(ui.task)),
  'project-files':id=>projectFilesDialog(id),
  'project-file-history':value=>projectFileHistory(JSON.parse(value)),
  'project-files-folder':value=>{
    const {id,path}=JSON.parse(value);
    projectFilesDialog(id,path);
  },
  'remove-selection':removeStudioSelection,
  'use-reviewed-template':id=>{
    if (dialog.dataset.templatePreview!==id) return;
    if ((id.startsWith('saved-')||templates().some(entry=>entry.id===id&&entry.projectTemplate))&&isAdmin())
      return newFlowDialog('',null,id);
    const candidates=activeTasks().filter(item=>item.canEdit&&!item.workflowState&&!item.parentId&&item.status!=='done');
    if (!candidates.length) return showDialog('Use template','<p>No editable tasks are available.</p>');
    formDialog('Use template','template-attach-form',`<input type="hidden" name="template" value="${esc(id)}">`+
      selectField('task','Task',candidates.map(item=>option(item.id,item.title)).join('')), 'Attach workflow');
  },
  'install-workflow':installWorkflowDialog,
  'workflow-reviewers':workflowReviewersDialog,
  'workflow-qa':part=>qaDialog(part,'edit'),
  'workflow-feedback':part=>qaDialog(part,'comment'),
  'workflow-request-changes':part=>qaDialog(part,'request_changes'),
  'workflow-approve':part=>qaDialog(part,'approve'),
  'workflow-step':id=>{
    const item=task(ui.task);
    runWrite(()=>workspaceApi.workflow(item.id,{action:'complete_step',step:Number(id),revision:item.workflow.revision}));
  },
  'workflow-finalize':()=>{
    const item=task(ui.task);
    runWrite(()=>workspaceApi.workflow(item.id,{action:'finalize',revision:item.workflow.revision}));
  },
  'block-task':()=>formDialog('Block task','task-block-form',areaField('reason','Blocker',''),'Block task'),
  'unblock-task':()=>runWrite(()=>workspaceApi.patch(task(ui.task),{status:'ready',blocked_reason:''})),
  'meeting-done':id=>{
    const meeting=meetingRecord(id);
    if (meeting) runWrite(()=>workspaceApi.meeting(id,{status:meeting.completedAt?'active':'done'}),()=>openMeeting(id));
  },
  'archive-task':()=>{
    const item=task(ui.task);
    runWrite(()=>workspaceApi.patch(item,{status:'archived'}));
  },
  'restore-task':()=>{
    const item=task(ui.task);
    runWrite(()=>workspaceApi.patch(item,{status:item.workflowState==='approved'||item.completedAt?'done':'ready'}));
  },
  'inbox-read-all':()=>readInbox(inboxEvents().filter(event=>!event.read).map(event=>event.id)),
  'inbox-read':id=>readInbox([id]),
  'inbox-open':id=>{
    const entry=inboxEvents().find(event=>event.id===id);
    if (!entry) return;
    showTask(entry.task);
    if (!entry.read) readInbox([id]);
  },
});

async function startStudio() {
  app.innerHTML='<main class="main" id="main"><p class="panel empty" role="status">Loading workspace…</p></main>';
  try {
    setStudioState(workspaceData(await workspaceApi.load()));
    restoreStudioRoute();
  } catch (error) {
    app.innerHTML=`<main class="main" id="main"><section class="panel empty"><h1>Workspace</h1><p role="alert">${esc(error.message)}</p>
      ${error.status===401?'<a class="btn primary" href="/login" target="_blank" rel="noopener">Sign in</a>':''}
      <button type="button" class="btn" id="studio-retry">Reload workspace</button></section></main>`;
    app.querySelector('#studio-retry').addEventListener('click',startStudio,{once:true});
  }
}

window.addEventListener('popstate',()=>{if (stateLoaded) restoreStudioRoute();});
startStudio();

function persistCanvas(flow, complete, form) {
  if (flow.id==='unassigned') {
    render();
    return announce('Select a project to save canvas changes.','danger');
  }
  const positions=Object.fromEntries(rawProjectTasks(flow.id).map(item=>[item.id,{x:Math.round(item.x),y:Math.round(item.y)}]));
  const nodes=projectNodes(flow).map(({id,targetProjectId,milestoneId,x,y})=>({id,targetProjectId,milestoneId:milestoneId||'',x,y}));
  const handoffs=flow.edges.filter(([from,to])=>linkedNode(flow,from)||linkedNode(flow,to));
  const previous=structuredClone(flow.savedCanvas);
  const canvas={positions, frames:flow.frames, groups:flow.groups, arrows:flow.layoutArrows, start_date:flow.scheduleStart||'',
    end_time:projectCutoff(flow), nodes, handoffs, loops:flow.loops};
  return runWrite(async()=>{
    try {
      return await workspaceApi.canvas(flow,canvas);
    } catch (error) {
      try {setStudioState(workspaceData(await workspaceApi.load()));} catch {}
      throw error;
    }
  },result=>{
    if (previous) {
      if (ui.canvasUndo.at(-1)?.revision!==flow.canvasRevision) ui.canvasUndo=[];
      ui.canvasUndo.push({flow:flow.id,revision:project(flow.id).canvasRevision,canvas:previous});
      if (ui.canvasUndo.length>30) ui.canvasUndo.shift();
    }
    complete?.(result);
  },form);
}

function removeStudioSelection() {
  const flow=currentProject();
  if (!ui.editor||!canEdit(flow?.id)||!ui.builderSelection.size) return;
  const selected=[...ui.builderSelection];
  const kind = id => id.split(':')[0];
  if (selected.every(id=>kind(id)==='dependency')) {
    const model=graphParts(flow,canvasItems(flow));
    const edges=selected.flatMap(id=>model.visEdges.get(id.slice(11))?.edges || []);
    if (edges.every(edge=>edge.some(id=>linkedNode(flow,id)))) {
      flow.edges=flow.edges.filter(edge=>!edges.some(([from,to])=>edge[0]===from&&edge[1]===to));
      return persistCanvas(flow,resetBuilder);
    }
    if (edges.some(edge=>edge.some(id=>linkedNode(flow,id)))) return announce('Select task or project arrows separately.');
    return runWrite(()=>workspaceApi.dependencies(edges.map(([from,to])=>({from,to,action:'remove'}))),resetBuilder);
  }
  if (selected.every(id=>['frame','group','layout'].includes(kind(id))||linkedNode(flow,id))) {
    flow.projectNodes=projectNodes(flow).filter(node=>!selected.includes(node.id));
    flow.edges=flow.edges.filter(([from,to])=>!selected.includes(from)&&!selected.includes(to));
    flow.frames=flow.frames.filter(frame=>!selected.includes(frameKey(frame.id)));
    flow.groups=flow.groups.filter(group=>!selected.includes(groupKey(group.id)));
    flow.layoutArrows=flow.layoutArrows.filter(arrow=>!selected.includes('layout:'+arrow.id)&&
      !selected.includes(arrow.from)&&!selected.includes(arrow.to));
    return persistCanvas(flow,resetBuilder);
  }
  if (selected.length===1 && canChange(task(selected[0]))) {
    return runWrite(()=>workspaceApi.patch(task(selected[0]),{status:'archived'}),resetBuilder);
  }
  announce('Select dependencies, layout shapes, or one task at a time.','danger');
}
