/* Route every user-initiated Nextcloud tab through the authenticated Gravitas
   SSO launcher. Existing native-app surfaces already centralize their launches
   on window.open(); intercepting that boundary keeps Files, Notes, Deck and
   future native apps consistent without maintaining four login implementations. */

const SSO_PATH = '/api/platform/nextcloud/sso/';
const CLOUD_HOST = 'cloud.gravitasplus.com';
let installed = false;

export function installNextcloudSsoBridge() {
  if (installed) return;
  installed = true;

  const nativeOpen = window.open.bind(window);
  window.open = function gravitasNextcloudOpen(url, target, features) {
    let destination = url;
    try {
      const parsed = new URL(String(url || ''), location.href);
      if (parsed.hostname === CLOUD_HOST && parsed.protocol === 'https:') {
        destination = `${SSO_PATH}?next=${encodeURIComponent(parsed.href)}`;
      }
    } catch {
      // Preserve the browser's ordinary window.open behavior for malformed or
      // non-URL values rather than turning this integration into a global gate.
    }
    return nativeOpen(destination, target, features);
  };
}
