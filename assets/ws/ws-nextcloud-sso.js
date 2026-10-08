/* Route every user-initiated Nextcloud tab through the authenticated Gravitas
   SSO launcher. Existing native-app surfaces already centralize their launches
   on window.open(); intercepting that boundary keeps Files, Notes, Deck and
   future native apps consistent without maintaining four login implementations. */

const SSO_PATH = '/api/platform/nextcloud/sso/';
const CLOUD_HOST = 'cloud.gravitasplus.com';
let installed = false;

export function nextcloudSsoUrl(url) {
  try {
    const parsed = new URL(String(url || ''), location.href);
    if (parsed.protocol !== 'https:') return url;
    if (parsed.hostname === CLOUD_HOST) return `${SSO_PATH}?next=${encodeURIComponent(parsed.href)}`;
    if (parsed.origin === location.origin && (parsed.pathname === '/nextcloud' || parsed.pathname.startsWith('/nextcloud/'))) {
      const canonical = `https://${CLOUD_HOST}${parsed.pathname.slice('/nextcloud'.length) || '/'}${parsed.search}${parsed.hash}`;
      return `${SSO_PATH}?next=${encodeURIComponent(canonical)}`;
    }
  } catch { /* Keep unrelated and malformed destinations unchanged. */ }
  return url;
}

export function installNextcloudSsoBridge() {
  if (installed) return;
  installed = true;

  const nativeOpen = window.open.bind(window);
  window.open = function gravitasNextcloudOpen(url, target, features) {
    const destination = nextcloudSsoUrl(url);
    return nativeOpen(destination, target, features);
  };

  // Rewrite anchor destinations before the browser follows them. Unlike a
  // window.open patch this also handles modifier clicks and middle clicks.
  const prepareLink = (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const destination = nextcloudSsoUrl(anchor.href);
    if (destination !== anchor.href) anchor.href = destination;
  };
  document.addEventListener('click', prepareLink, true);
  document.addEventListener('auxclick', prepareLink, true);
  document.addEventListener('contextmenu', prepareLink, true);
}
