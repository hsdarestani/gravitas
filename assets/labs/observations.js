/* Real NOAA observations. Ordinary least squares is a descriptive computation,
   not a validated forecast or a causal estimate. Source uncertainty is never fitted. */
(function(root){
'use strict';
function fit(rows,degree){
 if(![1,2].includes(degree)||rows.length<degree+2)throw Error('Insufficient observations');
 const center=rows.reduce((s,r)=>s+r.x,0)/rows.length,scale=Math.max(...rows.map(r=>Math.abs(r.x-center)))||1;
 const xs=rows.map(r=>(r.x-center)/scale),n=degree+1;
 const a=Array.from({length:n},(_,i)=>Array.from({length:n+1},(_,j)=>j<n?xs.reduce((s,x)=>s+x**(i+j),0):xs.reduce((s,x,k)=>s+x**i*rows[k].y,0)));
 for(let i=0;i<n;i++){let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;[a[i],a[pivot]]=[a[pivot],a[i]];if(Math.abs(a[i][i])<1e-10)throw Error('Singular design');const v=a[i][i];for(let j=i;j<=n;j++)a[i][j]/=v;for(let k=0;k<n;k++){if(k===i)continue;const f=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=f*a[i][j];}}
 const coefficients=a.map(r=>r[n]),predict=x=>coefficients.reduce((s,c,i)=>s+c*((x-center)/scale)**i,0);
 const residuals=rows.map(r=>({x:r.x,y:r.y,predicted:predict(r.x),residual:r.y-predict(r.x)}));
 return {coefficients,center,scale,degree,residuals,rmse:Math.sqrt(residuals.reduce((s,r)=>s+r.residual**2,0)/rows.length),predict};
}
if(typeof module!=='undefined')module.exports={fit};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id);if(!$('observed-chart'))return;
let data,current;
function download(text,name,type){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function draw(){
 current=fit(data.records,Number($('observed-degree').value));
 const points=data.records,x0=points[0].x,x1=points.at(-1).x+Number($('forecast').value),lo=Math.min(...points.map(r=>r.y))-3,hi=Math.max(...points.map(r=>r.y))+5;
 const x=v=>55+(v-x0)/(x1-x0)*600,y=v=>250-(v-lo)/(hi-lo)*215;
 let svg='<title>NOAA monthly CO2 observations and descriptive fit</title><rect width="700" height="300" fill="#101619"/>';
 if(Number($('forecast').value))svg+=`<rect x="${x(points.at(-1).x)}" y="20" width="${655-x(points.at(-1).x)}" height="230" fill="#715528" opacity=".4"/>`;
 for(let v=Math.ceil(lo/5)*5;v<=hi;v+=5)svg+=`<text x="45" y="${y(v)+4}" fill="#aabbbd" text-anchor="end">${v}</text><path d="M55 ${y(v)}H655" stroke="#33464c"/>`;
 for(let v=Math.ceil(x0);v<x1;v++)svg+=`<text x="${x(v)}" y="275" fill="#aabbbd" text-anchor="middle">${v}</text>`;
 points.forEach(r=>svg+=`<path d="M${x(r.x)} ${y(r.y-r.unc)}V${y(r.y+r.unc)}" stroke="#e3c891"/><circle cx="${x(r.x)}" cy="${y(r.y)}" r="3" fill="#e3c891"/>`);
 let path='';for(let i=0;i<=120;i++){const v=x0+(x1-x0)*i/120;path+=`${i?'L':'M'}${x(v)} ${y(current.predict(v))} `;}
 svg+=`<path d="${path}" fill="none" stroke="#a8e6ce" stroke-width="2"/><text x="55" y="16" fill="#aabbbd">CO₂ (ppm)</text>`;
 $('observed-chart').innerHTML=svg;
 const max=Math.max(...current.residuals.map(r=>Math.abs(r.residual)),1),ry=v=>90-v/max*65;
 $('residual-chart').innerHTML='<title>Regression residuals, observed minus fitted, ppm</title><path d="M55 90H655" stroke="#aabbbd"/>'+current.residuals.map(r=>`<circle cx="${x(r.x)}" cy="${ry(r.residual)}" r="3" fill="#a8e6ce"/>`).join('')+`<text x="8" y="22" fill="#aabbbd">+${max.toFixed(1)}</text><text x="8" y="164" fill="#aabbbd">−${max.toFixed(1)}</text>`;
 $('fit-description').textContent=`RMSE ${current.rmse.toFixed(3)} ppm. ${points.length} monthly observations. Residual cycles show why a polynomial trend omits seasonality. Shaded dates have no observations in this snapshot. This model is not validated for forecasting or causal inference.`;
 $('observed-method').textContent=JSON.stringify({...current,predict:undefined},null,2);
}
fetch('assets/labs/data/noaa-co2.json').then(r=>{if(!r.ok)throw Error('Dataset unavailable');return r.json();}).then(d=>{data=d;$('source-detail').textContent=JSON.stringify({...d,records:undefined},null,2);const body=$('observed-rows');d.records.forEach(r=>{const tr=document.createElement('tr');[`${r.year}-${String(r.month).padStart(2,'0')}`,r.x,r.y,r.unc].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});body.append(tr);});draw();}).catch(e=>$('fit-description').textContent=e.message);
$('observed-degree').onchange=draw;$('forecast').onchange=draw;
$('observed-export').onclick=()=>{if(data&&current)download(JSON.stringify({data,analysis:{...current,predict:undefined},method:'OLS with centered/scaled x; unweighted; no causal inference or forecast validation'},null,2),'graviquest-noaa-computation.json','application/json');};
$('observed-svg').onclick=()=>download(new XMLSerializer().serializeToString($('observed-chart')),'graviquest-noaa-figure.svg','image/svg+xml');
})(typeof window==='undefined'?globalThis:window);
