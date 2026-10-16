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
