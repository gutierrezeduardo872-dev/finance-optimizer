const fs=require('fs'); const E=require('./engine_v2.js');
const load=n=>JSON.parse(fs.readFileSync('merged/'+n,'utf8'));
const d={accounts:load('accounts.json'),yieldTiers:load('yield_tiers.json'),
  conditionalBoosts:load('conditional_boosts.json'),cards:[],cardRewards:[],cardPerks:[],movements:[]};
global.tiersFor=(d,id)=>d.yieldTiers.filter(t=>t.account_id===id)
  .sort((a,b)=>(E.numOrNull(a.tier_min_mxn)||0)-(E.numOrNull(b.tier_min_mxn)||0));
global.heldCards=()=>[]; global.heldAccounts=()=>[];
global.mtdSpendAllCards=()=>0; global.mtdTxCount=()=>0; global.mtdDeposits=()=>0;
d.userFlags={u1:{payroll:false,memberships:[]}};   // nothing collected yet

const mxn=n=>'$'+Math.round(n).toLocaleString('en-US');
const BAL=25000;
console.log(`=== UNMET BOOST AS ADVICE (balance ${mxn(BAL)}, no flags collected) ===\n`);
for(const aid of ['uala_mx__cuenta_con_rendimiento_uala','klar__cuenta_klar_saldo_disponible',
                  'mercado_pago__cuenta_mercado_pago_rendimientos']){
  const a=d.accounts.find(x=>x.account_id===aid); if(!a) continue;
  const now=E.annualYield(d,'u1',a,BAL);
  const op=E.boostOpportunity(d,'u1',a,BAL);
  console.log(a.display_name);
  console.log(`   today: ${E.marginalRate(d,'u1',a,BAL)}%  →  ${mxn(now)}/yr`);
  if(op){
    const cond = op.conditionAmount!==null
      ? `${op.conditionType.replace(/_/g,' ')} of ${mxn(op.conditionAmount)}/${op.conditionPeriod}`
      : op.conditionType.replace(/_/g,' ');
    console.log(`   unlock ${op.potentialRate}% by: ${cond}`);
    console.log(`   worth  +${mxn(op.extraPerYear)}/yr` + (op.maxBalance?` (on the first ${mxn(op.maxBalance)})`:''));
  } else console.log('   no better boost available');
  console.log();
}
console.log("=== SAME USER, FLAGS NOW SET ===\n");
d.userFlags.u1={payroll:true,memberships:['klar']};
for(const aid of ['uala_mx__cuenta_con_rendimiento_uala','klar__cuenta_klar_saldo_disponible']){
  const a=d.accounts.find(x=>x.account_id===aid);
  const op=E.boostOpportunity(d,'u1',a,BAL);
  console.log(`${a.display_name}: ${E.marginalRate(d,'u1',a,BAL)}% → ${mxn(E.annualYield(d,'u1',a,BAL))}/yr` +
    (op?`  (still ${op.potentialRate}% available)`:'  (best rate reached)'));
}
