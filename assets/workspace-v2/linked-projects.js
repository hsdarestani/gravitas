export const projectNodes = flow => flow?.projectNodes||[];
export const linkedNode = (flow,id) => projectNodes(flow).find(node=>node.id===id);
export const linkedHalfWidth = 68;

export function projectGate(node,target) {
  const milestone=node.milestoneId?(target?.milestones||[]).find(item=>item.id===node.milestoneId):null;
  if (!target) return {state:'unavailable',label:'Project unavailable',milestone};
  if (target.state==='failed') return {state:'failed',label:'Project failed',milestone};
  if (node.milestoneId&&!milestone) return {state:'unavailable',label:'Milestone unavailable',milestone};
  const ready=milestone?milestone.completed:target.state==='done';
  return {state:ready?'ready':'waiting',label:ready?'Handoff ready':milestone?'Waiting for milestone':'Waiting for project',milestone};
}

export function allowsProjectLink(projects,sourceId,targetId) {
  const byId=new Map(projects.map(flow=>[flow.id,flow]));
  if (!byId.has(sourceId)||!byId.has(targetId)) return false;
  const pending=[targetId],visited=new Set();
  for (const id of pending) {
    if (id===sourceId) return false;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const node of projectNodes(byId.get(id))) pending.push(node.targetProjectId);
  }
  return true;
}

export function unmetWorkflowSteps(flow,id,readTask,gate) {
  const edges=flow?.edges||[];
  const incoming=new Map();
  for (const [from,to] of edges) {
    if (!incoming.has(to)) incoming.set(to,[]);
    incoming.get(to).push(from);
  }
  const waiting=new Set(),seen=new Set();
  const queue=(incoming.get(id)||[]).map(from=>({from,linksOnly:false}));
  for (const {from,linksOnly} of queue) {
    const key=String(linksOnly)+':'+from;
    if (from===id||seen.has(key)) continue;
    seen.add(key);
    const link=linkedNode(flow,from);
    if (link ? gate(link).state!=='ready' : !linksOnly&&readTask(from)?.status!=='done') {
      waiting.add(from);
      continue;
    }
    // A completed task can still lead back to a reopened project handoff.
    if (link||projectNodes(flow).length) {
      for (const earlier of incoming.get(from)||[]) queue.push({from:earlier,linksOnly:!link});
    }
  }
  return [...waiting];
}
