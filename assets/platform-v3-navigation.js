(function(){
'use strict';

var boot=null;
var decorating=false;
var lastPath='';

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function currentArea(){
  var p=location.pathname;
  if(p==='/workspace'||p==='/workspace/'||/^\/workspace\/my-work\/?$/.test(p))return 'home';
  if(/^\/workspace\/(?:core|operating)(?:\/|$)/.test(p))return 'core';
  return 'research';
}
function coreAllowed(){return !!(boot&&boot.access&&boot.access.core)}
function coreAdmin(){var role=boot&&boot.access&&boot.access.core_role;return role==='owner'||role==='admin'}
function link(href,icon,label,active){return '<a href="'+href+'" class="'+(active?'is-active':'')+'"><span>'+icon+'</span>'+esc(label)+'</a>'}
function exact(path){return location.pathname.replace(/\/$/,'')===path}
function starts(path){return location.pathname.indexOf(path)===0}
function inResearchLibrary(){return starts('/workspace/research/files')||starts('/workspace/research/datasets')||starts('/workspace/research/mindmaps')||starts('/workspace/shared')}
function inResearchCollaboration(){return starts('/workspace/research/nextcloud')||starts('/workspace/people')||starts('/workspace/community')}

var coreNav=[
  ['/workspace/core','◎','Overview',function(){return exact('/workspace/core')}],
  ['/workspace/core/tasks','✓','Tasks & Execution',function(){return starts('/workspace/core/tasks')}],
  ['/workspace/core/content','▶','Content Pipeline',function(){return starts('/workspace/core/content')}],
  ['/workspace/operating','↗','Planning & Projects',function(){return starts('/workspace/operating')}]
];
var researchNav=[
  ['/workspace/research','◇','Overview',function(){return exact('/workspace/research')}],
  ['/workspace/research/projects','□','Projects',function(){return starts('/workspace/research/projects')}],
  ['/workspace/research/files','↑','Files & Data Rooms',function(){return inResearchLibrary()}],
  ['/workspace/research/nextcloud','◉','Collaboration',function(){return inResearchCollaboration()}]
];
function coreItems(){var items=coreNav.slice();if(coreAdmin())items.push(['/workspace/core/team','♙','Team & Access',function(){return starts('/workspace/core/team')}]);return items}

function renderWorkspacePicker(area){
  var picker=document.getElementById('v3-workspace-picker');
  if(!picker)return;
  var html='';
  if(coreAllowed())html+='<a href="/workspace/core" class="'+(area==='core'?'is-current':'')+'"><span>◎</span><span><strong>Core Workspace</strong><small>Internal team operations</small></span></a>';
  html+='<a href="/workspace/research" class="'+(area==='research'?'is-current':'')+'"><span>◇</span><span><strong>Research Workspace</strong><small>Projects & scientific collaboration</small></span></a>';
  if(picker.dataset.v3Html!==html){picker.dataset.v3Html=html;picker.innerHTML=html}
}

function renderContextNav(area){
  var box=document.getElementById('v3-context-nav');
  var label=document.getElementById('v3-context-label');
  if(!box||!label)return;
  var html='',text='Workspaces';
  if(area!=='home'){
    var items=area==='core'?coreItems():researchNav;
    text=area==='core'?'Core menu':'Research menu';
    html=items.map(function(x){return link(x[0],x[1],x[2],x[3]())}).join('');
  }
  if(label.textContent!==text)label.textContent=text;
  if(box.dataset.v3Html!==html){box.dataset.v3Html=html;box.innerHTML=html}
}

function labelForPath(){
  if(exact('/workspace/core'))return 'Overview';
  if(starts('/workspace/core/tasks'))return 'Tasks & Execution';
  if(starts('/workspace/core/content'))return 'Content Pipeline';
  if(starts('/workspace/core/team'))return 'Team & Access';
  if(starts('/workspace/operating'))return 'Planning & Projects';
  if(exact('/workspace/research'))return 'Overview';
  if(starts('/workspace/research/projects'))return 'Projects';
  if(starts('/workspace/research/notes'))return 'Research Notes';
  if(starts('/workspace/research/files'))return 'Files & Data Rooms';
  if(starts('/workspace/research/datasets'))return 'Datasets';
  if(starts('/workspace/research/mindmaps'))return 'Mind Maps';
  if(starts('/workspace/research/nextcloud'))return 'Nextcloud Apps';
  if(starts('/workspace/people'))return 'Researchers';
  if(starts('/workspace/community'))return 'Research Opportunities';
  if(starts('/workspace/shared'))return 'Shared with me';
  return 'Overview';
}

function renderBreadcrumb(area){
  var main=document.getElementById('workspace-main');
  var hero=main&&main.querySelector('.ws-hero');
  if(!main||!hero)return;
  var old=document.getElementById('v3-breadcrumbs');
  if(area==='home'){if(old)old.remove();return}
  var key=area+'|'+labelForPath();
  if(old&&old.dataset.v3Key===key)return;
  if(old)old.remove();
  var crumb=document.createElement('nav');
  crumb.id='v3-breadcrumbs';crumb.className='v3-breadcrumbs';crumb.dataset.v3Key=key;crumb.setAttribute('aria-label','Breadcrumb');
  var ws=area==='core'?'Core Workspace':'Research Workspace';
  var href=area==='core'?'/workspace/core':'/workspace/research';
  crumb.innerHTML='<a href="/workspace/my-work">Home</a><i>›</i><a href="'+href+'">'+ws+'</a><i>›</i><strong>'+esc(labelForPath())+'</strong>';
  hero.parentNode.insertBefore(crumb,hero);
}

function renderContextStrip(area){
  var alertBox=document.getElementById('ws-alert');
  if(!alertBox)return;
  var old=document.getElementById('v3-context-strip');
  if(area==='home'){if(old)old.remove();return}
  if(old&&old.dataset.v3Area===area)return;
  if(old)old.remove();
  var box=document.createElement('div');box.id='v3-context-strip';box.className='v3-context-strip';box.dataset.v3Area=area;
  if(area==='core')box.innerHTML='<span>◎</span><div><b>Internal Gravitas workspace</b>Projects, execution, content and team planning. This workspace is visible only to members of the Gravitas core team.</div>';
  else box.innerHTML='<span>◇</span><div><b>Research collaboration workspace</b>Scientific and client projects live here. Access is granted per project or item; private notes and files stay private until shared.</div>';
  alertBox.parentNode.insertBefore(box,alertBox);
}

function renderMobile(area){
  var select=document.getElementById('ws-mobile-select');
  var label=select&&select.previousElementSibling;
  if(!select)return;
  var options=[['/workspace/my-work','Home']];
  if(coreAllowed()){
    options.push(['/workspace/core','Core · Overview'],['/workspace/core/tasks','Core · Tasks'],['/workspace/core/content','Core · Content'],['/workspace/operating','Core · Planning & Projects']);
    if(coreAdmin())options.push(['/workspace/core/team','Core · Team & Access']);
  }
  options=options.concat([
    ['/workspace/research','Research · Overview'],
    ['/workspace/research/projects','Research · Projects'],
    ['/workspace/research/files','Research · Files & Data Rooms'],
    ['/workspace/research/nextcloud','Research · Collaboration']
  ]);
  var key=(coreAllowed()?'core1':'core0')+(coreAdmin()?'-admin':'-member')+'-research4';
  if(select.dataset.v3Options!==key){
    select.dataset.v3Options=key;
    select.innerHTML=options.map(function(x){return '<option value="'+x[0]+'">'+esc(x[1])+'</option>'}).join('');
  }
  var p=location.pathname.replace(/\/$/,'');
  var matched=options.find(function(x){return p===x[0]||p.indexOf(x[0]+'/')===0});
  if(inResearchLibrary())matched=options.find(function(x){return x[0]==='/workspace/research/files'});
  if(inResearchCollaboration())matched=options.find(function(x){return x[0]==='/workspace/research/nextcloud'});
  if(starts('/workspace/research/notes'))matched=options.find(function(x){return x[0]==='/workspace/research/projects'});
  if(matched&&select.value!==matched[0])select.value=matched[0];
  var labelText=area==='home'?'Go to':'Current workspace';if(label&&label.textContent!==labelText)label.textContent=labelText;
  if(!select.dataset.v3Bound){select.dataset.v3Bound='1';select.addEventListener('change',function(){if(this.value)location.href=this.value})}
}

function workspaceCard(kind){
  if(kind==='core')return '<a class="v3-workspace-card" href="/workspace/core"><div class="v3-workspace-card__icon">◎</div><small>Internal team only</small><h2>Core Workspace</h2><p>Run Gravitas: projects, tasks, content production and operating priorities.</p><footer>Open Core Workspace →</footer></a>';
  return '<a class="v3-workspace-card" href="/workspace/research"><div class="v3-workspace-card__icon">◇</div><small>Research collaboration</small><h2>Research Workspace</h2><p>Scientific research, client projects, secure data rooms, notes, datasets and researcher collaboration.</p><footer>Open Research Workspace →</footer></a>';
}

function clearHomeDecoration(){
  var content=document.getElementById('ws-content');
  if(!content)return;
  content.querySelectorAll('[data-v3-home-decoration]').forEach(function(el){el.remove()});
}

function decorateHome(area){
  if(area!=='home'){
    clearHomeDecoration();
    return;
  }
  var title=document.getElementById('ws-title'),sub=document.getElementById('ws-subtitle'),kick=document.getElementById('ws-kicker');
  if(title&&title.textContent!=='Home')title.textContent='Home';
  if(sub)sub.textContent='Choose a workspace, then continue with the work assigned to you.';
  if(kick)kick.textContent='GRAVITAS · HOME';
  var content=document.getElementById('ws-content');
  if(!content||content.querySelector('.v3-home-workspaces'))return;
  var cards=(coreAllowed()?workspaceCard('core'):'')+workspaceCard('research');
  var html='<div data-v3-home-decoration class="v3-home-section-title"><h2>Your workspaces</h2><span>Two contexts. One platform.</span></div><div data-v3-home-decoration class="v3-home-workspaces">'+cards+'</div><div data-v3-home-decoration class="v3-home-section-title"><h2>Assigned to you</h2><span>Across the workspaces you can access</span></div>';
  content.insertAdjacentHTML('afterbegin',html);
}

function decorateResearchPrivateScope(area){
  if(area!=='research')return;
  var content=document.getElementById('ws-content');
  if(!content||content.querySelector('.v3-research-private-note'))return;
  if(!/^\/workspace\/research\/(?:notes|files|datasets)\/?$/.test(location.pathname))return;
  var toolbar=content.querySelector('.v2-toolbar');if(!toolbar)return;
  var note=document.createElement('div');note.className='v3-research-private-note';note.textContent='Private is a scope, not another workspace. New items can stay private, be attached to a research project, or be shared explicitly.';
  toolbar.parentNode.insertBefore(note,toolbar.nextSibling);
}

function applyShell(){
  if(!boot||decorating)return;
  decorating=true;
  try{
    var area=currentArea();
    if(area==='core'&&!coreAllowed()){location.replace('/workspace/research');return}
    if(starts('/workspace/core/team')&&!coreAdmin()){location.replace('/workspace/core');return}
    var name=document.getElementById('ws-workspace-name');var nameText=area==='home'?'Gravitas Home':area==='core'?'Core Workspace':'Research Workspace';if(name&&name.textContent!==nameText)name.textContent=nameText;
    var home=document.querySelector('[data-v3-home]');if(home)home.classList.toggle('is-active',area==='home');
    renderWorkspacePicker(area);renderContextNav(area);renderBreadcrumb(area);renderContextStrip(area);renderMobile(area);
    document.querySelectorAll('[data-core-only]').forEach(function(el){el.hidden=!coreAllowed()});
    var storage=document.querySelector('.ws-storage');if(storage)storage.dataset.v3Hidden=area==='research'?'false':'true';
    decorateHome(area);decorateResearchPrivateScope(area);lastPath=location.pathname;
  }finally{decorating=false}
}

function load(){
  fetch('/api/platform/bootstrap/',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){if(r.status===401){location.href='/login';throw new Error('auth')}return r.json()}).then(function(d){boot=d;applyShell()}).catch(function(){});
}

var observer=new MutationObserver(function(){clearTimeout(observer.v3timer);observer.v3timer=setTimeout(function(){if(boot)applyShell()},60)});
var main=document.getElementById('workspace-main');if(main)observer.observe(main,{childList:true,subtree:true});
window.addEventListener('popstate',function(){setTimeout(applyShell,0)});
document.addEventListener('click',function(){setTimeout(function(){if(location.pathname!==lastPath)applyShell()},0)});
load();
})();