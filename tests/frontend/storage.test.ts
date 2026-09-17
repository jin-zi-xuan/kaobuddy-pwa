import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { storage } from '../../src/storage.ts';
const project = (id: string) => ({id,subject:id,exam_date:'2026-10-01',daily_minutes:60,created_at:'2026-09-17',updated_at:'2026-09-17'});
const backup = (id='incoming') => ({version:2 as const,exported_at:'2026-09-17',projects:[project(id)],materials:[],notes:[]});
beforeEach(() => {globalThis.indexedDB=new IDBFactory();});
test('backup merge preserves local projects and conflicting local records',async()=>{
 await storage.saveProject({...project('local'),subject:'不要覆盖'});
 await storage.importAll({...backup(),projects:[project('local'),project('incoming')]});
 assert.deepEqual((await storage.projects()).map(p=>[p.id,p.subject]),[['incoming','incoming'],['local','不要覆盖']]);
});
test('invalid backup fails before any data is changed',async()=>{
 await storage.saveProject(project('local'));
 await assert.rejects(storage.importAll({...backup(),projects:[{id:'bad'}]} as any));
 assert.deepEqual(await storage.projects(),[project('local')]);
});
test('unsupported version and orphan material are rejected',async()=>{
 await assert.rejects(storage.importAll({...backup(),version:999} as any));
 await assert.rejects(storage.importAll({...backup(),materials:[{id:'m',project_id:'missing',title:'test',content:'text',kind:'text',created_at:'2026-09-17'}]}));
});
test('failed replacement rolls back all stores',async()=>{
 await storage.saveProject(project('local'));
 const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value: any,...args: any[]) {if(value.id==='incoming')throw new DOMException('quota','QuotaExceededError');return original.call(this,value,...args);};
 try {await assert.rejects(storage.importAll(backup(),'replace'));} finally {IDBObjectStore.prototype.put=original;}
 assert.deepEqual(await storage.projects(),[project('local')]);
});
test('replacement atomically replaces records and export round trips',async()=>{
 await storage.saveProject(project('local'));
 await storage.importAll(backup(),'replace');
 assert.deepEqual(await storage.projects(),[project('incoming')]);
 const exported=await storage.exportAll();
 await storage.importAll(exported,'replace');
 assert.deepEqual(await storage.projects(),[project('incoming')]);
});
test('wrong optional nested card data cannot overwrite a valid database',async()=>{
 await storage.saveProject(project('local'));
 await assert.rejects(storage.importAll({...backup(),tasks:[{id:'t',project_id:'incoming',title:'t',date:'2026-09-17',estimated_minutes:30,status:'todo',created_at:'2026-09-17',updated_at:'2026-09-17',cards:[{id:'c',type:'concept',front:'?',back:null}]}]} as any));
 assert.equal((await storage.projects())[0].id,'local');
});
test('ordinary task updates preserve the latest learning session',async()=>{
 const cards=[{id:'c',type:'concept' as const,front:'Q',back:{answer:'A'}}];
 const task={id:'t',project_id:'p',title:'T',date:'2026-09-17',estimated_minutes:30,status:'todo' as const,created_at:'2026-09-17',updated_at:'2026-09-17',cards};
 await storage.saveTask(task);
 const session={signature:JSON.stringify(cards),queue:['c'],progress:{c:'mastered' as const},round:1,index:0,flipped:true};
 await storage.updateTaskLearning('t',{card_session:session,memorized:true});
 await storage.saveTask({...task,module_status:'doing'});
 assert.deepEqual((await storage.tasks())[0].card_session,session);
 assert.equal((await storage.tasks())[0].memorized,true);
});
test('stale card session cannot overwrite imported cards',async()=>{
 const task={id:'t',project_id:'p',title:'T',date:'2026-09-17',estimated_minutes:30,status:'todo' as const,created_at:'2026-09-17',updated_at:'2026-09-17',cards:[{id:'new',type:'concept' as const,front:'new',back:{answer:'A'}}]};
 await storage.saveTask(task);
 await storage.updateTaskLearning('t',{card_session:{signature:'old',queue:['old'],progress:{},round:1,index:0,flipped:false}});
 assert.equal((await storage.tasks())[0].card_session,undefined);
});
