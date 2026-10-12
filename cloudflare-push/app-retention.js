import {firebaseFetch} from './firebase-access.js';
const DAY=86400000;
const stamp=value=>typeof value==='number'?value:Date.parse(value||'');
const recent=(entry,now)=>!Number.isFinite(stamp(entry?.at))||stamp(entry.at)>=now-30*DAY;
export function pruneLeave(data,now=Date.now()){
 if(!data)return data;
 const keep=r=>{if(!r)return false;const dates=[r.submittedAt,r.decidedAt,r.date?r.date+'T23:59:59+09:00':null].map(stamp).filter(Number.isFinite);return r.status==='pending'||!dates.length||Math.max(...dates)>=now-30*DAY;};
 const requests=Array.isArray(data.requests)?data.requests.filter(keep):Object.fromEntries(Object.entries(data.requests||{}).filter(([,r])=>keep(r)));
 return {...data,requests,history:(data.history||[]).filter(h=>recent(h,now))};
}
export function pruneHome(data,now=Date.now()){
 if(!data)return data;
 const next={...data};
 if(data.moods)next.moods=Object.fromEntries(Object.entries(data.moods).filter(([date])=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||Date.parse(date+'T23:59:59+09:00')>=now-30*DAY));
 const wallet=data.gameRewards?.sweet;
 if(wallet?.uses){const uses=Object.fromEntries(Object.entries(wallet.uses).filter(([,u])=>recent(u,now))),archived=Object.keys(wallet.uses).length-Object.keys(uses).length;if(archived)next.gameRewards={...data.gameRewards,sweet:{...wallet,halfTickets:Math.max(0,Number(wallet.halfTickets||0)-2*archived),archivedUses:Number(wallet.archivedUses||0)+archived,uses}};}
 return next;
}
export function pruneSmoke(data,now=Date.now()){
 if(!data)return data;
 const keep=r=>r&&(!Number.isFinite(Date.parse(r.submittedAt))||Date.parse(r.submittedAt)>=now-7*DAY);
 const requests=Array.isArray(data.requests)?data.requests.filter(keep):Object.fromEntries(Object.entries(data.requests||{}).filter(([,r])=>keep(r)));
 return {...data,requests,history:(data.history||[]).filter(h=>recent(h,now))};
}
export function pruneTrips(data,now=Date.now()){
 if(!data)return data;
 return Object.fromEntries(Object.entries(data).flatMap(([id,t])=>{
 if(!t)return [[id,t]];
 const created=Date.parse(t.createdAt||t.retentionStartedAt||'');
 if(!Number.isFinite(created))return [[id,{...t,retentionStartedAt:new Date(now).toISOString()}]];
 return created<=now-30*DAY?[]:[[id,t]];
 }));
}
async function update(env,url,transform){
 const response=await firebaseFetch(env,url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Retention read failed');
 const data=await response.json(),next=transform(data);
 if(JSON.stringify(data)===JSON.stringify(next))return;
 const etag=response.headers.get('etag');if(!etag)throw Error('Retention version missing');
 const saved=await firebaseFetch(env,url,{method:'PUT',headers:{'Content-Type':'application/json','if-match':etag},body:JSON.stringify(next),signal:AbortSignal.timeout(15000)});
 if(!saved.ok)throw Error(saved.status===412?'Retention changed; retry next run':'Retention write failed');
}
export async function cleanAppRetention(env,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 const last=await env.DB.prepare("SELECT value FROM meta WHERE id='appRetentionCleanupV2'").bind().first();if(last?.value===day)return;
 await update(env,'https://smoke-a9b2e-default-rtdb.firebaseio.com/smoke_app_v1.json',d=>pruneSmoke(d,now));
 await update(env,'https://dydy-96bb1-default-rtdb.firebaseio.com/couple_travel_v1/trips.json',d=>pruneTrips(d,now));
 await update(env,'https://dydy-96bb1-default-rtdb.firebaseio.com/leave_app_v2.json',d=>pruneLeave(d,now));
 await update(env,'https://dydy-96bb1-default-rtdb.firebaseio.com/couple_home_v1.json',d=>pruneHome(d,now));
 await env.DB.prepare("INSERT INTO meta(id,value) VALUES('appRetentionCleanupV2',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(day).run();
}
