import { today } from './timing.js';

export function noteRecipients(note, owners = [], parentAuthor = '') {
  const recipients = {};
  for (const id of owners) if (id !== note.actor) recipients[id] = 'owned-note';
  if (parentAuthor && parentAuthor!==note.actor) recipients[parentAuthor]='reply';
  for (const id of note.mentions) if (id !== note.actor) recipients[id] = 'mention';
  return recipients;
}

export function threadNotes(notes) {
  const byId=new Map(notes.map(note=>[note.id,note]));
  const children=new Map();
  const roots=[];
  for (const note of notes) {
    if (!note.parentId || !byId.has(note.parentId)) {
      roots.push(note);
      continue;
    }
    if (!children.has(note.parentId)) children.set(note.parentId,[]);
    children.get(note.parentId).push(note);
  }
  const stack=roots.slice().reverse().map(note=>({note,depth:0,parent:null}));
  const result=[];
  while (stack.length) {
    const entry=stack.pop();
    result.push(entry);
    for (const reply of (children.get(entry.note.id)||[]).slice().reverse()) {
      stack.push({note:reply,depth:entry.depth+1,parent:entry.note});
    }
  }
  return result;
}

export const recipientsFor = (ids, reason) => Object.fromEntries(ids.map(id=>[id,reason]));

export function upgradeJournal(data) {
  if (data.journalVersion === 2) return data;
  if (data.journalVersion === 1) {
    for (const task of data.tasks) for (const [i,note] of task.notes.entries()) {
      note.id ||= 'existing-note-'+task.id+'-'+(i+1);
      const entry=data.log.find(event=>!event.noteId&&event.task===task.id&&event.actor===note.actor&&
        event.body===note.body&&Math.abs(Date.parse(event.at)-Date.parse(note.at))<1500);
      if (entry) entry.noteId=note.id;
    }
    data.journalVersion=2;
    return data;
  }
  const usedNotes = new Set();
  data.log.forEach((entry,i)=>{
    entry.id ||= 'history-'+(i+1);
  });
  for (const task of data.tasks) {
    for (const [i,note] of task.notes.entries()) {
      const existing = data.log.find(entry=>!usedNotes.has(entry.id) &&
        entry.task === task.id && entry.actor === note.actor &&
        /^(Posted a note|Recorded pass)/.test(entry.text) &&
        Math.abs(Date.parse(entry.at)-Date.parse(note.at))<1500);
      note.id ||= 'existing-note-'+task.id+'-'+(i+1);
      const entry=existing || {
        id:note.id, actor:note.actor, at:note.at,
        task:task.id, project:task.project, text:'Posted a note on '+task.title
      };
      usedNotes.add(entry.id);
      entry.kind=existing?.text.startsWith('Recorded pass')?'review':'note';
      entry.body=note.body;
      entry.noteId=note.id;
      entry.recipients=noteRecipients(note);
      if (!existing) data.log.push(entry);
    }
  }
  data.log.sort((a,b)=>b.at.localeCompare(a.at));
  data.dailyLogs ||= {};
  data.inboxRead ||= {};
  data.journalVersion = 2;
  return data;
}

export function eventsForDay(data, member, date) {
  return data.log.filter(entry=>entry.task && entry.actor===member && today(entry.at)===date);
}

export function notifications(data, member) {
  const read = data.inboxRead[member] || {};
  return data.log.filter(event=>event.actor!==member&&event.recipients?.[member]).map(event=>({
    ...event, reason:event.recipients[member], read:Boolean(read[event.id])
  }));
}

export function markRead(data, member, ids) {
  data.inboxRead[member] ||= {};
  for (const id of ids) data.inboxRead[member][id]=true;
}

let imageDb;
function openImages() {
  if (!imageDb) {
    imageDb = new Promise((resolve,reject)=>{
      const request=indexedDB.open('graviquest-workspace-attachments',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('images');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('The browser could not open image storage.'));
    }).catch(error=>{imageDb=undefined;throw error;});
  }
  return imageDb;
}

async function imageOperation(mode, makeRequest) {
  const db=await openImages();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('images',mode);
    const request=makeRequest(tx.objectStore('images'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=()=>reject(tx.error || request.error);
    tx.onabort=()=>reject(tx.error || new Error('The image could not be saved.'));
  });
}

export const getImage = id => imageOperation('readonly',store=>store.get(id));
export const removeImage = id => imageOperation('readwrite',store=>store.delete(id));

export async function saveImage(id,file) {
  if (!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');
  }
  if (file.size>12*1024*1024) throw new Error('Choose an image smaller than 12 MB.');
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();
    img.src=url;
    await img.decode();
  } catch {
    throw new Error('This image could not be opened.');
  } finally {
    URL.revokeObjectURL(url);
  }
  await imageOperation('readwrite',store=>store.put(file,id));
}
