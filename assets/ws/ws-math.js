const KATEX_VERSION = '0.16.11';
const KATEX_ROOT = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/';
let katexPromise = null;

function ensureKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-gravitas-katex]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = KATEX_ROOT + 'katex.min.css';
      css.dataset.gravitasKatex = '1';
      document.head.append(css);
    }
    const script = document.createElement('script');
    script.src = KATEX_ROOT + 'katex.min.js';
    script.async = true;
    script.dataset.gravitasKatex = '1';
    script.onload = () => resolve(window.katex);
    script.onerror = () => reject(new Error('KaTeX could not be loaded.'));
    document.head.append(script);
  });
  return katexPromise;
}

function parseMath(text) {
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    const token = match[0];
    let display = false;
    let latex = token;
    if (token.startsWith('$$')) {
      display = true;
      latex = token.slice(2, -2);
    } else if (token.startsWith('\\[')) {
      display = true;
      latex = token.slice(2, -2);
    } else if (token.startsWith('\\(')) {
      latex = token.slice(2, -2);
    } else {
      latex = token.slice(1, -1);
    }
    parts.push({ type: 'math', value: latex, display });
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts.some((part) => part.type === 'math') ? parts : null;
}

function copyButton(latex) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g-math__copy';
  button.textContent = 'LaTeX';
  button.title = 'Copy LaTeX source';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(latex);
      const old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = old; }, 900);
    } catch {
      button.textContent = 'Copy failed';
    }
  });
  return button;
}

async function transformTextNode(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest('script,style,textarea,input,select,option,code,pre,kbd,.katex,.g-math,[contenteditable="true"]')) return;
  const parts = parseMath(node.nodeValue || '');
  if (!parts) return;
  let katex;
  try { katex = await ensureKatex(); } catch { return; }
  if (!node.isConnected) return;

  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.type === 'text') {
      fragment.append(document.createTextNode(part.value));
      continue;
    }
    const wrap = document.createElement(part.display ? 'div' : 'span');
    wrap.className = 'g-math' + (part.display ? ' g-math--display' : '');
    wrap.dataset.latex = part.value;
    const render = document.createElement('span');
    render.className = 'g-math__render';
    try {
      katex.render(part.value, render, { displayMode: part.display, throwOnError: false, strict: 'ignore' });
    } catch {
      render.textContent = part.value;
    }
    wrap.append(render, copyButton(part.value));
    fragment.append(wrap);
  }
  node.replaceWith(fragment);
}

function scan(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach((item) => transformTextNode(item));
}

export function installMathRendering() {
  const host = document.getElementById('ws-view');
  if (!host) return;
  scan(host);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) transformTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE && !node.closest?.('.katex,.g-math')) scan(node);
      }
    }
  });
  observer.observe(host, { childList: true, subtree: true });
}
