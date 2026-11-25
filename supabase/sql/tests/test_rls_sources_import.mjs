// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// rls_sources_import.sql deux fois, puis vérifie qui peut lire / créer /
// modifier / supprimer une source, avec les permissions telles qu'en
// production le 15/10 (seller détient aussi gerer_sources_import).
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R = new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok = 0, ko = 0
const check = (name, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)) }

await db.exec(`
create role anon; create role authenticated; create role service_role; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`)
let schema = fs.readFileSync(fs.readdirSync(R + 'migrations').map(f => R + 'migrations/' + f)[0], 'utf8')
schema = schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g, '').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g, '')
await db.exec(schema)
const fichier = fs.readFileSync(R + 'sql/rls_sources_import.sql', 'utf8')
for (const run of [1, 2]) {
  try { await db.exec(fichier); check(`rls_sources_import.sql run ${run}`, true) } catch (e) { check(`run ${run}`, false, e.message) }
}
const pol = await q(`select policyname, roles::text r from pg_policies where tablename='sources_import'`)
check('4 politiques, toutes authenticated', pol.length === 4 && pol.every(p => p.r === '{authenticated}'), JSON.stringify(pol))

// --- données : deux entreprises, un compte par rôle -------------------------
await db.exec(`set session_replication_role = replica`)
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into public.tenants (id, nom_entreprise) values ('${T1}','A'),('${T2}','B')`)
const roles = ['seller', 'agent', 'livreur', 'manager', 'admin', 'ceo', 'super_admin']
const roleId = {}
for (const r of roles) roleId[r] = (await q(`insert into public.roles (nom) values ($1) returning id`, [r]))[0].id
// les permissions telles qu'en production le 15/10
const prod = {
  gerer_mes_sources: ['seller', 'super_admin'],
  gerer_sources_import: ['admin', 'manager', 'seller', 'super_admin'],
  menu_sources_import: ['admin', 'ceo', 'manager', 'seller', 'super_admin'],
}
for (const [code, rs] of Object.entries(prod)) {
  await q(`insert into public.permissions (code, nom, module) values ($1,$1,'Administration') on conflict do nothing`, [code])
  for (const r of rs) await q(`insert into public.role_permissions values ($1,$2)`, [roleId[r], code])
}
const U = {}
let n = 0
const compte = async (role, tenant) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await q(`insert into auth.users values ($1, $2)`, [id, id + '@x'])
  await q(`insert into public.user_roles (user_id, role, tenant_id, role_id) values ($1,$2,$3,$4)`, [id, role, tenant, roleId[role]])
  return id
}
for (const r of roles) U[r] = await compte(r, T1)
U.seller2 = await compte('seller', T1)
U.sellerB = await compte('seller', T2)
await db.exec(`set session_replication_role = origin`)
await db.exec(`grant usage on schema public, auth, extensions to authenticated; grant all on all tables in schema public to authenticated; grant execute on all functions in schema auth to authenticated`)

const comme = async (uid, fn) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; set test.uid = ''`) }
}
const H = 'h'.repeat(64)
let k = 0
const creer = (uid, vendeur, tenant = T1) => comme(uid, async () => {
  try {
    await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash) values ($1,'s','webhook',$2,$3)`, [tenant, vendeur, H + (++k)])
    return true
  } catch { return false }
})

// --- le trou d'origine ---------------------------------------------------------
check('agent ne crée pas de source à son nom', !(await creer(U.agent, U.agent)))
check('livreur ne crée pas de source à son nom', !(await creer(U.livreur, U.livreur)))
check('ceo ne crée pas de source (lit, n\'écrit pas)', !(await creer(U.ceo, null)))
check('seller crée SA source', await creer(U.seller, U.seller))
check('seller ne crée pas pour un autre vendeur (malgré gerer_sources_import)', !(await creer(U.seller, U.seller2)))
check('seller ne crée pas sans vendeur', !(await creer(U.seller, null)))
check('manager crée pour un vendeur', await creer(U.manager, U.seller2))
check('admin crée sans vendeur', await creer(U.admin, null))
check('manager ne donne pas la source à un compte d\'une autre entreprise', !(await creer(U.manager, U.sellerB)))
check('manager ne crée pas dans une autre entreprise', !(await creer(U.manager, null, T2)))
check('super_admin crée dans une autre entreprise', await creer(U.super_admin, null, T2))

// seller sans gerer_mes_sources : retiré depuis /super-admin/roles → plus rien
await q(`delete from public.role_permissions where role_id=$1 and permission_code='gerer_mes_sources'`, [roleId.seller])
check('seller sans gerer_mes_sources ne crée plus', !(await creer(U.seller, U.seller)))
await q(`insert into public.role_permissions values ($1,'gerer_mes_sources')`, [roleId.seller])

// --- lecture -------------------------------------------------------------------
const voit = (uid) => comme(uid, async () => (await q(`select count(*)::int n from public.sources_import`))[0].n)
check('seller voit ses sources seulement (1)', (await voit(U.seller)) === 1)
check('seller2 voit la sienne (1)', (await voit(U.seller2)) === 1)
check('ceo voit tout T1 (3)', (await voit(U.ceo)) === 3)
check('agent ne voit rien', (await voit(U.agent)) === 0)

// --- modification / suppression -------------------------------------------------
const maj = (uid, set, where = `vendeur_id = '${U.seller}'`) => comme(uid, async () => {
  try { return (await q(`update public.sources_import set ${set} where ${where} returning id`)).length } catch { return -1 }
})
check('seller régénère le jeton de SA source', (await maj(U.seller, `token_hash = '${'z'.repeat(64)}'`)) === 1)
check('seller ne donne pas sa source à un autre', (await maj(U.seller, `vendeur_id = '${U.seller2}'`)) !== 1)
check('seller ne touche pas la source de seller2', (await maj(U.seller, `actif = false`, `vendeur_id = '${U.seller2}'`)) === 0)
check('ceo ne coupe pas une source', (await maj(U.ceo, `actif = false`)) === 0)
check('agent ne coupe pas une source', (await maj(U.agent, `actif = false`)) === 0)
check('manager coupe une source', (await maj(U.manager, `actif = false`)) === 1)
const suppr = (uid, where) => comme(uid, async () => (await q(`delete from public.sources_import where ${where} returning id`)).length)
check('ceo ne supprime pas (0 ligne)', (await suppr(U.ceo, 'true')) === 0)
check('seller ne supprime pas celle de seller2 (0 ligne)', (await suppr(U.seller, `vendeur_id = '${U.seller2}'`)) === 0)
check('seller supprime la sienne', (await suppr(U.seller, `vendeur_id = '${U.seller}'`)) === 1)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
