// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// rls_sources_import.sql et jeton_source_serveur.sql (en place en production),
// met des commandes et des sources AVANT, puis lead_id_par_entreprise.sql
// DEUX fois, et vérifie : la contrainte par entreprise remplace la globale,
// les commandes gardent leur lead_id, le préfixe des sources (tiré du nom,
// sans accents, unique, figé dès la première commande), et que
// creer_source_import() d'un vendeur obtient un préfixe libre même quand un
// AUTRE vendeur — qu'il ne voit pas — a déjà pris le premier.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'fs'
const R = new URL('../../', import.meta.url).pathname
const db = new PGlite({ extensions: { pgcrypto } })
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok = 0, ko = 0
const check = (name, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)) }
const refuse = async (name, sql, p, motif) => {
  try { await q(sql, p); check(name, false, 'accepté') }
  catch (e) { check(name, !motif || e.message.includes(motif), e.message) }
}

await db.exec(`
create role anon; create role authenticated; create role service_role; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated;
`)
let schema = fs.readFileSync(fs.readdirSync(R + 'migrations').map(f => R + 'migrations/' + f)[0], 'utf8')
schema = schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g, '').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g, '')
await db.exec(schema)
for (const f of ['rls_sources_import.sql', 'jeton_source_serveur.sql']) await db.exec(fs.readFileSync(R + 'sql/' + f, 'utf8'))

// --- AVANT le fichier : deux entreprises, des commandes, des sources ---------
await db.exec(`set session_replication_role = replica`)
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222'
const P1 = '33333333-3333-3333-3333-333333333333', P2 = '55555555-5555-5555-5555-555555555555'
const S1 = '44444444-4444-4444-4444-444444444441', S2 = '44444444-4444-4444-4444-444444444442'
await db.exec(`insert into public.tenants (id, nom_entreprise) values ('${T1}','A'),('${T2}','B')`)
await db.exec(`insert into public.pays (id, tenant_id, nom) values ('${P1}','${T1}','Sénégal'),('${P2}','${T2}','Gabon')`)
const roleSeller = (await q(`insert into public.roles (nom) values ('seller') returning id`))[0].id
await q(`insert into public.permissions (code, nom, module) values ('gerer_mes_sources','g','Administration') on conflict do nothing`)
await q(`insert into public.role_permissions values ($1,'gerer_mes_sources')`, [roleSeller])
for (const u of [S1, S2]) {
  await q(`insert into auth.users values ($1::uuid,$2)`, [u, u + '@x'])
  await q(`insert into public.user_roles (user_id, role, tenant_id, role_id) values ($1,'seller',$2,$3)`, [u, T1, roleSeller])
}
const cmd = (lead, t, p, src = null) => q(`insert into public.commandes (lead_id, client_telephone, pays_id, tenant_id, source_id) values ($1,'1',$2,$3,$4) returning id`, [lead, p, t, src])
await cmd('MAN-1', T1, P1); await cmd('AUTO-ABC', T1, P1); await cmd('727', T1, P1)
const SRC_A = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, created_at)
  values ($1,'Boutique Dakar','webhook',$2,'h1', now() - interval '2 day') returning id`, [T1, S1]))[0].id
const SRC_B = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, created_at)
  values ($1,'Boutique Dakar 2 (été)','webhook',$2,'h2', now() - interval '1 day') returning id`, [T1, S2]))[0].id
const SRC_C = (await q(`insert into public.sources_import (tenant_id, nom, type, token_hash) values ($1,'Éléphant & Cie','webhook','h3') returning id`, [T2]))[0].id
const SRC_D = (await q(`insert into public.sources_import (tenant_id, nom, type, token_hash) values ($1,'!!!','webhook','h4') returning id`, [T2]))[0].id
await db.exec(`set session_replication_role = origin`)

const fichier = fs.readFileSync(R + 'sql/lead_id_par_entreprise.sql', 'utf8')
for (const run of [1, 2]) {
  try { await db.exec(fichier); check(`lead_id_par_entreprise.sql run ${run}`, true) } catch (e) { check(`lead_id_par_entreprise.sql run ${run}`, false, e.message) }
}

// --- 1. la contrainte ---------------------------------------------------------
const cons = await q(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.commandes'::regclass and contype='u'`)
check('commandes_lead_id_key (globale) retirée', !cons.some(c => c.conname === 'commandes_lead_id_key'), JSON.stringify(cons))
check('commandes_tenant_lead_id_key = UNIQUE (tenant_id, lead_id)', cons.some(c => c.conname === 'commandes_tenant_lead_id_key' && c.d === 'UNIQUE (tenant_id, lead_id)'), JSON.stringify(cons))
check('idx_commandes_lead_id gardé (recherche par lead_id)', (await q(`select 1 from pg_indexes where indexname='idx_commandes_lead_id'`)).length === 1)
const leads = (await q(`select lead_id from public.commandes order by lead_id`)).map(r => r.lead_id)
check('les commandes existantes gardent leur lead_id', JSON.stringify(leads) === JSON.stringify(['727', 'AUTO-ABC', 'MAN-1']), JSON.stringify(leads))
await db.exec(`set session_replication_role = replica`)
try { await cmd('727', T2, P2); check('727 dans une AUTRE entreprise : accepté (était refusé avant)', true) }
catch (e) { check('727 dans une AUTRE entreprise : accepté', false, e.message) }
await refuse('727 deux fois dans la MÊME entreprise : refusé', `insert into public.commandes (lead_id, client_telephone, pays_id, tenant_id) values ('727','1',$1,$2)`, [P1, T1], 'commandes_tenant_lead_id_key')
await db.exec(`set session_replication_role = origin`)

// Une contrainte du même nom sur de mauvaises colonnes est remplacée.
await db.exec(`alter table public.commandes drop constraint commandes_tenant_lead_id_key;
               alter table public.commandes add constraint commandes_tenant_lead_id_key unique (tenant_id, lead_id, client_telephone)`)
await db.exec(fichier)
const d2 = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname='commandes_tenant_lead_id_key'`))[0]?.d
check('mauvaise contrainte du même nom remplacée, pas gardée (§6.12)', d2 === 'UNIQUE (tenant_id, lead_id)', d2)

// --- 2. les préfixes ------------------------------------------------------------
const pre = async (id) => (await q(`select prefixe_lead from public.sources_import where id=$1`, [id]))[0]?.prefixe_lead
check('tiré du nom, 10 caractères au plus : "Boutique Dakar" → BOUTIQUEDA', (await pre(SRC_A)) === 'BOUTIQUEDA', await pre(SRC_A))
check('collision dans l\'entreprise → suffixe 2', (await pre(SRC_B)) === 'BOUTIQUEDA2', await pre(SRC_B))
check('sans accents : "Éléphant & Cie" → ELEPHANTCI', (await pre(SRC_C)) === 'ELEPHANTCI', await pre(SRC_C))
check('nom sans lettre → SRC', (await pre(SRC_D)) === 'SRC', await pre(SRC_D))
check('colonne NOT NULL', (await q(`select is_nullable from information_schema.columns where table_name='sources_import' and column_name='prefixe_lead'`))[0].is_nullable === 'NO')
await refuse('format refusé (tiret, trop long)', `update public.sources_import set prefixe_lead='SHOP-1' where id=$1`, [SRC_C], 'prefixe_lead_valide')
await refuse('même préfixe dans la même entreprise refusé', `update public.sources_import set prefixe_lead='BOUTIQUEDA' where id=$1`, [SRC_B], 'idx_sources_import_prefixe_lead')
await q(`update public.sources_import set prefixe_lead=' shop1 ' where id=$1`, [SRC_C])
check('saisi en minuscules avec espaces → SHOP1', (await pre(SRC_C)) === 'SHOP1', await pre(SRC_C))
await q(`update public.sources_import set prefixe_lead='BOUTIQUEDA' where id=$1`, [SRC_D])
check('le préfixe d\'une autre entreprise est libre ici', (await pre(SRC_D)) === 'BOUTIQUEDA', await pre(SRC_D))

// Le vendeur S1 crée une source « Boutique Dakar » : BOUTIQUEDA et
// BOUTIQUEDA2 sont pris, dont un par S2 qu'il ne voit pas (RLS).
await db.exec(`set role authenticated; select set_config('test.uid','${S1}', false)`)
const vus = (await q(`select count(*)::int n from public.sources_import`))[0].n
check('RLS : le vendeur ne voit que SA source', vus === 1, String(vus))
try {
  const r = (await q(`select * from public.creer_source_import($1,'Boutique Dakar','webhook',$2)`, [T1, S1]))[0]
  const p = (await q(`select prefixe_lead from public.sources_import where id=$1`, [r.id]))[0]?.prefixe_lead
  check('creer_source_import() : préfixe libre BOUTIQUEDA3 malgré la source invisible', p === 'BOUTIQUEDA3', p)
} catch (e) { check('creer_source_import() : préfixe libre', false, e.message) }

// Figé dès qu'une commande cite la source.
await q(`update public.sources_import set prefixe_lead='DAKAR' where id=$1`, [SRC_A])
check('sans commande, le vendeur peut encore le changer', (await pre(SRC_A)) === 'DAKAR', await pre(SRC_A))
await db.exec(`reset role; select set_config('test.uid','', false)`)
await db.exec(`set session_replication_role = replica`)
await cmd('DAKAR-1', T1, P1, SRC_A)
await db.exec(`set session_replication_role = origin`)
await db.exec(`set role authenticated; select set_config('test.uid','${S1}', false)`)
await refuse('une commande cite la source : préfixe figé', `update public.sources_import set prefixe_lead='AUTRE' where id=$1`, [SRC_A], 'figé')
try { await q(`update public.sources_import set actif=false where id=$1`, [SRC_A]); check('… mais couper la source reste possible', true) }
catch (e) { check('… mais couper la source reste possible', false, e.message) }
await db.exec(`reset role; select set_config('test.uid','', false)`)

console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
