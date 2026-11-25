// Guarantees that every tile receives work-map area proportional to its weight.
export function weightedMosaic(items, width, height) {
  if (!items.length) return [];
  const tiles = [];
  function fit(first, end, x, y, w, h) {
    if (end - first === 1) {
      tiles.push({item:items[first].item,x,y,w,h});
      return;
    }
    const total=items.slice(first,end).reduce((sum,entry)=>sum+entry.weight,0);
    let split=first+1, weight=items[first].weight;
    while (split<end-1 && Math.abs(total/2-weight-items[split].weight)<Math.abs(total/2-weight)) {
      weight+=items[split].weight;
      split++;
    }
    const share=weight/total;
    if (w>=h) {
      const cut=w*share;
      fit(first,split,x,y,cut,h);
      fit(split,end,x+cut,y,w-cut,h);
    } else {
      const cut=h*share;
      fit(first,split,x,y,w,cut);
      fit(split,end,x,y+cut,w,h-cut);
    }
  }
  fit(0,items.length,0,0,width,height);
  return tiles;
}
