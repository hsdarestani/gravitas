import * as P from './ws-platform.js?v=20261008-operational2';

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
let activeCleanup = null;

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
  if (activeCleanup) activeCleanup();
  activeCleanup = null;
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
    connectionPreview: null,
    canvasPopover: null,
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
      ? 'Drag nodes directly on the map. Double click a node or use its edit button to edit it on the canvas. Drag the connector dot from one node onto another to connect them.'
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
  toolbar.append(el('span', 'mindmap-editor__toolbar-note', editable ? 'Drag nodes · double click to edit · drag the connector dot to link nodes' : 'Read only map'));
  workspace.append(toolbar);

  const viewport = el('div', 'mindmap-editor__viewport');
  const canvas = el('div', 'mindmap-editor__canvas');
  const edgeLayer = svg('svg', { class: 'mindmap-editor__edges', viewBox: '0 0 1400 850', preserveAspectRatio: 'none' });
  const edgeControlLayer = el('div', 'mindmap-editor__edge-controls');
  const nodeLayer = el('div', 'mindmap-editor__nodes');
  canvas.append(edgeLayer, edgeControlLayer, nodeLayer);
  viewport.append(canvas);
  workspace.append(viewport);

  function nodeById(id) {
    return state.nodes.find((node) => String(node.id) === String(id));
  }

  function renderEdges() {
    edgeLayer.replaceChildren();
    edgeControlLayer.replaceChildren();
    for (const edge of state.edges) {
      const source = nodeById(edge.source_id);
      const target = nodeById(edge.target_id);
      if (!source || !target) continue;
      const x1 = safeNumber(source.x) + NODE_W / 2;
      const y1 = safeNumber(source.y) + NODE_H / 2;
      const x2 = safeNumber(target.x) + NODE_W / 2;
      const y2 = safeNumber(target.y) + NODE_H / 2;
      const line = svg('line', { x1, y1, x2, y2, class: 'mindmap-editor__edge-line' });
      edgeLayer.append(line);

      const labelText = edge.label || RELATIONS.find(([key]) => key === edge.relation)?.[1] || edge.relation || '';
      const badge = el('button', 'mindmap-editor__edge-chip', labelText);
      badge.type = 'button';
      badge.style.left = `${(x1 + x2) / 2}px`;
      badge.style.top = `${(y1 + y2) / 2}px`;
      badge.title = editable ? 'Edit connection on canvas' : labelText;
      if (!editable) badge.disabled = true;
      else badge.addEventListener('click', (event) => {
        event.stopPropagation();
        openEdgeCanvasEditor(edge);
      });
      edgeControlLayer.append(badge);
    }

    if (state.connectionPreview) {
      const preview = state.connectionPreview;
      edgeLayer.append(svg('line', {
        x1: preview.x1,
        y1: preview.y1,
        x2: preview.x2,
        y2: preview.y2,
        class: 'mindmap-editor__edge-line mindmap-editor__edge-line--preview',
      }));
    }
  }

  function positionNode(element, node) {
    element.style.left = `${safeNumber(node.x)}px`;
    element.style.top = `${safeNumber(node.y)}px`;
  }

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = 1400 / (rect.width || 1400);
    const scaleY = 850 / (rect.height || 850);
    return {
      x: clamp((clientX - rect.left) * scaleX, 0, 1400),
      y: clamp((clientY - rect.top) * scaleY, 0, 850),
    };
  }

  function closeCanvasPopover() {
    state.canvasPopover?.remove();
    state.canvasPopover = null;
  }

  function placeCanvasPopover(popover, x, y) {
    const width = 286;
    const height = 270;
    popover.style.left = `${clamp(x, 12, 1400 - width - 12)}px`;
    popover.style.top = `${clamp(y, 12, 850 - height - 12)}px`;
  }

  function openNodeCanvasEditor(node) {
    if (!editable) return;
    closeCanvasPopover();

    const popover = el('div', 'mindmap-editor__canvas-popover');
    popover.dataset.kind = 'node';
    const head = el('div', 'mindmap-editor__canvas-popover-head');
    head.append(el('strong', '', 'Edit node'), button('×', closeCanvasPopover, { tiny: true }));
    const title = input(node.title || '', 'Node title');
    const kind = select(NODE_KINDS, node.kind || 'concept');
    const body = textarea(node.body || '', 'Notes, evidence, question or explanation');
    const actions = el('div', 'mindmap-editor__canvas-popover-actions');
    const save = button('Save', async () => {
      save.disabled = true;
      setStatus('Saving node…');
      try {
        await mapRequest(mapId, {
          action: 'node.update',
          node_id: node.id,
          title: title.value.trim(),
          kind: kind.value,
          body: body.value,
        });
        closeCanvasPopover();
        await reload(node.id);
        setStatus('Node saved');
        changed();
      } catch (error) {
        setStatus(error?.data?.error || error?.message || 'Node could not be saved', 'bad');
        save.disabled = false;
      }
    }, { solid: true });
    const remove = button('Delete', async () => {
      if (!window.confirm(`Delete “${node.title || 'this node'}” and its connections?`)) return;
      remove.disabled = true;
      try {
        await mapRequest(mapId, { action: 'node.delete', node_id: node.id });
        closeCanvasPopover();
        state.selectedId = null;
        await reload();
        setStatus('Node deleted');
        changed();
      } catch (error) {
        setStatus(error?.data?.error || error?.message || 'Node could not be deleted', 'bad');
        remove.disabled = false;
      }
    }, { danger: true });
    actions.append(save, remove);
    popover.append(head, field('Title', title), field('Type', kind), field('Details', body), actions);
    canvas.append(popover);
    state.canvasPopover = popover;
    placeCanvasPopover(popover, safeNumber(node.x) + NODE_W + 12, safeNumber(node.y));
    queueMicrotask(() => title.focus());
  }

  function openEdgeCanvasEditor(edge) {
    if (!editable) return;
    closeCanvasPopover();
    const source = nodeById(edge.source_id);
    const target = nodeById(edge.target_id);
    if (!source || !target) return;

    const popover = el('div', 'mindmap-editor__canvas-popover mindmap-editor__canvas-popover--edge');
    popover.dataset.kind = 'edge';
    const head = el('div', 'mindmap-editor__canvas-popover-head');
    head.append(el('strong', '', 'Edit connection'), button('×', closeCanvasPopover, { tiny: true }));
    const relation = select(RELATIONS, edge.relation || 'related');
    const labelInput = input(edge.label || '', 'Optional connection label');
    const actions = el('div', 'mindmap-editor__canvas-popover-actions');
    const save = button('Save', async () => {
      save.disabled = true;
      setStatus('Saving connection…');
      try {
        await mapRequest(mapId, {
          action: 'edge.update',
          edge_id: edge.id,
          relation: relation.value,
          label: labelInput.value.trim(),
        });
        closeCanvasPopover();
        await reload(state.selectedId);
        setStatus('Connection saved');
        changed();
      } catch (error) {
        setStatus(error?.data?.error || error?.message || 'Connection could not be saved', 'bad');
        save.disabled = false;
      }
    }, { solid: true });
    const remove = button('Delete', async () => {
      remove.disabled = true;
      try {
        await mapRequest(mapId, { action: 'edge.delete', edge_id: edge.id });
        closeCanvasPopover();
        await reload(state.selectedId);
        setStatus('Connection removed');
        changed();
      } catch (error) {
        setStatus(error?.data?.error || error?.message || 'Connection could not be removed', 'bad');
        remove.disabled = false;
      }
    }, { danger: true });
    actions.append(save, remove);
    popover.append(
      head,
      el('small', 'mindmap-editor__canvas-popover-route', `${source.title || 'Node'} → ${target.title || 'Node'}`),
      field('Relation', relation),
      field('Label', labelInput),
      actions,
    );
    canvas.append(popover);
    state.canvasPopover = popover;
    const mx = (safeNumber(source.x) + safeNumber(target.x)) / 2 + NODE_W / 2;
    const my = (safeNumber(source.y) + safeNumber(target.y)) / 2 + NODE_H / 2;
    placeCanvasPopover(popover, mx + 12, my + 12);
    queueMicrotask(() => labelInput.focus());
  }

  function beginConnection(event, sourceNode, port) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    closeCanvasPopover();

    const sourceX = safeNumber(sourceNode.x) + NODE_W;
    const sourceY = safeNumber(sourceNode.y) + NODE_H / 2;
    const point = canvasPoint(event.clientX, event.clientY);
    state.connectionPreview = { sourceId: sourceNode.id, x1: sourceX, y1: sourceY, x2: point.x, y2: point.y };
    port.setPointerCapture(event.pointerId);
    port.dataset.connecting = '1';
    renderEdges();

    let hoverCard = null;
    const clearTarget = () => {
      if (hoverCard) hoverCard.removeAttribute('data-drop-target');
      hoverCard = null;
    };
    const move = (moveEvent) => {
      const next = canvasPoint(moveEvent.clientX, moveEvent.clientY);
      state.connectionPreview.x2 = next.x;
      state.connectionPreview.y2 = next.y;
      clearTarget();
      const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.mindmap-editor__node');
      if (hit && String(hit.dataset.nodeId) !== String(sourceNode.id)) {
        hoverCard = hit;
        hoverCard.dataset.dropTarget = '1';
      }
      renderEdges();
    };
    const end = async (endEvent) => {
      port.removeEventListener('pointermove', move);
      port.removeEventListener('pointerup', end);
      port.removeEventListener('pointercancel', cancel);
      delete port.dataset.connecting;
      const hit = document.elementFromPoint(endEvent.clientX, endEvent.clientY)?.closest('.mindmap-editor__node');
      clearTarget();
      state.connectionPreview = null;
      renderEdges();
      if (!hit || String(hit.dataset.nodeId) === String(sourceNode.id)) return;
      const targetId = Number(hit.dataset.nodeId);
      setStatus('Adding connection…');
      try {
        await mapRequest(mapId, {
          action: 'edge.create',
          source_id: sourceNode.id,
          target_id: targetId,
          relation: 'related',
          label: '',
        });
        await reload(sourceNode.id);
        setStatus('Connection added');
        changed();
      } catch (error) {
        setStatus(error?.data?.error || error?.message || 'Connection could not be added', 'bad');
      }
    };
    const cancel = () => {
      port.removeEventListener('pointermove', move);
      port.removeEventListener('pointerup', end);
      port.removeEventListener('pointercancel', cancel);
      delete port.dataset.connecting;
      clearTarget();
      state.connectionPreview = null;
      renderEdges();
    };
    port.addEventListener('pointermove', move);
    port.addEventListener('pointerup', end);
    port.addEventListener('pointercancel', cancel);
  }

  function enableDrag(card, node) {
    if (!editable) return;
    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button,input,textarea,select,.mindmap-editor__node-tools')) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const baseX = safeNumber(node.x);
      const baseY = safeNumber(node.y);
      let moved = false;
      card.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        moveEvent.preventDefault();
        card.dataset.dragging = '1';
        const scaleX = 1400 / (canvas.getBoundingClientRect().width || 1400);
        const scaleY = 850 / (canvas.getBoundingClientRect().height || 850);
        node.x = clamp(baseX + dx * scaleX, 16, 1400 - NODE_W - 16);
        node.y = clamp(baseY + dy * scaleY, 16, 850 - NODE_H - 16);
        positionNode(card, node);
        renderEdges();
      };
      const finish = async () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', finish);
        card.removeEventListener('pointercancel', cancel);
        delete card.dataset.dragging;
        if (!moved || state.savingPosition.has(node.id)) return;
        state.savingPosition.add(node.id);
        setStatus('Saving position…');
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
      const cancel = () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', finish);
        card.removeEventListener('pointercancel', cancel);
        delete card.dataset.dragging;
      };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', finish);
      card.addEventListener('pointercancel', cancel);
    });
  }

  function renderNodes() {
    nodeLayer.replaceChildren();
    for (const node of state.nodes) {
      const card = el('div', 'mindmap-editor__node');
      card.dataset.nodeId = String(node.id);
      card.dataset.kind = node.kind || 'concept';
      card.dataset.selected = String(node.id) === String(state.selectedId) ? '1' : '0';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      positionNode(card, node);

      const copy = el('div', 'mindmap-editor__node-copy');
      copy.append(
        el('span', 'mindmap-editor__node-kind', NODE_KINDS.find(([key]) => key === node.kind)?.[1] || node.kind || 'Concept'),
        el('strong', '', node.title || 'Untitled node'),
      );
      if (node.body) copy.append(el('small', '', node.body.slice(0, 90)));
      card.append(copy);

      if (editable) {
        const tools = el('div', 'mindmap-editor__node-tools');
        const edit = button('Edit', (event) => {
          event.stopPropagation();
          state.selectedId = node.id;
          renderInspector();
          openNodeCanvasEditor(node);
        }, { tiny: true });
        edit.classList.add('mindmap-editor__node-edit');
        edit.title = 'Edit this node on the canvas';

        const port = el('button', 'mindmap-editor__node-connect', '●');
        port.type = 'button';
        port.title = 'Drag onto another node to connect';
        port.setAttribute('aria-label', 'Drag to connect this node');
        port.addEventListener('pointerdown', (event) => beginConnection(event, node, port));
        tools.append(edit, port);
        card.append(tools);
      }

      card.addEventListener('click', (event) => {
        if (card.dataset.dragging === '1' || event.target.closest('.mindmap-editor__node-tools')) return;
        state.selectedId = node.id;
        renderNodes();
        renderInspector();
      });
      card.addEventListener('dblclick', (event) => {
        if (!editable || event.target.closest('.mindmap-editor__node-tools')) return;
        event.preventDefault();
        state.selectedId = node.id;
        renderInspector();
        openNodeCanvasEditor(node);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          state.selectedId = node.id;
          renderInspector();
          if (editable) openNodeCanvasEditor(node);
        }
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
    closeCanvasPopover();
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
    if (event.key === 'Escape' && activeLayer === layer) closeActive();
  };
  document.addEventListener('keydown', escape);
  activeCleanup = () => document.removeEventListener('keydown', escape);

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
