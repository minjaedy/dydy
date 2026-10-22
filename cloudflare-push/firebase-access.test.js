import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {customFirebaseToken,firebaseFetch,signedServerJwt} from './firebase-access.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const account={client_email:'couple-server@test.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
test('custom Firebase credentials bind identity, session deadline and intended audience with valid signature',()=>{const env={FIREBASE_DYDY_ACCOUNT:JSON.stringify(account)};const token=customFirebaseToken(env,'dydy-96bb1','sweet',1234567890123);const [header,payload,signature]=token.split('.');const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.uid,'couple-sweet');assert.equal(claims.claims.session_until,1234567890123);assert.equal(claims.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');assert(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')));assert.throws(()=>customFirebaseToken({},'dydy-96bb1','rabbit',1));});
test('server bridge rejects database URLs outside the two configured projects',async()=>{await assert.rejects(firebaseFetch({},'https://attacker.invalid/.json'));});
test('native server JWT verifies and concurrent database reads share one OAuth refresh',async()=>{
 const jwt=await signedServerJwt(account,{iss:account.client_email,aud:'test'}),[header,payload,signature]=jwt.split('.');
 assert(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')));
 const originalFetch=globalThis.fetch;let oauth=0,reads=0;
 globalThis.fetch=async(url,options)=>{
  if(url==='https://oauth2.googleapis.com/token'){oauth++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({access_token:'unit-test-token',expires_in:3600})}
  reads++;assert.equal(options.headers.Authorization,'Bearer unit-test-token');return Response.json({});
 };
 try{
  const env={FIREBASE_DYDY_ACCOUNT:JSON.stringify(account)},url='https://dydy-96bb1-default-rtdb.firebaseio.com/test.json';
  await Promise.all([firebaseFetch(env,url),firebaseFetch(env,url),firebaseFetch(env,url)]);
  assert.equal(oauth,1);assert.equal(reads,3);
  await firebaseFetch(env,url);assert.equal(oauth,1);assert.equal(reads,4);
 }finally{globalThis.fetch=originalFetch}
});
