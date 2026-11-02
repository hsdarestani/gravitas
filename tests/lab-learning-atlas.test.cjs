'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const E=require('../lab-sources/science-universe/engine.js'),{compareStored}=require('../scripts/lab-atlas-preview.cjs');
const runs=JSON.parse(zlib.gunzipSync(fs.readFileSync('backend/core/data/lab-scenario-atlas.json.gz'))).runs;
test('all twelve atlas controls replay exact stored paired outcomes',()=>{
 let count=0;for(const key of Object.keys(E.DEFAULTS)){const data=compareStored(runs,key,3,9);assert.equal(data.matched_seeds,3);
  for(const pair of data.pairs){assert.equal(pair.a.seed,pair.b.seed);assert.deepEqual(pair.a.design,pair.b.design);assert.equal(pair.a.days,pair.b.days);
   assert.deepEqual(Object.keys(E.DEFAULTS).filter(k=>pair.a.parameters[k]!==pair.b.parameters[k]),[key]);
   for(const side of ['a','b']){const row=pair[side],world=E.make(row.seed,row.parameters,row.design);E.step(world,row.days);const result=E.summary(world);for(const metric of ['published','falsePublished','reviewBacklog','replicated'])assert.equal(result[metric],row.result[metric]);count++;}
  }
 }assert.equal(count,72);
});
