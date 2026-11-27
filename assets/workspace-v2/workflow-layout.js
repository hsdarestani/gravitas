import {linkedHalfWidth} from './linked-projects.js';
import { containsPoint, frameHierarchy, frameKey, groupKey } from './workflow-frames.js';

const order = (a,b) => a.anchorX-b.anchorX || a.anchorY-b.anchorY || a.key.localeCompare(b.key);
const vertical = (a,b) => a.anchorY-b.anchorY || order(a,b);

function columns(blocks,wires) {
  const ownerByKey=new Map(blocks.flatMap(block=>block.keys.map(key=>[key,block.key])));
  const incoming=new Map(blocks.map(block=>[block.key,new Set()]));
  const outgoing=new Map(blocks.map(block=>[block.key,new Set()]));
  for (const [from,to] of wires) {
    const start=ownerByKey.get(from),end=ownerByKey.get(to);
    if (!start||!end||start===end) continue;
    outgoing.get(start).add(end);
    incoming.get(end).add(start);
  }
  const ranks=new Map(blocks.map(block=>[block.key,0]));
  const indexed=new Map(blocks.map(block=>[block.key,block]));
  const ready=blocks.filter(block=>!incoming.get(block.key).size).sort(order);
  const placed=new Set();
  while (ready.length) {
    const block=ready.shift();
    placed.add(block.key);
    for (const end of outgoing.get(block.key)) {
      ranks.set(end,Math.max(ranks.get(end),ranks.get(block.key)+1));
      incoming.get(end).delete(block.key);
      if (!incoming.get(end).size) ready.push(indexed.get(end));
    }
    ready.sort(order);
  }
  // Dependencies between individual tasks can cross the same pair of frames
  // in opposite directions. Keep their arrows and prefer a stable frame order.
  for (const block of blocks.filter(block=>!placed.has(block.key)).sort(order)) {
    ranks.set(block.key,Math.max(ranks.get(block.key),Math.max(0,...ranks.values())+1));
  }
  if (blocks.length>5&&[...ranks.values()].every(rank=>rank===0)) {
    blocks.slice().sort(order).forEach((block,i)=>ranks.set(block.key,Math.floor(i/4)));
  }
  const strips=new Map();
  for (const block of blocks.slice().sort(vertical)) {
    const rank=ranks.get(block.key);
    if (!strips.has(rank)) strips.set(rank,[]);
    strips.get(rank).push(block);
  }
  return [...strips.entries()].sort(([a],[b])=>a-b).map(([,strip])=>strip);
}

function pack(blocks,wires,padding) {
  const groups=columns(blocks,wires);
  const heights=groups.map(strip=>strip.reduce((total,block)=>total+block.height,0)+Math.max(0,strip.length-1)*25);
  const width=groups.map(strip=>Math.max(...strip.map(block=>block.width)));
  const stackHeight=Math.max(0,...heights);
  let x=padding.x;
  groups.forEach((strip,i)=>{
    let y=padding.top+Math.round((stackHeight-heights[i])/2);
    for (const block of strip) {
      block.left=x+Math.round((width[i]-block.width)/2);
      block.top=y;
      y+=block.height+25;
    }
    x+=width[i]+51;
  });
  return {width:x-(groups.length?51:0)+padding.x,height:padding.top+stackHeight+padding.bottom};
}

export function tidyWorkflow(flow,items) {
  const tasks=items.filter(item=>item.status!=='idea'&&!item.archived);
  const frames=frameHierarchy(flow.frames);
  const assignedFrame=new Map(tasks.map(task=>[
    task.id,frames.slice().reverse().find(({frame})=>containsPoint(frame,task))?.frame.id || ''
  ]));
  const taskById=new Map(tasks.map(task=>[task.id,task]));
  const groups=flow.groups.map(group=>{
    const members=group.members.map(id=>taskById.get(id)).filter(Boolean);
    const parents=new Set(members.map(member=>assignedFrame.get(member.id)));
    return {group,members,parent:members.length>1&&parents.size===1?[...parents][0]:null};
  });
  const grouped=new Set(groups.filter(group=>group.parent!==null).flatMap(group=>group.members.map(member=>member.id)));
  const wires=[...flow.edges,...flow.layoutArrows.map(arrow=>[arrow.from,arrow.to])];
  function build(parent) {
    const nodes=tasks.filter(task=>assignedFrame.get(task.id)===parent&&!grouped.has(task.id)).map(task=>({
      key:task.id,keys:[task.id],width:task.targetProjectId?linkedHalfWidth*2+6:84,height:84,anchorX:task.x,anchorY:task.y,task
    }));
    for (const {group,members} of groups.filter(group=>group.parent===parent)) {
      nodes.push({key:groupKey(group.id),keys:[groupKey(group.id),...members.map(item=>item.id)],width:148,
        height:119+(members.length-1)*96,anchorX:Math.min(...members.map(item=>item.x)),
        anchorY:Math.min(...members.map(item=>item.y)),members:members.slice().sort((a,b)=>a.y-b.y||a.x-b.x)});
    }
    for (const {frame} of frames.filter(item=>item.parent===parent)) {
      const children=build(frame.id);
      const bounds=pack(children,wires,{x:25,top:39,bottom:25});
      nodes.push({key:frameKey(frame.id),keys:[frameKey(frame.id),...children.flatMap(child=>child.keys)],
        width:Math.max(196,bounds.width),height:Math.max(110,bounds.height),anchorX:frame.x,anchorY:frame.y,frame,children});
    }
    return nodes;
  }
  const blocks=build('');
  const packed=pack(blocks,wires,{x:19,top:25,bottom:26});
  const result={tasks:new Map(),frames:new Map()};
  function apply(nodes,x,y) {
    for (const block of nodes) {
      const left=x+block.left,top=y+block.top;
      if (block.task) result.tasks.set(block.task.id,{x:left+block.width/2,y:top+42});
      if (block.members) block.members.forEach((item,i)=>result.tasks.set(item.id,{x:left+74,y:top+62+i*96}));
      if (block.frame) {
        result.frames.set(block.frame.id,{x:left,y:top,width:block.width,height:block.height});
        apply(block.children,left,top);
      }
    }
  }
  apply(blocks,Math.round(Math.max(0,870-packed.width)/2),Math.round(Math.max(0,478-packed.height)/2));
  return result;
}
