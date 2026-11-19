import { GROUPS, FIELDS, PRIORITY_KEYS } from './prelaunch-feedback-schema.js?v=20261119-v2';

const form = document.getElementById('prelaunch-form');
const host = document.getElementById('fb-question-groups');
const submit = document.getElementById('fb-submit-button');
const status = document.getElementById('fb-status');
const progress = document.getElementById('fb-count');
let savedAnswers = {};

function el(tag, klass, text) {
  const node = document.createElement(tag);
  if (klass) node.className = klass;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fieldValue(key) {
  const control = form.elements.namedItem(key);
  if (!control) return '';
  if (control instanceof RadioNodeList) return control.value || '';
  if (control.type === 'radio') return control.checked ? control.value : '';
  return control.value || '';
}
function fieldControl(field) {
  const wrap = el('div', 'fb-question');
  wrap.dataset.question = field.key;
  if (field.gate) wrap.dataset.gate = field.gate;
  const title = el('div', 'fb-question__title');
  if (field.number) title.append(el('span', 'fb-question__id', String(field.number).padStart(2,'0')));
  if (field.star) {
    const badge = el('span', 'fb-priority', '★');
    badge.setAttribute('aria-label', 'Priority question');
    title.append(badge);
  }
  const heading = el('span', 'fb-question__label', field.label);
  title.append(heading, el('span', 'fb-question__optional', 'Optional'));
  wrap.append(title);
  if (field.hint) wrap.append(el('p', 'fb-question__hint', field.hint));
  const name = field.key;
  const isScale = field.type === 'score5' || field.type === 'score10';
  const isRadio = isScale || field.type === 'yesno' || field.type === 'select' || field.type === 'persona';
  if (isRadio) {
    const options = isScale
      ? Array.from({length:field.type==='score10'?11:5},(_,i)=>[String(i+(field.type==='score10'?0:1)),String(i+(field.type==='score10'?0:1))])
      : field.type === 'yesno' ? [['yes','Yes'],['no','No']] : field.options;
    const group = el('div', field.type==='persona' ? 'fb-personas' : (isScale ? 'fb-score-grid '+(field.type==='score10'?'fb-score-grid--eleven':'fb-score-grid--five') : 'fb-choices'));
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', field.label);
    for (const option of options) {
      const label = el('label', field.type==='persona'?'fb-persona':(isScale?'fb-choice':'fb-option'));
      const input = document.createElement('input');
      input.type = 'radio'; input.name = name; input.value = option[0];
      const face = el('span', field.type==='persona'?'fb-persona__content':'', option[1]);
      if (field.type==='persona' && option[2]) {
        const strong=el('strong',null,option[1]);
        face.replaceChildren(strong,el('small',null,option[2]));
      }
      label.append(input,face); group.append(label);
    }
    wrap.append(group);
    if (isScale) {
      const extremes=el('div','fb-scale-ends');
      extremes.append(el('span',null,field.low),el('span',null,field.high));
      wrap.append(extremes);
    }
    const clear=el('button','fb-clear','Clear answer');
    clear.type='button'; clear.dataset.clearRadio=name;
    wrap.append(clear);
  } else {
    const input=field.type==='text'?document.createElement('textarea'):document.createElement('input');
    input.name=name; input.id='fb-field-'+name;
    input.className='g-input fb-input';
    if(field.type==='text') { input.rows=3; input.maxLength=field.max||2000; input.placeholder='Your thoughts…'; }
    else { input.type=field.type==='email'?'email':'text';input.maxLength=field.max||2000;input.placeholder=field.type==='email'?'name@example.com':'You can leave this blank'; }
    heading.setAttribute('role','presentation');
    const label=document.createElement('label');
    label.className='fb-question__input-label';label.htmlFor=input.id;
    label.textContent='Your answer';
    wrap.append(label,input);
  }
  return wrap;
}
function build() {
  GROUPS.forEach(group => {
    const section=el('section','fb-panel fb-group');
    section.dataset.section=group.id;
    section.setAttribute('aria-labelledby','fb-group-'+group.id);
    const head=el('div','fb-panel__head');
    const number=el('span','fb-number',group.letter);
    const info=el('div');
    info.append(el('p','fb-kicker',group.letter+' / '+group.title.toUpperCase()));
    const heading=el('h2',null,group.title);
    heading.id='fb-group-'+group.id;
    info.append(heading,el('p',null,group.note));
    head.append(number,info);section.append(head);
    const primary=el('div','fb-questions');
    const moreQuestions=group.fields.filter(field=>field.extra);
    for (const field of group.fields.filter(field=>!field.extra)) primary.append(fieldControl(field));
    section.append(primary);
    if(moreQuestions.length) {
      const details=document.createElement('details');
      details.className='fb-more';
      details.dataset.more=group.id;
      const summary=document.createElement('summary');
      summary.textContent='Add more detail ('+moreQuestions.length+' optional '+(moreQuestions.length===1?'question':'questions')+')';
      details.append(summary);
      const extra=el('div','fb-questions fb-questions--extra');
      moreQuestions.forEach(field=>extra.append(fieldControl(field)));
      details.append(extra);section.append(details);
    }
    host.append(section);
  });
  form.querySelectorAll('[data-clear-radio]').forEach(clear=>{
    clear.addEventListener('click',()=>{
      form.querySelectorAll('input[name="'+clear.dataset.clearRadio+'"]').forEach(input=>{input.checked=false;});
      syncState();
    });
  });
  form.addEventListener('input',syncState);
  form.addEventListener('change',syncState);
}
function gateSatisfied(field) {
  if(!field.gate)return true;
  const idx=field.gate.indexOf(':');
  const depends=field.gate.slice(0,idx);
  const allowed=field.gate.slice(idx+1).split(',');
  return allowed.includes(fieldValue(depends));
}
function syncState() {
  for (const field of FIELDS) {
    const question=form.querySelector('[data-question="'+field.key+'"]');
    if(!question)continue;
    question.hidden=!gateSatisfied(field);
    // Hidden controls cannot accidentally submit data or receive focus.
    question.querySelectorAll('input,textarea,select').forEach(input=>{
      input.disabled=question.hidden;
    });
  }
  // Selecting Other shows the follow-up field instead of burying it.
  if(fieldValue('persona')==='other') {
    const extra=form.querySelector('[data-more="about"]');
    if(extra)extra.open=true;
  }
  const available=FIELDS.filter(field=>field.star&&gateSatisfied(field));
  const completed=available.filter(field=>fieldValue(field.key)!=='').length;
  progress.textContent=completed+' of '+available.length+' priority questions answered';
}
function display(text,state) {
  status.textContent=text||'';
  if(state)status.dataset.state=state;else status.removeAttribute('data-state');
}
function populate(submission) {
  if(!submission)return;
  savedAnswers={...(submission.answers||{})};
  for(const field of FIELDS) {
    const value=field.key==='name'?submission.name:savedAnswers[field.key];
    if(value===null||value===undefined||value==='')continue;
    if(['score5','score10','persona','yesno','select'].includes(field.type)) {
      const options=form.querySelectorAll('input[name="'+field.key+'"]');
      Array.from(options).forEach(option=>{option.checked=option.value===String(value);});
    } else {
      const control=form.elements.namedItem(field.key);
      if(control)control.value=String(value);
    }
    if(field.extra) {
      const details=form.querySelector('[data-question="'+field.key+'"]')?.closest('details');
      if(details)details.open=true;
    }
  }
  syncState();
  submit.firstChild.textContent='Update feedback ';
  display('Your earlier feedback is loaded. You can revise your answers. Responses from the previous version are preserved.');
}
function gather() {
  // Preserve answers collected through the first-generation form, without
  // silently overwriting them when a returning visitor edits new questions.
  const answers={...savedAnswers};
  FIELDS.forEach(field=>{delete answers[field.key];});
  for(const field of FIELDS) {
    if(field.key==='name'||!gateSatisfied(field))continue;
    const value=String(fieldValue(field.key)).trim();
    if(!value)continue;
    if(field.type==='score5'||field.type==='score10')answers[field.key]=Number(value);
    else answers[field.key]=value;
  }
  // Earlier visitors may have written video feedback before the watch gate
  // existed. Editing the expanded form must not erase that earlier answer.
  if(!fieldValue('video_watched') && savedAnswers.video_feedback && !answers.video_feedback) {
    answers.video_feedback=savedAnswers.video_feedback;
  }
  return {name:String(fieldValue('name')).trim(),answers,website:form.elements.namedItem('website').value};
}
function cookie(name) {
  const row=document.cookie.split('; ').find(x=>x.startsWith(name+'='));
  return row?decodeURIComponent(row.slice(name.length+1)):'';
}
async function csrf() {
  const response=await fetch('/api/auth/csrf/',{
    credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
  });
  if(!response.ok)throw new Error('Could not prepare a secure save. Please retry.');
  const token=cookie('csrftoken')||cookie('gravitas_staging_csrftoken');
  if(!token)throw new Error('Please enable cookies so the feedback can be saved securely.');
  return token;
}
async function load() {
  try {
    const response=await fetch('/api/prelaunch/feedback/',{
      credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
    });
    if(!response.ok)return;
    const data=await response.json();
    if(data.submission)populate(data.submission);
  }catch(_error){/* The form can still be filled without the initial read. */}
}
build();syncState();
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(submit.disabled)return;
  const email=form.elements.namedItem('contact_email');
  if(email.value.trim()&&!email.checkValidity()) {
    const parent=email.closest('details');
    if(parent)parent.open=true;
    display('Please enter a valid follow-up email or leave the field blank.','error');
    email.focus();return;
  }
  submit.disabled=true;display('Saving your feedback…');
  try {
    const token=await csrf();
    const payload=gather();
    const response=await fetch('/api/prelaunch/feedback/',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json','Content-Type':'application/json','X-CSRFToken':token},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error('The server could not confirm your submission.');
    savedAnswers={...data.submission.answers};
    submit.firstChild.textContent='Update feedback ';
    display('Thank you! Your feedback has been saved. You can edit it in this browser.','success');
  }catch(error){
    display((error?.message||'Could not save feedback.')+' Refresh to check the status before submitting again.','error');
  }finally{submit.disabled=false;}
});
load();
