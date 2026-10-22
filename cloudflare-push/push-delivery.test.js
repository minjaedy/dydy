import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createECDH, randomBytes, createPublicKey, verify} from 'node:crypto';
import fs from 'node:fs';
import webpush from 'web-push';
import ece from 'http_ece';
import {buildPushRequest} from './web-push.js';
import {send, hash, deliveryContext} from './worker.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const keys = webpush.generateVAPIDKeys();
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const auth = randomBytes(16);
  const subscription = {endpoint:'https://web.push.apple.com/test', keys:{
    p256dh:receiver.getPublicKey().toString('base64url'), auth:auth.toString('base64url')
  }};
  const env = {APP_URL:'https://minjaedy.github.io/dydy/', VAPID_PUBLIC_KEY:keys.publicKey, VAPID_PRIVATE_KEY:keys.privateKey,
    DB:{prepare(query){return {bind(...args){const stmt=db.prepare(query);return {
      first:async()=>stmt.get(...args)||null, all:async()=>({results:stmt.all(...args)}),
      run:async()=>{if(env.failCommit&&query.includes("SET state='sent'"))throw Error('DB commit interrupted');return {meta:stmt.run(...args)};}
    }}}}}
  };
  const addDevice=(id,owner)=>db.prepare('INSERT INTO devices(id,owner,token_hash,subscription,created_at) VALUES(?,?,?,?,?)')
    .run(id,owner,id+'-token',JSON.stringify({...subscription,endpoint:subscription.endpoint+'/'+id}),Date.now());
  addDevice('sweet-phone','sweet');
  return {env,db,receiver,auth,subscription,addDevice};
}

test('native encryption is independently decryptable and VAPID signature verifies',async()=>{
  const f=fixture();
  try{
    const payload=JSON.stringify({title:'🗓 오늘의 일정',body:'구마구마님 · 우리 약속',badge:{owner:'sweet',count:2}});
    const req=await buildPushRequest(f.env,f.subscription,payload,'a'.repeat(64));
    const clear=ece.decrypt(Buffer.from(req.body),{version:'aes128gcm',privateKey:f.receiver,authSecret:f.auth});
    assert.equal(clear.toString(),payload);
    assert.equal(req.headers.Topic,'a'.repeat(32));
    assert.equal(req.headers.TTL,'86400');
    assert.equal(req.body.length,Buffer.byteLength(payload)+103);
    const token=req.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.equal(token[2],f.env.VAPID_PUBLIC_KEY);
    const parts=token[1].split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
    assert.equal(claims.aud,'https://web.push.apple.com');assert.equal(claims.sub,f.env.APP_URL);
    assert(claims.exp>Date.now()/1000&&claims.exp<Date.now()/1000+86400);
    const pub=Buffer.from(f.env.VAPID_PUBLIC_KEY,'base64url');
    const key=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')}});
    assert(verify('SHA256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
    const second=await buildPushRequest(f.env,f.subscription,payload);
    assert.equal(second.headers.Authorization,req.headers.Authorization);
    assert.notDeepEqual(second.body,req.body); // unique salt and ephemeral key per push
    assert.equal(ece.decrypt(Buffer.from(second.body),{version:'aes128gcm',privateKey:f.receiver,authSecret:f.auth}).toString(),payload);
    await assert.rejects(buildPushRequest(f.env,{...f.subscription,endpoint:'https://evil.invalid'},payload),/endpoint/);
    await assert.rejects(buildPushRequest(f.env,f.subscription,'x'.repeat(3994)),/large/);
  }finally{f.db.close();}
});

async function withDelivery(run){
  const f=fixture(),originalFetch=globalThis.fetch;let calls=0;
  f.respond=async()=>new Response(null,{status:201});
  globalThis.fetch=async(...args)=>{calls++;return f.respond(...args)};
  f.calls=()=>calls;
  f.send=(key='reminder-event-2026-10-22-2026-10-22',owner='sweet',context=null)=>send(f.env,owner,key,'오늘의 일정\n약속','calendar',null,context);
  try{await run(f)}finally{globalThis.fetch=originalFetch;f.db.close()}
}
test('repeated and concurrent scans send each notification once per device, independently for both people',()=>withDelivery(async f=>{
  f.addDevice('sweet-desktop','sweet');f.addDevice('rabbit-phone','rabbit');
  await Promise.all([f.send(),f.send(),f.send()]);assert.equal(f.calls(),2);
  await f.send();assert.equal(f.calls(),2);
  await f.send(undefined,'rabbit');assert.equal(f.calls(),3);
  await f.send('hour-event-2026-10-22-12:00');assert.equal(f.calls(),5);
  await f.send('new-event');assert.equal(f.calls(),7);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE state=?').get('sent').n,7);
}));
test('provider acceptance followed by failed database commit never causes another push',()=>withDelivery(async f=>{
  f.env.failCommit=true;await assert.rejects(f.send(),/delivery failed/);assert.equal(f.calls(),1);
  assert.equal(f.db.prepare('SELECT state FROM deliveries').get().state,'uncertain');
  f.env.failCommit=false;f.db.exec('UPDATE deliveries SET lease_until=0');
  await f.send();assert.equal(f.calls(),1);
  assert.equal(f.db.prepare('SELECT read_at FROM notification_inbox').get().read_at,null);
}));
test('a hard-killed dispatch remains non-retryable after its lease expires',()=>withDelivery(async f=>{
  const id=await hash('sweet-phone|reminder-event-2026-10-22-2026-10-22');
  f.db.prepare("INSERT INTO deliveries(id,state,lease_until,created_at) VALUES(?,'dispatching',0,?)").run(id,Date.now());
  await f.send();assert.equal(f.calls(),0);
}));
test('a transport timeout is ambiguous and does not replay; explicit rejection retries after backoff',()=>withDelivery(async f=>{
  f.respond=async()=>{throw new DOMException('Timed out','TimeoutError')};
  await assert.rejects(f.send());assert.equal(f.calls(),1);
  await f.send();assert.equal(f.calls(),1);
  f.respond=async()=>new Response(null,{status:503});
  await assert.rejects(f.send('new-rejected'));assert.equal(f.calls(),2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE state='failed'").get().n,1);
  await f.send('new-rejected');assert.equal(f.calls(),2);
  f.db.exec("UPDATE deliveries SET lease_until=0 WHERE state='failed'");
  f.respond=async()=>new Response(null,{status:201});
  await f.send('new-rejected');assert.equal(f.calls(),3);
  await f.send('new-rejected');assert.equal(f.calls(),3);
}));
test('stale preparation is recoverable, but a read notification is never resurrected',()=>withDelivery(async f=>{
  const id=await hash('sweet-phone|reminder-event-2026-10-22-2026-10-22');
  f.db.prepare("INSERT INTO deliveries(id,state,lease_until,created_at) VALUES(?,'sending',0,?)").run(id,Date.now());
  await f.send();assert.equal(f.calls(),1);
  f.db.exec('UPDATE notification_inbox SET read_at=1');
  f.addDevice('new-device','sweet');await f.send();assert.equal(f.calls(),1);
}));
test('expired subscriptions are removed and one failed device does not block others',()=>withDelivery(async f=>{
  f.addDevice('sweet-desktop','sweet');
  f.respond=async url=>new Response(null,{status:url.endsWith('sweet-phone')?410:201});
  await f.send();assert.equal(f.calls(),2);
  assert.equal(f.db.prepare("SELECT subscription FROM devices WHERE id='sweet-phone'").get().subscription,null);
  f.respond=async()=>new Response(null,{status:201});
  await f.send();assert.equal(f.calls(),2);
}));
test('settled scan snapshot skips database writes but does not swallow new notifications or devices',()=>withDelivery(async f=>{
  await f.send();const context=await deliveryContext(f.env);
  const prepare=f.env.DB.prepare;f.env.DB.prepare=()=>{throw Error('Completed notification queried again')};
  await f.send(undefined,'sweet',context);assert.equal(f.calls(),1);
  f.env.DB.prepare=prepare;
  await f.send('hour-new-event','sweet',context);assert.equal(f.calls(),2);
  f.addDevice('sweet-desktop','sweet');
  await f.send(undefined,'sweet',await deliveryContext(f.env));assert.equal(f.calls(),3);
}));
test('one rejected device does not block the other device, and retries skip the successful one',()=>withDelivery(async f=>{
  f.addDevice('sweet-desktop','sweet');
  f.respond=async url=>new Response(null,{status:url.endsWith('sweet-phone')?503:201});
  await assert.rejects(f.send());assert.equal(f.calls(),2);
  f.db.exec("UPDATE deliveries SET lease_until=0 WHERE state='failed'");
  f.respond=async()=>new Response(null,{status:201});
  await f.send();assert.equal(f.calls(),3);
}));
test('a read arriving during encryption prevents dispatch',()=>withDelivery(async f=>{
  const prepare=f.env.DB.prepare;
  f.env.DB.prepare=query=>{
    if(query.includes("SET state='dispatching'"))f.db.exec('UPDATE notification_inbox SET read_at=1');
    return prepare(query);
  };
  await f.send();assert.equal(f.calls(),0);
}));
