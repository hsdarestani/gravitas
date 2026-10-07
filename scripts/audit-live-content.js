/* ==========================================================================
   LIVE CONTENT AUDIT  ·  paste into the browser console on /workspace.html
   while signed in as the person who enters the content.

   The static checker (scripts/check-api-coverage.mjs) proves which routes
   exist. This proves which of them actually hold rows right now, and whether
   the shape they return is the shape the new UI reads. A route can be live,
   registered and completely misread, which is the failure that looks like
   "the page is just empty" rather than like an error.

   Reads only. Nothing here writes, creates or deletes.
   ========================================================================== */

(async () => {
  const get = async (p) => {
    try {
      const r = await fetch('/api' + p, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    } catch (e) {
      return { status: 0, body: null };
    }
  };

  const count = (b) => {
    if (!b || typeof b !== 'object') return 0;
    for (const k of ['items', 'results', 'nodes', 'notes', 'members', 'tree']) {
      if (Array.isArray(b[k])) return b[k].length;
    }
    return Array.isArray(b) ? b.length : '-';
  };

  // Everything a content author could plausibly have filled in.
  const probes = [
    '/auth/me/',
    '/platform/bootstrap/',
    '/platform/space/tree/',
    '/platform/space/notes/',
    '/platform/space/items/',
    '/platform/content/',
    '/platform/projects/',
    '/platform/resources/?kind=note',
    '/platform/resources/?kind=file',
    '/platform/resources/?kind=dataset',
    '/platform/resources/?kind=paper',
    '/platform/researchers/',
    '/platform/team/',
    '/platform/mindmaps/',
    '/platform/research-requests/',
    '/platform/shared-with-me/',
    '/workspace/dashboard/',
    '/workspace/knowledge/',
    '/workspace/projects/',
    '/workspace/collections/',
    '/workspace/tags/',
    '/operating/dashboard/',
    '/operating/objectives/',
    '/operating/key-results/',
    '/operating/initiatives/',
    '/operating/tasks/',
    '/operating/milestones/',
    '/operating/work-packages/',
    '/operating/meetings/',
    '/operating/risks/',
    '/operating/processes/',
    '/operating/cycles/',
  ];

  const rows = [];
  for (const p of probes) {
    const { status, body } = await get(p);
    rows.push({
      endpoint: p,
      status,
      rows: status === 200 ? count(body) : '',
      note: status === 200 ? '' : status === 404 ? 'NO ROUTE' : status === 401 || status === 403 ? 'no access' : 'error',
    });
  }

  console.log('%c--- what the backend is actually holding ---', 'font-weight:bold');
  console.table(rows);

  const withRows = rows.filter((r) => typeof r.rows === 'number' && r.rows > 0);
  console.log('%cendpoints with content: ' + withRows.length, 'font-weight:bold');
  console.log(withRows.map((r) => `${r.rows.toString().padStart(5)}  ${r.endpoint}`).join('\n'));

  /* ---- The shape check ------------------------------------------------
     ws-api.js reads tree() as payload.nodes and then walks node.parent and
     node.space. The backend's _node_json emits parent_id, and emits no space
     and no phantom at all. If that is still true here, every node renders as
     a root and every one of them lands in Research, so Core and Knowledge
     open empty no matter how much the author has written. */

  const tree = await get('/platform/space/tree/');
  if (tree.status === 200 && Array.isArray(tree.body?.nodes)) {
    const n = tree.body.nodes[0];
    console.log('%c--- tree contract ---', 'font-weight:bold');
    console.log('nodes returned      :', tree.body.nodes.length);
    console.log('sample node keys    :', n ? Object.keys(n).join(', ') : '(no nodes)');
    if (n) {
      const problems = [];
      if (!('parent' in n) && 'parent_id' in n) problems.push('node.parent missing (server sends parent_id) -> tree renders flat');
      if (!('space' in n)) problems.push('node.space missing -> spaceOfNode() puts everything in Research');
      if (!('phantom' in n)) problems.push('node.phantom missing -> phantom styling never applies');
      console.log(problems.length ? '%cMISMATCH:' : '%cshape OK', 'font-weight:bold;color:' + (problems.length ? 'crimson' : 'green'));
      problems.forEach((p) => console.log('  · ' + p));
    }
  }

  /* A page is what the editor renders. If the note endpoint answers with a
     placement instead of blocks, the editor has nothing to draw. */
  const notes = await get('/platform/space/notes/');
  const firstId = notes.body?.notes?.[0]?.id;
  if (firstId != null) {
    const page = await get('/platform/space/notes/' + firstId + '/');
    console.log('%c--- page contract ---', 'font-weight:bold');
    console.log('GET note ' + firstId + ' ->', page.status, page.body ? Object.keys(page.body).join(', ') : '');
    const has = page.body && ('blocks' in page.body);
    console.log(has ? '%cblocks present' : '%cMISMATCH: no blocks/title - the editor will open empty',
      'font-weight:bold;color:' + (has ? 'green' : 'crimson'));
  } else {
    console.log('no notes owned by this account, so the page contract cannot be checked here');
  }
})();
