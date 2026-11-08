// Public HTTPS acceptance uses real browser logins and native, cookie-bound
// APIs. Only reserved, recorded QA identities are written. No browser bypasses,
// administrator API keys, mocked requests or disabled TLS checks are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
const {chromium,webkit,devices}=await import(process.env.PLAYWRIGHT_MODULE);
const fixture=JSON.parse(await fs.readFile(process.env.GQ_PUBLIC_USERS,'utf8'));
const output=process.env.GQ_PUBLIC_OUTPUT;
const SITE='https://graviquest.com',FORUM='https://forum.graviquest.com';
const token=fixture.token,native=fixture.native;
let phase='anonymous public pages';
await fs.mkdir(output,{recursive:true});
const browsers=[],contexts=[];
const result={token,browser_sso_verified:false};

function png(){
  const crc=buffer=>{let value=0xffffffff;for(const byte of buffer){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
  const chunk=(name,body)=>{const type=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(body.length);sum.writeUInt32BE(crc(Buffer.concat([type,body])));return Buffer.concat([size,type,body,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,80,140,190,255]))),chunk('IEND',Buffer.alloc(0))]);
}
async function json(response,label){assert(response.ok(),`${label}: HTTP ${response.status()}`);return response.json();}
async function headers(context){const value=await json(await context.request.get(FORUM+'/session/csrf.json'),'Native CSRF');return{'X-CSRF-Token':value.csrf,'X-Requested-With':'XMLHttpRequest',Origin:FORUM};}
async function post(context,path,data){
  // Keep native anti-flood checks enabled. A fast automated reply can arrive
  // sooner than a human types; honor the server's explicit pre-write rejection.
  for(let attempt=0;attempt<3;attempt++){
    const response=await context.request.post(FORUM+path,{data,headers:await headers(context)});
    if(response.status()!==429)return json(response,path);
    const delay=Math.min(30,Math.max(1,Number(response.headers()['retry-after'])||5));
    await new Promise(resolve=>setTimeout(resolve,delay*1000));
  }
  throw Error('Native posting rate limit remained active');
}
async function login(browser,role){
  const context=await browser.newContext();contexts.push(context);
  const page=await context.newPage();
  const scriptErrors=[];page.on('pageerror',error=>scriptErrors.push(error.name+': '+error.message.slice(0,160)));
  await page.goto(FORUM+'/session/sso',{waitUntil:'domcontentloaded'});
  await page.waitForURL(url=>url.origin===SITE&&url.pathname==='/login',{timeout:45000});
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/assets/production-bridge-core.js')));
  await page.locator('#in-mail').fill(fixture.users[role].email);
  await page.locator('#in-pass').fill(fixture.users[role].password);
  const authResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login/'&&response.request().method()==='POST',{timeout:30000});
  await page.locator('#p-in button[type=submit]').click();
  let auth;
  try{auth=await authResponse;}catch{const location=new URL(page.url());throw Error(`Login request was not submitted for ${role}; page=${location.origin+location.pathname}; script errors=${scriptErrors.join(';')}`);}
  const authData=await auth.json().catch(()=>({}));
  console.log(JSON.stringify({phase:'GraviQuest login',role,status:auth.status(),error:authData.error||null,scriptErrors}));
  assert(auth.ok(),`GraviQuest login rejected for ${role}: ${authData.error||auth.status()}`);
  try{await page.waitForURL(url=>url.origin===FORUM,{timeout:60000});}catch{const location=new URL(page.url());const intent=(await context.cookies(SITE)).some(cookie=>cookie.name==='gq_forum_continue');throw Error(`Forum continuation stalled for ${role} at ${location.origin+location.pathname}; intent cookie=${intent}; script errors=${scriptErrors.join(';')}`);}
  const session=await json(await context.request.get(FORUM+'/session/current.json'),'Native signed-in session');
  assert(session.current_user?.id,'Real GraviQuest login establishes a native forum session');
  assert.equal(Boolean(session.current_user.admin),false,'No acceptance identity becomes an administrator');
  assert.equal(Boolean(session.current_user.moderator),role==='moderator','Explicit moderator mapping');
  return{context,page,user:session.current_user};
}
async function approve(moderator,id){
  assert(Number.isInteger(id)&&id>0,'Recorded queued submission has an ID');
  let data=await json(await moderator.context.request.get(FORUM+`/review/${id}.json`),'Read own QA moderation item');
  const item=data.reviewable;
  assert(item&&JSON.stringify(item.payload).includes(token),'Moderation is limited to this QA token');
  await json(await moderator.context.request.put(FORUM+`/review/${id}/perform/approve_post.json`,{data:{version:item.version},headers:await headers(moderator.context)}),'Approve recorded QA post');
  data=await json(await moderator.context.request.get(FORUM+`/review/${id}.json`),'Read approved QA item');
  assert(data.reviewable.topic_id,'Approval created a persistent native discussion');return data.reviewable.topic_id;
}
async function queued(context,data){const value=await post(context,'/posts.json',data);assert.equal(value.action,'enqueued','Ordinary submissions enter moderation');return value.pending_post.id;}
async function upload(context,name){return json(await context.request.post(FORUM+'/uploads.json',{headers:await headers(context),multipart:{type:'composer',file:{name,mimeType:'image/png',buffer:png()}}}),'Real attachment upload');}
async function denied(context,path,label){const response=await context.request.get(FORUM+path);assert([403,404].includes(response.status()),label);}
async function eventually(fn,label){for(let i=0;i<20;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,1000));}throw Error(label);}

try{
  const browser=await chromium.launch({headless:true});browsers.push(browser);
  const anonymous=await browser.newContext();contexts.push(anonymous);
  const page=await anonymous.newPage();
  await page.goto(SITE+'/forum.html',{waitUntil:'domcontentloaded'});
  await page.locator('[data-forum-feed] .fm-row').first().waitFor({timeout:45000});
  const links=await page.locator('[data-forum-feed] .fm-row').evaluateAll(nodes=>nodes.map(node=>node.href));
  assert(links.length>0&&new Set(links).size===links.length&&links.every(url=>url.startsWith(FORUM+'/t/')),'Existing table has distinct real native permalinks');
  await page.screenshot({path:output+'/public-forum-desktop.png',fullPage:true});
  const feed=await json(await anonymous.request.get(SITE+'/api/forum/feed/'),'Public GraviQuest feed');
  assert((feed.topics||[]).length>0,'Real public discussions are available');
  assert(!(feed.categories||[]).some(category=>category.id===native.private_category_id),'Private categories stay out of the public feed');
  for(const sort of ['top','unanswered','latest']){await page.locator(`[data-forum-sort="${sort}"]`).click();await page.waitForFunction(()=>document.querySelector('[data-forum-feed]')?.getAttribute('aria-busy')==='false');}
  const topicLink=await json(await anonymous.request.get(SITE+'/api/forum/discussions/'+encodeURIComponent(native.content_key)+'/'),'Published scientific Topic mapping');
  assert.equal(topicLink.discussion.id,native.content_topic_id);
  await page.goto(SITE+'/api/forum/open/'+encodeURIComponent(native.content_key)+'/',{waitUntil:'domcontentloaded'});
  assert(new URL(page.url()).origin===FORUM&&new URL(page.url()).pathname.includes(String(native.content_topic_id)),'Scientific Topic opens its real discussion');
  for(const project of [{type:chromium,name:'android',device:'Pixel 7'},{type:webkit,name:'ios-webkit',device:'iPhone 13'}]){
    const mobileBrowser=await project.type.launch({headless:true});browsers.push(mobileBrowser);
    const context=await mobileBrowser.newContext({...devices[project.device],viewport:{width:390,height:844},deviceScaleFactor:1});contexts.push(context);
    const mobile=await context.newPage();await mobile.goto(SITE+'/forum.html',{waitUntil:'domcontentloaded'});
    await mobile.locator('[data-forum-feed] .fm-row').first().waitFor({timeout:45000});
    assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Public forum has no mobile overflow');
    await mobile.screenshot({path:output+`/public-forum-${project.name}.png`,fullPage:true});
  }
  phase='real GraviQuest logins';
  const member=await login(browser,'member'),moderator=await login(browser,'moderator'),researcher=await login(browser,'researcher');
  await denied(member.context,'/review.json','Ordinary members cannot moderate');
  phase='native composer and moderation';
  await member.page.goto(FORUM+`/c/introductions/${native.public_category_id}`,{waitUntil:'domcontentloaded'});
  await member.page.locator('#create-topic').click();
  await member.page.locator('#reply-title').fill('Automated launch acceptance '+token);
  const body=`Automated launch acceptance ${token}. This is a temporary operational check, not research content. @${moderator.user.username}`;
  const markdown=member.page.locator('#reply-control textarea.d-editor-input');
  if(await markdown.isVisible())await markdown.fill(body);
  else await member.page.locator('#reply-control .ProseMirror[contenteditable=true]').fill(body);
  await member.page.locator('#file-uploader').setInputFiles({name:'launch-acceptance-'+token+'.png',mimeType:'image/png',buffer:png()});
  await member.page.waitForFunction(()=>{
    const editor=document.querySelector('#reply-control');
    const text=editor?.querySelector('textarea.d-editor-input')?.value||'';
    return /!\[[^\]]*\]\((?:upload:\/\/|https?:|\/secure)/.test(text)||[...editor.querySelectorAll('.ProseMirror img')].some(img=>/(?:secure-media-uploads|\/original\/|upload:\/\/)/.test(img.getAttribute('data-original-src')||img.src));
  },undefined,{timeout:60000});
  // Discourse's browser client posts to /posts; its external JSON API also
  // accepts /posts.json. Observe the actual native composer submission.
  const pending=member.page.waitForResponse(response=>/^\/posts(?:\.json)?$/.test(new URL(response.url()).pathname)&&response.request().method()==='POST');
  await member.page.locator('#reply-control button.create').click();
  const created=await json(await pending,'Native composer submit');assert.equal(created.action,'enqueued');
  const topicId=await approve(moderator,created.pending_post.id);result.topic_id=topicId;
  await member.page.goto(FORUM+'/t/'+topicId,{waitUntil:'domcontentloaded'});await member.page.locator('.topic-post').first().waitFor();
  phase='reply, edit, search and poll';
  await approve(moderator,await queued(member.context,{topic_id:topicId,raw:`A persistent acceptance reply ${token} with an exact reference to the operational check. @${moderator.user.username}`,reply_to_post_number:1}));
  let topic=await json(await member.context.request.get(FORUM+`/t/${topicId}.json`),'Reload persistent discussion');
  const reply=topic.post_stream.posts.find(post=>post.post_number===2);assert(reply?.id,'Moderated reply persists');
  await json(await member.context.request.put(FORUM+`/posts/${reply.id}.json`,{data:{post:{raw:`An edited persistent acceptance clarification ${token}.`}},headers:await headers(member.context)}),'Edit own reply');
  await json(await member.context.request.put(FORUM+'/polls/vote',{data:{post_id:native.poll_post_id,poll_name:native.poll_name,options:[native.poll_option]},headers:await headers(member.context)}),'Real poll vote');
  await eventually(async()=>{const data=await json(await member.context.request.get(FORUM+'/search.json?q='+token),'Native search');return(data.topics||[]).some(item=>item.id===topicId);},'New discussion never appeared in native search');
  await eventually(async()=>{const data=await json(await moderator.context.request.get(FORUM+'/notifications.json'),'Mention notification');return(data.notifications||[]).some(item=>item.topic_id===topicId);},'In-app mention notification did not arrive');
  phase='private discussions and attachments';
  const privateFile=await upload(researcher.context,'private-acceptance-'+token+'.png');
  const privateTopicId=await approve(moderator,await queued(researcher.context,{title:'Private launch acceptance '+token,category:native.private_category_id,raw:`Temporary private access acceptance ${token}; removed after checks.\n\n![Private acceptance](${privateFile.url})`}));
  await denied(anonymous,'/t/'+privateTopicId+'.json','Guests cannot read private research');
  await denied(member.context,'/t/'+privateTopicId+'.json','Ordinary members cannot read private research');
  const privateTopic=await json(await researcher.context.request.get(FORUM+'/t/'+privateTopicId+'.json'),'Researcher accesses private discussion');
  const image=privateTopic.post_stream.posts[0].cooked.match(/<img[^>]+src="([^"]+)"/);assert(image,'Private attachment renders');
  const privatePath=new URL(image[1].replaceAll('&amp;','&'),FORUM).pathname;
  await denied(anonymous,privatePath,'Guests cannot download private attachment');
  await denied(member.context,privatePath,'Unrelated members cannot download private attachment');
  const authorized=await researcher.context.request.get(FORUM+privatePath,{maxRedirects:0});assert([200,302].includes(authorized.status()),'Researcher can open private attachment');
  phase='logout revocation and stable identity';
  await member.context.request.get(SITE+'/api/auth/csrf/');
  const csrf=(await member.context.cookies(SITE)).find(cookie=>cookie.name==='csrftoken');assert(csrf,'Existing Django CSRF cookie');
  await json(await member.context.request.post(SITE+'/api/auth/logout/',{data:{},headers:{'X-CSRFToken':csrf.value,Origin:SITE}}),'GraviQuest logout');
  const signedOut=await member.context.request.get(FORUM+'/session/current.json');
  assert(!signedOut.ok()||!(await signedOut.json()).current_user,'GraviQuest logout revokes the native Forum session');
  const repeated=await login(browser,'member');assert.equal(repeated.user.id,member.user.id,'Repeated GraviQuest login maps the same native identity');
  result.browser_sso_verified=true;result.notification_verified=true;result.private_attachments_verified=true;
  await fs.writeFile(output+'/public-results.json',JSON.stringify(result,null,2));
  console.log('Public HTTPS table, Topic mapping, three browser views, real GraviQuest SSO, native composer, moderation, replies, edit, upload, private ACLs, search, poll, notification and logout acceptance passed.');
}catch(error){
  let message=String(error.message||error);
  for(const value of Object.values(fixture.users))message=message.replaceAll(value.password,'[redacted]');
  message=message.replace(/https:\/\/(?:forum\.)?graviquest\.com[^\s"'<>]*/g,value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return'[redacted URL]';}});
  console.error('Public acceptance failed during '+phase+': '+message.slice(0,1600));process.exitCode=1;
}finally{for(const context of contexts)await context.close().catch(()=>{});for(const browser of browsers)await browser.close().catch(()=>{});}
