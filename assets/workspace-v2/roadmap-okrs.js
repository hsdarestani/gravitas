export const roadmapUrl = 'https://gravitas-roadmap.pages.dev/';
export let objectives = [];
export let northStar = null;

export function setObjectives(values) {
  northStar = values.find(item => item.title === 'Monthly Empowered Participants' && item.results.length) || null;
  objectives = values.filter(item => item !== northStar);
}

const allObjectives = () => northStar ? [northStar, ...objectives] : objectives;
export const objectiveById = id => allObjectives().find(item=>item.id===id);
export const resultById = id => allObjectives().flatMap(item=>item.results).find(item=>item.id===id);
export const metricValue = (value,unit) => value==null?'—':new Intl.NumberFormat('en',{maximumFractionDigits:2,
  ...(unit==='€'?{style:'currency',currency:'EUR'}:{})}).format(value)+(unit==='%'?'%':'');
export function resultProgress(result,value,baseline=0) {
  if (value==null || result.target==null) return null;
  if (value>=result.target) return 100;
  const start=baseline??0;
  return start<result.target?Math.max(0,100*(value-start)/(result.target-start)):0;
}
