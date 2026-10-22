import {createPrivateKey,sign} from 'node:crypto';
const cache=new Map();
const refreshing=new Map();
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function credentials(env,project){const raw=env[project==='smoke-a9b2e'?'FIREBASE_SMOKE_ACCOUNT':'FIREBASE_DYDY_ACCOUNT'];return raw?JSON.parse(raw):null;}
export function signedJwt(account,payload){const value=encode({alg:'RS256',typ:'JWT'})+'.'+encode(payload);return value+'.'+sign('RSA-SHA256',Buffer.from(value),createPrivateKey(account.private_key)).toString('base64url');}
export function customFirebaseToken(env,project,owner,expires){
 const account=credentials(env,project);if(!account)throw Error('Firebase credentials unavailable');
 const now=Math.floor(Date.now()/1000);
 return signedJwt(account,{iss:account.client_email,sub:account.client_email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:'couple-'+owner,claims:{couple_owner:owner,session_until:expires}});
}
export async function signedServerJwt(account,payload){
 const value=encode({alg:'RS256',typ:'JWT'})+'.'+encode(payload);
 const der=Buffer.from(account.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64');
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(value));
 return value+'.'+Buffer.from(signature).toString('base64url');
}
async function refreshToken(account){
 const now=Math.floor(Date.now()/1000),assertion=await signedServerJwt(account,{iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Firebase server authentication failed');const data=await r.json();
 const value={token:data.access_token,expires:Date.now()+data.expires_in*1000};cache.set(account.client_email,value);return value;
}
export async function firebaseFetch(env,url,options={}){
 const parsed=new URL(url),project=parsed.hostname.startsWith('smoke-a9b2e-')?'smoke-a9b2e':'dydy-96bb1';
 if(!['smoke-a9b2e-default-rtdb.firebaseio.com','dydy-96bb1-default-rtdb.firebaseio.com'].includes(parsed.hostname))throw Error('Unsupported Firebase database');
 const account=credentials(env,project);
 // Local unit tests have no service account. Production always has both secrets.
 if(!account)return fetch(url,options);
 let value=cache.get(account.client_email);
 if(!value||value.expires<Date.now()+60000){
  let pending=refreshing.get(account.client_email);
  if(!pending){pending=refreshToken(account).finally(()=>refreshing.delete(account.client_email));refreshing.set(account.client_email,pending);}
  value=await pending;
 }
 return fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+value.token}});
}
