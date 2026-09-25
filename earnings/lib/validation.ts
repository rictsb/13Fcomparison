import candidates from './candidates.json';
import type {Person,Pick} from './types';
export class ValidationError extends Error {}
export function validatePerson(value:unknown):Person {if(value!=='Richard'&&value!=='Dan')throw new ValidationError('Choose Richard or Dan.');return value;}
export function validatePicks(value:unknown):Pick[]{
 if(!Array.isArray(value)||value.length>5)throw new ValidationError('Choose no more than five earnings bets.');
 const groups=new Set<string>();
 return value.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw new ValidationError('Each pick needs a company and notes.');
  const c=candidates.find(c=>c.ticker===p.ticker);
  if(!c||c.isEtf)throw new ValidationError('Choose an operating company from the watchlist.');
  if(groups.has(c.economicGroup))throw new ValidationError('Each company can appear only once, including alternate listings.');groups.add(c.economicGroup);
  if(p.target!==null&&(typeof p.target!=='number'||!Number.isFinite(p.target)||p.target<=0||p.target>1e9))throw new ValidationError('Price targets must be positive numbers.');
  if(typeof p.targetNote!=='string'||p.targetNote.length>2000||typeof p.thesis!=='string'||p.thesis.length>6000)throw new ValidationError('A price-target note can contain 2,000 characters; a thesis can contain 6,000.');
  return {ticker:c.ticker,target:p.target,targetNote:p.targetNote,thesis:p.thesis};
 });
}
export function validateSave(value:unknown){
 if(!value||typeof value!=='object')throw new ValidationError('Invalid ranking.');
 const v=value as Record<string,unknown>;const person=validatePerson(v.person);
 if(!Number.isSafeInteger(v.version)||Number(v.version)<0)throw new ValidationError('Reload the saved ranking before trying again.');
 return {person,version:Number(v.version),picks:validatePicks(v.picks)};
}
