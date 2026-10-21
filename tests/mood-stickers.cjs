const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||path.join(process.env.USERPROFILE,'.codex/cache/animation-dom-check/node_modules/jsdom'));
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script id="couple-social-script">([\s\S]*?)<\/script>/)[1];
const code=script.slice(script.indexOf("(function () {\n  'use strict';\n  const $ = id => document.getElementById(id);\n  if (!$('social-mood-form')) return;"));
assert.ok(code.length>1000);
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const section=html.match(/<section class="home-moods"[\s\S]*?<\/section>/)[0];
const dialog=html.match(/<dialog id="social-notifications"[\s\S]*?<\/dialog>/)[0];
let now=Date.parse('2026-10-21T04:00:00Z'),online=true,denied=false,race=false;
const day='2026-10-21',listeners=new Map(),writes=[];
let store={couple_home_v1:{moods:{[day]:{rabbit:{text:'기분 좋아',emoji:'😊',version:'legacy-rabbit',reactions:{}},sweet:{text:'보고 싶어',emoji:'🥺',version:'legacy-sweet',reactions:{}}}}}};
const clone=v=>v==null?null:JSON.parse(JSON.stringify(v));
const value=key=>key==='.info/connected'?online:key.split('/').reduce((a,k)=>a?.[k],store)??null;
function emit(){for(const [key,handlers] of listeners)for(const fn of handlers)fn({val:()=>clone(value(key))});}
function set(key,v){const keys=key.split('/');let n=store;for(const k of keys.slice(0,-1))n=n[k]??={};n[keys.at(-1)]=clone(v);emit();}
function reference(key){return{child:k=>reference(key+'/'+k),set:async v=>set(key,v),on(event,fn){if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);fn({val:()=>clone(value(key))});},off(event,fn){listeners.get(key)?.delete(fn);},async transaction(fn){if(denied)throw Error('permission denied');if(!online)throw Error('offline');if(race){race=false;set(key,{...value(key),version:'changed-before-heart'});}const result=fn(clone(value(key)));if(result===undefined)return{committed:false};assert.match(key,/^couple_home_v1\/moods\/\d{4}-\d{2}-\d{2}\/(rabbit|sweet)$/);writes.push({key,result:clone(result)});set(key,result);return{committed:true};}};}
function client(){const dom=new JSDOM('<div id="topBanner"></div>'+section+dialog+'<div id="app-calendar"></div><div id="home-character"><img id="home-rabbit-art"><span class="home-character-hint"></span></div>',{url:'https://mood-test.invalid/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});const w=dom.window;
 const NativeDate=w.Date;w.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 w.firebase={app:()=>({database:()=>({ref:reference})})};w.CoupleCalendar={getOverview:()=>({ready:true,allEvents:[],upcoming:[]})};w.SiteNav={open(){}};w.eval(code);return dom;}
const a=client(),b=client(),$=(c,id)=>c.window.document.getElementById(id),query=(c,s)=>c.window.document.querySelector(s),flush=()=>new Promise(r=>setImmediate(r));
function choose(c,p){$(c,'social-person').value=p;$(c,'social-person').dispatchEvent(new c.window.Event('change',{bubbles:true}));}
async function mood(c,id){$(c,'social-emoji').value=id;$(c,'social-mood-form').dispatchEvent(new c.window.Event('submit',{cancelable:true}));await flush();}
(async()=>{
 assert.match($(a,'social-mood-cards').textContent,/기분 좋아/,'Legacy mood label survives');
 assert.equal(query(a,'.social-mood-card .social-mood-art').dataset.character,'rabbit');
 assert.equal(a.window.document.querySelectorAll('[data-mood]').length,16);
 query(a,'[data-mood-edit]').click();query(a,'[data-mood-category="affection"]').click();
 assert.equal(a.window.document.querySelectorAll('[data-mood]').length,6);
 query(a,'[data-mood="hug"]').click();assert.equal($(a,'social-emoji').value,'hug');assert.match($(a,'social-mood-save').textContent,/안아줘/);
 query(a,'[data-mood-category="daily"]').click();assert.equal(a.window.document.querySelectorAll('[data-mood]').length,6);
 assert.equal($(a,'social-emoji').value,'hug','Filtering preserves selected mood');
 choose(b,'sweet');assert.equal(query(b,'#social-emoji-options .social-mood-art').dataset.character,'sweet');
 await Promise.all([mood(a,'love'),mood(b,'hungry')]);
 assert.match($(a,'social-mood-cards').textContent,/배고파/);assert.match($(b,'social-mood-cards').textContent,/사랑해/);
 assert.equal(store.couple_home_v1.moods[day].rabbit.moodId,'love');assert.equal(store.couple_home_v1.moods[day].sweet.moodId,'hungry');
 assert.equal($(a,'social-mood-form').hidden,true);
 query(b,'[data-love="rabbit"]').click();await flush();assert.equal(query(a,'[data-love="rabbit"]').getAttribute('aria-pressed'),'true');
 await mood(a,'sulk');assert.equal(query(b,'[data-love="rabbit"]').getAttribute('aria-pressed'),'false','New mood resets old hearts');
 race=true;query(b,'[data-love="rabbit"]').click();await flush();assert.equal(query(a,'[data-love="rabbit"]').getAttribute('aria-pressed'),'false');assert.match($(b,'social-status').textContent,/상대가 기분을 바꿨어요/);
 query(a,'[data-mood-edit]').click();denied=true;await mood(a,'sad');assert.equal($(a,'social-emoji').value,'sad');assert.equal($(a,'social-mood-form').hidden,false);assert.equal(store.couple_home_v1.moods[day].rabbit.moodId,'sulk');denied=false;
 online=false;emit();assert.equal($(a,'social-mood-save').disabled,true);online=true;emit();assert.equal($(a,'social-mood-save').disabled,false);
 const ids=[...a.window.document.querySelectorAll('[data-mood]')].map(b=>b.dataset.mood);
 assert.equal(ids.length,16);for(const id of ids){await mood(a,id);assert.equal(store.couple_home_v1.moods[day].rabbit.moodId,id);}
 const before=writes.length;await mood(a,'invalid');assert.equal(writes.length,before,'Unknown IDs never persist');
 assert.ok(writes.every(w=>!JSON.stringify(w.result).includes('data:image')&&JSON.stringify(w.result).length<300),'Only tiny mood records are stored');
 now+=86400000;await mood(a,'love');assert.equal(writes.length,before,'Day rollover requires a fresh selection');assert.match($(a,'social-status').textContent,/날짜가 바뀌었어요/);
 await mood(a,'love');assert.equal(writes.at(-1).key,'couple_home_v1/moods/2026-10-22/rabbit');
 const assets=JSON.parse(fs.readFileSync(path.join(__dirname,'../asset-manifest.json'),'utf8')).assets;
 for(const owner of ['rabbit','sweet']){const name=`mood-${owner}-v1.webp`;assert.ok(assets.includes(name));const bytes=fs.readFileSync(path.join(__dirname,'../assets',name));assert.equal(bytes.toString('ascii',8,12),'WEBP');}
 console.log('Passed: 16 moods, both character sheets, legacy labels, categories, concurrent per-person saves, live hearts/race/reset, denied/offline draft retention, unknown IDs, date rollover, lightweight records, asset packaging and bundle parsing. No production writes.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{a.window.close();b.window.close();});
