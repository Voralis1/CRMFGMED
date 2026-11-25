// appels_responsables.sql sur le schéma réel + ce qui le précède
// (statut_pending, leads_remontes, historique_statuts, renvoyer_en_attente) :
// qui lit et écrit `appels`, avant / après, et ce que stats_dashboard
// renvoie à un vendeur et à un manager.
// (en-tête repris de test_historique_statuts.mjs)
//   · refusé sans statut_pending.sql ;
//   · deux passages, aucune commande modifiée ;
//   · reprise des appels réels (pas les « en_attente »), marqués migration,
//     rejouable sans doublon ;
//   · une ligne par changement, par tous les chemins (navigateur, clé
//     service, éditeur SQL, insertion), aucune pour une adresse corrigée ;
//   · enregistrer_appel : appel + commande + historique en une transaction,
//     qui / commentaire / durée ; un refus n'écrit rien ; réglages non hérités ;
//   · garde : pas d'écriture à la main, pas de modification, pas de
//     suppression sauf avec la commande, pas de TRUNCATE ;
//   · la vue : responsables et ceo tout avec qui, vendeur ses commandes sans
//     qui, agent / livreur / autre entreprise rien, anon refusé.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
await db.exec(`
create role anon; create role authenticated; create role service_role; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
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
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql'])
  await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
// Comme en production : les droits par défaut de Supabase sur public.
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
const FP=fs.readFileSync(R+'sql/statut_pending.sql','utf8')
const FH=fs.readFileSync(R+'sql/historique_statuts.sql','utf8')
const FL=fs.readFileSync(R+'sql/leads_remontes.sql','utf8')
const FR=fs.readFileSync(R+'sql/renvoyer_en_attente.sql','utf8')
const FA=fs.readFileSync(process.env.FICHIER||R+'sql/appels_responsables.sql','utf8')
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}

// ---- deux entreprises
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', livreur:'aaaaaaaa-0000-0000-0000-000000000006',
          manager2:'aaaaaaaa-0000-0000-0000-000000000007', seller2:'aaaaaaaa-0000-0000-0000-000000000008', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const urCols=(await cols('user_roles')).map(c=>c.column_name)
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
for (const [r,u] of Object.entries(U)) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  const v={user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,'')}
  if (urCols.includes('nom')) v.nom = r==='manager' ? 'Mme Manager' : null
  if (urCols.includes('email')) v.email = r+'@x'
  await ins('user_roles',v)
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true}); await ins('entrepots',{tenant_id:T2,nom:'Angola',pays_id:AO2,actif:true})
for (const t of [T,T2]) for (const [nom,code,ferme,decl,rap] of [['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
  ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
  await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
const A1=(await ins('agents',{tenant_id:T,nom:'Agent Un',user_id:U.agent,pays_id:AO,actif:true})).id
await db.exec(`set session_replication_role = origin`)
await poserPermissions(db)

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,...extra})
const hist=async id=>q(`select * from public.historique_statuts where commande_id=$1 order by cree_le, statut_precedent nulls first`,[id])
const nbHist=async()=>(await q(`select count(*)::int n from public.historique_statuts`))[0].n



await db.exec(FP); await db.exec(FL); await db.exec(FH)
let e

// ---- deux vendeurs, des appels avec et sans agent
const c1=await commande({vendeur_id:U.seller, agent_id:A1})
const c2=await commande({vendeur_id:U.seller2})
await db.exec(`set session_replication_role = replica`)
const apAgent=(await ins('appels',{commande_id:c1.id,tenant_id:T,agent_id:A1,statut:'Unreached'})).id
const apS1=(await ins('appels',{commande_id:c1.id,tenant_id:T,agent_id:null,statut:'Cancelled',notes:'note seller'})).id
const apS2=(await ins('appels',{commande_id:c2.id,tenant_id:T,agent_id:null,statut:'Confirmed',notes:'note seller2'})).id
await db.exec(`set session_replication_role = origin`)
const voit=async(u)=>(await sous(u,'authenticated',()=>q(`select id from public.appels order by id`))).map(x=>x.id)
const stats=async(u)=>(await sous(u,'authenticated',()=>q(`select public.stats_dashboard($1, now()-interval '1 day', now()+interval '1 day') s`,[T])))[0].s

check('AVANT : seller2 lit l\'appel d\'une commande de seller', (await voit(U.seller2)).includes(apS1))
check('AVANT : le livreur lit les appels sans agent', (await voit(U.livreur)).length>=2)
check('AVANT : l\'agent lit les appels de ses leads', (await voit(U.agent)).includes(apAgent))
const statsVendeurAvant=await stats(U.seller2), statsManagerAvant=await stats(U.manager)
check('AVANT : stats_dashboard renvoie à seller2 des appels (> 0) dans ses données', statsVendeurAvant.totauxAgents.appels>0, JSON.stringify(statsVendeurAvant.totauxAgents))

const p0=JSON.stringify(await q(`select * from public.appels order by id`))
for (const run of [1,2]) { e=await erreur(()=>db.exec(FA)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune ligne d\'appels modifiée', JSON.stringify(await q(`select * from public.appels order by id`))===p0)

// lecture
const tous=[apAgent,apS1,apS2].sort()
for (const r of ['manager','admin','ceo','super_admin'])
  check(`${r} : lit tous les appels`, JSON.stringify((await voit(U[r])).filter(x=>tous.includes(x)).sort())===JSON.stringify(tous))
for (const r of ['seller','seller2','agent','livreur'])
  check(`${r} : ne lit plus aucun appel`, (await voit(U[r])).length===0)
check('manager d\'une autre entreprise : rien de celle-ci', (await voit(U.manager2)).every(x=>!tous.includes(x)))

// écriture
const insere=async(u)=>sous(u,'authenticated',()=>q(`insert into public.appels (commande_id,tenant_id,statut) values ($1,$2,'Unreached') returning id`,[c2.id,T])).then(()=>null,x=>x.message)
for (const r of ['manager','admin','super_admin']) check(`${r} : peut écrire un appel`, (await insere(U[r]))===null)
for (const r of ['ceo','seller','agent','livreur']) check(`${r} : ne peut pas écrire un appel`, /row-level security|permission denied/.test(await insere(U[r])||''))
const upd=await sous(U.ceo,'authenticated',()=>q(`update public.appels set notes='x' where id=$1 returning id`,[apS2]))
check('ceo : ne modifie rien (0 ligne)', upd.length===0)
const del=await sous(U.ceo,'authenticated',()=>q(`delete from public.appels where id=$1 returning id`,[apS2]))
check('ceo : ne supprime rien (0 ligne)', del.length===0)

// confirmer-appel (clé service) écrit toujours
const EA=`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`
e=await sous('','service_role',()=>q(EA,[c1.id,T,U.agent,A1,'Reminder','Unreached','rappel',8,null,{}])).then(()=>null,x=>x.message)
check('confirmer-appel (enregistrer_appel) écrit toujours', e===null, String(e))

// stats_dashboard
const statsVendeurApres=await stats(U.seller2), statsManagerApres=await stats(U.manager)
check('APRÈS : stats_dashboard renvoie 0 appel à seller2', statsVendeurApres.totauxAgents.appels===0, JSON.stringify(statsVendeurApres.totauxAgents))
check('APRÈS : ses KPI (commandes) inchangés', JSON.stringify(statsVendeurApres.kpis)===JSON.stringify(statsVendeurAvant.kpis))
check('APRÈS : le manager voit les mêmes chiffres qu\'avant (+ les appels écrits ici)',
  statsManagerApres.totauxAgents.appels>=statsManagerAvant.totauxAgents.appels && JSON.stringify(statsManagerApres.kpis)===JSON.stringify(statsManagerAvant.kpis))

// renvoyer_en_attente.sql passe APRÈS (il refuse avant) et ne rouvre rien,
// même relancé
const pol=async()=>JSON.stringify(await q(`select policyname, cmd, qual, with_check from pg_policies where tablename='appels' order by policyname`))
const pol0=await pol()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`renvoyer_en_attente.sql après, passage ${run} : accepté`, e===null, String(e)) }
check('… politiques de appels inchangées', await pol()===pol0)
check('… seller2, livreur, agent ne lisent toujours rien', (await voit(U.seller2)).length===0 && (await voit(U.livreur)).length===0 && (await voit(U.agent)).length===0)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
