const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(path.join(process.env.USERPROFILE,'.codex/cache/animation-dom-check/node_modules/jsdom'));
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
const start=html.indexOf("(function(){\n'use strict';\nconst preview=document.getElementById('app-calendar')?.dataset.preview==='true';\nconst server="),end=html.indexOf('\n})();',start)+7;
assert(start>0&&end>start);const code=html.slice(start,end);
const tick=()=>new Promise(setImmediate),token=label=>label.padEnd(64,'x');
const doms=[];
let phase='saved login';const watchdog=setTimeout(()=>{console.error('Timed out during '+phase);process.exit(1)},8000);
function client(saved={}){
 const dom=new JSDOM('<div id="app-calendar"></div>',{url:'https://example.test',runScripts:'outside-only'});doms.push(dom);
 const w=dom.window,events=[],requests=[],control={now:Date.now(),fail:null,failedFirebase:null,hold:null};
 w.Date.now=()=>control.now;w.setInterval=()=>0;w.setTimeout=()=>0;w.AbortSignal={timeout:()=>undefined};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.PublicKeyCredential=function(){};w.SimpleWebAuthnBrowser={startAuthentication(){throw Error('Must not open Face ID');},startRegistration(){throw Error('Must not enroll a passkey');}};
 const apps=['dydy','smoke'].map(name=>({auth:()=>({setPersistence:async()=>events.push(name+':memory'),signInWithCustomToken:async t=>{events.push(name+':signIn:'+t);if(control.failedFirebase===name)throw Error('Network unavailable');},signOut:async()=>events.push(name+':out')}),database:()=>({goOffline:()=>events.push(name+':offline'),goOnline:()=>events.push(name+':online')})}));
 w.firebase={apps,app:n=>apps[n?1:0],auth:{Auth:{Persistence:{NONE:'none'}}}};
 for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,JSON.stringify(value));
 w.fetch=async(url,options={})=>{
  const route=new URL(url).pathname,body=options.body?JSON.parse(options.body):{},owner=body.owner;
  requests.push({route,owner,token:options.headers?.Authorization});
  if(control.fail===route)throw Error('Network unavailable');
  if(control.hold&&route==='/auth/firebase'&&owner==='rabbit')await control.hold;
  let result={ok:true};
  if(route==='/auth/session')result={owner,expires:control.now+60000};
  if(['/auth/restore','/auth/device','/auth/password'].includes(route))result={owner,token:token('session-'+owner),expires:control.now+60000};
  if(route==='/auth/remember')result={owner,token:token('remembered-'+owner)};
  if(route==='/auth/device')result.remembered={owner,token:token('remembered-'+owner)};
  if(route==='/auth/firebase')result={tokens:{dydy:'d-'+owner,smoke:'s-'+owner}};
  return{ok:true,json:async()=>result};
 };
 w.eval(code);return{w,d:w.document,auth:w.CoupleAuth,events,requests,control};
}
(async()=>{
 const a=client({'couple-auth-day:rabbit':{owner:'rabbit',token:token('old-day'),expires:Date.now()+60000}});
 assert.equal(await a.auth.enter('rabbit'),true);assert(!a.d.querySelector('dialog').open);
 assert(a.requests.some(r=>r.route==='/auth/remember'));assert(a.w.localStorage.getItem('couple-auth-device:rabbit'));
 assert(a.events.indexOf('smoke:signIn:s-rabbit')<a.events.indexOf('dydy:online'));
 assert(a.auth.isAdmin('smoke'));assert(!a.auth.isAdmin('leave'));
 a.auth.lock();assert.equal(a.auth.getPerson(),null);await tick();assert(a.events.includes('smoke:out'));
 a.control.now+=86400000;assert.equal(await a.auth.enter('rabbit'),true);assert(!a.d.querySelector('dialog').open);
 assert.equal(a.requests.filter(r=>r.route==='/auth/restore').length,1);
 a.control.now+=86400000;
 await Promise.all([a.auth.chatRequest('messages'),a.auth.notificationRequest('state')]);
 assert.equal(a.requests.filter(r=>r.route==='/auth/restore').length,2);assert.equal(a.auth.getPerson(),'rabbit');
 assert(!a.requests.some(r=>/login\/|register\//.test(r.route)));

 phase='paired device';const b=client({'couple-push-device':{owner:'sweet',token:token('push-sweet')}});
 assert.equal(await b.auth.enter('sweet'),true);assert(b.auth.isAdmin('leave'));assert(!b.auth.isAdmin('smoke'));
 assert.equal(b.requests[0].route,'/auth/device');assert(b.w.localStorage.getItem('couple-auth-device:sweet'));
 b.auth.lock();const other=b.auth.enter('rabbit');await tick();assert(b.d.querySelector('dialog').open);
 assert.equal(b.requests.filter(r=>r.route==='/auth/device').length,1);assert.equal(b.auth.getPerson(),null);
 b.d.getElementById('auth-cancel').click();assert.equal(await other,false);

 phase='fresh device';const fresh=client();const entering=fresh.auth.enter('rabbit');await tick();assert(fresh.d.querySelector('dialog').open);assert.equal(fresh.requests.length,0);
 assert.equal(fresh.d.getElementById('auth-passkey'),null);
 fresh.d.getElementById('auth-password').value='test-only';fresh.d.getElementById('auth-form').dispatchEvent(new fresh.w.Event('submit',{cancelable:true}));
 assert.equal(await entering,true);assert.equal(fresh.d.getElementById('auth-password').value,'');assert(!fresh.d.querySelector('dialog').open);
 fresh.auth.lock();fresh.control.now+=86400000;assert.equal(await fresh.auth.enter('rabbit'),true);
 assert.equal(fresh.requests.filter(r=>r.route==='/auth/password').length,1);

 phase='network retry';const retry=client({'couple-auth-device:rabbit':{owner:'rabbit',token:token('remembered')}});retry.control.fail='/auth/restore';
 const retrying=retry.auth.enter('rabbit');await tick();assert(retry.d.querySelector('dialog').open);assert(retry.d.getElementById('auth-password-fields').hidden);
 assert(retry.w.localStorage.getItem('couple-auth-device:rabbit'));retry.control.fail=null;retry.d.getElementById('auth-retry').click();assert.equal(await retrying,true);

 phase='partial Firebase failure';const fail=client({'couple-auth-device:rabbit':{owner:'rabbit',token:token('remembered')}});fail.control.failedFirebase='smoke';
 const failed=fail.auth.enter('rabbit');await tick();assert.equal(fail.auth.getPerson(),null);assert(!fail.events.some(x=>x.endsWith(':online')));
 fail.d.getElementById('auth-cancel').click();assert.equal(await failed,false);

 phase='account switching';const race=client({'couple-auth-device:rabbit':{owner:'rabbit',token:token('remembered-rabbit')},'couple-auth-device:sweet':{owner:'sweet',token:token('remembered-sweet')}});
 let release;race.control.hold=new Promise(r=>release=r);const older=race.auth.enter('rabbit');await tick();
 assert.equal(await race.auth.enter('sweet'),true);release();assert.equal(await older,false);
 assert.equal(race.auth.getPerson(),'sweet');assert(!race.events.includes('dydy:signIn:d-rabbit'));
 console.log('Passed: no Face ID; remembered/paired entry, owner-specific approval, daily renewal, both Firebase connections, one-time new-device setup, network retry and account-switch isolation.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{clearTimeout(watchdog);doms.forEach(dom=>dom.window.close())});
