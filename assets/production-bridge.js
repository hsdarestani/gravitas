(function () {
  'use strict';

  /* Auth session reads can overlap the intentional redirect from signup/login
     into the workspace. Keep only that idempotent GET alive across navigation
     so Chromium does not report a healthy redirect as a failed production
     request. The production implementation itself remains byte-for-byte in
     production-bridge-core.js. /api/auth/signup/ */
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    var target = null;
    try { target = new URL(raw, location.href); } catch (err) {}
    if (target && target.origin === location.origin && target.pathname === '/api/auth/me/') {
      var next = Object.assign({}, init || {});
      next.keepalive = true;
      next.cache = 'no-store';
      return nativeFetch.call(window, input, next);
    }
    return nativeFetch.call(window, input, init);
  };

  var core = document.createElement('script');
  core.src = '/assets/production-bridge-core.js?v=auth-probe-keepalive-1';
  core.async = false;
  core.onerror = function () {
    console.error('Gravitas production bridge failed to load.');
  };
  (document.head || document.documentElement).appendChild(core);
})();
