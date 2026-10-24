/* Scientific visualization pilot: explicit data provenance and bounded polynomial fitting.
   Input observations are SYNTHETIC teaching fixtures, never laboratory evidence. */
(function () {
  "use strict";
  const $=id=>document.getElementById(id);
  const measured=Object.freeze([
    {temperature:20,folded:0.98,uncertainty:0.02},
    {temperature:30,folded:0.95,uncertainty:0.03},
    {temperature:40,folded:0.89,uncertainty:0.03},
    {temperature:50,folded:0.79,uncertainty:0.04}
  ]);
  // Least-squares polynomial fit with centered and scaled temperature,
  // using Gaussian elimination + partial pivoting on a small normal equation.
  function solve(matrix, rhs) {
    const n=rhs.length,A=matrix.map((row,i)=>row.slice().concat(rhs[i]));
    for(let col=0;col<n;col++){
      let pivot=col;
      for(let k=col+1;k<n;k++)if(Math.abs(A[k][col])>Math.abs(A[pivot][col]))pivot=k;
      if(Math.abs(A[pivot][col])<1e-12)throw Error("Ill-conditioned synthetic dataset");
      [A[col],A[pivot]]=[A[pivot],A[col]];
      const f=A[col][col];
      for(let c=col;c<=n;c++)A[col][c]/=f;
      for(let r=0;r<n;r++)if(r!==col){
        const k=A[r][col];
        for(let c=col;c<=n;c++)A[r][c]-=k*A[col][c];
      }
    }
    return A.map(row=>row[n]);
  }
  function fit(degree,records) {
    if (![1,2].includes(degree))throw Error("Unsupported polynomial order");
    const dat=records||measured,n=degree+1;
    const xs=dat.map(p=>(p.temperature-35)/10);
    const ys=dat.map(p=>p.folded);
    const A=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
      xs.reduce((sum,x)=>sum+x**(i+j),0)));
    const b=Array.from({length:n},(_,i)=>xs.reduce((sum,x,k)=>sum+ys[k]*x**i,0));
    return solve(A,b);
  }
  function estimate(coeff,t) {
    const x=(t-35)/10;return coeff.reduce((sum,c,i)=>sum+c*x**i,0);
  }
  const pct=v=>Math.round(v*100);
  const fx=(t,min=20,max=70)=>60+(t-min)/(max-min)*594;
  const fy=y=>225-(y+.25)/1.55*200; // fixed scale -25% to 130%; no chart rescaling trick
  const root=$("visualization"),degree=$("degree"),show=$("extrapolation");
  if(!root||!degree||!show){return;}
  $("dataTable").innerHTML=measured.map(p=>'<tr><td>'+p.temperature+' °C</td><td>'+pct(p.folded)+'%</td><td>±'+pct(p.uncertainty)+' pts</td><td>synthetic fixture</td></tr>').join("");
  let current=null;
  function draw() {
    const deg=Number(degree.value), coeff=fit(deg);
    current={degree:deg,coefficients:coeff,observations:measured,model_predictions:[60,70].map(t=>({temperature:t,folded:estimate(coeff,t)}))};
    let svg='<title id="viz-title">Observed values and model fits, with unmeasured region marked</title>';
    svg+='<rect x="'+fx(50)+'" y="12" width="'+(fx(70)-fx(50))+'" height="215" fill="#d9bf83" opacity=".07"/>';
    for(let rate=-.25;rate<=1.30;rate+=.25){
      svg+='<line x1="60" y1="'+fy(rate)+'" x2="654" y2="'+fy(rate)+'" stroke="#254657"/>'+
        '<text x="48" y="'+(fy(rate)+4)+'" fill="#b8d1d7" text-anchor="end" font-size="13">'+pct(rate)+'%</text>';
    }
    for(let t=20;t<=70;t+=10)svg+='<text x="'+fx(t)+'" y="249" fill="#b8d1d7" text-anchor="middle" font-size="13">'+t+'</text>';
    svg+='<line x1="'+fx(50)+'" y1="12" x2="'+fx(50)+'" y2="228" stroke="#d9bf83" stroke-width="1.4" stroke-dasharray="4 5"/>';
    for(const p of measured){
      const x=fx(p.temperature),y=fy(p.folded);
      svg+='<line x1="'+x+'" y1="'+fy(p.folded-p.uncertainty)+'" x2="'+x+'" y2="'+fy(p.folded+p.uncertainty)+'" stroke="#d9bf83" stroke-width="2"/>';
      svg+='<circle cx="'+x+'" cy="'+y+'" r="5.4" fill="#efd49b"/>';
    }
    const drawSegment=(from,to,stroke,dash)=>{
      let d="";
      for(let t=from;t<=to;t+=.5){const y=estimate(coeff,t);
        // Keep actual numerical predictions in readouts; chart is clipped
        // instead of misrepresenting negative or >100% extrapolated values.
        d+=(t===from?"M":"L")+fx(t).toFixed(1)+" "+fy(y).toFixed(1)+" ";
      }
      return '<path d="'+d+'" stroke="'+stroke+'" stroke-width="3" fill="none" '+
        (dash?'stroke-dasharray="7 7" ':'')+'clip-path="url(#viz-clip)"/>';
    };
    svg+='<defs><clipPath id="viz-clip"><rect x="60" y="12" width="594" height="215"/></clipPath></defs>';
    svg+=drawSegment(20,50,"#75ded6",false);
    if(show.checked)svg+=drawSegment(50,70,"#e3c891",true);
    svg+='<text x="653" y="273" fill="#b8d1d7" text-anchor="end" font-size="12">Temperature (°C)</text>';
    root.innerHTML=svg;
    $("modelLabel").textContent=deg===1?"Linear fit":"Quadratic fit";
    $("pred60").textContent=show.checked?pct(estimate(coeff,60))+"%":"Hidden";
    $("pred70").textContent=show.checked?pct(estimate(coeff,70))+"%":"Hidden";
    $("vizConclusion").textContent=show.checked
      ?"These 60 °C and 70 °C results are extrapolations beyond the 20–50 °C synthetic observation range. Change the fit: different reasonable models can give different predictions. Neither is a measurement."
      :"Only synthetic observations and the fitted curve inside the sampled region are displayed. Enable extrapolation to see why scientific interpretation becomes less certain outside measured temperatures.";
    $("vizMath").textContent="Fit coefficients (x = (temperature - 35)/10): "+
      coeff.map((c,i)=>c.toFixed(6)+(i===0?"":" · x^"+i)).join(" + ")+
      ". Predictions are computed directly from these coefficients, with no hidden AI call.";
  }
  degree.addEventListener("change",draw);
  show.addEventListener("change",draw);
  $("exportData").addEventListener("click",()=>{
    const payload={notice:"Synthetic teaching data; not experimental evidence",model:current,range:{measuredMin:20,measuredMax:50},engine:"Polynomial least squares"};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="graviquest-visualization-lab.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("exportSVG").addEventListener("click",()=>{
    const clone=root.cloneNode(true);
    clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
    clone.setAttribute("width","682");
    clone.setAttribute("height","280");
    // Explicit inline SVG background to make downloaded charts self-contained.
    const bg=document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("x","0");bg.setAttribute("y","0");bg.setAttribute("width","682");bg.setAttribute("height","280");bg.setAttribute("fill","#0a202b");
    clone.insertBefore(bg,clone.firstChild);
    const xml=new XMLSerializer().serializeToString(clone);
    const url=URL.createObjectURL(new Blob([xml],{type:"image/svg+xml"})),a=document.createElement("a");
    a.href=url;a.download="graviquest-scientific-chart.svg";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  draw();
})();
