(async () => {
  const paths = {'/':'home','/site':'home','/index':'home','/topics':'topics',
    '/lab':'lab','/education':'education','/about':'about'};
  const banner = document.querySelector('[aria-label="Environment"]');
  const page = paths[location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/'];
  if (!banner || !page || location.hostname !== 'staging.graviquest.com') return;
  try {
    const response = await fetch('/api/release-center/visual/', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok || !(await response.json()).capabilities?.author) return;
    const link = document.createElement('a');
    link.href = '/workspace/core/visual-editor?page=' + page;
    link.textContent = 'Edit Page';
    link.style.marginInlineStart = '1em';
    banner.append(link);
  } catch {
    // The public page does not depend on the authenticated editor.
  }
})();
