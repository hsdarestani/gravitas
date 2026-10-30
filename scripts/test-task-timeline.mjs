import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../assets/ws/ws-task-timeline.js', import.meta.url), 'utf8');
const { timelineModel, dateMillis } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const now = Date.parse('2026-10-30T12:00:00Z');
const tasks = [
  { id: 1, status: 'done', created_at: '2026-10-01T08:00:00Z', started_at: '2026-10-02T09:00:00Z', completed_at: '2026-10-05T16:00:00Z', due_date: '2026-10-20' },
  { id: 2, status: 'active', created_at: '2026-10-10T10:00:00Z', started_at: '2026-10-12T10:00:00Z' },
  { id: 3, status: 'done', created_at: '2026-10-04T08:00:00Z', due_date: '2026-10-15' },
  { id: 4, status: 'draft' },
];
const plan = new Map([[1, { start_date: '2026-09-25', end_date: '2026-10-03' }]]);
const model = timelineModel(tasks, plan, now);
assert.equal(model.rows.length, 4);
const byId = new Map(model.rows.map(row => [row.task.id, row]));
assert.equal(byId.get(1).end, Date.parse(tasks[0].completed_at));
assert.notEqual(byId.get(1).end, byId.get(1).due);
assert.equal(byId.get(2).activeEnd, now);
assert.equal(byId.get(3).activeEnd, null);
assert.equal(byId.get(3).end, null);
assert.equal(byId.get(4).created, null);
assert.equal(dateMillis('invalid'), null);
assert.equal(dateMillis('2026-10-20'), Date.parse('2026-10-20T00:00:00Z'));
assert.ok(model.origin < Date.parse('2026-09-25'));
assert.ok(model.position(now) > 0 && model.position(now) < 100);
console.log('Task timeline: actual dates, missing dates, plans and deadlines verified.');
