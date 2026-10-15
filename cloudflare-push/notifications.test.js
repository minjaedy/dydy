import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker from './worker.js';
import {recordNotification,notificationBadge,notificationsRoute,readNotifications,readChatNotifications,cleanNotifications,NOTICE_RETENTION_MS} from './notifications.js';
function environment(){
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const prepare=q=>({bind(...args){assert(args.length<=100);const s=db.prepare(q);return{first:async()=>s.get(...args),run:async()=>({meta:s.run(...args)}),all:async()=>({results:s.all(...args)})}}});
  return {db,DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
}
const ctx={waitUntil(p){p.catch(()=>{})}};
const request=(path,body)=>new Request('https://push.invalid/notifications/'+path,{method:'POST',body:JSON.stringify(body)});
const route=(e,owner,path,body={})=>notificationsRoute(request(path,body),e,{owner},ctx);
const add=(e,owner,tag,screen='calendar')=>recordNotification(e,owner,tag,'Title','Body',screen);
test('same-person devices share reads; forged owner and shared tags cannot clear partner notices',async()=>{
  const e=environment();await add(e,'sweet','shared');await add(e,'rabbit','shared');
  const before=await(await route(e,'sweet','state')).json();assert.equal(before.items.length,1);
  const after=await(await route(e,'sweet','read',{owner:'rabbit',all:true,through:before.through,keys:['shared']})).json();
  assert.equal(after.count,0);assert.deepEqual(after.readTags,['shared']);assert.equal(after.items.length,0);
  assert.equal((await(await route(e,'sweet','state')).json()).count,0);
  assert.equal((await(await route(e,'rabbit','state')).json()).count,1);
  const response=await worker.fetch(request('read',{owner:'sweet',all:true,through:99}),e,ctx);assert.equal(response.status,401);e.db.close();
});
test('read cursor excludes concurrently arriving notifications; screen and exact tag reads stay narrow',async()=>{
  const e=environment();await add(e,'sweet','old');const seen=await notificationBadge(e,'sweet');await add(e,'sweet','new');await add(e,'sweet','leave','leave');
  await readNotifications(e,'sweet',{all:true,through:seen.through});assert.equal((await notificationBadge(e,'sweet')).count,2);
  const now=await notificationBadge(e,'sweet');await readNotifications(e,'sweet',{screen:'calendar',through:now.through});
  assert.equal((await notificationBadge(e,'sweet')).count,1);await readNotifications(e,'sweet',{tags:['leave'],through:now.through});assert.equal((await notificationBadge(e,'sweet')).count,0);e.db.close();
});
test('offline local notice import cannot resurrect reads, leak to another user or grow past expiry',async()=>{
  const e=environment(),item={key:'reminder:event:2026-10-16',title:'local',receivedAt:Date.now()};
  let state=await(await route(e,'sweet','state',{localItems:[item]})).json();const tag=state.items[0].tag;
  await readNotifications(e,'sweet',{all:true,through:state.through});
  state=await(await route(e,'sweet','state',{localItems:[item],keys:[tag]})).json();assert.equal(state.count,0);assert.deepEqual(state.readTags,[tag]);
  assert.equal((await notificationBadge(e,'rabbit')).count,0);
  await recordNotification(e,'rabbit','expired','Title','Body','home',null,Date.now()-NOTICE_RETENTION_MS-1);await cleanNotifications(e);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM notification_inbox WHERE owner=?').get('rabbit').n,0);e.db.close();
});
test('many receipt keys stay within D1 binding limits and read only their owner',async()=>{
  const e=environment(),keys=[];for(let i=0;i<220;i++){keys.push('tag-'+i);await add(e,'sweet',keys.at(-1));}await add(e,'rabbit','tag-0');
  const before=await notificationBadge(e,'sweet');await readNotifications(e,'sweet',{tags:keys,through:before.through});
  const state=await(await route(e,'sweet','state',{keys})).json();assert.equal(state.readTags.length,220);assert.equal((await notificationBadge(e,'rabbit')).count,1);e.db.close();
});
test('chat receipt clears only notifications for messages actually read by that owner',async()=>{
  const e=environment();for(const owner of ['rabbit','sweet']){e.db.prepare('INSERT INTO chat_messages(id,owner,kind,payload,created_at) VALUES(?,?,?,?,?)').run(owner,owner,'text','{}',Date.now());}
  await add(e,'sweet','chat-rabbit','chat');await add(e,'rabbit','chat-sweet','chat');await add(e,'sweet','other','calendar');
  await readChatNotifications(e,'sweet',1);assert.equal((await notificationBadge(e,'sweet')).count,1);assert.equal((await notificationBadge(e,'rabbit')).count,1);e.db.close();
});
