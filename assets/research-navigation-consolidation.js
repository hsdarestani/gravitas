(function(){
'use strict';

var scheduled=false;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function starts(path){return location.pathname.indexOf(path)===0}
function exact(path){return location.pathname.replace(/\/$/,'')===path}
function isResearch(){return !(/^\/workspace\/(?:core|operating)(?:\/|$)/.test(location.pathname))&&!exact('/workspace')&&!exact('/workspace/my-work')}
function inLibrary(){return starts('/workspace/research/files')||starts('/workspace/research/datasets')||starts('/workspace/research/mindmaps')||starts('/workspace/shared')}
function inCollaboration(){return starts('/workspace/research/nextcloud')||starts('/workspace/people')||starts('/workspace/community')}

function link(href,icon,label,active){return '<a href="'+href+'" class="'+(active?'is-active':'')+'"><span>'+icon+'</span>'+esc(label)+'</a>'}

function consolidateSidebar(){
  if(!isResearch())return;
  var box=document.getElementById('v3-context-nav');
  var label=document.getElementById('v3-context-label');
  if(!box)return;
  var html=[
    link('/workspace/research','◇','Overview',exact('/workspace/research')),
    link('/workspace/research/projects','□','Projects',starts('/workspace/research/projects')),
    link('/workspace/research/notes','▤','Notes',starts('/workspace/research/notes')),
    link('/workspace/research/files','↑','Files & Data Rooms',inLibrary()),
    link('/workspace/research/ai','✦','AI & Models',starts('/workspace/research/ai')),
    link('/workspace/research/nextcloud','◉','Collaboration',inCollaboration())
  ].join('');
  if(box.dataset.researchConsolidatedHtml!==html){
    box.dataset.researchConsolidatedHtml=html;
    box.innerHTML=html;
  }
  if(label)label.textContent='Research menu';
}

function consolidateMobile(){
  if(!isResearch())return;
  var select=document.getElementById('ws-mobile-select');
  if(!select)return;
  var options=[
    ['/workspace/my-work','Home'],
    ['/workspace/research','Research · Overview'],
    ['/workspace/research/projects','Research · Projects'],
    ['/workspace/research/notes','Research · Notes'],
    ['/workspace/research/files','Research · Files & Data Rooms'],
    ['/workspace/research/ai','Research · AI & Models'],
    ['/workspace/research/nextcloud','Research · Collaboration']
  ];
  var html=options.map(function(x){return '<option value="'+x[0]+'">'+esc(x[1])+'</option>'}).join('');
  if(select.dataset.researchConsolidatedOptions!==html){
    select.dataset.researchConsolidatedOptions=html;
    select.innerHTML=html;
  }
  var value=exact('/workspace/research')?'/workspace/research':starts('/workspace/research/projects')?'/workspace/research/projects':starts('/workspace/research/notes')?'/workspace/research/notes':starts('/workspace/research/ai')?'/workspace/research/ai':inLibrary()?'/workspace/research/files':inCollaboration()?'/workspace/research/nextcloud':'/workspace/research';
  if(select.value!==value)select.value=value;
}

function tab(href,label,active){return '<a href="'+href+'" '+(active?'class="is-active"':'')+'>'+esc(label)+'</a>'}
function renderHubTabs(){
  var content=document.getElementById('ws-content');
  if(!content)return;
  var old=content.querySelector(':scope > .research-hub-tabs');
  var kind=inLibrary()?'library':inCollaboration()?'collaboration':'';
  if(!kind){if(old)old.remove();return}
  var html='';
  if(kind==='library'){
    html=tab('/workspace/research/files','Files & Data Rooms',starts('/workspace/research/files'))+
      tab('/workspace/research/datasets','Datasets',starts('/workspace/research/datasets'))+
      tab('/workspace/research/mindmaps','Mind Maps',starts('/workspace/research/mindmaps'))+
      tab('/workspace/shared','Shared with me',starts('/workspace/shared'));
  }else{
    html=tab('/workspace/research/nextcloud','Nextcloud Apps',starts('/workspace/research/nextcloud'))+
      tab('/workspace/people','Researchers',starts('/workspace/people'))+
      tab('/workspace/community','Research Opportunities',starts('/workspace/community'));
  }
  var key=kind+'|'+location.pathname;
  if(old&&old.dataset.key===key)return;
  if(old)old.remove();
  var nav=document.createElement('nav');
  nav.className='research-hub-tabs';nav.dataset.key=key;nav.setAttribute('aria-label',kind==='library'?'Research library':'Research collaboration');
  nav.innerHTML=html;
  content.insertBefore(nav,content.firstChild);
}

function injectStyle(){
  if(document.getElementById('research-navigation-consolidation-style'))return;
  var style=document.createElement('style');style.id='research-navigation-consolidation-style';
  style.textContent='.research-hub-tabs{display:flex;gap:5px;align-items:center;overflow:auto;margin:0 0 16px;padding:5px;border:1px solid var(--ws-line);border-radius:13px;background:var(--ws-panel);scrollbar-width:none}.research-hub-tabs::-webkit-scrollbar{display:none}.research-hub-tabs a{flex:0 0 auto;padding:8px 11px;border-radius:9px;color:var(--ws-muted);font-size:10px;font-weight:750;text-decoration:none;white-space:nowrap}.research-hub-tabs a:hover{color:var(--ws-text);background:color-mix(in srgb,var(--ws-bg) 65%,transparent)}.research-hub-tabs a.is-active{color:var(--ws-bg);background:var(--ws-text)}@media(max-width:580px){.research-hub-tabs{margin-bottom:12px}.research-hub-tabs a{padding:8px 10px}}';
  document.head.appendChild(style);
}

function apply(){
  scheduled=false;
  injectStyle();
  consolidateSidebar();
  consolidateMobile();
  renderHubTabs();
}
function schedule(){if(scheduled)return;scheduled=true;setTimeout(apply,40)}

var main=document.getElementById('workspace-main');
if(main){new MutationObserver(schedule).observe(main,{childList:true,subtree:true})}
var nav=document.getElementById('ws-nav');
if(nav){new MutationObserver(schedule).observe(nav,{childList:true,subtree:true})}
window.addEventListener('popstate',schedule);
document.addEventListener('click',function(){setTimeout(schedule,0)});
setTimeout(apply,80);
})();