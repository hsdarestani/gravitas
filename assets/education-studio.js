/* Pulsar × Simulation. Prepared lessons are local; only the question form calls Pulsar. */
(function(){
  'use strict';
  const root=document.getElementById('education-lab');if(!root)return;
  const catalog=window.GQEducationCatalog,models=window.GQEducationModels,de=document.documentElement.lang==='de';
  const L=(a,b)=>de?b:a,$=id=>document.getElementById(id);
  const labels={acceleration:L('Acceleration','Beschleunigung'),normal:L('Normal force N','Normalkraft N'),parallel:L('Downhill weight F∥','Hangabtriebskraft F∥'),friction:L('Friction force','Reibungskraft'),staticLimit:L('Static limit μₛN','Haftgrenze μₛN'),critical:L('Critical angle','Grenzwinkel'),equilibriumA:L('Equilibrium [A]','Gleichgewicht [A]'),equilibriumB:L('Equilibrium [B]','Gleichgewicht [B]'),halfTime:L('Relaxation half-time','Relaxationshalbwertszeit'),total:L('Total concentration','Gesamtkonzentration'),last:L('Final x','Letztes x'),nearby:L('Nearby final x','Benachbartes letztes x'),separation:L('Final separation','Endabstand'),rate:'r',nominal:L('Nominal balance','Nominales Guthaben'),real:L('Purchasing power','Kaufkraft'),contributed:L('Total contributed','Gesamteinzahlungen'),growth:L('Nominal growth','Nominaler Zuwachs'),R0:'R₀ = β/γ',peak:L('Peak infected','Maximal infiziert'),susceptible:L('Susceptible at day 160','Anfällig an Tag 160'),recovered:L('Recovered at day 160','Genesen an Tag 160'),frequency:L('Frequency','Frequenz'),damping:L('Damping ratio ζ','Dämpfungsgrad ζ'),coefficient:L('Damping coefficient c','Dämpfungskoeffizient c'),final:L('Displacement at 10 s','Auslenkung bei 10 s'),utilization:L('Utilization ρ','Auslastung ρ'),meanWait:L('Observed mean queue wait','Beobachtete mittlere Wartezeit'),expectedWait:L('Stationary mean queue wait','Stationäre mittlere Wartezeit'),max:L('Maximum jobs in system','Maximale Aufträge im System'),unhappy:L('Dissatisfied at end','Am Ende unzufrieden'),initialUnhappy:L('Initially dissatisfied','Anfangs unzufrieden'),similarity:L('Mean neighbour similarity','Mittlere Nachbarähnlichkeit'),population:L('Agents (conserved)','Agenten (erhalten)'),steady:L('Passive steady voltage','Passive stationäre Spannung'),threshold:L('Firing threshold','Feuerschwelle'),spikes:L('Spikes in 200 ms','Spikes in 200 ms'),velocity:L('Velocity','Geschwindigkeit'),A:'[A]',B:'[B]',trajectory:L('Trajectory','Verlauf'),nominal:L('Nominal balance','Nominales Guthaben'),infected:L('Infected','Infiziert'),displacement:L('Displacement','Auslenkung'),inSystem:L('Jobs in system','Aufträge im System'),voltage:L('Membrane voltage','Membranspannung')};
  const units={acceleration:'m/s²',normal:'N',parallel:'N',friction:'N',staticLimit:'N',critical:'°',equilibriumA:'mol/L',equilibriumB:'mol/L',halfTime:'s',total:'mol/L',nominal:de?'WE':'CU',real:de?'WE':'CU',contributed:de?'WE':'CU',growth:de?'WE':'CU',peak:'%',susceptible:'%',recovered:'%',frequency:'Hz',coefficient:'N·s/m',final:'m',meanWait:'s',expectedWait:'s',similarity:'%',steady:'mV',threshold:'mV'};
  const format=(x,d=2)=>Number(x).toLocaleString(de?'de-DE':'en-GB',{maximumFractionDigits:d,minimumFractionDigits:d});
  let id='physics',config,params,result,baseline=null,comparison=null,lessonIndex=0,prediction=null,tested=false,experimentParams=null;
  let elapsed=0,playing=false,raf=0,lastFrame=0,controller=null,thread=typeof crypto.randomUUID==='function'?crypto.randomUUID():String(Date.now()),history=[];
  root.innerHTML=`
    <div class="el-top"><span class="el-signature"><img src="assets/logos/Pulsar_White.svg" alt="" width="26" height="26"> PULSAR <span>×</span> SIMULATION</span><span>${L('A working learning studio','Ein interaktives Lernstudio')}</span></div>
    <div class="el-selector"><label for="el-discipline">${L('Choose your discipline','Fachgebiet wählen')}</label><select id="el-discipline">${Object.entries(catalog).map(([key,c],i)=>`<option value="${key}">${String(i+1).padStart(2,'0')} / ${c.name}</option>`).join('')}</select><span class="el-micro">${L('9 disciplines · 9 working models','9 Fachgebiete · 9 interaktive Modelle')}</span></div>
    <div class="el-columns"><div class="el-experiment"><p class="el-eyebrow" id="el-subject"></p><h3 id="el-title"></h3><p id="el-subtitle"></p>
      <div class="el-stage" id="el-stage"></div><div class="el-transport" id="el-transport"><button type="button" id="el-play">${L('Play motion','Bewegung starten')}</button><button type="button" id="el-rewind">${L('Rewind','Zurücksetzen')}</button><label><input type="checkbox" id="el-vectors" checked> ${L('Weight components','Gewichtskomponenten')}</label><output id="el-time"></output></div>
      <div class="el-chart" id="el-chart"></div><div class="el-controls" id="el-controls"></div><p class="el-hint" id="el-hint" role="status"></p>
      <dl class="el-readings" id="el-readings"></dl><p class="el-equation" id="el-equation"></p>
      <details class="el-assumptions"><summary>${L('Model & assumptions','Modell & Annahmen')}</summary><p id="el-limits"></p></details>
    </div><aside class="el-tutor" aria-label="${L('Pulsar learning guide','Pulsar-Lernbegleitung')}">
      <div class="el-tutor-head"><img src="assets/logos/Pulsar_White.svg" alt="" width="36" height="36"><div><strong>Pulsar</strong><span>${L('Think. Test. Explain.','Denken. Testen. Erklären.')}</span></div></div>
      <div class="el-guide"><div class="el-guide-label">${L('PREPARED LEARNING SCENARIO · LOCAL','VORBEREITETES LERNSZENARIO · LOKAL')}</div><label for="el-lesson">${L('Choose a guided experiment','Geführtes Experiment wählen')}</label><select id="el-lesson"></select>
        <ol class="el-steps" aria-label="${L('Learning steps','Lernschritte')}"><li id="el-step1" aria-current="step">${L('Predict','Vermuten')}</li><li id="el-step2">${L('Experiment','Experimentieren')}</li><li id="el-step3">${L('Reflect','Reflektieren')}</li></ol>
        <p class="el-question" id="el-question"></p><div class="el-choices" id="el-choices"></div><button type="button" class="el-primary" id="el-test" disabled>${L('Run the comparison','Vergleich ausführen')} ↗</button>
        <div id="el-evidence" class="el-evidence" hidden><p id="el-feedback" role="status"></p><div class="el-table-wrap"><table><caption>${L('Two runs · one changed parameter','Zwei Läufe · ein geänderter Parameter')}</caption><thead><tr><th scope="col">${L('Reading','Messwert')}</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody id="el-comparison"></tbody></table></div><p id="el-explanation"></p><label for="el-reflection" id="el-reflection-label"></label><textarea id="el-reflection" rows="2" maxlength="800"></textarea><button type="button" id="el-reflect">${L('Check my reasoning with Pulsar','Meine Begründung mit Pulsar prüfen')}</button><p class="el-micro">${L('Uses the live service below. Your reflection is sent only when you choose this button.','Nutzt den Dienst unten. Ihre Reflexion wird nur beim Betätigen dieser Schaltfläche gesendet.')}</p></div>
        <button type="button" id="el-restart" class="el-text-button">${L('Restart this scenario','Szenario neu starten')}</button>
      </div>
      <div class="el-chat"><div class="el-chat-label"><strong>${L('Ask your own question','Stellen Sie Ihre eigene Frage')}</strong><span id="el-api-status">${L('Live replies via Pulsar API','Live-Antworten über die Pulsar-API')}</span></div><p class="el-micro">${L('Ask about a parameter, a result or an assumption. Pulsar receives the model readings attached to your question.','Fragen Sie nach Parametern, Ergebnissen oder Annahmen. Pulsar erhält die zu Ihrer Frage gehörenden Modellwerte.')}</p><div class="el-chat-log" id="el-chat-log" role="log" aria-label="${L('Pulsar conversation','Pulsar-Gespräch')}" aria-live="polite" aria-relevant="additions"></div>
      <form id="el-chat-form"><label for="el-message">${L('Your question to Pulsar','Ihre Frage an Pulsar')}</label><textarea id="el-message" rows="2" maxlength="1000" placeholder="${L('Why does the block stay still?','Warum bleibt der Körper in Ruhe?')}" required></textarea><div class="el-send-row"><span>${L('Enter ↵ to send · Shift+Enter for a new line','Enter ↵ zum Senden · Umschalt+Enter für eine neue Zeile')}</span><button type="submit" class="el-primary" id="el-send">${L('Ask Pulsar','Pulsar fragen')} ↗</button><button type="button" id="el-cancel" hidden>${L('Cancel','Abbrechen')}</button></div></form>
      <p class="el-micro">${L('When you send, your question, recent conversation and current model snapshot go to GraviQuest’s existing Pulsar service. Replies may be unavailable or mistaken. No reply is represented as live AI unless the service identifies a model provider.','Beim Senden gehen Frage, jüngstes Gespräch und aktuelle Modellwerte an den bestehenden Pulsar-Dienst von GraviQuest. Antworten können ausfallen oder falsch sein. Nur vom Dienst als Modellantwort gekennzeichnete Antworten werden als Live-KI ausgewiesen.')}</p></div>
    </aside></div>`;
  function metric(key,value){return value===null?L('No stationary mean','Kein stationärer Mittelwert'):format(value,key==='separation'?6:2)+(units[key]?' '+units[key]:'');}
  function defaults(){return Object.fromEntries(config.controls.map(c=>[c.key,c.value]));}
  function lesson(){return config.lessons[lessonIndex];}
  function calculate(p){return models[config.model](p);}
  function stop(){playing=false;cancelAnimationFrame(raf);$('el-play').textContent=L('Play motion','Bewegung starten');}
  function clearEvidence(){baseline=null;comparison=null;experimentParams=null;tested=false;prediction=null;$('el-evidence').hidden=true;$('el-test').disabled=true;$('el-test').textContent=L('Run the comparison','Vergleich ausführen');}
  function newLesson(){stop();elapsed=0;params={...defaults(),...(lesson().baseline||{})};clearEvidence();renderControls();renderChoices();render();$('el-reflection').value='';$('el-hint').textContent=L('Predict first, or explore the controls freely. The guided comparison resets to its declared baseline.','Zuerst vermuten oder die Regler frei erkunden. Der geführte Vergleich setzt seine Ausgangswerte zurück.');}
  function renderChoices(){
    $('el-question').textContent=lesson().question;
    $('el-choices').replaceChildren();lesson().choices.forEach((text,index)=>{const button=document.createElement('button');button.type='button';button.className='el-choice';button.textContent=text;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{if(tested)return;prediction=index;for(const b of $('el-choices').children)b.setAttribute('aria-pressed',String(b===button));$('el-test').disabled=false;step(2);});$('el-choices').append(button);});step(1);
  }
  function step(n){for(let i=1;i<=3;i++)if(i===n)$('el-step'+i).setAttribute('aria-current','step');else $('el-step'+i).removeAttribute('aria-current');}
  function renderControls(){
    $('el-controls').innerHTML=config.controls.map(c=>`<div class="el-control"><label for="el-param-${c.key}">${c.label}<output id="el-out-${c.key}" for="el-param-${c.key}"></output></label><input type="range" id="el-param-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" value="${params[c.key]}"></div>`).join('');
    for(const c of config.controls)$('el-param-'+c.key).addEventListener('input',event=>{
      stop();elapsed=0;params[c.key]=Number(event.target.value);
      let frictionAdjusted=false;
      if(id==='physics'&&params.kinetic>params.static){if(c.key==='kinetic')params.static=params.kinetic;else params.kinetic=params.static;frictionAdjusted=true;}
      $('el-hint').textContent=frictionAdjusted?L('Adjusted the other friction coefficient to keep μₖ ≤ μₛ. Motion restarts from rest.','Der andere Reibungskoeffizient wurde angepasst, damit μₖ ≤ μₛ gilt. Neustart aus der Ruhe.'):L('Exploration updated. Prepared comparison A/B stays attached to the original experiment.','Erkundung aktualisiert. Der vorbereitete A/B-Vergleich bleibt beim ursprünglichen Experiment.');render();
    });
  }
  function chart(output){
    const sets=output.series,points=sets.flatMap(s=>s.points),xmin=0,xmax=Math.max(1,...points.map(p=>p[0]));
    let ymin=Math.min(0,...points.map(p=>p[1])),ymax=Math.max(...points.map(p=>p[1]));if(ymax-ymin<1e-8)ymax=ymin+1;const pad=(ymax-ymin)*.08;if(ymin<0)ymin-=pad;ymax+=pad;
    const X=x=>52+x/xmax*536,Y=y=>208-(y-ymin)/(ymax-ymin)*170;
    const tick=x=>Math.abs(x)>=1000?format(x/1000,1)+'k':format(x,Math.abs(x)<1?2:1);
    const unit=u=>({CU:L('CU','WE'),fraction:L('fraction','Anteil'),jobs:L('jobs','Aufträge'),agents:L('agents','Agenten'),step:L('step','Schritte'),yr:L('yr','Jahre')})[u]||u;
    $('el-chart').innerHTML=`<svg viewBox="0 0 620 248" role="img" aria-labelledby="el-chart-title"><title id="el-chart-title">${config.title} · ${L('computed model trajectory','berechneter Modellverlauf')} (${unit(output.xUnit)}, ${unit(output.yUnit)})</title><g class="el-grid">${Array.from({length:5},(_,i)=>`<path d="M52 ${38+i*42.5}H588"/>`).join('')}</g><g class="el-axis"><text x="52" y="22">${unit(output.yUnit)}</text><text x="48" y="42" text-anchor="end">${tick(ymax)}</text><text x="48" y="209" text-anchor="end">${tick(ymin)}</text><text x="52" y="232">0</text><text x="588" y="232" text-anchor="end">${tick(xmax)} ${unit(output.xUnit)}</text></g>${sets.map((s,index)=>`<path class="el-line el-line-${index}" d="${s.points.map(([x,y],i)=>(i?'L':'M')+X(x).toFixed(2)+' '+Y(y).toFixed(2)).join(' ')}"/>`).join('')}</svg><div class="el-legend">${sets.map((s,i)=>`<span class="el-key el-key-${i}">${labels[s.name]||s.name}</span>`).join('')}</div>`;
  }
  function inclineScene(){
    const a=params.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=95,y=345-330*s,along=8+Math.min(12,.5*result.metrics.acceleration*elapsed*elapsed)/12*302;
    const bx=x+along*c+17*s,by=y+along*s-17*c,scale=77/Math.max(result.weight,1);
    const vector=(name,dx,dy,magnitude,cls)=>magnitude<1e-8?'':`<g class="el-vector ${cls}"><path d="M${bx} ${by}l${dx*magnitude*scale} ${dy*magnitude*scale}" marker-end="url(#el-arrow)"/><text x="${bx+dx*magnitude*scale+8}" y="${by+dy*magnitude*scale-7}">${name}</text></g>`;
    const components=$('el-vectors').checked;
    const motionVector=(label,originY,value)=>value>1e-8?`<g class="el-vector"><path d="M440 ${originY}l${c*Math.min(65,value*10)} ${s*Math.min(65,value*10)}" marker-end="url(#el-arrow)"/><text x="430" y="${originY-12}">${label}</text></g>`:'';
    $('el-stage').innerHTML=`<svg viewBox="0 0 620 410" role="img" aria-labelledby="el-scene-title"><title id="el-scene-title">${L('Inclined plane and force vectors','Schiefe Ebene und Kraftvektoren')}: ${params.angle}°, ${L('acceleration','Beschleunigung')} ${format(result.metrics.acceleration)} m/s²</title><defs><marker id="el-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="context-stroke"/></marker></defs><g class="el-scene-grid">${[90,170,250,330].map(v=>`<path d="M45 ${v}H580"/>`).join('')}</g><path class="el-ramp-fill" d="M${x} ${y}L${x+330*c} 345H${x}Z"/><path class="el-ramp" d="M${x} ${y}L${x+330*c} 345M55 346H560"/><text class="el-scene-note" x="${x+330*c+12}" y="368">θ = ${params.angle}°</text><g transform="translate(${bx},${by}) rotate(${params.angle})"><rect class="el-block" x="-21" y="-16" width="42" height="32" rx="5"/><text class="el-block-label" text-anchor="middle" y="4">${params.mass} kg</text></g>${vector('mg',0,1,result.weight,'el-weight')}${vector('N',s,-c,result.metrics.normal,'el-normal')}${vector('Ff',-c,-s,result.metrics.friction,'el-friction')}${components?vector('F∥',c,s,result.metrics.parallel,'el-component')+vector('F⊥',-s,c,result.metrics.normal,'el-component'):''}${motionVector('a',96,result.metrics.acceleration)}${motionVector('v',176,result.metrics.acceleration*elapsed)}<text class="el-scene-status" x="42" y="35">${result.moving?L('SLIDING','GLEITEN'):L('AT REST','IN RUHE')}</text><text class="el-scene-note" x="42" y="58">a = ${format(result.metrics.acceleration)} m/s²</text><text class="el-scene-note" x="42" y="395">${L('12 m track · release from rest','12-m-Bahn · Start aus der Ruhe')}</text></svg>`;
    $('el-time').textContent=`t ${format(elapsed)} s · v ${format(result.metrics.acceleration*elapsed)} m/s · x ${format(.5*result.metrics.acceleration*elapsed*elapsed)} m`;
  }
  function stage(){
    $('el-transport').hidden=id!=='physics';$('el-stage').hidden=!['physics','chemistry','sociology','engineering','neuroscience'].includes(id);
    if(id==='physics'){inclineScene();return;}
    if(id==='sociology'){
      const grid=g=>`<div class="el-agent-grid" role="img" aria-label="${L('Abstract two-type agent grid; vacancies are empty','Abstraktes Gitter mit zwei Agententypen; Leerstellen sind leer')}">${g.map(v=>`<i class="el-agent el-agent-${v}"></i>`).join('')}</div>`;
      $('el-stage').innerHTML=`<div class="el-agent-pair"><figure>${grid(result.initial)}<figcaption>${L('Initial · seed 73','Start · Seed 73')}</figcaption></figure><figure>${grid(result.grid)}<figcaption>${L('After 35 sweeps','Nach 35 Schritten')}</figcaption></figure></div>`;
    }else if(id==='chemistry'){
      const fraction=result.metrics.equilibriumA/params.total;
      $('el-stage').innerHTML=`<div class="el-reaction"><span>A</span><span>⇌</span><span>B</span></div><div class="el-concentration"><div style="width:${fraction*100}%">A ${format(fraction*100,0)}%</div><div style="width:${(1-fraction)*100}%">B ${format((1-fraction)*100,0)}%</div></div><p class="el-stage-caption">${L('Equilibrium composition · the curves below show the approach','Gleichgewichtszusammensetzung · die Kurven zeigen die Annäherung')}</p>`;
    }else if(id==='engineering'){
      $('el-stage').innerHTML=`<svg viewBox="0 0 620 130" role="img" aria-label="${L('Spring mass damper schematic','Schema Feder-Masse-Dämpfer')}"><g class="el-ramp"><path d="M60 20V110M60 65h30l10-22 20 44 20-44 20 44 20-44 20 44 10-22h50M60 100h500"/><rect x="260" y="35" width="62" height="62" rx="5"/><path d="M350 65h120" /></g><text class="el-axis" x="360" y="47">x₀ = 1 m · v₀ = 0</text></svg>`;
    }else $('el-stage').innerHTML=`<div class="el-neuron"><span>∫</span><span>V ≥ −50 mV</span><span>↳ ${L('reset + 2 ms refractory','Reset + 2 ms Refraktärzeit')}</span></div>`;
  }
  function render(){
    result=calculate(params);
    for(const c of config.controls){$('el-param-'+c.key).value=params[c.key];$('el-out-'+c.key).textContent=format(params[c.key],c.step<1?2:0)+(c.unit?' '+(de&&c.unit==='CU'?'WE':c.unit):'');}
    $('el-readings').innerHTML=config.metric.map(k=>`<div><dt>${labels[k]}</dt><dd>${metric(k,result.metrics[k])}</dd></div>`).join('');
    chart(result);stage();
  }
  function choose(key,updateURL=true){
    if(!catalog[key])key='physics';if(controller){controller.abort();controller=null;}busy(false);stop();id=key;config=catalog[id];lessonIndex=0;history=[];$('el-chat-log').replaceChildren();
    $('el-api-status').textContent=L('Live replies via Pulsar API','Live-Antworten über die Pulsar-API');$('el-discipline').value=id;
    $('el-subject').textContent=config.name;$('el-title').textContent=config.title;$('el-subtitle').textContent=config.subtitle;$('el-equation').textContent=config.formula;$('el-limits').textContent=config.limits;
    $('el-lesson').innerHTML=config.lessons.map((s,i)=>`<option value="${i}">${s.title}</option>`).join('');
    $('el-message').placeholder=L('What explains this result?','Wie lässt sich dieses Ergebnis erklären?');
    if(updateURL){const url=new URL(location.href);url.searchParams.set('demo',id);url.hash='erleben';window.history.replaceState(null,'',url);}
    document.querySelectorAll('[data-demo]').forEach(a=>a.setAttribute('aria-current',a.dataset.demo===id?'true':'false'));
    syncLanguageLinks();newLesson();
  }
  function syncLanguageLinks(){document.querySelectorAll('[data-lang-switch]').forEach(a=>{const url=new URL(a.href,location.href);url.search=location.search;url.hash=location.hash;a.href=url.pathname+url.search+url.hash;});}
  $('el-discipline').addEventListener('change',e=>choose(e.target.value));$('el-lesson').addEventListener('change',e=>{lessonIndex=Number(e.target.value);newLesson();});$('el-restart').addEventListener('click',newLesson);
  $('el-test').addEventListener('click',()=>{
    if(prediction===null||tested)return;stop();elapsed=0;tested=true;
    const before={...defaults(),...(lesson().baseline||{})};params={...before,...lesson().patch};experimentParams={before:{...before},after:{...params}};baseline=calculate(before);comparison=calculate(params);
    $('el-evidence').hidden=false;$('el-test').disabled=true;$('el-test').textContent=L('Comparison complete','Vergleich abgeschlossen');
    for(const b of $('el-choices').children)b.disabled=true;
    $('el-feedback').textContent=prediction===lesson().correct?L('Your prediction agrees with this model. Now explain the evidence.','Ihre Vermutung stimmt mit diesem Modell überein. Begründen Sie nun anhand der Ergebnisse.'):L('The model challenges your prediction. Compare A and B before revising your reasoning.','Das Modell widerspricht Ihrer Vermutung. Vergleichen Sie A und B und überdenken Sie Ihre Begründung.');
    $('el-comparison').innerHTML=config.metric.map(k=>`<tr><th scope="row">${labels[k]}</th><td>${metric(k,baseline.metrics[k])}</td><td>${metric(k,comparison.metrics[k])}</td></tr>`).join('');
    $('el-explanation').textContent=lesson().explanation;$('el-reflection-label').textContent=lesson().reflection;step(3);render();
    $('el-hint').textContent=L('A/B readings are frozen. Continue exploring, or explain the result to Pulsar.','A/B-Messwerte sind eingefroren. Erkunden Sie weiter oder erklären Sie Pulsar das Ergebnis.');
  });
  $('el-vectors').addEventListener('change',stage);$('el-rewind').addEventListener('click',()=>{stop();elapsed=0;stage();});
  $('el-play').addEventListener('click',()=>{
    if(playing){stop();return;}if(elapsed>=result.metrics.duration)elapsed=0;playing=true;lastFrame=0;$('el-play').textContent=L('Pause motion','Bewegung pausieren');
    const frame=now=>{if(!playing)return;if(lastFrame)elapsed=Math.min(result.metrics.duration,elapsed+Math.min((now-lastFrame)/1000,.05));lastFrame=now;stage();if(elapsed>=result.metrics.duration){stop();return;}raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  function addMessage(who,text){const item=document.createElement('div');item.className='el-message';const label=document.createElement('strong'),body=document.createElement('p');label.textContent=who;body.textContent=text;item.append(label,body);$('el-chat-log').append(item);while($('el-chat-log').children.length>30)$('el-chat-log').firstElementChild.remove();item.scrollIntoView({block:'nearest',behavior:'instant'});}
  function busy(on){$('el-send').disabled=on;$('el-reflect').disabled=on;$('el-cancel').hidden=!on;$('el-chat-form').setAttribute('aria-busy',String(on));}
  function snapshot(){return {model:id,parameters:{...params},readings:{...result.metrics},assumptions:config.limits,preparedScenario:lesson().title,prediction:prediction===null?null:lesson().choices[prediction],comparison:comparison?{parameters:experimentParams,A:baseline.metrics,B:comparison.metrics}:null};}
  async function ask(question){
    if(controller||!question.trim())return;const snapshotData=snapshot(),request=new AbortController();controller=request;busy(true);
    const timer=setTimeout(()=>request.abort('timeout'),22000);addMessage(L('YOU','SIE'),question);
    const prompt=question+'\n\n'+L('Context for my educational question (browser model, not empirical evidence). Explain using these values; distinguish current exploration from the frozen A/B experiment. Help me reason, and state relevant model limits. Do not claim to run experiments.\n','Kontext meiner Lernfrage (Browsermodell, keine empirischen Daten). Erklären Sie anhand dieser Werte; unterscheiden Sie die aktuelle Erkundung vom eingefrorenen A/B-Experiment. Unterstützen Sie meine Begründung und nennen Sie relevante Modellgrenzen. Behaupten Sie nicht, Experimente auszuführen.\n')+JSON.stringify(snapshotData);
    try{
      const response=await fetch('/api/pulsar/ask/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:prompt.slice(0,4000),page:location.pathname,page_context:{heading:'GraviQuest Education · '+config.name},locale:de?'de':'en',thread_id:'education-'+thread,history:history.slice(-6)}),signal:request.signal});
      if(!response.ok)throw new Error(String(response.status));const data=await response.json();if(controller!==request)return;
      if(!data.ok||typeof data.reply!=='string'||!data.reply.trim())throw new Error('empty');
      const live=typeof data.provider==='string'&&!!data.provider&&!['fallback','public_navigation','scripted','unavailable'].includes(data.provider);
      const provenance=live?L('PULSAR · LIVE AI','PULSAR · LIVE-KI'):L('PULSAR · SERVICE MESSAGE, NOT LIVE AI','PULSAR · DIENSTMELDUNG, KEINE LIVE-KI');
      addMessage(provenance+' · '+catalog[snapshotData.model].name,data.reply);$('el-api-status').textContent=live?L('Live model reply received','Live-Modellantwort empfangen'):L('Live model unavailable · prepared lessons still work','Live-Modell nicht verfügbar · vorbereitete Lektionen funktionieren');
      if(live){history.push({role:'user',content:question.slice(0,700)},{role:'assistant',content:data.reply.slice(0,700)});history=history.slice(-6);}
    }catch(error){if(controller!==request)return;addMessage(L('CONNECTION STATUS','VERBINDUNGSSTATUS'),request.signal.aborted?L('Request stopped or timed out. Your question is still in the input; you can retry.','Anfrage gestoppt oder Zeitlimit erreicht. Ihre Frage bleibt im Eingabefeld; Sie können erneut senden.'):L('Pulsar could not answer this request. Your question is still in the input. The local model and prepared scenarios remain available.','Pulsar konnte diese Anfrage nicht beantworten. Ihre Frage bleibt im Eingabefeld. Das lokale Modell und die vorbereiteten Szenarien bleiben verfügbar.'));$('el-api-status').textContent=L('No live answer received','Keine Live-Antwort empfangen');
    }finally{clearTimeout(timer);if(controller===request){controller=null;busy(false);}}
  }
  $('el-chat-form').addEventListener('submit',event=>{event.preventDefault();ask($('el-message').value.trim().slice(0,1000));});
  $('el-message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('el-chat-form').requestSubmit();}});
  $('el-cancel').addEventListener('click',()=>{if(controller)controller.abort();});
  $('el-reflect').addEventListener('click',()=>{const text=$('el-reflection').value.trim();if(!text){$('el-reflection').focus();return;}$('el-message').value=lesson().reflection+'\n'+text;ask($('el-message').value.slice(0,1000));});
  document.querySelectorAll('[data-demo]').forEach(a=>a.addEventListener('click',event=>{event.preventDefault();choose(a.dataset.demo);$('education-lab').scrollIntoView({block:'start',behavior:'instant'});}));
  window.addEventListener('popstate',()=>{const next=new URL(location.href).searchParams.get('demo')||'physics';if(next!==id)choose(next,false);syncLanguageLinks();});
  choose(new URL(location.href).searchParams.get('demo')||'physics',false);
  if(new URL(location.href).searchParams.has('demo')&&location.hash==='#erleben')requestAnimationFrame(()=>root.scrollIntoView({block:'start',behavior:'instant'}));
})();
