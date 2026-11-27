export function floatingDialog(dialog, headSelector) {
  const wide = matchMedia('(min-width: 740px)');
  let x = 0, y = 0, gesture;

  function move(dx, dy) {
    const box = dialog.getBoundingClientRect(), margin = 8;
    x += Math.max(margin - box.left, Math.min(dx, window.innerWidth - margin - box.right));
    y += Math.max(margin - box.top, Math.min(dy, window.innerHeight - margin - box.bottom));
    dialog.style.translate = x + 'px ' + y + 'px';
  }
  function reset() {
    x = 0;
    y = 0;
    dialog.style.removeProperty('translate');
  }
  function end() {
    gesture = null;
    dialog.classList.remove('moving-dialog');
  }

  dialog.addEventListener('pointerdown', event => {
    const head = event.target.closest(headSelector);
    if (!wide.matches || !head || event.button !== 0 || event.target.closest('button:not(.dialog-grip),input,select,a,textarea')) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    (event.target.closest('.dialog-grip')||head).setPointerCapture(event.pointerId);
    dialog.classList.add('moving-dialog');
  });
  dialog.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    move(event.clientX - gesture.x, event.clientY - gesture.y);
    gesture.x = event.clientX;
    gesture.y = event.clientY;
  });
  dialog.addEventListener('lostpointercapture', end);
  dialog.addEventListener('close', () => { if (!dialog.open) { end(); reset(); } });
  dialog.addEventListener('dblclick', event => {
    if (event.target.closest('.dialog-grip')) reset();
  });
  dialog.addEventListener('keydown', event => {
    if (!wide.matches || !event.target.closest('.dialog-grip')) return;
    const offset = { ArrowUp:[0,-20], ArrowDown:[0,20], ArrowLeft:[-20,0], ArrowRight:[20,0] }[event.key];
    if (!offset && event.key !== 'Home') return;
    event.preventDefault();
    if (offset) move(...offset);
    else reset();
  });
  addEventListener('resize', () => { if (dialog.open) reset(); });
}

export function blockerTooltips(describe) {
  const tip = document.createElement('div');
  tip.id = 'blocker-tooltip';
  tip.className = 'blocker-tooltip';
  tip.role = 'tooltip';
  let anchor, timer;
  const selector = 'button[data-action="task"][data-value]';

  function hide() {
    clearTimeout(timer);
    if (anchor?.getAttribute('aria-describedby') === tip.id) anchor.removeAttribute('aria-describedby');
    anchor = null;
    tip.remove();
  }
  function show(target, reason) {
    if (!target.isConnected) return hide();
    tip.replaceChildren();
    const label = document.createElement('strong');
    label.textContent = 'Blocked';
    tip.append(label);
    const description = document.createElement('div');
    description.textContent = reason;
    tip.append(description);
    const modal = target.closest('dialog');
    // A translated dialog establishes the containing block for fixed descendants.
    const parent = modal && getComputedStyle(modal).translate !== 'none' ? modal.getBoundingClientRect() : {left:0, top:0};
    (modal || document.body).append(tip);
    const box = target.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, box.left));
    const top = box.bottom + tip.offsetHeight + 10 < innerHeight ? box.bottom + 7 : Math.max(8, box.top - tip.offsetHeight - 7);
    tip.style.left = (left - parent.left) + 'px';
    tip.style.top = (top - parent.top) + 'px';
    target.setAttribute('aria-describedby', tip.id);
  }
  function enter(event, delay) {
    const candidate = event.target.closest(selector);
    if (!candidate || event.pointerType === 'touch' || candidate === anchor && tip.isConnected) return;
    const reason = describe(candidate.dataset.value);
    if (!reason) return;
    hide();
    anchor = candidate;
    if (delay) timer = setTimeout(() => show(candidate, reason), delay);
    else show(candidate, reason);
  }
  function leave(event) {
    if (!anchor || ![anchor,tip].some(node=>node.contains(event.target))) return;
    if ([anchor,tip].some(node=>node.contains(event.relatedTarget))) return;
    if (event.type === 'pointerout' && anchor === document.activeElement) return;
    clearTimeout(timer);
    timer = setTimeout(hide, 130);
  }
  document.addEventListener('pointerover', event => {
    if (tip.contains(event.target) || tip.isConnected && anchor?.contains(event.target)) clearTimeout(timer);
    enter(event, 220);
  });
  document.addEventListener('focusin', event => enter(event, 0));
  document.addEventListener('pointerout', leave);
  document.addEventListener('focusout', leave);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !tip.isConnected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hide();
  }, true);
  return hide;
}
