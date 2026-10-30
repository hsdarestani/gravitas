'use strict';
/* Execute the actual published engine. Never infer outcomes from recipe names. */
const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib');
const E=require('../lab-sources/science-universe/engine.js');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const engineSha=hash(fs.readFileSync('lab-sources/science-universe/engine.js'));
const keys=Object.keys(E.DEFAULTS),settings=new Map(),days=60,seeds=[21061,21062,21063];
function add(policy,design,family){
 const parameters={...E.DEFAULTS,...policy},normalized=E.normalizeDesign(design);
 const id=JSON.stringify([parameters,normalized]);
 if(!settings.has(id))settings.set(id,{parameters,design:normalized,family});
}
add({}, {}, 'baseline');
for(const key of keys)for(let value=1;value<=10;value++)add({[key]:value},{},'single:'+key);
for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++)
 for(const a of [1,10])for(const b of [1,10])add({[keys[i]]:a,[keys[j]]:b},{},'pair:'+keys[i]+':'+keys[j]);
for(const labsPerDomain of [3,7,14])for(const truthPriorOverride of [null,.1,.3,.5])
 for(const [agentsMin,agentsMax] of [[1,3],[3,5],[5,8]])for(const aiRoleFraction of [0,.25,.48,.75,1])
  add({},{labsPerDomain,truthPriorOverride,agentsMin,agentsMax,aiRoleFraction},'design_sensitivity');
const runs=[];
for(const setting of settings.values())for(const seed of seeds){
 const s=E.make(seed,setting.parameters,setting.design);E.step(s,days);
 const identity={engine_sha:engineSha,parameters:s.policy,design:s.design,seed,days};
 runs.push({...identity,signature:hash(JSON.stringify(identity)),family:setting.family,
   result:E.summary(s),trajectory:s.history.map(h=>({day:h.day,published:h.published,
    falsePublished:h.falsePublished,reviewBacklog:h.reviewBacklog,crossFieldStudies:h.crossFieldStudies,
    crossFieldPublished:h.crossFieldPublished,replicated:h.replicated,meanBudget:h.meanBudget}))});
}
const data={schema:1,engine_sha:engineSha,days,seeds,coverage:'sampled, not exhaustive',
 policy_combinations:String(10n**BigInt(keys.length)),configurations:settings.size,runs};
fs.writeFileSync('backend/core/data/lab-scenario-atlas.json.gz',zlib.gzipSync(JSON.stringify(data),{level:9}));
console.log(JSON.stringify({configurations:settings.size,runs:runs.length,engine_sha:engineSha,bytes:fs.statSync('backend/core/data/lab-scenario-atlas.json.gz').size}));
