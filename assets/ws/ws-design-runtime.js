const DESIGN_ID = 'ws-unified-design';
const DESIGN_HREF = '/assets/ws/ws-unified-design.css?v=20260920-cohesion2';

function ensureDesignLast() {
  let link = document.getElementById(DESIGN_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = DESIGN_ID;
    link.rel = 'stylesheet';
    link.href = DESIGN_HREF;
  } else if (!link.href.includes('20260920-cohesion2')) {
    link.href = DESIGN_HREF;
  }

  // Several legacy modules inject unlayered runtime <style> blocks during
  // boot. Moving this link to the end after those installers have run makes
  // the Dashboard design system authoritative without changing their logic.
  if (document.head.lastElementChild !== link) document.head.append(link);
}

function schedule() {
  requestAnimationFrame(ensureDesignLast);
}

ensureDesignLast();
addEventListener('ws:navigate', schedule);
addEventListener('popstate', schedule);
addEventListener('load', schedule, { once: true });
