const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const game=html.match(/<!-- couple-calendar-game-script:start -->\s*<script[^>]*>([\s\S]*?)<\/script>/)[1];
function harness(){
  let person='rabbit';
  const nodes={},scope={Intl,Date,Number,Object,Math,Error,preview:false,connected:true,sweetRewardReady:true,
    sweetWallet:{halfTickets:0},state:{balance:2.5,history:[]},names:{rabbit:'이토끼',sweet:'구마구마'},
    $:id=>nodes[id]||=( {} ),window:{CoupleAuth:{isPerson:owner=>owner===person}}};
  scope.stateRef={transaction:async fn=>{const next=fn(structuredClone(scope.state));if(!next)return {committed:false};scope.state=next;return {committed:true};}};
  scope.sweetRewardRef={transaction:async fn=>{const next=fn(structuredClone(scope.sweetWallet));return next?{committed:true,snapshot:{val:()=>next}}:{committed:false};}};
  vm.createContext(scope);vm.runInContext(game.slice(0,game.indexOf('})();')+5),scope);
  scope.rewardRules=scope.window.CoupleGameRewards;
  const start=html.indexOf('function gameRewardMonth()'),end=html.indexOf('window.__leavePendingItems',start);
  vm.runInContext(html.slice(start,end),scope);
  vm.runInContext(game.slice(game.indexOf('  function renderReward()'),game.indexOf('  function switchMode(')),scope);
  return {scope,nodes,as(owner){person=owner;scope.person=owner;},claim(owner,score,runId,mode='tower'){return scope.claimReward({owner,score,runId,game:mode});}};
}
(async()=>{
  const h=harness();h.as('rabbit');h.scope.mode='tower';h.scope.renderReward();assert.match(h.nodes['game-reward-info'].textContent,/500m 달성/);
  assert.equal(await h.claim('rabbit',450,'rabbit-old-goal'),null);
  assert.equal(await h.claim('rabbit',490,'rabbit-below'),null);
  await assert.rejects(h.scope.window.__leaveGameReward(499,'rabbit-direct-below','tower'));
  assert.equal((await h.claim('rabbit',500,'rabbit-at-goal')).awarded,true);
  assert.equal(h.scope.state.miniGameRewardBank,1);assert.equal(h.scope.state.balance,2.5);
  assert.equal((await h.claim('rabbit',550,'rabbit-second')).awarded,false);
  assert.equal(await h.claim('rabbit',3000,'rabbit-dodge-below','dodge'),null);
  assert.equal((await h.claim('rabbit',3001,'rabbit-dodge-goal','dodge')).awarded,true);
  assert.equal(h.scope.state.miniGameRewardBank,2);assert.equal(h.scope.state.miniGameRewardTotal,2);
  h.as('sweet');h.scope.renderReward();assert.match(h.nodes['game-reward-info'].textContent,/550m 달성/);
  assert.equal(await h.claim('sweet',500,'sweet-old-goal'),null);
  assert.equal(await h.claim('sweet',540,'sweet-below'),null);
  assert.equal((await h.claim('sweet',550,'sweet-at-goal')).awarded,true);
  assert.equal(h.scope.sweetWallet.halfTickets,.5);
  assert.equal((await h.claim('sweet',600,'sweet-second')).awarded,false);
  assert.equal(await h.claim('sweet',3499,'sweet-dodge-below','dodge'),null);
  assert.equal((await h.claim('sweet',3500,'sweet-dodge-goal','dodge')).awarded,true);
  assert.equal(h.scope.sweetWallet.halfTickets,1); // Two games still total 0.5 tickets per month.
  const auth=harness();auth.as('rabbit');assert.equal((await auth.claim('sweet',550,'wrong-person')).awarded,false);assert.equal(auth.scope.sweetWallet.halfTickets,0);
  const bank=harness();bank.as('rabbit');Object.assign(bank.scope.state,{miniGameRewardBank:9,miniGameRewardTotal:9});
  assert.equal((await bank.claim('rabbit',500,'bank-final-tenth')).issued,true);assert.equal(bank.scope.state.balance,3.5);assert.equal(bank.scope.state.miniGameRewardBank,0);
  console.log('Passed: exact 500m/550m goals, displayed goals, monthly per-game caps, authentication, unchanged dodge thresholds and reward amounts.');
})().catch(error=>{console.error(error);process.exitCode=1});
