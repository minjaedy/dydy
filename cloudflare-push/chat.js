const sql=(env,q,...args)=>env.DB.prepare(q).bind(...args);
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export const CHAT_RETENTION_MS=30*86400000;
const live="(pinned=1 OR created_at>=?)";
const other=owner=>owner==='rabbit'?'sweet':'rabbit';
export function validateMessage(body){
 if(!body||!/^[-a-zA-Z0-9]{20,80}$/.test(body.id||''))throw Error('메시지 식별자를 확인해 주세요.');
 const kind=body.kind,p=body.payload;
 if(!p||!['text','sticker','photo','calendar','leave','smoke','travel','mood'].includes(kind))throw Error('지원하지 않는 메시지예요.');
 if(kind==='text'){if(typeof p.text!=='string'||!p.text.trim()||p.text.length>1000)throw Error('메시지는 1,000자까지 보내요.');return {text:p.text.trim(),...(typeof p.replyTo==='string'?{replyTo:p.replyTo.slice(0,80)}:{})}}
 if(kind==='sticker'){if(!Number.isInteger(p.index)||p.index<0||p.index>7)throw Error('이모티콘을 확인해 주세요.');return {index:p.index}}
 if(kind==='photo'){if(typeof p.data!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.data)||p.data.length>230000)throw Error('사진 용량을 줄인 뒤 다시 보내 주세요.');const bytes=Uint8Array.from(atob(p.data.split(',')[1]),c=>c.charCodeAt(0));if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('올바른 사진 파일이 아니에요.');return {data:p.data}}
 if(typeof p.title!=='string'||p.title.length>120||typeof p.detail!=='string'||p.detail.length>600)throw Error('공유 내용을 확인해 주세요.');
 return {title:p.title,detail:p.detail,ref:typeof p.ref==='string'?p.ref.slice(0,160):'',date:/^\d{4}-\d\d-\d\d$/.test(p.date||'')?p.date:''};
}
export async function cleanChat(env){const cutoff=Date.now()-CHAT_RETENTION_MS;await env.DB.batch([env.DB.prepare('DELETE FROM chat_photos WHERE message_id IN (SELECT id FROM chat_messages WHERE pinned=0 AND created_at<?)').bind(cutoff),env.DB.prepare('DELETE FROM chat_messages WHERE pinned=0 AND created_at<?').bind(cutoff)]);await sql(env,'DELETE FROM chat_hearts WHERE message_id NOT IN (SELECT id FROM chat_messages)').run();await sql(env,'DELETE FROM chat_presence WHERE active_until<?',Date.now()-86400000).run()}
export async function deliverChat(env,send){const rows=(await sql(env,'SELECT id,owner,kind,payload FROM chat_messages m WHERE notified=0 AND created_at>? AND NOT EXISTS (SELECT 1 FROM chat_presence p WHERE p.owner!=m.owner AND p.active_until>?) ORDER BY seq LIMIT 20',Date.now()-86400000,Date.now()).all()).results;for(const m of rows){const p=JSON.parse(m.payload);try{const active=await sql(env,'SELECT id FROM chat_presence WHERE owner=? AND active_until>? LIMIT 1',other(m.owner),Date.now()).first();if(active)continue;await send(env,other(m.owner),'chat-'+m.id,m.kind==='text'?p.text.slice(0,180):m.kind==='photo'?'사진을 보냈어요.':m.kind==='sticker'?'이모티콘을 보냈어요.':p.title,'chat');await sql(env,'UPDATE chat_messages SET notified=1 WHERE id=?',m.id).run()}catch{/* Retry from cron; do not fail a saved message. */}}}
export async function chatRoute(request,env,current,ctx,send){
 const url=new URL(request.url),path=url.pathname,owner=current.owner,cutoff=Date.now()-CHAT_RETENTION_MS;
 if(path==='/chat/typing'&&request.method==='POST'){const b=await request.json();await sql(env,'UPDATE chat_presence SET typing_until=? WHERE id=?',b.typing===true?Date.now()+5000:0,current.token_hash).run();return json({ok:true})}
 if(path==='/chat/heart'&&request.method==='POST'){const b=await request.json();const m=await sql(env,`SELECT id FROM chat_messages WHERE id=? AND ${live}`,String(b.id||''),cutoff).first();if(!m)return json({error:'이미 정리된 대화예요.'},404);if(b.on===true)await sql(env,'INSERT OR IGNORE INTO chat_hearts(message_id,owner) VALUES(?,?)',m.id,owner).run();else await sql(env,'DELETE FROM chat_hearts WHERE message_id=? AND owner=?',m.id,owner).run();return json({ok:true})}
 if(path==='/chat/presence'&&request.method==='POST'){const b=await request.json();await sql(env,'INSERT INTO chat_presence(id,owner,active_until) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET active_until=excluded.active_until',current.token_hash,owner,b.active===true?Date.now()+45000:0).run();return json({ok:true})}
 if(path==='/chat/messages'&&request.method==='GET'){
 const before=Math.max(0,Number(url.searchParams.get('before'))||0),saved=url.searchParams.get('saved')==='1';
 const rows=(await sql(env,`SELECT seq,id,owner,kind,payload,created_at,pinned FROM chat_messages WHERE ${live}${saved?' AND pinned=1':''}${before?' AND seq<?':''} ORDER BY seq DESC LIMIT 61`,cutoff,...(before?[before]:[])).all()).results;
 const hasMore=rows.length>60;if(hasMore)rows.pop();const unread=await sql(env,`SELECT COUNT(*) AS count FROM chat_messages WHERE owner!=? AND seq>COALESCE((SELECT seq FROM chat_reads WHERE owner=?),0) AND ${live}`,owner,owner,cutoff).first();const read=await sql(env,'SELECT seq FROM chat_reads WHERE owner=?',other(owner)).first();
 const peer=await sql(env,'SELECT MAX(active_until) AS active,MAX(typing_until) AS typing FROM chat_presence WHERE owner=?',other(owner)).first();const hearts=rows.length?(await sql(env,'SELECT message_id,owner FROM chat_hearts WHERE message_id IN ('+rows.map(()=>'?').join(',')+')',...rows.map(r=>r.id)).all()).results:[];
 return json({peerOnline:peer?.active>Date.now(),typing:peer?.typing>Date.now(),hearts,messages:rows.reverse().map(r=>({...r,payload:JSON.parse(r.payload)})),hasMore,unread:unread.count,readSeq:read?.seq||0})}
 if(path==='/chat/read'&&request.method==='POST'){const b=await request.json();const max=await sql(env,'SELECT MAX(seq) AS seq FROM chat_messages').first();const seq=Math.min(Math.max(0,Number(b.seq)||0),max?.seq||0);await sql(env,'INSERT INTO chat_reads(owner,seq) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET seq=MAX(seq,excluded.seq)',owner,seq).run();await sql(env,'UPDATE chat_messages SET notified=1 WHERE owner!=? AND seq<=? AND notified=0',owner,seq).run();return json({ok:true})}
 if(path==='/chat/pin'&&request.method==='POST'){const b=await request.json();if(typeof b.id!=='string'||typeof b.pinned!=='boolean')return json({error:'보관 내용을 확인해 주세요.'},400);const m=await sql(env,`SELECT id FROM chat_messages WHERE id=? AND ${live}`,b.id,cutoff).first();if(!m)return json({error:'이미 정리된 대화예요.'},404);await sql(env,'UPDATE chat_messages SET pinned=? WHERE id=?',b.pinned?1:0,b.id).run();return json({ok:true})}
 if(path.startsWith('/chat/photo/')&&request.method==='GET'){const id=decodeURIComponent(path.slice(12));const m=await sql(env,`SELECT p.data FROM chat_photos p JOIN chat_messages m ON m.id=p.message_id WHERE m.id=? AND (m.pinned=1 OR m.created_at>=?)`,id,cutoff).first();return m?json({data:m.data}):json({error:'사진이 정리됐어요.'},404)}
 if(path==='/chat/messages'&&request.method==='POST'){
 if(Number(request.headers.get('Content-Length'))>250000)return json({error:'사진 용량이 너무 커요.'},413);
 const body=await request.json();let payload;try{payload=validateMessage(body)}catch(e){return json({error:e.message},400)}
 if(payload.replyTo){const original=await sql(env,`SELECT id,owner,kind,payload FROM chat_messages WHERE id=? AND ${live}`,payload.replyTo,cutoff).first();if(original){const p=JSON.parse(original.payload);payload.reply={id:original.id,owner:original.owner,text:original.kind==='text'?p.text.slice(0,120):original.kind==='photo'?'사진':original.kind==='sticker'?'이모티콘':p.title}}delete payload.replyTo;}
 const existing=await sql(env,'SELECT owner FROM chat_messages WHERE id=?',body.id).first();if(existing)return existing.owner===owner?json({ok:true,id:body.id}):json({error:'메시지 번호가 중복됐어요.'},409);
 const rate=await sql(env,'SELECT COUNT(*) AS count FROM chat_messages WHERE owner=? AND created_at>?',owner,Date.now()-60000).first();if(rate.count>=40)return json({error:'잠시 쉬었다가 다시 보내 주세요.'},429);
 const photo=body.kind==='photo'?payload.data:null;
 if(photo){const usage=await sql(env,'SELECT COALESCE(SUM(bytes),0) AS bytes FROM chat_photos').first();if(usage.bytes+photo.length>100000000)return json({error:'사진 보관 공간이 가득 찼어요. 오래된 보관 사진을 정리해 주세요.'},409);payload={}}
 const insert=env.DB.prepare('INSERT INTO chat_messages(id,owner,kind,payload,created_at) VALUES(?,?,?,?,?)').bind(body.id,owner,body.kind,JSON.stringify(payload),Date.now());
 if(photo)await env.DB.batch([insert,env.DB.prepare('INSERT INTO chat_photos(message_id,data,bytes) VALUES(?,?,?)').bind(body.id,photo,photo.length)]);else await insert.run();
 ctx.waitUntil(deliverChat(env,send));return json({ok:true,id:body.id},201)
 }
 return json({error:'Not found'},404)
}
export async function recordAppCards(env,calendar,leave,smoke){
 const start=await sql(env,"SELECT value FROM meta WHERE id='chatStartedAt'").first();if(!start)return;const cutoff=Math.max(Number(start.value),Date.now()-CHAT_RETENTION_MS);
 const put=async(id,owner,kind,payload,at)=>{const p=JSON.stringify(payload);await sql(env,'INSERT INTO chat_messages(id,owner,kind,payload,created_at,notified) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE chat_messages.payload!=excluded.payload',id,owner,kind,p,at).run()};
 for(const [id,e] of Object.entries(calendar||{}))if(e?.createdAt>=cutoff&&['rabbit','sweet'].includes(e.createdBy))await put('event-'+id,e.createdBy,'calendar',{title:String(e.title).slice(0,120),detail:e.date+(e.time?' · '+e.time:'')+'\n'+(e.owner==='rabbit'?'이토끼':e.owner==='sweet'?'구마구마':'함께')+'의 일정',ref:id,date:e.date},e.createdAt);
 for(const [kind,data,owner] of [['leave',leave,'rabbit'],['smoke',smoke,'sweet']])for(const r of Object.values(data?.requests||{})){const at=Date.parse(r?.submittedAt);if(!r?.id||!(at>=cutoff))continue;await put(kind+'-'+r.id,owner,kind,{title:kind==='leave'?'유흥연차 신청':'흡연결재 신청',detail:[r.date,r.reason,r.minutes?String(r.minutes)+'분':''].filter(x=>typeof x==='string').join(' · ').slice(0,600),ref:r.id,status:r.status},at)}
}

export async function scheduledChatCleanup(env){const now=Date.now();const claim=await sql(env,"INSERT INTO meta(id,value) VALUES('chatCleanupAt',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER)<?",String(now),now-3600000).run();if(!claim.meta.changes)return;try{await cleanChat(env)}catch(e){await sql(env,"UPDATE meta SET value='0' WHERE id='chatCleanupAt'").run();throw e}}
