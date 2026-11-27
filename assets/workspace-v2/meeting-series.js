import {dayAt, dayIndex} from './timing.js';
import {isScheduleDate} from './task-schedule.js';

const prefix='weekly:';

export const weeklyDay = date => new Intl.DateTimeFormat('en',{weekday:'long',timeZone:'UTC'})
  .format(new Date(date+'T00:00:00Z'));

export function seriesOccurrence(series,date) {
  if (!series || !isScheduleDate(date) || date<series.start || (series.endDate&&date>series.endDate) ||
      (dayIndex(date)-dayIndex(series.start))%7!==0) return null;
  if (series.firstId&&date===series.start) return null;
  return {
    id:prefix+series.id+':'+date, seriesId:series.id, date,
    title:series.title,time:series.time,end:series.end,owner:series.owner,
    agenda:series.agenda.map(text=>({text,done:false})),
    refs:[...series.refs], followups:[], note:''
  };
}

export function findMeeting(data,id) {
  const saved=data.meetings.find(item=>item.id===id);
  if (saved || !id?.startsWith(prefix)) return saved;
  const [,seriesId,date]=id.split(':');
  if (id!==prefix+seriesId+':'+date) return;
  return seriesOccurrence(data.meetingSeries.find(entry=>entry.id===seriesId),date);
}

export function meetingsInWindow(data,start,end) {
  const meetings=[...data.meetings];
  const savedIds=new Set(meetings.map(item=>item.id));
  for (const series of data.meetingSeries) {
    const weeks=Math.max(0,Math.ceil((dayIndex(start)-dayIndex(series.start))/7));
    const last=series.endDate&&series.endDate<end?series.endDate:end;
    for (let day=dayIndex(series.start)+weeks*7;day<=dayIndex(last);day+=7) {
      const session=seriesOccurrence(series,dayAt(day));
      if (session&&!savedIds.has(session.id)) meetings.push(session);
    }
  }
  return meetings;
}
