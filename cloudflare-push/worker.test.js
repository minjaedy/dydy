import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{hash,reminders,anniversaries,reminderRecipients} from './worker.js';

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
