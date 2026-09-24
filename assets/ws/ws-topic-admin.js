import * as P from './ws-platform.js?v=20260918-topic1';

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const input=(value='',type='text',placeholder='')=>{const n=el('input','ws-input');n.type=type;n.value=value||'';if(placeholder)n.placeholder=placeholder;return n;};
const textarea=(value='',rows=4,placeholder='')=>{const n=el('textarea','ws-textarea');n.rows=rows;n.value=value||'';if(placeholder)n.placeholder=placeholder;return n;};
const select=(rows,value='')=>{const n=el('select','ws-select');rows.forEach(([v,t])=>{const o=el('option',null,t);o.value=v;o.selected=v===value;n.append(o);});return n;};
const field=(label,node,note='')=>{const w=el('label','fl-field');w.append(el('span','fl-label',label),node);if(note)w.append(el('small','fl-muted',note));return w;};
const button=(text,solid=false)=>{const n=el('button',solid?'ws-btn ws-btn--solid':'ws-btn',text);n.type='button';return n;};
const line=()=>el('p','fl-status');
const setLine=(n,text,tone='')=>{n.textContent=text;n.dataset.tone=tone;};
const slugify=(value)=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');

function injectStyle(){
  if(document.getElementById('topic-admin-style'))return;
  const s=el('style');s.id='topic-admin-style';s.textContent=
    '.topic-admin{display:grid;gap:1rem}.topic-admin__head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}.topic-admin__section{border:1px solid var(--ws-line,rgba(0,0,0,.14));border-radius:14px;padding:1rem;display:grid;gap:.85rem}.topic-admin__section h2{margin:0}.topic-admin__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.topic-admin__row{border:1px solid var(--ws-line,rgba(0,0,0,.12));border-radius:12px;padding:.8rem;display:grid;gap:.65rem}.topic-admin__row-head{display:flex;justify-content:space-between;gap:.5rem;align-items:center}.topic-admin__actions{display:flex;gap:.45rem;flex-wrap:wrap}.topic-admin__danger{border-color:#b42318!important;color:#b42318!important}.topic-admin__rte{border:1px solid var(--ws-line,rgba(0,0,0,.14));border-radius:12px;overflow:hidden}.topic-admin__rtebar{display:flex;gap:.25rem;flex-wrap:wrap;padding:.45rem;border-bottom:1px solid var(--ws-line,rgba(0,0,0,.12));background:rgba(127,127,127,.05)}.topic-admin__rtebar button{min-width:2rem;padding:.35rem .5rem;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.topic-admin__rtebar button:hover{background:rgba(127,127,127,.12)}.topic-admin__rtebody{min-height:220px;padding:1rem;outline:none;line-height:1.65}.topic-admin__rtebody h2,.topic-admin__rtebody h3{margin:.8rem 0 .35rem}.topic-admin__result{display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--ws-line,rgba(0,0,0,.08))}.topic-admin__upload{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.topic-admin__code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-height:260px}.topic-admin__list{display:grid;gap:.65rem}@media(max-width:780px){.topic-admin__grid{grid-template-columns:1fr}}';
  document.head.append(s);
}

function shell(host,title,subtitle=''){
  host.innerHTML='';
  const wrap=el('div','ws-doc ws-doc--wide fl-doc topic-admin');
  const head=el('header','ws-doc__head fl-head topic-admin__head');
  const copy=el('div');copy.append(el('span','fl-eyebrow','CORE / TOPIC ADMIN'),el('h1','ws-doc__title',title));
  if(subtitle)copy.append(el('p','ws-doc__meta',subtitle));
  head.append(copy);wrap.append(head);host.append(wrap);return {wrap,head};
}

function makePanel(title,note=''){
  const s=el('section','topic-admin__section wc-card');
  s.append(el('h2',null,title));
  if(note)s.append(el('p','fl-muted',note));
  const body=el('div','topic-admin__list');s.append(body);return {section:s,body};
}

function cookie(name){
  const hit=document.cookie.split('; ').find(row=>row.startsWith(name+'='));
  return hit?decodeURIComponent(hit.slice(name.length+1)):'';
}
async function uploadMedia(file){
  if(!file)throw new Error('Choose a file first.');
  await fetch('/api/auth/csrf/',{credentials:'same-origin',cache:'no-store'});
  const token=cookie('csrftoken')||cookie('gravitas_staging_csrftoken');
  const body=new FormData();body.append('file',file);
  const res=await fetch('/api/platform/admin/site/media/',{
    method:'POST',credentials:'same-origin',headers:{'Accept':'application/json','X-CSRFToken':token},body
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||('Upload failed ('+res.status+')'));
  return data;
}

function mediaField(labelText,current='',accept='image/*'){
  const wrap=el('div','topic-admin__upload');
  const url=input(current,'url','https://… or upload a file');
  const file=input('','file');file.accept=accept;
  const upload=button('Upload');
  const note=el('small','fl-muted');
  upload.addEventListener('click',async()=>{
    upload.disabled=true;note.textContent='Uploading…';
    try{const data=await uploadMedia(file.files&&file.files[0]);url.value=data.url;note.textContent='Uploaded.';}
    catch(error){note.textContent=error.message||'Upload failed.';}
    finally{upload.disabled=false;}
  });
  const holder=el('div');holder.append(field(labelText,url),wrap,note);wrap.append(file,upload);
  return {holder,url};
}

function richEditor(labelText,html=''){
  const outer=el('div');
  outer.append(el('span','fl-label',labelText));
  const box=el('div','topic-admin__rte');
  const bar=el('div','topic-admin__rtebar');
  const body=el('div','topic-admin__rtebody');
  body.contentEditable='true';body.innerHTML=html||'';
  const tools=[
    ['B','bold'],['I','italic'],['H2','formatBlock','h2'],['H3','formatBlock','h3'],
    ['• List','insertUnorderedList'],['1. List','insertOrderedList'],['Quote','formatBlock','blockquote']
  ];
  tools.forEach(([text,cmd,arg])=>{
    const b=el('button',null,text);b.type='button';b.addEventListener('mousedown',e=>e.preventDefault());
    b.addEventListener('click',()=>{body.focus();document.execCommand(cmd,false,arg||null);});bar.append(b);
  });
  const link=el('button',null,'Link');link.type='button';link.addEventListener('mousedown',e=>e.preventDefault());
  link.addEventListener('click',()=>{const href=window.prompt('Link URL');if(href){body.focus();document.execCommand('createLink',false,href);}});
  const clear=el('button',null,'Clear format');clear.type='button';clear.addEventListener('mousedown',e=>e.preventDefault());
  clear.addEventListener('click',()=>{body.focus();document.execCommand('removeFormat',false,null);});
  bar.append(link,clear);box.append(bar,body);outer.append(box);
  return {outer,value:()=>body.innerHTML.trim()};
}

function sourceRow(values={}){
  const row=el('div','topic-admin__row topic-source-row');
  const head=el('div','topic-admin__row-head');head.append(el('strong',null,'Source'));
  const remove=button('Remove');remove.classList.add('topic-admin__danger');remove.addEventListener('click',()=>row.remove());head.append(remove);
  const level=select([['start','Start here'],['further','Go further'],['primary','Primary']],values.level||'start');
  const label=input(values.label||'','','Source label / title');
  const url=input(values.url||'','url','https://…');
  const grid=el('div','topic-admin__grid');grid.append(field('Level',level),field('Label',label),field('URL',url));
  row.append(head,grid);return {row,level,label,url};
}

function timelineRow(values={}){
  const row=el('div','topic-admin__row topic-timeline-row');
  const head=el('div','topic-admin__row-head');head.append(el('strong',null,'Timeline node'));
  const actions=el('div','topic-admin__actions');
  const up=button('↑'),down=button('↓'),remove=button('Remove');remove.classList.add('topic-admin__danger');
  up.addEventListener('click',()=>{const p=row.previousElementSibling;if(p)row.parentNode.insertBefore(row,p);});
  down.addEventListener('click',()=>{const n=row.nextElementSibling;if(n)row.parentNode.insertBefore(n,row);});
  remove.addEventListener('click',()=>row.remove());actions.append(up,down,remove);head.append(actions);
  const date=input(values.date||'','','e.g. 1963'),title=input(values.title||'','','Node title'),description=textarea(values.description||'',3,'Short explanation');
  const image=mediaField('Image',values.image_url||'','image/*'),alt=input(values.image_alt||'','','Image alt text');
  const grid=el('div','topic-admin__grid');grid.append(field('Date',date),field('Title',title));
  row.append(head,grid,field('Description',description),image.holder,field('Image alt text',alt));
  return {row,date,title,description,imageUrl:image.url,alt};
}

function optionRow(values={}){
  const row=el('div','topic-admin__row topic-poll-option');
  const label=input(values.label||'','','Poll option');
  const id=input(values.id||slugify(values.label||'')||'option','','Stable option ID');
  const remove=button('Remove');remove.classList.add('topic-admin__danger');remove.addEventListener('click',()=>row.remove());
  const head=el('div','topic-admin__row-head');head.append(el('strong',null,'Poll option'),remove);
  const grid=el('div','topic-admin__grid');grid.append(field('Label',label),field('ID',id));
  label.addEventListener('input',()=>{if(!id.dataset.touched)id.value=slugify(label.value)||'option';});
  id.addEventListener('input',()=>{id.dataset.touched='1';});
  row.append(head,grid);return {row,label,id};
}

function collectRows(host,selector,mapper){
  return Array.from(host.querySelectorAll(selector)).map(mapper).filter(Boolean);
}

function normalizeObjects(data,pluralKey,singularKey){
  if(Array.isArray(data?.[pluralKey]))return data[pluralKey].filter(v=>v&&typeof v==='object');
  const single=data?.[singularKey];
  return single&&typeof single==='object'&&Object.keys(single).length?[single]:[];
}

function rowControls(row,label){
  const head=el('div','topic-admin__row-head');head.append(el('strong',null,label));
  const actions=el('div','topic-admin__actions');
  const up=button('↑'),down=button('↓'),remove=button('Remove');remove.classList.add('topic-admin__danger');
  up.addEventListener('click',()=>{const p=row.previousElementSibling;if(p)row.parentNode.insertBefore(row,p);});
  down.addEventListener('click',()=>{const n=row.nextElementSibling;if(n)row.parentNode.insertBefore(n,row);});
  remove.addEventListener('click',()=>row.remove());actions.append(up,down,remove);head.append(actions);
  return head;
}

function videoRow(values={}){
  const row=el('div','topic-admin__row topic-video-row');
  const title=input(values.title||'','','Optional video title');
  const sourceType=select([['none','Not published yet'],['youtube','YouTube'],['self_hosted','Self-hosted']],values.source_type||'none');
  const youtube=input(values.youtube_url||'','url','YouTube URL');
  const self=mediaField('Self-hosted video',values.self_hosted_url||'','video/*');
  const duration=input(values.duration||'','','e.g. 28 minutes');
  const description=textarea(values.description||'',4,'Video description');
  const info=input(values.info||'','','Additional information');
  const companionLabel=input(values.companion_label||'','','Companion label');
  const companionUrl=input(values.companion_url||'','url','Companion URL');
  const transcriptLabel=input(values.transcript_label||'','','Transcript label');
  const transcriptUrl=input(values.transcript_url||'','url','Transcript URL');
  const grid=el('div','topic-admin__grid');grid.append(
    field('Title',title),field('Source type',sourceType),field('YouTube URL',youtube),field('Runtime',duration),
    field('Info',info),field('Companion label',companionLabel),field('Companion URL',companionUrl),
    field('Transcript label',transcriptLabel),field('Transcript URL',transcriptUrl)
  );
  row.append(rowControls(row,'Video'),grid,self.holder,field('Description',description));
  row._topicFields={title,sourceType,youtube,selfUrl:self.url,duration,description,info,companionLabel,companionUrl,transcriptLabel,transcriptUrl};
  return row;
}

function essayRow(values={}){
  const row=el('div','topic-admin__row topic-essay-row');
  const title=input(values.title||'','','Optional essay title');
  const overview=richEditor('Overview',values.overview_html||'');
  const indepth=richEditor('In depth',values.indepth_html||'');
  const image=mediaField('Essay image',values.image_url||'','image/*');
  const alt=input(values.image_alt||'','','Image alt text');
  const asideTitle=input(values.aside_title||'Try It Yourself','','Aside title');
  const asideText=textarea(values.aside_text||'',3,'Aside text');
  row.append(rowControls(row,'Essay'),field('Title',title),overview.outer,indepth.outer,image.holder,field('Image alt text',alt),field('Aside title',asideTitle),field('Aside text',asideText));
  row._topicFields={title,overview,indepth,imageUrl:image.url,alt,asideTitle,asideText};
  return row;
}

function simulationRow(values={}){
  const row=el('div','topic-admin__row topic-simulation-row');
  const title=input(values.title||'The Simulation');
  const description=textarea(values.description||'',3,'Simulation introduction');
  const code=textarea(values.code||'',16,'Paste HTML/CSS/JavaScript or JavaScript code');code.classList.add('topic-admin__code');
  const codeFile=input('','file');codeFile.accept='.html,.htm,.js,.txt,.css';
  codeFile.addEventListener('change',async()=>{const file=codeFile.files&&codeFile.files[0];if(file)code.value=await file.text();});
  const grid=el('div','topic-admin__grid');grid.append(field('Section title',title),field('Upload code file',codeFile));
  row.append(rowControls(row,'Simulation'),grid,field('Description',description),field('Code',code,'Executed only inside the public sandboxed simulation frame.'));
  row._topicFields={title,description,code,builtin:values.builtin||'',native:values.native||'',type:values.type||'',enabled:values.enabled};
  return row;
}

function viewpointRow(values={}){
  const row=el('div','topic-admin__row topic-viewpoint-row');
  const label=input(values.label||'','','Viewpoint label');
  const text=textarea(values.text||'',6,'Viewpoint text');
  const cite=input(values.cite||'','','Citation / note');
  row.append(rowControls(row,'Viewpoint'),field('Label',label),field('Text',text),field('Citation',cite));
  row._topicFields={label,text,cite};
  return row;
}

let pollSequence=0;
function nextPollId(){
  pollSequence+=1;
  return 'poll-'+Date.now().toString(36)+'-'+pollSequence.toString(36);
}

function pollRow(values={},results=null){
  const row=el('div','topic-admin__row topic-poll-row');
  const id=input(values.id||nextPollId(),'','Stable poll ID');
  const question=input(values.question||values.poll_question||'Where do you land?','','Poll question');
  const note=input(values.note||values.poll_note||'','','Text below poll');
  const optionList=el('div','topic-admin__list topic-poll-options');
  const options=Array.isArray(values.options)?values.options:(Array.isArray(values.poll_options)?values.poll_options:[]);
  options.forEach(v=>optionList.append(optionRow(v).row));
  const addOption=button('Add poll option');addOption.addEventListener('click',()=>optionList.append(optionRow().row));
  row.append(rowControls(row,'Poll'),field('Poll ID',id),field('Question',question),field('Note',note),optionList,addOption);
  if(results){
    const box=el('div');box.append(el('h3',null,'Live results'));
    (results.options||[]).forEach(r=>{const x=el('div','topic-admin__result');x.append(el('span',null,r.label),el('strong',null,String(r.votes)+' votes'));box.append(x);});
    box.append(el('p','fl-muted','Total: '+String(results.total_votes||0)+' votes'));row.append(box);
  }
  row._topicFields={id,question,note,optionList};
  return row;
}

export async function renderAdminContent(host,{go}){
  injectStyle();
  const ui=shell(host,'Topics','Create, publish and manage the complete Topic experience from one place.');
  const newBtn=button('New Topic',true);newBtn.addEventListener('click',()=>go('/workspace/core/admin/content/new'));ui.head.append(newBtn);
  const list=makePanel('Topics','Landing page, Topics index and Topic pages all read from this same database.');
  ui.wrap.append(list.section);list.body.append(el('div','fl-skeleton'));
  try{
    const data=await P.adminSiteContent({kind:'topic'});
    const items=(data.items||[]).filter(item=>item.kind==='topic');
    list.body.innerHTML='';
    if(!items.length){list.body.append(el('p','fl-muted','No Topics yet. Create the first one.'));return;}
    items.forEach(item=>{
      const row=el('button','fl-row');row.type='button';
      const main=el('div','fl-row__main');main.append(el('strong',null,item.title),el('small','fl-muted',(item.status||'draft')+' · '+item.slug));
      const meta=el('span','v-badge fl-badge',item.status==='published'?'Published':'Draft');
      row.append(main,meta);row.addEventListener('click',()=>go('/workspace/core/admin/content/'+item.id));list.body.append(row);
    });
  }catch(error){list.body.innerHTML='';list.body.append(el('p','fl-muted','Topics could not be loaded: '+(error.message||'unknown error')));}
}

export async function renderAdminContentEditor(host,id,{go}){
  injectStyle();
  let current=null;
  if(id!=='new'){
    try{current=(await P.adminSiteContentItem(id)).item;}
    catch(error){const ui=shell(host,'Topic unavailable');ui.wrap.append(el('p','fl-muted',error.message||'Could not load Topic.'));return;}
  }
  const data=current&&current.topic_data&&typeof current.topic_data==='object'?current.topic_data:{};
  const ui=shell(host,current?current.title:'New Topic','English Topic content only for now. German and Persian translation controls are intentionally hidden.');
  const form=el('form','topic-admin');

  const basics=makePanel('Topic','The canonical record used by the main landing page, Topics index and Topic landing page.');
  const title=input(current?.title||'','','Question / Topic title');
  const slug=input(current?.slug||'','','topic-slug');
  const status=select([['draft','Draft'],['published','Published']],current?.status||'draft');
  const number=input(data.number||'','','e.g. 04');
  const summary=textarea(current?.summary||'',4,'Short summary used on cards and the main landing page');
  const heroLead=textarea(data.hero_lead||current?.summary||'',3,'Lead paragraph on the Topic page');
  const tags=input(Array.isArray(data.tags)?data.tags.join(', '):'','','Comma-separated tags');
  const grid=el('div','topic-admin__grid');grid.append(field('Title',title),field('Slug',slug),field('Status',status),field('Topic number',number));
  basics.body.append(grid,field('Summary',summary),field('Topic page lead',heroLead),field('Tags',tags,'Comma-separated'));
  let touched=!!current;slug.addEventListener('input',()=>{touched=true;});title.addEventListener('input',()=>{if(!touched)slug.value=slugify(title.value);});
  form.append(basics.section);

  const video=makePanel('Videos','Add as many video objects as the Topic needs. Reorder or remove them independently.');
  const videoList=el('div','topic-admin__list');video.body.append(videoList);
  normalizeObjects(data,'videos','video').forEach(v=>videoList.append(videoRow(v)));
  const addVideo=button('Add video');addVideo.addEventListener('click',()=>videoList.append(videoRow()));
  video.body.append(addVideo);form.append(video.section);

  const essay=makePanel('Essays','Each essay has its own Overview and In depth content and can be reordered independently.');
  const essayList=el('div','topic-admin__list');essay.body.append(essayList);
  normalizeObjects(data,'essays','essay').forEach(v=>essayList.append(essayRow(v)));
  const addEssay=button('Add essay');addEssay.addEventListener('click',()=>essayList.append(essayRow()));
  essay.body.append(addEssay);form.append(essay.section);

  const sources=makePanel('Sources','Each link belongs to one of the three reading levels. Add as many sources as needed.');
  const sourcesIntro=textarea(data.sources_intro||'',3,'Intro text above the three source levels');
  sources.body.append(field('Intro',sourcesIntro));
  const sourceList=el('div','topic-admin__list');sources.body.append(sourceList);
  (Array.isArray(data.sources)?data.sources:[]).forEach(v=>sourceList.append(sourceRow(v).row));
  const addSource=button('Add source');addSource.addEventListener('click',()=>sourceList.append(sourceRow().row));sources.body.append(addSource);form.append(sources.section);

  const timeline=makePanel('Timeline','Add as many timeline nodes as needed. Nodes render as one vertical alternating timeline on the Topic page.');
  const timelineList=el('div','topic-admin__list');timeline.body.append(timelineList);
  (Array.isArray(data.timeline)?data.timeline:[]).forEach(v=>timelineList.append(timelineRow(v).row));
  const addNode=button('Add timeline node');addNode.addEventListener('click',()=>timelineList.append(timelineRow().row));timeline.body.append(addNode);form.append(timeline.section);

  const simulation=makePanel('Simulations','Add as many interactive simulations as the Topic needs. HTML/CSS/JavaScript runs in sandboxed iframes.');
  const simulationList=el('div','topic-admin__list');simulation.body.append(simulationList);
  normalizeObjects(data,'simulations','simulation').forEach(v=>simulationList.append(simulationRow(v)));
  const addSimulation=button('Add simulation');addSimulation.addEventListener('click',()=>simulationList.append(simulationRow()));
  simulation.body.append(addSimulation);form.append(simulation.section);

  const vpData=data.viewpoints&&typeof data.viewpoints==='object'?data.viewpoints:{};
  const viewpoints=makePanel('Viewpoints & Polls','Add as many viewpoint cards and independent polls as the Topic needs.');
  const viewpointsIntro=textarea(data.viewpoints_intro||'',3,'Intro above viewpoints');
  viewpoints.body.append(field('Intro',viewpointsIntro));
  const viewpointList=el('div','topic-admin__list');viewpoints.body.append(viewpointList);
  let viewpointValues=Array.isArray(vpData.items)?vpData.items:[];
  if(!viewpointValues.length){
    if(vpData.left_label||vpData.left_text||vpData.left_cite)viewpointValues.push({label:vpData.left_label||'Viewpoint A',text:vpData.left_text||'',cite:vpData.left_cite||''});
    if(vpData.right_label||vpData.right_text||vpData.right_cite)viewpointValues.push({label:vpData.right_label||'Viewpoint B',text:vpData.right_text||'',cite:vpData.right_cite||''});
  }
  viewpointValues.forEach(v=>viewpointList.append(viewpointRow(v)));
  const addViewpoint=button('Add viewpoint');addViewpoint.addEventListener('click',()=>viewpointList.append(viewpointRow()));
  viewpoints.body.append(addViewpoint);

  const pollList=el('div','topic-admin__list');viewpoints.body.append(pollList);
  let pollValues=Array.isArray(vpData.polls)?vpData.polls:[];
  if(!Array.isArray(vpData.polls)&&(vpData.poll_question||(Array.isArray(vpData.poll_options)&&vpData.poll_options.length))){
    pollValues=[{id:'main',question:vpData.poll_question||'Where do you land?',note:vpData.poll_note||'',options:vpData.poll_options||[]}];
  }
  const pollResults=new Map((current?.poll_results_list||[]).map(result=>[String(result.id||''),result]));
  pollValues.forEach(v=>pollList.append(pollRow(v,pollResults.get(String(v.id||'main'))||null)));
  const addPoll=button('Add poll');addPoll.addEventListener('click',()=>pollList.append(pollRow()));
  viewpoints.body.append(addPoll);
  form.append(viewpoints.section);

  const statusLine=line();
  const actions=el('div','fl-form-actions');
  const save=button(current?'Save Topic':'Create Topic',true);save.type='submit';
  const back=button('Back to Topics');back.addEventListener('click',()=>go('/workspace/core/admin/content'));
  actions.append(save,back);
  if(current){
    const del=button('Delete Topic');del.classList.add('topic-admin__danger');
    del.addEventListener('click',async()=>{
      if(!window.confirm('Delete this Topic? This cannot be undone.'))return;
      del.disabled=true;setLine(statusLine,'Deleting…');
      try{await P.call('/platform/admin/site/content/'+current.id+'/',{method:'DELETE'});go('/workspace/core/admin/content',{replace:true});}
      catch(error){setLine(statusLine,error.message||'Delete failed.','bad');del.disabled=false;}
    });
    actions.append(del);
  }
  form.append(actions,statusLine);

  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;setLine(statusLine,'Saving…');
    const videoRows=collectRows(videoList,'.topic-video-row',row=>{
      const f=row._topicFields;if(!f)return null;
      return {title:f.title.value.trim(),source_type:f.sourceType.value,youtube_url:f.youtube.value.trim(),self_hosted_url:f.selfUrl.value.trim(),
        description:f.description.value,duration:f.duration.value.trim(),info:f.info.value.trim(),
        companion_label:f.companionLabel.value.trim(),companion_url:f.companionUrl.value.trim(),
        transcript_label:f.transcriptLabel.value.trim(),transcript_url:f.transcriptUrl.value.trim()};
    }).filter(x=>x.title||x.source_type!=='none'||x.youtube_url||x.self_hosted_url||x.description||x.duration||x.info||x.companion_label||x.transcript_label);
    const essayRows=collectRows(essayList,'.topic-essay-row',row=>{
      const f=row._topicFields;if(!f)return null;
      return {title:f.title.value.trim(),overview_html:f.overview.value(),indepth_html:f.indepth.value(),image_url:f.imageUrl.value.trim(),image_alt:f.alt.value.trim(),
        aside_title:f.asideTitle.value.trim(),aside_text:f.asideText.value};
    }).filter(x=>x.title||x.overview_html||x.indepth_html||x.image_url||x.aside_text);
    const sourceRows=collectRows(sourceList,'.topic-source-row',row=>{
      const sels=row.querySelectorAll('select,input');return {
        level:sels[0]?.value||'start',level_label:sels[0]?.selectedOptions?.[0]?.textContent||'',label:sels[1]?.value.trim()||'',url:sels[2]?.value.trim()||''
      };
    }).filter(x=>x.label);
    const timelineRows=collectRows(timelineList,'.topic-timeline-row',row=>{
      const ins=row.querySelectorAll('input,textarea');return {
        date:ins[0]?.value.trim()||'',title:ins[1]?.value.trim()||'',description:ins[2]?.value.trim()||'',
        image_url:ins[3]?.value.trim()||'',image_alt:ins[5]?.value.trim()||''
      };
    }).filter(x=>x.title||x.date);
    const simulationRows=collectRows(simulationList,'.topic-simulation-row',row=>{
      const f=row._topicFields;if(!f)return null;
      return {title:f.title.value.trim()||'The Simulation',description:f.description.value,builtin:f.builtin||'',native:f.native||'',type:f.type||'',enabled:f.enabled,code:f.code.value};
    }).filter(x=>x.description||x.builtin||x.native||x.type||x.enabled||x.code);
    const viewpointRows=collectRows(viewpointList,'.topic-viewpoint-row',row=>{
      const f=row._topicFields;if(!f)return null;
      return {label:f.label.value.trim(),text:f.text.value,cite:f.cite.value.trim()};
    }).filter(x=>x.label||x.text||x.cite);
    const pollRows=collectRows(pollList,'.topic-poll-row',row=>{
      const f=row._topicFields;if(!f)return null;
      const options=Array.from(f.optionList.children).filter(node=>node.classList.contains('topic-poll-option')).map(option=>{
        const ins=option.querySelectorAll('input');
        return {label:ins[0]?.value.trim()||'',id:ins[1]?.value.trim()||slugify(ins[0]?.value||'')};
      }).filter(x=>x.label&&x.id);
      return {id:f.id.value.trim()||nextPollId(),question:f.question.value.trim(),note:f.note.value.trim(),options};
    }).filter(x=>x.question||x.options.length);
    const firstView=viewpointRows[0]||{},secondView=viewpointRows[1]||{},firstPoll=pollRows[0]||{};
    const topicData={
      number:number.value.trim(),
      hero_lead:heroLead.value,
      tags:tags.value.split(',').map(v=>v.trim()).filter(Boolean),
      videos:videoRows,
      video:videoRows[0]||{},
      essays:essayRows,
      essay:essayRows[0]||{},
      sources_intro:sourcesIntro.value,
      sources:sourceRows,
      timeline:timelineRows,
      simulations:simulationRows,
      simulation:simulationRows[0]||{},
      viewpoints_intro:viewpointsIntro.value,
      viewpoints:{
        items:viewpointRows,
        left_label:firstView.label||'',left_text:firstView.text||'',left_cite:firstView.cite||'',
        right_label:secondView.label||'',right_text:secondView.text||'',right_cite:secondView.cite||'',
        polls:pollRows,
        poll_question:firstPoll.question||'',
        poll_options:firstPoll.options||[],
        poll_note:firstPoll.note||''
      },
      landing:data.landing||{}
    };
    const payload={title:title.value.trim(),slug:slug.value.trim(),kind:'topic',status:status.value,summary:summary.value,body:'',topic_data:topicData,translations:[]};
    try{
      const result=current?await P.adminUpdateSiteContent(current.id,payload):await P.adminCreateSiteContent(payload);
      setLine(statusLine,'Topic saved. Landing, Topics and Topic page now read this record.','ok');
      if(!current)go('/workspace/core/admin/content/'+result.item.id,{replace:true});
    }catch(error){setLine(statusLine,error.message||'Topic was not saved.','bad');}
    finally{save.disabled=false;}
  });
  ui.wrap.append(form);
}