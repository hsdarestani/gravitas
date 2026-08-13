(function () {
  'use strict';

  var KEY = 'gravitas:consent:v1';
  var VERSION = 1;

  function read() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || 'null');
      return value && value.version === VERSION ? value : null;
    } catch (e) {
      return null;
    }
  }

  function write(analytics) {
    var value = {
      version: VERSION,
      necessary: true,
      analytics: !!analytics,
      decidedAt: new Date().toISOString()
    };
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) {}
    window.dispatchEvent(new CustomEvent('gravitas:consent', { detail: value }));
    return value;
  }

  function removeBanner() {
    var existing = document.getElementById('gravitas-consent');
    if (existing) existing.remove();
  }

  function show() {
    removeBanner();
    var panel = document.createElement('section');
    panel.id = 'gravitas-consent';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Privacy choices');
    panel.style.cssText = 'position:fixed;z-index:9999;left:1rem;right:1rem;bottom:1rem;max-width:760px;margin:auto;padding:1rem 1.1rem;background:#111;color:#f5f2ed;border:1px solid rgba(255,255,255,.18);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif';
    panel.innerHTML = '' +
      '<strong style="display:block;font-size:16px;margin-bottom:.35rem">Privacy choices</strong>' +
      '<span>Necessary storage keeps sign-in and security working. Optional analytics is off unless you allow it. You can change this choice later.</span>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.85rem">' +
        '<button type="button" data-consent="necessary" style="padding:.65rem .9rem;border-radius:999px;border:1px solid #777;background:transparent;color:inherit;cursor:pointer">Necessary only</button>' +
        '<button type="button" data-consent="analytics" style="padding:.65rem .9rem;border-radius:999px;border:0;background:#f1efec;color:#111;cursor:pointer">Allow optional analytics</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (event) {
      var button = event.target.closest('[data-consent]');
      if (!button) return;
      write(button.dataset.consent === 'analytics');
      removeBanner();
    });
  }

  window.GravitasConsent = {
    get: read,
    analyticsAllowed: function () {
      var value = read();
      return !!(value && value.analytics);
    },
    necessaryOnly: function () { write(false); removeBanner(); },
    allowAnalytics: function () { write(true); removeBanner(); },
    open: show,
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      show();
    }
  };

  if (!read()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', show, { once: true });
    } else {
      show();
    }
  }
})();
