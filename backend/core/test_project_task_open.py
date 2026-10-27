"""Research task cards must activate the selected task, without navigation."""
import subprocess
from pathlib import Path
from django.test import SimpleTestCase


class ProjectTaskOpenTests(SimpleTestCase):
    def test_task_cards_bind_the_selected_id_and_refresh_context(self):
        root = Path(__file__).resolve().parents[2]
        script = r"""
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('assets/ws/ws-project.js','utf8');
const body=source.slice(source.indexOf('function tasksView('),source.indexOf('\nfunction notesView('));
const cards=[];let opened;
const panel=()=>({box:{},body:{append:()=>{}}});
const render=new Function('section','empty','row','P','date','label','openProjectTask',body+';return tasksView;')(
  panel,()=>({}),x=>{cards.push(x);return x;},{meta:()=>''},x=>x,x=>x,(...args)=>{opened=args;});
const tasks=[{id:81,title:'First'},{id:92,title:'Second'}];
const cockpit={tasks,research_requests:[]};const context={go:()=>{},refresh:()=>{}};
render({append:()=>{}},cockpit,context);
assert.equal(typeof cards[1].onClick,'function');cards[1].onClick();
assert.equal(opened[0].id,92);assert.equal(opened[1],cockpit);assert.equal(opened[2],context);
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_historical_provenance_is_optional_and_cannot_hide_task_card(self):
        root = Path(__file__).resolve().parents[2]
        script = r"""
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('assets/ws/ws-views.js', 'utf8');
const start = source.indexOf('export function taskSourceRecords(');
const end = source.indexOf('\nexport function taskCardOptions(', start);
assert.ok(start > 0 && end > start, 'task source guard exists');
const helper = source.slice(start, end).replace('export function', 'function');
const records = new Function(helper + '\nreturn taskSourceRecords;')();
assert.deepEqual(records(null), []);
assert.deepEqual(records({}), []);
assert.deepEqual(records({records: null}), []);
assert.deepEqual(records({records: {title: 'Legacy object'}}), []);
assert.deepEqual(records({records: 'legacy payload'}), []);
assert.deepEqual(records({records: [{title: 'Valid'}, null, 'invalid', [], 42]}), [{title: 'Valid'}]);
assert.match(source, /const sourceRecords = taskSourceRecords\(task\.source_metadata\);/);
assert.match(source, /if \(detailForFallback && typeof detailForFallback === 'object'\)/);
assert.match(source, /The saved task is available below/);
assert.match(source, /const priorityChoices = taskCardOptions\(detailData\.priorities, state\.priorities, PRIORITY_COLUMNS\)/);
assert.match(source, /const statusChoices = taskCardOptions\(detailData\.statuses, state\.statuses, STATUS_COLUMNS\)/);
const optionStart = source.indexOf('export function taskCardOptions(');
const optionEnd = source.indexOf('export function failure(', optionStart);
assert.ok(optionStart > 0 && optionEnd > optionStart, 'guarded select metadata helper is present');
const optionCode = source.slice(optionStart, optionEnd).replace('export function', 'function');
const resolveOptions = new Function(optionCode + '\nreturn taskCardOptions;')();
const fallback = [['p0', 'P0 Critical'], ['p1', 'P1 High']];
assert.deepEqual(resolveOptions(undefined, undefined, fallback), [
  {value:'p0',label:'P0 Critical'}, {value:'p1',label:'P1 High'}
]);
assert.deepEqual(resolveOptions([], null, fallback), [
  {value:'p0',label:'P0 Critical'}, {value:'p1',label:'P1 High'}
]);
assert.deepEqual(resolveOptions(null, [{value:'p2',label:'Board'}], fallback), [{value:'p2',label:'Board'}]);
assert.deepEqual(resolveOptions([{value:'p3',label:'Detail'}], [], fallback), [{value:'p3',label:'Detail'}]);
assert.doesNotMatch(source, /The server did not answer\. Nothing has been changed\./);
const project = fs.readFileSync('assets/ws/ws-project-actions.js', 'utf8');
const boot = fs.readFileSync('assets/ws/ws-app.js', 'utf8');
const page = fs.readFileSync('workspace.html', 'utf8');
assert.match(project, /ws-views\.js\?v=20261016-task1&patch=[a-z0-9]+/);
assert.match(project, /const canEdit = task\.can_edit === true/);
assert.match(project, /if \(P\.canOpenCore\(\)\)/);
assert.match(project, /ws-project-task-editor/);
assert.doesNotMatch(project, /function editTask\(cockpit/);
assert.doesNotMatch(project, /add\('Edit task', \(\) => editTask\(cockpit\)\)/);
assert.match(boot, /ws-views\.js\?v=20261016-task1&patch=[a-z0-9]+/);
assert.match(page, /ws-app\.js\?v=20261016-task1&patch=[a-z0-9]+/);
const five = fs.readFileSync('assets/ws/ws-five-layer.js', 'utf8');
const projectView = fs.readFileSync('assets/ws/ws-project.js', 'utf8');
assert.match(boot, /ws-five-layer\.js\?v=20261016-task1&patch=[a-z0-9]+/);
assert.match(five, /ws-project\.js\?v=20261016-task1&patch=[a-z0-9]+/);
assert.match(projectView, /ws-project-actions\.js\?v=20261016-task1&patch=[a-z0-9]+/);
"""
        result = subprocess.run(
            ['node', '--input-type=module', '-e', script],
            cwd=root, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_escape_closes_task_dialog_and_comments_update_without_full_refresh(self):
        root = Path(__file__).resolve().parents[2]
        script = r"""
import fs from 'node:fs';
import assert from 'node:assert/strict';
const views = fs.readFileSync('assets/ws/ws-views.js', 'utf8');
assert.match(views, /dialog\._onEscape = \(event\) =>/);
assert.match(views, /event\.key !== 'Escape'/);
assert.match(views, /document\.addEventListener\('keydown', dialog\._onEscape, true\)/);
assert.match(views, /document\.removeEventListener\('keydown', dialog\._onEscape, true\)/);
assert.match(views, /const detailData = await P\.operatingTaskCard\(taskId\)/);
assert.match(views, /Promise\.resolve\(\)\.then\(stateLoader\)/);
assert.doesNotMatch(views, /const \[detailData, boardState\] = await Promise\.all/);
const comments = views.slice(
  views.indexOf("commentForm.addEventListener('submit'"),
  views.indexOf("const loadAttachments = async")
);
assert.match(comments, /const result = await P\.addOperatingTaskComment/);
assert.match(comments, /commentsPanel\.body\.insertBefore\(item, commentForm\)/);
assert.doesNotMatch(comments, /await reloadBoard\(/);
const assistant = fs.readFileSync('assets/ws/ws-ai.js', 'utf8');
assert.match(assistant, /reply\.intent === 'navigation' \? \[\]/);
const app = fs.readFileSync('assets/ws/ws-app.js', 'utf8');
assert.ok(app.includes('ws-ai.js?v=20261016-task1&patch=20261019ri4'));
const dashboard = fs.readFileSync('assets/ws/ws-home.js', 'utf8');
assert.ok(dashboard.includes('research-intelligence-title'));
assert.ok(dashboard.includes('sectionHeading.scrollIntoView'));
assert.ok(assistant.includes('Research Intelligence / AutoResearch is in Research → Projects'));
assert.ok(assistant.includes('/workspace/research/projects/223/autoresearch#research-intelligence-title'));
assert.ok(assistant.includes('research-intelligence-title'));
assert.ok(assistant.includes("intent: 'navigation'"));
assert.ok(app.includes('ws-home.js?v=20261016-task1&patch=20261019researchtools2'));
"""
        result = subprocess.run(
            ['node', '--input-type=module', '-e', script],
            cwd=root, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
