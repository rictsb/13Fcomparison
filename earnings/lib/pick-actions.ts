import type {Pick} from './types';

// A card save must never publish another card's unfinished notes or new pick.
export function picksForCardSave(saved:Pick[],draft:Pick[],ticker:string):Pick[]{
 const selected=draft.find(p=>p.ticker===ticker);
 if(!selected)throw new Error('This bet is no longer in your list.');
 const committed=new Map(saved.map(p=>[p.ticker,p]));
 committed.set(ticker,selected);
 const ordered=draft.filter(p=>committed.has(p.ticker)).map(p=>committed.get(p.ticker)!);
 for(const pick of saved)if(!ordered.some(p=>p.ticker===pick.ticker))ordered.push(pick);
 return ordered;
}

export function picksForCardRemoval(saved:Pick[],ticker:string):Pick[]{
 return saved.filter(p=>p.ticker!==ticker);
}
