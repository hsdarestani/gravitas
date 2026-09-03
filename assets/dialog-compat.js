(function(){
'use strict';

if(!window.HTMLDialogElement||window.__gravitasDomDialogCompat)return;
window.__gravitasDomDialogCompat=true;

var proto=window.HTMLDialogElement.prototype;
var nativeShowModal=proto.showModal;
var nativeClose=proto.close;
var stack=[];
var zBase=100000;
var seq=0;

function ensureStyle(){
  if(document.getElementById('gravitas-dom-dialog-style'))return;
  var style=document.createElement('style');
  style.id='gravitas-dom-dialog-style';
  style.textContent=[
    'html.g-dom-modal-open,body.g-dom-modal-open{overflow:hidden!important}',
    '.g-dom-dialog-backdrop{position:fixed;inset:0;background:rgba(7,13,19,.58);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}',
    'dialog[data-g-dom-modal][open]{position:fixed!important;inset:0!important;margin:auto!important;z-index:100001;max-width:calc(100vw - 18px);max-height:calc(100dvh - 18px)}'
  ].join('');
  document.head.appendChild(style);
}

function indexOfDialog(dialog){
  for(var i=0;i<stack.length;i++)if(stack[i].dialog===dialog)return i;
  return -1;
}

function syncBodyLock(){
  var open=stack.some(function(entry){return entry.dialog&&entry.dialog.hasAttribute('open')});
  document.documentElement.classList.toggle('g-dom-modal-open',open);
  document.body.classList.toggle('g-dom-modal-open',open);
}

function cleanup(dialog){
  var index=indexOfDialog(dialog);
  if(index<0)return;
  var entry=stack[index];
  stack.splice(index,1);
  if(entry.backdrop&&entry.backdrop.parentNode)entry.backdrop.remove();
  dialog.removeAttribute('data-g-dom-modal');
  dialog.style.removeProperty('z-index');
  syncBodyLock();
  if(entry.focus&&document.contains(entry.focus)){
    try{entry.focus.focus({preventScroll:true})}catch(e){try{entry.focus.focus()}catch(ignore){}}
  }
}

function relayer(){
  stack.forEach(function(entry,index){
    var backdropZ=zBase+index*2;
    entry.backdrop.style.zIndex=String(backdropZ);
    entry.dialog.style.zIndex=String(backdropZ+1);
  });
}

function mount(dialog){
  ensureStyle();
  if(indexOfDialog(dialog)>=0)return;
  if(!dialog.isConnected)throw new DOMException('Dialog must be connected before showModal().','InvalidStateError');
  var backdrop=document.createElement('div');
  backdrop.className='g-dom-dialog-backdrop';
  backdrop.dataset.dialogCompat=String(++seq);
  backdrop.setAttribute('aria-hidden','true');
  document.body.appendChild(backdrop);
  var entry={dialog:dialog,backdrop:backdrop,focus:document.activeElement};
  stack.push(entry);
  dialog.setAttribute('data-g-dom-modal','1');
  dialog.setAttribute('open','');
  relayer();
  syncBodyLock();

  backdrop.addEventListener('click',function(){
    if(!dialog.hasAttribute('open'))return;
    try{dialog.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))}catch(e){}
  });

  dialog.addEventListener('close',function onClose(){
    dialog.removeEventListener('close',onClose);
    cleanup(dialog);
  });
}

proto.showModal=function(){
  if(this.hasAttribute('open'))return;
  mount(this);
};

proto.close=function(returnValue){
  if(returnValue!==undefined){
    try{this.returnValue=String(returnValue)}catch(e){}
  }
  if(!this.hasAttribute('open')){
    cleanup(this);
    return;
  }
  try{
    nativeClose.call(this,returnValue);
  }catch(e){
    this.removeAttribute('open');
    try{this.dispatchEvent(new Event('close'))}catch(ignore){}
  }
  if(indexOfDialog(this)>=0&&!this.hasAttribute('open'))cleanup(this);
};

window.addEventListener('keydown',function(event){
  if(event.key!=='Escape'||!stack.length)return;
  var entry=stack[stack.length-1];
  var dialog=entry&&entry.dialog;
  if(!dialog||!dialog.hasAttribute('open'))return;
  var cancel;
  try{cancel=new Event('cancel',{cancelable:true})}catch(e){cancel=document.createEvent('Event');cancel.initEvent('cancel',false,true)}
  if(!dialog.dispatchEvent(cancel))return;
  event.preventDefault();
  event.stopPropagation();
  dialog.close();
},true);

window.__gravitasNativeShowModal=nativeShowModal;
})();
