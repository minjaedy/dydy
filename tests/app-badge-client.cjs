const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('  const badgeScreens=new Set('),end=html.indexOf('  const badgeNote=',start),code=html.slice(start,end);
let owner='sweet',visible='visible',mode='home',calls=[],applied=[],posted=[],events=[],response;
const info={owner:'sweet',version:1,count:1,through:10,items:[{tag:'notice',screen:'home'}],readTags:[]};
const reg={getNotifications:async()=>[],active:{postMessage:x=>posted.push(x)}};
const c={preview:false,identity:{owner:'sweet'},registration:async()=>reg,location:{href:'https://minjaedy.github.io/dydy/'},navigator:{serviceWorker:{addEventListener(){}}},localStorage:{getItem(){return null},setItem(){}},document:{get visibilityState(){return visible},body:{dataset:{get siteMode(){return mode}}},addEventListener(){}},window:{CoupleAuth:{getPerson:()=>owner,notificationRequest:async(route,body)=>{calls.push({route,body,owner});return response?await response:{...info,owner}}},CoupleHome:{notificationItems:()=>[]},CoupleBadge:{accept:(old,n)=>!old||old.version<=n.version,apply:async n=>applied.push(n)},dispatchEvent:e=>events.push(e),addEventListener(){}},setInterval(){},setTimeout,CustomEvent:class{constructor(type,value){this.type=type;this.detail=value.detail}},Map,Set,Promise};
vm.createContext(c);vm.runInContext(code,c);
(async()=>{
 await c.refreshInbox();assert.equal(calls.length,1);assert.equal(calls[0].route,'state');assert.equal(applied.at(-1),1);assert.equal(posted.at(-1).type,'COUPLE_BADGE_STATE'); // Home does NOT auto-read tests.
 await c.readSelection({all:true});assert.equal(calls.at(-1).body.through,10);assert.equal(calls.at(-1).body.all,true);
 visible='hidden';await c.refreshInbox();assert.equal(calls.length,2);visible='visible';
 owner='rabbit';await c.refreshInbox();assert.equal(calls.at(-1).owner,'rabbit');assert.equal(applied.length,2); // Registered sweet badge remains untouched.
 const before=events.length;let resolve;response=new Promise(r=>resolve=r);const work=c.refreshInbox();await new Promise(setImmediate);owner='sweet';resolve({...info,owner:'rabbit',version:2});await work;assert.equal(events.length,before);response=null;
 owner=null;await c.refreshInbox();assert.equal(calls.length,4);c.preview=true;owner='sweet';await c.refreshInbox();assert.equal(calls.length,4);
 console.log('Passed: home does not auto-read, same-user cursor, registered-owner badge binding, hidden/locked/preview gating and in-flight account switch.');
})().catch(e=>{console.error(e);process.exitCode=1});
