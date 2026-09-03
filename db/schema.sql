-- ===========================================================================
-- Norte — Postgres schema (Supabase)
-- ---------------------------------------------------------------------------
-- ONE design decision explains the whole file.
--
-- The dataset stores sentinels next to numbers: a fee column may hold 350, or
-- UNKNOWN (the issuer does not publish it), or NOT_APPLICABLE (there is no
-- such fee), or UNCAPPED (there is no limit). These are not interchangeable
-- and they are not decoration. In core/engine.js:
--
--     knownNum('UNKNOWN')   -> null       arithmetic must not run
--     cap('UNCAPPED')       -> Infinity   the bonus has no ceiling
--
-- Collapse them all to NULL and an uncapped bonus becomes a bonus capped at
-- zero. The scoring changes. So the raw row has to survive intact.
--
-- Hence: every market table stores the complete original JSON row in `raw`,
-- and every typed column is GENERATED from it. There is no second copy to
-- drift, the API can hand the engine exactly the bytes it gets today, and a
-- new column added by the market-data skill lands in `raw` with no migration
-- at all. A column only becomes typed when something needs to query it.
--
-- Run order:  schema.sql  ->  seed (db/seed.mjs)  ->  policies apply on their own
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Sentinel-aware casts. IMMUTABLE so generated columns may use them.
-- ---------------------------------------------------------------------------

create or replace function norte_num(v jsonb) returns numeric
  language sql immutable returns null on null input as $$
  select case
    when jsonb_typeof(v) = 'number' then v::text::numeric
    when jsonb_typeof(v) = 'string'
         and upper(btrim(v #>> '{}')) not in ('', 'UNKNOWN', 'UNCAPPED', 'NOT_APPLICABLE')
         and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (v #>> '{}')::numeric
    else null
  end
$$;

-- The sentinel itself, when there is one. Lets SQL tell "not published" from
-- "no limit" without reaching into the JSON by hand.
create or replace function norte_sentinel(v jsonb) returns text
  language sql immutable returns null on null input as $$
  select case
    when jsonb_typeof(v) = 'string'
         and upper(btrim(v #>> '{}')) in ('UNKNOWN', 'UNCAPPED', 'NOT_APPLICABLE')
      then upper(btrim(v #>> '{}'))
    else null
  end
$$;

create or replace function norte_txt(v jsonb) returns text
  language sql immutable returns null on null input as $$
  select case when jsonb_typeof(v) = 'string' then nullif(v #>> '{}', '') else null end
$$;

create or replace function norte_bool(v jsonb) returns boolean
  language sql immutable returns null on null input as $$
  select case when jsonb_typeof(v) = 'boolean' then v::text::boolean else null end
$$;

-- ===========================================================================
-- MARKET DATA
-- Source of truth stays data/market/*.json in the repo, under the
-- finance-market-data skill. These tables are the served copy: seeded from the
-- repo, never edited by hand, never written by the app.
-- ===========================================================================

create table if not exists issuers (
  issuer_id   text generated always as (raw ->> 'issuer_id') stored primary key,
  raw         jsonb not null,
  display_name        text    generated always as (norte_txt(raw -> 'display_name')) stored,
  regulated_entity_type text  generated always as (norte_txt(raw -> 'regulated_entity_type')) stored,
  in_dataset          boolean generated always as (norte_bool(raw -> 'in_dataset')) stored,
  status              text    generated always as (norte_txt(raw -> 'status')) stored,
  updated_at  timestamptz not null default now()
);

create table if not exists cards (
  card_id     text generated always as (raw ->> 'card_id') stored primary key,
  raw         jsonb not null,
  issuer_id           text    generated always as (raw ->> 'issuer_id') stored,
  display_name        text    generated always as (norte_txt(raw -> 'display_name')) stored,
  tier                text    generated always as (norte_txt(raw -> 'tier')) stored,
  network             text    generated always as (norte_txt(raw -> 'network')) stored,
  lifecycle_status    text    generated always as (norte_txt(raw -> 'lifecycle_status')) stored,
  mapping_status      text    generated always as (norte_txt(raw -> 'mapping_status')) stored,
  product_type        text    generated always as (norte_txt(raw -> 'product_type')) stored,
  -- numerics: NULL where the dataset holds a sentinel, with the sentinel kept
  -- alongside so a query can tell "not published" from "does not apply".
  annual_fee_mxn      numeric generated always as (norte_num(raw -> 'annual_fee_mxn')) stored,
  annual_fee_sentinel text    generated always as (norte_sentinel(raw -> 'annual_fee_mxn')) stored,
  cat_promedio_pct    numeric generated always as (norte_num(raw -> 'cat_promedio_pct')) stored,
  effective_rate_pct  numeric generated always as (norte_num(raw -> 'effective_rate_pct')) stored,
  min_income_mxn_monthly numeric generated always as (norte_num(raw -> 'min_income_mxn_monthly')) stored,
  cat_valid_until     text    generated always as (norte_txt(raw -> 'cat_valid_until')) stored,
  updated_at  timestamptz not null default now(),
  constraint cards_issuer_fk foreign key (issuer_id) references issuers (issuer_id)
);
create index if not exists cards_issuer_idx  on cards (issuer_id);
create index if not exists cards_mapping_idx on cards (mapping_status);

create table if not exists card_rewards (
  reward_id   text generated always as (raw ->> 'reward_id') stored primary key,
  raw         jsonb not null,
  card_id             text    generated always as (raw ->> 'card_id') stored,
  category            text    generated always as (norte_txt(raw -> 'category')) stored,
  reward_type         text    generated always as (norte_txt(raw -> 'reward_type')) stored,
  effective_rate_pct  numeric generated always as (norte_num(raw -> 'effective_rate_pct')) stored,
  cap_amount          numeric generated always as (norte_num(raw -> 'cap_amount')) stored,
  cap_sentinel        text    generated always as (norte_sentinel(raw -> 'cap_amount')) stored,
  updated_at  timestamptz not null default now(),
  constraint card_rewards_card_fk foreign key (card_id) references cards (card_id) on delete cascade
);
create index if not exists card_rewards_card_idx on card_rewards (card_id);
create index if not exists card_rewards_cat_idx  on card_rewards (category);

-- Present in the engine's data shape and empty in the dataset today. Kept so
-- the bootstrap payload has the same keys whether or not perks exist yet.
create table if not exists card_perks (
  perk_id     text generated always as (raw ->> 'perk_id') stored primary key,
  raw         jsonb not null,
  card_id     text generated always as (raw ->> 'card_id') stored,
  updated_at  timestamptz not null default now(),
  constraint card_perks_card_fk foreign key (card_id) references cards (card_id) on delete cascade
);

create table if not exists accounts (
  account_id  text generated always as (raw ->> 'account_id') stored primary key,
  raw         jsonb not null,
  issuer_id           text    generated always as (raw ->> 'issuer_id') stored,
  display_name        text    generated always as (norte_txt(raw -> 'display_name')) stored,
  account_type        text    generated always as (norte_txt(raw -> 'account_type')) stored,
  yield_structure     text    generated always as (norte_txt(raw -> 'yield_structure')) stored,
  liquidity           text    generated always as (norte_txt(raw -> 'liquidity')) stored,
  lifecycle_status    text    generated always as (norte_txt(raw -> 'lifecycle_status')) stored,
  mapping_status      text    generated always as (norte_txt(raw -> 'mapping_status')) stored,
  insurance_scheme    text    generated always as (norte_txt(raw -> 'insurance_scheme')) stored,
  flat_rate_pct       numeric generated always as (norte_num(raw -> 'flat_rate_pct')) stored,
  flat_rate_sentinel  text    generated always as (norte_sentinel(raw -> 'flat_rate_pct')) stored,
  monthly_fee_mxn     numeric generated always as (norte_num(raw -> 'monthly_fee_mxn')) stored,
  min_balance_mxn     numeric generated always as (norte_num(raw -> 'min_balance_mxn')) stored,
  rate_index          text    generated always as (norte_txt(raw -> 'rate_index')) stored,
  updated_at  timestamptz not null default now(),
  constraint accounts_issuer_fk foreign key (issuer_id) references issuers (issuer_id)
);
create index if not exists accounts_issuer_idx on accounts (issuer_id);
create index if not exists accounts_yield_idx  on accounts (yield_structure);

create table if not exists yield_tiers (
  tier_id     text generated always as (raw ->> 'tier_id') stored primary key,
  raw         jsonb not null,
  account_id          text    generated always as (raw ->> 'account_id') stored,
  tier_min_mxn        numeric generated always as (norte_num(raw -> 'tier_min_mxn')) stored,
  tier_max_mxn        numeric generated always as (norte_num(raw -> 'tier_max_mxn')) stored,
  tier_max_sentinel   text    generated always as (norte_sentinel(raw -> 'tier_max_mxn')) stored,
  rate_pct            numeric generated always as (norte_num(raw -> 'rate_pct')) stored,
  updated_at  timestamptz not null default now(),
  constraint yield_tiers_account_fk foreign key (account_id) references accounts (account_id) on delete cascade
);
create index if not exists yield_tiers_account_idx on yield_tiers (account_id, tier_min_mxn);

create table if not exists term_tiers (
  term_id     text generated always as (raw ->> 'term_id') stored primary key,
  raw         jsonb not null,
  account_id          text    generated always as (raw ->> 'account_id') stored,
  term_days           numeric generated always as (norte_num(raw -> 'term_days')) stored,
  rate_pct            numeric generated always as (norte_num(raw -> 'rate_pct')) stored,
  updated_at  timestamptz not null default now(),
  constraint term_tiers_account_fk foreign key (account_id) references accounts (account_id) on delete cascade
);
create index if not exists term_tiers_account_idx on term_tiers (account_id);

create table if not exists conditional_boosts (
  boost_id    text generated always as (raw ->> 'boost_id') stored primary key,
  raw         jsonb not null,
  account_id          text    generated always as (raw ->> 'account_id') stored,
  condition_type      text    generated always as (norte_txt(raw -> 'condition_type')) stored,
  boost_rate_pct      numeric generated always as (norte_num(raw -> 'boost_rate_pct')) stored,
  condition_amount_mxn numeric generated always as (norte_num(raw -> 'condition_amount_mxn')) stored,
  updated_at  timestamptz not null default now(),
  constraint conditional_boosts_account_fk foreign key (account_id) references accounts (account_id) on delete cascade
);
create index if not exists conditional_boosts_account_idx on conditional_boosts (account_id);

create table if not exists categories (
  category_key  text generated always as (raw ->> 'category_key') stored primary key,
  raw           jsonb not null,
  display_label text generated always as (norte_txt(raw -> 'display_label')) stored,
  updated_at    timestamptz not null default now()
);

create table if not exists fx_rates (
  pair        text generated always as (raw ->> 'pair') stored primary key,
  raw         jsonb not null,
  rate        numeric generated always as (norte_num(raw -> 'rate')) stored,
  as_of       text    generated always as (norte_txt(raw -> 'as_of')) stored,
  updated_at  timestamptz not null default now()
);

create table if not exists reference_rates (
  index_key   text generated always as (raw ->> 'index') stored primary key,
  raw         jsonb not null,
  rate        numeric generated always as (norte_num(raw -> 'rate')) stored,
  as_of       text    generated always as (norte_txt(raw -> 'as_of')) stored,
  updated_at  timestamptz not null default now()
);

-- ===========================================================================
-- USER DATA
-- The half that does not exist today in any defensible form: the Apps Script
-- returns a user_id and the client simply asserts it from then on. Here the
-- database enforces it.
-- ===========================================================================

create table if not exists profiles (
  id            uuid primary key,
  display_name  text,
  risk_score    integer not null default 650 check (risk_score between 300 and 900),
  is_admin      boolean not null default false,
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists user_products (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  product_type    text not null check (product_type in ('card', 'account')),
  product_id      text not null,
  current_balance numeric,
  notes           text,
  created_at      timestamptz not null default now(),
  -- the same product cannot be held twice by one user
  unique (user_id, product_type, product_id)
);
create index if not exists user_products_user_idx on user_products (user_id);

create table if not exists movements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles (id) on delete cascade,
  ts                     timestamptz not null default now(),
  flow                   text not null check (flow in ('cc', 'debit')),
  direction              text check (direction in ('in', 'out')),
  merchant_category      text,
  amount                 numeric not null,
  recommended_product_id text,
  computed_benefit_mxn   numeric,
  notes                  text,
  -- a debit movement must say which way the money went; a card movement must
  -- say what was bought. The old sheet enforced neither.
  constraint movements_shape check (
    (flow = 'debit' and direction is not null) or
    (flow = 'cc'    and merchant_category is not null)
  )
);
create index if not exists movements_user_ts_idx on movements (user_id, ts desc);

-- ===========================================================================
-- ROW LEVEL SECURITY
-- Market data: readable by any signed-in user, writable only by the service
-- role that runs the seed. User data: each row belongs to exactly one person.
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['issuers','cards','card_rewards','card_perks','accounts',
                           'yield_tiers','term_tiers','conditional_boosts','categories',
                           'fx_rates','reference_rates']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists market_read on %I', t);
    execute format('create policy market_read on %I for select to authenticated using (true)', t);
  end loop;
exception when others then
  raise notice 'skipping market policies: %', sqlerrm;
end $$;

do $$
begin
  alter table profiles      enable row level security;
  alter table user_products enable row level security;
  alter table movements     enable row level security;

  drop policy if exists own_profile      on profiles;
  drop policy if exists own_profile_edit on profiles;
  drop policy if exists own_products     on user_products;
  drop policy if exists own_movements    on movements;

  create policy own_profile      on profiles      for select to authenticated using (id = auth.uid());
  create policy own_profile_edit on profiles      for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
  create policy own_products     on user_products for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy own_movements    on movements     for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when others then
  -- auth.uid() does not exist outside Supabase; the local test run lands here.
  raise notice 'skipping user policies (not a Supabase database): %', sqlerrm;
end $$;

-- ===========================================================================
-- BOOTSTRAP
-- One call returns exactly the shape core/ expects, with every raw row intact.
-- The keys are the engine's camelCase names, not the table names, because the
-- engine is the consumer and it is not the thing that should bend.
-- ===========================================================================

create or replace function bootstrap_market() returns jsonb
  language sql stable as $$
  select jsonb_build_object(
    'issuers',            (select coalesce(jsonb_agg(raw order by issuer_id),   '[]'::jsonb) from issuers),
    'cards',              (select coalesce(jsonb_agg(raw order by card_id),     '[]'::jsonb) from cards),
    'cardRewards',        (select coalesce(jsonb_agg(raw order by reward_id),   '[]'::jsonb) from card_rewards),
    'cardPerks',          (select coalesce(jsonb_agg(raw order by perk_id),     '[]'::jsonb) from card_perks),
    'accounts',           (select coalesce(jsonb_agg(raw order by account_id),  '[]'::jsonb) from accounts),
    'yieldTiers',         (select coalesce(jsonb_agg(raw order by tier_id),     '[]'::jsonb) from yield_tiers),
    'termTiers',          (select coalesce(jsonb_agg(raw order by term_id),     '[]'::jsonb) from term_tiers),
    'conditionalBoosts',  (select coalesce(jsonb_agg(raw order by boost_id),    '[]'::jsonb) from conditional_boosts),
    'categories',         (select coalesce(jsonb_agg(raw order by category_key),'[]'::jsonb) from categories),
    'fxRates',            (select coalesce(jsonb_agg(raw order by pair),        '[]'::jsonb) from fx_rates),
    'referenceRates',     (select coalesce(jsonb_agg(raw order by index_key),   '[]'::jsonb) from reference_rates)
  )
$$;
