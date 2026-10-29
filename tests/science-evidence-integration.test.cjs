const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const host=fs.readFileSync('assets/lab-studio.js','utf8');
const css=fs.readFileSync('assets/lab-studio.css','utf8');
const source=fs.readFileSync('lab-sources/science-universe/engine.js','utf8');
const index=fs.readFileSync('lab-sources/science-universe/index.html','utf8');
test('one Lab 01, without secondary validation page or tabs',()=>{
 assert.doesNotMatch(host,/lab-mode-validation|lab-evidence-frame|science-evidence.html\?embed=1/);
 assert.match(host,/grid\.append\(stageCol,sidebar\);main\.append\(grid\)/);
 assert.match(host,/iframe\.sandbox='allow-scripts'/);
});
test('same original research model now uses actual normal sampling',()=>{
 assert.match(source,/SCIENCE-MODEL v2/);
 assert.match(source,/standardNormal\(s\)/);
 assert.match(source,/2\*\(1-normalCDF\(Math\.abs\(z\)\)\)/);
 assert.match(index,/doi\.org\/10\.1371\/journal\.pmed\.0020124/);
 assert.match(index,/doi\.org\/10\.1177\/0956797611417632/);
});
test('Pulsar has exact brand mark, persistent message history, compact UI',()=>{
 assert.match(host,/\/assets\/pulsar-mark\.svg/);
 assert.match(host,/localStorage\.setItem\(CHAT_KEY/);
 assert.match(host,/role','log/);
 assert.match(host,/lastCoachAt<90000/);
 assert.match(css,/\.lab-chat-log/);
});
test('no formerly excessive Pulsar control buttons',()=>{
 assert.doesNotMatch(host,/Pause commentary|Explain this state/);
 assert.match(host,/mountPulsarChat\(sidebar\)/);
});
