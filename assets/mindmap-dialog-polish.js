(function(){
'use strict';

function polish(){
  var d=document.getElementById('mm-dialog');
  if(!d||!d.open)return;
  var title=document.getElementById('mm-title');
  var form=document.getElementById('mm-form');
  if(!title||!form)return;
  var isAI=/Cloudflare AI/i.test(title.textContent||'');
  d.classList.toggle('mm-dialog--ai',isAI);
  if(!isAI)return;

  var prompt=form.querySelector('textarea[name="prompt"]');
  if(prompt&&!prompt.placeholder){
    prompt.placeholder='Example: Map the main hypotheses, evidence, open questions and next research steps for this topic.';
  }

  var submit=form.querySelector('[type="submit"]');
  if(submit&&submit.textContent.trim()==='Save')submit.textContent='Generate map';
}

document.addEventListener('click',function(e){
  if(e.target.closest('[data-mm-ai]'))setTimeout(polish,0);
},true);

var observer=new MutationObserver(function(){
  var d=document.getElementById('mm-dialog');
  if(d&&d.open)polish();
});
observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
})();
