const fs=require('fs'); const E=require('./engine_v2.js');
const load=n=>JSON.parse(fs.readFileSync('merged/'+n,'utf8'));
const d={cards:load('cards.json'),cardRewards:load('card_rewards.json'),cardPerks:[],
  accounts:[],yieldTiers:[],conditionalBoosts:[]};
global.tiersFor=()=>[]; global.heldAccounts=()=>[]; global.heldCards=()=>[];
const num=(v,dflt=0)=>{const n=Number(v);return isFinite(n)?n:dflt;};
// OLD scoreCard, transcribed
function oldScore(card,cat,amount){
  const bonus=d.cardRewards.find(r=>r.card_id===card.card_id&&r.category===cat);
  let rate,rtype,pv,cap;
  if(bonus&&(bonus.min_spend==='NOT_APPLICABLE'||amount>=num(bonus.min_spend))){
    rate=num(bonus.rate);rtype=bonus.reward_type;pv=num(bonus.point_value_mxn,1);cap=bonus.cap_amount;
  } else {rate=num(card.base_reward_rate);rtype=card.base_reward_type;pv=num(card.point_value_mxn,1);cap='';}
  const gross=amount*rate/100;
  let reward=rtype==='points'?gross*pv:gross;
  if(cap!==''&&cap!=='UNKNOWN'&&cap!=='NOT_APPLICABLE'&&reward>num(cap)){reward=num(cap);}
  return reward;
}
const mapped=d.cards.filter(c=>c.mapping_status==='mapped');
const AMT=5000;
console.log("=== CARD RANKING on a $5,000 'other' purchase ===\n");
const rows=mapped.map(c=>({name:c.display_name.slice(0,40),type:c.base_reward_type,
  rate:c.base_reward_rate,pv:c.point_value_mxn,
  old:oldScore(c,'other',AMT), neu:E.scoreCard(d,c,'other',AMT)}));
console.log("OLD engine top 6 (unknown point value silently = 1 peso/point):");
rows.slice().sort((a,b)=>b.old-a.old).slice(0,6).forEach(r=>
  console.log(`   $${r.old.toFixed(0).padStart(4)}  ${r.name.padEnd(42)} ${r.type} ${r.rate}% pv=${r.pv}`));
console.log("\nNEW engine top 6 (unvaluable cards excluded from ranking):");
rows.filter(r=>!r.neu.unvaluable).sort((a,b)=>b.neu.score-a.neu.score).slice(0,6).forEach(r=>
  console.log(`   $${r.neu.score.toFixed(0).padStart(4)}  ${r.name.padEnd(42)} ${r.type} ${r.rate}%`));
const unv=rows.filter(r=>r.neu.unvaluable);
console.log(`\nNEW engine flags ${unv.length} cards as NOT COMPARABLE (would have been ranked by value the old way):`);
unv.slice(0,6).forEach(r=>console.log(`   old score $${r.old.toFixed(0).padStart(4)}  ${r.name} (${r.rate}% in ${r.type})`));

// monthly cap
console.log("\n=== MONTHLY CAP: per-transaction vs month-to-date ===");
const lk=d.cards.find(c=>c.legacy_market_id==='santander_likeu');
if(lk){
  const b=d.cardRewards.find(r=>r.card_id===lk.card_id&&r.category==='pharmacy');
  console.log(`${lk.display_name} — pharmacy ${b.rate}% cap $${b.cap_amount}/${b.cap_period}`);
  let oldTot=0,newTot=0,mtd={};
  for(let i=1;i<=4;i++){
    const o=oldScore(lk,'pharmacy',5000); oldTot+=o;
    const n=E.scoreCard(d,lk,'pharmacy',5000,{mtdRewardByCard:mtd});
    mtd[lk.card_id]=(mtd[lk.card_id]||0)+n.reward; newTot+=n.reward;
    console.log(`   purchase ${i} of $5,000 → OLD $${o.toFixed(0)}   NEW $${n.reward.toFixed(0)}${n.capped?' (capped)':''}`);
  }
  console.log(`   month total          → OLD $${oldTot.toFixed(0)}   NEW $${newTot.toFixed(0)}   cap is $${b.cap_amount}`);
}
