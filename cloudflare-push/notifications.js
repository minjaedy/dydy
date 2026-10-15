import {firebaseFetch} from './firebase-access.js';
export const NOTICE_RETENTION_MS=30*86400000;
const people=new Set(['rabbit','sweet']);
const screens=new Set(['home','calendar','leave','smoke','travel','chat']);
const sql=(env,q,...args)=>env.DB.prepare(q).bind(...args);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const tagsOf=value=>Array.isArray(value)?[...new Set(value.filter(x=>typeof x==='string'&&x.length>0&&x.length<=240))].slice(0,260):[];
export async function signalNotifications(env,owner){
  if(!people.has(owner)||!env.FIREBASE_DYDY_ACCOUNT)return;
  // Only an invalidation hint; the authenticated D1 endpoint is authoritative.
  // Two fixed leaves, no growing event log and no message content in Firebase.
  try{await firebaseFetch(env,'https://dydy-96bb1-default-rtdb.firebaseio.com/couple_home_v1/notificationSignals/'+owner+'.json',{method:'PUT',body:JSON.stringify(crypto.randomUUID()),signal:AbortSignal.timeout(5000)});}catch{}
}
export async function recordNotification(env,owner,tag,title,body,screen,detail=null,at=Date.now(),read=false){
  if(!people.has(owner)||!screens.has(screen))throw Error('Invalid notification owner or screen');
  // Cron revisits the same events. Avoid an AUTOINCREMENT write for every retry.
  const notice=await sql(env,'SELECT seq,created_at,read_at FROM notification_inbox WHERE owner=? AND tag=?',owner,tag).first();
  if(notice)return {meta:{changes:0},notice};
  return sql(env,'INSERT OR IGNORE INTO notification_inbox(owner,tag,screen,title,body,detail,created_at,read_at) VALUES(?,?,?,?,?,?,?,?)',owner,tag,screen,title.slice(0,120),body.slice(0,300),detail?JSON.stringify(detail):null,at,read?Date.now():null).run();
}
export async function notificationBadge(env,owner){
  return sql(env,'SELECT ? AS owner,COALESCE((SELECT version FROM notification_versions WHERE owner=?),0) AS version,COUNT(CASE WHEN read_at IS NULL AND created_at>=? THEN 1 END) AS count,COALESCE(MAX(seq),0) AS through FROM notification_inbox WHERE owner=?',owner,owner,Date.now()-NOTICE_RETENTION_MS,owner).first();
}
async function state(env,owner,keys=[]){
  const cutoff=Date.now()-NOTICE_RETENTION_MS;
  const queries=[sql(env,'SELECT ? AS owner,COALESCE((SELECT version FROM notification_versions WHERE owner=?),0) AS version,COUNT(CASE WHEN read_at IS NULL AND created_at>=? THEN 1 END) AS count,COALESCE(MAX(seq),0) AS through FROM notification_inbox WHERE owner=?',owner,owner,cutoff,owner),sql(env,'SELECT seq,tag,screen,title,body,detail,created_at FROM notification_inbox WHERE owner=? AND read_at IS NULL AND created_at>=? ORDER BY seq DESC LIMIT 100',owner,cutoff)];
  for(let start=0;start<keys.length;start+=80){const part=keys.slice(start,start+80);queries.push(sql(env,`SELECT tag FROM notification_inbox WHERE owner=? AND (read_at IS NOT NULL OR created_at<?) AND tag IN (${part.map(()=>'?').join(',')})`,owner,cutoff,...part));}
  const rows=await env.DB.batch(queries);
  return {...rows[0].results[0],items:rows[1].results,readTags:rows.slice(2).flatMap(x=>x.results.map(row=>row.tag)),expiredBefore:cutoff};
}
export async function readNotifications(env,owner,selection){
  if(!people.has(owner))throw Error('Invalid notification owner');
  const through=selection.through;
  if(!Number.isSafeInteger(through)||through<0)return false;
  const params=[Date.now(),owner,through];
  let query='UPDATE notification_inbox SET read_at=? WHERE owner=? AND seq<=? AND read_at IS NULL';
  if(selection.all!==true){
    const tags=tagsOf(selection.tags);
    if(tags.length>80){let changed=false;for(let i=0;i<tags.length;i+=80){const result=await readNotifications(env,owner,{through,tags:tags.slice(i,i+80)});changed=changed||result;}return changed;}
    if(tags.length){query+=` AND tag IN (${tags.map(()=>'?').join(',')})`;params.push(...tags);}
    else if(screens.has(selection.screen)){query+=' AND screen=?';params.push(selection.screen);}
    else return false;
  }
  return (await sql(env,query,...params).run()).meta.changes>0;
}
export async function notificationsRoute(request,env,current,ctx){
  const owner=current.owner,path=new URL(request.url).pathname;
  if(!people.has(owner))return json({error:'인증을 확인해 주세요.'},403);
  if(request.method!=='POST'||!['/notifications/state','/notifications/read'].includes(path))return json({error:'Not found'},404);
  let body;try{body=await request.json();}catch{return json({error:'잘못된 요청이에요.'},400);}
  if(!body||typeof body!=='object')return json({error:'잘못된 요청이에요.'},400);
  let changed=false;
  if(path.endsWith('/read')){
    if(!Number.isSafeInteger(body.through)||body.through<0)return json({error:'알림을 새로 불러와 주세요.'},400);
    changed=await readNotifications(env,owner,body);
  }else{
    // Migrate/gather the existing local calendar notices without sending a push.
    // The caller cannot choose an owner or overwrite a server notification.
    for(const item of (Array.isArray(body.localItems)?body.localItems:[]).slice(0,60)){
      if(typeof item?.key!=='string'||item.key.length>220||!item.key.match(/^(new:|reminder:)/)||typeof item.title!=='string')continue;
      const tag=item.key.startsWith('new:')?'new-'+item.key.slice(4):'local:'+item.key;
      const at=Math.min(Date.now(),Number(item.receivedAt)||Date.now());if(!Number.isFinite(at)||at<Date.now()-NOTICE_RETENTION_MS)continue;
      const result=await recordNotification(env,owner,tag,item.title,String(item.detail||''),'calendar',{date:String(item.date||'').slice(0,10),eventId:String(item.eventId||'').slice(0,200)},at,item.read===true);
      changed=changed||result.meta.changes>0;
      if(item.read===true){const r=await sql(env,'UPDATE notification_inbox SET read_at=? WHERE owner=? AND tag=? AND read_at IS NULL',Date.now(),owner,tag).run();changed=changed||r.meta.changes>0;}
    }
  }
  if(changed)ctx.waitUntil(signalNotifications(env,owner));
  return json(await state(env,owner,tagsOf(body.keys)));
}
export async function cleanNotifications(env){await sql(env,'DELETE FROM notification_inbox WHERE created_at<?',Date.now()-NOTICE_RETENTION_MS).run();}
export async function readChatNotifications(env,owner,seq){
  const result=await sql(env,"UPDATE notification_inbox SET read_at=? WHERE owner=? AND read_at IS NULL AND screen='chat' AND tag IN (SELECT 'chat-'||id FROM chat_messages WHERE seq<=? AND owner!=?)",Date.now(),owner,seq,owner).run();
  if(result.meta.changes)await signalNotifications(env,owner);
}
