/* Run with: node scripts/test-task-csv.mjs (no dependencies). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This repository serves .js files as native ES modules in the browser.
// Node treats these files as CommonJS without a package.json, so load the
// unchanged source through a data URL to exercise its real module exports.
const source = await readFile(new URL('../assets/ws/ws-task-csv.js', import.meta.url), 'utf8');
const { tasksToCsv, downloadTaskCsv } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const text = tasksToCsv([{
  id: 17,
  title: 'QA, "first"\nround',
  status: 'active',
  priority: 'p1',
  owner: { name: 'آرش', email: 'owner@example.com' },
  project_title: 'Lab',
  description: '=HYPERLINK("https://bad.example", "click")',
  definition_of_done: '@a1',
  blocked_reason: '+SUM(A1:A2)',
  checklist_completed_count: 1,
  checklist_count: 2,
  created_at: '2026-11-11T12:00:00Z',
}]);
assert.ok(text.startsWith('\uFEFF"Task ID","Title","Status"'));
assert.ok(text.includes('"QA, ""first""\nround"'), 'commas, quotes and multiline text must remain valid');
assert.ok(text.includes('"آرش"'), 'Unicode must be preserved');
assert.ok(text.includes('"\'=HYPERLINK('), 'formula-like text must be neutralized');
assert.ok(text.includes('"\'@a1"'));
assert.ok(text.includes('"\'+SUM(A1:A2)"'));
assert.ok(text.includes('"1","2"'), 'checklist columns should be exported');
assert.equal(tasksToCsv([]).split('\r\n').filter(Boolean).length, 1, 'empty export has headers only');
assert.equal(downloadTaskCsv([]), false, 'no download when the filter is empty');
console.log('Task CSV serialization tests passed.');
