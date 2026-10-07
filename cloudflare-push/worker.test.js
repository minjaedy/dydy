import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{sync,hourlyReminders,DELIVERY_RETENTION_MS,notificationCutoff,hash,reminders,anniversaries,reminderRecipients,notificationTitle} from './worker.js';

function environment(){
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  return {APP_ORIGIN:'https://minjaedy.github.io',APP_URL:'https://minjaedy.github.io/dydy/',VAPID_PUBLIC_KEY:'public-test-key',DB:{prepare(query){return{bind(...args){const stmt=db.prepare(query);return{first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}}}},close:()=>db.close()};
}
test('personal events today only; anniversaries tomorrow and today; repeating birthdays and milestones',()=>{
  const result=reminders({one:{date:'2026-10-07',title:'개인 일정',kind:'daily'},two:{date:'2026-10-08',title:'내일 개인',kind:'daily'},three:{date:'2026-10-08',title:'기념일',kind:'anniversary'}},'2026-10-07');
  assert.deepEqual(result.map(e=>e.title).sort(),['개인 일정','기념일'].sort());
  assert(anniversaries(2027).some(e=>e.title==='1주년'));
  assert(anniversaries(2026).some(e=>e.title==='100일'&&e.date==='2026-05-28'));
  assert.equal(anniversaries(2027).find(e=>e.title==='이토끼 생일').owner,'rabbit');
});
test('pairing required; tokens hashed; subscription endpoints restricted; unapproved origins rejected',async()=>{
  const env=environment();env.RABBIT_PAIR_HASH=await hash('private-rabbit-code');
  const req=(path,body,token,origin=env.APP_ORIGIN)=>new Request('https://push.invalid'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const ctx={waitUntil(){}};
  assert.equal((await worker.fetch(req('/subscription',{}),env,ctx)).status,401);
  assert.equal((await worker.fetch(req('/pair',{owner:'rabbit',code:'wrong'}),env,ctx)).status,403);
  const response=await worker.fetch(req('/pair',{owner:'rabbit',code:'private-rabbit-code'}),env,ctx);assert.equal(response.status,200);
  const {token}=await response.json();assert(token.length>32);
  const stored=await env.DB.prepare('SELECT token_hash FROM devices').bind().first();assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash,await hash(token));
  assert.equal((await worker.fetch(req('/subscription',{endpoint:'https://evil.invalid/',keys:{auth:'abc',p256dh:'abc'}},token),env,ctx)).status,400);
  assert.equal((await worker.fetch(req('/subscription',{endpoint:'https://web.push.apple.com/test',keys:{auth:'abc',p256dh:'abc'}},token),env,ctx)).status,200);
  assert.equal((await worker.fetch(req('/subscription',{},token,'https://evil.invalid'),env,ctx)).status,403);
  assert.equal((await worker.fetch(new Request('https://push.invalid/subscription',{method:'DELETE',headers:{Authorization:'Bearer '+token}}),env,ctx)).status,200);
  assert.equal((await env.DB.prepare('SELECT subscription FROM devices').bind().first()).subscription,null);
  env.close();
});
test('pairing is rate limited',async()=>{
  const env=environment();for(let n=0;n<10;n++)await worker.fetch(new Request('https://push.invalid/pair',{method:'POST',body:JSON.stringify({owner:'rabbit',code:'wrong'})}),env,{});
  assert.equal((await worker.fetch(new Request('https://push.invalid/pair',{method:'POST',body:'{}'}),env,{})).status,429);env.close();
});

test('both partners receive personal and shared reminders',()=>{for(const owner of ['rabbit','sweet','together'])assert.deepEqual(reminderRecipients({owner,kind:'daily'}),['rabbit','sweet']);});

test('notification titles identify requests, decisions and calendar reminders',()=>{assert.equal(notificationTitle('leave','leave-request-id'),'🐰 유흥연차 신청');assert.equal(notificationTitle('smoke','smoke-approved-id'),'💨 흡연 결재 승인');assert.equal(notificationTitle('calendar','reminder-id','내일의 기념일\n100일'),'💝 기념일 알림');assert.equal(notificationTitle('calendar','new-id'),'🗓 새 일정');});

test('7-day retention excludes old notifications even after delivery records are removed',()=>{
  const now=Date.parse('2026-12-01T00:00:00Z'),started=Date.parse('2026-10-01T00:00:00Z');
  assert.equal(DELIVERY_RETENTION_MS,7*86400000);
  const cutoff=notificationCutoff(started,now);
  assert.equal(cutoff,Date.parse('2026-11-24T00:00:00Z'));
  assert(Date.parse('2026-10-31T23:59:59Z')<cutoff);
  assert(Date.parse('2026-11-30T00:00:00Z')>=cutoff);
  assert.equal(notificationCutoff(now,now),now);
});

test('hour reminders use Korea time, retry briefly, handle midnight and yearly events',()=>{
  const saved={a:{title:'일정',date:'2026-10-08',time:'00:30',owner:'rabbit'},b:{title:'생일',date:'2025-10-08',time:'00:30',yearly:true},c:{title:'시간 없음',date:'2026-10-08'},d:{title:'잘못된 시간',date:'2026-10-08',time:'25:00'}};
  const at=s=>hourlyReminders(saved,new Date(s+'+09:00'));
  assert.equal(at('2026-10-07T23:29:59').length,0);
  assert.deepEqual(at('2026-10-07T23:30:00').map(e=>e.id),['a','b']);
  assert.equal(at('2026-10-07T23:34:59').length,2);
  assert.equal(at('2026-10-07T23:35:00').length,0);
  assert.equal(at('2026-10-08T00:30:00').length,0);
  assert.equal(notificationTitle('calendar','hour-a'),'⏰ 1시간 전 알림');
});

test('immediate sync runs while cron holds the scan lock and retains delivery deduplication',async()=>{
  const env=environment(),originalFetch=globalThis.fetch;let reads=0;
  await env.DB.prepare("INSERT INTO meta(id,value) VALUES('startedAt',?)").bind(String(Date.now())).run();
  await env.DB.prepare("INSERT INTO meta(id,value) VALUES('syncLease',?)").bind(String(Date.now()+60000)).run();
  globalThis.fetch=async()=>{reads++;return Response.json({});};
  try{await sync(env);assert.equal(reads,0);await sync(env,true);assert.equal(reads,4);}
  finally{globalThis.fetch=originalFetch;env.close();}
});
