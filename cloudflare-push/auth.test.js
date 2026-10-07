import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {encodeCBOR} from '@levischuck/tiny-cbor';
import {authRoute,legacyHash,nextKoreanMidnight} from './auth.js';
const b64=b=>Buffer.from(b).toString('base64url');
function env(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));return {APP_ORIGIN:'https://minjaedy.github.io',db,DB:{prepare(s){return {bind(...a){const q=db.prepare(s);return {first:async()=>q.get(...a)||null,all:async()=>({results:q.all(...a)}),run:async()=>({meta:q.run(...a)})};}}}}};}
test('password bootstrap, verified passkey enrollment and login; owner binding, replay and password rotation',async()=>{
 const e=env(),original=globalThis.fetch;let password='example-password';globalThis.fetch=async()=>Response.json(legacyHash(password));
 const call=async(path,body={},token)=>{const r=await authRoute(new Request('https://worker.invalid/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({owner:'rabbit',...body})}),e);return {status:r.status,body:await r.json()};};
 try{
 assert.equal((await call('register/options')).status,401);
 assert.equal((await call('password',{password:'wrong'})).status,403);
 const session=(await call('password',{password})).body;assert(session.token);assert.equal(session.owner,'rabbit');assert.equal(session.expires,nextKoreanMidnight());assert.equal((await call('session',{},session.token)).status,200);assert.equal((await call('session',{owner:'sweet'},session.token)).status,401);
 assert.equal((await call('register/options',{owner:'sweet'},session.token)).status,401);
 const reg=(await call('register/options',{},session.token)).body;
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});
 const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const id=Buffer.from('test-credential-id'),rpHash=createHash('sha256').update('minjaedy.github.io').digest(),len=Buffer.alloc(2);len.writeUInt16BE(id.length);
 const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:reg.options.challenge,origin:e.APP_ORIGIN}));
 const authData=Buffer.concat([rpHash,Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),len,id,Buffer.from(cose)]);
 const response={id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),attestationObject:b64(encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData)]]))),transports:['internal']}};
 assert.equal((await call('register/verify',{response,challengeId:reg.challengeId},session.token)).status,200);
 assert.equal((await call('register/verify',{response,challengeId:reg.challengeId},session.token)).status,400);
 const login=(await call('login/options')).body;
 const client2=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:login.options.challenge,origin:e.APP_ORIGIN})),counter=Buffer.alloc(4);counter.writeUInt32BE(1);
 const data=Buffer.concat([rpHash,Buffer.from([0x05]),counter]),signature=sign('sha256',Buffer.concat([data,createHash('sha256').update(client2).digest()]),privateKey);
 const assertion={id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client2),authenticatorData:b64(data),signature:b64(signature)}};
 const verified=await call('login/verify',{response:assertion,challengeId:login.challengeId});assert.equal(verified.status,200);assert.equal(verified.body.owner,'rabbit');
 assert.equal((await call('login/verify',{response:assertion,challengeId:login.challengeId})).status,400);
 e.db.prepare('UPDATE auth_sessions SET expires=? WHERE owner=?').run(Date.now()-1,'rabbit');assert.equal((await call('session',{},session.token)).status,401);password='rotated-password';assert.equal((await call('register/options',{},session.token)).status,401);assert.equal((await call('login/options')).status,404);
 }finally{globalThis.fetch=original;e.db.close();}
});

test('daily authentication expires at Korean midnight across UTC date boundaries',()=>{assert.equal(new Date(nextKoreanMidnight(Date.parse('2026-10-07T14:59:00Z'))).toISOString(),'2026-10-07T15:00:00.000Z');assert.equal(new Date(nextKoreanMidnight(Date.parse('2026-10-07T15:00:00Z'))).toISOString(),'2026-10-08T15:00:00.000Z')});
