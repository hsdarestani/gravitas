/* Protein stability: reproducible two-state educational model, NOT molecular dynamics. */
(function () {
  "use strict";
  const E = window.GraviLab, $ = id => document.getElementById(id);
  if (!E) { document.body.textContent = "The lab engine could not load."; return; }
  const sliders = ["temperature","minutes","meltC","widthC"];
  let result, yaw = 0.25, pointerX = null, frameTime = 0;
  const canvas = $("molecule"), ctx = canvas.getContext("2d", {alpha:false});
  function state() { const x = {}; sliders.forEach(id => { x[id] = Number($(id).value); }); return x; }
  function drawGraph(data) {
    const left=55,top=20,w=600,h=205,bottom=top+h;
    const x=t=>left+(t-20)/70*w, y=f=>bottom-E.clamp(f,0,1)*h;
    const path=data.points.map(p=>(p===data.points[0]?"M":"L")+x(p.t).toFixed(2)+" "+y(p.folded).toFixed(2)).join(" ");
    let grid="";
    for(let val=0;val<=1.001;val+=0.25) {
      grid+='<line x1="'+left+'" y1="'+y(val)+'" x2="'+(left+w)+'" y2="'+y(val)+'" stroke="#284753" stroke-width="1"/>';
      grid+='<text x="42" y="'+(y(val)+5)+'" fill="#bdd1d9" font-size="13" text-anchor="end">'+Math.round(val*100)+'%</text>';
    }
    for(let temp=20;temp<=90;temp+=10)grid+='<text x="'+x(temp)+'" y="247" fill="#bdd1d9" font-size="13" text-anchor="middle">'+temp+'</text>';
    const obs=data.practice.map(p=>'<circle cx="'+x(p.t)+'" cy="'+y(p.folded)+'" r="5" fill="#dfc689" stroke="#071420" stroke-width="2"/>').join("");
    const cursorX=x(data.temperature);
    $("plot").innerHTML='<title id="chart-name">Simulated folded fraction from 20 to 90 degrees Celsius</title>'+
      '<rect x="'+x(50)+'" y="'+top+'" width="'+(x(90)-x(50))+'" height="'+h+'" fill="#dfbd7f" opacity=".07"/>'+
      grid+'<path d="'+path+'" fill="none" stroke="#77ded8" stroke-width="3" stroke-linejoin="round"/>'+obs+
      '<line x1="'+x(50)+'" y1="'+top+'" x2="'+x(50)+'" y2="'+bottom+'" stroke="#d5bb82" stroke-dasharray="5 5"/>'+
      '<line x1="'+cursorX+'" y1="'+top+'" x2="'+cursorX+'" y2="'+bottom+'" stroke="#ffffff" stroke-dasharray="2 7" opacity=".6"/>'+
      '<circle cx="'+cursorX+'" cy="'+y(data.folded)+'" r="7" fill="#e3fcf8" stroke="#26717b" stroke-width="3"/>'+
      '<text x="654" y="267" fill="#bdd1d9" font-size="12" text-anchor="end">Temperature (°C)</text>';
  }
  function render() {
    result=E.protein(state());
    $("temperatureValue").textContent=result.temperature+" °C";
    $("minutesValue").textContent=result.minutes+" min";
    $("meltCValue").textContent=result.meltC+" °C";
    $("widthCValue").textContent=result.widthC+" °C";
    $("fraction").textContent=Math.round(result.folded*100)+"%";
    $("unfolded").textContent=Math.round((1-result.folded)*100)+"%";
    $("boundary").textContent=result.temperature>50?"Model only":"Within practice range";
    $("boundary").style.color=result.temperature>50?"#e1c58a":"#8fdfd8";
    $("interpretation").textContent=result.temperature>50
      ? "No practice observations exist above 50 °C. This value is a model prediction, not an experimental finding. The next scientific step is to measure this range."
      : "The gold markers are synthetic training data at 20, 30, 40 and 50 °C, generated for the fixed 10-minute baseline. The cyan curve represents your current model settings.";
    drawGraph(result);
  }
  function paint(ts) {
    requestAnimationFrame(paint);
    if (!ctx || document.hidden || (ts-frameTime<45)) return;
    frameTime=ts;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const cw=canvas.clientWidth||600,ch=canvas.clientHeight||305;
    if(canvas.width!==Math.round(cw*dpr)||canvas.height!==Math.round(ch*dpr)){canvas.width=Math.round(cw*dpr);canvas.height=Math.round(ch*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle="#0a202b";ctx.fillRect(0,0,cw,ch);
    const light=ctx.createRadialGradient(cw*.51,ch*.46,0,cw*.51,ch*.46,Math.max(cw,ch)*.65);
    light.addColorStop(0,"#20515a");light.addColorStop(1,"#0a202b");ctx.fillStyle=light;ctx.fillRect(0,0,cw,ch);
    const f=result?result.folded:1, reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spin=yaw+(reduced?0:ts*.00014);
    const points=[];
    for(let i=0;i<65;i++) {
      const s=i/64,theta=i*.62;
      const a={x:48*Math.cos(theta),y:48*Math.sin(theta),z:(s-.5)*175};
      const b={x:(s-.5)*330,y:58*Math.sin(s*Math.PI*3),z:39*Math.cos(s*Math.PI*9)};
      const xx=f*a.x+(1-f)*b.x, yy=f*a.y+(1-f)*b.y, zz=f*a.z+(1-f)*b.z;
      const X=xx*Math.cos(spin)+zz*Math.sin(spin), Z=-xx*Math.sin(spin)+zz*Math.cos(spin);
      const depth=520/(520+Z);
      const scale=Math.min(cw/520,ch/270);
      points.push({x:cw/2+X*depth*scale,y:ch/2+yy*depth*scale,z:Z,size:Math.max(2,4*depth*scale)});
    }
    ctx.lineWidth=Math.max(2,3*Math.min(cw/500,1.2));
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];ctx.strokeStyle="rgba(111,221,218,"+(0.47+0.30*(1-(a.z+150)/300))+")";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    points.sort((a,b)=>b.z-a.z).forEach(p=>{ctx.fillStyle=p.z<0?"#98eee5":"#4c9da7";ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,2*Math.PI);ctx.fill();});
  }
  sliders.forEach(id=>$(id).addEventListener("input",render));
  canvas.addEventListener("pointerdown",e=>{pointerX=e.clientX;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener("pointermove",e=>{if(pointerX!==null){yaw+=(e.clientX-pointerX)*.009;pointerX=e.clientX;}});
  canvas.addEventListener("pointerup",()=>{pointerX=null;});
  canvas.addEventListener("pointercancel",()=>{pointerX=null;});
  $("reset").addEventListener("click",()=>{
    Object.entries({temperature:65,minutes:10,meltC:58,widthC:5}).forEach(([id,v])=>{$(id).value=v;});
    render();$("saved").textContent="Defaults restored.";
  });
  $("save").addEventListener("click",()=>{
    const record={kind:"protein-two-state-educational",version:E.version,createdAt:new Date().toISOString(),parameters:state(),result:{folded:result.folded},disclaimer:result.model};
    try{
      const key="gq-topic01-protein-runs",previous=JSON.parse(localStorage.getItem(key)||"[]");
      const history=Array.isArray(previous)?previous.slice(-11):[];history.push(record);
      localStorage.setItem(key,JSON.stringify(history));
      $("saved").textContent="Saved locally in this browser ("+history.length+" runs). Nothing sent to the server.";
    }catch(_){$("saved").textContent="Local storage unavailable. You can still export the current run.";}
  });
  $("export").addEventListener("click",()=>{
    const record={model:"Two-state educational simulation; not experimental data",version:E.version,parameters:state(),result:result};
    const blob=new Blob([JSON.stringify(record,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="graviquest-protein-run.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  render();requestAnimationFrame(paint);
})();
