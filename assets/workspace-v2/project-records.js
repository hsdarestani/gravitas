export function upgradeProjectRecords(data) {
  if (data.projectRecordsVersion === 2) return data;
  for (const flow of data.projects) initializeProjectRecords(flow);
  data.projectRecordsVersion=2;
  return data;
}

export function initializeProjectRecords(flow) {
  flow.state ||= 'active';
  flow.kpis ||= [];
  flow.frames ||= [];
  flow.layoutArrows ||= [];
  flow.completions ||= [];
  flow.draftReport ??= null;
  return flow;
}

export const reportReady = flow => Boolean(flow?.state==='active' && flow.owner && flow.draftReport?.author===flow.owner && flow.draftReport.body.trim());

export function completionRecord(flow, items, actor, now, outcome='done', report=flow.draftReport) {
  const tasks=items.filter(item=>item.status!=='idea');
  const doneCount=tasks.filter(item=>item.status==='done').length;
  return {
    ...report, outcome, closedBy:actor, closedAt:now,
    tasksAtClose:tasks.map(item=>({id:item.id,done:item.status==='done'})),
    doneCount,totalCount:tasks.length, kpis:structuredClone(flow.kpis)
  };
}
