export function uniqueDailyBlocks(blocks) {
  const winners=new Map(), keys=[];
  for (const [index,block] of blocks.entries()) {
    const key=block.type==='activity'&&block.event?'event:'+block.event:
      block.type==='task'&&block.task?'task:'+block.task:
      block.type==='meeting'&&block.meeting&&block.task?'meeting:'+block.meeting+':'+block.task:'';
    keys.push(key);
    if (!key) continue;
    const prior=winners.get(key);
    const timestamp=block.addedAt||'';
    if (!prior||timestamp>=(prior.timestamp||'')) winners.set(key,{index,timestamp});
  }
  return blocks.filter((_,index)=>!keys[index]||winners.get(keys[index]).index===index);
}

export function cleanDailyLogs(logs) {
  let changed=false;
  for (const days of Object.values(logs)) for (const log of Object.values(days)) {
    const blocks=uniqueDailyBlocks(log.blocks||[]);
    if (blocks.length!==log.blocks?.length) {log.blocks=blocks;changed=true;}
  }
  return changed;
}
