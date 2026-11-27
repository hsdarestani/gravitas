const numeric=/^(€|\$|£)?\s*(-?\d+(?:\.\d+)?)\s*(%|[a-zA-Z]+)?$/;
function measure(value) {
  const parts=String(value||'').trim().match(numeric);
  if (!parts) return null;
  return {value:Number(parts[2]),unit:(parts[1]||parts[3]||'').toLowerCase()};
}

export function kpiDisplay(entry) {
  if (!entry.result) return {label:'Awaiting result',tone:'pending',progress:null};
  const goal=measure(entry.target),current=measure(entry.result);
  if (!goal||!current||current.unit!==goal.unit||!['min','max'].includes(entry.direction)) {
    return {label:'Result recorded',tone:'recorded',progress:null};
  }
  const achieved=entry.direction==='min'?current.value>=goal.value:current.value<=goal.value;
  const progress=entry.direction==='min'&&goal.value>0?Math.max(0,Math.min(100,current.value/goal.value*100)):null;
  return {label:achieved?'At target':'Outside target',tone:achieved?'met':'attention',progress};
}
