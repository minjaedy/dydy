/* Cache only the offline explanation. Shared data and API calls stay on the network. */
const CACHE = 'couple-shell-v3-icons';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./offline.html','./assets/couple-icon-v3-192.png'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('couple-shell-') && key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener('fetch', event => {
  if (event.request.url === new URL('./assets/couple-icon-v3-192.png', self.registration.scope).href) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))); return;
  }
  if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin && new URL(event.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match('./offline.html')));
  }
});
// Keep only owner-scoped badge metadata. Never persist credentials or message bodies.
importScripts('./app-badge.js');
const BADGE_CACHE='couple-badges-v2';
const BADGE_URL=new URL('./.badge-state',self.registration.scope).href;
const BADGE_SCREENS=new Set(['home','calendar','leave','smoke','travel','chat']);
let badgeQueue=Promise.resolve(),badgeMemory={owner:null,snapshots:{},items:[]};
function ownURL(value){try{const u=new URL(value,self.registration.scope),base=new URL(self.registration.scope);return u.origin===base.origin&&u.pathname.startsWith(base.pathname)?u:null;}catch{return null;}}
function updateBadge(change=state=>state){
  badgeQueue=badgeQueue.catch(()=>{}).then(async()=>{
    let cache,state=badgeMemory;
    try{cache=await caches.open(BADGE_CACHE);const stored=await cache.match(BADGE_URL);if(stored){const value=await stored.json();if(value&&value.snapshots&&Array.isArray(value.items))state=value;}}catch{}
    const cutoff=Date.now()-30*86400000;
    state.items=state.items.filter(x=>x.at>=cutoff).slice(-200);
    state=change(state)||state;
    badgeMemory=state;
    try{await cache?.put(BADGE_URL,new Response(JSON.stringify(state),{headers:{'Content-Type':'application/json'}}));}catch{}
    const snapshot=state.snapshots[state.owner];
    const count=snapshot&&snapshot.updatedAt>=cutoff?snapshot.count:state.items.filter(x=>!state.owner||x.owner===state.owner).length;
    await self.CoupleBadge.apply(count);
    return {owner:state.owner,count,version:snapshot?.version??-1};
  });
  return badgeQueue;
}
function snapshotInto(state,snapshot){
  if(!self.CoupleBadge.accept(state.snapshots[snapshot?.owner],snapshot))return state;
  state.snapshots[snapshot.owner]={owner:snapshot.owner,count:snapshot.count,version:snapshot.version,updatedAt:Date.now()};
  if(!state.owner)state.owner=snapshot.owner;
  const read=new Set(snapshot.readTags||[]);
  state.items=state.items.filter(x=>x.owner!==snapshot.owner||!read.has(x.tag));
  return state;
}
async function closeRead(snapshot){
  const read=new Set(snapshot.readTags||[]);
  try{for(const n of await self.registration.getNotifications()){
    const owner=n.data?.owner;
    if(owner===snapshot.owner&&(read.has(n.tag)||(n.data?.at&&n.data.at<snapshot.expiredBefore)))n.close();
  }}catch{}
}
async function notifyPages(type,detail={}){
  try{for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(ownURL(client.url))client.postMessage({type,...detail});}catch{}
}
self.addEventListener('activate',event=>event.waitUntil(updateBadge()));
self.addEventListener('message',event=>{
  if(!ownURL(event.source?.url)||!event.source?.url)return;
  const data=event.data||{};
  if(data.type==='COUPLE_BADGE_STATE'&&self.CoupleBadge.validOwner(data.snapshot?.owner))event.waitUntil(updateBadge(state=>{
    if(self.CoupleBadge.validOwner(data.badgeOwner))state.owner=data.badgeOwner;
    return snapshotInto(state,data.snapshot);
  }).then(()=>closeRead(data.snapshot)));
  // Disabling push only clears this installation's badge, not any person's reads.
  if(data.type==='COUPLE_BADGE_LOCAL_CLEAR')event.waitUntil(updateBadge(state=>{
    if(state.owner===data.owner){delete state.snapshots[state.owner];state.items=state.items.filter(x=>x.owner!==data.owner);}return state;
  }));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const screen=BADGE_SCREENS.has(data.screen)?data.screen:'home',tag=String(data.tag||'couple-update').slice(0,240);
  const owner=self.CoupleBadge.validOwner(data.owner)?data.owner:null,at=Number(data.at)||Date.now();
  // Apple requires a genuinely visible notification for each push, even for stale data.
  const notification=self.registration.showNotification(String(data.title||'🐰🍠 새 소식').slice(0,120),{
    body:String(data.body||'우리의 새 소식이 도착했어요.').slice(0,300),icon:'./assets/couple-icon-v3-192.png',tag,
    data:{url:new URL('./#'+screen,self.registration.scope).href,owner,at,seq:data.seq}
  });
  event.waitUntil((async()=>{
    // Desktop browsers may prepare the app's notification process while showing
    // the notification. Apply its badge afterwards, including with no open page.
    // This cannot override an OS/browser restriction on badges for terminated apps.
    try{await notification;}finally{
      const snapshot=await updateBadge(state=>{
        state.items=[...state.items.filter(x=>x.tag!==tag||x.owner!==owner),{tag,screen,owner,at}].slice(-200);
        return snapshotInto(state,data.badge);
      });
      await notifyPages('COUPLE_BADGE_CHANGED',{snapshot});
    }
  })());
});
function dismiss(notification){
  return updateBadge(state=>{
    const owner=notification.data?.owner||state.owner;
    const exists=state.items.some(x=>x.tag===notification.tag&&x.owner===owner);
    state.items=state.items.filter(x=>x.tag!==notification.tag||x.owner!==owner);
    if(exists&&state.snapshots[owner])state.snapshots[owner].count=Math.max(0,state.snapshots[owner].count-1);
    return state;
  });
}
self.addEventListener('notificationclose',event=>event.waitUntil(dismiss(event.notification)));
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=ownURL(event.notification.data?.url||'./#home');
  event.waitUntil(Promise.all([dismiss(event.notification),target?self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const app=windows.find(client=>ownURL(client.url));if(app){await app.navigate(target.href);return app.focus();}return self.clients.openWindow(target.href);
  }):Promise.resolve()]));
});
