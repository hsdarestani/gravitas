(function () {
  'use strict';
  const form = document.getElementById('prelaunch-form');
  if (!form) return;
  const submit = document.getElementById('fb-submit-button');
  const status = document.getElementById('fb-status');
  let hasSaved = false;
  const textKeys = ['video_feedback', 'visual_feedback', 'scientific_content_feedback', 'first_impression', 'persona_other'];
  const sections = ['video', 'essay', 'sources', 'viewpoints', 'pulsar', 'forum'];
  const rangeLabels = {
    usability: ['Very easy', 'Easy', 'Neither easy nor confusing', 'Confusing', 'Very confusing'],
    expectations_difference: ['Exactly as expected', 'Mostly expected', 'Somewhat different', 'Very different', 'Completely different']
  };
  function display(text, state) {
    status.textContent = text || '';
    if (state) status.dataset.state = state; else status.removeAttribute('data-state');
  }
  function field(name) { return form.elements.namedItem(name); }
  function checkedValue(name) {
    const selected = form.querySelector('input[name="' + name + '"]:checked');
    return selected ? selected.value : '';
  }
  function setRange(input, value) {
    const rated = Number.isInteger(Number(value)) && value !== '' && value !== null && value !== undefined;
    input.dataset.rated = rated ? 'true' : 'false';
    input.value = rated ? String(value) : '3';
    const output = document.getElementById(input.id + '-output');
    if (output) {
      output.textContent = rated ? rangeLabels[input.name][Number(input.value) - 1] : 'Not rated';
      output.dataset.rated = rated ? 'true' : 'false';
    }
  }
  form.querySelectorAll('[data-optional-range]').forEach(function (input) {
    setRange(input, null);
    input.addEventListener('input', function () { setRange(input, input.value); });
  });
  form.querySelectorAll('[data-clear-range]').forEach(function (button) {
    button.addEventListener('click', function () {
      const input = field(button.dataset.clearRange);
      if (input) setRange(input, null);
    });
  });
  function syncPersona() {
    const show = checkedValue('persona') === 'other';
    document.getElementById('fb-other-wrap').hidden = !show;
  }
  form.querySelectorAll('input[name="persona"]').forEach(function (input) {
    input.addEventListener('change', syncPersona);
  });
  function populate(submission) {
    if (!submission) return;
    const a = submission.answers || {};
    field('name').value = submission.name || '';
    textKeys.forEach(function (key) { field(key).value = a[key] || ''; });
    ['persona', 'overall_rating'].forEach(function (key) {
      const value = a[key];
      if (value !== null && value !== undefined) {
        const input = Array.from(form.querySelectorAll('input[name="' + key + '"]')).find(function (el) {
          return el.value === String(value);
        });
        if (input) input.checked = true;
      }
    });
    form.querySelectorAll('[data-optional-range]').forEach(function (el) {
      setRange(el, a[el.name] === undefined ? null : a[el.name]);
    });
    sections.forEach(function (key) {
      field('section_' + key).value = a.section_ratings && a.section_ratings[key] || '';
    });
    syncPersona();
    hasSaved = true;
    submit.firstChild.textContent = 'Update feedback ';
    display('Your previous feedback is loaded. You can edit it and save again.');
  }
  function gather() {
    const answers = {};
    textKeys.forEach(function (key) {
      const value = field(key).value.trim();
      if (value) answers[key] = value;
    });
    ['persona', 'overall_rating'].forEach(function (key) {
      const value = checkedValue(key);
      if (value) answers[key] = key === 'overall_rating' ? Number(value) : value;
    });
    form.querySelectorAll('[data-optional-range]').forEach(function (input) {
      if (input.dataset.rated === 'true') answers[input.name] = Number(input.value);
    });
    const scores = {};
    sections.forEach(function (key) {
      const value = field('section_' + key).value;
      if (value) scores[key] = Number(value);
    });
    if (Object.keys(scores).length) answers.section_ratings = scores;
    if (answers.persona !== 'other') delete answers.persona_other;
    return { name: field('name').value.trim(), answers: answers, website: field('website').value };
  }
  function cookie(name) {
    const row = document.cookie.split('; ').find(function (v) { return v.startsWith(name + '='); });
    return row ? decodeURIComponent(row.slice(name.length + 1)) : '';
  }
  async function csrf() {
    const response = await fetch('/api/auth/csrf/', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Could not prepare a secure submission. Please try again.');
    const token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    if (!token) throw new Error('Could not prepare a secure submission. Enable cookies and retry.');
    return token;
  }
  async function loadExisting() {
    try {
      const response = await fetch('/api/prelaunch/feedback/', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.submission) populate(data.submission);
    } catch (_error) {
      // The form remains usable during a temporary read outage.
    }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    display('Saving your feedback…');
    try {
      const token = await csrf();
      const response = await fetch('/api/prelaunch/feedback/', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': token
        },
        body: JSON.stringify(gather())
      });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok || !result.ok) throw new Error('Could not confirm that your feedback was saved.');
      hasSaved = true;
      submit.firstChild.textContent = 'Update feedback ';
      display('Thank you. Your feedback has been saved. You can update it from this browser.', 'success');
    } catch (error) {
      display((error && error.message || 'Could not save.') + ' Refresh to check whether it was saved before trying again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
  loadExisting();
})();
