/* GraviQuest education models. Pure, deterministic calculations; no network or DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GQEducationModels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x)));
  const series = (name, points) => ({name, points});
  function rng(seed = 42) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return (s + .5) / 4294967296; }; }
  function incline(p) {
    const angle = p.angle * Math.PI / 180, weight = p.mass * p.gravity;
    const normal = weight * Math.cos(angle), parallel = weight * Math.sin(angle);
    const staticLimit = p.static * normal, moving = parallel > staticLimit + 1e-10;
    const friction = moving ? p.kinetic * normal : parallel;
    const acceleration = moving ? (parallel - friction) / p.mass : 0;
    const end = acceleration > 0 ? Math.sqrt(24 / acceleration) : 6;
    const duration = Math.min(6, end), velocity = acceleration * duration;
    return {metrics:{acceleration,normal,parallel,friction,staticLimit,critical:Math.atan(p.static)*180/Math.PI,velocity,distance:.5*acceleration*duration*duration,duration},
      moving, weight, series:[series('velocity', Array.from({length:121},(_,i)=>[i*duration/120,acceleration*i*duration/120]))], xUnit:'s',yUnit:'m/s'};
  }
  function chemistry(p) {
    const eq = p.reverse/(p.forward+p.reverse), total = p.total;
    const a = Array.from({length:121},(_,i)=>[i/6,total*(eq+(1-eq)*Math.exp(-(p.forward+p.reverse)*i/6))]);
    return {metrics:{equilibriumA:total*eq,equilibriumB:total*(1-eq),halfTime:Math.LN2/(p.forward+p.reverse),total},series:[series('A',a),series('B',a.map(([t,x])=>[t,total-x]))],xUnit:'s',yUnit:'mol/L'};
  }
  function mathematics(p) {
    let a=p.initial,b=p.initial+.000001;const sa=[[0,a]],sb=[[0,b]];
    for(let i=1;i<=80;i++){a=p.rate*a*(1-a);b=p.rate*b*(1-b);sa.push([i,a]);sb.push([i,b]);}
    return {metrics:{last:a,nearby:b,separation:Math.abs(a-b),rate:p.rate},series:[series('trajectory',sa),series('nearby',sb)],xUnit:'n',yUnit:'x'};
  }
  function finance(p) {
    let balance=p.principal;const nominal=[[0,balance]],real=[[0,balance]],paid=[[0,balance]];
    for(let month=1;month<=p.years*12;month++){balance=balance*(1+p.rate/1200)+p.deposit;if(month%12===0){nominal.push([month/12,balance]);real.push([month/12,balance/(1+p.inflation/100)**(month/12)]);paid.push([month/12,p.principal+p.deposit*month]);}}
    return {metrics:{nominal:balance,real:real.at(-1)[1],contributed:paid.at(-1)[1],growth:balance-paid.at(-1)[1]},series:[series('nominal',nominal),series('real',real),series('contributed',paid)],xUnit:'yr',yUnit:'CU'};
  }
  function biology(p) {
    let s=.99,i=.01,r=0,peak=i;const ss=[[0,s]],ii=[[0,i]],rr=[[0,r]],dt=.1;
    const d=([s,i])=>[-p.beta*s*i,p.beta*s*i-p.gamma*i,p.gamma*i];
    for(let n=1;n<=1600;n++){
      const y=[s,i,r],a=d(y),b=d(y.map((v,k)=>v+a[k]*dt/2)),c=d(y.map((v,k)=>v+b[k]*dt/2)),e=d(y.map((v,k)=>v+c[k]*dt));
      [s,i,r]=y.map((v,k)=>v+dt*(a[k]+2*b[k]+2*c[k]+e[k])/6);peak=Math.max(peak,i);
      if(n%10===0){ss.push([n*dt,s]);ii.push([n*dt,i]);rr.push([n*dt,r]);}
    }
    return {metrics:{R0:p.beta/p.gamma,peak:peak*100,susceptible:s*100,infected:i*100,recovered:r*100,total:s+i+r},series:[series('susceptible',ss),series('infected',ii),series('recovered',rr)],xUnit:'d',yUnit:'fraction'};
  }
  function engineering(p) {
    // Exact free response of m x'' + c x' + k x = 0, x(0)=1 m, v(0)=0.
    const w=Math.sqrt(p.stiffness/p.mass),z=p.damping;
    const displacement=t=>{
      if(Math.abs(z-1)<1e-9)return Math.exp(-w*t)*(1+w*t);
      if(z<1){const wd=w*Math.sqrt(1-z*z);return Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t));}
      const q=Math.sqrt(z*z-1),r1=-w*(z-q),r2=-w*(z+q);return (-r2*Math.exp(r1*t)+r1*Math.exp(r2*t))/(r1-r2);
    };
    const points=Array.from({length:401},(_,i)=>[i/40,displacement(i/40)]);
    return {metrics:{frequency:w/(2*Math.PI),damping:p.damping,coefficient:2*z*Math.sqrt(p.mass*p.stiffness),final:displacement(10)},series:[series('displacement',points)],xUnit:'s',yUnit:'m'};
  }
  function computing(p) {
    // One FCFS server, exponential interarrival/service times, fixed random stream.
    const random=rng(42),exp=rate=>-Math.log(1-random())/rate;
    const events=[];let arrival=0,available=0,wait=0,count=0;
    while((arrival+=exp(p.arrival))<=60&&count<3000){const start=Math.max(arrival,available);wait+=start-arrival;available=start+exp(p.service);events.push([arrival,1],[available,-1]);count++;}
    events.sort((a,b)=>a[0]-b[0]);let queue=0,max=0;const pts=[[0,0]];
    for(const[t,delta]of events){if(t>60)break;pts.push([t,queue]);queue+=delta;max=Math.max(max,queue);pts.push([t,queue]);}pts.push([60,queue]);
    const utilization=p.arrival/p.service;
    return {metrics:{utilization,meanWait:count?wait/count:0,arrivals:count,max,expectedWait:utilization<1?utilization/(p.service-p.arrival):null},series:[series('inSystem',pts)],xUnit:'s',yUnit:'jobs'};
  }
  function sociology(p) {
    const random=rng(73),size=18,grid=Array.from({length:size*size},()=>{const u=random();return u<p.vacancy?0:random()<.5?1:2;});
    const initial=grid.slice(),ratio=(g,index)=>{let same=0,total=0;const x=index%size,y=Math.floor(index/size);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const a=x+dx,b=y+dy;if(a<0||b<0||a>=size||b>=size)continue;const n=g[b*size+a];if(n){total++;if(n===g[index])same++;}}return total?same/total:1;};
    const unhappy=g=>g.reduce((n,v,k)=>n+(v&&ratio(g,k)<p.tolerance?1:0),0);
    const pts=[[0,unhappy(grid)]],population=grid.filter(Boolean).length;
    for(let step=1;step<=35;step++){const order=Array.from({length:grid.length},(_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
      for(const k of order){if(!grid[k]||ratio(grid,k)>=p.tolerance)continue;const empty=grid.flatMap((v,i)=>v?[]:[i]);if(!empty.length)break;const target=empty[Math.floor(random()*empty.length)];grid[target]=grid[k];grid[k]=0;}
      pts.push([step,unhappy(grid)]);
    }
    const similarity=grid.reduce((n,v,k)=>n+(v?ratio(grid,k):0),0)/population;
    return {metrics:{unhappy:unhappy(grid),population,similarity:similarity*100,initialUnhappy:pts[0][1]},grid,initial,size,series:[series('unhappy',pts)],xUnit:'step',yUnit:'agents'};
  }
  function neuroscience(p) {
    const rest=-65,reset=-65,threshold=-50,resistance=100,tau=p.tau,refractory=2,steady=rest+resistance*p.current;
    const interval=steady>threshold?tau*Math.log((steady-reset)/(steady-threshold)):Infinity;
    const period=interval+refractory,points=[];let spikes=0;
    for(let n=0;n<=2000;n++){const t=n*.1;let v;if(t<interval)v=steady+(rest-steady)*Math.exp(-t/tau);else{const phase=(t-interval)%period;v=phase<refractory?reset:steady+(reset-steady)*Math.exp(-(phase-refractory)/tau);}points.push([t,v]);}
    if(Number.isFinite(interval))for(let t=interval;t<=200;t+=period){spikes++;points.push([t,threshold],[t+.00001,20],[t+.00002,reset]);}
    points.sort((a,b)=>a[0]-b[0]);
    return {metrics:{steady,threshold,spikes,frequency:Number.isFinite(interval)?1000/period:0},series:[series('voltage',points),series('threshold',[[0,threshold],[200,threshold]])],xUnit:'ms',yUnit:'mV'};
  }
  return Object.freeze({incline,chemistry,mathematics,finance,biology,engineering,computing,sociology,neuroscience,rng,clamp});
});
