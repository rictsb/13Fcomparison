import type {Candidate} from './types';

export type WatchlistSortKey = 'company' | 'drawdown' | 'priceHistory' | 'reportDate' | 'reportingEps' | 'followingEps';
export type WatchlistSort = {key:WatchlistSortKey;direction:'asc'|'desc'};
export const watchlistSortLabels:Record<WatchlistSortKey,string> = {
 company:'Company / ticker',drawdown:'Amount down from high',priceHistory:'Price trend (% change)',
 reportDate:'Report date',reportingEps:'Report EPS consensus',followingEps:'Following EPS consensus',
};
export const defaultWatchlistSort:WatchlistSort={key:'reportDate',direction:'asc'};

function validDate(value:string|null|undefined):value is string {
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+'T12:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}

export function reportDateStatusLabel(candidate:Pick<Candidate,'reportDate'|'reportDateStatus'|'isEtf'>){
 if(candidate.isEtf||/not applicable/i.test(candidate.reportDateStatus))return 'Not applicable';
 if(!validDate(candidate.reportDate))return 'Unannounced';
 if(/\b(reported|actual)\b/i.test(candidate.reportDateStatus))return 'Reported';
 if(/^(confirmed|issuer[- ]confirmed)\b/i.test(candidate.reportDateStatus))return 'Confirmed';
 return /conflict|differ/i.test(candidate.reportDateStatus)?'Estimated · dates differ':'Estimated';
}

export function isReportDueWithinWeek(candidate:Pick<Candidate,'reportDate'|'reportDateStatus'|'isEtf'>,today:string):boolean{
 if(!validDate(today)||!validDate(candidate.reportDate))return false;
 const status=reportDateStatusLabel(candidate);
 if(status==='Reported'||status==='Not applicable')return false;
 const daysUntil=(Date.parse(candidate.reportDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
 return daysUntil>=0&&daysUntil<=7;
}

export function validPriceHistory(candidate:Pick<Candidate,'priceHistory'>){
 const points=new Map<string,{date:string;close:number}>();
 for(const point of candidate.priceHistory??[]){
  if(validDate(point.date)&&Number.isFinite(point.close)&&point.close>0)points.set(point.date,point);
 }
 return [...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function priceHistoryChange(candidate:Pick<Candidate,'priceHistory'>):number|null{
 const points=validPriceHistory(candidate);
 return points.length<2?null:(points[points.length-1].close/points[0].close-1)*100;
}

function numericValue(candidate:Candidate,key:WatchlistSortKey):number|null{
 const value=key==='drawdown'?candidate.drawdown:key==='priceHistory'?priceHistoryChange(candidate):key==='reportingEps'?candidate.reportingQuarter?.eps:candidate.followingQuarter?.eps;
 return typeof value==='number'&&Number.isFinite(value)?value:null;
}

/** Sort a copy of the catalog; never change the saved ranking or the source order. */
export function sortWatchlist(candidates:Candidate[],sort:WatchlistSort,today:string):Candidate[]{
 const direction=sort.direction==='asc'?1:-1;
 const tickerOrder=(a:Candidate,b:Candidate)=>a.ticker.localeCompare(b.ticker,undefined,{numeric:true,sensitivity:'base'});
 return [...candidates].sort((a,b)=>{
  if(sort.key==='company')return direction*tickerOrder(a,b)||a.name.localeCompare(b.name);
  if(sort.key==='reportDate'){
   const dateGroup=(c:Candidate)=>c.isEtf||!validDate(c.reportDate)?2:c.reportDate<today||reportDateStatusLabel(c)==='Reported'?1:0;
   const groupA=dateGroup(a),groupB=dateGroup(b);
   if(groupA!==groupB)return groupA-groupB;
   if(groupA===2)return tickerOrder(a,b);
   return direction*a.reportDate!.localeCompare(b.reportDate!)||tickerOrder(a,b);
  }
  const valueA=numericValue(a,sort.key),valueB=numericValue(b,sort.key);
  if(valueA===null||valueB===null)return valueA===valueB?tickerOrder(a,b):valueA===null?1:-1;
  return direction*(valueA-valueB)||tickerOrder(a,b);
 });
}
