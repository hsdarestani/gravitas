const minWidth = 110;
const minHeight = 76;
const canvasLimit = 3900;

export function frameBox(origin,end) {
  const x=Math.max(16,Math.min(canvasLimit-minWidth,Math.round(Math.min(origin.x,end.x))));
  const y=Math.max(16,Math.min(canvasLimit-minHeight,Math.round(Math.min(origin.y,end.y))));
  return {
    x,y,
    width:Math.max(minWidth,Math.min(canvasLimit-x,Math.round(Math.abs(origin.x-end.x)))),
    height:Math.max(minHeight,Math.min(canvasLimit-y,Math.round(Math.abs(origin.y-end.y))))
  };
}
export function containsFrame(outer,inner) {
  return inner.x>=outer.x+5 && inner.y>=outer.y+5 &&
    inner.x+inner.width<=outer.x+outer.width-5 && inner.y+inner.height<=outer.y+outer.height-5;
}
export function containsPoint(frame,point) {
  return point.x>frame.x && point.y>frame.y && point.x<frame.x+frame.width && point.y<frame.y+frame.height;
}
export function frameHierarchy(frames) {
  const area=frame=>frame.width*frame.height;
  return frames.slice().sort((a,b)=>area(b)-area(a)).map(frame=>{
    const parent=frames.filter(other=>containsFrame(other,frame)).sort((a,b)=>area(a)-area(b))[0];
    return {frame,parent:parent?.id || ''};
  });
}
export function resizeBox(frame,point) {
  return {
    width:Math.max(minWidth,Math.min(canvasLimit-frame.x,Math.round(point.x-frame.x))),
    height:Math.max(minHeight,Math.min(canvasLimit-frame.y,Math.round(point.y-frame.y)))
  };
}
export const frameKey = id => 'frame:'+id;
export const groupKey = id => 'group:'+id;
export const shapeKind = key => key.startsWith('frame:') ? 'frame' : key.startsWith('group:') ? 'group' : 'task';
export const shapeId = key => shapeKind(key)==='task' ? key : key.slice(6);

export function shapeArrow(from,to) {
  const deltaY=to.y-from.y;
  const deltaX=to.x-from.x || (deltaY===0?1:0);
  const edge=(shape,dx,dy)=>{
    const ratio=shape.radius
      ? shape.radius/(Math.hypot(dx,dy)||1)
      : Math.min(shape.width/2/(Math.abs(dx)||.01),shape.height/2/(Math.abs(dy)||.01));
    return {x:shape.x+dx*ratio,y:shape.y+dy*ratio};
  };
  const a=edge(from,deltaX,deltaY);
  const b=edge(to,-deltaX,-deltaY);
  if (Math.hypot(b.x-a.x,b.y-a.y)<1) return `M${a.x} ${a.y-5} Q${a.x+12} ${a.y-8} ${b.x} ${b.y}`;
  const bend=Math.min(76,Math.max(16,Math.abs(a.x-b.x)*.4));
  const dir=Math.sign(b.x-a.x)||1;
  return `M${a.x} ${a.y} C${a.x+dir*bend} ${a.y} ${b.x-dir*bend} ${b.y} ${b.x} ${b.y}`;
}
