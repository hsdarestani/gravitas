(function(){
'use strict';

if(!/^\/workspace\/operating(?:\/|$)/.test(location.pathname))return;

var nav=document.getElementById('ws-nav');
var select=document.getElementById('ws-mobile-select');
var timer=null;

function coreShellMarkup(){
  return ''+
    '<div class="v3-home-link"><a href="/workspace/my-work" data-v3-home><span>⌂</span>Home</a></div>'+
    '<p class="v3-workspace-label">Choose workspace</p>'+
    '<div id="v3-workspace-picker" class="v3-workspace-picker">'+
      '<a href="/workspace/core" class="is-current"><span>◎</span><span><strong>Core Workspace</strong><small>Internal team operations</small></span></a>'+
      '<a href="/workspace/research"><span>◇</span><span><strong>Research Workspace</strong><small>Projects & scientific collaboration</small></span></a>'+
    '</div>'+
    '<p id="v3-context-label" class="v3-workspace-label">Core menu</p>'+
    '<div id="v3-context-nav" class="v3-context-nav">'+
      '<a href="/workspace/core"><span>◎</span>Overview</a>'+
      '<a href="/workspace/core/tasks"><span>✓</span>Tasks & Execution</a>'+
      '<a href="/workspace/core/content"><span>▶</span>Content Pipeline</a>'+
      '<a href="/workspace/operating" class="is-active"><span>↗</span>Planning & Projects</a>'+
    '</div>';
}

function restoreSidebar(){
  if(!nav)return;
  if(document.getElementById('v3-context-nav')&&document.getElementById('v3-workspace-picker'))return;
  nav.innerHTML=coreShellMarkup();
}

function restoreMobile(){
  if(!select)return;
  var values=Array.prototype.map.call(select.options,function(o){return o.value});
  var legacy=values.indexOf('dashboard')>-1||values.indexOf('strategy')>-1||values.indexOf('initiatives')>-1;
  var missingCore=values.indexOf('/workspace/operating')===-1;
  if(!legacy&&!missingCore)return;
  select.onchange=null;
  select.innerHTML=''+
    '<option value="/workspace/my-work">Home</option>'+
    '<option value="/workspace/core">Core · Overview</option>'+
    '<option value="/workspace/core/tasks">Core · Tasks</option>'+
    '<option value="/workspace/core/content">Core · Content</option>'+
    '<option value="/workspace/operating">Core · Planning & Projects</option>'+
    '<option value="/workspace/research">Research · Overview</option>';
  select.value='/workspace/operating';
  select.onchange=function(){if(this.value)location.href=this.value};
}

function restoreContext(){
  restoreSidebar();
  restoreMobile();
  var name=document.getElementById('ws-workspace-name');
  var kicker=document.getElementById('ws-kicker');
  if(name)name.textContent='Core Workspace';
  if(kicker)kicker.textContent='CORE · PLANNING & PROJECTS';
}

function queueRestore(){
  clearTimeout(timer);
  timer=setTimeout(restoreContext,0);
}

if(nav){
  new MutationObserver(queueRestore).observe(nav,{childList:true,subtree:true});
}
if(select){
  new MutationObserver(queueRestore).observe(select,{childList:true});
}

restoreContext();
setTimeout(restoreContext,80);
setTimeout(restoreContext,400);
})();
