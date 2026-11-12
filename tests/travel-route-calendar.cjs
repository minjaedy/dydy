const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_PATH||path.join(process.env.USERPROFILE,'.codex/cache/animation-dom-check/node_modules/jsdom'));
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function script(marker){
 const block=html.split('<!-- couple-calendar-'+marker+':start -->')[1].split('<!-- couple-calendar-'+marker+':end -->')[0];
 return block.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
}
const clone=structuredClone;
const isoOffset=n=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const first=isoOffset(4),second=isoOffset(5),third=isoOffset(6);
const stop=(id,date,coords,link='')=>({id,name:id,date,coords,link,travel:10,stay:30,cost:100,basis:'total',category:'관광'});
const database={t:{id:'t',revision:2,title:'날짜별 제주 여행',origin:'공항',originCoords:[33.51,126.49],time:'09:30',start:first,end:second,ratio:50,limit:1000,expenses:[],packing:[{id:'p',title:'충전기'}],stops:[
 stop('A',first,[33.4,126.5]),stop('B',first,null,'https://map.naver.com/p/entry/place/7'),stop('C',first,[33.3,126.6]),
 stop('D',second,null,'https://naver.me/example')
]}};
const subscribers=[],doms=[];
const snapshot=x=>({val:()=>clone(x)});
const emit=()=>subscribers.forEach(fn=>fn(snapshot(database)));
const db={ref(branch){
 if(branch==='.info/connected')return {on(_,fn){fn(snapshot(true));}};
 assert.equal(branch,'couple_travel_v1/trips');
 return {on(_,fn){subscribers.push(fn);fn(snapshot(database));},child(id){return{async transaction(edit){
  const updated=edit(clone(database[id]??null));
  if(updated===undefined)return {committed:false,snapshot:snapshot(database[id]??null)};
  if(updated===null)delete database[id];else database[id]=updated;
  emit();return {committed:true,snapshot:snapshot(updated)};
 }};}};
}};
function client(){
 const dom=new JSDOM(html,{url:'https://example.test/app/',runScripts:'outside-only'});doms.push(dom);
 const w=dom.window,d=w.document,draw={pins:[],lines:[]};
 d.getElementById('app-calendar').dataset.preview='true';
 w.fetch=async()=>({ok:true,json:async()=>[]});
 w.firebase={app:()=>({database:()=>db})};
 w.FX={ICONS:{},COMBO_ICON:''};w.SiteNav={open:()=>{}};
 w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.CoupleAuth={travelLocation:async()=>({link:'https://map.naver.com/p/directions/-/126.7,33.2,D,1,PLACE_POI/-/walk'})};
 const map={setView(){return this;},fitBounds(){},invalidateSize(){},flyTo(){},closePopup(){}};
 w.L={map:()=>map,tileLayer:()=>({addTo(){}}),layerGroup:()=>({addTo(){return this;},clearLayers(){draw.pins=[];draw.lines=[];}}),divIcon:x=>x,
 marker:(pt,options)=>({bindPopup(){return this;},addTo(){draw.pins.push([Array.from(pt),options.icon.html]);return this;},getElement(){},openPopup(){}}),
 polyline:pts=>({addTo(){draw.lines.push(Array.from(pts,p=>Array.from(p)));}})};
 w.eval(script('script'));w.eval(script('home-script'));
 delete d.getElementById('app-calendar').dataset.preview;w.eval(script('travel-script'));
 const click=sel=>{const el=d.querySelector(sel);assert.ok(el,sel);el.click();};
 d.getElementById('app-travel').style.display='block';
 w.dispatchEvent(new w.CustomEvent('site-mode-change',{detail:{mode:'travel'}}));
 return {w,d,draw,click};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const tripCards=c=>c.w.CoupleCalendar.getOverview().upcoming.filter(x=>x.event.tripId);
(async()=>{
 const a=client(),b=client();await flush();
 assert.match(a.d.querySelector('[data-home-dday="trip"]').textContent,/D-4.*날짜별 제주 여행/);
 assert.equal(tripCards(a).length,1);
 assert.deepEqual(a.draw.pins.map(x=>x[0]),[[33.51,126.49],[33.4,126.5],[33.3,126.6]]);
 assert.match(a.draw.pins[2][1],/>3</);assert.equal(a.draw.lines.length,1);assert.equal(a.draw.lines[0].length,2);
 assert.ok(a.d.querySelector('#tp-route a[href*="/place/7"]'));
 a.click('[data-route-member="A"]');await flush();
 assert.equal(database.t.stops.length,4);assert.equal(database.t.stops[0].routeExcluded,true);
 assert.equal(b.d.querySelector('[data-route-focus="A"]'),null);assert.equal(b.w.CoupleTravel.totals(database.t).planned,400);
 a.click('#tp-route-clear');await flush();assert.equal(a.draw.pins.length,0);assert.equal(a.d.getElementById('tp-map').hidden,true);
 a.click('[data-day="'+second+'"]');await flush();await flush();
 assert.deepEqual(Array.from(database.t.stops[3].coords),[33.2,126.7]);
 assert.deepEqual(a.draw.pins.map(x=>x[0]),[[33.51,126.49],[33.2,126.7]]);assert.match(a.draw.pins[1][1],/>1</);
 a.click('[data-day="'+first+'"]');a.click('[data-route-member="A"]');await flush();
 assert.deepEqual(a.draw.pins.map(x=>x[0]),[[33.4,126.5]]);assert.equal(database.t.packing.length,1);
 for(const date of [first,second]){a.w.CoupleCalendar.open({date});assert.ok(a.d.querySelector('#cc-day-events [data-cc-trip="t"]'));}
 a.click('[data-cc-trip="t"]');assert.equal(a.d.querySelector('[data-day][aria-pressed="true"]').dataset.day,second);
 const settings=a.d.getElementById('tp-settings');settings.elements.title.value='여행 이름 변경';settings.elements.end.value=third;
 settings.dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
 b.w.CoupleCalendar.open({date:third});assert.match(b.d.getElementById('cc-day-events').textContent,/여행 이름 변경/);
 assert.match(b.d.querySelector('[data-home-dday="trip"]').textContent,/여행 이름 변경/);
 a.click('#tp-trip-delete');b.click('[data-day="'+second+'"]');b.click('[data-route-member="D"]');await flush();
 a.click('#tp-trip-delete-yes');await flush();assert.ok(database.t);assert.match(a.d.getElementById('tp-delete-error').textContent,/변경/);
 a.click('[data-tp-close="tp-trip-delete-dialog"]');a.click('#tp-trip-delete');a.click('#tp-trip-delete-yes');await flush();
 assert.equal(database.t,undefined);assert.equal(tripCards(b).length,0);assert.equal(b.d.querySelector('#cc-day-events [data-cc-trip]'),null);
 assert.doesNotMatch(b.d.querySelector('[data-home-dday="trip"]').textContent,/여행 이름 변경/);
 const f=b.d.getElementById('tp-settings');f.elements.title.value='다시 등록';f.elements.start.value=first;f.elements.end.value=first;
 f.dispatchEvent(new b.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
 assert.equal(Object.keys(database).length,1);assert.match(a.d.querySelector('[data-home-dday="trip"]').textContent,/다시 등록/);
 assert.equal(a.w.CoupleTravel.coordinates('https://map.naver.com/?lat=33.2'),null);
 assert.equal(a.w.CoupleTravel.coordinates('https://map.naver.com/p/entry/place/7?c=126.5,33.2,14'),null);
 console.log('PASS: two-device trip creation, rename, date range, home D-day, daily calendar, stale deletion and removal, daily numbered pins, route gaps, automatic short-link placement, reversible per-day route removal.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>doms.forEach(dom=>dom.window.close()));
