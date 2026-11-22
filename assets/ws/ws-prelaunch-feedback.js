/* Expanded prelaunch survey analytics, preserving historical answers. */
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';
import * as K from './ws-admin-kit.js?v=20261016-task1';
import { GROUPS, FIELDS, LEGACY_LABELS } from '../prelaunch-feedback-schema.js?v=20261122-sequential2';

const el=K.el;
const endpoint='/platform/admin/prelaunch-feedback/';
const personaLabels={
  a1:'Curious Explorer',a2:'Early-Career Researcher',
  a3:'Working Scientist',other:'Other',unspecified:'Unspecified'
};
const oldSections=[['video','Video'],['essay','Essay'],['sources','Sources'],['viewpoints','Viewpoints'],['pulsar','Pulsar'],['forum','Forum']];
function date(value){
  return value?new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'—';
}
function mean(value){return typeof value==='number'?value.toFixed(1):'—';}
function displayAnswer(field,value){
  if(value===undefined||value===null||value==='')return '';
  if(field.type==='score5')return String(value)+' / 5';
  if(field.type==='score10')return String(value)+' / 10';
  const option=field.options?.find(option=>option[0]===value);
  if(option)return option[1];
  if(field.type==='yesno')return value==='yes'?'Yes':value==='no'?'No':String(value);
  return String(value);
}
function row(label,value){
  const result=el('div','gq-feedback__detail-row');
  result.append(el('span','gq-feedback__detail-label',label),el('p','gq-feedback__detail-value',value));
  return result;
}
function responseCard(item){
  const details=document.createElement('details');
  details.className='gq-feedback__response';
  const summary=document.createElement('summary');
  const answers=item.answers||{};
  const persona=personaLabels[answers.persona]||personaLabels.unspecified;
  summary.append(
    el('span','gq-feedback__response-name',item.name||'Anonymous'),
    el('span','gq-feedback__response-facts',persona+' · '+date(item.created_at))
  );
  details.append(summary);
  const body=el('div','gq-feedback__response-body');
  let numberOfAnswers=0;
  for(const group of GROUPS){
    const answered=group.fields.filter(field=>{
      const value=field.key==='name'?item.name:answers[field.key];
      return value!==null&&value!==undefined&&value!=='';
    });
    if(!answered.length)continue;
    body.append(el('h3','gq-feedback__group-name',group.letter+' · '+group.title));
    answered.forEach(field=>{
      const value=field.key==='name'?item.name:answers[field.key];
      body.append(row(field.label,displayAnswer(field,value)));
      numberOfAnswers+=1;
    });
  }
  const old=LEGACY_LABELS.filter(([key])=>answers[key]!==undefined);
  if(old.length){
    body.append(el('h3','gq-feedback__group-name','Previous survey responses'));
    for(const [key,label] of old){
      if(key==='section_ratings'){
        const scores=answers.section_ratings||{};
        for(const [id,title] of oldSections){
          if(scores[id]!==undefined)body.append(row(title,String(scores[id])+' / 10'));
        }
      }else{
        body.append(row(label,String(answers[key])+ (key==='overall_rating'?' / 10':' / 5')));
      }
    }
  }
  if(!numberOfAnswers&&!old.length)body.append(el('p','gq-feedback__detail-value','No questions answered.'));
  details.append(body);
  return details;
}

export async function renderAdminPrelaunchFeedback(host){
  let page=1,persona='';
  const wrap=K.page(host,{
    title:'Prelaunch Feedback',
    meta:'Anonymous or named feedback from the public survey. All fields are voluntary.',
    actions:[
      K.anchor('Open public form','/prelaunch-feedback.html',{external:true}),
      K.anchor('Export all answers (CSV)','/api/platform/admin/prelaunch-feedback/?format=csv',{external:false})
    ]
  });
  const stats=el('div','gq-feedback__stats');
  const intro=K.card({title:'Respondents',span:12,note:'Overall count and self-selected respondent personas.'});
  const section=K.card({title:'Priority question averages',span:12,note:'Only answered ratings contribute to the average. The 0–10 recommendation scale is kept separate from 1–5 scores.'});
  const responses=K.card({title:'Individual responses',span:12,note:'Open any response to read the completed answers grouped by survey section.'});
  const toolbar=el('div','gq-feedback__toolbar');
  const select=K.select([
    ['','All personas'],['a1','Curious Explorer'],['a2','Early-Career Researcher'],
    ['a3','Working Scientist'],['other','Other'],['unspecified','Unspecified']
  ],persona);
  select.setAttribute('aria-label','Filter by persona');
  const state=K.status();toolbar.append(select,state);
  const list=el('div','gq-feedback__response-list');
  const pager=el('div','gq-feedback__pager');
  const previous=K.button('Previous',()=>{page=Math.max(1,page-1);refresh();});
  const next=K.button('Next',()=>{page+=1;refresh();});
  const counter=el('span','gq-feedback__count');
  pager.append(previous,counter,next);
  responses.body.append(toolbar,list,pager);
  wrap.append(stats,K.bento([intro.box,section.box,responses.box]));
  select.addEventListener('change',()=>{persona=select.value;page=1;refresh();});

  async function refresh(){
    K.setStatus(state,'Loading responses…');
    try{
      const params=new URLSearchParams({page:String(page)});
      if(persona)params.set('persona',persona);
      const data=await P.call(endpoint+'?'+params.toString());
      K.setStatus(state,'');
      const avg=data.averages||{};
      const n=data.metric_counts||{};
      stats.replaceChildren(
        K.tile({value:data.total||0,label:'Total submissions',icon:'team',featured:true}),
        K.tile({value:mean(avg.site_works),label:'Site works / 5',icon:'activity',note:String(n.site_works||0)+' ratings'}),
        K.tile({value:mean(avg.return_likelihood),label:'Return intent / 5',icon:'overview',note:String(n.return_likelihood||0)+' ratings'}),
        K.tile({value:mean(avg.recommend_likelihood),label:'Recommend / 10',icon:'topic',note:String(n.recommend_likelihood||0)+' ratings'})
      );
      const counts=el('div','gq-feedback__chips');
      for(const key of ['a1','a2','a3','other','unspecified']){
        counts.append(el('span','gq-feedback__chip',personaLabels[key]+': '+(data.persona_counts?.[key]||0)));
      }
      intro.body.replaceChildren(counts);
      const scoreGrid=el('div','gq-feedback__sections');
      for(const field of FIELDS.filter(f=>f.star&&(f.type==='score5'||f.type==='score10'))){
        const card=el('div','gq-feedback__section');
        const label=el('span',null,field.label);
        const values=el('strong',null,mean(avg[field.key])+' / '+(field.type==='score10'?'10':'5')+'  ('+(n[field.key]||0)+')');
        card.append(label,values);scoreGrid.append(card);
      }
      section.body.replaceChildren(scoreGrid);
      list.replaceChildren();
      if(!data.responses?.length)list.append(K.empty('No responses match this filter yet.'));
      else data.responses.forEach(item=>list.append(responseCard(item)));
      counter.textContent='Page '+page+' · '+(data.filtered_total||0)+' response(s)';
      previous.disabled=page<=1;
      next.disabled=page*(data.per_page||50)>=(data.filtered_total||0);
    }catch(error){
      K.setStatus(state,error?.message||'Responses could not be loaded.','bad');
      list.replaceChildren(K.empty('Could not load feedback.',[K.button('Retry',refresh)]));
    }
  }
  await refresh();
}
