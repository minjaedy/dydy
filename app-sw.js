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
// Only notification identifiers are stored locally; never cache message bodies or API data.
const BADGE_CACHE='couple-badges-v1';
const BADGE_URL=new URL('./.badge-state',self.registration.scope).href;
const BADGE_SCREENS=new Set(['home','calendar','leave','smoke','travel','chat']);
let badgeQueue=Promise.resolve(),badgeMemory=[];
function updateBadge(change=items=>items){
  const work=badgeQueue.then(async()=>{
    let cache,items=badgeMemory;
    try{cache=await caches.open(BADGE_CACHE);const stored=await cache.match(BADGE_URL);if(stored){const value=await stored.json();if(Array.isArray(value))items=value;}}catch{}
    const cutoff=Date.now()-30*86400000;
    items=change(items.filter(item=>item&&typeof item.tag==='string'&&Number(item.at)>=cutoff)).slice(-200);
    badgeMemory=items;
    try{if(cache)await cache.put(BADGE_URL,new Response(JSON.stringify(items),{headers:{'Content-Type':'application/json'}}));}catch{}
    try{if(items.length&&typeof self.navigator?.setAppBadge==='function')await self.navigator.setAppBadge(items.length);else if(!items.length&&typeof self.navigator?.clearAppBadge==='function')await self.navigator.clearAppBadge();}catch{}
  });
  badgeQueue=work.catch(()=>{});return badgeQueue;
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='COUPLE_BADGE_ACK'||!event.source?.url)return;
  let source;try{source=new URL(event.source.url);}catch{return;}
  if(source.origin!==self.location.origin||!source.href.startsWith(self.registration.scope))return;
  const screen=event.data.screen;
  if(event.data.all!==true&&!BADGE_SCREENS.has(screen))return;
  event.waitUntil(updateBadge(items=>event.data.all===true?[]:items.filter(item=>item.screen!==screen)));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const target=BADGE_SCREENS.has(data.screen)?data.screen:'home';
  const tag=String(data.tag||'couple-update').slice(0,120);
  // Always show a notification, even when badging is unsupported or fails.
  const notification=self.registration.showNotification(String(data.title||({leave:'🐰 유흥연차 알림',smoke:'💨 흡연 결재 알림',calendar:'🗓 일정 알림',travel:'✈ 여행 알림'}[target])||'🐰🍠 새 소식').slice(0,60),{
    body:String(data.body||'우리의 새 소식이 도착했어요.').slice(0,250),icon:'./assets/couple-icon-v3-192.png',tag,
    data:{url:new URL('./#'+target,self.registration.scope).href}
  });
  const badge=updateBadge(items=>[...items.filter(item=>item.tag!==tag),{tag,screen:target,at:Date.now()}]).then(async()=>{
    try{for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(client.url.startsWith(self.registration.scope))client.postMessage({type:'COUPLE_BADGE_CHANGED'});}catch{}
  });
  event.waitUntil(Promise.all([notification,badge]));
});
self.addEventListener('notificationclose',event=>{
  event.waitUntil(updateBadge(items=>items.filter(item=>item.tag!==event.notification.tag)));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const ack=updateBadge(items=>items.filter(item=>item.tag!==event.notification.tag));
  const target=new URL(event.notification.data?.url||'./#home',self.registration.scope);
  if(target.origin!==self.location.origin||!target.pathname.startsWith(new URL(self.registration.scope).pathname)){event.waitUntil(ack);return;}
  event.waitUntil(Promise.all([ack,self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const app=windows.find(client=>client.url.startsWith(self.registration.scope));
    if(app){await app.navigate(target.href);return app.focus();}
    return self.clients.openWindow(target.href);
  })]));
});
