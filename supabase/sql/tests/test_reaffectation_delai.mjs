// reaffectation_delai.sql (13/11, T21) — délai réglé par admin / manager / super admin, l'horloge (lun–ven 8–18, sam 8–12, dimanche fermé, heure du pays), les
// fuseaux, « Traiter » (l'agent du lead seulement), la réaffectation (ouvert / 2e agent →
// passe via « delai » / un seul agent : reste, sans marque / jamais retour / le moins chargé / autre pays non / Non joint non / entreprise suspendue non /
// lead d'avant l'installation non), la garde de historique_affectations.sql ; fichier deux fois (répétition comprise),
// retour arrière deux fois (historique gardé), fichier après. pg_cron remplacé par un cron.job de test.
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
const S=sansCron(lire('reaffectation_delai.sql')), SR=lire('reaffectation_delai_retour.sql')
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
const AG=async()=>(await q(`select id from public.agents where tenant_id=$1 and user_id=$2`,[T,U.agent]))[0].id
const lead=async(agent,extra={})=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'x',quantite:1,prix:1,ville_zone:'Luanda',adresse:'rue',agent_id:agent,...extra})).id
const pending=async(id,depuis="now() - interval '3 days'")=>db.exec(`select set_config('crm.liberation_rupture','oui',false); update public.commandes set statut_confirmation='Pending', agent_depuis=${depuis} where id='${id}'; select set_config('crm.liberation_rupture','',false);`)
const agentDe=async id=>(await q(`select agent_id from public.commandes where id=$1`,[id]))[0].agent_id
const ligne=async id=>(await q(`select * from public.commandes where id=$1`,[id]))[0]
const tourner=async()=>(await q(`select * from public.reaffecter_leads_en_retard()`))[0]
const mo=async(a,b,f)=>(await q(`select public.minutes_ouvrees(($1::timestamp at time zone $3), ($2::timestamp at time zone $3), $3) m`,[a,b,f]))[0].m
const agentB=async(nom='B',pays=AO,actif=true)=>{ const u=crypto.randomUUID(); await q(`insert into auth.users values ($1,$2)`,[u,nom+'@x']); await ins('user_roles',{user_id:u,tenant_id:T,role:'agent',email:nom+'@x'})
  return {id:(await ins('agents',{tenant_id:T,nom,user_id:u,pays_id:pays,actif})).id, user:u} }

await base()
for (const i of [1,2]) { const e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
check('tâche toutes les 5 minutes', (await q(`select schedule from cron.job where jobname='reaffecter-leads-en-retard'`))[0]?.schedule==='*/5 * * * *')
check('la répétition ne laisse rien (délai 60, pas de lead REPETITION, agent B parti)',
  (await q(`select delai_reaffectation_minutes d from public.tenants where id=$1`,[T]))[0].d===60
  && (await q(`select count(*)::int n from public.commandes where lead_id like 'REPETITION-T21%'`))[0].n===0
  && (await q(`select count(*)::int n from public.agents where nom='Répétition B'`))[0].n===0)

// --- l'horloge (lundi 17/11/2025)
check('lundi 9:00 → 10:00 = 60', await mo('2025-11-17 09:00','2025-11-17 10:00','Africa/Luanda')===60)
check('samedi 11:30 → lundi 8:30 = 60 (samedi jusqu\'à 12h, dimanche fermé)', await mo('2025-11-15 11:30','2025-11-17 08:30','Africa/Luanda')===60)
check('vendredi 17:00 → samedi 9:00 = 120', await mo('2025-11-14 17:00','2025-11-15 09:00','Africa/Luanda')===120)
check('samedi 12:00 → lundi 8:00 = 0', await mo('2025-11-15 12:00','2025-11-17 08:00','Africa/Luanda')===0)
check('lundi 6:00 → 7:30 (avant l\'ouverture) = 0', await mo('2025-11-17 06:00','2025-11-17 07:30','Africa/Luanda')===0)
check('lundi 17:30 → mardi 9:00 = 90', await mo('2025-11-17 17:30','2025-11-18 09:00','Africa/Luanda')===90)
const u1=(await q(`select public.minutes_ouvrees('2025-11-17 07:00+00','2025-11-17 08:00+00','Africa/Luanda') a, public.minutes_ouvrees('2025-11-17 07:00+00','2025-11-17 08:00+00','Africa/Dakar') b`))[0]
check('même heure, deux pays : Luanda 8–9 = 60, Dakar 7–8 = 0', u1.a===60 && u1.b===0, JSON.stringify(u1))

// --- les fuseaux
check('Angola → Africa/Luanda', (await q(`select fuseau from public.pays where id=$1`,[AO]))[0].fuseau==='Africa/Luanda')
const ML=(await ins('pays',{tenant_id:T,nom:'Mali',code:'ML',devise:'XOF'})).id
check('nouveau pays Mali → Africa/Bamako', (await q(`select fuseau from public.pays where id=$1`,[ML]))[0].fuseau==='Africa/Bamako')
check('code inconnu → UTC', (await ins('pays',{tenant_id:T,nom:'Zz',code:'ZZ',devise:'X'})).fuseau==='UTC')
let e=await erreur(()=>q(`update public.pays set fuseau='Pas/Un_Fuseau' where id=$1`,[ML])); check('fuseau inconnu refusé', e!==null, e)
for (const d of [4,481]) { e=await erreur(()=>q(`update public.tenants set delai_reaffectation_minutes=$2 where id=$1`,[T,d])); check(`délai ${d} min refusé (5 à 480)`, e?.includes('check'), e) }
// le délai, réglé par l'entreprise : admin et manager (et super admin), pas les autres
const fixer=(uid,min,t=T)=>sous(uid,'authenticated',()=>q(`select public.fixer_delai_reaffectation($1,$2) x`,[t,min]))
const delai=async()=>(await q(`select delai_reaffectation_minutes d from public.tenants where id=$1`,[T]))[0].d
for (const [qui,min] of [['admin',30],['manager',45],['super_admin',60]]) {
  e=await erreur(()=>fixer(U[qui],min)); check(`${qui} règle le délai (${min})`, e===null && await delai()===min, e) }
for (const qui of ['seller','agent','ceo','livreur']) {
  e=await erreur(()=>fixer(U[qui],10)); check(`${qui} ne règle pas le délai`, e?.includes('admin et le manager') && await delai()===60, e) }
e=await erreur(()=>fixer(MGR2,10,T)); check('le manager d\'une autre entreprise ne règle pas le nôtre', e?.includes('admin et le manager') && await delai()===60, e)
e=await erreur(()=>fixer(U.admin,3)); check('par la porte : 3 min refusé', e?.includes('entre 5 et 480'), e)
e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`update public.tenants set delai_reaffectation_minutes=10 where id=$1 returning id`,[T])))
check('l\'admin n\'écrit pas tenants en direct (seulement par la porte)', await delai()===60, e)

// --- l'horloge du lead
const A=await AG()
let l1=await lead(A)
let r=await ligne(l1)
check('un lead avec agent : agent_depuis posé', r.agent_depuis!==null && r.ouvert_le===null)
// --- « Traiter »
check('un manager qui ouvre n\'arrête pas l\'horloge', (await sous(U.manager,'authenticated',()=>q(`select public.marquer_lead_ouvert($1) x`,[l1])))[0].x===false)
check('l\'agent du lead clique « Traiter » → ouvert', (await sous(U.agent,'authenticated',()=>q(`select public.marquer_lead_ouvert($1) x`,[l1])))[0].x===true && (await ligne(l1)).ouvert_par===U.agent)
check('… une 2e fois : rien de plus', (await sous(U.agent,'authenticated',()=>q(`select public.marquer_lead_ouvert($1) x`,[l1])))[0].x===false)
e=await erreur(()=>sous(U.agent,'authenticated',()=>q(`select * from public.reaffecter_leads_en_retard()`)))
check('un compte connecté ne lance pas la réaffectation', e?.includes('permission denied'), e)

// --- la réaffectation
await pending(l1)
let t=await tourner(); check('lead ouvert, en retard → ne bouge pas', await agentDe(l1)===A, JSON.stringify(t))
let l2=await lead(A); await pending(l2)
t=await tourner(); r=await ligne(l2)
check('un seul agent → le lead reste chez lui, rien d\'autre (pas de marque)', r.agent_id===A && !('en_retard_le' in r) && t.restes>=1, JSON.stringify(t))
const B=await agentB('B'), C=await agentB('C', ML)
let l3=await lead(A); await pending(l3,'now()')
const busy=(await ins('commandes',{lead_id:'BUSY',tenant_id:T,pays_id:AO,client_nom:'b',client_telephone:'1',produit:'x',prix:1,agent_id:B.id})).id; await pending(busy,'now()')   // B a 1 « Pending » frais
t=await tourner(); r=await ligne(l2)
check('un 2e agent arrive → le lead qui attendait passe à B (pas C, autre pays)', r.agent_id===B.id, JSON.stringify(r.agent_id))
check('… via « delai » dans l\'historique, de A à B', (await q(`select count(*)::int n from public.historique_affectations where commande_id=$1 and via='delai' and avant_id=$2 and apres_id=$3`,[l2,A,B.id]))[0].n===1)
check('… B a une horloge neuve', (await ligne(l2)).agent_depuis > new Date(Date.now()-60000))
check('un lead pas encore en retard ne bouge pas', await agentDe(l3)===A)
await pending(l2)
t=await tourner(); r=await ligne(l2)
check('B le laisse attendre aussi → il ne revient pas à A : reste chez B', r.agent_id===B.id)
const D=await agentB('D')
t=await tourner()
check('un 3e agent D → il passe à D', await agentDe(l2)===D.id)
// choix : le moins chargé
const E=await agentB('E')
let l4=await lead(A); await pending(l4)
t=await tourner()
check('l\'agent choisi est le moins chargé (E : 0 en attente ; B et D : 1)', await agentDe(l4)===E.id, await agentDe(l4))
// statuts exclus et entreprise suspendue
let l5=await lead(A); await pending(l5); await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[l5])
let l6=await lead(A); await pending(l6); await q(`update public.tenants set statut='suspendu' where id=$1`,[T])
t=await tourner()
check('entreprise suspendue → rien ne bouge', await agentDe(l6)===A)
await q(`update public.tenants set statut='actif' where id=$1`,[T])
t=await tourner()
check('« Non joint » ne bouge pas', await agentDe(l5)===A)
check('… le Pending réactivé, lui, bouge', await agentDe(l6)!==A)
// avant l'installation
let l7=await lead(A); await db.exec(`select set_config('crm.liberation_rupture','oui',false); update public.commandes set statut_confirmation='Pending', agent_depuis=null, created_at=now() - interval '5 days' where id='${l7}'; select set_config('crm.liberation_rupture','',false);`)
t=await tourner()
check('un lead d\'avant l\'installation (horloge vide) part de l\'installation : ne bouge pas', await agentDe(l7)===A)
// changement d'agent à la main : horloge remise à zéro
await q(`update public.commandes set agent_id=$2 where id=$1`,[l1,B.id]); r=await ligne(l1)
check('changer l\'agent à la main : horloge neuve, « ouvert » effacé', r.ouvert_le===null && r.agent_depuis > new Date(Date.now()-60000))

// --- la garde dans historique_affectations.sql
const H=lire('historique_affectations.sql'); const g0=H.indexOf('do $garde_reaffectation$'), g1=H.indexOf('end $garde_reaffectation$;')+'end $garde_reaffectation$;'.length
e=await erreur(()=>db.exec(H.slice(g0,g1)))
check('historique_affectations.sql rejoué : historiser_affectation gardée (« delai » reste)', e===null
  && (await q(`select obj_description('public.historiser_affectation(text,public.commandes,uuid,uuid,boolean)'::regprocedure,'pg_proc') m`))[0].m==='fichier: reaffectation_delai.sql'
  && (await q(`select prosrc from pg_proc where proname='historiser_affectation'`))[0].prosrc.includes("'delai'"), e)

// --- retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : tâche arrêtée, colonnes et fonctions parties, historique « delai » gardé',
  (await q(`select count(*)::int n from cron.job`))[0].n===0
  && (await q(`select count(*)::int n from information_schema.columns where table_name in ('commandes','pays','tenants') and column_name in ('agent_depuis','ouvert_le','fuseau','delai_reaffectation_minutes')`))[0].n===0
  && (await q(`select to_regprocedure('public.fixer_delai_reaffectation(uuid,integer)') f`))[0].f===null
  && (await q(`select to_regprocedure('public.reaffecter_leads_en_retard()') f`))[0].f===null
  && (await q(`select count(*)::int n from public.historique_affectations where via='delai'`))[0].n>=2
  && !(await q(`select prosrc from pg_proc where proname='historiser_affectation'`))[0].prosrc.includes("'delai'"))
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
