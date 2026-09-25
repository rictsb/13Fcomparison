import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../earnings/node_modules/typescript/lib/typescript.js';

const source=await readFile(new URL('../earnings/lib/pick-actions.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {picksForCardSave,picksForCardRemoval}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const pick=(ticker,thesis='saved thesis')=>({ticker,target:100,targetNote:'saved target',thesis});

test('saving one card keeps other saved notes and excludes other new drafts',()=>{
 const saved=[pick('LRCX'),pick('CRDO')];
 const draft=[pick('LRCX','unfinished Lam notes'),pick('CRDO','Credo ready'),pick('MU','unfinished new pick')];
 assert.deepEqual(picksForCardSave(saved,draft,'CRDO'),[saved[0],draft[1]]);
 assert.equal(draft[0].thesis,'unfinished Lam notes');
 assert.equal(saved[1].thesis,'saved thesis');
});
test('new card saves in rank order without publishing another new card',()=>{
 const saved=[pick('LRCX'),pick('CRDO')];
 const draft=[pick('MU'),pick('LRCX','pending edit'),pick('SMCI'),pick('CRDO')];
 assert.deepEqual(picksForCardSave(saved,draft,'MU'),[draft[0],saved[0],saved[1]]);
});
test('card save retains saved picks absent from a local draft',()=>{
 const saved=[pick('LRCX'),pick('CRDO')];
 assert.deepEqual(picksForCardSave(saved,[pick('LRCX','ready')],'LRCX'),[pick('LRCX','ready'),saved[1]]);
});
test('remove persists only the requested deletion without publishing other edits',()=>{
 const saved=[pick('LRCX'),pick('CRDO'),pick('MU')];
 assert.deepEqual(picksForCardRemoval(saved,'CRDO'),[saved[0],saved[2]]);
 assert.equal(saved.length,3);
});
test('an absent card cannot be saved accidentally',()=>{
 assert.throws(()=>picksForCardSave([pick('LRCX')],[pick('LRCX')],'MU'),/no longer/);
});
