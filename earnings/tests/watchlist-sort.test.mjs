import assert from 'node:assert/strict';
import test from 'node:test';
import {sortWatchlist,priceHistoryChange,validPriceHistory,reportDateStatusLabel} from '../lib/watchlist-sort.ts';

const candidate=(ticker,values={})=>({ticker,name:ticker,isEtf:false,reportDate:null,reportDateStatus:'Unannounced',drawdown:null,reportingQuarter:null,followingQuarter:null,...values});
const tickers=rows=>rows.map(c=>c.ticker);
const today='2026-09-25';

test('default date order puts imminent reports first, past reports after them, and unknown/ETF last without mutating the source',()=>{
 const rows=[candidate('UNKNOWN'),candidate('PAST',{reportDate:'2026-09-24',reportDateStatus:'Reported'}),candidate('LATER',{reportDate:'2026-10-06'}),candidate('TODAY',{reportDate:today,reportDateStatus:'Confirmed'}),candidate('ETF',{isEtf:true,reportDate:'2026-09-26'}),candidate('INVALID',{reportDate:'2026-02-30'})];
 const original=[...rows];
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'reportDate',direction:'asc'},today)),['TODAY','LATER','PAST','ETF','INVALID','UNKNOWN']);
 assert.deepEqual(rows,original);
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'reportDate',direction:'desc'},today)),['LATER','TODAY','PAST','ETF','INVALID','UNKNOWN']);
});

test('numeric sorts keep zero and negative EPS and put missing values last in both directions',()=>{
 const rows=[candidate('MISSING'),candidate('ZERO',{reportingQuarter:{eps:0}}),candidate('LOSS',{reportingQuarter:{eps:-2}}),candidate('GAIN',{reportingQuarter:{eps:3}}),candidate('NAN',{reportingQuarter:{eps:NaN}})];
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'reportingEps',direction:'asc'},today)),['LOSS','ZERO','GAIN','MISSING','NAN']);
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'reportingEps',direction:'desc'},today)),['GAIN','ZERO','LOSS','MISSING','NAN']);
});

test('drawdown, following-quarter EPS and company sorting reverse independently',()=>{
 const rows=[candidate('B',{drawdown:15,followingQuarter:{eps:2}}),candidate('A',{drawdown:40,followingQuarter:{eps:8}}),candidate('C')];
 for(const key of ['drawdown','followingEps']){
  assert.deepEqual(tickers(sortWatchlist(rows,{key,direction:'asc'},today)),['B','A','C']);
  assert.deepEqual(tickers(sortWatchlist(rows,{key,direction:'desc'},today)),['A','B','C']);
 }
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'company',direction:'asc'},today)),['A','B','C']);
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'company',direction:'desc'},today)),['C','B','A']);
});

test('price-change sorting uses dated endpoints, ignores invalid points and puts absent/one-point series last',()=>{
 const up=candidate('UP',{priceHistory:[{date:'2026-09-24',close:120},{date:'2026-06-24',close:100},{date:'bad',close:800}]});
 const down=candidate('DOWN',{priceHistory:[{date:'2026-06-24',close:100},{date:'2026-09-24',close:80}]});
 const single=candidate('SINGLE',{priceHistory:[{date:'2026-06-24',close:0},{date:'2026-09-24',close:25}]});
 assert.equal(validPriceHistory(up).length,2);
 assert.ok(Math.abs(priceHistoryChange(up)-20)<1e-10);
 assert.equal(priceHistoryChange(single),null);
 const rows=[candidate('EMPTY'),up,single,down];
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'priceHistory',direction:'asc'},today)),['DOWN','UP','EMPTY','SINGLE']);
 assert.deepEqual(tickers(sortWatchlist(rows,{key:'priceHistory',direction:'desc'},today)),['UP','DOWN','EMPTY','SINGLE']);
});

test('date labels distinguish issuer confirmation, estimates, past actuals, missing dates and funds',()=>{
 const withStatus=status=>candidate('A',{reportDate:'2026-10-21',reportDateStatus:status});
 assert.equal(reportDateStatusLabel(withStatus('Confirmed')),'Confirmed');
 assert.equal(reportDateStatusLabel(withStatus('Estimated, not issuer-confirmed')),'Estimated');
 assert.equal(reportDateStatusLabel(withStatus('Actual report')),'Reported');
 assert.equal(reportDateStatusLabel(withStatus('Estimated · vendor conflict')),'Estimated · dates differ');
 assert.equal(reportDateStatusLabel(candidate('A')),'Unannounced');
 assert.equal(reportDateStatusLabel(candidate('ETF',{isEtf:true})),'Not applicable');
});
