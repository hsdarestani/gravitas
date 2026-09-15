(function () {
  'use strict';

  /* The auth form itself is authoritative. While a signup/login submission is
     active, do not start a second session GET that can be aborted by the very
     redirect it is trying to confirm. Before the auth response arrives the
     watchdog sees "not authenticated yet"; after a successful response it sees
     "authenticated" immediately. Outside an active auth submit, /api/auth/me/
     remains a real no-store server read. The production implementation itself
     stays byte-for-byte in production-bridge-core.js. /api/auth/signup/ */
  var nativeFetch = window.fetch;
  var authFlowActive = false;
  var authFlowAuthenticated = false;

  window.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || (form.id !== 'p-up' && form.id !== 'p-in')) return;
    authFlowActive = true;
    authFlowAuthenticated = false;
  }, true);

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    var target = null;
    try { target = new URL(raw, location.href); } catch (err) {}

    var method = String(
      (init && init.method) || (input && input.method) || 'GET'
    ).toUpperCase();

    if (target && target.origin === location.origin) {
      var isAuthWrite = method === 'POST' &&
        (target.pathname === '/api/auth/signup/' || target.pathname === '/api/auth/login/');

      if (isAuthWrite) {
        return nativeFetch.call(window, input, init).then(function (response) {
          if (response.ok && authFlowActive) authFlowAuthenticated = true;
          return response;
        });
      }

      if (target.pathname === '/api/auth/me/') {
        if (authFlowActive) {
          return Promise.resolve(new Response(JSON.stringify({
            authenticated: authFlowAuthenticated
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }

        var next = Object.assign({}, init || {});
        next.keepalive = true;
        next.cache = 'no-store';
        return nativeFetch.call(window, input, next);
      }
    }

    return nativeFetch.call(window, input, init);
  };

  var core = document.createElement('script');
  core.src = '/assets/production-bridge-core.js?v=auth-session-race-2';
  core.async = false;
  core.onerror = function () {
    console.error('Gravitas production bridge failed to load.');
  };
  (document.head || document.documentElement).appendChild(core);
})();
