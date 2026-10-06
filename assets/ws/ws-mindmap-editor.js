import * as P from './ws-platform.js?v=20260914-6';

const NODE_KINDS = [
  ['concept', 'Concept'],
  ['question', 'Question'],
  ['hypothesis', 'Hypothesis'],
  ['note', 'Note'],
  ['paper', 'Paper'],
  ['dataset', 'Dataset'],
  ['task', 'Task'],
  ['other', 'Other'],
];

const RELATIONS = [
  ['related', 'Related to'],
  ['supports', 'Supports'],
  ['uses', 'Uses'],
  ['derived_from', 'Derived from'],
  ['evidence_for', 'Evidence for'],
  ['contradicts', 'Contradicts'],
  ['produces', 'Produces'],
  ['reviews', 'Reviews'],
  ['answers', 'Answers'],
  ['depends_on', 'Depends on'],
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 190;
const NODE_H = 74;
let activeLayer = null;

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};

function button(label, handler, { solid = false, danger = false, tiny = false } = {}) {
  const node = el('button', `ws-btn${solid ? ' ws-btn--solid' : ''}${tiny ? ' ws-btn--tiny' : ''}`, label);
  node.type = 'button';
  if (danger) node.dataset.tone = 'bad';
  node.addEventListener('click', handler);
  return node;
}

function field(label, control) {
  const wrap = el('label', 'mindmap-editor__field');
  wrap.append(el('span', '', label), control);
  return wrap;
}

function input(value = '', placeholder = '') {
  const node = el('input', 'v-input mindmap-editor__input');
  node.value = value == null ? '' : String(value);
  node.placeholder = placeholder;
  return node;
}

function textarea(value = '', placeholder = '') {
  const node = el('textarea', 'v-input mindmap-editor__input mindmap-editor__textarea');
  node.value = value == null ? '' : String(value);
  node.placeholder = placeholder;
  return node;
}

function select(options, value = '') {
  const node = el('select', 'v-input mindmap-editor__input');
  for (const [key, label] of options) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = String(key) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapRequest(mapId, body, method = 'POST') {
  return P.call(`/platform/mindmaps/${mapId}/`, { method, body });
}

function closeActive() {
  if (!activeLayer) return;
  activeLayer.remove();
  activeLayer = null;
}

export async function openMindMapEditor(mapId, { onChanged = null } = {}) {
  closeActive();

  const layer = el('div', 'mindmap-editor-layer');
  const frame = el('section', 'mindmap-editor');
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-modal', 'true');
  frame.setAttribute('aria-label', 'Mind map editor');
  layer.append(frame);
  document.body.append(layer);
  activeLayer = layer;

  const header = el('header', 'mindmap-editor__head');
  const heading = el('div', 'mindmap-editor__heading');
  heading.append(el('span', 'mindmap-editor__eyebrow', 'RESEARCH MIND MAP'), el('h2', '', 'Loading map…'));
  const headerActions = el('div', 'mindmap-editor__head-actions');
  const close = button('Close', closeActive);
  headerActions.append(close);
  header.append(heading, headerActions);
  frame.append(header);

  const loading = el('div', 'mindmap-editor__loading', 'Loading mind map…');
  frame.append(loading);

  let data;
  try {
    data = await P.call(`/platform/mindmaps/${mapId}/`);
  } catch (error) {
    loading.textContent = error?.data?.error || error?.message || 'Mind map could not be loaded.';
    loading.dataset.tone = 'bad';
    return;
  }
  if (activeLayer !== layer) return;

  const state = {
    item: data.item || data,
    selectedId: null,
    nodes: [...(data.item?.nodes || [])],
    edges: [...(data.item?.edges || [])],
    savingPosition: new Set(),
  };
  const editable = !!state.item.permissions?.can_edit;
  loading.remove();
  heading.querySelector('h2').textContent = state.item.title || 'Untitled mind map';

  const status = el('span', 'mindmap-editor__status', editable ? 'Editable' : 'Read only');
  status.setAttribute('role', 'status');
  headerActions.prepend(status);

  const layout = el('div', 'mindmap-editor__layout');
  const sidebar = el('aside', 'mindmap-editor__sidebar');
  const workspace = el('main', 'mindmap-editor__workspace');
  const inspector = el('aside', 'mindmap-editor__inspector');
  layout.append(sidebar, workspace, inspector);
  frame.append(layout);

  const mapTitle = input(state.item.title || '', 'Map title');
  const mapDescription = textarea(state.item.description || '', 'What does this map explain?');
  mapTitle.disabled = !editable;
  mapDescription.disabled = !editable;

  const setStatus = (text, tone = '') => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else status.removeAttribute('data-tone');
  };

  const changed = () => {
    if (typeof onChanged === 'function') onChanged();
    window.dispatchEvent(new CustomEvent('ws:mindmap-changed', { detail: { mapId: Number(mapId) } }));
  };

  const saveMap = button('Save map', async () => {
    saveMap.disabled = true;
    setStatus('Saving map…');
    try {
      await mapRequest(mapId, { title: mapTitle.value.trim(), description: mapDescription.value }, 'PATCH');
      state.item.title = mapTitle.value.trim();
      state.item.description = mapDescription.value;
      heading.querySelector('h2').textContent = state.item.title || 'Untitled mind map';
      setStatus('Map saved');
      changed();
    } catch (error) {
      setStatus(error?.data?.error || error?.message || 'Map could not be saved', 'bad');
    } finally {
      saveMap.disabled = false;
    }
  }, { solid: true });

  const deleteMap = button('Delete map', async () => {
    if (!window.confirm(`Delete “${state.item.title || 'this mind map'}” and all of its nodes and connections?`)) return;
    deleteMap.disabled = true;
    setStatus('Deleting…');
    try {
      await mapRequest(mapId, null, 'DELETE');
      changed();
      closeActive();
    } catch (error) {
      setStatus(error?.data?.error || error?.message || 'Map could not be deleted', 'bad');
      deleteMap.disabled = false;
    }
  }, { danger: true });

  const mapSection = el('section', 'mindmap-editor__side-section');
  mapSection.append(el('h3', '', 'Map'), field('Title', mapTitle), field('Description', mapDescription));
  if (editable) mapSection.append(saveMap, deleteMap);
  sidebar.append(mapSection);

  const help = el('section', 'mindmap-editor__side-section mindmap-editor__help');
  help.append(
    el('h3', '', 'How it works'),
    el('p', '', editable
      ? 'Add nodes, drag them on the canvas, select a node to edit it, then connect it to another node.'
      : 'Select nodes to read their details. Editing follows the project access level.'),
  );
  sidebar.append(help);

  const toolbar = el('div', 'mindmap-editor__toolbar');
  const addNode = button('Add node', async () => {
    addNode.disabled = true;
    setStatus('Adding node…');
    const index = state.nodes.length;
    const x = 70 + (index % 4) * 245;
    const y = 70 + Math.floor(index / 4) * 150;
    try {
      const result = await mapRequest(mapId, {
        action: 'node.create',
        key: `node-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        title: 'New node',
        kind: 'concept',
        x,
        y,
      });
      await reload(result.node?.id);
      setStatus('Node added');
      changed();
    } catch (error) {
      setStatus(error?.data?.error || error?.message || 'Node could not be added', 'bad');
    } finally {
      addNode.disabled = false;
    }
  }, { solid: true });
  if (editable) toolbar.append(addNode);
  toolbar.append(el('span', 'mindmap-editor__toolbar-note', editable ? 'Drag nodes to reorganise the map' : 'Read only map'));
  workspace.append(toolbar);

  const viewport = el('div', 'mindmap-editor__viewport');
  const canvas = el('div', 'mindmap-editor__canvas');
  const edgeLayer = svg('svg', { class: 'mindmap-editor__edges', viewBox: '0 0 1400 850', preserveAspectRatio: 'none' });
  const nodeLayer = el('div', 'mindmap-editor__nodes');
  canvas.append(edgeLayer, nodeLayer);
  viewport.append(canvas);
  workspace.append(viewport);

  function nodeById(id) {
    return state.nodes.find((node) => String(node.id) === String(id));
  }

  function renderEdges() {
    edgeLayer.replaceChildren();
    for (const edge of state.edges) {
      const source = nodeById(edge.source_id);
      const target = nodeById(edge.target_id);
      if (!source || !target) continue;
      const x1 = safeNumber(source.x) + NODE_W / 2;
      const y1 = safeNumber(source.y) + NODE_H / 2;
      const x2 = safeNumber(target.x) + NODE_W / 2;
      const y2 = safeNumber(target.y) + NODE_H / 2;
      const line = svg('line', { x1, y1, x2, y2, class: 'mindmap-editor__edge-line' });
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const labelText = edge.label || RELATIONS.find(([key]) => key === edge.relation)?.[1] || edge.relation || '';
      const bg = svg('rect', { x: mx - 56, y: my - 10, width: 112, height: 20, rx: 10, class: 'mindmap-editor__edge-label-bg' });
      const text = svg('text', { x: mx, y: my + 4, 'text-anchor': 'middle', class: 'mindmap-editor__edge-label' });
      text.textContent = labelText;
      edgeLayer.append(line, bg, text);
    }
  }

  function positionNode(element, node) {
    element.style.left = `${safeNumber(node.x)}px`;
    element.style.top = `${safeNumber(node.y)}px`;
  }

  function enableDrag(card, node) {
    if (!editable) return;
    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button,input,textarea,select')) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const baseX = safeNumber(node.x);
      const baseY = safeNumber(node.y);
      card.setPointerCapture(event.pointerId);
      card.dataset.dragging = '1';

      const move = (moveEvent) => {
        const scaleX = canvas.clientWidth / 1400 || 1;
        const scaleY = canvas.clientHeight / 850 || 1;
        node.x = clamp(baseX + (moveEvent.clientX - startX) / scaleX, 16, 1400 - NODE_W - 16);
        node.y = clamp(baseY + (moveEvent.clientY - startY) / scaleY, 16, 850 - NODE_H - 16);
        positionNode(card, node);
        renderEdges();
      };
      const end = async () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', end);
        card.removeEventListener('pointercancel', end);
        delete card.dataset.dragging;
        if (state.savingPosition.has(node.id)) return;
        state.savingPosition.add(node.id);
        try {
          await mapRequest(mapId, { action: 'node.update', node_id: node.id, x: node.x, y: node.y });
          setStatus('Position saved');
          changed();
        } catch (error) {
          setStatus(error?.data?.error || error?.message || 'Position could not be saved', 'bad');
        } finally {
          state.savingPosition.delete(node.id);
        }
      };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    });
  }

  function renderNodes() {
    nodeLayer.replaceChildren();
    for (const node of state.nodes) {
      const card = el('button', 'mindmap-editor__node');
      card.type = 'button';
      card.dataset.kind = node.kind || 'concept';
      card.dataset.selected = String(node.id) === String(state.selectedId) ? '1' : '0';
      positionNode(card, node);
      card.append(
        el('span', 'mindmap-editor__node-kind', NODE_KINDS.find(([key]) => key === node.kind)?.[1] || node.kind || 'Concept'),
        el('strong', '', node.title || 'Untitled node'),
      );
      if (node.body) card.append(el('small', '', node.body.slice(0, 90)));
      card.addEventListener('click', () => {
        state.selectedId = node.id;
        renderNodes();
        renderInspector();
      });
      enableDrag(card, node);
      nodeLayer.append(card);
    }
    renderEdges();
  }

  function connectionRows(node) {
    return state.edges.filter((edge) => String(edge.source_id) === String(node.id) || String(edge.target_id) === String(node.id));
  }

  function renderInspector() {
    inspector.innerHTML = '';
    const node = nodeById(state.selectedId);
    if (!node) {
      const empty = el('div', 'mindmap-editor__inspector-empty');
      empty.append(el('strong', '', state.nodes.length ? 'Select a node' : 'No nodes yet'), el('p', '', state.nodes.length ? 'Choose a node on the canvas to inspect or edit it.' : 'Add the first node to start building the map.'));
      inspector.append(empty);
      return;
    }

    const title = input(node.title || '', 'Node title');
    const kind = select(NODE_KINDS, node.kind || 'concept');
    const body = textarea(node.body || '', 'Notes, evidence, question or explanation');
    title.disabled = !editable;
    kind.disabled = !editable;
    body.disabled = !editable;
    inspector.append(el('h3', '', 'Selected node'), field('Title', title), field('Type', kind), field('Details', body));

    if (editable) {
      const save = button('Save node', async () => {
        save.disabled = true;
        setStatus('Saving node…');
        try {
          await mapRequest(mapId, { action: 'node.update', node_id: node.id, title: title.value.trim(), kind: kind.value, body: body.value });
          await reload(node.id);
          setStatus('Node saved');
          changed();
        } catch (error) {
          setStatus(error?.data?.error || error?.message || 'Node could not be saved', 'bad');
          save.disabled = false;
        }
      }, { solid: true });

      const remove = button('Delete node', async () => {
        if (!window.confirm(`Delete “${node.title || 'this node'}” and its connections?`)) return;
        remove.disabled = true;
        try {
          await mapRequest(mapId, { action: 'node.delete', node_id: node.id });
          state.selectedId = null;
          await reload();
          setStatus('Node deleted');
          changed();
        } catch (error) {
          setStatus(error?.data?.error || error?.message || 'Node could not be deleted', 'bad');
          remove.disabled = false;
        }
      }, { danger: true });
      const actions = el('div', 'mindmap-editor__inspector-actions');
      actions.append(save, remove);
      inspector.append(actions);

      const otherNodes = state.nodes.filter((candidate) => String(candidate.id) !== String(node.id));
      const connect = el('section', 'mindmap-editor__connect');
      connect.append(el('h3', '', 'Connect node'));
      if (!otherNodes.length) {
        connect.append(el('p', 'mindmap-editor__muted', 'Add another node before creating a connection.'));
      } else {
        const target = select(otherNodes.map((candidate) => [String(candidate.id), candidate.title || `Node ${candidate.id}`]), String(otherNodes[0].id));
        const relation = select(RELATIONS, 'related');
        const edgeLabel = input('', 'Optional connection label');
        const addEdge = button('Add connection', async () => {
          addEdge.disabled = true;
          setStatus('Adding connection…');
          try {
            await mapRequest(mapId, {
              action: 'edge.create',
              source_id: node.id,
              target_id: Number(target.value),
              relation: relation.value,
              label: edgeLabel.value.trim(),
            });
            await reload(node.id);
            setStatus('Connection added');
            changed();
          } catch (error) {
            setStatus(error?.data?.error || error?.message || 'Connection could not be added', 'bad');
            addEdge.disabled = false;
          }
        });
        connect.append(field('To', target), field('Relation', relation), field('Label', edgeLabel), addEdge);
      }
      inspector.append(connect);
    }

    const connections = el('section', 'mindmap-editor__connections');
    connections.append(el('h3', '', 'Connections'));
    const rows = connectionRows(node);
    if (!rows.length) connections.append(el('p', 'mindmap-editor__muted', 'No connections yet.'));
    for (const edge of rows) {
      const outgoing = String(edge.source_id) === String(node.id);
      const other = nodeById(outgoing ? edge.target_id : edge.source_id);
      const row = el('div', 'mindmap-editor__connection');
      const copy = el('div', '');
      copy.append(
        el('strong', '', other?.title || 'Unknown node'),
        el('small', '', `${outgoing ? '→' : '←'} ${edge.label || RELATIONS.find(([key]) => key === edge.relation)?.[1] || edge.relation}`),
      );
      row.append(copy);
      if (editable) {
        row.append(button('Remove', async () => {
          try {
            await mapRequest(mapId, { action: 'edge.delete', edge_id: edge.id });
            await reload(node.id);
            setStatus('Connection removed');
            changed();
          } catch (error) {
            setStatus(error?.data?.error || error?.message || 'Connection could not be removed', 'bad');
          }
        }, { tiny: true }));
      }
      connections.append(row);
    }
    inspector.append(connections);
  }

  async function reload(selectId = state.selectedId) {
    const result = await P.call(`/platform/mindmaps/${mapId}/`);
    state.item = result.item || result;
    state.nodes = [...(state.item.nodes || [])];
    state.edges = [...(state.item.edges || [])];
    state.selectedId = selectId && nodeById(selectId) ? selectId : (state.nodes[0]?.id || null);
    mapTitle.value = state.item.title || '';
    mapDescription.value = state.item.description || '';
    heading.querySelector('h2').textContent = state.item.title || 'Untitled mind map';
    renderNodes();
    renderInspector();
  }

  layer.addEventListener('pointerdown', (event) => {
    if (event.target === layer) closeActive();
  });
  const escape = (event) => {
    if (event.key === 'Escape' && activeLayer === layer) {
      document.removeEventListener('keydown', escape);
      closeActive();
    }
  };
  document.addEventListener('keydown', escape, { once: false });

  state.selectedId = state.nodes[0]?.id || null;
  renderNodes();
  renderInspector();
  requestAnimationFrame(() => {
    if (state.selectedId) {
      const selected = nodeById(state.selectedId);
      viewport.scrollTo({ left: Math.max(0, safeNumber(selected?.x) - 120), top: Math.max(0, safeNumber(selected?.y) - 100) });
    }
  });
}
