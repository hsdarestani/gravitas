export const ideaArea={id:'_ideas',title:'Ideas',icon:'light',lead:''};
export const isArchivedProject=flow=>flow?.state==='done'||flow?.state==='failed';
export const projectInWork=flow=>flow&&!isArchivedProject(flow);

export function projectSignals(flow,visibleTasks,actor,{blocked,overdue}) {
  if (isArchivedProject(flow)) return [flow.state==='done'?'completed':'failed'];
  const assigned=visibleTasks.filter(item=>item.owners.includes(actor)&&item.status!=='idea');
  const signals=[];
  if (assigned.some(item=>item.status!=='done'&&blocked(item))) signals.push('blocked');
  if (assigned.some(item=>item.status!=='done'&&overdue(item))) signals.push('overdue');
  if (assigned.some(item=>item.status!=='done'&&!blocked(item))) signals.push('ready');
  if (assigned.length&&assigned.every(item=>item.status==='done')) signals.push('completed');
  return signals.length?signals:['active'];
}

export function attachIdeaWorkflow(data,idea,initializeProject) {
  if (idea.draftProject||idea.state==='brought') return null;
  const id='idea-workflow-'+idea.id;
  const flow=initializeProject({id,area:ideaArea.id,title:idea.title,description:idea.body,owner:idea.author,
    ideaId:idea.id,edges:[],groups:[],loops:[]});
  const steps=idea.steps||[],ids=steps.map((_,i)=>id+'-task-'+(i+1));
  const depths=[],rows=new Map();
  for (const [i,step] of steps.entries()) {
    const from=Number.isInteger(step.after)&&step.after>=0&&step.after<i?step.after:null;
    const depth=from===null?0:depths[from]+1;
    const row=rows.get(depth)||0;
    rows.set(depth,row+1);
    depths.push(depth);
    if (from!==null) flow.edges.push([ids[from],ids[i]]);
    data.tasks.push({id:ids[i],title:step.title,project:id,icon:'circle',status:'backlog',description:'',
      owners:[idea.author],collaboratorIds:[],checklist:[],dod:[],notes:[],startDate:'',dueDate:'',importance:5,
      x:Number.isFinite(step.x)?step.x+44:109+depth*130,y:Number.isFinite(step.y)?step.y+40:110+row*112});
  }
  idea.draftProject=id;
  data.projects.push(flow);
  return flow;
}
