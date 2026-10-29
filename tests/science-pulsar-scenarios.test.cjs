const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const engine=require('../lab-sources/science-universe/engine.js');
const guide=fs.readFileSync('assets/science-pulsar-guide.js','utf8');
const shell=fs.readFileSync('assets/lab-studio.js','utf8');
const bridge=fs.readFileSync('assets/lab-bridge.js','utf8');
const app=fs.readFileSync('lab-sources/science-universe/app.js','utf8');
const page=fs.readFileSync('lab-sources/science-universe/index.html','utf8');
const backend=fs.readFileSync('backend/core/lab_api.py','utf8');
test('all three scenarios are explicit and limited to one policy',()=>{
 const names=['review_bottleneck','selective_reporting','replication_capacity'];
 for(const id of names){
  assert.ok(guide.includes("id:'"+id+"'"));
  assert.ok(app.includes(" "+id+":{"));
  assert.ok(bridge.includes("'"+id+"'"));
 }
 assert.match(app,/E\.fork\(checkpoint\)/);
 assert.match(app,/E\.editPolicy\(a,recipe\.key,recipe\.low\)/);
 assert.match(app,/E\.editPolicy\(b,recipe\.key,recipe\.high\)/);
 assert.match(app,/E\.step\(a,days\);E\.step\(b,days\)/);
});
test('guided intervention can lead to model-observable differences',()=>{
 const a=engine.make(20261030),b=engine.fork(a);
 engine.editPolicy(a,'generation',3);engine.editPolicy(b,'generation',9);
 engine.step(a,45);engine.step(b,45);
 assert.notEqual(engine.summary(a).generated,engine.summary(b).generated);
});
test('Pulsar knows selection and never treats aggregate publication as a paper list',()=>{
 assert.match(app,/selectedPaper\[active\]=paper\.id/);
 assert.match(app,/G\.context\(/);
 assert.match(app,/G\.experimentResult\(/);
 assert.match(shell,/scienceGuide\.context\(data\.context\)/);
 assert.match(shell,/scienceGuide\.navigation\(q\)/);
 assert.match(backend,/browser_reported_simulator_selection/);
 assert.match(backend,/aggregate count/);
 assert.match(guide,/“Latest published claims”/);
 assert.match(page,/id="selected-paper"/);
});
test('paper selection does not automatically schedule replication',()=>{
 const body=app.slice(app.indexOf("for(const paper of list){"),app.indexOf("function feed(){"));
 assert.match(body,/selectedPaper\[active\]=paper\.id/);
 assert.match(body,/Request independent replication/);
 assert.match(body,/action\.addEventListener\('click'/);
});
test('every scenario is allowed only from original sandboxed Science Universe',()=>{
 assert.match(bridge,/location\.pathname\.indexOf\('\/lab-run\/science-universe\/'\)/);
 assert.match(bridge,/e\.source!==window\.parent/);
 assert.match(bridge,/experimentListeners\.forEach/);
 assert.match(bridge,/lab:experiment:result/);
});
