import {linkedHalfWidth} from './linked-projects.js';

const dayMs = 864e5;
export const timeZone = 'Asia/Tehran';
const dateParts = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'});
const dateLabel = new Intl.DateTimeFormat('en', {timeZone:'UTC',month:'short',day:'numeric'});
const fullDateLabel = new Intl.DateTimeFormat('en', {timeZone:'UTC',year:'numeric',month:'short',day:'numeric'});

export function today(at) {
  const parts = Object.fromEntries(dateParts.formatToParts(at ? new Date(at) : new Date()).map(({type,value})=>[type,value]));
  return [parts.year,parts.month,parts.day].join('-');
}
export const dayIndex = date => Date.parse(date+'T00:00:00Z')/dayMs;
export const dayAt = index => new Date(index*dayMs).toISOString().slice(0,10);
export const asDate = (date,full=false) => (full?fullDateLabel:dateLabel).format(new Date(dayIndex(date)*dayMs));

export function timing(task, now=today()) {
  const days = task.dueDate ? dayIndex(task.dueDate)-dayIndex(now) : null;
  const importance = task.importance ?? 5;
  const completed = task.status === 'done';
  const tone = completed ? 'complete' : days === null ? 'quiet' : days < 0 ? 'late' : days <= 2 ? 'near' : 'quiet';
  const due = days === null ? 'No planned finish' : days === 0 && !completed ? 'Planned finish today' :
    days < 0 && !completed ? `${Math.abs(days)}d overdue` : `Finishes ${asDate(task.dueDate)}`;
  const urgency = days === null ? 0 : days < 0 ? 13 : days === 0 ? 11 : days <= 2 ? 7 : days <= 7 ? 3 : 0;
  return {days, importance, due, tone, score: importance+urgency};
}

const seedPlan = {
  idea:[-9,-8,5],scenario:[-8,-6,7],shots:[-6,-4,8], sound:[-3,0,7],
  voice:[-3,1,6],edit:[-3,0,9],assets:[-4,-2,6], qa:[1,3,10],
  export:[4,5,8],learning:[5,8,6],publish:[6,8,9],topic:[6,8,7]
};

export function upgradeData(data) {
  if (data.timingVersion === 2) return data;
  for (const flow of data.projects) {
    if (!Object.hasOwn(flow,'owner')) flow.owner = data.areas.find(area=>area.id===flow.area)?.lead || '';
  }
  const now = dayIndex(today());
  for (const task of data.tasks) {
    const plan = task.project === 'video1' ? seedPlan[task.id] : null;
    task.startDate = plan ? dayAt(now+plan[0]) : '';
    task.dueDate = plan ? dayAt(now+plan[1]) : '';
    task.importance = plan?.[2] || 5;
  }
  data.timingVersion = 2;
  return data;
}

export function planLayout(items, now=today()) {
  const dates = items.map(item=>item.dueDate || item.startDate || '');
  if (!dates.some(Boolean)) return null;
  const todayIndex = dayIndex(now);
  const points = dates.filter(Boolean).map(dayIndex);
  const min = Math.min(todayIndex,...points);
  const max = Math.max(todayIndex,...points);
  const innerWidth = Math.max(735,Math.min(960,(max-min)*58));
  const span = Math.max(5,max-min);
  const pixel = innerWidth/span;
  const xAt = index => Math.round(77+(index-min)*pixel);
  const shapeHalfWidth = item => item.targetProjectId ? linkedHalfWidth : 39;
  const unplannedColumnWidth = items.some(item=>item.targetProjectId) ? linkedHalfWidth*2+24 : 108;
  const unplanned = [];
  const dated = [];
  items.forEach((item,i)=>{
    const value = dates[i];
    if (!value) {
      const order = unplanned.length;
      unplanned.push({...item,x:xAt(min+span)+160+Math.floor(order/4)*unplannedColumnWidth,y:120+order%4*108});
      return;
    }
    const x = xAt(dayIndex(value));
    let y = item.y+35;
    while (dated.some(prior=>Math.abs(prior.x-x)<shapeHalfWidth(prior)+shapeHalfWidth(item)+11 && Math.abs(prior.y-y)<82)) y += 93;
    dated.push({...item,x,y});
  });
  const interval = [1,2,3,5,7,14,21,30,60,90,180,365].find(step=>step>=span/7) ?? Math.ceil(span/7);
  const ticks = [];
  for (let index=min;index<=min+span;index+=interval) {
    if (Math.abs(xAt(index)-xAt(todayIndex))>65) ticks.push({x:xAt(index), date:dayAt(index)});
  }
  return {items:[...dated,...unplanned], xToday:xAt(todayIndex), date:now, ticks, unplannedAt:unplanned.length?xAt(min+span)+104:null};
}
