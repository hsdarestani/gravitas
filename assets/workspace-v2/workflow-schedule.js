import { projectGate, projectNodes } from './linked-projects.js';
import { reachable } from './planning.js';
import { isDuration, isScheduleDate } from './task-schedule.js';
import { dayAt, dayIndex } from './timing.js';

export function migrateDurations(data, fallbackStart) {
  if (data.durationScheduleVersion===1) return false;
  const earliest=new Map();
  for (const task of data.tasks) {
    const start=isScheduleDate(task.startDate)?task.startDate:'';
    const finish=isScheduleDate(task.dueDate)?task.dueDate:'';
    const inferred=start&&finish&&finish>=start?dayIndex(finish)-dayIndex(start)+1:start||finish?1:0;
    if (!isDuration(task.durationDays)&&isDuration(inferred)) task.durationDays=inferred;
    const first=start||finish;
    if (first&&!task.archived&&task.status!=='idea'&&(!earliest.has(task.project)||first<earliest.get(task.project))) earliest.set(task.project,first);
  }
  for (const flow of data.projects) flow.scheduleStart ||= earliest.get(flow.id)||fallbackStart;
  data.durationScheduleVersion=1;
  return true;
}

const fitsDate=day=>Number.isSafeInteger(day)&&day>=-719162&&day<=2932896;
const dateAtDay=day=>fitsDate(day)?dayAt(day):'';
const properSubset=(smaller,larger)=>smaller.size<larger.size&&[...smaller].every(id=>larger.has(id));

export function workflowSchedule(flow,tasks,gates=new Map()) {
  const active=tasks.filter(item=>!item.archived&&item.status!=='idea');
  const durations=new Map(active.map(item=>[item.id,isDuration(item.durationDays)?Number(item.durationDays):null]));
  const ids=new Set([...durations.keys(),...gates.keys()]);
  const edges=flow.edges.filter(([from,to])=>ids.has(from)&&ids.has(to));
  const incoming=new Map([...ids].map(id=>[id,[]]));
  const outgoing=new Map([...ids].map(id=>[id,[]]));
  for (const [from,to] of edges) {
    incoming.get(to).push(from);
    outgoing.get(from).push(to);
  }
  const pending=new Map([...incoming].map(([id,parents])=>[id,parents.length]));
  const order=[...ids].filter(id=>!pending.get(id));
  for (const id of order) for (const next of outgoing.get(id)) {
    const count=pending.get(next)-1;
    pending.set(next,count);
    if (!count) order.push(next);
  }
  const anchor=isScheduleDate(flow.scheduleStart)?dayIndex(flow.scheduleStart):null;
  const missing=active.filter(item=>durations.get(item.id)===null).length;
  const unresolvedGates=[...gates.values()].filter(date=>date===null||date&&anchor===null).length;
  const empty={dates:new Map(),days:null,reviewDays:null,finish:'',missing,unresolvedGates,hasWork:ids.size>0};
  if (!ids.size || order.length!==ids.size) return {...empty,invalid:order.length!==ids.size};
  const normalized={edges};
  const loops=(flow.loops||[]).filter(loop=>durations.has(loop.from)&&durations.has(loop.to)&&Number.isInteger(loop.target)&&loop.target>0)
    .map(loop=>{
      const forwards=reachable(normalized,loop.to), backwards=reachable(normalized,loop.from,true);
      return {...loop,segment:new Set([...forwards].filter(id=>backwards.has(id)))};
    }).filter(loop=>loop.segment.has(loop.from)).sort((a,b)=>a.segment.size-b.segment.size);
  // Each loop reserves the longest route through the repeated work. A fully
  // nested loop is run again when its outer segment repeats.
  function walk(segment,allowances,useGates) {
    const rows=new Map();
    let release=0;
    for (const id of order) {
      if (!segment.has(id)) continue;
      const parents=incoming.get(id).filter(parent=>segment.has(parent)).map(parent=>rows.get(parent).release);
      const begin=parents.includes(null)?null:Math.max(0,...parents);
      const gate=gates.get(id);
      const duration=durations.has(id)?durations.get(id):0;
      const wait=useGates&&gate?anchor===null?null:dayIndex(gate)-anchor+1:0;
      const finish=begin===null||duration===null||useGates&&gate===null||wait===null?null:Math.max(begin+duration,wait);
      const reserves=allowances.filter(loop=>loop.from===id).map(loop=>loop.days);
      const raw=finish===null||reserves.includes(null)?null:finish+reserves.reduce((sum,days)=>sum+days,0);
      const next=Number.isSafeInteger(raw)?raw:null;
      rows.set(id,{begin,finish,release:next});
      release=release===null||next===null?null:Math.max(release,next);
    }
    return {rows,release};
  }
  const allowances=[];
  for (const loop of loops) {
    const nested=allowances.filter(inner=>properSubset(inner.segment,loop.segment));
    const pass=walk(loop.segment,nested,false).release;
    const reserve=pass===null?null:pass*loop.target;
    allowances.push({...loop,days:Number.isSafeInteger(reserve)?reserve:null});
  }
  const planned=walk(ids,allowances,true);
  const base=walk(ids,[],true).release;
  const dates=new Map();
  if (anchor!==null) for (const [id,row] of planned.rows) {
    if (row.begin===null||row.finish===null||row.release===null) continue;
    const {begin,finish,release}=row;
    dates.set(id,{startDate:dateAtDay(anchor+(gates.has(id)?Math.max(0,finish-1):begin)),
      dueDate:dateAtDay(anchor+Math.max(0,finish-1)),handoffDate:dateAtDay(anchor+Math.max(0,release-1))});
  }
  return {...empty,dates,days:planned.release,reviewDays:planned.release!==null&&base!==null?planned.release-base:null,
    finish:anchor!==null&&planned.release!==null?dateAtDay(anchor+Math.max(0,planned.release-1)):''};
}

export function workspaceSchedules(data, options={}) {
  const {taskId,durationDays,includeTask=false,projectId,startDate}=options;
  const byProject=new Map();
  for (const item of data.tasks) {
    if (!byProject.has(item.project)) byProject.set(item.project,[]);
    byProject.get(item.project).push(item.id===taskId?{...item,durationDays,...(includeTask&&item.status==='idea'?{status:'backlog'}:{})}:item);
  }
  const byId=new Map(data.projects.map(flow=>[flow.id,flow]));
  const plans=new Map(), inProgress=new Set();
  function calculate(id) {
    if (plans.has(id)) return plans.get(id);
    if (inProgress.has(id)) return null;
    const flow=byId.get(id);
    if (!flow) return null;
    inProgress.add(id);
    const gates=new Map();
    for (const node of projectNodes(flow)) {
      const target=byId.get(node.targetProjectId), gate=projectGate(node,target);
      let date=null;
      if (gate.state==='ready') date='';
      if (gate.state==='waiting') {
        date=gate.milestone?gate.milestone.deadline:calculate(target.id)?.finish;
        if (!isScheduleDate(date)) date=null;
      }
      gates.set(node.id,date);
    }
    const schedule=workflowSchedule(id===projectId?{...flow,scheduleStart:startDate}:flow,byProject.get(id)||[],gates);
    plans.set(id,schedule);
    inProgress.delete(id);
    return schedule;
  }
  for (const {id} of data.projects) calculate(id);
  return plans;
}
