# GraviQuest Lab Studio — authoring contract

## Scope
Lab is a Topic-agnostic central surface. Individual Labs can reference any published Topic. The infrastructure does not publish a sample. Design authority is brand.html, assets/gravitas.css and assets/site.css.

## Platform Admin
Open /workspace/core/admin/labs. Create a Lab draft, assign a title and optional published Topic slug, configure visible shell components, design Pulsar teaching sections, and edit each source file (index.html, JavaScript, CSS, JSON or text). Preview is restricted to Core admins.

Saved code goes into revision history. Publishing snapshots the current draft to separate published_files and published_config fields. Editing after publication never changes live code until another explicit Publish. Unpublish removes public access immediately. Restore retrieves a previous revision as a NEW draft without silently changing live code. Version conflicts return HTTP 409. All write operations are permission-checked and audited.

Old pre-existing Lab records are NOT automatically republished: studio_enabled defaults false and published_version defaults 0.

## Simulator contract
The server injects a managed asset (/assets/lab-bridge.js) into the Lab's index.html. Code inside the simulator may call:

    GraviLab.register({
      section: 'observe',
      controls: [{key:'density',label:'Density',min:0,max:1,step:0.05,value:0.4}],
      layers: [{key:'vectors',label:'Motion vectors',enabled:true}],
    });
    GraviLab.onControl(({key,value}) => {/* update model */});
    GraviLab.onCommand(command => {/* play, pause, reset, replay */});
    GraviLab.onLayer(({key,enabled}) => {/* update visual layer */});
    GraviLab.emit('density_changed',{density:0.6,flow:3.2},'observe');

The bridge sends only graviquest.lab.v1 structured events. The public parent accepts messages only from its own isolated iframe with opaque origin null, and bounds metrics to numeric values. Components stage, controls, metrics, timeline, compare, layers, charts are configured from Admin. Their scientific content and calculations come from the author's actual simulator code. A component never pretends a computation happened if it did not.

## Pulsar
The sidecar provides one-sentence guided teaching during simulation and can answer questions. Administrators configure section introductions and event-specific scientific notes. Client-side changes are deduplicated, debounced and capped at 20-second intervals between background AI calls. The server limits public calls by IP and Lab. The managed Pulsar provider is called with only published instructional context and bounded reported values, not arbitrary simulator code. It is instructed not to invent evidence or infer that self-reported metrics are verified.

When the model is unavailable, configured guidance is returned as provider=script, not falsely labeled as live AI. Users may pause commentary.

## Security
Code executes in an iframe sandbox with allow-scripts and WITHOUT allow-same-origin. The server also enforces HTTP CSP sandbox allow-scripts even on direct navigation, denies external network connections, forms, nested frames and objects, and restricts asset file extensions. Drafts and preview URLs require Core admin access. Do not loosen outbound network privileges, trust postMessage without checking source+origin, or execute simulator code in the parent origin.

## First Lab acceptance steps
Define a specific scientific question, model assumptions, measurable variables and references. Implement a real engine and event emissions, configure components and coaching, test change/play/pause/replay and results, conduct a science review, then explicitly publish. No first Lab has been built or released in this foundation.
