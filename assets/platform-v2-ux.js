(function(){
'use strict';

var mainDialog=document.getElementById('ws-dialog');
var mainForm=document.getElementById('ws-form');
var mainTitle=document.getElementById('ws-dialog-title');
var alertBox=document.getElementById('ws-alert');
var account=document.querySelector('.ws-account');
var lastTrigger=null;
var pendingContentEditId=null;

function notify(text,bad){
  if(!alertBox)return;
  alertBox.hidden=false;
  alertBox.textContent=text;
  alertBox.style.borderLeftColor=bad?'var(--ws-danger)':'var(--ws-accent)';
  clearTimeout(notify.timer);
  notify.timer=setTimeout(function(){alertBox.hidden=true;},4500);
}

function visibleDialog(){
  return Array.from(document.querySelectorAll('dialog.ws-dialog')).find(function(d){return d.open;})||null;
}

function syncBodyLock(){
  document.body.classList.toggle('v2-modal-open',!!visibleDialog());
}

function closeDialog(dialog){
  if(dialog&&dialog.open)dialog.close();
}

function focusFirstField(dialog){
  if(!dialog||!dialog.open)return;
  var target=dialog.querySelector('input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled])');
  if(!target)target=dialog.querySelector('button:not([disabled]),a[href]');
  if(target){
    try{target.focus({preventScroll:true});}catch(e){target.focus();}
  }
}

function setupDialog(dialog){
  if(!dialog||dialog.dataset.uxReady==='1')return;
  dialog.dataset.uxReady='1';

  dialog.addEventListener('click',function(e){
    if(e.target!==dialog)return;
    var r=dialog.getBoundingClientRect();
    var inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
    if(!inside)closeDialog(dialog);
  },true);

  dialog.addEventListener('cancel',function(e){
    e.preventDefault();
    closeDialog(dialog);
  });

  dialog.addEventListener('close',function(){
    syncBodyLock();
    if(dialog===mainDialog)resetMainDialogState();
    if(lastTrigger&&lastTrigger.isConnected){
      try{lastTrigger.focus({preventScroll:true});}catch(e){lastTrigger.focus();}
    }
    lastTrigger=null;
  });

  new MutationObserver(function(){
    if(dialog.open){
      syncBodyLock();
      requestAnimationFrame(function(){focusFirstField(dialog);});
    }else{
      syncBodyLock();
    }
  }).observe(dialog,{attributes:true,attributeFilter:['open']});
}

function resetMainDialogState(){
  if(!mainForm)return;
  mainForm.removeAttribute('aria-busy');
  delete mainForm.dataset.shareType;
  delete mainForm.dataset.shareId;
  var submit=mainForm.querySelector('[type="submit"]');
  var cancel=mainForm.querySelector('.ws-dialog__actions [data-close]');
  if(submit){
    submit.hidden=false;
    submit.disabled=false;
    submit.textContent=submit.dataset.idleLabel||'Save';
    delete submit.dataset.idleLabel;
  }
  if(cancel)cancel.textContent='Cancel';
}

function dialogLabel(title){
  if(/^Edit /.test(title))return 'Save changes';
  if(title==='New research project')return 'Create project';
  if(title==='New content')return 'Create content';
  if(title==='Request scientific research')return 'Create research request';
  if(title==='New note')return 'Save note';
  if(/^Upload /.test(title))return 'Upload';
  if(title==='New deliverable')return 'Add deliverable';
  if(title==='New mind map')return 'Create map';
  if(title==='Add mind-map node')return 'Add node';
  if(title==='Connect nodes')return 'Connect';
  if(title==='My researcher profile')return 'Save profile';
  if(title==='Apply to research project')return 'Submit application';
  return 'Save';
}

function addFieldHelp(element,text,kind){
  if(!element)return null;
  var wrap=element.closest('.ws-field');
  if(!wrap)return null;
  var cls=kind==='warning'?'v2-form-warning':'v2-field-help';
  var note=wrap.querySelector('.'+cls);
  if(!note){
    note=document.createElement('small');
    note.className=cls;
    wrap.appendChild(note);
  }
  note.textContent=text||'';
  note.hidden=!text;
  return note;
}

function syncProjectSecurity(){
  if(!mainDialog||!mainDialog.open||!mainForm||!mainTitle)return;
  var title=mainTitle.textContent.trim();
  if(title!=='New research project'&&title!=='Edit research project')return;
  var secure=mainForm.elements.secure_data_room;
  var links=mainForm.elements.allow_public_links;
  var visibility=mainForm.elements.visibility;
  if(!secure||!links)return;

  if(secure.checked){
    links.checked=false;
    links.disabled=true;
    addFieldHelp(links,'Disabled while Secure Data Room is enabled. Share access with named people instead.');
  }else{
    links.disabled=false;
    addFieldHelp(links,'Only enable a public link when the project can safely be viewed outside its invited team.');
  }

  var risky=secure.checked&&visibility&&(visibility.value==='public'||visibility.value==='community');
  addFieldHelp(secure,risky?'This project is marked as a Secure Data Room but its project visibility is public/community. Use Private or Invite only for sensitive projects.':'','warning');
}

function hydrateContentEdit(id){
  if(!id)return;
  fetch('/api/platform/content/'+encodeURIComponent(id)+'/',{credentials:'same-origin',headers:{Accept:'application/json'}})
    .then(function(r){if(!r.ok)throw new Error('Could not load the current content settings.');return r.json();})
    .then(function(d){
      if(!mainDialog||!mainDialog.open||!mainTitle||mainTitle.textContent.trim()!=='Edit content')return;
      if(mainForm.elements.kind)mainForm.elements.kind.value=d.item.kind||'video';
      if(mainForm.elements.status)mainForm.elements.status.value=d.item.status||'idea';
    })
    .catch(function(err){notify(err.message,true);});
}

function configureMainDialog(){
  if(!mainDialog||!mainDialog.open||!mainForm||!mainTitle)return;
  var title=mainTitle.textContent.trim();
  var submit=mainForm.querySelector('[type="submit"]');
  var cancel=mainForm.querySelector('.ws-dialog__actions [data-close]');
  if(submit){
    submit.hidden=title==='Share & access';
    submit.textContent=dialogLabel(title);
  }
  if(cancel)cancel.textContent=title==='Share & access'?'Done':'Cancel';
  if(title==='Share & access')mainForm.removeAttribute('aria-busy');
  if(title==='Edit content'&&pendingContentEditId)hydrateContentEdit(pendingContentEditId);
  syncProjectSecurity();
}

/* Fix the V2 close bug at capture phase. platform-v2.js checks dataset.close as
 * a truthy value, but the markup uses the boolean data-close attribute whose
 * dataset value is an empty string. */
document.addEventListener('click',function(e){
  var close=e.target.closest('#ws-dialog [data-close]');
  if(close){
    e.preventDefault();
    e.stopImmediatePropagation();
    closeDialog(mainDialog);
    return;
  }

  var opener=e.target.closest('[data-v2-action],[data-content-edit],[data-content-research],[data-share-resource],[data-share-mindmap],[data-task-share],[data-shared-task-open],[data-apply-project]');
  if(opener){
    lastTrigger=opener;
    if(opener.dataset.contentEdit)pendingContentEditId=opener.dataset.contentEdit;
  }
},true);

if(mainForm){
  /* Enter in Share should grant the typed email, never silently close the modal. */
  mainForm.addEventListener('submit',function(e){
    var title=mainTitle?mainTitle.textContent.trim():'';
    if(title==='Share & access'){
      e.preventDefault();
      e.stopImmediatePropagation();
      var email=mainForm.elements.share_email;
      var grant=mainForm.querySelector('[data-share-grant]');
      if(email&&email.value.trim()&&grant){grant.click();}
      else notify('Enter an email to grant access, or use Create link.',true);
      return;
    }
    var submit=mainForm.querySelector('[type="submit"]');
    if(submit&&!submit.disabled){
      submit.dataset.idleLabel=submit.textContent;
      submit.textContent='Saving…';
      mainForm.setAttribute('aria-busy','true');
    }
  },true);

  var submitButton=mainForm.querySelector('[type="submit"]');
  if(submitButton){
    new MutationObserver(function(){
      if(!submitButton.disabled&&submitButton.dataset.idleLabel&&mainDialog&&mainDialog.open){
        submitButton.textContent=submitButton.dataset.idleLabel;
        delete submitButton.dataset.idleLabel;
        mainForm.removeAttribute('aria-busy');
      }
    }).observe(submitButton,{attributes:true,attributeFilter:['disabled']});
  }

  mainForm.addEventListener('change',function(e){
    if(e.target.name==='secure_data_room'||e.target.name==='allow_public_links'||e.target.name==='visibility')syncProjectSecurity();
  });
}

if(mainDialog){
  setupDialog(mainDialog);
  new MutationObserver(function(){
    if(mainDialog.open){
      requestAnimationFrame(configureMainDialog);
      setTimeout(configureMainDialog,80);
    }
  }).observe(mainDialog,{attributes:true,attributeFilter:['open']});
}

/* The task-share dialog is injected by platform-v2-patches.js. */
Array.from(document.querySelectorAll('dialog.ws-dialog')).forEach(setupDialog);
new MutationObserver(function(){
  Array.from(document.querySelectorAll('dialog.ws-dialog')).forEach(setupDialog);
}).observe(document.body,{childList:true});

/* Account menu behaves like a normal popover: outside click and Escape close it. */
document.addEventListener('click',function(e){
  if(account&&account.open&&!account.contains(e.target))account.open=false;
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(account&&account.open)account.open=false;
});

/* Browser back/forward should never leave a stale modal over a different route. */
window.addEventListener('popstate',function(){
  Array.from(document.querySelectorAll('dialog.ws-dialog[open]')).forEach(closeDialog);
});

/* Keep form affordances synced when the dialog body is replaced. */
if(mainTitle){
  new MutationObserver(function(){if(mainDialog&&mainDialog.open)configureMainDialog();}).observe(mainTitle,{childList:true,characterData:true,subtree:true});
}

syncBodyLock();
})();
