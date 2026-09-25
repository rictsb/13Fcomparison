'use client';
import data from '@/lib/candidates.json';
import {codexPicks,codexReviewDate} from '@/lib/codex-picks';
import type {Candidate,Quarter} from '@/lib/types';
import {reportDateStatusLabel} from '@/lib/watchlist-sort';
import {ExternalLink,ChevronDown,ChevronRight} from 'lucide-react';

const candidates=data as unknown as Candidate[];
const company=(ticker:string)=>candidates.find(c=>c.ticker===ticker)!;
const symbol=(c:Candidate)=>c.ticker==='4062'?'4062.T':c.ticker;
const eps=(q:Quarter|null)=>q?.eps==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:q.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(q.eps);
const report=(c:Candidate)=>c.reportDate?new Date(c.reportDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Unannounced';
type Props={onOpen:(candidate:Candidate)=>void;compact?:boolean};

function PickSummary({candidate,rank,compact=false}:{candidate:Candidate;rank:number;compact?:boolean}){
 return <summary className="codex-pick-summary">
  <span className="rank-number">{String(rank).padStart(2,'0')}</span>
  <span className="codex-pick-company"><strong>{symbol(candidate)}</strong><span className="company-name">{candidate.name}</span></span>
  {!compact&&<span className="drawdown">{candidate.drawdown==null?'—':`−${candidate.drawdown.toFixed(1)}%`}<small>from high · Sep 24</small></span>}
  <ChevronDown className="codex-pick-chevron" size={18} aria-hidden="true"/>
 </summary>;
}

export function CodexPicks({onOpen,compact=false}:Props){
 if(compact)return <section className="panel compare-board codex">
  <div className="section-title"><h2>Codex’s five</h2><span className="pick-count">5<span>/5</span></span></div>
  <p className="codex-compare-note">My research ranking · {codexReviewDate}</p>
  <ol className="comparison-list codex-compact-list">{codexPicks.map((pick,i)=>{
   const c=company(pick.ticker);
   return <li key={pick.ticker}><details className="codex-pick-disclosure">
    <PickSummary candidate={c} rank={i+1} compact/>
    <div className="comparison-content codex-compact-details">
     <div className="mini-financials">Report {report(c)} · {reportDateStatusLabel(c)}<br/>{c.reportingQuarter?.shortPeriod}: {eps(c.reportingQuarter)} · {c.followingQuarter?.shortPeriod}: {eps(c.followingQuarter)}</div>
     <h3>Why it goes up</h3><p className="user-note">{pick.summary}</p>
     <h3>The earnings trigger</h3><p className="user-note">{pick.catalyst}</p>
     <button className="bet-research codex-research-button" onClick={()=>onOpen(c)}>Research and sources<ChevronRight size={15}/></button>
    </div>
   </details></li>;
  })}</ol>
  <p className="data-footnote">Full cases, risks and sources are in the Codex tab. Price targets have not been set.</p>
 </section>;
 return <section className="codex-view" aria-label="Codex’s top five earnings bets">
  <div className="codex-intro panel">
   <div><div className="eyebrow">INDEPENDENT RESEARCH VIEW · {codexReviewDate}</div><h2>My five, in order of conviction.</h2><p>These are my preferred setups for the approaching reporting season, informed by SemiAnalysis and company disclosures. The ranking is mine; it is not a SemiAnalysis model portfolio.</p></div>
   <span className="codex-horizon">1–5 trading days<br/><strong>Up to 10 with follow-through</strong></span>
  </div>
  <div className="codex-approach">
   <strong>How I would use this list</strong><p>Favor a report that lifts forward estimates, then assess whether the move still has room after the opening reaction. A pullback alone does not establish low expectations. These five share AI and semiconductor-spending exposure; they are not five independent risks.</p>
   <p className="muted-copy">This is a dated research ranking, not a measured return forecast. Price targets await entry-price and valuation work. The consensus snapshots below are not live or uniformly comparable.</p>
  </div>
  <ol className="codex-ranking">{codexPicks.map((pick,i)=>{
   const c=company(pick.ticker);
   return <li className="panel codex-card" key={pick.ticker}><details className="codex-pick-disclosure">
    <PickSummary candidate={c} rank={i+1}/>
    <div className="codex-pick-details">
     <h3>{pick.headline}</h3><p className="codex-why">{pick.why}</p>
     <div className="codex-metrics">
      <button onClick={()=>onOpen(c)}><span>Report date</span><strong>{report(c)}</strong><small>{reportDateStatusLabel(c)}</small></button>
      {[c.reportingQuarter,c.followingQuarter].map((q,n)=><button key={n} onClick={()=>onOpen(c)}><span>{n===0?'Report EPS consensus':'Following EPS consensus'}</span><strong>{eps(q)}</strong><small>{q?.shortPeriod}</small><small className="inline-caution">{q?.caution}</small></button>)}
     </div>
     <div className="codex-case">
      <div><h4>What is already expected</h4><p>{pick.baseline}</p><a className="source-link" href={pick.sourceUrl} target="_blank" rel="noreferrer">{pick.sourceLabel}<ExternalLink size={13}/></a></div>
      <div><h4>What could move it higher</h4><p>{pick.catalyst}</p></div>
      <div><h4>What would break the case</h4><p>{pick.invalidator}</p></div>
     </div>
     <div className="codex-sa">
      <h4>SemiAnalysis connection</h4><p>{pick.sa}</p>
      {c.sources.map(s=><a key={s.url} className="source-link" href={s.url} target="_blank" rel="noreferrer">{s.title}<ExternalLink size={13}/></a>)}
      {pick.ticker==='MTSI'&&<a className="source-link" href="https://semianalysis.com/institutional/npo-turning-the-lights-up/" target="_blank" rel="noreferrer">SA · August 19 NPO update<ExternalLink size={13}/></a>}
     </div>
     <button className="bet-research codex-research-button" onClick={()=>onOpen(c)}>Research and sources<ChevronRight size={15}/></button>
    </div>
   </details></li>;
  })}</ol>
  <div className="codex-reserves panel">
   <h3>Why CRDO and SMCI are outside this five</h3>
   <p><button className="ticker-link" onClick={()=>onOpen(company('CRDO'))}>CRDO</button> is my first alternative for the later reporting window. Its December estimate and recovery from the last selloff make it a different entry decision from the nearer reports.</p>
   <p><button className="ticker-link" onClick={()=>onOpen(company('SMCI'))}>SMCI</button> needs an earnings-quality test: cash collection, inventory conversion and repeatable margins. The low headline multiple alone does not resolve those concerns.</p>
   <p className="muted-copy">Open either company for the underlying research and sources. My selections leave Richard’s and Dan’s choices independent.</p>
  </div>
 </section>;
}
