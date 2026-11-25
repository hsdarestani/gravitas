const nodeOrder = (a,b) => a.title.localeCompare(b.title)||a.key.localeCompare(b.key);
const gap = 34;

function projectCluster(project,tasks) {
  const rings=Math.max(1,Math.ceil(tasks.length/8));
  const width=tasks.length?390+270*(rings-1):235;
  const height=tasks.length?276+180*(rings-1):114;
  const cx=width/2,cy=height/2;
  const nodes=[{...project,x:cx,y:cy}];
  const sorted=tasks.slice().sort(nodeOrder);
  for (let index=0;index<sorted.length;index++) {
    const ring=Math.floor(index/8),size=Math.min(8,sorted.length-ring*8);
    const angle=-Math.PI/2+Math.PI*2*(index%8)/size+ring*Math.PI/8;
    nodes.push({...sorted[index],x:cx+(142+ring*135)*Math.cos(angle),y:cy+(103+ring*90)*Math.sin(angle)});
  }
  return {width,height,nodes};
}

export function relationshipLayout(nodes) {
  const areas=nodes.filter(node=>node.kind==='area');
  const loose=nodes.filter(node=>node.kind==='okr');
  const projectsByArea=Map.groupBy(nodes.filter(node=>node.kind==='project'),node=>node.parent);
  const tasksByProject=Map.groupBy(nodes.filter(node=>node.kind==='task'),node=>node.parent);
  const orderedAreas=areas.slice().sort((a,b)=>Number(projectsByArea.has(b.key))-Number(projectsByArea.has(a.key)));
  const clusters=orderedAreas.map(area=>{
    const children=(projectsByArea.get(area.key)||[]).slice().sort(nodeOrder);
    let column=0, x=18, y=112, rowHeight=0,width=275;
    const positions=[{...area,x:105,y:46}];
    for (const project of children) {
      const cluster=projectCluster(project,tasksByProject.get(project.key)||[]);
      if (column===2) {x=18;y+=rowHeight+gap;column=0;rowHeight=0;}
      positions.push(...cluster.nodes.map(node=>({...node,x:node.x+x,y:node.y+y})));
      rowHeight=Math.max(rowHeight,cluster.height);
      width=Math.max(width,x+cluster.width+18);
      x+=cluster.width+gap;
      column++;
    }
    return {width,height:y+rowHeight+20,nodes:positions};
  });
  const columns=[[],[]], height=[180,205], width=[422,422];
  for (const item of clusters) {
    const column=height[0]<=height[1]?0:1;
    columns[column].push({...item,top:height[column]});
    height[column]+=item.height+gap;
    width[column]=Math.max(width[column],item.width);
  }
  const slices=columns.flatMap((column,index)=>column.map(item=>({...item,left:30+(index?width[0]+gap:0)})));
  const positioned=slices.flatMap(({nodes,left,top})=>nodes.map(node=>({...node,x:node.x+left,y:node.y+top})));
  const totalWidth=Math.max(960,width[0]+width[1]+gap+60);
  const anchors=[[115,60],[313,42],[506,69],[704,48],[598,134]];
  loose.forEach((node,index)=>{
    const [x,y]=anchors[index]||[150+190*index,120];
    positioned.push({...node,x,y});
  });
  return {nodes:positioned,width:totalWidth,height:Math.max(560,...height)+16,
    clusters:slices.map(({left,top,width,height})=>({left,top,width,height}))};
}

export function focusedLayout(nodes,focus) {
  const central=nodes.find(node=>node.key===focus);
  if (!central) return relationshipLayout(nodes);
  const others=nodes.filter(node=>node!==central).sort(nodeOrder);
  const rings=Math.max(1,Math.ceil(others.length/8));
  const width=Math.max(900,500+rings*250),height=340+rings*185;
  const cx=width/2,cy=height/2;
  const placed=others.map((node,index)=>{
    const ring=Math.floor(index/8),count=Math.min(8,others.length-ring*8);
    const angle=2*Math.PI*(index%8)/count-Math.PI/2+ring*.18;
    return {...node,x:cx+(176+ring*125)*Math.cos(angle),y:cy+(115+ring*92)*Math.sin(angle)};
  });
  return {nodes:[{...central,x:cx,y:cy},...placed],clusters:[],width,height};
}
