// The attached Gravity Grid's sampled lines and eased gravitational wells,
// with the homepage's sparse starfield for the workflow canvas.
export function mountGravityGrid(canvas,{sky=false}={}) {
  const ctx=canvas.getContext('2d');
  if (!ctx) return ()=>{};
  const header=canvas.parentElement;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const pointer={x:0,y:0,inside:false};
  const wells=[
    {x:0,y:0,k:.32,s:90000,on:1},
    {x:0,y:0,k:.22,s:30000,on:1},
    {x:0,y:0,k:.42,s:12000,on:0}
  ];
  let width=0,height=0,ticket,last=0;
  const point=[0,0];
  let stars=[];
  function makeStars() {
    let seed=9749;
    const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    stars=Array.from({length:Math.min(165,Math.ceil(width*height/4700))},()=>{
      const x=next(),y=next(),bright=next()>.94;
      return {x,y,r:bright?1.35:.35+next()*.49,alpha:bright?.8:.25+next()*.41};
    });
  }

  function warpPoint(x,y) {
    for (const well of wells) {
      if (well.on<.01) continue;
      const dx=x-well.x, dy=y-well.y;
      const f=well.k*well.on/(1+(dx*dx+dy*dy)/well.s);
      x-=dx*f;
      y-=dy*f;
    }
    point[0]=x;
    point[1]=y;
  }

  function draw(now) {
    const t=now/1000;
    wells[0].x=width*(sky?.64:.73)+Math.cos(t*.5)*width*.13;
    wells[0].y=height*(.52+Math.sin(t*.5)*.22);
    wells[1].x=width*(sky?.22:.83)+Math.sin(t*.8)*width*.13;
    wells[1].y=height*(.5+Math.cos(t*1.1)*.18);
    const cursor=wells[2];
    cursor.on+=((pointer.inside&&!motion.matches?1:0)-cursor.on)*.12;
    cursor.x+=(pointer.x-cursor.x)*.2;
    cursor.y+=(pointer.y-cursor.y)*.2;

    ctx.clearRect(0,0,width,height);
    ctx.strokeStyle=sky?'rgba(165,214,246,.16)':'rgba(169,212,241,.32)';
    ctx.lineWidth=1;
    const spacing=width<640?36:44;
    const pad=spacing*3;
    const step=8;
    ctx.beginPath();
    for (let x=-pad;x<=width+pad;x+=spacing) {
      for (let y=-pad;y<=height+pad;y+=step) {
        warpPoint(x,y);
        if (y===-pad) ctx.moveTo(...point); else ctx.lineTo(...point);
      }
    }
    for (let y=-pad;y<=height+pad;y+=spacing) {
      for (let x=-pad;x<=width+pad;x+=step) {
        warpPoint(x,y);
        if (x===-pad) ctx.moveTo(...point); else ctx.lineTo(...point);
      }
    }
    ctx.stroke();
    if (sky) {
      for (const {x,y,r,alpha} of stars) {
        ctx.fillStyle=`rgba(218,236,246,${alpha})`;
        ctx.beginPath();
        ctx.arc(width*x,height*y,r,0,Math.PI*2);
        ctx.fill();
      }
      return;
    }
    for (const [index,well] of wells.slice(0,2).entries()) {
      const radius=index?17:23;
      const glow=ctx.createRadialGradient(well.x,well.y,0,well.x,well.y,radius);
      glow.addColorStop(0,index?'rgba(111,169,206,.72)':'rgba(241,239,236,.8)');
      glow.addColorStop(1,'rgba(111,169,206,0)');
      ctx.fillStyle=glow;
      ctx.fillRect(well.x-radius,well.y-radius,radius*2,radius*2);
    }
  }

  function frame(now) {
    if (now-last>=(sky?45:32)) {draw(now);last=now;}
    ticket=requestAnimationFrame(frame);
  }
  function resize() {
    width=canvas.clientWidth;
    height=canvas.clientHeight;
    if (sky) makeStars();
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.ceil(width*dpr);
    canvas.height=Math.ceil(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw(motion.matches?0:performance.now());
  }
  function updateMotion() {
    cancelAnimationFrame(ticket);
    if (motion.matches) {wells[2].on=0;draw(0);}
    else ticket=requestAnimationFrame(frame);
  }
  function move(event) {
    if (event.pointerType==='touch') return;
    const rect=canvas.getBoundingClientRect();
    pointer.x=event.clientX-rect.left;
    pointer.y=event.clientY-rect.top;
    if (!pointer.inside && wells[2].on<.01) Object.assign(wells[2],{x:pointer.x,y:pointer.y});
    pointer.inside=true;
  }
  const leave=()=>{pointer.inside=false;};
  const observer=new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  updateMotion();
  motion.addEventListener('change',updateMotion);
  header.addEventListener('pointermove',move);
  header.addEventListener('pointerleave',leave);
  return ()=>{
    observer.disconnect();
    cancelAnimationFrame(ticket);
    motion.removeEventListener('change',updateMotion);
    header.removeEventListener('pointermove',move);
    header.removeEventListener('pointerleave',leave);
  };
}
