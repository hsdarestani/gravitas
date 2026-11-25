import {dayIndex, today} from './timing.js';

export const reviewIntervals=[7,14,30];
export const activityTypes={
  planning:'Planning', report:'Reports', meeting:'Meetings', management:'Workspace',
  task:'Tasks', idea:'Ideas', calendar:'Calendar', other:'Other'
};

export function activityType(event) {
  if (Object.hasOwn(activityTypes,event.kind)) return event.kind;
  if (event.meeting) return 'meeting';
  if (event.idea) return 'idea';
  if (event.task||event.relatedTasks?.length) return 'task';
  if (/milestone|project update|project decision|\bKPI\b|\bOKR\b/i.test(event.text)) return 'planning';
  if (/closing report|project report/i.test(event.text)) return 'report';
  if (/teammate|work area|project owner/i.test(event.text)) return 'management';
  return 'other';
}

export function latestStamp(stamps) {
  return stamps.reduce((latest,stamp)=>Date.parse(stamp)>(latest?Date.parse(latest):-Infinity)?stamp:latest,'');
}

export function daysSince(stamp,now) {
  return Number.isFinite(Date.parse(stamp))?dayIndex(now)-dayIndex(today(stamp)):null;
}

export function activityMatches(event,{project,actor,type,window,query},now,labels) {
  const from=window?Number(window)-1:null;
  const age=daysSince(event.at,now);
  return (!project||event.project===project)&&(!actor||event.actor===actor)&&(!type||activityType(event)===type)&&
    (from===null||age!==null&&age>=0&&age<=from)&&
    (!query||[event.text,...labels].some(value=>String(value||'').toLocaleLowerCase().includes(query)));
}

export function activityCsv(rows) {
  const cell=value=>{
    const text=String(value??'');
    const safe=/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text)?"'"+text:text;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  return [['Timestamp (UTC)','Actor','Category','Project or meeting','Action'],...rows]
    .map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
