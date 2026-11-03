(function () {
  'use strict';
  var root = document.getElementById('ps-studio');
  if (!root) return;
  var isDE = document.documentElement.lang === 'de';
  var t = isDE ? {
    prediction: 'Vermutung notiert. Testen wir sie am Modell, statt eine Antwort einfach zu übernehmen.',
    accurate: 'Ihre Vermutung stimmt mit diesem idealisierten Modell überein.',
    revise: 'Ihre Vermutung wich vom Modellergebnis ab. Genau deshalb testen wir Hypothesen.',
    correct: 'Genau. Reibung kann die resultierende Kraft verändern. Ein gutes Modell legt seine Annahmen offen.',
    incorrect: 'Eine stärkere Antwort wäre Reibung. Welche Kräfte tatsächlich wirken, muss untersucht werden.',
    prompt: 'Vergleichen Sie beide Kurven. Was sagt das Modell und was kann es nicht sagen?',
    before: 'Wählen Sie eine Vermutung und starten Sie dann den Vergleich.',
    dynamic: function (f, m, a) { return 'Bei ' + f + ' N und ' + m + ' kg sagt das vereinfachte Modell ' + a.toFixed(2) + ' m/s² voraus. Warum verändert sich das Verhältnis F/m?'; },
    why: function (f, m, a) { return 'a = F/m = ' + f + '/' + m + ' = ' + a.toFixed(2) + ' m/s². Das gilt bei dieser modellierten konstanten resultierenden Kraft. Bei einem echten Wagen müssten Sie Reibung und weitere Kräfte überprüfen.'; }
  } : {
    prediction: 'Prediction saved. Let us test it against the model instead of accepting an answer on trust.',
    accurate: 'Your prediction agrees with this idealized model.',
    revise: 'Your prediction differed from this model. That is why hypotheses are tested.',
    correct: 'Exactly. Friction may change the net force. A good model makes its assumptions explicit.',
    incorrect: 'A stronger answer is friction. We would need to establish which forces actually act on the cart.',
    prompt: 'Compare the two curves. What can the model tell us, and what can it not tell us?',
    before: 'Choose a prediction, then run the comparison.',
    dynamic: function (f, m, a) { return 'With ' + f + ' N and ' + m + ' kg, this simplified model predicts ' + a.toFixed(2) + ' m/s². Why did the ratio F/m change?'; },
    why: function (f, m, a) { return 'a = F/m = ' + f + '/' + m + ' = ' + a.toFixed(2) + ' m/s², assuming the modeled net force stays constant. For a real cart, we would examine friction and other forces before trusting the prediction.'; }
  };
  var $ = function (id) { return document.getElementById(id); };
  var predictBtns = Array.from(root.querySelectorAll('[data-prediction]'));
  var assumptionBtns = Array.from(root.querySelectorAll('[data-assumption]'));
  var force = $('ps-force'), mass = $('ps-mass'), run = $('ps-run'), after = $('ps-after');
  var prediction = null, tested = false;
  var baseline = 8 / 2;
  function setStep(step) {
    for (var i = 1; i <= 3; i++) {
      var el = $('ps-journey-' + i);
      el.classList.toggle('is-active', i === step);
      el.classList.toggle('is-done', i < step);
    }
    root.dataset.phase = step === 1 ? 'predict' : step === 2 ? 'test' : 'reflect';
  }
  function fmt(a) { return a.toFixed(2); }
  function render() {
    var f = Number(force.value), m = Number(mass.value), accel = f / m;
    $('ps-force-out').textContent = f + ' N';
    $('ps-mass-out').textContent = m + ' kg';
    var maxVelocity = Math.max(18, baseline * 4 * 1.12, accel * 4 * 1.12);
    var y = function (a) { return 222 - a * 4 / maxVelocity * 188; };
    $('ps-y-top').textContent = String(Math.ceil(maxVelocity));
    $('ps-base-line').setAttribute('d', 'M58 222L610 ' + y(baseline).toFixed(2));
    $('ps-base-dot').setAttribute('cy', String(y(baseline).toFixed(2)));
    if (tested) {
      $('ps-test-line').hidden = false;
      $('ps-test-dot').hidden = false;
      $('ps-test-line').setAttribute('d', 'M58 222L610 ' + y(accel).toFixed(2));
      $('ps-test-dot').setAttribute('cy', String(y(accel).toFixed(2)));
      $('ps-parameters').textContent = f + ' N / ' + m + ' kg';
      $('ps-acceleration').textContent = fmt(accel) + ' m/s²';
      $('ps-result').textContent = t.dynamic(f, m, accel);
      $('ps-lab-hint').textContent = t.prompt;
      $('ps-guide-hint').textContent = t.prompt;
      $('ps-live').textContent = t.dynamic(f, m, accel);
      $('ps-why-answer').hidden = true;
    } else {
      $('ps-test-line').hidden = true;
      $('ps-test-dot').hidden = true;
      $('ps-parameters').textContent = '—';
      $('ps-acceleration').textContent = '—';
      $('ps-live').textContent = '';
    }
  }
  predictBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (tested) return;
      prediction = btn.dataset.prediction;
      predictBtns.forEach(function (b) {
        var selected = b === btn;
        b.setAttribute('aria-pressed', String(selected));
        b.classList.toggle('is-selected', selected);
      });
      $('ps-predict-feedback').textContent = t.prediction;
      $('ps-predict-feedback').hidden = false;
      $('ps-run').disabled = false;
      setStep(2);
    });
  });
  run.addEventListener('click', function () {
    if (!prediction || tested) return;
    tested = true;
    force.value = '8';
    mass.value = '4';
    force.disabled = false;
    mass.disabled = false;
    run.hidden = true;
    after.hidden = false;
    predictBtns.forEach(function (b) { b.disabled = true; });
    $('ps-grade').textContent = prediction === 'half' ? t.accurate : t.revise;
    setStep(3);
    render();
  });
  assumptionBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      assumptionBtns.forEach(function (b) {
        var selected = b === btn;
        b.classList.toggle('is-selected', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      $('ps-assumption-feedback').textContent = btn.dataset.assumption === 'friction' ? t.correct : t.incorrect;
      $('ps-assumption-feedback').hidden = false;
    });
  });
  $('ps-why').addEventListener('click', function () {
    $('ps-why-text').textContent = t.why(Number(force.value), Number(mass.value), Number(force.value) / Number(mass.value));
    $('ps-why-answer').hidden = false;
  });
  $('ps-reset').addEventListener('click', function () {
    tested = false; prediction = null;
    force.value = '8'; mass.value = '2';
    force.disabled = true; mass.disabled = true;
    run.disabled = true; run.hidden = false; after.hidden = true;
    predictBtns.forEach(function (b) { b.disabled = false; b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
    assumptionBtns.forEach(function (b) { b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
    $('ps-predict-feedback').hidden = true;
    $('ps-assumption-feedback').hidden = true;
    $('ps-why-answer').hidden = true;
    $('ps-lab-hint').textContent = t.before;
    $('ps-guide-hint').textContent = t.before;
    setStep(1); render();
  });
  force.addEventListener('input', render);
  mass.addEventListener('input', render);
  setStep(1);
  render();
})();