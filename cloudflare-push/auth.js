import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
const people=['rabbit','sweet'];
const query=(env,s,...a)=>env.DB.prepare(s).bind(...a);
const digest=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const names={rabbit:'이토끼',sweet:'구마구마'};
export function legacyHash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h*33)^s.charCodeAt(i))>>>0;return h.toString(16);}
async function passwordVersion(owner){
 const url=owner==='sweet'?'https://dydy-96bb1-default-rtdb.firebaseio.com/leave_app_v2/adminPasswordHash.json':'https://smoke-a9b2e-default-rtdb.firebaseio.com/smoke_app_v1/adminPasswordHash.json';
 const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('인증 서버에 연결하지 못했어요.');return r.json();
}
async function rate(env,request){const key='auth-'+await digest(request.headers.get('CF-Connecting-IP')||'unknown')+'-'+Math.floor(Date.now()/600000);await query(env,'INSERT INTO pairing_attempts(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',key,Date.now()+600000).run();return (await query(env,'SELECT count FROM pairing_attempts WHERE id=?',key).first()).count<=30;}
async function issue(env,owner,version){const token=crypto.randomUUID()+crypto.randomUUID(),expires=Date.now()+12*3600000;await query(env,'INSERT INTO auth_sessions(token_hash,owner,version,expires) VALUES(?,?,?,?)',await digest(token),owner,await digest(version),expires).run();return {token,owner,expires};}
export async function session(env,request){const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';if(token.length<32)return null;const s=await query(env,'SELECT * FROM auth_sessions WHERE token_hash=? AND expires>?',await digest(token),Date.now()).first();if(!s)return null;const v=await passwordVersion(s.owner);return v&&await digest(v)===s.version?s:null;}
async function challenge(env,owner,kind,value,version){const id=crypto.randomUUID();await query(env,'INSERT INTO auth_challenges(id,owner,kind,challenge,version,expires) VALUES(?,?,?,?,?,?)',id,owner,kind,value,version,Date.now()+300000).run();return id;}
async function consume(env,id,owner,kind){return query(env,'DELETE FROM auth_challenges WHERE id=? AND owner=? AND kind=? AND expires>? RETURNING *',id,owner,kind,Date.now()).first();}
export async function authRoute(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/auth/'))return null;
 if(request.method!=='POST')return json({error:'지원하지 않는 요청이에요.'},405);
 if(!await rate(env,request))return json({error:'잠시 후 다시 시도해 주세요.'},429);
 try{
 const b=await request.json(),owner=b.owner;
 if(!people.includes(owner))return json({error:'사용자를 선택해 주세요.'},400);
 const rpID=new URL(env.APP_ORIGIN).hostname;
 if(path==='/auth/password'){
  if(typeof b.password!=='string'||b.password.length>200)return json({error:'암호를 확인해 주세요.'},400);
  const v=await passwordVersion(owner);
  if(!v)return json({error:'먼저 해당 결재함에서 관리자 암호를 설정해 주세요.'},409);
  if(legacyHash(b.password)!==v)return json({error:'관리자 암호가 맞지 않아요.'},403);
  return json(await issue(env,owner,v));
 }
 if(path==='/auth/register/options'){
  const current=await session(env,request);if(!current||current.owner!==owner)return json({error:'관리자 암호로 먼저 인증해 주세요.'},401);
  const existing=(await query(env,'SELECT id FROM passkeys WHERE owner=?',owner).all()).results;
  const options=await generateRegistrationOptions({rpName:'토끼와 구마',rpID,userName:names[owner],userDisplayName:names[owner],userID:new TextEncoder().encode('couple-'+owner),attestationType:'none',excludeCredentials:existing.map(x=>({id:x.id})),authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'}});
  return json({options,challengeId:await challenge(env,owner,'register',options.challenge,current.version)});
 }
 if(path==='/auth/register/verify'){
  const current=await session(env,request);if(!current||current.owner!==owner)return json({error:'다시 인증해 주세요.'},401);
  const c=await consume(env,b.challengeId,owner,'register');if(!c||c.version!==current.version)return json({error:'인증 시간이 지났어요. 다시 시도해 주세요.'},400);
  const v=await verifyRegistrationResponse({response:b.response,expectedChallenge:c.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:rpID,requireUserVerification:true});
  if(!v.verified)return json({error:'패스키를 확인하지 못했어요.'},403);
  const cred=v.registrationInfo.credential;
  await query(env,'INSERT INTO passkeys(id,owner,public_key,counter,transports,version) VALUES(?,?,?,?,?,?)',cred.id,owner,Buffer.from(cred.publicKey).toString('base64'),cred.counter,JSON.stringify(cred.transports||[]),current.version).run();return json({ok:true});
 }
 if(path==='/auth/login/options'){
  const version=await passwordVersion(owner);if(!version)return json({error:'먼저 관리자 암호를 설정해 주세요.'},409);
  const hashed=await digest(version),keys=(await query(env,'SELECT id,transports FROM passkeys WHERE owner=? AND version=?',owner,hashed).all()).results;
  if(!keys.length)return json({error:'등록한 패스키가 없어요. 관리자 암호로 들어간 뒤 등록해 주세요.'},404);
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
  return json({options,challengeId:await challenge(env,owner,'login',options.challenge,hashed)});
 }
 if(path==='/auth/login/verify'){
  const c=await consume(env,b.challengeId,owner,'login');if(!c)return json({error:'인증 시간이 지났어요.'},400);
  const k=await query(env,'SELECT * FROM passkeys WHERE id=? AND owner=? AND version=?',b.response?.id||'',owner,c.version).first();
  const version=await passwordVersion(owner);if(!k||!version||await digest(version)!==c.version)return json({error:'다시 암호로 인증해 주세요.'},403);
  const result=await verifyAuthenticationResponse({response:b.response,expectedChallenge:c.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:rpID,credential:{id:k.id,publicKey:new Uint8Array(Buffer.from(k.public_key,'base64')),counter:k.counter,transports:JSON.parse(k.transports)},requireUserVerification:true});
  if(!result.verified)return json({error:'인증하지 못했어요.'},403);
  await query(env,'UPDATE passkeys SET counter=? WHERE id=?',result.authenticationInfo.newCounter,k.id).run();return json(await issue(env,owner,version));
 }
 if(path==='/auth/logout'){const t=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';await query(env,'DELETE FROM auth_sessions WHERE token_hash=?',await digest(t)).run();return json({ok:true});}
 return json({error:'지원하지 않는 요청이에요.'},404);
 }catch{return json({error:'인증을 완료하지 못했어요. 다시 시도해 주세요.'},400);}
}
export async function cleanAuth(env){await query(env,'DELETE FROM auth_sessions WHERE expires<?',Date.now()).run();await query(env,'DELETE FROM auth_challenges WHERE expires<?',Date.now()).run();}
