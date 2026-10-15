const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.join(__dirname,'..'),code=fs.readFileSync(path.join(root,'app-sw.js'),'utf8'),helper=fs.readFileSync(path.join(root,'app-badge.js'),'utf8');
function harness(shared=new Map(),{unsupported=false,reject=false,notificationGate=null,noWindows=false,notificationError=false}={}){
 const handlers={},badges=[],notifications=[],opened=[],messages=[],closed=[];
 const cache={async match(key){return shared.get(key)?.clone()},async put(key,value){shared.set(key,value.clone())},async addAll(){}};
 const nav=unsupported?{}:{async setAppBadge(n){if(reject)throw Error('disabled');badges.push(n)},async clearAppBadge(){if(reject)throw Error('disabled');badges.push(0)}};
 const self={navigator:nav,location:{origin:'https://minjaedy.github.io'},registration:{scope:'https://minjaedy.github.io/dydy/',async showNotification(title,options){if(notificationGate)await notificationGate;if(notificationError)throw Error('notification unavailable');const n={title,...options,close(){closed.push([this.data.owner,this.tag]);}};notifications.push(n)},async getNotifications(){return notifications}},clients:{async matchAll(){return noWindows?[]:[{url:'https://minjaedy.github.io/dydy/#home',postMessage:m=>messages.push(m),navigate:async u=>opened.push(u),focus:async()=>{}}]},async openWindow(u){opened.push(u)},async claim(){}},skipWaiting(){},addEventListener(type,handler){(handlers[type]||=[]).push(handler)}};
 const c={self,navigator:nav,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},Response,URL,Date,Promise,Set,JSON,Number,String};vm.createContext(c);c.importScripts=()=>vm.runInContext(helper,c);vm.runInContext(code,c);
 async function emit(type,attrs={}){const waits=[];for(const fn of handlers[type]||[])fn({...attrs,waitUntil:p=>waits.push(p)});await Promise.all(waits)}
 const sync=(snapshot,url='https://minjaedy.github.io/dydy/')=>emit('message',{data:{type:'COUPLE_BADGE_STATE',snapshot,badgeOwner:'sweet',legacyOwner:'sweet'},source:{url}});
 return {shared,badges,notifications,opened,messages,closed,emit,sync,push:payload=>emit('push',{data:{json:()=>payload}})};
}
(async()=>{
 const h=harness();await h.push({owner:'sweet',screen:'calendar',tag:'same',body:'private body',badge:{owner:'sweet',version:1,count:1}});assert.equal(h.badges.at(-1),1);
 await h.push({owner:'rabbit',screen:'calendar',tag:'same',badge:{owner:'rabbit',version:1,count:1}});assert.equal(h.badges.at(-1),1);
 await h.sync({owner:'sweet',version:2,count:0,readTags:['same']});assert.equal(h.badges.at(-1),0);assert.deepEqual(h.closed,[['sweet','same']]);
 await h.push({owner:'sweet',tag:'same',badge:{owner:'sweet',version:1,count:1}});assert.equal(h.badges.at(-1),0);assert.equal(h.notifications.length,3); // Every push remains visible; no silent push workaround.
 await h.sync({owner:'rabbit',version:2,count:0,readTags:['same']},'https://minjaedy.github.io/mixroom/');assert.deepEqual(h.closed,[['sweet','same']]);
 const restored=harness(h.shared);await restored.emit('activate');assert.equal(restored.badges.at(-1),0);
 await restored.push({owner:'sweet',tag:'fresh',screen:'leave',badge:{owner:'sweet',version:3,count:1}});assert.equal(restored.badges.at(-1),1);
 await restored.emit('notificationclick',{notification:{tag:'fresh',data:{owner:'sweet',url:'https://minjaedy.github.io/dydy/#leave'},close(){}}});assert.equal(restored.opened.at(-1),'https://minjaedy.github.io/dydy/#leave');
 for(const opts of [{unsupported:true},{reject:true}]){const fallback=harness(new Map(),opts);await fallback.push({owner:'sweet',tag:'x',badge:{owner:'sweet',version:1,count:1}});assert.equal(fallback.notifications.length,1);}
 for(const url of ['https://evil.example/','https://minjaedy.github.io/mixroom/','https://minjaedy.github.io/dydy-other/']){const before=h.opened.length;await h.emit('notificationclick',{notification:{tag:'x',data:{url},close(){}}});assert.equal(h.opened.length,before);}
 const saved=await h.shared.get('https://minjaedy.github.io/dydy/.badge-state').clone().text();assert(!saved.includes('private body'));assert(h.messages.some(m=>m.type==='COUPLE_BADGE_CHANGED'));
 let finishNotification;const gate=new Promise(resolve=>{finishNotification=resolve});
 const background=harness(new Map(),{noWindows:true,notificationGate:gate});
 const pending=background.push({owner:'sweet',tag:'background',badge:{owner:'sweet',version:4,count:7}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(background.badges,[]);
 finishNotification();await pending;assert.deepEqual(background.badges,[7]);assert.equal(background.notifications.length,1);assert.deepEqual(background.opened,[]);
 const failedNotification=harness(new Map(),{noWindows:true,notificationError:true});
 await assert.rejects(failedNotification.push({owner:'sweet',tag:'unavailable',badge:{owner:'sweet',version:1,count:2}}),/notification unavailable/);
 assert.deepEqual(failedNotification.badges,[2]); // waitUntil also covers badge work after a display failure.
 console.log('Passed: owner-isolated badges/notification closure, stale pushes, persistent restore, scope, visible fallback and no cached bodies.');
})().catch(e=>{console.error(e);process.exitCode=1});
