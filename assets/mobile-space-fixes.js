(function(){
'use strict';

var scheduled=false;

function notesRoute(){return location.pathname.indexOf('/workspace/research/notes')===0}

function ensureNotesNavigation(){
  var box=document.getElementById('v3-context-nav');
  if(box&&location.pathname.indexOf('/workspace/research')===0&&!box.querySelector('a[href="/workspace/research/notes"]')){
    var link=document.createElement('a');
    link.href='/workspace/research/notes';
    link.innerHTML='<span>✎</span>Notes';
    if(notesRoute())link.className='is-active';
    var files=box.querySelector('a[href="/workspace/research/files"]');
    box.insertBefore(link,files||null);
  }

  var select=document.getElementById('ws-mobile-select');
  if(!select)return;
  var option=select.querySelector('option[value="/workspace/research/notes"]');
  if(!option){
    option=document.createElement('option');
    option.value='/workspace/research/notes';
    option.textContent='Research · Notes';
    var filesOption=select.querySelector('option[value="/workspace/research/files"]');
    select.insertBefore(option,filesOption||null);
  }
  if(notesRoute()&&select.value!=='/workspace/research/notes')select.value='/workspace/research/notes';
}

function showMessage(text){
  var box=document.getElementById('ws-alert');
  if(!box)return;
  box.hidden=false;
  box.textContent=text;
  box.style.borderLeftColor='var(--ws-danger)';
  clearTimeout(showMessage.timer);
  showMessage.timer=setTimeout(function(){box.hidden=true},5000);
}

function hardenSpaceProjectForm(){
  var dialog=document.getElementById('space-v1-dialog');
  if(!dialog||!dialog.open)return;
  var title=dialog.querySelector('[data-space-title]');
  var category=dialog.querySelector('select[name="category_id"]');
  var newCategory=dialog.querySelector('input[name="new_category"]');
  var form=dialog.querySelector('form');
  if(!form||!category||!newCategory||!title||!/research project/i.test(title.textContent||''))return;

  var first=category.options&&category.options[0];
  if(first&&first.value==='')first.textContent='Choose a Category…';

  if(form.dataset.spaceCategoryGuard==='1')return;
  form.dataset.spaceCategoryGuard='1';
  form.addEventListener('submit',function(e){
    if(category.value||String(newCategory.value||'').trim())return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showMessage('Choose a parent Category or create a new Category first.');
    category.focus({preventScroll:true});
    category.scrollIntoView({behavior:'smooth',block:'center'});
  },true);
}

function hardenAccessDialog(){
  var dialog=document.getElementById('v5-access-dialog');
  if(!dialog||!dialog.open)return;
  dialog.querySelectorAll('button,select,input,a').forEach(function(el){
    el.style.touchAction='manipulation';
  });
}

function apply(){
  scheduled=false;
  ensureNotesNavigation();
  hardenSpaceProjectForm();
  hardenAccessDialog();
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(apply);
}

new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('popstate',schedule);
document.addEventListener('click',function(){setTimeout(schedule,0)},true);
document.addEventListener('change',function(){setTimeout(schedule,0)},true);
setTimeout(apply,120);
})();
