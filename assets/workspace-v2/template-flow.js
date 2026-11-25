import {workflowStages} from './planning.js';

const nodeWidth=172,nodeHeight=64,columnStep=224,laneStep=104;
export function templateFlowLayout(template) {
  const stages=workflowStages(template,template.tasks.map(item=>({...item,status:item.idea?'idea':'backlog'})));
  const hasFrames=template.frames.length>0;
  const top=hasFrames?56:34;
  const largest=Math.max(1,...stages.map(stage=>stage.ids.length));
  const height=top+(largest-1)*laneStep+nodeHeight+72;
  const width=Math.max(224,stages.length*columnStep-20);
  const positions=new Map(stages.flatMap((stage,i)=>stage.ids.map((id,j)=>[
    id,{x:16+i*columnStep,y:top+(largest-stage.ids.length)*laneStep/2+j*laneStep}
  ])));
  const taskMap=new Map(template.tasks.map(task=>[task.id,task]));
  const marks=stages.map((stage,index)=>({title:stage.label||'Stage '+(index+1),x:16+index*columnStep}));
  const phases=template.frames.map(frame=>{
    const steps=template.tasks.filter(task=>task.x>=frame.x&&task.x<=frame.x+frame.width&&task.y>=frame.y&&task.y<=frame.y+frame.height)
      .map(task=>positions.get(task.id)).filter(Boolean);
    if (!steps.length) return null;
    const left=Math.min(...steps.map(point=>point.x))-9;
    const right=Math.max(...steps.map(point=>point.x))+nodeWidth+9;
    return {title:frame.title,x:left,width:right-left};
  }).filter(Boolean);
  const parallel=template.groups.map(group=>{
    const points=group.members.map(id=>positions.get(id)).filter(Boolean);
    if (points.length<2) return null;
    const x=Math.min(...points.map(point=>point.x))-6;
    const y=Math.min(...points.map(point=>point.y))-11;
    return {title:group.title,x,y,width:Math.max(...points.map(point=>point.x))+nodeWidth+6-x,
      height:Math.max(...points.map(point=>point.y))+nodeHeight+11-y};
  }).filter(Boolean);
  const edges=template.edges.map(([a,b])=>{
    const left=positions.get(a),right=positions.get(b);
    if (!left||!right) return '';
    const start=left.x+nodeWidth,end=right.x-5,y1=left.y+nodeHeight/2,y2=right.y+nodeHeight/2;
    const mid=(start+end)/2;
    return `M ${start} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${end} ${y2}`;
  }).filter(Boolean);
  const loops=template.loops.map((loop,i)=>{
    const from=positions.get(loop.from),to=positions.get(loop.to);
    if (!from||!to) return null;
    const x=from.x+nodeWidth*.66,dest=to.x+nodeWidth*.3;
    const start=from.y+nodeHeight,end=to.y+nodeHeight+5,rail=height-10-i%4*12;
    return {title:taskMap.get(loop.from).title+' → '+taskMap.get(loop.to).title,passes:loop.target,optional:loop.optional,
      d:`M ${x} ${start} V ${rail-6} Q ${x} ${rail} ${x-6} ${rail} H ${dest+6} Q ${dest} ${rail} ${dest} ${rail-6} V ${end}`};
  }).filter(Boolean);
  return {width,height,positions,marks,phases,parallel,edges,loops,nodeWidth,nodeHeight};
}
