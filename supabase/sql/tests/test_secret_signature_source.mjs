// ⚠ RETIRÉ DU PRODUIT LE 20/10 : la signature n'est plus utilisée. Ce que
// teste cette suite (secret_signature_source.sql et son fichier 2) a été
// appliqué en production et y reste en sommeil. Suite gardée pour mémoire :
// elle passe toujours, elle ne décrit plus le produit.
// Charge le schéma réel (supabase/migrations) dans PGlite, rejoue les fichiers
// déjà en production (sources RLS, jeton, intake, lead_id, + les colonnes de
// limite), puis secret_signature_source.sql DEUX fois, et vérifie :
//   · le secret est tiré à la création, pour les sources existantes aussi,
//     sans allumer la vérification
//   · un utilisateur connecté ne lit plus signature_secret — ceo compris — mais
//     lit toutes les autres colonnes, y compris une ajoutée plus tard une fois
//     le fichier rejoué
//   · révéler / régénérer / coller / régler : qui peut, qui ne peut pas, l'audit
//   · rejouer les anciens fichiers (jeton, intake) ne défait rien
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createHash } from 'crypto'
import fs from 'fs'
const R = new URL('../../', import.meta.url).pathname
const db = new PGlite({ extensions: { pgcrypto } })
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok = 0, ko = 0
const check = (name, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)) }
const lire = (f) => fs.readFileSync(R + 'sql/' + f, 'utf8')
const jouer = async (f, nom = f) => {
  try { await db.exec(lire(f)); check(`${nom}`, true) } catch (e) { check(`${nom}`, false, e.message) }
}

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
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

// --- l'état de la production avant ce fichier ----------------------------------------
for (const f of ['rls_sources_import.sql', 'jeton_source_serveur.sql', 'intake_generique.sql', 'lead_id_par_entreprise.sql']) {
  try { await db.exec(lire(f)) } catch (e) { check(`préalable ${f}`, false, e.message) }
}
// Les deux colonnes du quota (19/10) n'ont pas de fichier dans le dépôt.
await db.exec(`alter table public.sources_import add column if not exists limite_appels_minute int not null default 60;
               alter table public.sources_import add column if not exists limite_leads_minute int not null default 600;`)
// Comme en production : authenticated a SELECT sur toute la table.
await db.exec(`grant usage on schema public, auth, extensions to authenticated, anon;
               grant all on all tables in schema public to authenticated, anon, service_role;
               grant execute on all functions in schema auth to authenticated, anon`)

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
U.managerB = await compte('manager', T2)
const sha = (t) => createHash('sha256').update(t).digest('hex')
await db.exec(`set session_replication_role = origin`)
// Triggers allumés : celui du préfixe (lead_id_par_entreprise.sql) pose prefixe_lead.
// Deux sources déjà en place, sans secret : une webhook, une feuille.
const S0 = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, token_apercu)
                     values ($1,'boutique','webhook',$2,$3,'aaaa') returning id`, [T1, U.seller, sha('a'.repeat(64))]))[0].id
const F0 = (await q(`insert into public.sources_import (tenant_id, nom, type, spreadsheet_id)
                     values ($1,'feuille','google_sheet','1AbC') returning id`, [T1]))[0].id

const comme = async (uid, fn) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; set test.uid = ''`) }
}
const essai = async (uid, sql, p) => comme(uid, async () => {
  try { const r = await q(sql, p); return { ok: true, rows: r } } catch (e) { return { ok: false, msg: e.message } }
})
const ligne = async (id) => (await q(`select * from public.sources_import where id=$1`, [id]))[0]
const SECRET = /^fgs_[0-9a-f]{48}$/

// --- 0. fichier 2 avant le fichier 1 : arrêt net, rien d'écrit ---------------------------
{
  let e = null
  try { await db.exec(lire('secret_signature_source_2_backfill.sql')) } catch (x) { e = x.message }
  check('fichier 2 avant le fichier 1 : refusé avec un message clair', /fichier 1/.test(e ?? ''), e)
  check('… et rien n\'a été écrit', (await ligne(S0)).signature_secret === null)
}

// --- 0 bis. le fichier 1, deux fois : sans risque, ne pose AUCUN secret ------------------
// C'est ce qui le rend sûr avant le déploiement : l'ancien import-commande
// vérifie dès qu'un secret existe.
await jouer('secret_signature_source.sql', 'secret_signature_source.sql run 1')
await jouer('secret_signature_source.sql', 'secret_signature_source.sql run 2')
{
  check('fichier 1 seul : la source existante n\'a toujours pas de secret', (await ligne(S0)).signature_secret === null)
  const r = await essai(U.seller, `select * from public.creer_source_import($1,'entre-deux','webhook',$2)`, [T1, U.seller])
  check('fichier 1 seul : une source créée n\'a pas de secret non plus', r.ok && (await ligne(r.rows[0].id)).signature_secret === null, r.msg)
  const nb = (await q(`select count(*)::int n from public.sources_import where signature_secret is not null`))[0].n
  check('fichier 1 seul : aucun secret nulle part', nb === 0, String(nb))
}

// --- 0 ter. le fichier 2, deux fois -------------------------------------------------------
await jouer('secret_signature_source_2_backfill.sql', 'secret_signature_source_2_backfill.sql run 1')
const apres1 = (await ligne(S0)).signature_secret
await jouer('secret_signature_source_2_backfill.sql', 'secret_signature_source_2_backfill.sql run 2')

// --- 1. les sources déjà en place -------------------------------------------------------
{
  const s = await ligne(S0)
  check('source existante : un secret fgs_ + 48 hex', SECRET.test(s.signature_secret ?? ''), s.signature_secret)
  check('… sans allumer la vérification (pas d\'en-tête)', s.signature_entete === null)
  check('… et rejouer le fichier 2 ne le change pas', s.signature_secret === apres1)
  check('feuille Google : pas de secret', (await ligne(F0)).signature_secret === null)
  check('le jeton déjà distribué n\'a pas bougé', s.token_hash === sha('a'.repeat(64)))
}

// --- 2. lire : tout sauf le secret ------------------------------------------------------
const COLONNES_PAGE = 'id, nom, type, actif, vendeur_id, spreadsheet_id, onglet, token_apercu, jeton_regenere_le, ' +
  'derniere_sync, derniere_erreur, created_at, signature_entete, signature_echecs, signature_dernier_echec, ' +
  'secret_change_le, secret_revele_le, prefixe_lead'
for (const role of ['seller', 'manager', 'admin', 'ceo', 'super_admin']) {
  let r = await essai(U[role], `select signature_secret from public.sources_import`)
  check(`${role} : select signature_secret refusé`, !r.ok && /permission denied/.test(r.msg), r.msg)
  r = await essai(U[role], `select ${COLONNES_PAGE} from public.sources_import`)
  check(`${role} : la requête de la page passe`, r.ok && r.rows.length > 0, r.msg)
}
{
  let r = await essai(U.manager, `select * from public.sources_import`)
  check('select * refusé (c\'est pourquoi la page liste ses colonnes)', !r.ok, r.msg)
  r = await essai(U.manager, `select limite_appels_minute, limite_leads_minute from public.sources_import`)
  check('les colonnes du 19/10 (limites) restent lisibles', r.ok, r.msg)
  r = await essai(U.seller, `select id from public.sources_import where signature_secret like 'fgs_%'`)
  check('deviner le secret par un WHERE : refusé aussi', !r.ok, r.msg)
  r = await essai(U.seller, `update public.sources_import set actif = false where id = $1 returning id`, [S0])
  check('seller : couper SA source marche toujours', r.ok && r.rows.length === 1, r.msg)
  r = await essai(U.seller, `update public.sources_import set nom = 'renommée', actif = true where id = $1`, [S0])
  check('seller : renommer / réactiver marche toujours', r.ok, r.msg)
  const priv = (await q(`select has_table_privilege('anon','public.sources_import','select') t,
                                has_column_privilege('anon','public.sources_import','nom','select') c`))[0]
  check('anon : aucun droit de lecture', !priv.t && !priv.c)
}

// --- 3. le garde : rien de la signature ne s'écrit à la main -----------------------------
for (const [nom, set] of [
  ['poser un secret faible', `signature_secret = '1234567890123456'`],
  ['allumer la vérification', `signature_entete = 'x-wc-webhook-signature'`],
  ['changer l\'algorithme', `signature_algo = 'sha1'`],
  ['remettre les échecs à zéro', `signature_echecs = 5`],
  ['effacer qui a vu le secret', `secret_revele_le = now()`],
  ['falsifier la date du changement', `secret_change_le = null`],
]) {
  for (const role of ['seller', 'manager']) {
    const r = await essai(U[role], `update public.sources_import set ${set} where id = $1`, [S0])
    check(`${role} : ${nom} refusé`, !r.ok && /(réglée par le serveur|permission denied)/.test(r.msg), r.msg)
  }
}
{
  const r = await essai(U.manager, `insert into public.sources_import (tenant_id, nom, type, spreadsheet_id, signature_secret)
                                    values ($1,'x','google_sheet','1x','fgs_choisi_par_moi_0000')`, [T1])
  check('insert avec un secret choisi refusé', !r.ok && /réglée par le serveur/.test(r.msg), r.msg)
}

// --- 4. tiré à la création ---------------------------------------------------------------
let SN
{
  let r = await essai(U.seller, `select * from public.creer_source_import($1,'shop','webhook',$2)`, [T1, U.seller])
  check('seller crée SA source', r.ok, r.msg)
  SN = r.rows?.[0]?.id
  const s = await ligne(SN)
  check('nouvelle source : secret tiré par la base', SECRET.test(s.signature_secret ?? ''), s.signature_secret)
  check('… vérification éteinte', s.signature_entete === null)
  check('… secret_change_par = le créateur', s.secret_change_par === U.seller)
  check('… le secret n\'est pas le jeton', s.signature_secret !== r.rows[0].jeton)
  r = await essai(U.seller, `select * from public.creer_source_import($1,'shop2','webhook',$2)`, [T1, U.seller])
  check('deux sources, deux secrets', (await ligne(r.rows[0].id)).signature_secret !== s.signature_secret)
  r = await essai(U.manager, `select * from public.creer_source_import($1,'f','google_sheet',null,'1Z',null)`, [T1])
  check('feuille Google créée : pas de secret', r.ok && (await ligne(r.rows[0].id)).signature_secret === null, r.msg)
}

// --- 5. révéler : plus de porte sans mot de passe ---------------------------------------
// La révélation (derrière le mot de passe) est dans identifiants_api.sql et
// se teste dans test_identifiants_api.mjs. Ici : la version sans mot de passe
// n'existe pas, et rejouer ce fichier ne la recrée pas.
{
  const existe = (await q(`select to_regprocedure('public.reveler_secret_source(uuid)') is not null x`))[0].x
  check('reveler_secret_source(uuid), sans mot de passe : n\'existe pas', !existe)
  const r = await essai(U.seller, `select public.reveler_secret_source($1)`, [S0])
  check('l\'appeler échoue', !r.ok, r.msg)
}

// --- 6. régénérer, coller, régler -------------------------------------------------------
{
  await q(`update public.sources_import set signature_echecs = 4, signature_dernier_echec = now() where id = $1`, [S0])
  const avant = (await ligne(S0)).signature_secret
  let r = await essai(U.seller, `select public.regenerer_secret_source($1) s`, [S0])
  const s = await ligne(S0)
  check('seller régénère : nouveau secret stocké', r.ok && SECRET.test(s.signature_secret ?? '') && s.signature_secret !== avant, r.msg)
  check('… et la fonction ne le REND pas (il se relit derrière le mot de passe)', r.ok && (r.rows[0].s === null || r.rows[0].s === ''), JSON.stringify(r.rows?.[0]))
  check('… échecs remis à zéro', s.signature_echecs === 0 && s.signature_dernier_echec === null)
  check('… secret_change_par = lui', s.secret_change_par === U.seller)
  r = await essai(U.ceo, `select public.regenerer_secret_source($1)`, [S0])
  check('ceo : régénérer refusé', !r.ok, r.msg)

  const SHOPIFY = 'a1b2c3d4e5f6'.repeat(5) + 'abcd'
  r = await essai(U.seller, `select public.definir_secret_source($1, $2)`, [S0, '  ' + SHOPIFY + '\n'])
  check('coller le secret Shopify (espaces autour retirés)', r.ok && (await ligne(S0)).signature_secret === SHOPIFY, r.msg)
  r = await essai(U.seller, `select public.definir_secret_source($1, 'court')`, [S0])
  check('secret trop court refusé', !r.ok && /invalide/.test(r.msg), r.msg)
  r = await essai(U.seller, `select public.definir_secret_source($1, 'un secret avec des espaces')`, [S0])
  check('secret avec espace refusé', !r.ok && /invalide/.test(r.msg), r.msg)
  r = await essai(U.seller, `select public.definir_secret_source($1, null)`, [S0])
  check('secret vide refusé', !r.ok, r.msg)
  r = await essai(U.ceo, `select public.definir_secret_source($1, $2)`, [S0, SHOPIFY])
  check('ceo : coller refusé', !r.ok, r.msg)

  r = await essai(U.seller, `select public.regler_signature_source($1, 'woocommerce')`, [S0])
  let t = await ligne(S0)
  check('régler WooCommerce : x-wc-webhook-signature, sha256, base64',
    r.ok && t.signature_entete === 'x-wc-webhook-signature' && t.signature_algo === 'sha256' && t.signature_encodage === 'base64', r.msg)
  r = await essai(U.seller, `select public.regler_signature_source($1, 'Shopify')`, [S0])
  t = await ligne(S0)
  check('régler Shopify (casse ignorée) : x-shopify-hmac-sha256', r.ok && t.signature_entete === 'x-shopify-hmac-sha256', r.msg)
  r = await essai(U.seller, `select public.regler_signature_source($1, 'aucune')`, [S0])
  t = await ligne(S0)
  check('aucune : vérification éteinte, secret gardé', r.ok && t.signature_entete === null && t.signature_secret === SHOPIFY, r.msg)
  r = await essai(U.seller, `select public.regler_signature_source($1, 'github')`, [S0])
  check('réglage inconnu refusé', !r.ok && /inconnu/.test(r.msg), r.msg)
  r = await essai(U.ceo, `select public.regler_signature_source($1, 'woocommerce')`, [S0])
  check('ceo : régler refusé', !r.ok, r.msg)
}

// --- 7. le compteur d'échecs -------------------------------------------------------------
{
  let r = await essai(U.manager, `select public.noter_echec_signature($1)`, [S0])
  check('authenticated : noter un échec refusé (on gonflerait le compteur d\'un autre)', !r.ok && /permission denied/.test(r.msg), r.msg)
  await db.exec(`set role service_role`)
  try { await q(`select public.noter_echec_signature($1)`, [S0]); await q(`select public.noter_echec_signature($1)`, [S0]) ; check('service_role : noter un échec', true) }
  catch (e) { check('service_role : noter un échec', false, e.message) }
  await db.exec(`reset role`)
  const s = await ligne(S0)
  check('… compté deux fois, date posée', s.signature_echecs === 2 && s.signature_dernier_echec !== null, JSON.stringify(s.signature_echecs))
  r = await essai(U.seller, `select signature_echecs, signature_dernier_echec from public.sources_import where id = $1`, [S0])
  check('le vendeur lit le compteur', r.ok && r.rows[0].signature_echecs === 2, r.msg)
  r = await essai(U.seller, `select public.regler_signature_source($1, 'woocommerce')`, [S0])
  check('changer de réglage remet le compteur à zéro', r.ok && (await ligne(S0)).signature_echecs === 0, r.msg)
}

// --- 8. la contrainte --------------------------------------------------------------------
{
  let e = null
  try { await q(`update public.sources_import set signature_secret = null where id = $1`, [S0]) } catch (x) { e = x.message }
  check('en-tête sans secret : refusé par la contrainte', /signature_complete/.test(e ?? ''), e)
  e = null
  try { await q(`update public.sources_import set signature_secret = 'court' where id = $1`, [S0]) } catch (x) { e = x.message }
  check('secret de moins de 16 caractères : refusé', /signature_complete/.test(e ?? ''), e)
}

// --- 9. une colonne ajoutée plus tard ----------------------------------------------------
{
  await db.exec(`alter table public.sources_import add column if not exists colonne_de_demain text`)
  let r = await essai(U.manager, `select colonne_de_demain from public.sources_import`)
  check('nouvelle colonne : invisible tant que le fichier n\'est pas rejoué', !r.ok, r.msg)
  await jouer('secret_signature_source.sql', 'secret_signature_source.sql run 3 (après ajout de colonne)')
  const r2 = await essai(U.seller, `select * from public.creer_source_import($1,'apres-rejeu-1','webhook',$2)`, [T1, U.seller])
  check('rejouer le fichier 1 n\'efface pas le tirage du fichier 2', r2.ok && SECRET.test((await ligne(r2.rows[0].id)).signature_secret ?? ''), r2.msg)
  r = await essai(U.manager, `select colonne_de_demain from public.sources_import`)
  check('… lisible après l\'avoir rejoué', r.ok, r.msg)
  r = await essai(U.manager, `select signature_secret from public.sources_import`)
  check('… et le secret toujours pas', !r.ok, r.msg)
}

// --- 10. rejouer les anciens fichiers ne défait rien ------------------------------------
{
  await jouer('jeton_source_serveur.sql', 'rejouer jeton_source_serveur.sql')
  await jouer('intake_generique.sql', 'rejouer intake_generique.sql (sources avec secret sans en-tête)')
  await jouer('rls_sources_import.sql', 'rejouer rls_sources_import.sql')
  let r = await essai(U.seller, `select * from public.creer_source_import($1,'apres','webhook',$2)`, [T1, U.seller])
  check('après rejeu : le secret est toujours tiré à la création', r.ok && SECRET.test((await ligne(r.rows[0].id)).signature_secret ?? ''), r.msg)
  r = await essai(U.seller, `update public.sources_import set signature_entete = 'x' where id = $1`, [S0])
  check('après rejeu : le garde tient toujours', !r.ok, r.msg)
  r = await essai(U.ceo, `select signature_secret from public.sources_import`)
  check('après rejeu : toujours illisible', !r.ok, r.msg)
}

// --- 10 bis. le service role lit toujours le secret ----------------------------------
// import-commande calcule le HMAC avec lui : s'il perdait ce droit, la
// vérification mourrait en silence.
{
  const d = async (role, col) => (await q(`select has_column_privilege($1,'public.sources_import',$2,'select') x`, [role, col]))[0].x
  check('service_role : lit signature_secret', await d('service_role', 'signature_secret'))
  check('service_role : lit nom', await d('service_role', 'nom'))
  check('authenticated : ne lit pas signature_secret', !(await d('authenticated', 'signature_secret')))
  check('authenticated : lit nom', await d('authenticated', 'nom'))
  check('anon : ne lit pas signature_secret', !(await d('anon', 'signature_secret')))
  await db.exec(`set role service_role`)
  let lu = null
  try { lu = (await q(`select signature_secret from public.sources_import where id = $1`, [S0]))[0]?.signature_secret } catch (e) { lu = 'ERREUR ' + e.message }
  await db.exec(`reset role`)
  check('service_role : lit VRAIMENT le secret (requête réelle)', typeof lu === 'string' && lu.length >= 16, String(lu))
  // Le garde du §9 : on retire le droit du service role, le fichier doit échouer.
  await db.exec(`revoke select on public.sources_import from service_role`)
  let e = null
  try { await db.exec(lire('secret_signature_source.sql')) } catch (x) { e = x.message }
  check('fichier rejoué alors que service_role ne lit plus : il échoue', /service_role ne lit plus/.test(e ?? ''), e)
  await db.exec(`grant all on public.sources_import to service_role`)
}

// --- 11. droits sur les fonctions -------------------------------------------------------
{
  const priv = async (role, fn) => (await q(`select has_function_privilege($1,$2,'execute') x`, [role, fn]))[0].x
  for (const fn of ['regenerer_secret_source(uuid)', 'definir_secret_source(uuid,text)',
                    'regler_signature_source(uuid,text)', 'noter_echec_signature(uuid)', 'source_geree(uuid)']) {
    check(`anon ne peut pas appeler ${fn}`, !(await priv('anon', 'public.' + fn)))
  }
  check('authenticated ne peut pas appeler source_geree (elle rend la ligne entière)', !(await priv('authenticated', 'public.source_geree(uuid)')))
}

console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
