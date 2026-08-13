(function () {
  'use strict';

  function cleanText(node, patterns) {
    if (!node) return;
    var text = node.textContent || '';
    patterns.forEach(function (pair) {
      text = text.replace(pair[0], pair[1]);
    });
    node.textContent = text.replace(/\s+·\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  function run() {
    var heroCredit = document.querySelector('.lp-hero__credit');
    cleanText(heroCredit, [
      [/\s*·\s*312K\s+subscribers\b/gi, '']
    ]);

    document.querySelectorAll('.video__meta').forEach(function (node) {
      cleanText(node, [
        [/\s*·\s*418K\s+views\b/gi, '']
      ]);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
