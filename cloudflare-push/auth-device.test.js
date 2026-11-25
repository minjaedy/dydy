import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {authRoute,legacyHash,cleanAuth,nextKoreanMidnight} from './auth.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const env={APP_ORIGIN:'https://minjaedy.github.io',DB:{prepare(s){return{bind(...a){const q=db.prepare(s);return{first:async()=>q.get(...a)||null,all:async()=>({results:q.all(...a)}),run:async()=>({meta:q.run(...a)})};}}}}};
 const call=async(path,owner='rabbit',token,extra={})=>{
  const response=await authRoute(new Request('https://test/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({owner,...extra})}),env);
  return{status:response.status,...await response.json()};
 };
 return {db,env,call};
}
test('remembered devices renew daily sessions without WebAuthn; owner binding and password revocation remain enforced',async()=>{
 const {db,env,call}=setup(),original=globalThis.fetch;let version=legacyHash('test-pass');globalThis.fetch=async()=>Response.json(version);
 try{
  db.exec('DROP TABLE auth_devices');
  for(const path of ['restore','remember','device'])assert.equal((await call(path)).status,401);
  const initial=await call('password','rabbit',null,{password:'test-pass'});
  const remembered=await call('remember','rabbit',initial.token);
  assert.equal(remembered.status,200);assert.notEqual(remembered.token,initial.token);
  const saved=db.prepare('SELECT * FROM auth_devices').get();assert.equal(saved.token_hash,digest(remembered.token));assert.equal(saved.owner,'rabbit');
  assert.equal((await call('restore','sweet',remembered.token)).status,401);
  assert.equal((await call('session','rabbit',remembered.token)).status,401);
  db.prepare('UPDATE auth_sessions SET expires=?').run(Date.now()-1);await cleanAuth(env);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_devices').get().n,1);
  const next=await call('restore','rabbit',remembered.token);assert.equal(next.status,200);assert.equal(next.expires,nextKoreanMidnight());
  assert.equal((await call('session','rabbit',next.token)).status,200);assert.equal((await call('session','sweet',next.token)).status,401);
  version=legacyHash('changed-pass');
  assert.equal((await call('restore','rabbit',remembered.token)).status,401);assert.equal((await call('session','rabbit',next.token)).status,401);
 }finally{globalThis.fetch=original;db.close();}
});
test('existing paired devices enter only as their owner, and cannot bypass revoked remembered access',async()=>{
 const {db,call}=setup(),original=globalThis.fetch;let version=legacyHash('test-pass');globalThis.fetch=async()=>Response.json(version);
 const paired='registered-device-secret-'.repeat(3);
 db.prepare('INSERT INTO devices(id,owner,token_hash,created_at) VALUES(?,?,?,?)').run('paired-phone','sweet',digest(paired),Date.now());
 try{
  assert.equal((await call('device','rabbit',paired)).status,401);
  assert.equal((await call('device','sweet','forged-device'.repeat(5))).status,401);
  const result=await call('device','sweet',paired);assert.equal(result.status,200);assert.equal(result.owner,'sweet');assert(result.remembered.token);
  assert.equal((await call('restore','sweet',result.remembered.token)).status,200);
  assert.equal((await call('logout','rabbit',result.token,{rememberToken:result.remembered.token})).status,401);
  assert.equal((await call('logout','sweet',result.token,{rememberToken:result.remembered.token})).status,200);
  assert.equal((await call('restore','sweet',result.remembered.token)).status,401);
  assert.equal((await call('device','sweet',paired)).status,401);
  assert.equal(db.prepare('SELECT count(*) AS n FROM devices').get().n,1);
  const reconnected=await call('password','sweet',null,{password:'test-pass'});
  const remembered=await call('remember','sweet',reconnected.token);assert.equal((await call('restore','sweet',remembered.token)).status,200);
 }finally{globalThis.fetch=original;db.close();}
});
test('password change or deleting the original paired device prevents its silent login',async()=>{
 const {db,call}=setup(),original=globalThis.fetch;let version=legacyHash('first');globalThis.fetch=async()=>Response.json(version);
 const token='paired-rabbit-token-'.repeat(4);
 db.prepare('INSERT INTO devices(id,owner,token_hash,created_at) VALUES(?,?,?,?)').run('phone','rabbit',digest(token),Date.now());
 try{
  const entered=await call('device','rabbit',token);assert.equal(entered.status,200);
  version=legacyHash('new');assert.equal((await call('device','rabbit',token)).status,401);
  assert.equal((await call('restore','rabbit',entered.remembered.token)).status,401);
  version=legacyHash('first');db.prepare('DELETE FROM devices').run();assert.equal((await call('restore','rabbit',entered.remembered.token)).status,401);
 }finally{globalThis.fetch=original;db.close();}
});
