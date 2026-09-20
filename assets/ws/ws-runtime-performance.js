/* Lightweight workspace scheduling helpers.
 *
 * Enhancers used to attach broad subtree MutationObservers and then rescan the
 * entire workspace for every small DOM change. These helpers keep behavior the
 * same while making redraw work route-aware and top-level where possible.
 */

export function cleanPath() {
  return location.pathname.replace(/\/$/, '') || '/';
}

export function pathMatches(matchers = []) {
  const path = cleanPath();
  return matchers.some((matcher) => {
    if (typeof matcher === 'function') return !!matcher(path);
    if (matcher instanceof RegExp) return matcher.test(path);
    if (typeof matcher === 'string') return path === matcher || path.startsWith(`${matcher}/`);
    return false;
  });
}

export function scheduleFrame(state, key, task) {
  if (state[key]) return;
  state[key] = true;
  requestAnimationFrame(() => {
    state[key] = false;
    task();
  });
}

export function scheduleIdle(state, key, task, timeout = 900) {
  if (state[key]) return;
  state[key] = true;
  const run = () => {
    state[key] = false;
    task();
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout });
  } else {
    window.setTimeout(run, Math.min(timeout, 180));
  }
}

export function observeSurface({
  target,
  active = () => true,
  callback,
  subtree = false,
  attributes = false,
  attributeFilter,
}) {
  if (!target) return null;
  const observer = new MutationObserver((records) => {
    if (document.visibilityState === 'hidden' || !active()) return;

    // Ignore text-only mutations. Renderers replace/append element nodes when a
    // surface genuinely needs enhancement; save-state text updates should not
    // wake every workspace enhancer.
    const meaningful = records.some((record) => {
      if (record.type === 'attributes') return true;
      return [...record.addedNodes, ...record.removedNodes]
        .some((node) => node.nodeType === Node.ELEMENT_NODE);
    });
    if (meaningful) callback(records);
  });
  observer.observe(target, {
    childList: true,
    subtree,
    attributes,
    ...(attributeFilter ? { attributeFilter } : {}),
  });
  return observer;
}
