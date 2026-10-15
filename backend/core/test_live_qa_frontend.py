"""Execute the browser modules' public route and assistant behavior in Node."""
import shutil
import subprocess
from pathlib import Path
from unittest import skipUnless
from django.test import SimpleTestCase


@skipUnless(shutil.which('node'), 'Node is required for browser-module regression checks')
class LiveQaFrontendTests(SimpleTestCase):
    def test_project_routes_and_assistant_scope(self):
        root = Path(__file__).resolve().parents[2]
        script = r'''
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function load(file, globals = {}) {
  // Strip import declarations only; execute the actual implementation.
  const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?;\s*$/gm, '').replace(/^export /gm, '');
  return vm.createContext({...globals, source});
}
let routes = load('assets/ws/ws-five-layer.js');
vm.runInContext(routes.source, routes);
for (const tab of ['management', 'tasks', 'notes', 'files', 'structure']) {
  const result = vm.runInContext(`fiveLayerRoute('/workspace/research/projects/202/${tab}')`, routes);
  assert.equal(result.kind, 'research-project');
  assert.equal(result.tab, tab);
  assert.equal(result.id, '202');
}
let searches = 0;
let configured;
let sent;
let ai = load('assets/ws/ws-ai.js', {
  window: {GravitasChat: {configure: config => configured = config}},
  P: {call: async (path, request) => { sent = request.body; throw new Error('Unavailable'); }},
  notes: {load: async () => searches++, search: () => {searches++; return [];}},
});
vm.runInContext(ai.source, ai);
const project = vm.runInContext("assistantContext('/workspace/research/projects/202/management', 'research')", ai);
assert.equal(project.project_id, '202');
assert.equal(project.thread_id, 'project-202');
assert.equal(project.surface, 'projects');
const core = vm.runInContext("assistantContext('/workspace/core/week', 'core')", ai);
assert.equal(core.project_id, undefined);
assert.equal(core.surface, 'core');
ai.projectContext = project;
vm.runInContext('installAssistant({pulsarContext: () => projectContext})', ai);
(async () => {
  const result = await configured.ask('Summarize this project');
  assert.equal(sent.project_id, '202');
  assert.equal(sent.thread_id, 'project-202');
  assert.equal(result.links.length, 0);
  assert.equal(searches, 0, 'project errors must not cite unrelated workspace notes');
  assert.match(result.reply, /No project summary has been verified/);
})().catch(error => {console.error(error); process.exitCode = 1;});
'''
        result = subprocess.run(['node', '-e', script], cwd=root, text=True,
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
