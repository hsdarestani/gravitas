import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowSchedule, workspaceSchedules } from '../assets/workspace-v2/workflow-schedule.js';

const flow = (id, extra = {}) => ({id, state:'active', scheduleStart:'2026-12-01', edges:[], ...extra});
const task = (id, project, durationDays) => ({id, project, durationDays, status:'backlog'});

test('a grandchild forecast holds the child and parent until the next day', () => {
  const projects = [
    flow('parent', {projectNodes:[{id:'child-gate', targetProjectId:'child'}], edges:[['child-gate','publish']]}),
    flow('child', {projectNodes:[{id:'grandchild-gate', targetProjectId:'grandchild'}], edges:[['grandchild-gate','review']]}),
    flow('grandchild', {scheduleStart:'2026-12-04'}),
  ];
  const tasks = [task('write','grandchild',2), task('review','child',2), task('publish','parent',1)];
  const schedules = workspaceSchedules({projects,tasks});
  assert.equal(schedules.get('child').finish,'2026-12-07');
  assert.equal(schedules.get('parent').dates.get('publish').startDate,'2026-12-08');
  const rescheduled=workspaceSchedules({projects,tasks},{projectId:'grandchild',startDate:'2026-12-07'});
  assert.equal(rescheduled.get('parent').finish,'2026-12-11');
});

test('a selected milestone gates by its deadline and a failed target blocks the forecast', () => {
  const parent=flow('parent',{projectNodes:[{id:'gate',targetProjectId:'child',milestoneId:'draft'}],edges:[['gate','publish']]});
  const child=flow('child',{milestones:[{id:'draft',deadline:'2026-12-03',completed:false}]});
  const tasks=[task('publish','parent',1)];
  const schedule=state=>workspaceSchedules({projects:[parent,{...child,...state}],tasks}).get('parent');
  assert.equal(schedule({}).dates.get('publish').dueDate,'2026-12-04');
  assert.equal(schedule({milestones:[{...child.milestones[0],completed:true}]}).finish,'2026-12-01');
  const blocked=schedule({state:'failed'});
  assert.equal(blocked.unresolvedGates,1);
  assert.equal(blocked.finish,'');
  assert.equal(blocked.dates.has('publish'),false);
});

test('an outer review loop reserves the nested loop again for each pass', () => {
  const project=flow('parent',{
    edges:[['write','edit'],['edit','final']],
    loops:[{from:'edit',to:'edit',target:1},{from:'final',to:'write',target:1}],
  });
  const schedule=workflowSchedule(project,[task('write','parent',1),task('edit','parent',2),task('final','parent',1)]);
  assert.equal(schedule.days,12);
  assert.equal(schedule.reviewDays,8);
  assert.equal(schedule.finish,'2026-12-12');
});
