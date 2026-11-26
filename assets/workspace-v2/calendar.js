import {asDate,dayAt,dayIndex,today} from './timing.js';

const months=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'});
const shortMonths=new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'});
const weekdays=['Sat','Sun','Mon','Tue','Wed','Thu','Fri'];
const modes=[['week','Week'],['month','Month'],['quarter','3 months'],['year','Year']];
export const periodChoices=[['','Any time'],['week','This week'],['month','This month'],['quarter','3-month window'],['year','This year'],['unscheduled','Unscheduled']];
const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(dayIndex(value))&&dayAt(dayIndex(value))===value;
const add = (date,days) => dayAt(dayIndex(date)+days);
const dateObject = date => new Date(date+'T12:00:00Z');
const monthBoundary = (date,shift=0) => new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1+shift,1)).toISOString().slice(0,10);
const weekStart=date=>add(date,-((dateObject(date).getUTCDay()+1)%7));
const rangeLabel=(a,b)=>asDate(a)+' – '+asDate(b,true);
export function calendarRange(focus,mode) {
  if (mode==='week') {
    const start=weekStart(focus);
    return [start,add(start,6)];
  }
  if (mode==='year') return [focus.slice(0,4)+'-01-01',focus.slice(0,4)+'-12-31'];
  return [monthBoundary(focus),add(monthBoundary(focus,mode==='quarter'?3:1),-1)];
}
export function inPeriod(item,period,anchor=today()) {
  if (!period) return true;
  const dates=[item.startDate,item.dueDate].filter(valid).sort();
  if (period==='unscheduled') return !dates.length;
  if (!dates.length) return false;
  const [start,end]=calendarRange(anchor,period);
  return dates[0]<=end&&dates.at(-1)>=start;
}
export function calendarState() {
  return {date:today(),mode:'month',area:'',owner:'',kind:'',includeDone:true,dayView:'all'};
}
const typeMeta={task:['checklist','Tasks'],meeting:['people','Meetings'],milestone:['target','Milestones'],note:['message','Day notes']};
const filterSet=[['','Everything'],...Object.entries(typeMeta).map(([key,[,title]])=>[key,title])];
const kinds=Object.keys(typeMeta);

function dateList(start,end) {
  return Array.from({length:dayIndex(end)-dayIndex(start)+1},(_,i)=>add(start,i));
}
export function entrySpan(entry) {
  if (!valid(entry.date)) return null;
  const from=entry.kind==='task'&&valid(entry.startDate)&&entry.startDate<=entry.date?entry.startDate:entry.date;
  return [from,entry.date];
}
export function calendarItemTiming(entry,date) {
  const task=entry.kind==='task';
  const due=(task&&!entry.deadline)||!['task','milestone'].includes(entry.kind)?'':entry.date;
  if (entry.done) return {label:task?'Completed':'Reached',tone:'complete'};
  if (valid(due)&&valid(date)) {
    const days=dayIndex(due)-dayIndex(date),count=Math.abs(days),unit=count===1?'day':'days';
    return days<0?{label:`${count} ${unit} overdue`,tone:'late'}:
      days===0?{label:'Due this day',tone:'near'}:
        {label:`${days} ${unit} left`,tone:days<=2?'near':''};
  }
  if (task) return {label:valid(entry.startDate)?'No planned finish':'Unscheduled',tone:''};
  const title=entry.kind==='note'?'Day note':typeMeta[entry.kind][1].replace(/s$/,'');
  return {label:[entry.time,entry.end?'– '+entry.end:''].filter(Boolean).join(' ')||title,tone:''};
}
export function calendarOverdue(entries,date,now=today()) {
  if (date>now) return [];
  return entries.filter(entry=>entry.kind==='task'&&entry.deadline&&!entry.done&&valid(entry.date)&&entry.date<date)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
}
function taskDates(entry,date) {
  const start=valid(entry.startDate)?entry.startDate:'';
  const end=entry.deadline&&valid(entry.date)?entry.date:'';
  if (!start&&!end) return '';
  if (start===end) return 'Starts and finishes '+asDate(start);
  if (!end) return 'Starts '+asDate(start);
  if (!start) return 'Finishes '+asDate(end);
  const range=asDate(start)+' – '+asDate(end);
  if (date===start) return 'Starts · '+range;
  if (date>start&&date<end) return 'Scheduled · '+range;
  return range;
}
function eventsByDay(entries,start,end) {
  const result=new Map();
  for (const entry of entries) {
    const span=entrySpan(entry);
    if (!span||span[0]>end||span[1]<start) continue;
    const from=span[0]>start?span[0]:start,to=span[1]<end?span[1]:end;
    for (const day of dateList(from,to)) {
      if (!result.has(day)) result.set(day,[]);
      result.get(day).push(entry);
    }
  }
  for (const [date,list] of result) list.sort((a,b)=>Number(isMidSpan(a,date))-Number(isMidSpan(b,date)));
  return result;
}
const isMidSpan=(entry,date)=>entry.kind==='task'&&entry.startDate<date&&date<entry.date&&valid(entry.startDate);

export function calendarUI({esc,symbol,option,button,iconButton,userName,formDialog,saveNote,removeNote,getNote,source,getScope,render,dialog,formError,isDateEditor,canPin}) {
  const filters=(state,scope,areas,team)=>`<div class="calendar-filters">
    ${scope==='team'?`<label><span class="sr-only">Work area</span><select data-calendar-filter="area">${option('','All work areas',state.area)}${areas.map(item=>option(item.id,item.title,state.area)).join('')}</select></label>
      <label><span class="sr-only">Owner</span><select data-calendar-filter="owner">${option('','All owners',state.owner)}${team.map(item=>option(item.id,item.name,state.owner)).join('')}</select></label>`:''}
    <label><span class="sr-only">Show on calendar</span><select data-calendar-filter="kind">${filterSet.map(([value,label])=>option(value,label,state.kind)).join('')}</select></label>
    <label class="calendar-done"><input type="checkbox" data-calendar-filter="includeDone" ${state.includeDone?'checked':''}> Show completed</label></div>`;
  const typeIcon=entry=>symbol(entry.pinned?'pin':typeMeta[entry.kind][0]);
  function entryRow(entry,date) {
    if (entry.pinned) return `<article class="calendar-pinned-note">
      <span class="calendar-pinned-label">${symbol('pin')} ${entry.action==='open-pinned-meeting'?'Pinned meeting note':'Pinned day note'}</span>
      <button type="button" data-action="${esc(entry.action)}" data-value="${esc(entry.id)}"><strong>${esc(entry.title)}</strong>
        <small>${esc(entry.context)}</small>${symbol('chevron')}</button>
      <p dir="auto">${esc(entry.text)}</p>
    </article>`;
    const {label,tone}=calendarItemTiming(entry,date);
    const dates=entry.kind==='task'?[entry.durationDays?entry.durationDays+'d':'',taskDates(entry,date)].filter(Boolean).join(' · '):'';
    return `<button type="button" class="calendar-entry ${entry.kind} ${tone}" data-action="${entry.action}" data-value="${esc(entry.id)}">
      <span class="calendar-entry-icon">${typeIcon(entry)}</span>
      <span class="calendar-entry-copy"><strong>${esc(entry.title)}${entry.repeat?` <span class="calendar-repeat" title="Weekly meeting">${symbol('loop')}<span class="sr-only"> Weekly</span></span>`:''}</strong>${entry.context?`<small>${esc(entry.context)}</small>`:''}</span>
      <span class="calendar-entry-timing"><span class="calendar-entry-tag">${esc(label)}</span>${dates?'<small>'+esc(dates)+'</small>':''}</span>${symbol('chevron','calendar-entry-open')}</button>`;
  }
  function focus(action,value) {
    [...document.querySelectorAll('[data-action="'+action+'"]')].find(control=>control.dataset.value===value)?.focus({preventScroll:true});
  }
  function visibleEntries(entries,state) {
    return entries.filter(entry=>(!state.kind||entry.kind===state.kind)&&(!state.area||entry.area===state.area||entry.areas?.includes(state.area))&&
      (!state.owner||entry.owners.includes(state.owner))&&(state.includeDone||!entry.done));
  }
  function fullGrid(state,byDay,now) {
    const month=state.mode==='month';
    const [from,to]=calendarRange(state.date,state.mode);
    const start=weekStart(from),end=add(weekStart(to),6);
    return `<div class="calendar-weekdays" aria-hidden="true">${weekdays.map(day=>`<span>${day}</span>`).join('')}</div>
      <div class="calendar-grid ${month?'month':'week'}" aria-label="${month?'Month':'Week'} days">
      ${dateList(start,end).map(day=>{
        const isSelected=day===state.date, isToday=day===now, entries=byDay.get(day)||[];
        const pills=entries.slice().sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))).slice(0,month?2:5);
        return `<button type="button" class="calendar-cell ${day<from||day>to?'outside':''}" data-action="calendar-date" data-value="${day}"
          aria-label="${asDate(day,true)}, ${entries.length} ${entries.length===1?'item':'items'}" aria-pressed="${isSelected}" ${isToday?'aria-current="date"':''}>
          <span class="cal-day-number">${Number(day.slice(8))}</span>
          <span class="cal-day-pills" aria-hidden="true">${pills.map(entry=>`<span class="cal-pill ${entry.kind} ${calendarItemTiming(entry,day).tone} ${isMidSpan(entry,day)?'continuing':''}">${typeIcon(entry)}<span>${esc(entry.title)}</span></span>`).join('')}
          ${entries.length>pills.length?`<span class="cal-overflow">+${entries.length-pills.length}</span>`:''}</span></button>`;
      }).join('')}</div>`;
  }
  function miniatureGrid(state,byDay,now) {
    const [start]=calendarRange(state.date,state.mode);
    return `<div class="calendar-overview ${state.mode}" aria-label="Months in this period">
      ${Array.from({length:state.mode==='year'?12:3},(_,i)=>{
        const month=monthBoundary(start,i), monthEnd=add(monthBoundary(month,1),-1);
        const first=weekStart(month),days=dateList(first,add(first,41));
        const number=new Set(dateList(month,monthEnd).flatMap(day=>byDay.get(day)||[])).size;
        const selected=state.date.slice(0,7)===month.slice(0,7);
        return `<button class="cal-month-card" type="button" data-action="calendar-month" data-value="${month}" aria-label="Open ${months.format(dateObject(month))} ${month.slice(0,4)}, ${number} dated entries">
          <span class="cal-month-head"><strong>${months.format(dateObject(month))}</strong><small>${number||'—'}</small></span>
          <span class="cal-mini-grid" aria-hidden="true">${days.map(day=>{
            if (day<month||day>monthEnd) return '<span></span>';
            const entries=byDay.get(day)||[];
            return `<span class="${entries.length?'has-work '+entries[0].kind:''} ${day===now?'current':''} ${selected&&day===state.date?'focus-day':''}">${Number(day.slice(8))}</span>`;
          }).join('')}</span></button>`;
      }).join('')}</div>`;
  }
  function page(state,scope) {
    const [start,end]=calendarRange(state.date,state.mode);
    const {entries,areas,team}=source(scope,weekStart(start),add(weekStart(end),6));
    const all=visibleEntries(entries,state);
    const now=today();
    const byDay=eventsByDay(all,weekStart(start),add(weekStart(end),6));
    const count=all.filter(entry=>{
      const span=entrySpan(entry);
      return span&&span[0]<=end&&span[1]>=start;
    }).length;
    const scheduled=(byDay.get(state.date)||[]).slice().sort((a,b)=>
      Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||Number(b.kind==='note')-Number(a.kind==='note')||
      Number(isMidSpan(a,state.date))-Number(isMidSpan(b,state.date))||
      (a.time||'').localeCompare(b.time||'')||a.title.localeCompare(b.title));
    const overdue=calendarOverdue(all,state.date,now);
    const todays=[...scheduled,...overdue];
    const inDayView=entry=>state.dayView==='all'||entry.kind===state.dayView;
    const shown=scheduled.filter(inDayView);
    const shownOverdue=overdue.filter(inDayView);
    const undated=state.date===now?all.filter(entry=>entry.needsSchedule):[];
    const monthName=months.format(dateObject(state.date));
    const heading=state.mode==='week'?rangeLabel(start,end):state.mode==='year'?state.date.slice(0,4):
      state.mode==='quarter'?`${shortMonths.format(dateObject(start))} – ${shortMonths.format(dateObject(end))} ${end.slice(0,4)}`:`${monthName} ${state.date.slice(0,4)}`;
    const dateControl=`<input type="date" aria-label="Jump to date" data-calendar-date value="${state.date}">`;
    return `<section class="calendar-shell" aria-label="${scope==='mine'?'My work':'Workspace'} calendar">
      <div class="calendar-toolbar panel">
        <div class="calendar-period">${iconButton('calendar-step','Previous period','left','-1')}
          <div><h2>${heading}</h2><small>${count} scheduled · Tehran</small></div>
          ${iconButton('calendar-step','Next period','chevron','1')}${button('calendar-today','Today','','ghost')}</div>
        <div class="calendar-views" role="group" aria-label="Calendar zoom">${modes.map(([id,label])=>`<button type="button" data-action="calendar-mode" data-value="${id}" aria-pressed="${state.mode===id}">${label}</button>`).join('')}</div>
        <div class="calendar-controls">${filters(state,scope,areas,team)}${dateControl}</div>
      </div>
      <div class="calendar-layout">
        <div class="panel calendar-main">${state.mode==='week'||state.mode==='month'?fullGrid(state,byDay,now):miniatureGrid(state,byDay,now)}
          <div class="calendar-key">${kinds.map(kind=>`<span class="${kind}">${symbol(typeMeta[kind][0])}${typeMeta[kind][1]}</span>`).join('')}</div></div>
        <section class="panel calendar-agenda" aria-labelledby="selected-calendar-day">
          <header class="calendar-agenda-head"><span class="tile-icon">${symbol('timeline')}</span>
            <div><h3 id="selected-calendar-day">${asDate(state.date,true)}</h3><small>${todays.length} ${todays.length===1?'item':'items'}</small></div>
            ${isDateEditor(scope)?iconButton('calendar-note','Add day note','plus',state.date):''}</header>
          ${new Set(todays.map(entry=>entry.kind)).size>1?`<div class="calendar-day-filter" role="group" aria-label="Day agenda filter">
            ${[['all','All'],...kinds.filter(kind=>todays.some(entry=>entry.kind===kind)).map(kind=>[kind,typeMeta[kind][1]])].map(([value,label])=>`<button class="btn ghost" type="button" aria-pressed="${state.dayView===value}" data-action="calendar-agenda-filter" data-value="${value}">${label}</button>`).join('')}</div>`:''}
          <div class="calendar-agenda-list">${shown.map(entry=>entryRow(entry,state.date)).join('')}
            ${shownOverdue.length?`<h4 class="calendar-overdue-label">${symbol('alert')} Overdue <span>${shownOverdue.length}</span></h4>
              ${shownOverdue.map(entry=>entryRow(entry,state.date)).join('')}`:''}
            ${!shown.length&&!shownOverdue.length?'<p class="detail-empty">Nothing scheduled for this day.</p>':''}</div>
          ${undated.length?`<details class="calendar-unscheduled"><summary>${symbol('inbox')} Needs scheduling <strong>${undated.length}</strong></summary><div>${undated.map(entry=>entryRow(entry,'')).join('')}</div></details>`:''}
        </section>
      </div></section>`;
  }
  function noteEditor(value) {
    const {scope}=getScope();
    const entry=getNote(value);
    if (!isDateEditor(scope)) return;
    const date=entry?.date||value;
    if (!valid(date)) return;
    if (entry&&!entry.editable) {
      formDialog('Day note','calendar-read-note',`<p class="dim">${asDate(date,true)} · ${esc(userName(entry.actor))}</p><p class="calendar-read-note" dir="auto">${esc(entry.text)}</p>`,'Close');
      return;
    }
    formDialog(entry?'Edit day note':'New day note','calendar-note-form',`<input type="hidden" name="id" value="${esc(entry?.id)}">
      <input type="hidden" name="date" value="${date}">
      <p class="calendar-note-date">${symbol('timeline')}${asDate(date,true)}</p>
      <label class="field">Note<textarea name="text" dir="auto" rows="4" maxlength="2400" required placeholder="Add context for this day">${esc(entry?.text)}</textarea></label>
      <label class="field">Visibility<select name="visibility">${option('personal','Only me',entry?.visibility||(scope==='mine'?'personal':'team'))}
        ${option('team','Team calendar',entry?.visibility||(scope==='team'?'team':''))}</select></label>
      ${canPin()?'<label class="calendar-done"><input type="checkbox" name="pinned" '+(entry?.pinned?'checked':'')+'> Pin to the team calendar</label>':''}
      ${entry?button('calendar-remove-note','Remove note','trash','ghost',entry.id):''}`,'Save note');
  }
  function submit(form,fields) {
    if (form.id==='calendar-read-note') return dialog.close();
    const date=fields.get('date'),text=fields.get('text').trim(),id=fields.get('id'),visibility=fields.get('visibility');
    if (!text||!valid(date)) return formError(form,'Write a note for this day.');
    saveNote(form,{id,date,text,visibility,pinned:fields.has('pinned')&&visibility==='team'});
  }
  return {
    page,submit,change(field) {
      const state=getScope()?.state;
      if (!state) return;
      if (field.dataset.calendarFilter) state[field.dataset.calendarFilter]=field.type==='checkbox'?field.checked:field.value;
      else if (valid(field.value)) state.date=field.value;
      state.dayView='all';render();
      const selector=field.dataset.calendarFilter?`[data-calendar-filter="${field.dataset.calendarFilter}"]`:'[data-calendar-date]';
      document.querySelector(selector)?.focus({preventScroll:true});
    },handlers:{
      'calendar-mode':mode=>{const {state}=getScope();state.mode=mode;state.dayView='all';render();focus('calendar-mode',mode);},
      'calendar-date':date=>{
        const {state}=getScope();if (!valid(date)) return;state.date=date;state.dayView='all';render();focus('calendar-date',date);
        if (matchMedia('(max-width: 760px)').matches) document.querySelector('#selected-calendar-day')?.scrollIntoView({block:'nearest'});
      },
      'calendar-agenda-filter':value=>{const {state}=getScope();state.dayView=value;render();focus('calendar-agenda-filter',value);},
      'calendar-month':date=>{const {state}=getScope();state.date=date;state.mode='month';state.dayView='all';render();focus('calendar-date',date);},
      'calendar-today':()=>{const {state}=getScope();state.date=today();state.dayView='all';render();focus('calendar-today','');},
      'calendar-step':value=>{
        const {state}=getScope(); const step=Number(value);
        if (state.mode==='week') state.date=add(state.date,step*7);
        else state.date=monthBoundary(state.date,step*(state.mode==='year'?12:state.mode==='quarter'?3:1));
        state.dayView='all';render();focus('calendar-step',value);
      },
      'calendar-note':noteEditor,
      'calendar-remove-note':removeNote
    }
  };
}
