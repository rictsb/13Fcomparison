'use client';

import {useId} from 'react';
import {ArrowDown,ArrowUp,Check,ChevronDown,ChevronRight,Pencil,Save,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Candidate,Person,Pick,Quarter} from '@/lib/types';

export type BetCardProps={
 person:Person;
 candidate:Candidate;
 pick:Pick;
 index:number;
 total:number;
 expanded:boolean;
 editing:boolean;
 saved:boolean;
 dirty:boolean;
 busy:boolean;
 onExpand:()=>void;
 onEdit:()=>void;
 onSave:()=>void;
 onCancel:()=>void;
 onRemove:()=>void;
 onMove:(offset:number)=>void;
 onChange:(change:Partial<Pick>)=>void;
 onResearch:()=>void;
};

const money=(value:number|null,currency='USD')=>value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2,minimumFractionDigits:2}).format(value);
const date=(value:string|null)=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Unannounced';

function Consensus({quarter,label}:{quarter:Quarter|null;label:string}){
 return <div><dt>{label}</dt><dd>{quarter?money(quarter.eps,quarter.currency):'Not researched'}</dd>{quarter&&<small>{quarter.shortPeriod}</small>}</div>;
}

export function BetCard({person,candidate:c,pick,index,total,expanded,editing,saved,dirty,busy,onExpand,onEdit,onSave,onCancel,onRemove,onMove,onChange,onResearch}:BetCardProps){
 const instanceId=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const symbol=c.ticker==='4062'?'4062.T':c.ticker;
 const contentId=`bet-${person}-${c.ticker.replace(/[^a-zA-Z0-9_-]/g,'-')}-${instanceId}`;
 const upside=pick.target!==null&&c.price!==null&&c.price>0?pick.target/c.price-1:null;
 const status=dirty||!saved?'Unsaved':'Saved';
 return <article className={`pick-card bet-card ${editing?'bet-card-editing':''}`} aria-label={`${person} ${symbol} bet`} aria-busy={busy}>
  <button type="button" className="bet-summary" aria-expanded={expanded} aria-controls={contentId} aria-label={`${expanded?'Collapse':'Expand'} ${symbol} bet`} onClick={onExpand}>
   <span className="rank-number">{String(index+1).padStart(2,'0')}</span>
   <span className="bet-company"><strong>{symbol}</strong><span className="company-name">{c.name}</span></span>
   <span className="bet-target"><small>Target · {c.currency}</small><strong>{money(pick.target,c.currency)}</strong></span>
   <ChevronDown size={17} className={expanded?'expanded':''} aria-hidden="true"/>
  </button>
  <div className="bet-actions">
   <span className={`bet-status ${status==='Saved'?'is-saved':''}`}>{status==='Saved'&&<Check size={12} aria-hidden="true"/>}{status}</span>
   <div className="bet-main-actions">
    <Button type="button" size="sm" disabled={busy} onClick={onSave} aria-label={`Save ${symbol} bet`}><Save size={14}/>Save</Button>
    {!editing&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={onEdit} aria-label={`Edit ${symbol} bet`}><Pencil size={14}/>Edit</Button>}
    <Button type="button" size="sm" variant="ghost" className="bet-remove" disabled={busy} onClick={onRemove} aria-label={`Remove ${symbol}`}><X size={14}/>Remove</Button>
   </div>
   <div className="rank-actions" aria-label={`Rank ${symbol}`}>
    <button type="button" className="icon-button" disabled={index===0||busy} onClick={()=>onMove(-1)} aria-label={`Move ${symbol} up`}><ArrowUp size={14}/></button>
    <button type="button" className="icon-button" disabled={index===total-1||busy} onClick={()=>onMove(1)} aria-label={`Move ${symbol} down`}><ArrowDown size={14}/></button>
   </div>
  </div>
  <div id={contentId} className="bet-details" hidden={!expanded}>
   {editing?<>
    <div className="target-row"><label>Price target <span>{c.currency}</span><input type="number" min="0.01" max="1000000000" step="any" value={pick.target??''} disabled={busy} placeholder="Your target" aria-label={`${person} ${symbol} price target`} onChange={e=>onChange({target:e.target.value===''?null:Number(e.target.value)})}/></label>{upside!==null&&<div className={`target-upside ${upside<0?'negative':''}`}><strong>{upside>=0?'+':''}{(upside*100).toFixed(1)}%</strong><small>vs {c.priceAsOf?date(c.priceAsOf):'reference'} close</small></div>}</div>
    {c.ticker==='4062'&&<p className="inline-caution">Enter the target on the pre-October split basis, matching ¥22,405.</p>}
    <label className="note-label">Price-target note<textarea value={pick.targetNote} maxLength={2000} disabled={busy} rows={2} placeholder="Target timing, valuation or scenario…" aria-label={`${person} ${symbol} price-target note`} onChange={e=>onChange({targetNote:e.target.value})}/></label>
    <label className="note-label">Why it goes up<textarea value={pick.thesis} maxLength={6000} disabled={busy} rows={3} placeholder="What will the report reveal that changes expectations?" aria-label={`${person} ${symbol} reason to go up`} onChange={e=>onChange({thesis:e.target.value})}/></label>
    <div className="bet-edit-footer"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{saved?'Cancel edit':'Cancel'}</Button><span>Save this bet when ready.</span></div>
   </>:<div className="bet-saved-details">
    <h3>Price target <span>{c.currency}</span></h3><p className="bet-saved-target">{pick.target===null?'No target set.':money(pick.target,c.currency)}{upside!==null&&<small className={upside<0?'negative':''}>{upside>=0?'+':''}{(upside*100).toFixed(1)}% vs {c.priceAsOf?date(c.priceAsOf):'reference'} close</small>}</p>
    {c.ticker==='4062'&&<p className="inline-caution">Target uses the pre-October split basis, matching ¥22,405.</p>}
    <h3>Price-target note</h3><p className="user-note">{pick.targetNote||'No target note yet.'}</p>
    <h3>Why it goes up</h3><p className="user-note">{pick.thesis||'No thesis yet.'}</p>
   </div>}
   <dl className="bet-financials"><div className="bet-report-date"><dt>Report date</dt><dd>{date(c.reportDate)}</dd>{c.reportDate&&<small>Estimated</small>}</div><Consensus label="Report EPS consensus" quarter={c.reportingQuarter}/><Consensus label="Following EPS consensus" quarter={c.followingQuarter}/></dl>
   <button type="button" className="bet-research" onClick={onResearch}>Research & sources<ChevronRight size={14} aria-hidden="true"/></button>
  </div>
 </article>;
}
