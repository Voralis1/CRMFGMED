// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// rls_sources_import.sql puis jeton_source_serveur.sql (deux fois chacun), et
// vérifie : un utilisateur connecté ne peut plus poser la valeur du jeton
// (insert / update façon console, ancien chemin de la page), les fonctions
// tirent un jeton dont l'empreinte est celle que lit import-commande, et la
// régénération note qui et quand.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createHash } from 'crypto'
import fs from 'fs'
const R = new URL('../../', import.meta.url).pathname
const db = new PGlite({ extensions: { pgcrypto } })
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok = 0, ko = 0
const check = (name, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)) }

await db.exec(`
create role anon; create role authenticated; create role service_role; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create extension pgcrypto schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`)
let schema = fs.readFileSync(fs.readdirSync(R + 'migrations').map(f => R + 'migrations/' + f)[0], 'utf8')
schema = schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g, '').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g, '')
await db.exec(schema)
for (const f of ['rls_sources_import.sql', 'jeton_source_serveur.sql'])
  for (const run of [1, 2]) {
    try { await db.exec(fs.readFileSync(R + 'sql/' + f, 'utf8')); check(`${f} run ${run}`, true) } catch (e) { check(`${f} run ${run}`, false, e.message) }
  }

// --- données ----------------------------------------------------------------------
await db.exec(`set session_replication_role = replica`)
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into public.tenants (id, nom_entreprise) values ('${T1}','A'),('${T2}','B')`)
const roles = ['seller', 'agent', 'manager', 'admin', 'ceo', 'super_admin']
const roleId = {}
for (const r of roles) roleId[r] = (await q(`insert into public.roles (nom) values ($1) returning id`, [r]))[0].id
await q(`insert into public.permissions (code, nom, module) values ('gerer_mes_sources','g','Administration')`)
await q(`insert into public.role_permissions values ($1,'gerer_mes_sources')`, [roleId.seller])
const U = {}; let n = 0
const compte = async (role, tenant) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await q(`insert into auth.users values ($1,$2)`, [id, id + '@x'])
  await q(`insert into public.user_roles (user_id, role, tenant_id, role_id) values ($1,$2,$3,$4)`, [id, role, tenant, roleId[role]])
  return id
}
for (const r of roles) U[r] = await compte(r, T1)
U.seller2 = await compte('seller', T1)
// une source déjà en place (jeton distribué avant ce fichier)
const ANCIEN = 'a'.repeat(64)
const sha = (t) => createHash('sha256').update(t).digest('hex')
const S0 = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, token_apercu)
                     values ($1,'boutique','webhook',$2,$3,'aaaa') returning id`, [T1, U.seller, sha(ANCIEN)]))[0].id
await db.exec(`set session_replication_role = origin`)
await db.exec(`grant usage on schema public, auth, extensions to authenticated; grant all on all tables in schema public to authenticated; grant execute on all functions in schema auth to authenticated`)

const comme = async (uid, fn) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; set test.uid = ''`) }
}
const essai = async (uid, sql, p) => comme(uid, async () => {
  try { const r = await q(sql, p); return { ok: true, rows: r } } catch (e) { return { ok: false, msg: e.message } }
})

// --- 1. le chemin console / ancienne page est fermé -------------------------------
let r = await essai(U.seller, `insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, token_apercu)
                               values ($1,'x','webhook',$2,$3,'1234') returning id`, [T1, U.seller, sha('1234')])
check('seller : insert avec token_hash choisi (« 1234 ») refusé', !r.ok && /tiré par le serveur/.test(r.msg), r.msg)
r = await essai(U.manager, `insert into public.sources_import (tenant_id, nom, type, token_hash) values ($1,'x','webhook',$2)`, [T1, sha('x'.repeat(32))])
check('manager : insert avec token_hash refusé aussi', !r.ok && /tiré par le serveur/.test(r.msg), r.msg)
r = await essai(U.super_admin, `insert into public.sources_import (tenant_id, nom, type, token_hash) values ($1,'x','webhook',$2)`, [T1, sha('y'.repeat(32))])
check('super_admin connecté : insert avec token_hash refusé', !r.ok && /tiré par le serveur/.test(r.msg), r.msg)
r = await essai(U.seller, `update public.sources_import set token_hash = $1, token_apercu = '1234' where id = $2 returning id`, [sha('1234'), S0])
check('seller : update du token_hash de SA source refusé (ancien « Nouveau jeton »)', !r.ok && /tiré par le serveur/.test(r.msg), r.msg)
r = await essai(U.seller, `update public.sources_import set token_apercu = 'zzzz' where id = $1 returning id`, [S0])
check('seller : falsifier l\'aperçu refusé', !r.ok, r.msg)
r = await essai(U.seller, `update public.sources_import set jeton_regenere_par = null, jeton_regenere_le = null where id = $1 returning id`, [S0])
check('seller : update de l\'audit sans changement accepté (valeurs identiques)', r.ok, r.msg)
r = await essai(U.seller, `update public.sources_import set jeton_regenere_le = now() where id = $1 returning id`, [S0])
check('seller : falsifier la date de régénération refusé', !r.ok, r.msg)
r = await essai(U.seller, `update public.sources_import set actif = false, nom = 'renommée' where id = $1 returning id`, [S0])
check('seller : couper / renommer SA source reste possible', r.ok && r.rows.length === 1, r.msg)
const h0 = (await q(`select token_hash from public.sources_import where id=$1`, [S0]))[0].token_hash
check('le jeton déjà distribué n\'a pas bougé', h0 === sha(ANCIEN))
// service role / éditeur SQL : uid nul → laissé passer (§6.4)
const okSvc = (await q(`update public.sources_import set token_apercu = 'aaaa' where id = $1 returning id`, [S0])).length === 1
check('éditeur SQL (uid nul) : écriture du jeton laissée passer', okSvc)

// --- 2. la création par la fonction -------------------------------------------------
r = await essai(U.seller, `select * from public.creer_source_import($1,'shop','webhook',$2)`, [T1, U.seller])
check('seller crée SA source par la fonction', r.ok && r.rows.length === 1, r.msg)
const J = r.rows?.[0]?.jeton ?? ''
check('jeton : fgm_ + 48 hex (192 bits)', /^fgm_[0-9a-f]{48}$/.test(J), J)
const ligne = (await q(`select * from public.sources_import where id=$1`, [r.rows[0].id]))[0]
check('empreinte = sha256Hex du jeton (format lu par import-commande)', ligne.token_hash === sha(J))
check('aperçu = 4 derniers caractères', ligne.token_apercu === J.slice(-4))
check('created_by posé par la base', ligne.created_by === U.seller)
check('le jeton en clair n\'est stocké nulle part', !JSON.stringify(ligne).includes(J))
r = await essai(U.seller, `select * from public.creer_source_import($1,'shop2','webhook',$2)`, [T1, U.seller])
check('deux créations = deux jetons différents', r.ok && r.rows[0].jeton !== J)
r = await essai(U.agent, `select * from public.creer_source_import($1,'x','webhook',$2)`, [T1, U.agent])
check('agent : création refusée', !r.ok && /refusée/.test(r.msg), r.msg)
r = await essai(U.ceo, `select * from public.creer_source_import($1,'x','webhook',null)`, [T1])
check('ceo : création refusée', !r.ok, r.msg)
r = await essai(U.seller, `select * from public.creer_source_import($1,'x','webhook',$2)`, [T1, U.seller2])
check('seller : création pour un autre vendeur refusée', !r.ok, r.msg)
r = await essai(U.manager, `select * from public.creer_source_import($1,'x','webhook',null)`, [T2])
check('manager : création dans une autre entreprise refusée', !r.ok, r.msg)
r = await essai(U.manager, `select * from public.creer_source_import($1,'feuille','google_sheet',$2,'1AbC',null)`, [T1, U.seller2])
check('manager : feuille Google créée sans jeton', r.ok && r.rows[0].jeton === null, r.msg)

// --- 3. la régénération --------------------------------------------------------------
r = await essai(U.seller, `select public.regenerer_jeton_source($1) as j`, [S0])
check('seller régénère le jeton de SA source', r.ok, r.msg)
const J2 = r.rows?.[0]?.j ?? ''
const apres = (await q(`select * from public.sources_import where id=$1`, [S0]))[0]
check('nouvelle empreinte = sha256Hex du nouveau jeton', apres.token_hash === sha(J2))
check('l\'ancien jeton ne correspond plus', apres.token_hash !== sha(ANCIEN))
check('jeton_regenere_par = celui qui a cliqué', apres.jeton_regenere_par === U.seller)
check('jeton_regenere_le renseigné', apres.jeton_regenere_le !== null)
r = await essai(U.seller2, `select public.regenerer_jeton_source($1)`, [S0])
check('seller2 ne régénère pas la source de seller', !r.ok && /introuvable/.test(r.msg), r.msg)
r = await essai(U.seller2, `select public.regenerer_jeton_source(gen_random_uuid())`)
check('source inconnue : même message que source d\'un autre', !r.ok && /introuvable/.test(r.msg), r.msg)
r = await essai(U.ceo, `select public.regenerer_jeton_source($1)`, [S0])
check('ceo ne régénère pas', !r.ok, r.msg)
r = await essai(U.admin, `select public.regenerer_jeton_source($1) as j`, [S0])
const qui = (await q(`select jeton_regenere_par from public.sources_import where id=$1`, [S0]))[0].jeton_regenere_par
check('admin régénère, et l\'audit passe à lui', r.ok && qui === U.admin, r.msg)

// --- 4. droits ------------------------------------------------------------------------
const priv = async (role, fn) => (await q(`select has_function_privilege($1,$2,'execute') x`, [role, fn]))[0].x
check('anon ne peut pas appeler creer_source_import', !(await priv('anon', 'public.creer_source_import(uuid,text,text,uuid,text,text)')))
check('anon ne peut pas appeler regenerer_jeton_source', !(await priv('anon', 'public.regenerer_jeton_source(uuid)')))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
