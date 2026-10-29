/* Runtime API exposed ONLY inside the sandboxed Lab iframe.
   Simulation authors never need an API key or direct contact with Pulsar.
   Usage: GraviLab.register({controls:[...],layers:[...],section:'intro'});
          GraviLab.emit('density_changed',{density:0.62},'observe');
          GraviLab.onControl(({key,value})=>...); */
(function(){
  'use strict';
  var schema='graviquest.lab.v1';
  var controlListeners=[],commandListeners=[],layerListeners=[],sectionListeners=[],didRegister=false;
  var validKey=/^[a-z][a-z0-9_-]{0,63}$/;
  function send(type,payload){
    if(window.parent===window)return;
    window.parent.postMessage(Object.assign({schema:schema,type:type},payload||{}),'*');
  }
  function cleanMetrics(value){
    var out={};if(!value||typeof value!=='object')return out;
    Object.keys(value).slice(0,12).forEach(function(k){
      var n=value[k];
      if(validKey.test(k)&&typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e12)out[k]=n;
    });return out;
  }
  function safeList(items,type){
    return (Array.isArray(items)?items:[]).slice(0,24).filter(function(x){
      return x&&typeof x==='object'&&validKey.test(String(x.key||''))&&
        (type==='layers'||(Number.isFinite(Number(x.min))&&Number.isFinite(Number(x.max))));
    }).map(function(x){
      return {key:String(x.key),label:String(x.label||x.key).slice(0,90),
        min:Number(x.min)||0,max:Number(x.max)||100,step:Number(x.step)||1,
        value:Number(x.value)||0,enabled:x.enabled!==false};
    });
  }
  // The host controls the iframe viewport. Report the document's natural
  // height so narrow screens can use one page scroll rather than nested scroll.
  // The iframe remains sandboxed; this message grants no DOM access.
  var resizePending=false, lastHeight=0;
  function reportHeight(){
    resizePending=false;
    var html=document.documentElement, body=document.body;
    var height=Math.ceil(Math.max(
      html ? html.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      html ? html.getBoundingClientRect().height : 0
    ));
    if(!Number.isFinite(height)||height<1||height===lastHeight)return;
    lastHeight=height;
    send('lab:resize',{height:height});
  }
  function queueHeight(){
    if(resizePending)return;
    resizePending=true;
    window.requestAnimationFrame(reportHeight);
  }
  function startSizeObserver(){
    queueHeight();
    if(typeof ResizeObserver==='function'){
      var observer=new ResizeObserver(queueHeight);
      observer.observe(document.documentElement);
      if(document.body)observer.observe(document.body);
    }
    window.addEventListener('resize',queueHeight,{passive:true});
    window.addEventListener('load',queueHeight,{once:true});
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',startSizeObserver,{once:true});
  else startSizeObserver();

  window.GraviLab={
    register:function(details){
      didRegister=true;
      details=details||{};
      send('lab:ready',{controls:safeList(details.controls,'controls'),layers:safeList(details.layers,'layers'),
        section:validKey.test(String(details.section||''))?details.section:''});
    },
    emit:function(event,metrics,section){
      if(!validKey.test(String(event||'')))return;
      send('lab:event',{event:String(event),metrics:cleanMetrics(metrics),
        section:validKey.test(String(section||''))?section:''});
    },
    onControl:function(fn){if(typeof fn==='function')controlListeners.push(fn);},
    onCommand:function(fn){if(typeof fn==='function')commandListeners.push(fn);},
    onLayer:function(fn){if(typeof fn==='function')layerListeners.push(fn);},
    onSection:function(fn){if(typeof fn==='function')sectionListeners.push(fn);}
  };
  // Fixed, read-only focus targets: never accept arbitrary selectors from the host.
  // Only the published Science Universe uses this walkthrough; other Labs unaffected.
  var tourTargets=Object.freeze({
    overview:'network-a',play:'play',hypotheses:'hypotheses',policy:'settings',
    quality:'history-chart',network:'network-a',fork:'fork',
    compare:'compare',limits:'methodology'
  });
  var tourTarget='', highlighted=null;
  function focusTourTarget(target){
    if(highlighted){highlighted.classList.remove('gq-lab-tour-highlight');highlighted=null;}
    tourTarget='';
    if(location.pathname.indexOf('/lab-run/science-universe/')!==0||target==='off')return;
    if(!Object.prototype.hasOwnProperty.call(tourTargets,target))return;
    var chosen=document.getElementById(tourTargets[target]);
    if(!chosen||!chosen.getClientRects().length)return;
    if(!document.getElementById('gq-lab-tour-styles')){
      var style=document.createElement('style');
      style.id='gq-lab-tour-styles';
      style.textContent='.gq-lab-tour-highlight{outline:3px solid #e8c78d!important;outline-offset:4px!important;box-shadow:0 0 0 6px rgba(232,199,141,.15)!important;}';
      document.head.append(style);
    }
    tourTarget=target;highlighted=chosen;
    chosen.classList.add('gq-lab-tour-highlight');
    chosen.scrollIntoView({block:'center',behavior:'smooth'});
    requestAnimationFrame(function(){
      if(tourTarget!==target)return;
      var rect=chosen.getBoundingClientRect();
      send('lab:tutorial:position',{target:target,top:Math.max(0,rect.top+window.scrollY)});
    });
  }
  document.addEventListener('click',function(event){
    if(!tourTarget||!highlighted)return;
    if(highlighted===event.target||highlighted.contains(event.target))
      send('lab:tutorial:done',{target:tourTarget});
  },true);
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var data=e.data;if(!data||data.schema!==schema)return;
    if(data.type==='lab:measure'){lastHeight=0;queueHeight();return;}
    if(data.type==='lab:tutorial'){focusTourTarget(String(data.target||''));return;}
    if(data.type==='lab:control'&&validKey.test(String(data.key||''))&&
       typeof data.value==='number'&&Number.isFinite(data.value))
      controlListeners.forEach(function(fn){try{fn({key:data.key,value:data.value});}catch(_){}});
    if(data.type==='lab:command'&&['play','pause','reset','replay'].includes(data.command))
      commandListeners.forEach(function(fn){try{fn(data.command);}catch(_){}});
    if(data.type==='lab:layer'&&validKey.test(String(data.key||'')))
      layerListeners.forEach(function(fn){try{fn({key:data.key,enabled:!!data.enabled});}catch(_){}});
    if(data.type==='lab:section'&&validKey.test(String(data.section||'')))
      sectionListeners.forEach(function(fn){try{fn(data.section);}catch(_){}});
  });
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',function(){if(!didRegister)window.GraviLab.register({});},{once:true});
  else if(!didRegister)window.GraviLab.register({});
})();
