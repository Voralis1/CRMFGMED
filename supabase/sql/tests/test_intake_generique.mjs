// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// rls_sources_import.sql et jeton_source_serveur.sql (en place en production),
// puis intake_generique.sql DEUX fois, et vérifie : commandes.articles,
// l'index unique du code produit par entreprise, le refus propre quand des
// codes sont en double, les colonnes et contraintes de signature, et qu'un
// vendeur peut poser le secret de SA source (le garde du jeton ne s'en mêle pas).
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
`)
let schema = fs.readFileSync(fs.readdirSync(R + 'migrations').map(f => R + 'migrations/' + f)[0], 'utf8')
schema = schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g, '').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g, '')
await db.exec(schema)
for (const f of ['rls_sources_import.sql', 'jeton_source_serveur.sql']) await db.exec(fs.readFileSync(R + 'sql/' + f, 'utf8'))

// --- données AVANT le fichier : deux entreprises, des produits ---------------
await db.exec(`set session_replication_role = replica`)
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222'
const P1 = '33333333-3333-3333-3333-333333333333'
const SELLER = '44444444-4444-4444-4444-444444444444'
await db.exec(`insert into public.tenants (id, nom_entreprise) values ('${T1}','A'),('${T2}','B')`)
await db.exec(`insert into public.pays (id, tenant_id, nom) values ('${P1}','${T1}','Sénégal')`)
await db.exec(`insert into public.produits (tenant_id, product, code) values
  ('${T1}','Crème','CE-50'), ('${T1}','Savon',null), ('${T1}','Huile',''), ('${T1}','Lait',''),
  ('${T2}','Autre crème','CE-50')`)
const roleSeller = (await q(`insert into public.roles (nom) values ('seller') returning id`))[0].id
await q(`insert into public.permissions (code, nom, module) values ('gerer_mes_sources','g','Administration') on conflict do nothing`)
await q(`insert into public.role_permissions values ($1,'gerer_mes_sources')`, [roleSeller])
await q(`insert into auth.users values ($1,'s@x')`, [SELLER])
await q(`insert into public.user_roles (user_id, role, tenant_id, role_id) values ($1,'seller',$2,$3)`, [SELLER, T1, roleSeller])
const SRC = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash)
  values ($1,'Woo','webhook',$2,'h1') returning id`, [T1, SELLER]))[0].id
await db.exec(`set session_replication_role = origin`)

const fichier = fs.readFileSync(R + 'sql/intake_generique.sql', 'utf8')
for (const run of [1, 2]) {
  try { await db.exec(fichier); check(`intake_generique.sql run ${run}`, true) } catch (e) { check(`intake_generique.sql run ${run}`, false, e.message) }
}

// --- 1. commandes.articles ---------------------------------------------------
const col = (await q(`select data_type from information_schema.columns where table_name='commandes' and column_name='articles'`))[0]
check('commandes.articles jsonb', col?.data_type === 'jsonb', JSON.stringify(col))
await db.exec(`set session_replication_role = replica`)
const insCmd = (lead, art) => q(`insert into public.commandes (lead_id, client_telephone, pays_id, tenant_id, articles) values ($1,'1',$2,$3,$4)`, [lead, P1, T1, art])
await insCmd('L1', JSON.stringify([{ produit: 'Crème', quantite: 2, prix: 12000, code: 'CE-50' }]))
check('une liste est acceptée', true)
await insCmd('L2', null); check('null accepté (les commandes d\'avant)', true)
await refuse('un objet seul est refusé', `insert into public.commandes (lead_id, client_telephone, pays_id, tenant_id, articles) values ('L3','1',$1,$2,'{"produit":"x"}')`, [P1, T1], 'commandes_articles_liste')
await db.exec(`set session_replication_role = origin`)

// --- 2. produits.code --------------------------------------------------------
const idx = (await q(`select indexdef from pg_indexes where indexname='idx_produits_code_unique'`))[0]?.indexdef ?? ''
check('index présent, par entreprise, sans casse', idx.includes('tenant_id') && idx.includes('lower(btrim(code))'), idx)
check('… partiel : codes vides et null hors index', idx.includes('WHERE'), idx)
await refuse('même code, même entreprise, autre casse + espaces : refusé', `insert into public.produits (tenant_id, product, code) values ($1,'Doublon',' ce-50 ')`, [T1], 'idx_produits_code_unique')
await refuse('B a déjà CE-50 : son propre doublon est refusé aussi', `insert into public.produits (tenant_id, product, code) values ($1,'Encore','CE-50')`, [T2], 'idx_produits_code_unique')
await q(`insert into public.produits (tenant_id, product, code) values ($1,'Neuf','NEW-1')`, [T2])
check('un code de A peut exister dans B (CE-50 dans les deux)', (await q(`select count(*)::int n from public.produits where code='CE-50'`))[0].n === 2)
await q(`insert into public.produits (tenant_id, product, code) values ($1,'Sans code 2',null), ($1,'Vide 3','')`, [T1])
check('plusieurs null / vides autorisés', true)

// Des doublons existants : le fichier refuse SANS rien toucher.
{
  const db2 = new PGlite()
  await db2.exec(`create table public.produits (id serial, tenant_id uuid, product text, code text);
    create table public.commandes (id serial); create table public.sources_import (id serial);
    create index idx_produits_code_unique on public.produits (code);
    insert into public.produits (tenant_id, product, code) values ('${T1}','a','X-1'), ('${T1}','b','x-1 ')`)
  try { await db2.exec(fichier); check('doublons existants : refus', false, 'accepté') }
  catch (e) { check('doublons existants : refus qui NOMME le code', e.message.includes('x-1') && e.message.includes('×2'), e.message) }
  const reste = (await db2.query(`select indexdef from pg_indexes where indexname='idx_produits_code_unique'`)).rows[0]?.indexdef ?? ''
  check('… et l\'ancien index n\'a pas été touché', reste.includes('(code)') && !reste.includes('tenant_id'), reste)
  await db2.close()
}

// --- 3. signature ------------------------------------------------------------
const s0 = (await q(`select signature_algo, signature_encodage, signature_entete, signature_secret from public.sources_import where id=$1`, [SRC]))[0]
check('source existante : sha256 / base64, pas de secret (rien ne change pour elle)',
  s0.signature_algo === 'sha256' && s0.signature_encodage === 'base64' && s0.signature_secret === null && s0.signature_entete === null, JSON.stringify(s0))
const maj = (champs) => q(`update public.sources_import set ${Object.keys(champs).map((k, i) => `${k}=$${i + 2}`).join(', ')} where id=$1`, [SRC, ...Object.values(champs)])
await refuse('algorithme inconnu refusé', `update public.sources_import set signature_algo='md5' where id=$1`, [SRC], 'signature_algo_valide')
await refuse('encodage inconnu refusé', `update public.sources_import set signature_encodage='base32' where id=$1`, [SRC], 'signature_encodage_valide')
await refuse('en-tête qui n\'en est pas un refusé', `update public.sources_import set signature_entete='x-sig: 1', signature_secret='0123456789abcdef' where id=$1`, [SRC], 'signature_entete_valide')
// Règle du 20/10 (secret_signature_source.sql) : le secret existe seul,
// c'est l'en-tête qui allume la vérification — et un en-tête exige un secret.
await refuse('en-tête sans secret refusé', `update public.sources_import set signature_entete='x-wc-webhook-signature' where id=$1`, [SRC], 'signature_complete')
await refuse('secret trop court refusé', `update public.sources_import set signature_entete='x-wc-webhook-signature', signature_secret='court' where id=$1`, [SRC], 'signature_complete')

// Le vendeur, connecté, configure SA source WooCommerce.
await db.exec(`set role authenticated; select set_config('test.uid','${SELLER}', false)`)
try {
  await maj({ signature_entete: 'x-wc-webhook-signature', signature_secret: 'ck_secret_de_woocommerce_123' })
  check('le vendeur pose le secret de SA source (RLS + garde du jeton laissent passer)', true)
} catch (e) { check('le vendeur pose le secret de SA source', false, e.message) }
const lu = (await q(`select signature_secret from public.sources_import where id=$1`, [SRC]))[0]
check('… et le relit en clair (il sert à calculer, il n\'est pas haché)', lu?.signature_secret === 'ck_secret_de_woocommerce_123', JSON.stringify(lu))
await refuse('le garde du jeton tient toujours', `update public.sources_import set token_hash='autre' where id=$1`, [SRC])
await db.exec(`reset role; select set_config('test.uid','', false)`)
await maj({ signature_entete: 'x-hub-signature-256', signature_encodage: 'hex', signature_prefixe: 'sha256=' })
check('configuration GitHub (hex + préfixe) acceptée', true)
await maj({ signature_entete: null })
check('retirer l\'en-tête = revenir au jeton seul (le secret reste)', true)
await maj({ signature_secret: '0123456789abcdef' })
check('secret sans en-tête accepté (vérification éteinte)', true)

// --- 4. le type de source n'a pas bougé --------------------------------------
const typ = (await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname='sources_import_type_valide'`))[0].d
check('sources_import.type inchangé (webhook / google_sheet)', !typ.includes('woocommerce'), typ)

console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
