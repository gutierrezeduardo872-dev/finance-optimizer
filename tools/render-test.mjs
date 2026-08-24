// Render the real screens against the real dataset. Syntax checks pass on an
// undefined identifier; only rendering catches it. Both black screens today
// would have been caught here.
import fs from 'fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import * as esbuild from 'esbuild';

const REPO=process.env.NORTE_REPO || new URL('../', import.meta.url).pathname;
const R=REPO+'data/market/';
const L=f=>JSON.parse(fs.readFileSync(R+f,'utf8'));

const files=['lib.js','ui.jsx','engine.js','details.jsx','advisors.jsx','screens.jsx'];
let src=files.map(f=>fs.readFileSync(REPO+'src/'+f,'utf8')).join('\n');
src=src.replace(/^\/\*[\s\S]*?\*\//,'');
const out=esbuild.transformSync(src,{loader:'jsx',jsxFactory:'React.createElement',
  jsxFragment:'React.Fragment'});

const d={cards:L('cards.json'),cardRewards:L('card_rewards.json'),cardPerks:[],
  accounts:L('accounts.json'),yieldTiers:L('yield_tiers.json'),termTiers:L('term_tiers.json'),
  conditionalBoosts:L('conditional_boosts.json'),issuers:L('issuers.json'),
  categories:L('categories.json'),fxRates:L('fx_rates.json'),referenceRates:L('reference_rates.json'),
  users:[{user_id:'u1',name:'Test',monthly_income_mxn:30000,is_admin:false}],
  userProducts:[
    {id:'p1',user_id:'u1',product_type:'account',product_id:'nu_mx__cajita_nu',current_balance:40000,membership_tier:''},
    {id:'p2',user_id:'u1',product_type:'account',product_id:'bbva_mexico__libreton_cuenta_digital_bbva',current_balance:60000},
    {id:'p3',user_id:'u1',product_type:'card',product_id:'bbva_mexico__oro_bbva'},
    {id:'p4',user_id:'u1',product_type:'card',product_id:'invex__hilton_honors'}],
  // Movements matter: newCardPicks derives category spend from them, and with
  // none the card branch never renders — which is why the first version of this
  // harness passed against a bug that crashed the real screen.
  movements:[
    {movement_id:'m1',user_id:'u1',timestamp:'2026-08-02T10:00:00Z',flow:'cc',
     direction:'out',merchant_category:'supermarket',amount:6000,computed_benefit_mxn:60},
    {movement_id:'m2',user_id:'u1',timestamp:'2026-08-06T10:00:00Z',flow:'cc',
     direction:'out',merchant_category:'travel',amount:12000,computed_benefit_mxn:120},
    {movement_id:'m3',user_id:'u1',timestamp:'2026-08-09T10:00:00Z',flow:'debit',
     direction:'in',amount:30000,computed_benefit_mxn:0}]};

// ui.jsx already destructures the hooks off React, exactly as the browser
// build does, so including it is enough.
const scope=new Function('React','d0',out.code+'; return {Home, Suggestions, Products};')(React,d);
const noop=()=>{};
const props={d,user:d.users[0],go:noop,setSheetItem:noop,logMovement:noop,
  setBalance:noop,setProductFlag:noop,session:d.users[0],addProduct:noop,removeProduct:noop};
// Assert the fixture actually exercises both branches, or the harness passes
// vacuously — as it did the first time it was run.
const scopeFns=new Function('React','d0',out.code+'; return {newCardPicks,newAccountPicks};')(React,d);
const nCard=scopeFns.newCardPicks(d,'u1').length, nAcct=scopeFns.newAccountPicks(d,'u1').length;
console.log(`  fixture: ${nCard} card picks, ${nAcct} account picks`);
if(!nCard||!nAcct){console.log('  FIXTURE TOO THIN — branches would not render'); process.exit(2);}
// Suggestions defaults to the card tab, so rendering it plainly never exercises
// the account branch — which is exactly where the crash was, and why the first
// two versions of this harness passed against live bugs. Render a variant with
// the default flipped so both tabs are covered.
// Target the Suggestions tab specifically. A bare replace of "useState('card')"
// hits Products' `kind` state first and leaves the Suggestions tab on 'card',
// which is how this harness passed against a live crash in the account branch.
const marker=/const \[tab, setTab\] = useState\("card"\)/;
if(!marker.test(out.code)) { console.log('  HARNESS BROKEN: tab state not found'); process.exit(3); }
const srcAcct=out.code.replace(marker,'const [tab, setTab] = useState("account")');
const scopeAcct=new Function('React','d0',srcAcct+'; return {Suggestions};')(React,d);

let fail=0;
const targets={...scope, 'Suggestions[tab=account]':scopeAcct.Suggestions};
for (const [name,C] of Object.entries(targets)) {
  if(!C){console.log(`  skip  ${name} (not exported)`);continue;}
  try { renderToString(React.createElement(C,props)); console.log(`  OK    ${name}`); }
  catch(e){ fail++; console.log(`  CRASH ${name}: ${e.message}`);
            console.log('        '+String(e.stack).split('\n').slice(1,3).join('\n        ')); }
}
process.exit(fail?1:0);
