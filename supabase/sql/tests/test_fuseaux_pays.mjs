// fuseaux_pays.sql + lib/fuseauxPays.mjs (13/11) — la liste officielle (IANA zone.tab) : 247 pays, les 182 du CRM
// couverts, la base dit la même chose que l'écran pour chaque pays, chaque fuseau connu de Postgres ; décalages et
// heure locale (été / hiver) ; garde-fou : un fuseau → posé, plusieurs → choisir, inconnu → refusé, fuseau d'un
// autre pays refusé, pays existants intacts, code changé → recalculé ; reaffectation_delai.sql rejoué garde la
// nouvelle liste ; fichier deux fois (répétition), retour arrière deux fois, fichier après.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
// PGlite n'a pas pg_cron : la tâche est enregistrée dans un cron.job de test (même nom, même horaire)
const sansCron=t=>t.replace("create extension if not exists pg_cron;","").replace("if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then","if false then")
const RD=sansCron(lire('reaffectation_delai.sql'))
const S=lire('fuseaux_pays.sql'), SR=lire('fuseaux_pays_retour.sql')
import { FUSEAUX_PAYS, fuseauxDuPays, decalageUTC, heureLocale, nomFuseau } from '../../../lib/fuseauxPays.mjs'
import { PAYS_MONDE } from '../../../lib/paysMonde.js'
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='22222222-2222-2222-2222-222222222222'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const SELLER2='aaaaaaaa-0000-0000-0000-000000000011', MGR2='aaaaaaaa-0000-0000-0000-000000000012'
let db, AO, ENT, LIV, n=0
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type.startsWith('json')?'{}':'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
async function base(){
  db=new PGlite()
  await db.exec(`
  create role anon; create role authenticated; create role service_role; create role supabase_admin;
  do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('test.uid', true),''),
                    nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
  create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  grant usage on schema auth to authenticated, anon, service_role;
  alter role service_role bypassrls;`)
  let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
  schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
  await db.exec(schema)
  for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql']) await db.exec(lire(f))
  await db.exec(`alter table public.commandes add column if not exists articles jsonb;
    alter table public.produits add column if not exists vendeur_id uuid references auth.users(id) on delete set null;`)
  await db.exec(lire('tests/fixtures/produit_de_commande_prod_29_10.sql')); await db.exec(lire('tests/fixtures/stats_dashboard_prod_29_10.sql'))
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'})
  await ins('tenants',{id:T2,nom_entreprise:'Autre'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:r+'@x'})
  }
  for (const [r,u] of [['seller',SELLER2]]) { await q(`insert into auth.users values ($1,'seller2@x')`,[u]); await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:'seller2@x'}) }
  await q(`insert into auth.users values ($1,'mgr2@x')`,[MGR2]); await ins('user_roles',{user_id:MGR2,tenant_id:T2,role:'manager',email:'mgr2@x'})
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,nom:'Livreur Joao',user_id:U.livreur,pays_id:AO,actif:true,zone:'Ailleurs'})).id
  await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:AO,actif:true})
  for (const [nom,code,ferme,decl,rap] of [['Pending','pending',false,false,false],['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
    ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql',
                   'commandes_statut_lot.sql','historique_affectations.sql','commandes_produit_id.sql','stock_livraison_autre_vendeur.sql','paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(lire(f))
  await db.exec(F); await db.exec(G)
  await db.exec(`create schema if not exists cron; create table if not exists cron.job (jobname text primary key, schedule text, command text);
    create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
      insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
    create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;`)
  // le lien statuts → tenants de prod (statuts_entreprise.sql, CASCADE), posé à la main ici
  await db.exec(`do $$ begin if not exists (select 1 from pg_constraint where conrelid='public.statuts'::regclass and confrelid='public.tenants'::regclass) then
    alter table public.statuts add constraint statuts_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete cascade; end if; end $$;`)
  // la politique de prod, lue le 12/11
  await db.exec(`drop policy if exists commandes_delete on public.commandes;
    create policy commandes_delete on public.commandes for delete to authenticated
      using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id()) and (public.mon_role() = any (array['admin','ceo','manager']))));`)
}

// --- la liste de l'écran (lib/fuseauxPays.mjs)
check('247 pays dans la liste officielle', Object.keys(FUSEAUX_PAYS).length===247)
const sansFuseau=PAYS_MONDE.filter(p=>!fuseauxDuPays(p.code).length).map(p=>p.code)
check('les 182 pays du CRM (paysMonde) ont tous un fuseau', PAYS_MONDE.length===182 && sansFuseau.length===0, sansFuseau.join(','))
check('RD Congo : Kinshasa et Lubumbashi', JSON.stringify(fuseauxDuPays('cd'))==='["Africa/Kinshasa","Africa/Lubumbashi"]')
const juillet=new Date('2025-07-01T12:00:00Z'), janvier=new Date('2025-01-15T12:00:00Z')
check('décalages : Luanda UTC+1, Dakar UTC+0, Kolkata UTC+5:30, São Paulo UTC−3', decalageUTC('Africa/Luanda',juillet)==='UTC+1' && decalageUTC('Africa/Dakar',juillet)==='UTC+0' && decalageUTC('Asia/Kolkata',juillet)==='UTC+5:30' && decalageUTC('America/Sao_Paulo',juillet)==='UTC−3', [decalageUTC('Africa/Luanda',juillet),decalageUTC('Africa/Dakar',juillet),decalageUTC('Asia/Kolkata',juillet),decalageUTC('America/Sao_Paulo',juillet)].join(' '))
check('heure d\'hiver / d\'été : Paris UTC+1 en janvier, UTC+2 en juillet', decalageUTC('Europe/Paris',janvier)==='UTC+1' && decalageUTC('Europe/Paris',juillet)==='UTC+2')
check('heure locale : 12:00 UTC = 13:00 à Luanda', heureLocale('Africa/Luanda',juillet)==='13:00', heureLocale('Africa/Luanda',juillet))
check('nom lisible : Buenos Aires', nomFuseau('America/Argentina/Buenos_Aires')==='Buenos Aires')

await base()
await db.exec(RD)
for (const i of [1,2]) { const e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }

// --- la même liste en base
const sql=Object.fromEntries((await q(`select c, public.fuseaux_du_pays(c) f from unnest($1::text[]) c`,[Object.keys(FUSEAUX_PAYS)])).map(r=>[r.c,r.f]))
const ecarts=Object.keys(FUSEAUX_PAYS).filter(c=>JSON.stringify(sql[c])!==JSON.stringify(FUSEAUX_PAYS[c]))
check('base = écran pour les 247 pays (fuseaux_du_pays = lib/fuseauxPays.mjs)', ecarts.length===0, ecarts.slice(0,10).join(','))
const inconnus=(await q(`select z from unnest($1::text[]) z where not exists (select 1 from pg_timezone_names where name=z)`,[[...new Set(Object.values(FUSEAUX_PAYS).flat())]])).map(r=>r.z)
check('chaque fuseau de la liste existe pour Postgres', inconnus.length===0, inconnus.slice(0,10).join(','))
check('fuseau_du_pays : AO → Luanda ; CD (deux) → rien ; ZZ → rien', (await q(`select public.fuseau_du_pays('AO') a, public.fuseau_du_pays('CD') b, public.fuseau_du_pays('ZZ') c`)).every(r=>r.a==='Africa/Luanda'&&r.b===null&&r.c===null))

// --- le garde-fou
const P=(v)=>ins('pays',{tenant_id:T,devise:'X',...v})
let r=await P({nom:'Mali',code:'ML'}); check('Mali sans fuseau → Africa/Bamako', r.fuseau==='Africa/Bamako')
let e=await erreur(()=>P({nom:'RDC',code:'CD'})); check('RD Congo sans fuseau → refusé, nomme les deux', e?.includes('plusieurs fuseaux') && e?.includes('Africa/Lubumbashi'), e)
r=await P({nom:'RDC',code:'CD',fuseau:'Africa/Lubumbashi'}); check('RD Congo + Lubumbashi → accepté', r.fuseau==='Africa/Lubumbashi')
e=await erreur(()=>P({nom:'AO2',code:'AO',fuseau:'Africa/Bamako'})); check('Angola avec le fuseau du Mali → refusé', e?.includes('n\'est pas celui'), e)
e=await erreur(()=>P({nom:'ZZ',code:'ZZ'})); check('code inconnu → refusé (plus d\'UTC en silence)', e?.includes('inconnu'), e)
e=await erreur(()=>P({nom:'XX',code:'ML',fuseau:'Pas/Un_Fuseau'})); check('fuseau inexistant → refusé', e!==null, e)
const ao=(await q(`select id, fuseau from public.pays where id=$1`,[AO]))[0]
check('le pays existant (Angola) n\'a pas bougé', ao.fuseau==='Africa/Luanda')
await q(`update public.pays set nom='Angola (Luanda)' where id=$1`,[AO]); check('renommer un pays ne touche pas son fuseau', (await q(`select fuseau from public.pays where id=$1`,[AO]))[0].fuseau==='Africa/Luanda')
const sn=(await P({nom:'Sénégal',code:'SN'})).id
await q(`update public.pays set code='GN' where id=$1`,[sn]); check('changer le code (SN → GN) recalcule le fuseau', (await q(`select fuseau from public.pays where id=$1`,[sn]))[0].fuseau==='Africa/Conakry')

// --- reaffectation_delai.sql rejoué : il garde la nouvelle liste
e=await erreur(()=>db.exec(RD))
check('reaffectation_delai.sql rejoué : fuseau_du_pays et pays_fuseau gardées', e===null
  && (await q(`select obj_description('public.fuseau_du_pays(text)'::regprocedure,'pg_proc') a, obj_description('public.pays_fuseau()'::regprocedure,'pg_proc') b`)).every(x=>x.a==='fichier: fuseaux_pays.sql'&&x.b==='fichier: fuseaux_pays.sql'), e)
e=await erreur(()=>P({nom:'ZZ2',code:'ZZ'})); check('… et un code inconnu reste refusé', e?.includes('inconnu'), e)

// --- retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : l\'ancienne liste (code inconnu → UTC), fuseaux_du_pays partie', (await P({nom:'ZZ3',code:'ZZ'})).fuseau==='UTC' && (await q(`select to_regprocedure('public.fuseaux_du_pays(text)') f`))[0].f===null)
check('retour : les pays créés gardent leur fuseau', (await q(`select fuseau from public.pays where nom='RDC'`))[0].fuseau==='Africa/Lubumbashi')
await q(`delete from public.pays where code='ZZ'`)
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
