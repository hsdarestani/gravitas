import {calendarRange} from './calendar.js';
import {dayAt,dayIndex} from './timing.js';

export const daysLabel = count => count+' '+(count===1?'day':'days');
const countDays=(start,end)=>Math.max(0,end-start+1);
const index=date=>date?dayIndex(date):NaN;
const valid=Number.isFinite;

export function taskDayLoad(task,period,anchor,finished='') {
  const date=index(anchor),start=index(task.startDate),due=index(task.dueDate),done=index(finished);
  const first=valid(start)?start:due,last=valid(due)?due:start;
  const scheduled=valid(first)&&valid(last)&&first<=last;
  const total=scheduled?countDays(first,last):0;
  const completed=task.status==='done';
  const lateness=valid(due)?Math.max(0,(completed?done:date)-due):0;
  const lateDays=valid(lateness)?lateness:0;
  const deadlineDelta=valid(due)?due-date:null;
  const [from,to]=period&&period!=='unscheduled'?calendarRange(anchor,period).map(index):[-Infinity,Infinity];
  const planDays=scheduled&&period!=='unscheduled'?countDays(Math.max(first,from),Math.min(last,to)):0;
  const overdueDays=!completed&&lateDays&&period!=='unscheduled'?countDays(Math.max(due+1,from),Math.min(date,to)):0;
  const included=!period||(period==='unscheduled'?!scheduled:planDays>0||overdueDays>0||(completed&&done>=from&&done<=to));
  return {included,scheduled,total,planDays,overdueDays,lateDays,deadlineDelta,completed,finished,
    range:scheduled?[dayAt(first),dayAt(last)]:[]};
}

export function addSampleSchedules(data) {
  if (data.sampleScheduleVersion===1) return false;
  const seedProjects=new Set(data.projects.filter(flow=>flow.sample&&flow.id.startsWith('example-')).map(flow=>flow.id));
  for (const task of data.tasks) {
    const sample=/^example-.+-task-([1-5])$/.exec(task.id);
    if (!sample||!seedProjects.has(task.project)||task.startDate||task.status==='idea'||!valid(index(task.dueDate))) continue;
    const durations=[3,5,2,4,2];
    task.startDate=dayAt(index(task.dueDate)-durations[Number(sample[1])-1]+1);
  }
  data.sampleScheduleVersion=1;
  return true;
}
