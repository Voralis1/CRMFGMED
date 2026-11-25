// Charge le schéma réel (supabase/migrations) dans PGlite, met la base dans
// l'état de production (lead_id_par_entreprise.sql : unique (tenant_id,
// lead_id)), puis applique lead_id_par_vendeur_source.sql deux fois.
//
// La règle : unique (tenant_id, coalesce(vendeur_id), coalesce(source_id), lead_id).
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite({ extensions: { pgcrypto } })
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
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
grant usage on schema auth to authenticated, anon, service_role;
alter role service_role bypassrls;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','rls_sources_import.sql','jeton_source_serveur.sql','lead_id_par_entreprise.sql','entrepot_commande.sql'])
  await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
const FICHIER=fs.readFileSync(R+'sql/lead_id_par_vendeur_source.sql','utf8')
const ANCIEN=fs.readFileSync(R+'sql/lead_id_par_entreprise.sql','utf8')
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const unicites=async()=>(await q(`select c.relname n, pg_get_indexdef(i.indexrelid) d from pg_index i join pg_class c on c.oid=i.indexrelid
  where i.indrelid='public.commandes'::regclass and i.indisunique and pg_get_indexdef(i.indexrelid) ilike '%lead_id%' order by 1`))

// ---- une entreprise, deux vendeurs, deux boutiques ; une autre entreprise
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const A='aaaaaaaa-0000-0000-0000-00000000000a', B='aaaaaaaa-0000-0000-0000-00000000000b'
const WOO='bbbbbbbb-0000-0000-0000-000000000001', SHOP='bbbbbbbb-0000-0000-0000-000000000002'
await db.exec(`set session_replication_role = replica`)
await q(`insert into public.tenants (id, nom_entreprise) values ($1,'FG'),($2,'Autre')`,[T,T2])
for (const u of [A,B]) await q(`insert into auth.users values ($1,'x@x')`,[u])
const AO=(await q(`insert into public.pays (tenant_id,nom,code) values ($1,'Angola','AO') returning id`,[T]))[0].id
const AO2=(await q(`insert into public.pays (tenant_id,nom,code) values ($1,'Angola','AO') returning id`,[T2]))[0].id
await q(`insert into public.entrepots (tenant_id,nom,pays_id,actif) values ($1,'Angola',$2,true),($3,'Angola',$4,true)`,[T,AO,T2,AO2])
await db.exec(`set session_replication_role = origin`)

// Insertion directe, sans déclencheurs ni clés étrangères (replica) : seule
// l'unicité est jugée — c'est elle qu'on teste. Les index uniques restent
// appliqués en mode replica.
let n=0
const brute=async({t=T,pays=AO,vendeur=null,source=null,lead})=>{
  await db.exec(`set session_replication_role = replica`)
  try {
    return await q(`insert into public.commandes (lead_id,tenant_id,pays_id,vendeur_id,source_id,client_nom,client_telephone,produit,quantite,prix)
                    values ($1,$2,$3,$4,$5,'C','+244'||$6,'X',1,1) returning id`,[lead,t,pays,vendeur,source,String(++n)])
  } finally { await db.exec(`set session_replication_role = origin`) }
}
const passe=async(o)=>(await erreur(()=>brute(o)))===null
const refuse=async(o)=>/duplicate key|unique/i.test((await erreur(()=>brute(o)))||'')

// =====================================================================
// A. Avant : l'état de production (le bug)
// =====================================================================
check('avant : la règle est unique (tenant_id, lead_id)', (await unicites()).map(x=>x.n).join()==='commandes_tenant_lead_id_key', JSON.stringify(await unicites()))
check('avant : A importe sa 1042', await passe({vendeur:A,lead:'1042'}))
check('avant : B importe SA 1042 → refusée (le bug)', await refuse({vendeur:B,lead:'1042'}))

// =====================================================================
// B. Le fichier, deux fois
// =====================================================================
const photo=async()=>JSON.stringify(await q(`select * from public.commandes order by id`))
const avant=await photo()
for (const run of [1,2]) { const e=await erreur(()=>db.exec(FICHIER)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune commande modifiée', await photo()===avant)
const u=await unicites()
check('une seule unicité sur lead_id : la nouvelle', u.length===1 && u[0].n==='commandes_lead_id_vendeur_source_key', JSON.stringify(u))
check('… sur (tenant_id, coalesce(vendeur_id), coalesce(source_id), lead_id)',
  /\(tenant_id, COALESCE\(vendeur_id, '00000000-0000-0000-0000-000000000000'::uuid\), COALESCE\(source_id, '00000000-0000-0000-0000-000000000000'::uuid\), lead_id\)/.test(u[0]?.d||''), u[0]?.d)
check('idx_commandes_lead_id (recherche) toujours là', (await q(`select 1 from pg_indexes where indexname='idx_commandes_lead_id'`)).length===1)

// =====================================================================
// C. La règle
// =====================================================================
check('B importe sa 1042 → entre', await passe({vendeur:B,lead:'1042'}))
check('A réimporte sa 1042 → refusée (doublon réel)', await refuse({vendeur:A,lead:'1042'}))
check('B réimporte sa 1042 → refusée', await refuse({vendeur:B,lead:'1042'}))
check('A, boutique Woo, 1042 → entre (autre source que son CSV)', await passe({vendeur:A,source:WOO,lead:'1042'}))
check('A, boutique Shopify, 1042 → entre (un vendeur, deux boutiques)', await passe({vendeur:A,source:SHOP,lead:'1042'}))
check('A, Woo, 1042 encore → refusée (le ré-essai de WooCommerce)', await refuse({vendeur:A,source:WOO,lead:'1042'}))
check('sans vendeur ni source, « 7 » → entre', await passe({lead:'7'}))
check('sans vendeur ni source, « 7 » encore → refusée (coalesce : deux NULL se heurtent)', await refuse({lead:'7'}))
check('sans vendeur, source Woo, « 7 » → entre', await passe({source:WOO,lead:'7'}))
check('sans vendeur, source Woo, « 7 » encore → refusée', await refuse({source:WOO,lead:'7'}))
check('autre entreprise, même vendeur et même n° → entre', await passe({t:T2,pays:AO2,vendeur:A,lead:'1042'}))
check('casse différente « a1 » / « A1 » : deux numéros différents (comme avant)', await passe({vendeur:A,lead:'a1'}) && await passe({vendeur:A,lead:'A1'}))

// Par le vrai chemin (tous les déclencheurs) : l'import CSV de deux vendeurs.
const reel=(vendeur)=>erreur(()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,vendeur_id,client_nom,client_telephone,produit,quantite,prix,source)
  values ('CSV-55',$1,$2,$3,'C','+244 9','X',1,1,'csv')`,[T,AO,vendeur]))
check('vrai chemin (déclencheurs) : A puis B, n° « CSV-55 » → les deux entrent', (await reel(A))===null && (await reel(B))===null)
check('vrai chemin : A encore → refusée', /duplicate key/.test((await reel(A))||''))

// =====================================================================
// D. Relancer l'ancien fichier ne remet PAS l'ancienne règle
// =====================================================================
let e=await erreur(()=>db.exec(ANCIEN))
check('lead_id_par_entreprise.sql relancé : passe', e===null, String(e))
check('… et ne remet pas unique (tenant_id, lead_id)', (await unicites()).map(x=>x.n).join()==='commandes_lead_id_vendeur_source_key', JSON.stringify(await unicites()))

// =====================================================================
// E. Les garde-fous du fichier
// =====================================================================
// §3 : un index du même nom, sur d'autres colonnes → tout annulé, rien perdu
// On repart d'une table vide (elle contient maintenant des n° partagés).
await db.exec(`set session_replication_role = replica; delete from public.commandes; set session_replication_role = origin;`)
await db.exec(`drop index public.commandes_lead_id_vendeur_source_key;
  alter table public.commandes add constraint commandes_tenant_lead_id_key unique (tenant_id, lead_id);
  create unique index commandes_lead_id_vendeur_source_key on public.commandes (tenant_id, lead_id);`)
e=await erreur(()=>db.exec(FICHIER))
check('§3 : un index du même nom mais faux → refus nommé', /n'est pas celui attendu/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
check('… et l\'ancienne règle est toujours là (transaction annulée)', (await unicites()).some(x=>x.n==='commandes_tenant_lead_id_key'), JSON.stringify(await unicites()))
await db.exec(`drop index public.commandes_lead_id_vendeur_source_key`)

// §1 : des lignes que la nouvelle règle refuserait → arrêt, nommées, rien touché
await db.exec(`alter table public.commandes drop constraint commandes_tenant_lead_id_key`)
await brute({vendeur:A,lead:'DUP'}); await brute({vendeur:A,lead:'DUP'})
e=await erreur(()=>db.exec(FICHIER))
await db.exec('rollback').catch(()=>{})
check('§1 : doublon existant → arrêt, qui le nomme', /Arrêt :[\s\S]*n° « DUP » \(2 fois\)/.test(e||''), String(e))
check('… sans rien créer', (await unicites()).length===0, JSON.stringify(await unicites()))

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
