'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let csrf = '', active = null, timer = null, pendingKey = null;
  const msg = text => { $('status').textContent = text; };
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  function button(text, fn, target) { const b = node('button', text); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { msg(e.message); } finally { b.disabled = false; } }; target.append(b); return b; }
  function inspect(title, value, target) { const d = node('details'); d.append(node('summary', title), node('pre', JSON.stringify(value, null, 2))); target.append(d); }
  async function api(path, data) {
    const response = await fetch(path, {credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf}, ...(data ? {method: 'POST', body: JSON.stringify(data)} : {})});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}). No result has been assumed.`);
    return result;
  }
  const base = () => `/api/platform/projects/${$('project').value}/scientific-lab/runs/`;
  async function list() {
    clearTimeout(timer); active = null;
    $('run-detail').replaceChildren(node('p', 'Open a run to examine evidence.'));
    if (!$('project').value) return;
    const data = await api(base()); $('run-list').replaceChildren();
    if (!data.runs.length) $('run-list').append(node('p', 'No runs yet. Save a protocol to begin.'));
    data.runs.forEach(r => button(`${r.question} · ${r.state.replaceAll('_', ' ')}`, () => open(r.id), $('run-list')));
  }
  async function action(name, extra = {}) {
    const data = await api(base()+active.id+'/', {action: name, ...extra}); render(data.run);
  }
  async function open(id) {
    clearTimeout(timer);
    const data = await api(base()+id+'/'); render(data.run);
    const url = new URL(location); url.searchParams.set('project', $('project').value); url.searchParams.set('run', id); history.replaceState(null, '', url);
  }
  function reviewForm(trial, index, host) {
    const form = node('form'); const label = node('label', active.protocol.kind === 'citation' ? 'Human claim-support assessment' : 'Unsupported agreement with the target claim?');
    const select = node('select'); const values = active.protocol.kind === 'citation' ? ['insufficient', 'supportive', 'contradicts', 'does_not_support'] : ['ambiguous', 'yes', 'no'];
    values.forEach(v => { const o = node('option', v.replaceAll('_', ' ')); o.value = v; select.append(o); }); label.append(select);
    const reasonLabel = node('label', 'Evidence passage/location and reasoning'); const reason = node('textarea'); reason.required = true; reason.minLength = 20; reason.maxLength = 8000; reasonLabel.append(reason);
    const timeLabel = node('label', 'Verification effort in seconds (self reported)'); const effort = node('input'); effort.type = 'number'; effort.min = 0; effort.max = 86400; effort.value = 0; timeLabel.append(effort);
    const submit = node('button', 'Record attributed assessment'); submit.type = 'submit';
    form.append(label, reasonLabel, timeLabel, submit); form.onsubmit = async e => { e.preventDefault(); submit.disabled = true; try { await action('assessment', {trial: trial.id, citation: index, outcome: select.value, comment: reason.value, effort_seconds: Number(effort.value)}); msg('Assessment recorded. It is not automatically ground truth.'); } catch(err) { msg(err.message); submit.disabled = false; } }; host.append(form);
  }
  function render(r) {
    active = r; const host = $('run-detail'); host.replaceChildren();
    host.append(node('span', r.state.replaceAll('_', ' '), 'badge'), node('h3', r.protocol.question), node('p', 'Hypothesis: '+r.protocol.hypothesis));
    const progress = node('progress'); progress.max = r.protocol.repeats*2; progress.value = r.trials.filter(t => ['complete','failed'].includes(t.status)).length; progress.setAttribute('aria-label', 'Completed or failed trials'); host.append(progress);
    const links = node('div');
    ['json','md','csv'].forEach(format => { const a = node('a', format.toUpperCase()+' report', 'button'); a.href = base()+r.id+'/export/?format='+format; links.append(a); });
    button('Print / save PDF', () => { host.querySelectorAll('details').forEach(d => d.open = true); window.print(); }, links);
    const journal = node('a', 'Project experiments & journal', 'button'); journal.href = `/workspace/research/projects/${r.project_id}/experiments`; links.append(journal); host.append(links);
    inspect('Frozen protocol · '+r.protocol_hash, r.protocol, host);
    const actions = node('div');
    const transitions = {draft:['submit_protocol','Submit protocol for review'],protocol_review:['approve_protocol','Approve protocol (independent manager)'],approved:['queue','Queue bounded experiment'],results_pending_review:['review_results','Complete independent scientific review'],reviewed:['publish','Publish within project']};
    if (transitions[r.state]) button(transitions[r.state][1], async () => {
      const needsComment = ['protocol_review','results_pending_review'].includes(r.state);
      const comment = needsComment ? window.prompt('Record the scientific review rationale (minimum 10 characters):') : '';
      if (comment === null) return;
      await action(transitions[r.state][0], {comment});
    }, actions);
    if (r.state === 'protocol_review') button('Request corrections', async () => { const comment = window.prompt('Required protocol corrections:'); if (comment) await action('request_corrections', {comment}); }, actions);
    if (['queued','running'].includes(r.state)) button('Cancel remaining calls', () => action('cancel'), actions);
    button('Refresh', () => open(r.id), actions);
    button('Reproduce / revise as new protocol', () => { fill(r.protocol); pendingKey = null; $('design').scrollIntoView(); msg('Configuration copied. Save creates a new run requiring its own approval; original evidence is preserved.'); }, actions);
    host.append(actions);
    const metrics = node('div', undefined, 'metrics');
    Object.entries(r.summary).forEach(([condition,s]) => { const card = node('div', undefined, 'metric'); card.append(node('span', condition), node('strong', `${s.completed}/${s.trials}`), node('span', 'complete trials')); if(r.protocol.kind === 'citation') card.append(node('p', `${s.metadata_verified}/${s.returned_references} returned references match all required metadata fields. This is not claim support.`)); metrics.append(card); }); host.append(metrics);
    host.append(node('p', 'Descriptive pilot results only. Unknowns and failed trials remain visible. No pooled confidence interval: references within a trial are dependent.'));
    r.trials.forEach(t => {
      const card = node('article', undefined, 'trial'); card.append(node('h3', `Trial ${t.replicate} · ${t.condition}`), node('span', t.status, 'badge'));
      if(t.error) card.append(node('p', `Failure: ${t.error}. Raw observations, if received, remain available below.`));
      (t.citations || []).forEach((c,i) => { const ref = node('div', undefined, 'reference'); ref.append(node('h3', c.title || 'Incomplete reference'), node('p', c.claim), node('span', c.validation.status+(c.duplicate?' · duplicate':''), 'badge')); if(/^10\.\d{4,9}\/\S+$/.test(c.doi)) {const a=node('a',' Open source via DOI'); a.href='https://doi.org/'+encodeURIComponent(c.doi); a.target='_blank'; a.rel='noopener noreferrer'; ref.append(a);} inspect('Citation, registry record and provenance', c, ref); if(r.state==='results_pending_review') reviewForm(t,i,ref); card.append(ref); });
      if(r.protocol.kind==='framing' && t.response) {card.append(node('pre',t.response.text)); if(r.state==='results_pending_review' && t.status==='complete') reviewForm(t,-1,card);}
      inspect('Full prompts, response, retrieval evidence and timing', t, card); host.append(card);
    });
    inspect('Human assessment counts, effort and disagreements', r.human_assessments, host);
    host.append(node('h3','Challenge, interpretation & review history'));
    r.events.forEach(e => {const item=node('details'); item.append(node('summary',`${e.kind.replaceAll('_',' ')} · reviewer ${e.actor_id} · ${new Date(e.at).toLocaleString()}`),node('pre',JSON.stringify(e.detail,null,2))); host.append(item);});
    const comment = node('textarea'); comment.setAttribute('aria-label','Alternative explanation, limitation or review comment'); host.append(comment);
    button('Record comment', () => action('comment',{comment:comment.value}), host);
    if(['queued','running','cancel_requested'].includes(r.state)) timer=setTimeout(()=>open(r.id).catch(e=>msg(e.message)),5000);
  }
  function fill(p) {['kind','question','hypothesis','repeats','reference_count','provider','neutral_prompt','leading_prompt','target_claim'].forEach(k=>{if(p[k]!==undefined) $(k).value=p[k];}); $('fixed-evidence').value=p.evidence||''; toggle();}
  function toggle() {$('framing-fields').hidden=$('kind').value!=='framing'; $('count-label').hidden=$('kind').value==='framing';}
  $('kind').onchange=toggle; $('project').onchange=()=>list().catch(e=>msg(e.message));
  $('protocol').onsubmit=async e=>{e.preventDefault(); $('create').disabled=true; try {if(!$('project').value) throw new Error('Select a research project first.'); const p={}; ['kind','question','hypothesis','provider','neutral_prompt','leading_prompt','target_claim'].forEach(k=>p[k]=$(k).value); p.repeats=Number($('repeats').value); p.reference_count=Number($('reference_count').value); p.evidence=$('fixed-evidence').value;
    pendingKey ||= crypto.randomUUID(); const data=await api(base(),{idempotency_key:pendingKey,protocol:p}); pendingKey=null; await list(); render(data.run); msg('Protocol saved. Submit it for independent review before execution.');
  }catch(err){msg(err.message);}finally{$('create').disabled=false;}};
  // A changed form gets a fresh idempotency key; a failed same-payload retry keeps its key.
  $('protocol').addEventListener('input',()=>{pendingKey=null;});
  (async()=>{try{const c=await api('/api/scientific-lab/catalog/'); csrf=c.csrf_token; c.providers.forEach(p=>{const o=node('option',`${p.id} · ${p.model}`);o.value=p.id;$('provider').append(o);}); c.pilot.forEach(p=>{const o=node('option',`${p.area}: ${p.question}`);o.value=p.id;$('pilot').append(o);}); $('pilot').onchange=()=>{const p=c.pilot.find(p=>p.id===$('pilot').value);if(p)$('question').value=p.question;};
    const data=await api('/api/platform/projects/'); (data.projects||[]).forEach(p=>{const o=node('option',p.title);o.value=p.id;$('project').append(o);});
    $('create').disabled=!c.enabled||!c.providers.length; msg(!c.enabled?'The empirical pilot is not enabled on this server. Existing educational simulations remain available.':!c.providers.length?'No model provider is configured. No experiment can run until a provider is connected.':'Connected. Protocols and evidence are saved within your selected research project.');
    const params=new URLSearchParams(location.search); if(params.has('project') && [...$('project').options].some(o=>o.value===params.get('project'))){$('project').value=params.get('project');await list();if(params.has('run')) await open(params.get('run'));}
  }catch(e){msg(e.message==='authentication_required'?'Sign in to GraviQuest to create and resume research experiments.':e.message); const a=node('a','Open sign in');a.href='/account.html#in';$('status').append(' ',a);}})();
})();
