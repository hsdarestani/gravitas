const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const m=require('../../assets/education-models.js');
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function catalog(lang){const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/education-catalog.js'),'utf8'),{window,document:{documentElement:{lang}}});return JSON.parse(JSON.stringify(window.GQEducationCatalog));}
const catalogs={en:catalog('en'),de:catalog('de')};
const defaults=c=>Object.fromEntries(c.controls.map(x=>[x.key,x.value]));

test('static friction balances demand, rather than always equaling its maximum',()=>{
  const p={angle:10,mass:2,gravity:9.81,static:.5,kinetic:.3},r=m.incline(p);
  assert.equal(r.moving,false);near(r.metrics.acceleration,0);near(r.metrics.friction,r.metrics.parallel);assert.ok(r.metrics.friction<r.metrics.staticLimit);
});
test('incline boundary, force decomposition, mass cancellation, gravity scaling and track stop',()=>{
  const p={angle:35,mass:2,gravity:9.81,static:.45,kinetic:.3},r=m.incline(p);
  near(r.metrics.acceleration,9.81*(Math.sin(35*Math.PI/180)-.3*Math.cos(35*Math.PI/180)));
  near(r.metrics.parallel**2+r.metrics.normal**2,r.weight**2,1e-8);
  near((r.metrics.parallel-r.metrics.friction)/p.mass,r.metrics.acceleration);
  near(m.incline({...p,mass:8}).metrics.acceleration,r.metrics.acceleration);
  near(m.incline({...p,gravity:1.62}).metrics.acceleration/r.metrics.acceleration,1.62/9.81);
  near(r.metrics.distance,12);near(r.metrics.velocity**2,2*r.metrics.acceleration*12);
  assert.equal(m.incline({...p,gravity:0}).moving,false);
  assert.equal(m.incline({...p,angle:Math.atan(.45)*180/Math.PI}).moving,false);
  assert.equal(m.incline({...p,angle:0,static:0,kinetic:0}).moving,false);
  assert.ok(m.incline({...p,kinetic:.1}).metrics.acceleration>r.metrics.acceleration);
});
test('chemical concentration is conserved, equilibrium obeys flux balance, catalyst speeds relaxation',()=>{
  const p={forward:.3,reverse:.15,total:1},r=m.chemistry(p),faster=m.chemistry({...p,forward:.6,reverse:.3});
  r.series[0].points.forEach(([t,a],i)=>near(a+r.series[1].points[i][1],1));
  near(p.forward*r.metrics.equilibriumA,p.reverse*r.metrics.equilibriumB);
  near(r.metrics.equilibriumB,faster.metrics.equilibriumB);near(faster.metrics.halfTime,r.metrics.halfTime/2);
  assert.equal(r.series[0].points[0][1],1);
});
test('logistic map remains in bounds, is deterministic and converges at r=2.8',()=>{
  const r=m.mathematics({rate:2.8,initial:.4});r.series.forEach(s=>s.points.forEach(([,x])=>assert.ok(x>=0&&x<=1)));
  near(r.metrics.last,1-1/2.8,1e-7);assert.ok(r.metrics.separation<1e-7);
  assert.deepEqual(m.mathematics({rate:3.9,initial:.4}),m.mathematics({rate:3.9,initial:.4}));
  assert.ok(m.mathematics({rate:3.9,initial:.4}).metrics.separation>.01);
});
test('compound interest handles zero rates, deposit timing and inflation independently',()=>{
  const p={principal:1000,deposit:100,rate:0,inflation:0,years:10};near(m.finance(p).metrics.nominal,13000);
  const a=m.finance({...p,rate:6}),b=m.finance({...p,rate:6,inflation:5});near(a.metrics.nominal,b.metrics.nominal);assert.ok(b.metrics.real<a.metrics.real);
  near(m.finance({...p,deposit:0,rate:6}).metrics.nominal,1000*(1+.06/12)**120,1e-7);
});
test('SIR conserves population, stays nonnegative and obeys peak threshold',()=>{
  for(const beta of [.05,.35,.8])for(const gamma of [.05,.12,.5]){
    const r=m.biology({beta,gamma});near(r.metrics.total,1,1e-11);
    r.series[0].points.forEach(([,s],i)=>{const infected=r.series[1].points[i][1],recovered=r.series[2].points[i][1];near(s+infected+recovered,1,1e-10);assert.ok(s>=0&&infected>=0&&recovered>=0);});
  }
  assert.ok(m.biology({beta:.16,gamma:.12}).metrics.peak<m.biology({beta:.35,gamma:.12}).metrics.peak);
  near(m.biology({beta:.05,gamma:.5}).metrics.peak,1);
});
test('spring solutions satisfy initial conditions and under/critical/overdamping limits',()=>{
  for(const damping of [0,.1,1,1.00001,1.5,2]){const r=m.engineering({mass:2,stiffness:18,damping});near(r.series[0].points[0][1],1);r.series[0].points.forEach(([,x])=>assert.ok(Number.isFinite(x)&&Math.abs(x)<=1.00001));}
  const r=m.engineering({mass:2,stiffness:18,damping:1});near(r.series[0].points[40][1],4*Math.exp(-3));assert.ok(r.series[0].points.every(([,x])=>x>0));
  near(m.engineering({mass:2,stiffness:18,damping:0}).series[0].points[40][1],Math.cos(3));
});
test('queue theory handles saturation, with deterministic nonnegative sample paths',()=>{
  const p={arrival:5,service:8},a=m.computing(p);near(a.metrics.expectedWait,(5/8)/3);
  assert.deepEqual(a,m.computing(p));assert.ok(a.series[0].points.every(([,n])=>Number.isInteger(n)&&n>=0));
  assert.equal(m.computing({arrival:8,service:8}).metrics.expectedWait,null);
  assert.equal(m.computing({arrival:12,service:8}).metrics.expectedWait,null);
  assert.ok(m.computing({arrival:7,service:8}).metrics.expectedWait>a.metrics.expectedWait);
});
test('Schelling relocation conserves each type and vacancies, and changes only rules between runs',()=>{
  for(const tolerance of [0,.3,.65,.9]){const r=m.sociology({tolerance,vacancy:.2});for(const type of [0,1,2])assert.equal(r.grid.filter(x=>x===type).length,r.initial.filter(x=>x===type).length);assert.ok(r.metrics.similarity>=0&&r.metrics.similarity<=100);assert.deepEqual(r,m.sociology({tolerance,vacancy:.2}));}
  assert.equal(m.sociology({tolerance:0,vacancy:.2}).metrics.unhappy,0);
  assert.deepEqual(m.sociology({tolerance:.3,vacancy:.2}).initial,m.sociology({tolerance:.65,vacancy:.2}).initial);
});
test('LIF has no spikes at/below threshold current and follows analytical firing period',()=>{
  assert.equal(m.neuroscience({current:0,tau:20}).metrics.spikes,0);
  assert.equal(m.neuroscience({current:.15,tau:20}).metrics.spikes,0);
  const r=m.neuroscience({current:.25,tau:20});near(r.metrics.frequency,1000/(20*Math.log(25/10)+2));assert.ok(r.metrics.spikes>0);
  assert.ok(m.neuroscience({current:.25,tau:40}).metrics.frequency<r.metrics.frequency);
  assert.ok(r.series[0].points.every(([,v])=>Number.isFinite(v)&&v>=-65&&v<=20));
});
test('all nine model contracts and twelve lessons match between languages',()=>{
  assert.equal(Object.keys(catalogs.en).length,9);let count=0;
  for(const[id,c]of Object.entries(catalogs.en)){
    const german=catalogs.de[id];assert.equal(c.model,german.model);assert.deepEqual(c.controls.map(({key,min,max,step,value})=>({key,min,max,step,value})),german.controls.map(({key,min,max,step,value})=>({key,min,max,step,value})));
    for(const metric of c.metric)assert.ok(metric in m[c.model](defaults(c)).metrics);
    c.lessons.forEach((lesson,i)=>{count++;const b={...defaults(c),...(lesson.baseline||{})},a={...b,...lesson.patch};assert.equal(Object.keys(a).filter(k=>a[k]!==b[k]).length,1);assert.deepEqual(lesson.patch,german.lessons[i].patch);assert.equal(lesson.correct,german.lessons[i].correct);for(const p of [a,b]){const result=m[c.model](p);for(const s of result.series)for(const point of s.points)assert.ok(point.every(Number.isFinite));}});
    // Exercise extrema of every public control against the default values.
    for(const control of c.controls)for(const value of [control.min,control.max]){const p={...defaults(c),[control.key]:value};if(id==='physics'){p.static=Math.max(p.static,p.kinetic);}const r=m[c.model](p);for(const s of r.series)assert.ok(s.points.flat().every(Number.isFinite));}
  }
  assert.equal(count,12);
});
