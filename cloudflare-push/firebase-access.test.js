import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {customFirebaseToken,firebaseFetch} from './firebase-access.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const account={client_email:'couple-server@test.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
test('custom Firebase credentials bind identity, session deadline and intended audience with valid signature',()=>{const env={FIREBASE_DYDY_ACCOUNT:JSON.stringify(account)};const token=customFirebaseToken(env,'dydy-96bb1','sweet',1234567890123);const [header,payload,signature]=token.split('.');const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.uid,'couple-sweet');assert.equal(claims.claims.session_until,1234567890123);assert.equal(claims.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');assert(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')));assert.throws(()=>customFirebaseToken({},'dydy-96bb1','rabbit',1));});
test('server bridge rejects database URLs outside the two configured projects',async()=>{await assert.rejects(firebaseFetch({},'https://attacker.invalid/.json'));});
