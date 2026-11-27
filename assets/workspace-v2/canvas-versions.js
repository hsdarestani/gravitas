import { frameKey, groupKey } from './workflow-frames.js';
import { reachable } from './planning.js';

const routeKey = ({from,to}) => from + '/' + to;
const edgeKey = edge => edge.join('/');

export function captureCanvasVersion(flow, tasks) {
  const nodes = tasks.map(({id,x,y}) => ({id,x,y}));
  const ids = new Set(nodes.map(node => node.id));
  const groups = flow.groups.filter(group => group.members.every(id => ids.has(id)));
  const frames = flow.frames;
  const shapes = new Set([...ids,...groups.map(group=>groupKey(group.id)),...frames.map(frame=>frameKey(frame.id))]);
  return structuredClone({
    nodes, groups, frames, layoutReady:Boolean(flow.layoutReady),
    edges:flow.edges.filter(edge=>edge.every(id=>ids.has(id))),
    loops:flow.loops.filter(loop=>ids.has(loop.from)&&ids.has(loop.to)).map(({count,...loop})=>loop),
    layoutArrows:flow.layoutArrows.filter(arrow=>shapes.has(arrow.from)&&shapes.has(arrow.to))
  });
}

export function restoreCanvasVersion(flow, snapshot, tasks) {
  const visible = new Set(tasks.map(task=>task.id));
  const nodes = snapshot.nodes.filter(node=>visible.has(node.id));
  const saved = new Set(nodes.map(node=>node.id));
  const groups = snapshot.groups.filter(group=>group.members.every(id=>saved.has(id)));
  const retainedGroups = flow.groups.filter(group=>!group.members.every(id=>saved.has(id)));
  const retainedIds = new Set(retainedGroups.map(group=>group.id));
  const frames = snapshot.frames;
  const nextGroups = [...retainedGroups,...groups.filter(group=>!retainedIds.has(group.id))];
  const savedShapes = new Set([...saved,...groups.map(group=>groupKey(group.id)),...frames.map(frame=>frameKey(frame.id))]);
  const nextShapes = new Set([...visible,...nextGroups.map(group=>groupKey(group.id)),...frames.map(frame=>frameKey(frame.id))]);
  const oldSharedShapes = new Set([...saved,...flow.groups.filter(group=>group.members.every(id=>saved.has(id))).map(group=>groupKey(group.id)),...flow.frames.map(frame=>frameKey(frame.id))]);
  const edges = [...new Map([...flow.edges.filter(edge=>!edge.every(id=>saved.has(id))),...snapshot.edges.filter(edge=>edge.every(id=>saved.has(id)))].map(edge=>[edgeKey(edge),edge])).values()];
  for (const [from,to] of edges) if (reachable({edges},to).has(from)) return null;
  const prior = new Map([...flow.removedLoops||[],...flow.loops].map(loop=>[routeKey(loop),loop.count]));
  const loops = [...flow.loops.filter(loop=>!(saved.has(loop.from)&&saved.has(loop.to))),
    ...snapshot.loops.filter(loop=>saved.has(loop.from)&&saved.has(loop.to)).map(loop=>({
      ...loop,count:Math.min(prior.get(routeKey(loop))||0,loop.target)
    }))];
  if (loops.some(loop=>loop.from!==loop.to&&!reachable({edges},loop.to).has(loop.from))) return null;
  const existingTask = id => !visible.has(id)&&!oldSharedShapes.has(id)&&!String(id).includes(':');
  const layoutArrows = [...new Map([
    ...flow.layoutArrows.filter(({from,to})=>!(oldSharedShapes.has(from)&&oldSharedShapes.has(to))&&
      [from,to].every(id=>nextShapes.has(id)||existingTask(id))),
    ...snapshot.layoutArrows.filter(({from,to})=>[from,to].every(id=>savedShapes.has(id)&&nextShapes.has(id)))
  ].map(arrow=>[routeKey(arrow),arrow])).values()];
  return {nodes,shape:structuredClone({groups:nextGroups,frames,edges,loops,layoutArrows,layoutReady:snapshot.layoutReady})};
}
