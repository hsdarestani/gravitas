(function () {
  'use strict';

  var CLOUD_HOST = 'cloud.gravitasplus.com';
  var SSO_PATH = '/api/platform/nextcloud/sso/';

  function nextcloudTarget(href) {
    if (!href || href.indexOf(SSO_PATH) !== -1) return null;
    var url;
    try { url = new URL(href, window.location.origin); } catch (_) { return null; }

    if (url.hostname === CLOUD_HOST) {
      return url.pathname + url.search + url.hash;
    }
    if (url.origin === window.location.origin && (url.pathname === '/nextcloud' || url.pathname.indexOf('/nextcloud/') === 0)) {
      var path = url.pathname.slice('/nextcloud'.length) || '/';
      return path + url.search + url.hash;
    }
    return null;
  }

  function ssoHref(target) {
    return SSO_PATH + '?next=' + encodeURIComponent(target || '/index.php/apps/files/files');
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var target = nextcloudTarget(link.getAttribute('href'));
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    var launch = ssoHref(target);
    if (link.target === '_blank') {
      window.open(launch, '_blank', 'noopener');
    } else {
      window.location.assign(launch);
    }
  }, true);

  // Expose a tiny helper for future workspace components without coupling them
  // to the Nextcloud provider id or OIDC route shape.
  window.GravitasNextcloudSSO = {
    href: function (path) { return ssoHref(path); }
  };
})();
