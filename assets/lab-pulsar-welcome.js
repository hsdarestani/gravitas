/* A short, local introduction. It never calls Pulsar or consumes a question. */
(function(root){
'use strict';
const KEY='graviquest:science-ecosystem:welcome:v1';
function seen(){try{return localStorage.getItem(KEY)==='done';}catch(_){return false;}}
function play({avatar,onFinish}){
 let active=true,leaving=false,timer=null,flight=null;
 const dialog=document.createElement('dialog');dialog.className='lab-pulsar-welcome';
 dialog.setAttribute('aria-labelledby','lab-welcome-title');
 dialog.setAttribute('aria-describedby','lab-welcome-description');
 const card=document.createElement('div');card.className='lab-welcome-card';
 const mark=document.createElement('div');mark.className='lab-welcome-mark';mark.setAttribute('aria-hidden','true');
 if(avatar?.firstElementChild)mark.append(avatar.firstElementChild.cloneNode(true));
 const eyebrow=document.createElement('p');eyebrow.className='g-eyebrow';eyebrow.textContent='YOUR SCIENTIFIC COMPANION';
 const title=document.createElement('h2');title.id='lab-welcome-title';title.textContent='Hi, I’m Pulsar.';
 const description=document.createElement('p');description.id='lab-welcome-description';description.textContent='Let’s make one change and see what happens. I’ll be right beside you.';
 const skip=document.createElement('button');skip.type='button';skip.className='g-btn g-btn--secondary g-btn--sm';skip.textContent='Skip introduction';
 card.append(mark,eyebrow,title,description,skip);dialog.append(card);document.body.append(dialog);
 function dispose(){active=false;clearTimeout(timer);flight?.cancel();dialog.close();dialog.remove();}
 function complete(){
  if(!active)return;
  try{localStorage.setItem(KEY,'done');}catch(_){}
  dispose();onFinish?.();
 }
 async function finish(immediate=false){
  if(!active||leaving){if(immediate)complete();return;}
  leaving=true;clearTimeout(timer);
  if(immediate||root.matchMedia('(prefers-reduced-motion: reduce)').matches||typeof mark.animate!=='function'){complete();return;}
  const from=mark.getBoundingClientRect(),to=(avatar?.querySelector('svg')||avatar)?.getBoundingClientRect();
  if(!to?.width||!to.height){complete();return;}
  dialog.classList.add('is-docking');
  const x=to.left+to.width/2-from.left-from.width/2,y=to.top+to.height/2-from.top-from.height/2;
  const scale=to.width/(mark.querySelector('svg')?.getBoundingClientRect().width||from.width);
  flight=mark.animate([
   {transform:'translate(0,0) scale(1)',opacity:1},
   {transform:'translate('+x+'px,'+y+'px) scale('+scale+')',opacity:1}
  ],{duration:650,easing:'cubic-bezier(.4,0,.15,1)',fill:'forwards'});
  // A fallback also releases the modal if a browser suspends an animation.
  timer=setTimeout(complete,850);
  try{await flight.finished;if(active)complete();}catch(_){}
 }
 skip.addEventListener('click',()=>finish(true));
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish(true);});
 if(typeof dialog.showModal!=='function'){complete();return dispose;}
 dialog.showModal();skip.focus({preventScroll:true});
 timer=setTimeout(()=>finish(),root.matchMedia('(prefers-reduced-motion: reduce)').matches?200:1400);
 return dispose;
}
root.GraviLabWelcome={seen,play};
})(window);
