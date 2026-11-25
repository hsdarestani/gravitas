import {initializeProjectRecords} from './project-records.js';
import {ideaArea} from './project-lifecycle.js';
import {tidyWorkflow} from './workflow-layout.js';

const statuses = {
  draft:'idea', ready:'backlog', active:'doing', waiting:'backlog',
  needs_review:'doing', retest:'doing', blocked:'backlog', done:'done', archived:'done',
};
export const canonicalStatus = {idea:'draft', backlog:'ready', doing:'active', done:'done'};
export const importanceByPriority = {p0:10, p1:8, p2:5, p3:2};
export function priorityByImportance(importance) {
  if (importance >= 9) return 'p0';
  if (importance >= 7) return 'p1';
  return importance >= 4 ? 'p2' : 'p3';
}

const timeZone = 'Asia/Tehran';
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'});
const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone, hourCycle:'h23', hour:'2-digit', minute:'2-digit'});
const id = value => value == null ? '' : String(value);
const areaId = value => value ? `area-${value}` : 'core';
const projectId = value => value ? String(value) : 'unassigned';
const colors = ['#8fcfe7','#91d9b8','#bfaae8','#f2bc83','#e9a5b9','#9cb5ea','#d8cb86'];
const symbols = {content:'play', research:'target', commercial:'briefcase', technology:'layout', operations:'flow'};

export function workspaceData(payload) {
  const areas = payload.areas.map(area => ({
    id:areaId(area.id), title:area.name, lead:id(area.owner_id), icon:symbols[area.key] || 'layout',
  }));
  areas.push({id:'core', title:payload.workspace.name, lead:'', icon:'briefcase'});

  const projects = payload.projects.map(row => initializeProjectRecords({
    id:id(row.id), area:row.idea_id?ideaArea.id:areas.some(area => area.id === areaId(row.process_id)) ? areaId(row.process_id) : 'core',
    title:row.title, description:row.description, owner:id(row.owner_id),
    state:row.outcome || (row.archived ? 'done' : 'active'), canEdit:row.can_edit,
    kpis:row.kpis||[], draftReport:row.draft_report, completions:row.completions||[],
    revision:row.revision||0, workReport:row.work_report,
    edges:row.canvas.handoffs||[], groups:row.canvas.groups, frames:row.canvas.frames, layoutArrows:row.canvas.arrows,
    canvasRevision:row.canvas_revision, positions:row.canvas.positions, scheduleStart:row.canvas.start_date,
    loops:row.canvas.loops||[], projectNodes:row.canvas.nodes||[], scheduleEndTime:row.canvas.end_time,
    canvasVersions:(row.canvas_versions||[]).map(version=>({...version,snapshot:{
      nodes:[...Object.entries(version.canvas.positions).map(([id,point])=>({id,...point})),...(version.canvas.nodes||[])],
      frames:version.canvas.frames,edges:version.canvas.handoffs||[],
    }})),
    milestones:[], notes:row.notes||[], updates:[], ideaId:id(row.idea_id), ideaSource:id(row.idea_source),
  }));
  if (payload.tasks.some(task => !task.project_id) || payload.can_create_task) {
    projects.push(initializeProjectRecords({
      id:'unassigned', area:'core', title:'Unassigned work', description:'',
      owner:'', canEdit:payload.can_create_task, edges:[], groups:[], loops:[], milestones:[], notes:[], updates:[],
    }));
  }
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const tasks = payload.tasks.map(row => ({
    id:id(row.id), project:projectId(row.project_id), title:row.title, description:row.description,
    owners:[id(row.owner_id)], collaboratorIds:(row.contributor_ids||[]).map(id), visibility:'workspace',
    status:statuses[row.status], canonicalStatus:row.status, archived:row.status === 'archived',
    canEdit:row.can_edit, canComment:row.can_comment, icon:row.workflow_state ? 'flow' : 'circle',
    durationDays:row.duration_days ?? (row.planned_schedule ? Math.round((Date.parse(row.planned_schedule.end_date) -
      Date.parse(row.planned_schedule.start_date))/86400000)+1 : null), importance:importanceByPriority[row.priority] ?? 5,
    dueDate:row.planned_schedule?.end_date || row.due_date || '', startDate:row.planned_schedule?.start_date || '', handoffDate:'',
    startedAt:row.started_at, completedAt:row.completed_at, updatedAt:row.updated_at,
    parentId:id(row.parent_id), meetingId:id(row.meeting_id),
    workflowState:row.workflow_state, workflowPosition:row.workflow_position,
    blockedByDependency:row.blocked_by_dependency, blockedReason:row.blocked_reason,
    predecessorIds:row.predecessor_ids.map(id), notes:[], checklist:[], attachments:[], history:[],
    dod:row.definition_of_done ? row.definition_of_done.split('\n').filter(Boolean).map(label=>({label,done:row.status==='done'})) : [],
    x:140, y:140,
  }));
  const tasksById = new Map(tasks.map(item => [item.id, item]));
  for (const item of tasks) {
    const project = projectsById.get(item.project);
    for (const predecessor of item.predecessorIds) {
      if (tasksById.get(predecessor)?.project === project.id) {
        project.edges.push([predecessor, item.id]);
      }
    }
  }
  const byProject = Map.groupBy(tasks, item => item.project);
  for (const project of projects) {
    const items=byProject.get(project.id)||[];
    const {tasks:layout} = tidyWorkflow(project,items);
    for (const item of items) Object.assign(item, project.positions?.[item.id] || layout.get(item.id));

  }
  for (const row of payload.milestones) {
    projectsById.get(id(row.project_id))?.milestones.push({
      id:id(row.id), title:row.title, deadline:row.due_date || '', completed:row.status === 'done',
      owner:id(row.owner_id), taskIds:[], description:'',
    });
  }
  const notifications = payload.notifications.map(row => ({
    id:id(row.id), actor:id(row.actor?.id), text:row.title, reason:row.event_type,
    task:id(row.task_id), project:tasksById.get(id(row.task_id))?.project,
    at:row.created_at, read:row.read,
  }));
  const meetings = payload.meetings.map(row => {
    const start = new Date(row.scheduled_for);
    const end = new Date(start.getTime() + row.duration_minutes * 60000);
    const completed = ['done', 'archived'].includes(row.status);
    return {id:id(row.id), date:dayFormat.format(start), time:timeFormat.format(start),
      seriesId:row.seriesId, pinnedNote:row.pinnedNote, realId:id(row.real_id),
      end:dayFormat.format(start) === dayFormat.format(end) ? timeFormat.format(end) : '',
      owner:id(row.owner.id), title:row.title, note:row.notes, agenda:row.agenda||[], refs:row.refs||[],
      followups:[...new Set([...(row.followups||[]),...tasks.filter(task=>task.meetingId === id(row.real_id||row.id)).map(task=>'task:'+task.id)])],
      completedAt:completed ? row.scheduled_for : null};
  });
  const objectives = payload.objectives.map(row => ({
    id:'objective-'+row.id, title:row.title, subtitle:row.description, results:row.results.map(result => ({
      id:id(result.id), label:result.title, unit:result.unit, target:result.target == null ? null : Number(result.target),
    })),
  }));
  const results = Object.fromEntries(payload.objectives.flatMap(row => row.results).map(kr => [
    id(kr.id), {baseline:kr.baseline == null ? null : Number(kr.baseline), links:kr.links||[],
      checkIns:(kr.checkins||[]).map(entry=>({...entry,actor:id(entry.actor),value:Number(entry.value)})), current:kr.current == null ? null : Number(kr.current)},
  ]));
  const owners = Object.fromEntries(payload.objectives.flatMap(row => [
    ['objective-'+row.id,id(row.owner_id)], ...row.results.map(kr=>[id(kr.id),id(kr.owner_id)]),
  ]));

  const templates = payload.templates.map(entry=>{
    const tasks=entry.steps.map((title,index)=>({title,id:`${entry.id}-${index+1}`,description:'',icon:'circle',x:0,y:0}));
    return {...entry,tasks, groups:[],frames:[],layoutArrows:[],loops:[],
      edges:tasks.slice(1).map((item,index)=>[tasks[index].id,item.id])};
  });
  const dailyLogs = {};
  const actor = id(payload.actor.id);
  const confirmedReports = {};
  for (const row of payload.daily_reports) {
    (confirmedReports[row.date] ||= []).push(row);
  }
  for (const entry of payload.notebooks||[]) {
    (dailyLogs[actor] ||= {})[entry.date] = entry;
  }
  return {
    actor:id(payload.actor.id), workspace:payload.workspace,
    team:payload.members.map((person,index)=>({...person,id:id(person.id),color:person.color||colors[index % colors.length],
      role:['owner', 'admin'].includes(person.role) ? 'Admin' : 'Member'})),
    areas, projects, tasks, meetings, notifications, objectives, okrs:{owners, results},
    log:[], ideas:(payload.ideas||[]).map(row=>({
      ...row,id:id(row.id),author:id(row.author),area:row.process_id?areaId(row.process_id):'',
      draftProject:row.state==='brought'?null:id(row.project_id),project:row.state==='brought'?id(row.project_id):null,
    })), dailyLogs, confirmedReports, meetingSeries:payload.meeting_series||[], calendarNotes:[], templates:[...templates,...(payload.saved_templates||[])], showroomColors:payload.showroom_colors||{},
    canCreateTask:payload.can_create_task,
  };
}

export function taskDetailsData(payload) {
  return {
    checklist:payload.checklist.map(row=>({id:id(row.id), label:row.title, done:row.is_completed})),
    notes:payload.comments.map(row=>({id:id(row.id), actor:id(row.author.id), body:row.body, at:row.created_at,
      mentions:row.mentions.map(person=>id(person.id)), parentId:id(row.parent_id)})),
    attachments:payload.attachments,
    history:payload.events.map(row=>({
      id:id(row.id), actor:id(row.actor?.id), text:row.detail?.title || row.action, at:row.created_at,
      body:row.report?.summary || '', action:row.action,
    })),
    workflow:payload.workflow ? {...payload.workflow, final_approval:payload.workflow.final_approval?.by ? payload.workflow.final_approval : null} : null,
  };
}
