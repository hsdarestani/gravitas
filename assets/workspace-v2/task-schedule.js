import { dayAt, dayIndex } from './timing.js';

export function isScheduleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return false;
  const day=dayIndex(value);
  return Number.isFinite(day)&&dayAt(day)===value;
}

export const maxTaskDays=3650;
export const isDuration=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=maxTaskDays;

export function durationIssue(value,required=true) {
  if (!value&&!required) return '';
  if (!value) return 'Set how many days this task needs.';
  return isDuration(value)?'':'Enter a whole number from 1 to '+maxTaskDays+' days.';
}
