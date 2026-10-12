export function expiredCalendarIds(events,now=new Date()){
 const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric'}).format(now));
 return Object.entries(events||{}).filter(([id,e])=>e&&/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')&&Number(e.date.slice(0,4))<year&&!e.automatic&&!e.holiday&&!id.startsWith('auto-')).map(([id])=>id);
}
const calendarUrl='https://dydy-96bb1-default-rtdb.firebaseio.com/couple_calendar_v1/events';
export async function cleanCalendarYear(env,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const last=await env.DB.prepare("SELECT value FROM meta WHERE id='calendarYearCleanup'").bind().first();if(last?.value===today)return;
 const response=await fetch(calendarUrl+'.json',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Calendar cleanup read failed');
 const ids=expiredCalendarIds(await response.json(),now);
 for(const id of ids){const url=calendarUrl+'/'+encodeURIComponent(id)+'.json';const current=await fetch(url,{headers:{'X-Firebase-ETag':'true'},signal:AbortSignal.timeout(10000)});if(!current.ok)throw Error('Calendar cleanup check failed');const e=await current.json();if(!expiredCalendarIds({[id]:e},now).length)continue;const etag=current.headers.get('etag');if(!etag)throw Error('Calendar cleanup requires version check');const removed=await fetch(url,{method:'DELETE',headers:{'if-match':etag},signal:AbortSignal.timeout(10000)});if(!removed.ok&&removed.status!==412)throw Error('Calendar cleanup delete failed');}
 await env.DB.prepare("INSERT INTO meta(id,value) VALUES('calendarYearCleanup',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(today).run();
}
