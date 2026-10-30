/* GraviQuest Lab Studio — uses the shared admin kit and Brand Book tokens.
   Never executes draft source inside the admin document. */
import * as K from './ws-admin-kit.js?v=20261016-task1';
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';

const { el } = K;
const COMPONENTS = [
  ['stage', 'Simulation stage', 'An isolated canvas for the custom code'],
  ['controls', 'Controls', 'Simulation parameters and actions'],
  ['metrics', 'Live metrics', 'Measurement chips and readouts'],
  ['timeline', 'Timeline', 'Pause, resume and replay controls'],
  ['compare', 'Compare', 'Side-by-side experiment outcomes'],
  ['layers', 'Layers', 'Additional scientific visual overlays'],
  ['charts', 'Charts', 'Data trends from the simulation'],
];
const labUrl = id => '/lab.html?lab=' + encodeURIComponent(id);
const validFile = name => /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:html|css|js|json|txt)$/.test(name) &&
  (!name.endsWith('.html') || name === 'index.html');
const value = (node) => String(node.value || '').trim();

function panel(title, caption) {
  const box = el('section', 'ls-panel');
  const header = el('div','ls-panel-head');
  header.append(el('h3',null,title),el('p',null,caption));
  const body = el('div','ls-panel-body');
  box.append(header,body);
  return { box, body };
}
function tabs(names) {
  const nav = el('div','ls-tabs');
  const panels = new Map();
  names.forEach(([key,label],i) => {
    const b = K.button(label, () => choose(key),{tiny:true});
    b.dataset.selected = i === 0 ? 'true' : 'false';
    b.dataset.key=key;
    nav.append(b);
    const child = el('div','ls-tabpane');
    child.hidden=i!==0;
    panels.set(key,child);
  });
  const choose=(key)=>{
    for(const [k,p] of panels){p.hidden=k!==key;}
    for(const b of nav.children)b.dataset.selected=String(b.dataset.key===key);
  };
  return {nav,panels,choose};
}

export async function renderLabStudio(host) {
  K.loading(host,'Lab Studio',{tiles:0,cards:[4,8]});
  let labs=[];
  try { labs=(await P.adminLabs()).labs||[]; }
  catch(e) { K.failure(host,'Lab Studio',e,()=>renderLabStudio(host));return; }
  const root=K.page(host,{
    title:'Lab Studio',
    meta:'Design the experience here. The public Lab shows only what you explicitly publish.',
    actions:[K.anchor('Open Lab', '/lab.html')],
  });
  const layout=el('div','ls-layout');
  const catalog=panel('Your Labs','Each Lab has its own code, interface, teaching path and release.');
  const editor=panel('Editor','Drafts stay private until you publish a reviewed version.');
  catalog.box.classList.add('ls-catalog');
  editor.box.classList.add('ls-editor');
  layout.append(catalog.box,editor.box);
  root.append(layout);
  let selected=labs[0]||null;
  const listing=el('div','ls-list');
  const add=K.button('New Lab',()=>{selected=null;drawList();drawEditor(null);},{solid:true,tiny:true});
  catalog.body.append(add,listing);
  function drawList(){
    listing.replaceChildren();
    if(!labs.length)listing.append(K.empty('No published or draft Labs yet. Create a draft to begin.'));
    for(const lab of labs){
      const b=el('button','ls-list-item');
      b.type='button';
      b.dataset.selected=String(selected?.id===lab.id);
      const info=el('span','ls-list-main');
      info.append(el('strong',null,lab.title),el('small',null,
        [lab.topic_slug?'Topic: '+lab.topic_slug:'Independent Lab',
         'Draft v'+lab.version,'Live v'+(lab.published_version||'—')].join(' · ')));
      b.append(info,K.badge(lab.ready?'Live':'Draft',lab.ready?'ok':'warn'));
      b.addEventListener('click',()=>{selected=lab;drawList();drawEditor(lab);});
      listing.append(b);
    }
  }
  async function refresh(id){
    labs=(await P.adminLabs()).labs||[];
    selected=labs.find(x=>x.id===id)||labs[0]||null;
    drawList();drawEditor(selected);
  }

  function drawEditor(lab){
    editor.body.replaceChildren();
    const form=el('form','ls-form');
    const title=K.input(lab?.title||'','text','Name the experience');
    const slug=K.input(lab?.slug||'','text','lab-identifier');
    slug.disabled=!!lab;
    if(!lab)title.addEventListener('input',()=>{if(!slug.dataset.touched)slug.value=K.slugify(title.value);});
    slug.addEventListener('input',()=>{slug.dataset.touched='1';});
    const topic=K.input(lab?.topic_slug||'','text','Optional published Topic slug');
    const summary=K.textarea(lab?.summary||'',3);
    const duration=K.input(lab?.duration_text||'','text','10 min');
    const config=lab?.config||{};
    const goal=K.textarea(config.learning_goal||'',3,'What should people discover?');
    const switches=new Map();
    const cmpbox=el('div','ls-component-grid');
    for(const [key,name,detail] of COMPONENTS){
      const entry=K.toggle((config.components||['stage','controls','metrics']).includes(key),name,detail);
      if(key==='stage'){entry.input.checked=true;entry.input.disabled=true;}
      switches.set(key,entry.input);
      cmpbox.append(entry.wrap);
    }
    const pulsar=K.toggle(config.pulsar_enabled!==false,'Pulsar teaching companion','Short contextual guidance beside the simulator.');
    const auto=K.toggle(config.auto_coach!==false,'Automatic commentary','Explain meaningful changes after the simulation settles.');
    const options=K.switches([pulsar,auto]);

    const sectionsHost=el('div','ls-editor-items');
    function makeSection(values={}){
      const line=el('div','ls-item');
      const id=K.input(values.id||'','text','intro / observe / compare');
      const t=K.input(values.title||'','text','Section title');
      const hint=K.textarea(values.hint||'',2,'Short introduction');
      const remove=K.button('Remove',()=>line.remove(),{tiny:true,danger:true});
      line.append(K.fields([K.field('Section ID',id),K.field('Title',t)]),K.field('Pulsar introduction',hint),remove);
      line.read=()=>({id:value(id),title:value(t),hint:value(hint)});
      sectionsHost.append(line);
    }
    (config.sections||[]).forEach(makeSection);
    const addSection=K.button('Add section',()=>makeSection(),{tiny:true});

    const guideHost=el('div','ls-editor-items');
    function makeGuide(values={}){
      const line=el('div','ls-item');
      const event=K.input(values.event||'','text','density_changed');
      const section=K.input(values.section||'','text','Optional section ID');
      const hint=K.textarea(values.hint||'',2,'One sentence of guidance');
      const concept=K.textarea(values.concept||'',2,'Scientific mechanism Pulsar may explain');
      const remove=K.button('Remove',()=>line.remove(),{tiny:true,danger:true});
      line.append(K.fields([K.field('Simulation event',event),K.field('Section',section)]),
        K.field('Immediate feedback',hint),K.field('Concept / scientific note',concept),remove);
      line.read=()=>({event:value(event),section:value(section),hint:value(hint),concept:value(concept)});
      guideHost.append(line);
    }
    (config.guidance||[]).forEach(makeGuide);
    const addGuide=K.button('Add coaching moment',()=>makeGuide(),{tiny:true});

    const initial=lab?.files||[];
    const codeFiles=new Map();
    const fileButtons=el('div','ls-file-tabs');
    const codeEditor=el('div','ls-code-editor');
    let fileName='index.html';
    function activate(name){
      fileName=name;
      for(const [key,node] of codeFiles)node.hidden=key!==name;
      for(const b of fileButtons.children)b.dataset.selected=String(b.dataset.file===name);
    }
    function addFile(name,text){
      if(codeFiles.has(name))return activate(name);
      const area=K.textarea(text||'',18,'// Lab source code',{code:true});
      area.setAttribute('aria-label','Code: '+name);
      codeFiles.set(name,area);codeEditor.append(area);
      const b=K.button(name,()=>activate(name),{tiny:true});
      b.dataset.file=name;fileButtons.append(b);
      activate(name);
    }
    addFile('index.html',(initial.find(f=>f.name==='index.html')||{}).content||'');
    for(const file of initial){if(file.name!=='index.html')addFile(file.name,file.content);}
    activate('index.html');
    const addCode=K.button('Add file',()=>{
      const name=(window.prompt('File path (e.g. app.js or styles.css):')||'').trim();
      if(!name)return;
      if(!validFile(name)){window.alert('Use a .js, .css, .json or .txt file, or index.html.');return;}
      addFile(name,'');
    },{tiny:true});
    const removeCode=K.button('Remove selected',()=>{
      if(fileName==='index.html'){window.alert('Every Lab needs index.html.');return;}
      codeFiles.get(fileName).remove();
      codeFiles.delete(fileName);
      [...fileButtons.children].find(x=>x.dataset.file===fileName)?.remove();
      activate('index.html');
    },{tiny:true,danger:true});

    const tabsUI=tabs([
      ['setup','Setup'],['components','Components'],['learning','Pulsar & lessons'],['code','Code'],
      ['sources','Scientific context'],['preview','Preview'],['history','History'],
    ]);
    const setup=tabsUI.panels.get('setup');
    setup.append(
      K.fields([K.field('Lab title',title),K.field('Slug (fixed after creation)',slug),
        K.field('Related Topic slug',topic,'Optional; must match a published Topic.'),K.field('Estimated duration',duration)]),
      K.field('Summary',summary),K.field('Research / learning goal',goal)
    );
    tabsUI.panels.get('components').append(
      el('p','ls-note','Choose which shell components the viewer displays. Code emits events and metrics; the Lab shell renders controls and guidance.'),cmpbox);
    const learning=tabsUI.panels.get('learning');
    learning.append(options,K.heading('Learning journey'),sectionsHost,addSection,
      K.heading('Event-based coaching'),guideHost,addGuide,
      el('p','ls-note','Simulator code calls GraviLab.emit(event, metrics, section). Pulsar receives meaningful state changes, not raw source code.'));

    const sources=tabsUI.panels.get('sources');
    sources.append(el('p','ls-note','Versioned Markdown in the database grounds Pulsar. Sections become exact citations. Sources support concepts, not uncalibrated model coefficients.'));
    if(lab){
      let documents=[];
      const list=K.select([],null),docSlug=K.input('','text','paper-name-year'),docTitle=K.input('','text','Source title');
      const sourceUrl=K.input('','url','https://doi.org/...'),license=K.input('','text','License / reading note provenance');
      const markdown=K.textarea('',22,'# Article title\n\n## Section title\n\nScientific content...',{code:true});
      const published=K.toggle(true,'Available to public Lab and Pulsar','Only publish licensed full text or your own reading notes.');
      function chooseDoc(){const d=documents.find(x=>x.slug===list.value);docSlug.value=d?.slug||'';docSlug.disabled=!!d;docTitle.value=d?.title||'';sourceUrl.value=d?.source_url||'';license.value=d?.license||'';markdown.value=d?.markdown||'';published.input.checked=d?.is_published!==false;}
      list.addEventListener('change',chooseDoc);
      async function request(method,suffix='',body){
        const cookie=()=>decodeURIComponent((document.cookie.match(/(?:^|; )(?:csrftoken|gravitas_staging_csrftoken)=([^;]*)/)||[])[1]||'');
        if(method!=='GET'&&!cookie())await fetch('/api/auth/csrf/',{credentials:'same-origin'});
        const token=cookie();
        const r=await fetch('/api/platform/admin/labs/'+lab.id+'/knowledge/'+suffix,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRFToken':token},...(body?{body:JSON.stringify(body)}:{})});
        const data=await r.json();if(!r.ok)throw Error(data.error||'Scientific source request failed');return data;
      }
      async function loadDocs(chosen){const data=await request('GET');documents=data.documents||[];list.replaceChildren();const fresh=el('option',null,'New source');fresh.value='';list.append(fresh);for(const d of documents){const option=el('option',null,d.title+' · v'+d.version);option.value=d.slug;list.append(option);}list.value=chosen||'';chooseDoc();}
      const sourceStatus=K.status();
      const load=K.button('Load sources',()=>loadDocs().catch(e=>K.setStatus(sourceStatus,e.message,'bad')),{tiny:true});
      const saveSource=K.button('Save scientific source',async()=>{
        try{const previous=documents.find(x=>x.slug===list.value),slug=value(docSlug);if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug))throw Error('Use a lowercase source identifier.');
          await request('PUT',encodeURIComponent(slug)+'/',{version:previous?.version||0,title:value(docTitle),source_url:value(sourceUrl),license:value(license),markdown:markdown.value,kind:previous?.kind||'note',is_published:published.input.checked});await loadDocs(slug);K.setStatus(sourceStatus,'Scientific context saved.','ok');
        }catch(e){K.setStatus(sourceStatus,e.message,'bad');}
      },{solid:true,tiny:true});
      sources.append(load,K.fields([K.field('Stored source',list),K.field('Source ID',docSlug),K.field('Title',docTitle),K.field('Original source',sourceUrl),K.field('License / provenance',license)]),published.wrap,K.field('Markdown with section headings',markdown),saveSource,sourceStatus);
    }else sources.append(K.empty('Create the Lab before adding scientific sources.'));

    const code=tabsUI.panels.get('code');
    code.append(el('p','ls-note','Your HTML/CSS/JS runs only inside a restricted iframe, never in the admin or public page origin.'),
      fileButtons,codeEditor,K.cardActions([addCode,removeCode]));

    const preview=tabsUI.panels.get('preview');
    preview.append(el('p','ls-note','Save a draft to preview. Preview uses the same isolated runtime as the published Lab.'));
    if(lab){
      const frame=el('iframe','ls-preview-frame');
      frame.title='Private Lab preview';
      frame.sandbox='allow-scripts';
      frame.loading='lazy';
      const openPreview=K.button('Load saved draft preview',()=>{
        frame.src='/api/platform/admin/labs/'+lab.id+'/preview/';
      },{solid:true,tiny:true});
      preview.append(openPreview,frame);
    }else preview.append(K.empty('Save a draft before previewing.'));

    const history=tabsUI.panels.get('history');
    if(lab){
      const versions=K.select([],null);
      const load=K.button('Load revisions',async()=>{
        try{
          const res=await P.adminLabRevisions(lab.id);
          versions.replaceChildren();
          for(const r of res.revisions||[]){
            const opt=el('option',null,'Version '+r.version+' · '+new Date(r.created_at).toLocaleString());
            opt.value=String(r.version);versions.append(opt);
          }
        }catch(e){K.setStatus(status,e.message,'bad');}
      },{tiny:true});
      const restore=K.button('Restore to draft',async()=>{
        if(!versions.value||!window.confirm('Restore this version as a NEW draft? Live version remains unchanged.'))return;
        try{await P.adminRestoreLab(lab.id,lab.version,Number(versions.value));await refresh(lab.id);}
        catch(e){K.setStatus(status,e.message,'bad');}
      },{tiny:true});
      history.append(K.fields([K.field('Saved revisions',versions)]),K.cardActions([load,restore]));
    }else history.append(K.empty('Revision history begins after you create this Lab.'));

    const status=K.status();
    const save=K.button(lab?'Save draft':'Create draft',null,{solid:true,type:'submit'});
    const publish=lab?K.button(lab.ready?'Publish new version':'Publish',async()=>{
      if(!window.confirm('Publish this saved draft to the public Lab?'))return;
      try{
        const response=await P.adminPublishLab(lab.id,lab.version);
        K.setStatus(status,'Published version '+response.lab.published_version,'ok');
        await refresh(lab.id);
      }catch(e){K.setStatus(status,e.message,'bad');}
    }):null;
    const unpublish=lab?.ready?K.button('Unpublish',async()=>{
      if(!window.confirm('Remove this Lab from the public site?'))return;
      try{await P.adminUnpublishLab(lab.id);await refresh(lab.id);}
      catch(e){K.setStatus(status,e.message,'bad');}
    },{danger:true}):null;
    const live=lab?.ready?K.anchor('View live',labUrl(lab.slug),{tiny:true}):null;
    const remove=lab?K.button('Delete Lab',async()=>{
      if(!window.confirm('Permanently delete this Lab and its revision history?'))return;
      try{await P.adminDeleteLab(lab.id);await refresh(null);}
      catch(e){K.setStatus(status,e.message,'bad');}
    },{danger:true,tiny:true}):null;
    const pubhead=el('div','ls-release');
    pubhead.append(K.badge(lab?.ready?'Published v'+lab.published_version:'Not published',lab?.ready?'ok':'warn'),
      el('span',null,lab?'Editing v'+lab.version:'New draft'));
    form.append(pubhead,tabsUI.nav,...tabsUI.panels.values(),
      K.foot([save,publish,unpublish,live,remove],status));
    form.addEventListener('submit',async(evt)=>{
      evt.preventDefault();
      const files=[...codeFiles.entries()].filter(([name,area])=>name==='index.html'||value(area)).map(([name,area])=>({
        name,content:area.value,
      }));
      const config={
        learning_goal:value(goal),
        components:[...switches.entries()].filter(([,node])=>node.checked).map(([key])=>key),
        pulsar_enabled:pulsar.input.checked,auto_coach:auto.input.checked,
        sections:[...sectionsHost.children].map(row=>row.read()),
        guidance:[...guideHost.children].map(row=>row.read()),
      };
      const payload={title:value(title),slug:value(slug),summary:value(summary),
        duration_text:value(duration),topic_slug:value(topic),config,files};
      if(lab)payload.version=lab.version;
      save.disabled=true;
      K.setStatus(status,'Saving draft…');
      try{
        const result=lab?await P.adminUpdateLab(lab.id,payload):await P.adminCreateLab(payload);
        await refresh(result.lab.id);
      }catch(e){K.setStatus(status,e.message||'Could not save draft.','bad');save.disabled=false;}
    });
    editor.body.append(form);
  }
  drawList();drawEditor(selected);
}
