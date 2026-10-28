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
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var data=e.data;if(!data||data.schema!==schema)return;
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
