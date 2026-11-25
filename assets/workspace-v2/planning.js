import { isDuration } from './task-schedule.js';
import { frameKey, groupKey } from './workflow-frames.js';

export function reachable(flow, start, reverse=false) {
  const seen=new Set([start]), queue=[start];
  for (const id of queue) {
    for (const [from,to] of flow.edges) {
      const previous=reverse?to:from, next=reverse?from:to;
      if (previous===id && !seen.has(next)) {seen.add(next);queue.push(next);}
    }
  }
  return seen;
}

export function workflowStages(flow, items) {
  const tasks=items.filter(item=>!item.archived && item.status!=='idea');
  const byId=new Map(tasks.map(item=>[item.id,item]));
  const depth=new Map(tasks.map(item=>[item.id,0]));
  const pending=new Map(tasks.map(item=>[item.id,new Set()]));
  const outgoing=new Map(tasks.map(item=>[item.id,new Set()]));
  for (const [from,to] of flow.edges) {
    if (!byId.has(from)||!byId.has(to)) continue;
    pending.get(to).add(from);
    outgoing.get(from).add(to);
  }
  const queue=tasks.filter(item=>!pending.get(item.id).size);
  for (const {id} of queue) {
    for (const next of outgoing.get(id)) {
      depth.set(next,Math.max(depth.get(next),depth.get(id)+1));
      pending.get(next).delete(id);
      if (!pending.get(next).size) queue.push(byId.get(next));
    }
  }
  const byStage=new Map();
  for (const item of tasks) {
    const rank=pending.get(item.id).size?Infinity:depth.get(item.id);
    if (!byStage.has(rank)) byStage.set(rank,[]);
    byStage.get(rank).push(item);
  }
  const stages=[...byStage].sort(([a],[b])=>a-b).map(([rank,rows])=>{
    const parallel=rows.length>1&&flow.groups.find(group=>rows.every(item=>group.members.includes(item.id)));
    return {rank,label:parallel?.title || (rank===Infinity?'Unresolved dependencies':''),ids:rows.map(item=>item.id)};
  });
  const ideas=items.filter(item=>!item.archived && item.status==='idea').map(item=>item.id);
  if (ideas.length) stages.push({rank:null,label:'Idea basket',ids:ideas});
  return stages;
}

export function milestoneScheduleImpact(items, taskIds, deadline) {
  const included=new Set(taskIds);
  const linked=items.filter(item=>included.has(item.id)&&!item.archived);
  return {
    linked,
    conflicts:linked.filter(item=>item.status!=='done' && (item.dueDate || item.startDate)>deadline)
  };
}

export function captureTemplate(flow, items) {
  const ordered=items.filter(item=>!item.archived);
  const ids=new Set(ordered.map(item=>item.id));
  const groups=flow.groups.map(group=>({
    id:group.id,title:group.title,members:group.members.filter(id=>ids.has(id))
  })).filter(group=>group.members.length>1);
  const shapes=new Set([...ids,...flow.frames.map(frame=>frameKey(frame.id)),...groups.map(group=>groupKey(group.id))]);
  return {
    tasks:ordered.map(item=>({
      id:item.id,title:item.title,description:item.description,icon:item.icon,importance:item.importance,x:item.x,y:item.y,
      idea:item.status==='idea',durationDays:item.durationDays,checklist:item.checklist.map(entry=>entry.label),dod:item.dod.map(entry=>entry.label)
    })),
    edges:flow.edges.filter(edge=>edge.every(id=>ids.has(id))).map(edge=>edge.slice()),
    groups,frames:structuredClone(flow.frames),
    layoutArrows:flow.layoutArrows.filter(arrow=>shapes.has(arrow.from)&&shapes.has(arrow.to)).map(arrow=>({...arrow})),
    loops:flow.loops.filter(loop=>ids.has(loop.from)&&ids.has(loop.to)).map(({id,from,to,target,optional})=>({id,from,to,target,optional}))
  };
}

export const starterTemplate={
  id:'review-release',name:'Review & release',description:'Prepare a deliverable, review it, and release the approved version.',
  tasks:[
    {id:'prepare',title:'Prepare deliverable',description:'Assemble the deliverable and its supporting material.',icon:'file',importance:7,x:170,y:239,checklist:['Attach the review version'],dod:[]},
    {id:'review',title:'Review deliverable',description:'Check the deliverable and record a decision.',icon:'check',importance:8,x:400,y:239,checklist:['Record approval or required changes'],dod:[]},
    {id:'release',title:'Release approved version',description:'Publish or hand off the approved deliverable.',icon:'send',importance:7,x:630,y:239,checklist:['Verify the published version or handoff'],dod:[]}
  ],
  edges:[['prepare','review'],['review','release']],groups:[],frames:[],layoutArrows:[],loops:[]
};

export function materializeTemplate(template, flow, makeId, defaultDuration=1) {
  const ids=new Map(template.tasks.map(item=>[item.id,makeId()]));
  const checks=labels=>labels.map(label=>({label,done:false}));
  const items=template.tasks.map(({id,idea,checklist,dod,suggestedOwners,...definition})=>({
    ...definition,id:ids.get(id),project:flow.id,status:idea?'idea':'backlog',owners:[...(suggestedOwners||[])],
    collaboratorIds:[],durationDays:isDuration(definition.durationDays)?Number(definition.durationDays):idea?null:defaultDuration,notes:[],checklist:checks(checklist),dod:checks(dod)
  }));
  flow.edges=template.edges.map(([from,to])=>[ids.get(from),ids.get(to)]);
  flow.groups=template.groups.map(group=>({...group,members:group.members.map(id=>ids.get(id))}));
  flow.frames=structuredClone(template.frames);
  flow.layoutArrows=template.layoutArrows.map(arrow=>({...arrow,from:ids.get(arrow.from)||arrow.from,to:ids.get(arrow.to)||arrow.to}));
  flow.loops=template.loops.map(loop=>({...loop,from:ids.get(loop.from),to:ids.get(loop.to),count:0}));
  flow.layoutReady=true;
  return items;
}
