import webpush from 'web-push';
import specialDays from './special-days.json' with {type:'json'};
const PEOPLE = ['rabbit', 'sweet'];
const DATABASES = {calendar:'https://dydy-96bb1-default-rtdb.firebaseio.com/couple_calendar_v1/events.json',leave:'https://dydy-96bb1-default-rtdb.firebaseio.com/leave_app_v2.json',smoke:'https://smoke-a9b2e-default-rtdb.firebaseio.com/smoke_app_v1.json'};
export const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const sql = (env,q,...args) => env.DB.prepare(q).bind(...args);
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const dateKey = now => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function anniversaries(year) {
  const events=specialDays.map(([md,title,owner='together'])=>({id:'auto-'+year+'-'+md+'-'+title,title,date:year+'-'+md,owner,kind:'anniversary'}));
  if(year>=2026)events.push({id:'year-'+year,title:year===2026?'우리의 첫날':(year-2026)+'주년',date:year+'-02-18',owner:'together',kind:'anniversary'});
  const start=Date.parse('2026-02-18T00:00:00Z');
  for(let days=100;start+(days-1)*86400000<=Date.parse(year+'-12-31');days+=100){const date=new Date(start+(days-1)*86400000).toISOString().slice(0,10);if(date.startsWith(String(year)))events.push({id:'days-'+days,title:days+'일',date,owner:'together',kind:'anniversary'});}
  return events;
}
export function reminderRecipients(){ return [...PEOPLE]; }
export function reminders(saved,today) {
  const tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10),result=[];
  for(const [id,e] of Object.entries(saved||{})){
    if(!e||typeof e.title!=='string')continue;
    for(const date of [today,tomorrow])if((e.date===date||(e.yearly===true&&e.date<=date&&e.date.slice(5)===date.slice(5)))&&(date===today||e.kind==='anniversary'))result.push({...e,id,date});
  }
  const titleKey=s=>s.replace(/[♥♡🎂\s]/gu,'').replace(/^우리의?/,'').replace(/^토끼생일$/,'이토끼생일').replace(/^(구마|고구마)생일$/,'구마구마생일');
  for(const year of new Set([+today.slice(0,4),+tomorrow.slice(0,4)]))for(const e of anniversaries(year))if([today,tomorrow].includes(e.date)&&!result.some(x=>x.date===e.date&&titleKey(x.title)===titleKey(e.title)))result.push(e);
  return result;
}
async function read(url){const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Database unavailable');return await r.json();}
async function device(env,request){const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';if(token.length<32)return null;return sql(env,'SELECT id,owner FROM devices WHERE token_hash=?',await hash(token)).first();}
function validSubscription(s){if(!s||typeof s.endpoint!=='string'||!s.keys)return false;try{const u=new URL(s.endpoint);return u.protocol==='https:'&&['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host))&&typeof s.keys.p256dh==='string'&&typeof s.keys.auth==='string'&&s.keys.p256dh.length<200&&s.keys.auth.length<100;}catch{return false;}}
export function notificationTitle(screen,key,body=''){
  if(screen==='leave'||screen==='smoke'){
    const label=screen==='leave'?'🐰 유흥연차':'💨 흡연 결재';
    return label+' '+(key.includes('-approved-')?'승인':key.includes('-rejected-')?'반려':'신청');
  }
  if(screen==='calendar')return key.startsWith('new-')?'🗓 새 일정':body.split('\n')[0].includes('기념일')?'💝 기념일 알림':'🗓 오늘의 일정';
  return '🐰🍠 앱 알림 연결';
}
async function send(env,owner,key,body,screen,deviceId=null){
  const devices=(await sql(env,'SELECT id,subscription FROM devices WHERE owner=? AND subscription IS NOT NULL',owner).all()).results;
  for(const d of devices){
    if(deviceId&&d.id!==deviceId)continue;
    const id=await hash(d.id+'|'+key),now=Date.now();
    const claim=await sql(env,"INSERT INTO deliveries(id,state,lease_until) VALUES(?,'sending',?) ON CONFLICT(id) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?",id,now+120000,now).run();
    if(!claim.meta.changes)continue;
    let stage='prepare';
    try{
      const req=webpush.generateRequestDetails(JSON.parse(d.subscription),JSON.stringify({title:notificationTitle(screen,key,body),body,screen,tag:key}),{TTL:86400,vapidDetails:{subject:env.APP_URL,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}});
      stage='transport';
      const res=await fetch(req.endpoint,{method:'POST',headers:req.headers,body:req.body,redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(res.status===404||res.status===410){await sql(env,'UPDATE devices SET subscription=NULL WHERE id=?',d.id).run();}
      else if(!res.ok){const detail=await res.text();let reason='';try{reason=JSON.parse(detail).reason||'';}catch{}stage='provider-'+res.status+'-'+(/^[A-Za-z_]{1,60}$/.test(reason)?reason:'rejected');throw Error('Push provider rejected request');}
      await sql(env,"UPDATE deliveries SET state='sent',lease_until=0,sent_at=? WHERE id=?",now,id).run();
    }catch(error){const detail=String(error?.message||'').replace(/https?:\/\/\S+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[REDACTED]').slice(0,160);const kind=stage+'-'+(error?.name||'Error')+': '+detail;await sql(env,"UPDATE deliveries SET state='failed',lease_until=0,last_error=? WHERE id=?",kind,id).run();console.error('Push failed:',kind);throw Error('Push delivery failed');}
  }
}
async function scan(env){
  // No tokens or message bodies are logged.
  const [calendar,leave,smoke,preferences]=await Promise.all([read(DATABASES.calendar),read(DATABASES.leave),read(DATABASES.smoke),read('https://dydy-96bb1-default-rtdb.firebaseio.com/couple_home_v1/preferences.json')]);
  const baseline=await sql(env,"SELECT value FROM meta WHERE id='startedAt'").first();
  if(!baseline){await sql(env,"INSERT OR IGNORE INTO meta(id,value) VALUES('startedAt',?)",String(Date.now())).run();return;}
  const started=Number(baseline.value),names={rabbit:'이토끼님',sweet:'구마구마님'};
  for(const [id,e] of Object.entries(calendar||{}))if(e&&e.createdAt>=started&&PEOPLE.includes(e.createdBy)){
    const owner=e.createdBy==='rabbit'?'sweet':'rabbit';
    if(preferences?.[owner]?.newEvents!==false)await send(env,owner,'new-'+id,names[e.createdBy]+'이 새 일정을 남겼어요.\n'+String(e.title).slice(0,80),'calendar');
  }
  for(const [type,data,applicant,approver] of [['leave',leave,'rabbit','sweet'],['smoke',smoke,'sweet','rabbit']])for(const r of Object.values(data?.requests||{})){
    if(!r?.id)continue;const label=type==='leave'?'유흥연차':'흡연 결재';
    if(Date.parse(r.submittedAt)>=started)await send(env,approver,type+'-request-'+r.id,names[applicant]+'이 '+label+'를 신청했어요.',type);
    if(['approved','rejected'].includes(r.status)&&Date.parse(r.decidedAt)>=started)await send(env,applicant,type+'-'+r.status+'-'+r.id+'-'+r.decidedAt,names[approver]+'이 '+label+'를 '+(r.status==='approved'?'승인':'반려')+'했어요.',type);
  }
  const now=new Date(),today=dateKey(now),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour>=9&&hour<12)for(const e of reminders(calendar,today))for(const owner of reminderRecipients(e)){
    if(preferences?.[owner]?.[e.kind]===false)continue;
    await send(env,owner,'reminder-'+e.id+'-'+e.date+'-'+today,(e.date===today?'오늘':'내일')+'의 '+(e.kind==='anniversary'?'기념일':'일정')+'\n'+(names[e.owner]?names[e.owner]+' · ':'함께 · ')+e.title+(e.time?' · '+e.time:''),'calendar');
  }
  await sql(env,'DELETE FROM pairing_attempts WHERE expires<?',Date.now()).run();
  await sql(env,'DELETE FROM deliveries WHERE sent_at<?',Date.now()-90*86400000).run();
}
export async function sync(env){
  const now=Date.now();
  const lock=await sql(env,"INSERT INTO meta(id,value) VALUES('syncLease',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER)<?",String(now+60000),now).run();
  if(!lock.meta.changes)return;
  try{await scan(env);}finally{await sql(env,"UPDATE meta SET value='0' WHERE id='syncLease'").run();}
}
export default {
  async fetch(request,env,ctx){
    const origin=request.headers.get('Origin'),headers={'Access-Control-Allow-Origin':env.APP_ORIGIN,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
    if(origin&&origin!==env.APP_ORIGIN)return json({error:'Origin not allowed'},403);
    let response;
    try{
      const path=new URL(request.url).pathname;
      if(request.method==='OPTIONS')response=new Response(null,{status:204});
      else if(path==='/health'&&request.method==='GET'){await sql(env,'SELECT 1').first();await read(DATABASES.calendar);response=json({ok:true,database:true});}
      else if(path==='/config'&&request.method==='GET')response=json({publicKey:env.VAPID_PUBLIC_KEY});
      else if(path==='/pair'&&request.method==='POST'){
        const ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown'),bucket=ip+'-'+Math.floor(Date.now()/3600000);
        await sql(env,'INSERT INTO pairing_attempts(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',bucket,Date.now()+3600000).run();
        const attempt=await sql(env,'SELECT count FROM pairing_attempts WHERE id=?',bucket).first();
        if(attempt.count>10)return json({error:'잠시 후 다시 시도해 주세요.'},429);
        const body=await request.json(),owner=body.owner;
        if(!PEOPLE.includes(owner)||typeof body.code!=='string'||body.code.length>100||await hash(body.code)!==env[owner==='rabbit'?'RABBIT_PAIR_HASH':'SWEET_PAIR_HASH'])response=json({error:'연결 코드를 확인해 주세요.'},403);
        else{const token=crypto.randomUUID()+crypto.randomUUID(),id=crypto.randomUUID();await sql(env,'INSERT INTO devices(id,owner,token_hash,created_at) VALUES(?,?,?,?)',id,owner,await hash(token),Date.now()).run();response=json({token,owner});}
      }else{
        const current=await device(env,request);
        if(!current)response=json({error:'기기를 먼저 연결해 주세요.'},401);
        else if(path==='/subscription'&&request.method==='POST'){
          const body=await request.json();if(!validSubscription(body))response=json({error:'지원하지 않는 알림 주소예요.'},400);
          else{await sql(env,'UPDATE devices SET subscription=? WHERE id=?',JSON.stringify(body),current.id).run();response=json({ok:true});}
        }else if(path==='/subscription'&&request.method==='DELETE'){await sql(env,'UPDATE devices SET subscription=NULL WHERE id=?',current.id).run();response=json({ok:true});}
        else if(path==='/sync'&&request.method==='POST'){ctx.waitUntil(sync(env));response=json({ok:true},202);}
        else if(path==='/test'&&request.method==='POST'){await send(env,current.owner,'test-'+crypto.randomUUID(),'토끼와 구마의 앱 알림이 연결됐어요 ♥','home',current.id);response=json({ok:true});}
        else response=json({error:'Not found'},404);
      }
    }catch{response=json({error:'연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},500);}
    return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  },
  async scheduled(event,env,ctx){ctx.waitUntil(sync(env));}
};
