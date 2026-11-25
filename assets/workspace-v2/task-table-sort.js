const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const statusOrder = ['Idea basket','Backlog','Doing','Blocked','Done','Closed','Archived'];

export function orderedTaskRows(items, sort, displayStatus, ownerName) {
  const sign=sort.direction==='descending'?-1:1;
  const nameOrder=(a,b)=>collator.compare(a.title,b.title)||collator.compare(a.id,b.id);
  const ownerKey=item=>item.owners.map(ownerName).sort(collator.compare).join(' · ');
  const statusRank=item=>{
    const rank=statusOrder.indexOf(displayStatus(item));
    return rank<0?statusOrder.length:rank;
  };
  const keyOf={title:item=>item.title,owners:ownerKey,deadline:item=>item.dueDate||'',duration:item=>item.durationDays?Number(item.durationDays):'',status:statusRank}[sort.column];
  const keys=new Map(items.map(item=>[item,keyOf(item)]));
  return items.slice().sort((a,b)=>{
    const first=keys.get(a), second=keys.get(b);
    if (first===''||second==='') return Number(first==='')-Number(second==='')||nameOrder(a,b);
    const result=typeof first==='number'?first-second:collator.compare(first,second);
    return sign*result||nameOrder(a,b);
  });
}
