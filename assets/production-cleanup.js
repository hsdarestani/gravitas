(function () {
  'use strict';

  function cleanText(node, patterns) {
    if (!node) return;
    var text = node.textContent || '';
    patterns.forEach(function (pair) {
      text = text.replace(pair[0], pair[1]);
    });
    node.textContent = text
      .replace(/^\s*·\s*/g, '')
      .replace(/\s*·\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function removeIfPrototypeMetric(node) {
    if (!node) return;
    var text = (node.textContent || '').trim();
    if (/^(?:\d+\s*(?:min|minutes?|steps?)|~?\d+\s*hours?|\d+\s*(?:days?|weeks?)\s+ago|updated\s+monthly|dossier\s+\d+)$/i.test(text)) {
      node.remove();
    }
  }

  function loadHomepageCms() {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    if (document.querySelector('script[data-gravitas-home-cms]')) return;
    var script = document.createElement('script');
    script.src = '/assets/cms-home.js';
    script.async = true;
    script.dataset.gravitasHomeCms = '1';
    document.head.appendChild(script);
  }

  function run() {
    var heroCredit = document.querySelector('.lp-hero__credit');
    cleanText(heroCredit, [
      [/\s*·\s*312K\s+subscribers\b/gi, '']
    ]);

    document.querySelectorAll('.video__meta').forEach(function (node) {
      cleanText(node, [
        [/^\s*\d{1,2}:\d{2}\s*·\s*/g, ''],
        [/\s*·\s*418K\s+views\b/gi, '']
      ]);
    });

    document.querySelectorAll('.entry__meta span').forEach(removeIfPrototypeMetric);

    document.querySelectorAll('.g-eyebrow, .g-eyebrow--bare').forEach(function (node) {
      cleanText(node, [
        [/\bDossier\s+04\s*·\s*/gi, '']
      ]);
    });

    document.querySelectorAll('dt').forEach(function (dt) {
      if ((dt.textContent || '').trim().toLowerCase() === 'reading time') {
        var dd = dt.nextElementSibling;
        dt.remove();
        if (dd && dd.tagName === 'DD') dd.remove();
      }
    });

    document.querySelectorAll('.lp-social__link[href="#"]').forEach(function (link) {
      var item = link.closest('li');
      if (item) item.remove();
      else link.remove();
    });

    document.querySelectorAll('.lp-social').forEach(function (list) {
      if (!list.querySelector('a')) {
        var wrapper = list.closest('div');
        if (wrapper && wrapper.querySelector('.g-footer__heading')) wrapper.remove();
        else list.remove();
      }
    });

    loadHomepageCms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
