// Execute: node --test tests/science-evidence.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../assets/science-evidence-engine.js');

test('standard normal CDF and 95% critical value',()=>{
  assert.ok(Math.abs(M.cdf(0)-.5)<1e-6);
  assert.ok(Math.abs(M.cdf(1.96)-.975)<3e-5);
  assert.ok(Math.abs(M.zCritical(.05)-1.95996)<.0002);
});
test('alpha and statistical power have theoretical consistency',()=>{
  assert.ok(Math.abs(M.theoreticalPower(.05,0,64)-.05)<1e-6);
  assert.ok(M.theoreticalPower(.05,.5,128)>M.theoreticalPower(.05,.5,32));
  assert.ok(M.theoreticalPower(.05,.5,64)>M.theoreticalPower(.05,.25,64));
});
test('null false-positive rate matches alpha in Monte Carlo',()=>{
  const count=18000,alpha=.05;let positives=0;
  for(let i=0;i<count;i++)if(M.resultFor(123,i,0,'initial',false,0,64,1,alpha).significant)positives++;
  const rate=positives/count;
  assert.ok(Math.abs(rate-alpha)<.009,'null type I rate '+rate);
});
test('multiple uncorrected analyses inflate FWER; Bonferroni controls it',()=>{
  const count=18000,alpha=.05;let one=0,four=0,adjusted=0;
  for(let i=0;i<count;i++){
    if(M.resultFor(345,i,0,'initial',false,0,64,1,alpha).significant)one++;
    if(M.resultFor(345,i,0,'initial',false,0,64,4,alpha).significant)four++;
    if(M.resultFor(345,i,0,'initial',false,0,64,4,alpha/4).significant)adjusted++;
  }
  assert.ok(four>one*2.5,'uncorrected multiplicity must increase false positives');
  assert.ok(Math.abs(adjusted/count-alpha)<.01,'Bonferroni should be near nominal alpha');
});
test('same seed yields same result; other seeds usually differ',()=>{
  const p=M.validate({days:24,runs:12});
  const a=M.one(p,11),b=M.one(p,11),c=M.one(p,12);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,c);
});
test('paired benchmark reports all five scientific scenarios and 95% CI',()=>{
  const report=M.benchmark({days:20,runs:15,seed:1002});
  for(const id of ['baseline','ai','rigor','flexibility','corrected']){
    assert.ok(report.scenarios[id].published.mean>=0);
    assert.equal(report.individual[id].length,15);
    assert.equal(report.scenarios[id].published.ci.length,2);
  }
  assert.equal(report.scenarios.baseline.publishedDelta.mean,0);
  assert.equal(report.scenarios.baseline.falsePublishedDelta.mean,0);
});
test('reject invalid or implausible input',()=>{
  assert.throws(()=>M.validate({alpha:42}),/invalid_alpha/);
  assert.throws(()=>M.validate({n:-10}),/invalid_n/);
  assert.throws(()=>M.benchmark({correction:'magic'}),/invalid_correction/);
});
