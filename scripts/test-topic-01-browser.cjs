"use strict";
// End-to-end browser smoke for the two standalone Topic 01 simulations.
// Runs a local static server; never accesses production, Django, or Nextcloud.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

const PORT = 18831;
const ROOT = "http://127.0.0.1:" + PORT;
const shots = path.resolve("qa-artifacts/topic-01");
fs.mkdirSync(shots, { recursive: true });
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: path.resolve(__dirname, ".."), stdio: "ignore"
});
let browser;
let failed = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const reply = await fetch(ROOT + "/lab-prompt-bias.html");
      if (reply.status === 200) return;
    } catch {}
    await sleep(200);
  }
  throw Error("Local static fixture server not ready");
}
async function testPage(page, slug) {
  const failures = [];
  const requests = [];
  const consoleErrors = [];
  page.on("pageerror", e => failures.push("pageerror: " + e.message));
  page.on("request", r => requests.push(r.url()));
  page.on("response", r => {
    if (r.status() >= 400) failures.push("HTTP " + r.status() + " " + r.url());
  });
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  const response = await page.goto(ROOT + "/" + slug, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  if (slug.includes("scientific-visualization")) {
    await page.waitForFunction(() => document.getElementById("vizConclusion") && document.getElementById("modelLabel").textContent !== "—");
  } else {
    await page.waitForFunction(() => document.getElementById("saved") && window.GraviLab && document.querySelectorAll("input[type=range]").length >= 3);
  }
  const h1 = await page.locator("h1").innerText();
  assert.ok(h1.length > 8);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, slug + " horizontal overflow = " + overflow);
  assert.ok(requests.every(u => u.startsWith(ROOT + "/")), "Unexpected network/external request: " + requests.join(", "));
  assert.ok(requests.every(u => !u.includes("/api/")), "Unexpected backend usage");
  assert.deepEqual(failures, [], "HTTP or page error");
  assert.deepEqual(consoleErrors, [], "Console errors");
  return { requests, failures, consoleErrors };
}
async function setRange(page, id, value) {
  await page.locator("#" + id).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function smoke() {
  await waitForServer();
  const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ acceptDownloads: true });
  const p = await context.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  await testPage(p, "lab-protein-stability.html");
  const before = await p.locator("#fraction").innerText();
  await setRange(p, "temperature", 90);
  const after = await p.locator("#fraction").innerText();
  assert.notEqual(before, after, "protein temperature should change calculated result");
  assert.match(await p.locator("#interpretation").innerText(), /No practice observations exist above 50/);
  assert.ok(await p.locator("#plot circle").count() >= 4);
  assert.ok(await p.locator("#molecule").evaluate(el => el.width > 0 && el.height > 0));
  await p.screenshot({ path: path.join(shots, "protein-mobile.png"), fullPage: true });
  const proteinDownload = p.waitForEvent("download");
  await p.locator("#export").click();
  const pd = await proteinDownload;
  assert.equal(pd.suggestedFilename(), "graviquest-protein-run.json");
  const fileA = path.join(os.tmpdir(), "topic01-protein-run-"+process.pid+".json");
  await pd.saveAs(fileA);
  const pa = JSON.parse(fs.readFileSync(fileA, "utf8"));
  assert.equal(pa.parameters.temperature, 90);
  assert.equal(pa.result.measuredMax, 50);
  fs.unlinkSync(fileA);
  await p.locator("#reset").click();
  assert.equal(await p.locator("#temperatureValue").innerText(), "65 °C");
  await p.locator("#save").click();
  assert.match(await p.locator("#saved").innerText(), /Saved locally/);
  await p.setViewportSize({ width: 1440, height: 900 });
  const largeOver = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(largeOver <= 1, "Protein desktop horizontal overflow");
  await p.screenshot({ path: path.join(shots, "protein-desktop.png"), fullPage: true });

  const q = await context.newPage();
  await q.setViewportSize({ width: 390, height: 844 });
  await testPage(q, "lab-prompt-bias.html");
  const neutral = await q.locator("#neutralRate").innerText();
  await setRange(q, "agreeability", 0);
  const reduced = await q.locator("#neutralRate").innerText();
  assert.notEqual(neutral, reduced, "agreeability slider should change result");
  const previousSeed = await q.locator("#seedValue").innerText();
  await q.locator("#newSeed").click();
  assert.notEqual(await q.locator("#seedValue").innerText(), previousSeed);
  await q.screenshot({ path: path.join(shots, "bias-mobile.png"), fullPage: true });
  const biasDownload = q.waitForEvent("download");
  await q.locator("#export").click();
  const bd = await biasDownload;
  assert.equal(bd.suggestedFilename(), "graviquest-prompt-bias-run.json");
  const fileB = path.join(os.tmpdir(), "topic01-bias-run-"+process.pid+".json");
  await bd.saveAs(fileB);
  const pb = JSON.parse(fs.readFileSync(fileB, "utf8"));
  assert.equal(pb.result.runs, pb.settings.runs);
  assert.ok(pb.result.leadingRate >= pb.result.neutralRate);
  fs.unlinkSync(fileB);
  await q.locator("#reset").click();
  assert.equal(await q.locator("#seedValue").innerText(), "4701");
  await q.locator("#save").click();
  assert.match(await q.locator("#saved").innerText(), /Run saved locally/);
  await q.setViewportSize({ width: 1440, height: 900 });
  const qOver = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(qOver <= 1, "Bias desktop horizontal overflow");
  await q.screenshot({ path: path.join(shots, "bias-desktop.png"), fullPage: true });

  const v=await context.newPage();
  await v.setViewportSize({width:390,height:844});
  await testPage(v,"lab-scientific-visualization.html");
  const linear=await v.locator("#pred70").innerText();
  await v.locator("#degree").selectOption("2");
  const quadratic=await v.locator("#pred70").innerText();
  assert.notEqual(linear,quadratic,"linear vs quadratic extrapolation should differ");
  await v.locator("#extrapolation").uncheck();
  assert.equal(await v.locator("#pred70").innerText(),"Hidden");
  await v.locator("#extrapolation").check();
  assert.match(await v.locator("#vizConclusion").innerText(), /extrapolation/i);
  const vizDownload=v.waitForEvent("download");
  await v.locator("#exportData").click();
  const vd=await vizDownload;
  assert.equal(vd.suggestedFilename(),"graviquest-visualization-lab.json");
  const fileC=path.join(os.tmpdir(),"topic01-viz-run-"+process.pid+".json");
  await vd.saveAs(fileC);
  const pc=JSON.parse(fs.readFileSync(fileC,"utf8"));
  assert.equal(pc.model.observations.length,4);
  assert.equal(pc.model.degree,2);
  fs.unlinkSync(fileC);
  const svgDownload=v.waitForEvent("download");
  await v.locator("#exportSVG").click();
  const svgd=await svgDownload;
  assert.equal(svgd.suggestedFilename(),"graviquest-scientific-chart.svg");
  const svgPath=path.join(os.tmpdir(),"topic01-chart-"+process.pid+".svg");
  await svgd.saveAs(svgPath);
  const svgText=fs.readFileSync(svgPath,"utf8");
  assert.match(svgText,/svg/);
  assert.match(svgText,/circle/);
  fs.unlinkSync(svgPath);
  await v.screenshot({path:path.join(shots,"visualization-mobile.png"),fullPage:true});
  await v.setViewportSize({width:1440,height:900});
  assert.ok(await v.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
  await v.screenshot({path:path.join(shots,"visualization-desktop.png"),fullPage:true});

  // Only the generic Lab header is public while the Lab
  // concept is being reconsidered. The three standalone historical
  // simulations above remain regression-tested but are not listed here.
  const idx=await context.newPage();
  const indexResponse=await idx.goto(ROOT+"/lab.html",{waitUntil:"networkidle"});
  assert.equal(indexResponse.status(),200);
  assert.equal(await idx.locator("main h1").innerText(),"Lab");
  assert.equal(await idx.locator("main section").count(),1);
  assert.equal(await idx.locator(".ai-path-card,.ai-panel,.games > .game-card").count(),0);
  assert.equal(await idx.locator("main button").count(),0);
  assert.equal(await idx.locator("main iframe,main canvas").count(),0);
  assert.ok(await idx.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
  await idx.screenshot({path:path.join(shots,"ai-research-empty-desktop.png"),fullPage:true});
  await idx.setViewportSize({width:390,height:844});
  assert.ok(await idx.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
  await idx.screenshot({path:path.join(shots,"ai-research-empty-mobile.png"),fullPage:true});
  const noJs=await browser.newContext({javaScriptEnabled:false});
  const noJsPage=await noJs.newPage();
  await noJsPage.setViewportSize({width:390,height:844});
  assert.equal((await noJsPage.goto(ROOT+"/lab.html",{waitUntil:"load"})).status(),200);
  assert.equal(await noJsPage.locator("main h1").innerText(),"Lab");
  assert.equal(await noJsPage.locator("main section").count(),1);
  await noJs.close();
  const nav = await q.locator('a.back').getAttribute("href");
  assert.equal(nav, "lab.html");
  await q.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(await q.locator("h1").isVisible());
  await context.close();
  console.log("Browser PASS: historical simulation regressions + branded header-only Lab page on desktop, mobile and no-JS.");
}
smoke().catch(err => { failed = true; console.error(err.stack || err); }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  if (failed) process.exitCode = 1;
});
