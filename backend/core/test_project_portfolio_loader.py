"""Execute the browser loader against deferred API responses."""
import base64
import subprocess
from pathlib import Path
from django.test import SimpleTestCase


class ProjectPortfolioLoaderTests(SimpleTestCase):
    def test_names_are_available_before_bounded_details_and_failure_is_isolated(self):
        module = Path(__file__).resolve().parents[2] / 'assets/ws/ws-project-data.js'
        url = 'data:text/javascript;base64,' + base64.b64encode(module.read_bytes()).decode()
        script = """
import assert from 'node:assert/strict';
const {loadProjectData} = await import(MODULE);
let active=0, peak=0, listed=false;
const pending=[];
const api={
  projects: async()=>({projects:Array.from({length:8},(_,id)=>({id}))}),
  projectCockpit: (id, options)=>{
    assert.equal(listed,true);
    assert.equal(options.snapshot,true);
    active++;peak=Math.max(peak,active);
    return new Promise((resolve,reject)=>pending.push(()=>{
      active--;
      if(id===2) reject(new Error('unavailable'));
      else resolve({counts:{tasks:id}});
    }));
  }
};
const promise=loadProjectData(api,rows=>{
  listed=true;assert.equal(rows.length,8);assert.equal(active,0);
});
await new Promise(setImmediate);
assert.equal(active,3);
while(pending.length){pending.shift()();await new Promise(setImmediate);}
const rows=await promise;
assert.equal(peak,3);assert.equal(rows.length,8);
assert.equal(rows[2].unavailable,true);assert.equal(rows[7].cockpit.counts.tasks,7);
""".replace('MODULE', repr(url))
        result = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
