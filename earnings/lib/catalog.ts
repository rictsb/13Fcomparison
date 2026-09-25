import data from './candidates.json';
import type {Candidate} from './types';

export const baseCandidates=data as unknown as Candidate[];
export const stockCurrencies=['USD','CAD','GBP','EUR','JPY','KRW','TWD','HKD','AUD','CHF'] as const;

export function validateCandidateInput(value:unknown):{ticker:string;name:string;currency:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Enter a ticker to add a stock.');
 const input=value as Record<string,unknown>;
 if(typeof input.ticker!=='string')throw new Error('Enter a ticker to add a stock.');
 let ticker=input.ticker.trim().toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9.\-:^=/]{0,24}$/.test(ticker))throw new Error('Use a ticker of up to 25 letters, numbers or exchange punctuation.');
 const known=baseCandidates.find(c=>c.ticker.toUpperCase()===ticker||c.symbol.toUpperCase()===ticker||(c.ticker==='4062'&&ticker==='4062.T'));
 if(known)ticker=known.ticker;
 if(input.name!==undefined&&typeof input.name!=='string')throw new Error('Enter a company name or leave it blank.');
 const name=(typeof input.name==='string'?input.name.trim():'')||known?.name||ticker;
 if(name.length>120)throw new Error('Company names can contain up to 120 characters.');
 const currency=input.currency===undefined?'USD':typeof input.currency==='string'?input.currency.trim().toUpperCase():'';
 if(!stockCurrencies.some(code=>code===currency))throw new Error('Choose a supported trading currency.');
 return {ticker,name,currency:known?.currency??currency};
}

export function makeCandidate({ticker,name,currency='USD'}:{ticker:string;name?:string;currency?:string}):Candidate{
 return {ticker,symbol:ticker,name:name||ticker,sector:'Added stock',group:'watchlist',currency,price:null,drawdown:null,priceAsOf:null,reportDate:null,reportDateStatus:'unconfirmed',reportingQuarter:null,followingQuarter:null,thesis:'Added to the shared watchlist. Earnings setup has not yet been researched.',risk:'Verify the security, report date and earnings expectations.',researchLabel:'Not researched',userFavorite:false,isEtf:false,economicGroup:ticker,priceSource:'',highBasis:'52-week high',sources:[],consensusNotes:[]};
}

export function mergeCandidates(custom:Candidate[]=[]):Candidate[]{
 const merged=new Map(baseCandidates.map(c=>[c.ticker,c]));
 for(const candidate of custom)if(!merged.has(candidate.ticker))merged.set(candidate.ticker,candidate);
 return [...merged.values()];
}
