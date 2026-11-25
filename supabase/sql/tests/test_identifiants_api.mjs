// ⚠ Signature retirée du produit le 20/10 : les tests de reveler_secret_source
// et de regenerer_secret_source portent sur des fonctions en sommeil (plus
// appelées par l'écran). Le reste de la suite décrit le produit en service.
// Charge le schéma réel (supabase/migrations) dans PGlite, rejoue ce qui est
// en production (sources RLS, jeton, intake, lead_id, limites, quota,
// secret_signature_source + son fichier 2), puis identifiants_api.sql DEUX
// fois, et vérifie :
//   · creer_source_api : clé lisible = celle dont token_hash est l'empreinte,
//     secret d'URL tiré, exigé ou non selon le type d'intégration
//   · cle_api et secret_url illisibles pour un utilisateur connecté, lisibles
//     par le service role
//   · reveler_secret_url : mot de passe vérifié par bcrypt, même réponse pour
//     « mauvais mot de passe » et « source interdite / inexistante », quota,
//     journal — y compris quand ça échoue
//   · régénérer, exiger, cohérence clé ↔ empreinte, rejeux
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
const sha = (t) => createHash('sha256').update(t).digest('hex')

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create extension pgcrypto schema extensions;
create table auth.users (id uuid primary key, email text, encrypted_password text);
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
await db.exec(`alter table public.sources_import add column if not exists limite_appels_minute int not null default 60;
               alter table public.sources_import add column if not exists limite_leads_minute int not null default 600;`)
// consommer_quota et api_quota n'ont pas de fichier dans le dépôt : copie de la
// définition lue en production le 19/10 (pg_get_functiondef).
await db.exec(`
create table public.api_quota (cle text not null, fenetre timestamptz not null, appels int not null default 0,
  unites int not null default 0, primary key (cle, fenetre));
alter table public.api_quota enable row level security;
CREATE OR REPLACE FUNCTION public.consommer_quota(p_cle text, p_unites integer DEFAULT 1, p_max_appels integer DEFAULT 60, p_max_unites integer DEFAULT 600, p_fenetre_sec integer DEFAULT 60)
 RETURNS TABLE(autorise boolean, appels integer, unites integer, restant integer, reset_dans integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_debut   timestamptz;
  v_appels  int;
  v_unites  int;
  v_ajout   int := greatest(coalesce(p_unites, 1), 0);
begin
  if coalesce(btrim(p_cle), '') = '' then
    raise exception 'Clé de quota vide';
  end if;
  if p_fenetre_sec is null or p_fenetre_sec < 1 then
    p_fenetre_sec := 60;
  end if;
  v_debut := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_fenetre_sec) * p_fenetre_sec);
  insert into public.api_quota as q (cle, fenetre, appels, unites)
  values (p_cle, v_debut, 1, v_ajout)
  on conflict (cle, fenetre) do update
     set appels = q.appels + 1,
         unites = q.unites + v_ajout
  returning q.appels, q.unites into v_appels, v_unites;
  if random() < 0.01 then
    delete from public.api_quota where fenetre < now() - interval '1 hour';
  end if;
  return query select
    (v_appels <= p_max_appels and v_unites <= p_max_unites),
    v_appels,
    v_unites,
    greatest(p_max_appels - v_appels, 0),
    greatest(ceil(extract(epoch from (v_debut + make_interval(secs => p_fenetre_sec) - clock_timestamp())))::int, 1);
end;
$function$;
revoke execute on function public.consommer_quota(text, int, int, int, int) from public, anon, authenticated;
`)
await db.exec(`grant usage on schema public, auth, extensions to authenticated, anon;
               grant all on all tables in schema public to authenticated, anon, service_role;
               grant execute on all functions in schema auth to authenticated, anon`)
// Le 20/10 en production : fichier 1, puis fichier 2.
for (const f of ['secret_signature_source.sql', 'secret_signature_source_2_backfill.sql']) {
  try { await db.exec(lire(f)) } catch (e) { check(`préalable ${f}`, false, e.message) }
}
// Le fichier 1 tel qu'il a TOURNÉ en production avait encore la révélation
// sans mot de passe, et une régénération qui rendait le secret. On les remet
// pour que le test parte du vrai état.
await db.exec(`
create or replace function public.reveler_secret_source(p_source uuid) returns text
  language plpgsql security definer set search_path to 'public' as $f$
declare v public.sources_import%rowtype;
begin v := public.source_geree(p_source); return v.signature_secret; end; $f$;
grant execute on function public.reveler_secret_source(uuid) to authenticated;
drop function public.regenerer_secret_source(uuid);
create function public.regenerer_secret_source(p_source uuid) returns text
  language plpgsql security definer set search_path to 'public' as $f$
declare v_secret text := public.tirer_secret_signature();
begin perform public.source_geree(p_source);
  update public.sources_import s set signature_secret = v_secret where s.id = p_source;
  return v_secret; end; $f$;
grant execute on function public.regenerer_secret_source(uuid) to authenticated;
`)

await db.exec(`set session_replication_role = replica`)
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into public.tenants (id, nom_entreprise) values ('${T1}','A'),('${T2}','B')`)
const roles = ['seller', 'agent', 'manager', 'admin', 'ceo', 'super_admin']
const roleId = {}
for (const r of roles) roleId[r] = (await q(`insert into public.roles (nom) values ($1) returning id`, [r]))[0].id
await q(`insert into public.permissions (code, nom, module) values ('gerer_mes_sources','g','Administration')`)
await q(`insert into public.role_permissions values ($1,'gerer_mes_sources')`, [roleId.seller])
const U = {}; let n = 0
// Mot de passe de chaque compte : 'mdp-' + son id, en bcrypt comme GoTrue.
const MDP = (id) => 'mdp-' + id
const compte = async (role, tenant) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  await q(`insert into auth.users values ($1,$2, extensions.crypt($3, extensions.gen_salt('bf', 4)))`, [id, id + '@x', MDP(id)])
  await q(`insert into public.user_roles (user_id, role, tenant_id, role_id) values ($1,$2,$3,$4)`, [id, role, tenant, roleId[role]])
  return id
}
for (const r of roles) U[r] = await compte(r, T1)
U.seller2 = await compte('seller', T1)
U.seller3 = await compte('seller', T1)
U.seller4 = await compte('seller', T1)
await db.exec(`set session_replication_role = origin`)
// Une source créée par l'ancienne porte, avant ce fichier.
const S0 = (await q(`insert into public.sources_import (tenant_id, nom, type, vendeur_id, token_hash, token_apercu)
                     values ($1,'ancienne','webhook',$2,$3,'aaaa') returning id`, [T1, U.seller, sha('a'.repeat(64))]))[0].id

const comme = async (uid, fn) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; set test.uid = ''`) }
}
const essai = async (uid, sql, p) => comme(uid, async () => {
  try { const r = await q(sql, p); return { ok: true, rows: r } } catch (e) { return { ok: false, msg: e.message } }
})
const ligne = async (id) => (await q(`select * from public.sources_import where id=$1`, [id]))[0]
const CLE = /^fgm_[0-9a-f]{48}$/, SURL = /^fgu_[0-9a-f]{48}$/
const journal = async (uid) => q(`select succes, motif, source_id, quoi from public.journal_revelations where user_id=$1 order by id`, [uid])

// --- 0. le fichier, deux fois ------------------------------------------------------------
await jouer('identifiants_api.sql', 'identifiants_api.sql run 1')
await jouer('identifiants_api.sql', 'identifiants_api.sql run 2')
const execPar = async (role, fn) => (await q(`select has_function_privilege($1,$2,'execute') x`, [role, fn]))[0].x
const SIGNATURE = ['reveler_secret_source(uuid,text)', 'regenerer_secret_source(uuid)', 'definir_secret_source(uuid,text)',
                   'regler_signature_source(uuid,text)', 'noter_echec_signature(uuid)']
// 23/10 : relancer ce fichier ne rouvre plus les deux portes de signature qu'il crée.
for (const fn of ['reveler_secret_source(uuid,text)', 'regenerer_secret_source(uuid)']) {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    check(`identifiants_api.sql relancé : ${fn} reste fermée à ${role}`, !(await execPar(role, 'public.' + fn)))
  }
}
{
  const s = await ligne(S0)
  check('source existante : rien d\'exigé, rien d\'inventé', s.secret_url_requis === false && s.cle_api === null && s.secret_url === null)
  const sans = (await q(`select to_regprocedure('public.reveler_secret_source(uuid)') is not null x`))[0].x
  check('la révélation SANS mot de passe (prod) est supprimée', !sans)
  const ret = (await q(`select prorettype::regtype::text t from pg_proc where oid = to_regprocedure('public.regenerer_secret_source(uuid)')`))[0].t
  check('regenerer_secret_source ne rend plus le secret (void)', ret === 'void', ret)
}

// --- 0 bis. les anciennes portes donnent le même état complet ------------------------------
{
  // La page EN LIGNE appelle creer_source_import et regenerer_jeton_source.
  let r = await essai(U.seller, `select * from public.creer_source_import($1,'via-ancienne-page','webhook',$2)`, [T1, U.seller])
  check('ancienne porte creer_source_import : marche toujours (page en ligne)', r.ok && CLE.test(r.rows?.[0]?.jeton ?? ''), r.msg)
  const s = r.ok ? await ligne(r.rows[0].id) : {}
  check('… et la source est COMPLÈTE : clé lisible = jeton rendu, secret d\'URL',
    s.cle_api === r.rows?.[0]?.jeton && s.token_hash === sha(s.cle_api ?? '') && SURL.test(s.secret_url ?? ''))
  check('… secret d\'URL NON exigé (la page en ligne donne une URL sans &secret=)', s.secret_url_requis === false)
  r = await essai(U.seller, `select public.regenerer_jeton_source($1) j`, [s.id])
  const s2 = await ligne(s.id)
  check('ancienne porte regenerer_jeton_source : rend le jeton, la clé lisible suit',
    r.ok && s2.cle_api === r.rows[0].j && s2.token_hash === sha(s2.cle_api) && s2.secret_url !== s.secret_url, r.msg)
}

// --- 0 ter. aucun chemin ne fabrique une source à moitié faite ------------------------------
{
  let e = null
  try { await q(`insert into public.sources_import (tenant_id, nom, type, token_hash, token_apercu) values ($1,'main','webhook',$2,'bbbb')`, [T1, sha('b'.repeat(52))]) } catch (x) { e = x.message }
  check('éditeur SQL : webhook sans clé lisible → refusé, avec le nom de la bonne fonction', /creer_source_api/.test(e ?? ''), e)
  e = null
  try { await q(`update public.sources_import set token_hash = $2 where id = $1`, [S0, sha('c'.repeat(52))]) } catch (x) { e = x.message }
  check('éditeur SQL : changer token_hash sans la clé lisible → refusé', /regenerer_identifiants_source/.test(e ?? ''), e)
  e = null
  try { await q(`update public.sources_import set cle_api = 'fgm_pas_la_bonne' where id = $1`, [S0]) } catch (x) { e = x.message }
  check('éditeur SQL : une clé lisible qui ne correspond pas → refusé', /ne correspond pas/.test(e ?? ''), e)
  const r = await essai(U.seller, `update public.sources_import set actif = false where id = $1 returning id`, [S0])
  check('une source d\'avant (sans clé lisible) reste modifiable tant que sa clé ne change pas', r.ok && r.rows.length === 1, r.msg)
  await q(`update public.sources_import set actif = true where id = $1`, [S0])
}

// --- 1. créer ------------------------------------------------------------------------------
let SB, SZ
{
  let r = await essai(U.seller, `select * from public.creer_source_api($1,'boutique','webhook',$2)`, [T1, U.seller])
  check('seller crée SA source boutique', r.ok && r.rows.length === 1, r.msg)
  SB = r.rows?.[0]?.id
  const s = await ligne(SB)
  check('clé API lisible, format fgm_', CLE.test(s.cle_api ?? ''), s.cle_api)
  check('… et c\'est bien la clé dont token_hash est l\'empreinte', s.token_hash === sha(s.cle_api))
  check('secret d\'URL fgu_, distinct de la clé et du secret de signature',
    SURL.test(s.secret_url ?? '') && s.secret_url !== s.cle_api && s.secret_url !== s.signature_secret, s.secret_url)
  check('boutique : secret d\'URL exigé par défaut', s.secret_url_requis === true)
  check('signature : secret tiré (fichier 2), vérification éteinte', /^fgs_/.test(s.signature_secret ?? '') && s.signature_entete === null)
  check('la fonction ne rend ni la clé ni le secret', !JSON.stringify(r.rows).includes('fg'))
  r = await essai(U.seller, `select * from public.creer_source_api($1,'zapier','webhook',$2,null,null,false)`, [T1, U.seller])
  SZ = r.rows?.[0]?.id
  const z = await ligne(SZ)
  check('Zapier / formulaire : secret d\'URL tiré mais NON exigé', r.ok && z.secret_url_requis === false && SURL.test(z.secret_url ?? ''), r.msg)
  r = await essai(U.manager, `select * from public.creer_source_api($1,'feuille','google_sheet',null,'1AbC',null)`, [T1])
  const f = r.ok ? await ligne(r.rows[0].id) : {}
  check('feuille Google : ni clé ni secret d\'URL', r.ok && f.cle_api === null && f.secret_url === null && f.secret_url_requis === false, r.msg)
  r = await essai(U.agent, `select * from public.creer_source_api($1,'x','webhook',$2)`, [T1, U.agent])
  check('agent : création refusée (droits de creer_source_import)', !r.ok, r.msg)
  r = await essai(U.ceo, `select * from public.creer_source_api($1,'x','webhook',null)`, [T1])
  check('ceo : création refusée', !r.ok, r.msg)
}

// --- 2. lire ---------------------------------------------------------------------------------
for (const role of ['seller', 'manager', 'ceo', 'super_admin']) {
  for (const col of ['cle_api', 'secret_url', 'signature_secret']) {
    const r = await essai(U[role], `select ${col} from public.sources_import`)
    check(`${role} : select ${col} refusé`, !r.ok && /permission denied/.test(r.msg), r.msg)
  }
  const r = await essai(U[role], `select id, nom, token_apercu, secret_url_requis, signature_entete, signature_echecs from public.sources_import`)
  check(`${role} : les colonnes de la page restent lisibles`, r.ok, r.msg)
}
{
  const d = async (role, col) => (await q(`select has_column_privilege($1,'public.sources_import',$2,'select') x`, [role, col]))[0].x
  check('service_role lit cle_api et secret_url (import-commande en a besoin)', (await d('service_role', 'cle_api')) && (await d('service_role', 'secret_url')))
  const r = await essai(U.manager, `select * from public.journal_revelations`)
  check('journal_revelations : illisible depuis le navigateur', !r.ok, r.msg)
}

// --- 3. le garde ----------------------------------------------------------------------------
for (const [nom, set] of [
  ['poser sa propre clé', `cle_api = 'fgm_moi'`],
  ['poser son secret d\'URL', `secret_url = 'fgu_moi'`],
  ['éteindre l\'exigence à la main', `secret_url_requis = false`],
]) {
  const r = await essai(U.seller, `update public.sources_import set ${set} where id = $1`, [SB])
  check(`seller : ${nom} refusé`, !r.ok && /tirés par le serveur|permission denied/.test(r.msg), r.msg)
}
{
  const r = await essai(U.manager, `insert into public.sources_import (tenant_id, nom, type, spreadsheet_id, secret_url_requis) values ($1,'x','google_sheet','1x',true)`, [T1])
  check('insert avec exigence posée à la main : refusé', !r.ok, r.msg)
  const r2 = await essai(U.seller, `update public.sources_import set actif = false, nom = 'renommée' where id = $1 returning id`, [SB])
  check('seller : couper / renommer marche toujours', r2.ok && r2.rows.length === 1, r2.msg)
  await q(`update public.sources_import set actif = true where id = $1`, [SB])
}

// --- 4. afficher la clé ---------------------------------------------------------------------
{
  let r = await essai(U.seller, `select * from public.identifiants_source($1)`, [SB])
  const s = await ligne(SB)
  check('seller : voit SA clé, sans mot de passe', r.ok && r.rows[0].cle === s.cle_api && r.rows[0].secret_url_requis === true, r.msg)
  check('… mais pas le secret d\'URL', r.ok && !JSON.stringify(r.rows[0]).includes(s.secret_url))
  r = await essai(U.manager, `select * from public.identifiants_source($1)`, [SB])
  check('manager : voit la clé', r.ok && r.rows[0].cle === s.cle_api, r.msg)
  for (const [qui, uid] of [['seller2', U.seller2], ['ceo', U.ceo], ['agent', U.agent]]) {
    r = await essai(uid, `select * from public.identifiants_source($1)`, [SB])
    check(`${qui} : clé refusée`, !r.ok && /introuvable/.test(r.msg), r.msg)
  }
  r = await essai(U.seller, `select * from public.identifiants_source($1)`, [S0])
  check('source d\'avant (clé hachée seulement) : clé NULL, pas d\'erreur', r.ok && r.rows[0].cle === null, r.msg)
}

// --- 5. révéler le secret d'URL -------------------------------------------------------------
const reveler = (uid, src, mdp) => essai(uid, `select * from public.reveler_secret_url($1,$2)`, [src, mdp])
{
  const s = await ligne(SB)
  let r = await reveler(U.seller, SB, MDP(U.seller))
  check('bon mot de passe : ok + le secret', r.ok && r.rows[0].ok === true && r.rows[0].secret === s.secret_url, r.msg)
  r = await reveler(U.seller, SB, 'mauvais')
  check('mauvais mot de passe : ok=false, PAS d\'exception', r.ok && r.rows[0].ok === false && r.rows[0].secret === null, r.msg)
  const faux = JSON.stringify(r.rows[0])
  r = await reveler(U.seller2, SB, MDP(U.seller2))
  check('bon mot de passe, source d\'un autre : réponse IDENTIQUE au mauvais mot de passe', r.ok && JSON.stringify(r.rows[0]) === faux, JSON.stringify(r.rows?.[0]))
  r = await reveler(U.seller2, '99999999-9999-9999-9999-999999999999', MDP(U.seller2))
  check('source inexistante : réponse IDENTIQUE', r.ok && JSON.stringify(r.rows[0]) === faux, JSON.stringify(r.rows?.[0]))
  r = await reveler(U.ceo, SB, MDP(U.ceo))
  check('ceo, bon mot de passe : refusé (il ne gère pas)', r.ok && r.rows[0].ok === false, r.msg)
  r = await reveler(U.manager, SB, MDP(U.manager))
  check('manager, bon mot de passe : ok', r.ok && r.rows[0].ok === true, r.msg)
  r = await reveler(U.seller2, SB, null)
  check('mot de passe vide : ok=false', r.ok && r.rows[0].ok === false, r.msg)
  r = await reveler(U.seller, S0, MDP(U.seller))
  check('source sans secret d\'URL : ok=false, même forme', r.ok && JSON.stringify(r.rows[0]) === faux, JSON.stringify(r.rows?.[0]))

  const j = await journal(U.seller)
  check('journal : chaque tentative du seller, réussies ET ratées', j.length === 3 &&
    j.map((x) => x.motif).join() === 'ok,refus,refus', JSON.stringify(j))
  check('journal : la tentative sur une source inexistante est notée aussi',
    (await journal(U.seller2)).some((x) => x.source_id === '99999999-9999-9999-9999-999999999999'))
}
// Le quota : 5 par minute.
{
  const res = []
  for (let i = 0; i < 7; i++) res.push((await reveler(U.seller3, SB, 'devine-' + i)).rows?.[0])
  check('5 essais passent jusqu\'au mot de passe (refus normaux)', res.slice(0, 5).every((x) => x.ok === false && x.reessayer_dans === 0), JSON.stringify(res.slice(0, 5)))
  check('6e et 7e : limités, avec un délai', res.slice(5).every((x) => x.ok === false && x.reessayer_dans > 0), JSON.stringify(res.slice(5)))
  const r = await reveler(U.seller3, SB, MDP(U.seller3))
  check('limité, même le BON mot de passe ne révèle rien', r.rows[0].ok === false && r.rows[0].secret === null, JSON.stringify(r.rows[0]))
  const j = await journal(U.seller3)
  check('journal : 5 refus puis 3 « limite »', j.map((x) => x.motif).join() === 'refus,refus,refus,refus,refus,limite,limite,limite', j.map((x) => x.motif).join())
  const r4 = await reveler(U.seller4, SB, 'x')
  check('le quota est par compte : un autre compte n\'est pas limité', r4.rows[0].reessayer_dans === 0, JSON.stringify(r4.rows[0]))
  // seller4 a donc déjà 1 essai dans la minute : on le remet à zéro pour le test suivant.
  await q(`delete from public.api_quota where cle like 'reveal%' || $1`, [U.seller4])
}
// Le secret de SIGNATURE : même clôture. Fermé depuis le 23/10 : on rouvre
// avec le fichier prévu pour, ce qui prouve au passage qu'il remet tout.
await jouer('signature_fonctions_rouvrir.sql', 'signature_fonctions_rouvrir.sql')
await jouer('signature_fonctions_rouvrir.sql', 'signature_fonctions_rouvrir.sql, rejoué')
{
  const s = await ligne(SB)
  let r = await essai(U.manager, `select * from public.reveler_secret_source($1,$2)`, [SB, MDP(U.manager)])
  check('signature : bon mot de passe → le secret de signature (pas celui d\'URL)',
    r.ok && r.rows[0].ok === true && r.rows[0].secret === s.signature_secret && r.rows[0].secret !== s.secret_url, r.msg)
  check('… « dernière lecture » notée', (await ligne(SB)).secret_revele_par === U.manager)
  r = await essai(U.manager, `select * from public.reveler_secret_source($1,'faux')`, [SB])
  const faux = JSON.stringify(r.rows?.[0])
  check('signature : mauvais mot de passe → ok=false, pas d\'exception', r.ok && r.rows[0].ok === false && r.rows[0].secret === null, r.msg)
  r = await essai(U.seller2, `select * from public.reveler_secret_source($1,$2)`, [SB, MDP(U.seller2)])
  check('signature : source d\'un autre → réponse IDENTIQUE', r.ok && JSON.stringify(r.rows[0]) === faux, JSON.stringify(r.rows?.[0]))
  r = await essai(U.ceo, `select * from public.reveler_secret_source($1,$2)`, [SB, MDP(U.ceo)])
  check('signature : ceo, bon mot de passe → refusé', r.ok && r.rows[0].ok === false, r.msg)
  const j = await journal(U.manager)
  check('journal : quoi = signature sur ces tentatives', j.slice(-2).every((x) => x.quoi === 'signature'), JSON.stringify(j.slice(-2)))

  // MÊME clé de quota : 3 essais sur l'un + 3 sur l'autre = 6 → le 6e est limité.
  const res = []
  for (let i = 0; i < 3; i++) res.push((await reveler(U.seller4, SB, 'x' + i)).rows[0])
  for (let i = 0; i < 3; i++) res.push((await essai(U.seller4, `select * from public.reveler_secret_source($1,$2)`, [SB, 'y' + i])).rows[0])
  check('quota PARTAGÉ entre les deux secrets : le 6e essai, quel qu\'il soit, est limité',
    res.slice(0, 4).every((x) => x.reessayer_dans === 0) && res[5].reessayer_dans > 0, JSON.stringify(res.map((x) => x.reessayer_dans)))

  // Régénérer la signature ne la montre pas.
  r = await essai(U.seller, `select public.regenerer_secret_source($1) x`, [SB])
  check('régénérer la signature ne rend rien', r.ok && (r.rows[0].x === null || r.rows[0].x === ''), JSON.stringify(r.rows?.[0]))
}
// Quota cassé : on ne révèle RIEN (fermé), contrairement à l'import.
{
  await db.exec(`alter function public.consommer_quota(text, int, int, int, int) rename to consommer_quota_cache`)
  const r = await reveler(U.manager, SB, MDP(U.manager))
  check('consommer_quota absent : la révélation échoue (fermé), le secret ne sort pas', !r.ok || r.rows[0].ok !== true, JSON.stringify(r.rows?.[0] ?? r.msg))
  await db.exec(`alter function public.consommer_quota_cache(text, int, int, int, int) rename to consommer_quota`)
}

// --- 6. régénérer, exiger -------------------------------------------------------------------
{
  const avant = await ligne(SB)
  let r = await essai(U.seller, `select public.regenerer_identifiants_source($1)`, [SB])
  const apres = await ligne(SB)
  check('régénérer : nouvelle clé, empreinte cohérente', r.ok && CLE.test(apres.cle_api ?? '') && apres.cle_api !== avant.cle_api && apres.token_hash === sha(apres.cle_api), r.msg)
  check('… nouveau secret d\'URL aussi (même URL, même fuite)', SURL.test(apres.secret_url ?? '') && apres.secret_url !== avant.secret_url)
  check('… l\'ancienne clé ne correspond plus', apres.token_hash !== sha(avant.cle_api))
  check('… le secret de signature ne bouge pas (il n\'est pas dans l\'URL)', apres.signature_secret === avant.signature_secret)
  check('… audit du jeton noté', apres.jeton_regenere_par === U.seller)
  r = await essai(U.seller2, `select public.regenerer_identifiants_source($1)`, [SB])
  check('seller2 : régénérer refusé', !r.ok, r.msg)
  r = await essai(U.ceo, `select public.regenerer_identifiants_source($1)`, [SB])
  check('ceo : régénérer refusé', !r.ok, r.msg)

  r = await essai(U.seller, `select public.regenerer_jeton_source($1) j`, [SB])
  const viaAncienne = await ligne(SB)
  check('l\'ancienne porte garde la clé affichée JUSTE (plus jamais de clé morte)', r.ok && viaAncienne.cle_api === r.rows[0].j && viaAncienne.token_hash === sha(viaAncienne.cle_api), r.msg)

  r = await essai(U.seller, `select public.exiger_secret_url($1, false)`, [SB])
  check('exiger : éteindre', r.ok && (await ligne(SB)).secret_url_requis === false, r.msg)
  r = await essai(U.seller, `select public.exiger_secret_url($1, true)`, [S0])
  const s0 = await ligne(S0)
  check('exiger sur une source sans secret : en tire un', r.ok && s0.secret_url_requis === true && SURL.test(s0.secret_url ?? ''), r.msg)
  r = await essai(U.ceo, `select public.exiger_secret_url($1, false)`, [S0])
  check('ceo : exiger refusé', !r.ok, r.msg)
  let e = null
  try { await q(`update public.sources_import set secret_url = null where id = $1`, [S0]) } catch (x) { e = x.message }
  check('exigé sans secret : refusé par la contrainte', /secret_url_complet/.test(e ?? ''), e)
}

// --- 7. rejeux -----------------------------------------------------------------------------
{
  await jouer('secret_signature_source.sql', 'rejouer secret_signature_source.sql')
  let r = await essai(U.manager, `select cle_api from public.sources_import`)
  check('après rejeu du fichier 1 : cle_api toujours illisible', !r.ok, r.msg)
  r = await essai(U.manager, `select secret_url from public.sources_import`)
  check('après rejeu du fichier 1 : secret_url toujours illisible', !r.ok, r.msg)
  await jouer('jeton_source_serveur.sql', 'rejouer jeton_source_serveur.sql (anciennes versions des portes)')
  r = await essai(U.seller, `select * from public.creer_source_import($1,'apres-rejeu-jeton','webhook',$2)`, [T1, U.seller])
  check('anciennes versions remises : créer échoue BRUYAMMENT, pas de source à moitié faite', !r.ok && /incomplète/.test(r.msg), r.msg)
  const nbIncompletes = (await q(`select count(*)::int n from public.sources_import where type='webhook' and cle_api is null and id <> $1`, [S0]))[0].n
  check('… aucune source webhook sans clé lisible n\'a été créée', nbIncompletes === 0, String(nbIncompletes))
  r = await essai(U.seller, `select public.regenerer_jeton_source($1)`, [SB])
  // Refusée par l'une ou l'autre règle (clé qui ne correspond plus, ou
  // source incomplète) : les deux messages nomment la bonne fonction.
  check('… régénérer par l\'ancienne version échoue bruyamment aussi', !r.ok && /regenerer_identifiants_source/.test(r.msg), r.msg)
  await jouer('identifiants_api.sql', 'identifiants_api.sql run 3 (répare les portes)')
  r = await essai(U.seller, `select * from public.creer_source_import($1,'apres-reparation','webhook',$2)`, [T1, U.seller])
  check('… rejouer identifiants_api.sql répare : l\'ancienne porte redonne une source complète', r.ok && (await ligne(r.rows[0].id)).cle_api === r.rows[0].jeton, r.msg)
  r = await essai(U.seller, `select * from public.creer_source_api($1,'apres-rejeu','webhook',$2)`, [T1, U.seller])
  const s = r.ok ? await ligne(r.rows[0].id) : {}
  check('après les rejeux : creer_source_api tire toujours clé + secret', r.ok && CLE.test(s.cle_api ?? '') && SURL.test(s.secret_url ?? ''), r.msg)

  // Le garde final : service_role privé de lecture → le fichier échoue.
  await db.exec(`revoke select on public.sources_import from service_role`)
  let e = null
  try { await db.exec(lire('identifiants_api.sql')) } catch (x) { e = x.message }
  check('service_role sans lecture : le fichier échoue', /service_role ne lit plus/.test(e ?? ''), e)
  await db.exec(`grant all on public.sources_import to service_role`)
}

// --- 8. droits sur les fonctions -------------------------------------------------------------
{
  const priv = async (role, fn) => (await q(`select has_function_privilege($1,$2,'execute') x`, [role, fn]))[0].x
  for (const fn of ['creer_source_api(uuid,text,text,uuid,text,text,boolean)', 'identifiants_source(uuid)',
                    'reveler_secret_url(uuid,text)', 'regenerer_identifiants_source(uuid)', 'exiger_secret_url(uuid,boolean)']) {
    check(`anon ne peut pas appeler ${fn}`, !(await priv('anon', 'public.' + fn)))
  }
  check('authenticated ne tire pas un secret d\'URL hors des portes', !(await priv('authenticated', 'public.tirer_secret_url()')))
  for (const fn of ['source_creer_complete(uuid,text,text,uuid,text,text,boolean)', 'source_regenerer_complete(uuid)',
                    'reveler_derriere_mot_de_passe(uuid,text,text)']) {
    check(`fonction interne ${fn} : fermée à authenticated`, !(await priv('authenticated', 'public.' + fn)))
    check(`fonction interne ${fn} : fermée à service_role`, !(await priv('service_role', 'public.' + fn)))
  }
  check('anon ne peut pas appeler reveler_secret_source(uuid,text)', !(await priv('anon', 'public.reveler_secret_source(uuid,text)')))
}

// --- 23/10 : fermer les cinq fonctions de signature -------------------------------------
{
  await jouer('signature_fonctions_fermer.sql', 'signature_fonctions_fermer.sql run 1')
  await jouer('signature_fonctions_fermer.sql', 'signature_fonctions_fermer.sql run 2')
  for (const fn of SIGNATURE) {
    check(`fermée, pas supprimée : ${fn}`, (await q(`select to_regprocedure($1) is not null x`, ['public.' + fn]))[0].x)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      check(`${fn} fermée à ${role}`, !(await execPar(role, 'public.' + fn)))
    }
  }
  await q(`delete from public.api_quota where cle like 'reveal%'`)
  const avant = (await journal(U.manager)).length
  let r = await essai(U.manager, `select * from public.reveler_secret_source($1,$2)`, [SB, MDP(U.manager)])
  check('manager, bon mot de passe : reveler_secret_source refusé (permission)', !r.ok && /permission denied/.test(r.msg || ''), JSON.stringify(r))
  check('… et rien n\'est écrit au journal (la fonction ne tourne pas)', (await journal(U.manager)).length === avant)
  // L'URL, elle, reste ouverte : même fonction interne, autre porte.
  r = await reveler(U.manager, SB, MDP(U.manager))
  check('reveler_secret_url marche toujours (même clôture interne, autre porte)', r.ok && r.rows[0].ok === true, JSON.stringify(r.rows?.[0] ?? r.msg))
  // Une nouvelle source tire encore son secret de signature (trigger, droits non vérifiés à l'exécution).
  const tire = (await q(`select count(*)::int n from public.sources_import where signature_secret is null and type = 'webhook'`))[0].n
  check('le trigger de tirage continue de remplir signature_secret', tire === 0, String(tire))

  // La vérification lève si un droit traîne.
  const verif = lire('signature_fonctions_fermer.sql').slice(lire('signature_fonctions_fermer.sql').indexOf('do $$'))
  await db.exec(`grant execute on function public.regler_signature_source(uuid,text) to anon`)
  let e = null; try { await db.exec(verif) } catch (x) { e = x.message }
  check('vérification : un droit oublié (anon) → lève et le nomme', /anon → public\.regler_signature_source/.test(e || ''), String(e))
  await db.exec(`revoke execute on function public.regler_signature_source(uuid,text) from anon`)
  await db.exec(`grant execute on function public.noter_echec_signature(uuid) to public`)
  e = null; try { await db.exec(verif) } catch (x) { e = x.message }
  check('vérification : un droit à PUBLIC → lève', /noter_echec_signature/.test(e || ''), String(e))
  await db.exec(`revoke execute on function public.noter_echec_signature(uuid) from public`)
  await db.exec(`alter function public.definir_secret_source(uuid,text) rename to definir_secret_source_cache`)
  e = null; try { await db.exec(verif) } catch (x) { e = x.message }
  check('vérification : une fonction supprimée → lève', /Fonction absente : public\.definir_secret_source/.test(e || ''), String(e))
  await db.exec(`alter function public.definir_secret_source_cache(uuid,text) rename to definir_secret_source`)

  // Relancer identifiants_api.sql (§6.16) ne rouvre rien.
  await jouer('identifiants_api.sql', 'identifiants_api.sql relancé après la fermeture')
  e = null; try { await db.exec(verif) } catch (x) { e = x.message }
  check('… les cinq restent fermées', e === null, String(e))
}

console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
