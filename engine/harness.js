const fs=require('fs');
const E=require('./engine_v2.js');
const load=n=>JSON.parse(fs.readFileSync('merged/'+n,'utf8'));
const d={cards:load('cards.json'),accounts:load('accounts.json'),
  cardRewards:load('card_rewards.json'),cardPerks:[],
  yieldTiers:load('yield_tiers.json'),conditionalBoosts:load('conditional_boosts.json')};
global.tiersFor=(d,id)=>d.yieldTiers.filter(t=>t.account_id===id)
  .sort((a,b)=>(E.numOrNull(a.tier_min_mxn)||0)-(E.numOrNull(b.tier_min_mxn)||0));
global.heldAccounts=()=>[]; global.heldCards=()=>[];
global.mtdSpendAllCards=()=>SPEND; global.mtdTxCount=()=>TX; global.mtdDeposits=()=>DEP;
let SPEND=0,TX=0,DEP=0;
d.userFlags={u1:{payroll:false,memberships:[]}};

const num=(v,dflt=0)=>{const n=Number(v);return isFinite(n)?n:dflt;};
// OLD engine, transcribed from index.html
function oldYield(acct,tiers,boostRate){
  let y=0;
  if(acct.yield_structure==='tiered'){
    for(const t of tiers){const lo=num(t.tier_min_mxn),hi=t.tier_max_mxn==='UNCAPPED'?Infinity:num(t.tier_max_mxn);
      const portion=Math.max(0,Math.min(BAL,hi)-lo); y+=portion*(num(t.rate_pct)+boostRate)/100;}
  } else { const cap=acct.max_balance_earning_stated_rate_mxn==='UNCAPPED'?Infinity:num(acct.max_balance_earning_stated_rate_mxn);
    y+=Math.min(BAL,cap)*(num(acct.flat_rate_pct)+boostRate)/100; }
  return y-num(acct.monthly_fee_mxn)*12;
}
let BAL=0;
console.log("=== SAVINGS: additive vs replacement ===\n");
for(const aid of ['uala_mx__cuenta_con_rendimiento_uala','mercado_pago__cuenta_mercado_pago_rendimientos','klar__cuenta_klar_saldo_disponible']){
  const a=d.accounts.find(x=>x.account_id===aid); if(!a)continue;
  const tiers=global.tiersFor(d,aid);
  const boosts=d.conditionalBoosts.filter(b=>b.account_id===aid);
  BAL=25000;
  // simulate the condition being MET
  SPEND=99999; TX=99; DEP=99999; d.userFlags.u1.memberships=[a.issuer_id];
  const topBoost=Math.max(...boosts.map(b=>num(b.boost_rate_pct)),0);
  const oldY=oldYield(a,tiers,topBoost);
  const newY=E.annualYield(d,'u1',a,BAL);
  console.log(`${a.display_name}  (balance $25,000, condition met)`);
  console.log(`   OLD (additive)     $${oldY.toFixed(0)}/yr  = ${(oldY/BAL*100).toFixed(2)}%`);
  console.log(`   NEW (replacement)  $${newY.toFixed(0)}/yr  = ${(newY/BAL*100).toFixed(2)}%`);
  console.log(`   overstated by      $${(oldY-newY).toFixed(0)}/yr\n`);
}
