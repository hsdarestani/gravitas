const encoder=new TextEncoder();
const bytes=value=>typeof value==='string'?encoder.encode(value):value;
const RLM='\u200f';
const rtl=/^[^\p{Letter}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u;
export const reportKinds={
  task:{label:'Task',icon:'checklist',ink:'#18547b',fill:'#edf6fc'},
  workflow:{label:'Project',icon:'flow',ink:'#315b73',fill:'#edf5fa'},
  idea:{label:'Idea',icon:'light',ink:'#765312',fill:'#fcf5e4'},
  note:{label:'Note',icon:'message',ink:'#77520f',fill:'#fdf5e4'},
  link:{label:'Link',icon:'globe',ink:'#594086',fill:'#f3eefb'},
  activity:{label:'Task activity',icon:'clock',ink:'#24654f',fill:'#eaf6ef'},
  meeting:{label:'Meeting follow-up',icon:'people',ink:'#18547b',fill:'#edf6fc'}
};

export function httpLinkParts(value) {
  return String(value??'').split(/(https?:\/\/[^\s<>"']+)/gi).flatMap((raw,index)=>{
    if (index%2===0) return raw?[{text:raw}]:[];
    let href=raw.replace(/[.,!?;:]+$/,'');
    for (const [open,close] of [['(',')'],['[',']']]) {
      while (href.endsWith(close)&&href.split(close).length>href.split(open).length) href=href.slice(0,-1);
    }
    let url;
    try {url=new URL(href);} catch {return [{text:raw}];}
    if (!['https:','http:'].includes(url.protocol)) return [{text:raw}];
    return [{text:href,href:url.href,host:url.hostname,path:url.pathname},...(raw.length>href.length?[{text:raw.slice(href.length)}]:[])];
  });
}

const oneLine=value=>String(value??'').replace(/\s+/g,' ').trim();
const markdownLabel=value=>oneLine(value).replace(/[\\`*_{}\[\]<>|#!~]/g,'\\$&');
const markdownHref=href=>'<'+href.replace(/[<>]/g,char=>encodeURIComponent(char))+'>';
const markdownLink=(label,href)=>'['+markdownLabel(label)+']('+markdownHref(href)+')';
function markdownBody(value) {
  return httpLinkParts(value).map(part=>part.href?markdownLink(part.text,part.href):part.text.replace(/[\\`*_{}\[\]<>|#!~]/g,'\\$&')).join('');
}
export function markdownReport({title,meta,sections}) {
  const content=sections.map(entry=>{
    const {kind,text,done,detail,body}=entry;
    if (kind==='heading') return '## '+markdownLabel(text);
    if (kind==='check') return '- ['+(done?'x':' ')+'] '+markdownBody(oneLine(text));
    if (kind==='image') return '*Image · '+markdownLabel(text)+'*';
    if (kind==='note') return ['> **Note**','>',...markdownBody(text).split('\n').map(line=>'> '+line)].join('\n');
    if (reportKinds[kind]) {
      return ['**'+reportKinds[kind].label+'** · '+markdownLabel(text),detail&&'*'+markdownLabel(detail)+'*',body&&markdownBody(body)].filter(Boolean).join('  \n');
    }
    return markdownBody(text);
  });
  return '# '+markdownLabel(title)+'\n\n'+meta.map(({label,value})=>'**'+markdownLabel(label)+'** '+markdownLabel(value)).join('  \n')+'\n\n'+content.join('\n\n')+'\n';
}

export function reportPreview(report,{esc,symbol}) {
  const styled=kind=>{
    const {ink,fill}=reportKinds[kind];
    return `style="--report-ink:${ink};--report-fill:${fill}"`;
  };
  const details=(kind,text,detail)=>`<span class="report-card-icon">${symbol(reportKinds[kind].icon)}</span>
    <span class="report-card-copy"><small>${reportKinds[kind].label}</small><strong dir="auto">${esc(text)}</strong>
    ${detail?`<span dir="auto">${esc(detail)}</span>`:''}</span>`;
  const body=value=>httpLinkParts(value).map(part=>part.href?
    `<a class="report-card report-web-link" ${styled('link')} href="${esc(part.href)}" target="_blank" rel="noopener noreferrer">
      ${details('link',part.host,part.path==='/'?part.text:part.path)}${symbol('chevron','report-open')}</a>`:
    (/^\s*$/.test(part.text)?'':`<span class="report-copy" dir="auto">${esc(part.text)}</span>`)).join('');
  return `<article class="report-paper" aria-label="Report document">
    <header class="report-cover"><span class="report-brand">${symbol('journal')} GraviQuest Workspace</span><h3 dir="auto">${esc(report.title)}</h3>
      <dl class="report-meta">${report.meta.map(({label,value})=>`<div><dt>${esc(label)}</dt><dd dir="auto">${esc(value)}</dd></div>`).join('')}</dl></header>
    <div class="report-content">${report.sections.map((entry,index)=>{
      const {kind,text,done,detail,ref}=entry;
      if (kind==='heading') return `<h4 dir="auto">${esc(text)}</h4>`;
      if (kind==='check') return `<div class="report-check ${done?'done':''}">${symbol(done?'check':'rectangle')}<span class="sr-only">${done?'Completed':'Open'}</span><div>${body(text)}</div></div>`;
      if (kind==='image') return `<figure class="report-image">${entry.blob?`<img data-report-image="${index}" alt="${esc(text)}">`:''}<figcaption dir="auto">${symbol('image')} ${esc(text)}</figcaption></figure>`;
      if (kind==='note') return `<aside class="report-note" ${styled(kind)}><h5>${symbol('message')} Note</h5>${body(text)}</aside>`;
      if (reportKinds[kind]) {
        const card=details(kind,text,detail);
        return `<div class="report-reference">${ref?`<button type="button" class="report-card" ${styled(kind)} data-action="report-reference" data-value="${esc(ref)}">${card}${symbol('chevron','report-open')}</button>`:
          `<div class="report-card" ${styled(kind)}>${card}</div>`}${entry.body?`<div class="report-activity-body">${body(entry.body)}</div>`:''}</div>`;
      }
      return `<div class="report-paragraph">${body(text)}</div>`;
    }).join('')||'<p class="report-empty">This report has no written content yet.</p>'}</div></article>`;
}

const pageWidth=620,pageHeight=877,left=48,right=pageWidth-left,top=59,bottom=804;
function canvasPage() {
  const canvas=document.createElement('canvas');
  canvas.width=pageWidth*2;
  canvas.height=pageHeight*2;
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.scale(2,2);
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,pageWidth,pageHeight);
  return {canvas,ctx,links:[]};
}
function wrap(ctx,text,maxWidth) {
  const lines=[];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {lines.push('');continue;}
    let line='';
    for (let word of paragraph.trim().split(/\s+/)) {
      if (line&&ctx.measureText(line+' '+word).width>maxWidth) {lines.push(line);line='';}
      if (ctx.measureText(word).width>maxWidth) {
        let part='';
        for (const char of word) {
          if (part&&ctx.measureText(part+char).width>maxWidth) {lines.push(part);part='';}
          part+=char;
        }
        word=part;
      }
      line+=line?' '+word:word;
    }
    lines.push(line);
  }
  return lines;
}
async function reportPages(report) {
  const pages=[];
  let page=canvasPage(), y=top;
  function line(text,size,color,x=left,max=right,weight=400) {
    const {ctx}=page;
    ctx.font=weight+' '+size+'px Arial, sans-serif';
    ctx.fillStyle=color;
    ctx.direction=rtl.test(text)?'rtl':'ltr';
    ctx.textAlign=ctx.direction==='rtl'?'right':'left';
    ctx.fillText(ctx.direction==='rtl'?RLM+text:text,ctx.direction==='rtl'?max:x,y);
    y+=Math.round(size*1.55);
  }
  function flush() {
    const pageNum=pages.length+1;
    y=845;
    line('GRAVIQUEST WORKSPACE',9,'#44606e',left,right,700);
    page.ctx.fillText(String(pageNum),right-13,845);
    pages.push(page);
    page=canvasPage();y=top;
  }
  function block(text,{size=13,color='#172e3a',weight=400,padding=0,gap=8,decoration=null}={}) {
    const maxWidth=right-left-padding;
    page.ctx.font=weight+' '+size+'px Arial, sans-serif';
    for (const entry of wrap(page.ctx,text,maxWidth)) {
      if (y>bottom) flush();
      if (decoration) {
        const {ctx}=page;
        ctx.fillStyle=decoration.fill;
        ctx.fillRect(left,y-size-1,right-left,Math.round(size*1.55));
        ctx.fillStyle=decoration.ink;
        ctx.fillRect(left,y-size-1,3,Math.round(size*1.55));
      }
      line(entry,size,color,left+padding,right-4,weight);
    }
    y+=gap;
  }
  function card(kind,text,detail,href='') {
    const style=reportKinds[kind];
    const lines=[[style.label.toUpperCase(),9,700],[text,14,700],...(detail?[[detail,10,400]]:[])];
    const prepared=lines.map(([value,size,weight])=>{
      page.ctx.font=weight+' '+size+'px Arial, sans-serif';
      return {values:wrap(page.ctx,value,right-left-24),size,weight};
    });
    const height=13+prepared.reduce((total,row)=>total+Math.round(row.size*1.55)*row.values.length,0);
    if (height>bottom-top) {
      for (const [value,size,weight] of lines) block(value,{size,weight,padding:12,gap:0,decoration:style,color:style.ink});
      y+=8;
      return;
    }
    if (y+height>bottom) flush();
    const boxTop=y-10;
    page.ctx.fillStyle=style.fill;
    page.ctx.fillRect(left,boxTop,right-left,height);
    page.ctx.fillStyle=style.ink;
    page.ctx.fillRect(left,boxTop,3,height);
    y+=7;
    for (const row of prepared) {
      for (const value of row.values) line(value,row.size,style.ink,left+12,right-12,row.weight);
    }
    if (href) page.links.push({href,rect:[left,boxTop,right,boxTop+height]});
    y+=10;
  }
  function body(text,style={}) {
    for (const part of httpLinkParts(text)) {
      if (part.href) {
        const detail=part.path==='/'?'':part.path;
        card('link',part.host,detail,part.href);
      } else if (part.text.trim()) block(part.text,style);
    }
  }
  block('GRAVIQUEST WORKSPACE',{size:10,color:'#21657a',weight:700,gap:9});
  block(report.title,{size:28,weight:700,gap:5});
  for (const {label,value} of report.meta) block(label+'  ·  '+value,{size:11,color:'#426274',gap:2});
  y+=12;
  for (const entry of report.sections) {
    if (entry.kind==='heading') {
      if (y>bottom-65) flush();
      y+=7;block(entry.text,{size:17,weight:700,color:'#113b4d',gap:4});
    } else if (entry.kind==='check') {
      body((entry.done?'✓  ':'□  ')+entry.text,{padding:12,gap:3,color:entry.done?'#24654f':'#172e3a'});
    } else if (entry.kind==='image') {
      const image=entry.blob?await createImageBitmap(entry.blob).catch(()=>null):null;
      if (image) {
        const scale=Math.min((right-left)/image.width,300/image.height,1);
        const width=Math.round(image.width*scale),height=Math.round(image.height*scale);
        if (y+height+32>bottom) flush();
        page.ctx.drawImage(image,left,y,width,height);
        image.close();y+=height+18;
      }
      block(entry.text,{size:11,color:'#426274'});
    } else if (entry.kind==='note') {
      const decoration=reportKinds.note;
      if (y>bottom-55) flush();
      block('NOTE',{size:10,weight:700,padding:12,gap:0,color:decoration.ink,decoration});
      body(entry.text,{padding:12,gap:3,decoration});
      y+=8;
    } else if (reportKinds[entry.kind]) {
      card(entry.kind,entry.text,entry.detail);
      if (entry.body) body(entry.body,{padding:12});
    } else body(entry.text);
  }
  if (!report.sections.length) block('This report has no written content yet.');
  flush();
  return Promise.all(pages.map(({canvas,links})=>new Promise((resolve,reject)=>{
    canvas.toBlob(async blob=>{if (blob) resolve({image:new Uint8Array(await blob.arrayBuffer()),links});else reject(new Error('Empty report page.'));},'image/jpeg',0.94);
  })));
}

export function imagePdf(pages) {
  const chunks=[],offsets=[0];
  let offset=0;
  function write(value) {
    const content=bytes(value);
    chunks.push(content);offset+=content.length;
  }
  function object(id,...content) {
    offsets[id]=offset;
    write(id+' 0 obj\n');
    for (const part of content) write(part);
    write('\nendobj\n');
  }
  write('%PDF-1.4\n%GraviQuest\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  const ids=pages.map((_,i)=>3+3*i);
  object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+ids.map(id=>id+' 0 R').join(' ')+'] >>');
  let nextAnnotation=3+3*pages.length;
  for (const [index,{image,links}] of pages.entries()) {
    const id=ids[index],name='/Im'+index;
    const annotations=links.map(({rect,href})=>{
      const [x1,y1,x2,y2]=rect;
      const scaled=[x1/pageWidth*595,(1-y2/pageHeight)*842,x2/pageWidth*595,(1-y1/pageHeight)*842].map(value=>value.toFixed(2)).join(' ');
      const uri=Array.from(bytes(href),value=>value.toString(16).padStart(2,'0')).join('');
      const key=nextAnnotation++;
      object(key,'<< /Type /Annot /Subtype /Link /Rect ['+scaled+'] /Border [0 0 0] /A << /S /URI /URI <'+uri+'> >> >>');
      return key+' 0 R';
    });
    const annots=annotations.length?' /Annots ['+annotations.join(' ')+']':'';
    const content='q\n595 0 0 842 0 0 cm\n'+name+' Do\nQ';
    object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << '+name+' '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R'+annots+' >>');
    object(id+1,'<< /Type /XObject /Subtype /Image /Width '+pageWidth*2+' /Height '+pageHeight*2+
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+image.length+' >>\nstream\n',image,'\nendstream');
    object(id+2,'<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');
  }
  const xref=offset;
  write('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
  for (const start of offsets.slice(1)) write(String(start).padStart(10,'0')+' 00000 n \n');
  write('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
  return new Blob(chunks,{type:'application/pdf'});
}
export async function downloadReport(report,format) {
  const blob=format==='pdf'?imagePdf(await reportPages(report)):
    new Blob([markdownReport(report)],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=(report.file.toLowerCase().normalize('NFKC').replace(/[^\p{Letter}\p{Number}-]+/gu,'-').replace(/^-+|-+$/g,'')||'graviquest-report')+'.'+format;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
