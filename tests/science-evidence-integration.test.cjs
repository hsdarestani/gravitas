// Structural integration regression: evidence benchmark must stay in Lab 01 UI.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const host=fs.readFileSync('assets/lab-studio.js','utf8');
const ui=fs.readFileSync('assets/science-evidence-ui.js','utf8');
const css=fs.readFileSync('assets/science-evidence.css','utf8');
const shell=fs.readFileSync('assets/lab-studio.css','utf8');
test('Science Universe mounts two modes without external navigation',()=>{
 assert.match(host,/if\(lab\.slug==='science-universe'\)/);
 assert.match(host,/lab-mode-simulation/);
 assert.match(host,/lab-mode-validation/);
 assert.match(host,/history\.replaceState/);
 assert.doesNotMatch(host,/evidence\.href='\/science-evidence\.html'/);
});
test('full simulator is retained when statistical validation is selected',()=>{
 assert.match(host,/simulationRegion\.append\(grid\)/);
 assert.match(host,/iframe\.sandbox='allow-scripts'/);
 assert.match(host,/simulationRegion\.hidden=isValidation/);
 assert.match(host,/validationRegion\.hidden=!isValidation/);
});
test('benchmark loads lazily from internal Lab mode',()=>{
 assert.match(host,/benchFrame\.src='\/science-evidence\.html\?embed=1'/);
 assert.match(host,/benchFrame\.dataset\.loaded/);
 assert.match(ui,/new URLSearchParams\(location\.search\)\.get\('embed'\)/);
 assert.match(css,/html\.embed \.mast/);
});
test('benchmark resize accepts only same-origin frame messages',()=>{
 assert.match(host,/e\.source!==evidenceFrame\.contentWindow/);
 assert.match(host,/e\.origin!==location\.origin/);
 assert.match(ui,/window\.parent\.postMessage\(\{type:'science-bench:resize'/);
 assert.match(shell,/lab-evidence-frame/);
});
