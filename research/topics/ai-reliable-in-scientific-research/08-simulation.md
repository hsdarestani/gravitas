# Simulation — The Trust Test

## Research purpose

The simulation should teach one claim:

**An AI output does not deserve one universal trust score. Trust changes with grounding, verification, uncertainty, distribution shift and accountability.**

The simulation is not a calibrated probability model. It is a deterministic pedagogical model that exposes which dimensions are weak.

## Scenarios

### Literature synthesis
Claim: “Compound X significantly improves outcome Y.”

Key failure:
real-looking sources can be fabricated, mismatched or irrelevant.

### Protein structure
Claim: “This protein adopts structure Z.”

Key failure:
confidence is task-specific and structural details can depend on context not represented in the prediction.

### Mathematical proof
Claim: “The conjecture is true.”

Key contrast:
a second LLM agreeing is weak evidence; a formal checker changes the trust boundary.

### Wildfire forecast
Claim: “The fire perimeter will reach this region in six hours.”

Key contrast:
historical predictive success does not automatically establish counterfactual validity under unfamiliar conditions.

## Controls

1. Grounding
   - model memory
   - mixed web
   - curated literature
   - verified primary data

2. Independent verification
   - none
   - same model self-check
   - independent model / held-out benchmark
   - formal checker / experiment / independent replication

3. Uncertainty
   - hidden
   - confidence shown
   - alternatives shown
   - calibrated + abstention

4. Distribution
   - far outside evaluation
   - shifted
   - mostly familiar
   - matched

5. Accountability
   - unclear
   - named operator
   - documented reviewer
   - responsible research owner + correction path

## Output

Do **not** show “AI is 87% trustworthy.”

Show a profile:

- Evidence traceability
- Verification strength
- Robustness
- Uncertainty handling
- Accountability

Then classify:

- Candidate only
- Useful lead
- Provisional result
- Strong evidence

The explanation must name the weak dimensions.

## Scoring principle

The final status is bottlenecked by scientific weaknesses, not just average score.

Rules:

```text
if independent_verification == none:
    maximum_status = useful_lead

if grounding < curated and claim depends on literature:
    evidence_traceability cannot exceed medium

if distribution == far_outside and no strong external verifier:
    maximum_status = provisional_result

strong_evidence requires:
    strong verifier
    + traceable evidence
    + visible uncertainty
    + defined operating conditions
    + accountable owner
```

## Executable prototype

The following block is intentionally self-contained and can be adapted into the existing Topic page.

```html
<section class="trust-test" id="trust-test">
  <div class="tt-scenarios" role="group" aria-label="Choose a scientific scenario">
    <button type="button" data-scenario="literature">Literature claim</button>
    <button type="button" data-scenario="protein">Protein structure</button>
    <button type="button" data-scenario="proof">Mathematical proof</button>
    <button type="button" data-scenario="wildfire">Wildfire forecast</button>
  </div>

  <div class="tt-card">
    <p class="tt-label">AI-assisted claim</p>
    <h3 id="tt-claim">Compound X significantly improves outcome Y.</h3>
    <p id="tt-context">A language model produced a literature synthesis from memory.</p>
  </div>

  <div class="tt-controls">
    <label>
      Grounding
      <select id="tt-grounding">
        <option value="0">Model memory only</option>
        <option value="1">Open web / mixed sources</option>
        <option value="2">Curated literature</option>
        <option value="3">Primary data / verified sources</option>
      </select>
    </label>

    <label>
      Independent verification
      <select id="tt-verification">
        <option value="0">None</option>
        <option value="1">Same model self-check</option>
        <option value="2">Independent model / held-out benchmark</option>
        <option value="3">Formal checker / experiment / independent replication</option>
      </select>
    </label>

    <label>
      Uncertainty
      <select id="tt-uncertainty">
        <option value="0">Hidden</option>
        <option value="1">Confidence shown</option>
        <option value="2">Alternatives + confidence</option>
        <option value="3">Calibrated + abstention allowed</option>
      </select>
    </label>

    <label>
      Conditions
      <select id="tt-shift">
        <option value="0">Far outside evaluation conditions</option>
        <option value="1">Noticeably shifted</option>
        <option value="2">Mostly familiar</option>
        <option value="3">Matches evaluated conditions</option>
      </select>
    </label>

    <label>
      Accountability
      <select id="tt-accountability">
        <option value="0">Unclear owner</option>
        <option value="1">Named operator</option>
        <option value="2">Documented reviewer</option>
        <option value="3">Responsible owner + correction path</option>
      </select>
    </label>
  </div>

  <div class="tt-results" aria-live="polite">
    <div class="tt-metric">
      <span>Evidence traceability</span>
      <progress id="tt-trace" max="100" value="0"></progress>
      <b id="tt-trace-v">0</b>
    </div>

    <div class="tt-metric">
      <span>Verification strength</span>
      <progress id="tt-verify" max="100" value="0"></progress>
      <b id="tt-verify-v">0</b>
    </div>

    <div class="tt-metric">
      <span>Robustness</span>
      <progress id="tt-robust" max="100" value="0"></progress>
      <b id="tt-robust-v">0</b>
    </div>

    <div class="tt-metric">
      <span>Uncertainty handling</span>
      <progress id="tt-uncertain" max="100" value="0"></progress>
      <b id="tt-uncertain-v">0</b>
    </div>

    <div class="tt-metric">
      <span>Accountability</span>
      <progress id="tt-account" max="100" value="0"></progress>
      <b id="tt-account-v">0</b>
    </div>

    <div class="tt-verdict">
      <span>Scientific status</span>
      <strong id="tt-status">Candidate only</strong>
      <p id="tt-explanation"></p>
    </div>
  </div>
</section>

<style>
.trust-test { display:grid; gap:1.25rem; }
.tt-scenarios { display:flex; flex-wrap:wrap; gap:.5rem; }
.tt-scenarios button {
  padding:.7rem 1rem;
  border:1px solid currentColor;
  background:transparent;
  cursor:pointer;
}
.tt-scenarios button[aria-pressed="true"] {
  background:currentColor;
  color:Canvas;
}
.tt-card {
  border:1px solid rgba(127,127,127,.3);
  padding:1.25rem;
  border-radius:1rem;
}
.tt-label {
  opacity:.65;
  margin:0 0 .35rem;
  font-size:.8rem;
  text-transform:uppercase;
  letter-spacing:.08em;
}
.tt-card h3 { margin:.2rem 0 .5rem; }
.tt-controls {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:1rem;
}
.tt-controls label {
  display:grid;
  gap:.4rem;
  font-size:.9rem;
}
.tt-controls select {
  width:100%;
  padding:.7rem;
  font:inherit;
}
.tt-results { display:grid; gap:.8rem; }
.tt-metric {
  display:grid;
  grid-template-columns:minmax(10rem,1fr) minmax(8rem,2fr) 2.5rem;
  gap:.75rem;
  align-items:center;
}
.tt-metric progress { width:100%; }
.tt-verdict {
  margin-top:.5rem;
  padding:1rem 0;
  border-top:1px solid rgba(127,127,127,.3);
}
.tt-verdict span {
  display:block;
  opacity:.65;
  font-size:.8rem;
  text-transform:uppercase;
  letter-spacing:.08em;
}
.tt-verdict strong {
  display:block;
  font-size:1.5rem;
  margin:.2rem 0 .4rem;
}
@media (max-width:640px) {
  .tt-controls { grid-template-columns:1fr; }
  .tt-metric { grid-template-columns:1fr 2.5rem; }
  .tt-metric progress {
    grid-column:1 / -1;
    grid-row:2;
  }
}
</style>

<script>
(function () {
  var root = document.getElementById('trust-test');
  if (!root) return;

  var scenarios = {
    literature: {
      claim: 'Compound X significantly improves outcome Y.',
      context: 'A language model produced a literature synthesis from memory.',
      values: [0, 0, 0, 3, 1],
      base: { trace: 5, verify: 5, robust: 35, uncertain: 5 }
    },
    protein: {
      claim: 'This protein adopts structure Z.',
      context: 'A specialized structure model generated a prediction for a protein sequence.',
      values: [3, 2, 3, 3, 3],
      base: { trace: 45, verify: 45, robust: 45, uncertain: 45 }
    },
    proof: {
      claim: 'The conjecture is true.',
      context: 'An AI system generated a research-level mathematical proof.',
      values: [2, 1, 2, 3, 2],
      base: { trace: 40, verify: 15, robust: 50, uncertain: 35 }
    },
    wildfire: {
      claim: 'The fire perimeter will reach this region in six hours.',
      context: 'A learned forecasting system predicts the next state from current observations.',
      values: [3, 2, 3, 3, 3],
      base: { trace: 45, verify: 40, robust: 35, uncertain: 45 }
    }
  };

  var grounding = root.querySelector('#tt-grounding');
  var verification = root.querySelector('#tt-verification');
  var uncertainty = root.querySelector('#tt-uncertainty');
  var shift = root.querySelector('#tt-shift');
  var accountability = root.querySelector('#tt-accountability');
  var activeScenario = 'literature';

  function clamp(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function setMetric(id, value) {
    root.querySelector('#' + id).value = value;
    root.querySelector('#' + id + '-v').textContent = value;
  }

  function score() {
    var s = scenarios[activeScenario];

    var g = Number(grounding.value);
    var v = Number(verification.value);
    var u = Number(uncertainty.value);
    var d = Number(shift.value);
    var a = Number(accountability.value);

    var trace = s.base.trace + g * 18 + u * 3;
    var verify = s.base.verify + v * 24 + g * 4;
    var robust = s.base.robust + d * 14 + u * 5;
    var uncertain = s.base.uncertain + u * 18;
    var account = 10 + a * 26 + g * 3;

    if (v === 1) verify -= 8;
    if (d === 0) robust -= 28;
    if (d === 1) robust -= 12;

    if (activeScenario === 'proof' && v === 3) {
      verify += 25;
      robust += 8;
    }

    if (activeScenario === 'literature' && g === 3) {
      trace += 10;
    }

    if (activeScenario === 'wildfire' && d < 2) {
      robust -= 10;
    }

    trace = clamp(trace);
    verify = clamp(verify);
    robust = clamp(robust);
    uncertain = clamp(uncertain);
    account = clamp(account);

    setMetric('tt-trace', trace);
    setMetric('tt-verify', verify);
    setMetric('tt-robust', robust);
    setMetric('tt-uncertain', uncertain);
    setMetric('tt-account', account);

    var vals = [trace, verify, robust, uncertain, account];
    var avg = vals.reduce(function (sum, value) {
      return sum + value;
    }, 0) / vals.length;

    var weakest = Math.min.apply(null, vals);

    var status = 'Candidate only';

    if (avg >= 40 && weakest >= 20) {
      status = 'Useful lead';
    }

    if (avg >= 60 && weakest >= 40) {
      status = 'Provisional result';
    }

    if (avg >= 78 && weakest >= 65) {
      status = 'Strong evidence';
    }

    if (v === 0 && status !== 'Candidate only') {
      status = 'Useful lead';
    }

    if (d === 0 && v < 3 && status === 'Strong evidence') {
      status = 'Provisional result';
    }

    root.querySelector('#tt-status').textContent = status;

    var notes = [];

    if (g < 2) notes.push('the evidence trail is weak');
    if (v < 2) notes.push('the output has not faced a strong independent test');
    if (u < 2) notes.push('uncertainty is not handled explicitly');
    if (d < 2) notes.push('the claim is outside familiar evaluation conditions');
    if (a < 2) notes.push('accountability and correction ownership are weak');
    if (v === 3) notes.push('a strong external verifier can reject the output');

    if (!notes.length) {
      notes.push('the workflow combines traceable evidence, external rejection, visible uncertainty and accountable ownership');
    }

    root.querySelector('#tt-explanation').textContent =
      'This is ' + status.toLowerCase() + ' because ' + notes.join(', ') + '.';
  }

  function setScenario(name) {
    activeScenario = name;
    var s = scenarios[name];

    root.querySelector('#tt-claim').textContent = s.claim;
    root.querySelector('#tt-context').textContent = s.context;

    grounding.value = s.values[0];
    verification.value = s.values[1];
    uncertainty.value = s.values[2];
    shift.value = s.values[3];
    accountability.value = s.values[4];

    root.querySelectorAll('[data-scenario]').forEach(function (button) {
      button.setAttribute(
        'aria-pressed',
        button.dataset.scenario === name ? 'true' : 'false'
      );
    });

    score();
  }

  root.querySelectorAll('[data-scenario]').forEach(function (button) {
    button.addEventListener('click', function () {
      setScenario(button.dataset.scenario);
    });
  });

  [grounding, verification, uncertainty, shift, accountability]
    .forEach(function (control) {
      control.addEventListener('change', score);
    });

  setScenario('literature');
})();
</script>
```

## Simulation QA

The implementation must pass all of these:

1. A proof reviewed only by a second LLM must not reach Strong Evidence.
2. Adding Lean/formal verification to the proof scenario must increase Verification Strength substantially.
3. A literature claim using verified sources but no causal validation must not automatically become Strong Evidence.
4. Moving a forecast far outside its evaluated distribution must reduce Robustness substantially.
5. Hiding uncertainty must reduce Uncertainty Handling.
6. Unclear ownership must reduce Accountability.
7. No combination may display a percentage probability of truth.
8. Every scenario must explain *why* the status changed.
9. Keyboard and touch controls must both work.
10. The implementation must remain readable without JavaScript; controls can be disabled with a short fallback message if needed.

## Editorial note

The numeric bars are heuristic visualizations of workflow properties. They are **not** empirical probabilities and must never be labeled as calibrated scientific confidence.
