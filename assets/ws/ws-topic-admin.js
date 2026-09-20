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

  const videoData=data.video||{};
  const video=makePanel('Video','Choose YouTube or a self-hosted upload, then add runtime and supporting information.');
  const videoType=select([['none','Not published yet'],['youtube','YouTube'],['self_hosted','Self-hosted']],videoData.source_type||'none');
  const youtube=input(videoData.youtube_url||'','url','YouTube URL');
  const self=mediaField('Self-hosted video',videoData.self_hosted_url||'','video/*');
  const duration=input(videoData.duration||'','','e.g. 28 minutes');
  const description=textarea(videoData.description||'',4,'Video description');
  const info=input(videoData.info||'','','Additional information');
  const companionLabel=input(videoData.companion_label||'','','Companion label');
  const companionUrl=input(videoData.companion_url||'','url','Companion URL');
  const transcriptLabel=input(videoData.transcript_label||'','','Transcript label');
  const transcriptUrl=input(videoData.transcript_url||'','url','Transcript URL');
  const vg=el('div','topic-admin__grid');vg.append(
    field('Source type',videoType),field('YouTube URL',youtube),field('Runtime',duration),field('Info',info),
    field('Companion label',companionLabel),field('Companion URL',companionUrl),
    field('Transcript label',transcriptLabel),field('Transcript URL',transcriptUrl)
  );
  video.body.append(vg,self.holder,field('Description',description));form.append(video.section);

  const essayData=data.essay||{};
  const essay=makePanel('The Essay','Overview and In depth are edited independently with rich-text controls.');
  const overview=richEditor('Overview',essayData.overview_html||'');
  const indepth=richEditor('In depth',essayData.indepth_html||'');
  const essayImage=mediaField('Essay image',essayData.image_url||'','image/*');
  const essayAlt=input(essayData.image_alt||'','','Image alt text');
  const essayAsideTitle=input(essayData.aside_title||'Try It Yourself','','Aside title');
  const essayAsideText=textarea(essayData.aside_text||'',3,'Aside text');
  essay.body.append(overview.outer,indepth.outer,essayImage.holder,field('Image alt text',essayAlt),field('Aside title',essayAsideTitle),field('Aside text',essayAsideText));form.append(essay.section);

  const sources=makePanel('Sources','Each link belongs to one of the three reading levels.');
  const sourcesIntro=textarea(data.sources_intro||'',3,'Intro text above the three source levels');
  sources.body.append(field('Intro',sourcesIntro));
  const sourceList=el('div','topic-admin__list');sources.body.append(sourceList);
  (Array.isArray(data.sources)?data.sources:[]).forEach(v=>sourceList.append(sourceRow(v).row));
  const addSource=button('Add source');addSource.addEventListener('click',()=>sourceList.append(sourceRow().row));sources.body.append(addSource);form.append(sources.section);

  const timeline=makePanel('Timeline','Nodes render as one vertical alternating timeline on the Topic page.');
  const timelineList=el('div','topic-admin__list');timeline.body.append(timelineList);
  (Array.isArray(data.timeline)?data.timeline:[]).forEach(v=>timelineList.append(timelineRow(v).row));
  const addNode=button('Add timeline node');addNode.addEventListener('click',()=>timelineList.append(timelineRow().row));timeline.body.append(addNode);form.append(timeline.section);

  const simData=data.simulation||{};
  const simulation=makePanel('The Simulation','HTML/CSS/JavaScript runs in a sandboxed iframe with scripts allowed but without same-origin access.');
  const simTitle=input(simData.title||'The Simulation');
  const simDescription=textarea(simData.description||'',3,'Simulation introduction');
  const simCode=textarea(simData.code||'',16,'Paste HTML/CSS/JavaScript or JavaScript code');
  simCode.classList.add('topic-admin__code');
  const codeFile=input('','file');codeFile.accept='.html,.htm,.js,.txt,.css';
  codeFile.addEventListener('change',async()=>{const file=codeFile.files&&codeFile.files[0];if(file)simCode.value=await file.text();});
  const sg=el('div','topic-admin__grid');sg.append(field('Section title',simTitle),field('Upload code file',codeFile));
  simulation.body.append(sg,field('Description',simDescription),field('Code',simCode,'Executed only inside the public sandboxed simulation frame.'));form.append(simulation.section);

  const vpData=data.viewpoints||{};
  const viewpoints=makePanel('Viewpoints & Poll','Two opposing text boxes plus a configurable poll. Results below are live database totals.');
  const viewpointsIntro=textarea(data.viewpoints_intro||'',3,'Intro above viewpoints');
  const leftLabel=input(vpData.left_label||'Viewpoint A'),rightLabel=input(vpData.right_label||'Viewpoint B');
  const leftText=textarea(vpData.left_text||'',6),rightText=textarea(vpData.right_text||'',6);
  const leftCite=input(vpData.left_cite||'','','Left citation / note'),rightCite=input(vpData.right_cite||'','','Right citation / note');
  const vgrid=el('div','topic-admin__grid');vgrid.append(
    field('Left label',leftLabel),field('Right label',rightLabel),
    field('Left text',leftText),field('Right text',rightText),
    field('Left citation',leftCite),field('Right citation',rightCite)
  );
  const pollQuestion=input(vpData.poll_question||'Where do you land?');
  const pollNote=input(vpData.poll_note||'','','Text below poll');
  const optionList=el('div','topic-admin__list');(Array.isArray(vpData.poll_options)?vpData.poll_options:[]).forEach(v=>optionList.append(optionRow(v).row));
  const addOption=button('Add poll option');addOption.addEventListener('click',()=>optionList.append(optionRow().row));
  viewpoints.body.append(field('Intro',viewpointsIntro),vgrid,field('Poll question',pollQuestion),field('Poll note',pollNote),optionList,addOption);
  if(current?.poll_results){
    const results=el('div');results.append(el('h3',null,'Live results'));
    (current.poll_results.options||[]).forEach(r=>{const x=el('div','topic-admin__result');x.append(el('span',null,r.label),el('strong',null,String(r.votes)+' votes'));results.append(x);});
    results.append(el('p','fl-muted','Total: '+String(current.poll_results.total_votes||0)+' votes'));viewpoints.body.append(results);
  }
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
    const pollOptions=collectRows(optionList,'.topic-poll-option',row=>{
      const ins=row.querySelectorAll('input');return {label:ins[0]?.value.trim()||'',id:ins[1]?.value.trim()||slugify(ins[0]?.value||'')};
    }).filter(x=>x.label&&x.id);
    const topicData={
      number:number.value.trim(),
      hero_lead:heroLead.value,
      tags:tags.value.split(',').map(v=>v.trim()).filter(Boolean),
      video:{
        source_type:videoType.value,youtube_url:youtube.value.trim(),self_hosted_url:self.url.value.trim(),
        description:description.value,duration:duration.value.trim(),info:info.value.trim(),
        companion_label:companionLabel.value.trim(),companion_url:companionUrl.value.trim(),
        transcript_label:transcriptLabel.value.trim(),transcript_url:transcriptUrl.value.trim()
      },
      essay:{
        overview_html:overview.value(),indepth_html:indepth.value(),image_url:essayImage.url.value.trim(),image_alt:essayAlt.value.trim(),
        aside_title:essayAsideTitle.value.trim(),aside_text:essayAsideText.value
      },
      sources_intro:sourcesIntro.value,
      sources:sourceRows,
      timeline:timelineRows,
      simulation:{title:simTitle.value.trim()||'The Simulation',description:simDescription.value,builtin:simData.builtin||'',code:simCode.value},
      viewpoints_intro:viewpointsIntro.value,
      viewpoints:{
        left_label:leftLabel.value.trim(),left_text:leftText.value,left_cite:leftCite.value.trim(),
        right_label:rightLabel.value.trim(),right_text:rightText.value,right_cite:rightCite.value.trim(),
        poll_question:pollQuestion.value.trim(),poll_options:pollOptions,poll_note:pollNote.value.trim()
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