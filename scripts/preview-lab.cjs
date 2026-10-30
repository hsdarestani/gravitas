'use strict';
/* Static browser QA fixture. Backend integration is exercised by Django tests.
   It never uses production records, credentials or a simulated LLM response. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),source=path.join(root,'lab-sources/science-universe');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
const atlas=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'backend/core/data/lab-scenario-atlas.json.gz'))));
const knowledgeRoot=path.join(root,'backend/core/data/lab-knowledge');
const docs=JSON.parse(fs.readFileSync(path.join(knowledgeRoot,'manifest.json'))).documents.map(d=>{
 const markdown=fs.readFileSync(path.join(knowledgeRoot,d.file),'utf8');
 const seen={};const sections=markdown.split(/(?=^#{1,4} )/m).filter(x=>x.trim()).map(text=>{
  const m=text.match(/^(#{1,4}) (.+)/),title=m?m[2]:'Overview';let anchor=title.toLowerCase().replace(/[^\w\s-]/g,'').replace(/[-\s]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
  seen[anchor]=(seen[anchor]||0)+1;if(seen[anchor]>1)anchor+='-'+seen[anchor];
  return {title,anchor,level:m?m[1].length:1,text};});return {...d,markdown,sections,version:1};
});
const lab={...manifest,ready:true,published_version:1,version:1,run_url:'/lab-run/science-universe/'};
const portArg=process.argv.indexOf('--port'),port=portArg>=0?Number(process.argv[portArg+1]):Number(process.env.PORT||3000);
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(p==='/api/labs/')return json(res,{ok:true,labs:[lab]});
 if(/\/coach\/$/.test(p))return json(res,{ok:true,provider:'script',reply:'Live Pulsar is unavailable in the local QA fixture. Scientific sources and model interactions are available.'});
 if(/\/snapshots\/$/.test(p))return json(res,{ok:false,error:'authentication_required'},401);
 if(p==='/api/labs/science-universe/knowledge/')return json(res,{ok:true,documents:docs});
 const document=p.match(/^\/api\/labs\/science-universe\/knowledge\/([a-z0-9-]+)\/$/);
 if(document){const doc=docs.find(d=>d.slug===document[1]);if(!doc)return json(res,{ok:false},404);if(url.searchParams.get('format')==='md'){res.writeHead(200,{'Content-Type':'text/markdown'});return res.end(doc.markdown);}return json(res,{ok:true,document:doc});}
 if(p==='/api/labs/science-universe/scenarios/'){
  const family=url.searchParams.get('family')||'',offset=Number(url.searchParams.get('offset'))||0,rows=atlas.runs.filter(x=>!family||x.family===family),examples=rows.slice(offset,offset+36);
  return json(res,{ok:true,runs_for_current_engine:atlas.runs.length,policy_combinations:atlas.policy_combinations,coverage:atlas.coverage,limits:'Seeds, time, interventions and checkpoints add further states. No exhaustive coverage claim.',families:[...new Set(atlas.runs.map(x=>x.family))],examples,next_offset:examples.length===36?offset+36:null});
 }
 let file;
 if(p.startsWith('/lab-run/science-universe/'))file=path.join(source,p.slice('/lab-run/science-universe/'.length)||'index.html');
 else file=path.resolve(root,'.'+(p==='/'?'/lab.html':p));
 if(!file.startsWith(root+path.sep)||p.startsWith('/backend/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
 const ext=path.extname(file),type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[ext]||'application/octet-stream';
 res.setHeader('Content-Type',type);res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
 let data=fs.readFileSync(file);
 if(p.startsWith('/lab-run/')&&ext==='.html'){
  res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'self'");
  data=data.toString().replace('<head>','<head><script>'+fs.readFileSync(path.join(root,'assets/lab-bridge.js'),'utf8')+'</script>')
    .replace('<link rel="stylesheet" href="styles.css">','<style>'+fs.readFileSync(path.join(source,'styles.css'),'utf8')+'</style>')
    .replace('<script src="engine.js"></script>','<script>'+fs.readFileSync(path.join(source,'engine.js'),'utf8')+'</script>')
    .replace('<script src="app.js"></script>','<script>'+fs.readFileSync(path.join(source,'app.js'),'utf8')+'</script>');
 }res.end(data);
}).listen(port,'0.0.0.0',()=>console.log('Local: http://0.0.0.0:'+port));
