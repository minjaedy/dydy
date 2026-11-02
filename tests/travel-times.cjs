const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require(process.env.JSDOM_PATH||path.join(process.env.USERPROFILE,'.codex/cache/animation-dom-check/node_modules/jsdom'));
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=html.match(/<!-- couple-calendar-travel-script:start -->\s*<script>([\s\S]*?)<\/script>\s*<!-- couple-calendar-travel-script:end -->/)[1];
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const date='2026-11-02',clone=x=>x==null?null:JSON.parse(JSON.stringify(x));
let connected=true;
let data={trip:{id:'trip',title:'우리 여행',createdAt:'2026-11-02T00:00:00Z',start:date,end:'2026-11-03',origin:'집',time:'09:00',link:'',limit:200000,ratio:50,revision:1,expenses:[],packing:[],stops:[
 {id:'cafe',name:'카페',date,category:'카페',travel:30,stay:60,cost:12000,basis:'total',done:true,coords:[37.5,127],link:'',note:'창가 자리'},
 {id:'park',name:'산책',date,category:'관광',travel:20,stay:90,cost:0,basis:'total',done:false,coords:null,link:'',note:''}
]}};
const listeners=[],connections=[],doms=[];
const emit=()=>listeners.forEach(fn=>fn({val:()=>clone(data)}));
const db={ref(branch){
 assert.ok(['couple_travel_v1/trips','.info/connected'].includes(branch));
 if(branch==='.info/connected')return {on(_,fn){connections.push(fn);fn({val:()=>connected});}};
 return {on(_,fn){listeners.push(fn);fn({val:()=>clone(data)});},child(id){return {async transaction(fn){
  assert.ok(connected);const next=fn(clone(data[id]));
  if(next===undefined)return {committed:false,snapshot:{val:()=>clone(data[id])}};
  data[id]=clone(next);emit();return {committed:true,snapshot:{val:()=>clone(data[id])}};
 }}}};
}};
function client(){
 const dom=new JSDOM(html,{url:'https://travel-test.invalid/',runScripts:'outside-only'});doms.push(dom);
 const w=dom.window;w.firebase={app:()=>({database:()=>db})};w.fetch=()=>{throw Error('No live network in this test');};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(code);return w;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const form=w=>w.document.getElementById('tp-stop-form');
const edit=(w,id)=>w.document.querySelector(`[data-time-edit="${id}"]`).click();
async function save(w){form(w).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();}
(async()=>{
 const a=client(),b=client(),api=a.CoupleTravel;
 const base={time:'09:00',stops:[{id:'one',date,travel:30,stay:60},{id:'two',date,travel:20,stay:90},{id:'tomorrow',date:'2026-11-03',travel:15,stay:20}]};
 assert.deepEqual(Array.from(api.timeline(base,date),x=>[x.arrival,x.leave]),[[570,630],[650,740]]);
 assert.equal(api.timeline(base,'2026-11-03')[0].arrival,555);
 base.stops[0].time='11:00';
 let rows=api.timeline(base,date);assert.deepEqual(Array.from(rows,x=>[x.arrival,x.leave]),[[660,720],[740,830]]);
 assert.equal(rows[0].manualTime,true);assert.equal(rows[1].manualTime,false);
 base.stops[1].time='11:30';rows=api.timeline(base,date);
 assert.equal(rows[1].arrival,690);assert.equal(rows[1].timeConflict,true);assert.equal(rows[1].earliestArrival,740);
 base.stops[0].time='25:00';base.stops[1].time='';assert.equal(api.timeline(base,date)[0].arrival,570);
 base.time='23:00';base.stops[0].time='23:30';assert.equal(api.timeline(base,date)[0].leave,1470);assert.equal(api.timeline(base,date)[1].arrival,1490);
 base.time='00:00';base.stops[0].time='00:00';base.stops[0].travel=0;assert.equal(api.timeline(base,date)[0].arrival,0);
 assert.equal(api.currentSchedule({start:date,end:date,time:'09:00',stops:[{id:'manual',date,time:'15:00',travel:0,stay:60,done:false}]},date,new a.Date(date+'T15:30:00')).current.id,'manual');

 edit(a,'cafe');assert.equal(a.document.getElementById('tp-stop-dialog').open,true);
 assert.equal(form(a).elements.time.value,'','Legacy stops remain automatic');
 form(a).elements.time.value='11:00';await save(a);
 assert.equal(data.trip.stops[0].time,'11:00');
 assert.match(b.document.querySelector('[data-time-edit="cafe"]').textContent,/11:00 – 12:00.*직접 설정/);
 assert.match(b.document.querySelector('[data-time-edit="park"]').textContent,/12:20 – 13:50.*자동/);
 assert.equal(data.trip.stops[0].done,true);assert.equal(data.trip.stops[0].cost,12000);
 assert.equal(data.trip.stops[0].note,'창가 자리');assert.deepEqual(data.trip.stops[0].coords,[37.5,127]);
 assert.equal(api.totals(data.trip).planned,12000);

 b.document.getElementById('tp-add').click();Object.assign(form(b).elements.name,{value:'예약한 식당'});
 form(b).elements.time.value='16:30';form(b).elements.stay.value='60';await save(b);
 const added=data.trip.stops.at(-1);assert.equal(added.time,'16:30');
 const c=client();edit(c,added.id);assert.equal(form(c).elements.time.value,'16:30','A new client restores shared time');
 c.document.getElementById('tp-stop-dialog').close();

 edit(a,'cafe');a.document.getElementById('tp-time-auto').click();assert.equal(form(a).elements.time.value,'');await save(a);
 assert.equal(data.trip.stops[0].time,'');assert.match(b.document.querySelector('[data-time-edit="park"]').textContent,/10:50 – 12:20/);
 edit(a,'park');form(a).elements.time.value='10:00';await save(a);
 assert.match(b.document.getElementById('tp-stops').textContent,/10:50 이후/);
 assert.equal(data.trip.stops[1].time,'10:00','Conflicting explicit time stays visible, never silently shifted');
 b.document.querySelector('[data-down="cafe"]').click();await flush();
 assert.equal(data.trip.stops.find(s=>s.id==='park').time,'10:00');

 edit(a,'park');edit(b,'park');form(b).elements.time.value='13:00';await save(b);
 form(a).elements.time.value='14:00';await save(a);
 assert.match(a.document.getElementById('tp-stop-error').textContent,/상대가 수정/);
 assert.equal(data.trip.stops.find(s=>s.id==='park').time,'13:00','Stale edit cannot overwrite partner time');
 a.document.getElementById('tp-stop-dialog').close();
 connected=false;connections.forEach(fn=>fn({val:()=>false}));edit(a,'park');
 assert.equal(a.document.getElementById('tp-stop-dialog').open,false);
 assert.match(a.document.getElementById('tp-save').textContent,/공유 연결/);
 console.log('PASS: legacy automatic times; explicit/cleared times; downstream calculation; midnight/day isolation; current schedule; per-stop editing; two-client save/reload; reorder; conflict display; stale/offline edits blocked; existing data and budgets preserved; full bundle parses. No production access.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>doms.forEach(dom=>dom.window.close()));
