import type {Candidate} from '@/lib/types';
import {priceHistoryChange,validPriceHistory} from '@/lib/watchlist-sort';

const shortDate=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

export function PriceSparkline({candidate}:{candidate:Candidate}){
 const history=validPriceHistory(candidate);
 const change=priceHistoryChange(candidate);
 if(history.length<2||change===null)return <span className="price-sparkline-empty" title="Verified price history is not available for this name.">—<small>No history</small></span>;
 const width=112,height=34,padding=3;
 const minimum=Math.min(...history.map(p=>p.close)),maximum=Math.max(...history.map(p=>p.close));
 const start=Date.parse(history[0].date),end=Date.parse(history[history.length-1].date);
 const y=(close:number)=>maximum===minimum?height/2:padding+(height-padding*2)*(1-(close-minimum)/(maximum-minimum));
 const points=history.map(point=>`${(padding+(Date.parse(point.date)-start)/(end-start)*(width-padding*2)).toFixed(2)},${y(point.close).toFixed(2)}`).join(' ');
 const period=candidate.priceHistoryPeriod||'Price history';
 const percent=`${change>0?'+':''}${change.toFixed(1)}%`;
 const title=`${candidate.ticker}: ${period}, ${shortDate(history[0].date)} to ${shortDate(history[history.length-1].date)}. Price change ${percent}. As of ${shortDate(candidate.priceHistoryAsOf||history[history.length-1].date)}.${candidate.priceHistorySourceUrl?' Open price-history source.':' Source unavailable.'}`;
 const content=<><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><line x1={padding} x2={width-padding} y1={y(history[0].close)} y2={y(history[0].close)} className="sparkline-baseline"/><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/></svg><span className="sparkline-caption"><span>{period}</span><strong>{percent}</strong></span></>;
 const className=`price-sparkline ${change<0?'is-down':change>0?'is-up':'is-flat'}`;
 return candidate.priceHistorySourceUrl?<a href={candidate.priceHistorySourceUrl} target="_blank" rel="noreferrer" className={className} title={title} aria-label={title}>{content}</a>:<span role="img" className={className} title={title} aria-label={title}>{content}</span>;
}
