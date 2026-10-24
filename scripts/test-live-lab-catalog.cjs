"use strict";
const { chromium } = require("playwright-core");
const fs = require("node:fs"), path=require("node:path");
const target="https://graviquest.com/lab.html";
const dir=path.resolve("qa-artifacts/live-lab-catalog");
fs.mkdirSync(dir,{recursive:true});
function info(){
  function one(el){
    if(!el)return null;
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return {tag:el.tagName,cls:String(el.className).slice(0,120),
      opacity:s.opacity,display:s.display,visibility:s.visibility,position:s.position,
      height:Math.round(r.height),width:Math.round(r.width),top:Math.round(r.top),
      bottom:Math.round(r.bottom),offsetTop:el.offsetTop,cssTransform:s.transform,
      overflow:s.overflow,contentVisibility:s.contentVisibility,
      color:s.color,background:s.backgroundColor,zIndex:s.zIndex};
  }
  let cards=Array.from(document.querySelectorAll(".games > a.game-card"));
  let grid=document.querySelector(".games");
  let target=cards[0];
  let ancestry=[],el=target;
  for(let i=0;el&&i<9;i++,el=el.parentElement)ancestry.push(one(el));
  const r=target?.getBoundingClientRect();
  return {url:location.href,viewport:{w:innerWidth,h:innerHeight,scrollY:scrollY},
    title:document.title,firstCards:cards.slice(0,4).map(one),totalCards:cards.length,
    grid:one(grid),header:one(document.querySelector(".page-head")),
    section:one(document.querySelector(".g-section")),
    ancestry,rootScrollHeight:document.documentElement.scrollHeight,
    samplePoint:r?one(document.elementFromPoint(Math.min(innerWidth-1,r.x+20),Math.min(innerHeight-1,Math.max(0,r.y+20)))):null};
}
(async()=>{
  const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox"]});
  const results=[];
  for(const [slug,url] of [["plain",target],["busted",target+"?live_qa="+Date.now()]]){
    const context=await browser.newContext({viewport:{width:1649,height:928},deviceScaleFactor:1,javaScriptEnabled:true});
    const page=await context.newPage();
    const errors=[],failed=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("requestfailed",r=>failed.push({url:r.url().slice(0,140),error:r.failure()?.errorText}));
    let status=-1;
    try{
      const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
      status=response?.status()||0;
      await page.waitForTimeout(2500);
      const snapshot=await page.evaluate(info);
      await page.screenshot({path:path.join(dir,slug+"-initial.png"),fullPage:false});
      await page.screenshot({path:path.join(dir,slug+"-full.png"),fullPage:true});
      let afterScroll=null;
      if(await page.locator(".games > a.game-card").count()){
        await page.locator(".games > a.game-card").first().scrollIntoViewIfNeeded();
        afterScroll=await page.evaluate(info);
        await page.screenshot({path:path.join(dir,slug+"-scrolled.png"),fullPage:false});
      }
      results.push({slug,url,status,snapshot,afterScroll,errors,failed:failed.slice(0,12)});
    }catch(e){results.push({slug,url,status,error:String(e),errors,failed});}
    await context.close();
  }
  const data=JSON.stringify(results,null,2);
  fs.writeFileSync(path.join(dir,"metrics.json"),data);
  console.log("LIVE_LAB_METRICS_START");
  console.log(data.slice(0,16000));
  console.log("LIVE_LAB_METRICS_END");
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
