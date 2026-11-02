/* Pure geometry/ordering checks run without a frontend dependency or bundler.
   Browser QA separately verifies native sticky positioning and actual saves. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../assets/ws/ws-execution-gantt.js', import.meta.url), 'utf8');
const { calendarTime, hierarchyRows, virtualWindow, ROW } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(calendarTime('2026-09-03T22:30:00Z', 'Asia/Tehran'), Date.parse('2026-09-04T02:00:00Z'));
assert.equal(calendarTime('2026-09-03', 'Asia/Tehran'), Date.parse('2026-09-03T00:00:00Z'));
assert.equal(calendarTime('invalid'), null);
const tasks = [{ id: 1, title: 'Parent' }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 }, { id: 4 }];
assert.deepEqual(hierarchyRows(tasks).map(r => [r.task.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 0]]);
assert.deepEqual(hierarchyRows(tasks, new Set([1])).map(r => r.task.id), [1, 4]);
assert.deepEqual(hierarchyRows(tasks, new Set([2])).map(r => r.task.id), [1, 2, 4]);
assert.equal(hierarchyRows(tasks.filter(t => t.id !== 1))[0].depth, 0);
const large = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, parent_id: i % 10 ? i - i % 10 + 1 : null }));
const expanded = hierarchyRows(large);
assert.equal(expanded.length, 1000);
assert.equal(hierarchyRows(large, new Set(large.filter(t => !t.parent_id).map(t => t.id))).length, 100);
const window = virtualWindow(800 * ROW, 520, expanded.length);
assert.ok(window.first < 800 && window.end > 800);
assert.ok(window.end - window.first < 35, 'A thousand tasks must not require a thousand DOM rows');
assert.equal(virtualWindow(999 * ROW, 520, 1000).end, 1000);
console.log('Execution Gantt: workspace dates, nested expansion and 1,000-task virtualization passed.');
