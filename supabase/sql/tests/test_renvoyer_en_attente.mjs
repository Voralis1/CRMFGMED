// renvoyer_en_attente.sql sur le schéma réel + ce qui est en production
// (statut_pending, leads_remontes, historique_statuts). Ce que vérifie ce
// fichier est listé dans chaque section.
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
const FR=fs.readFileSync(process.env.FICHIER||R+'sql/renvoyer_en_attente.sql','utf8')
const FA=fs.readFileSync(R+'sql/appels_responsables.sql','utf8')
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


// =====================================================================
// A. Prérequis
// =====================================================================
let e=await erreur(()=>db.exec(FR))
check('sans leads_remontes.sql → refusé', /leads_remontes.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
await db.exec(FP); await db.exec(FL)
e=await erreur(()=>db.exec(FR))
check('sans historique_statuts.sql → refusé', /historique_statuts.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
await db.exec(FH)
// `appels` encore ouvert (politiques d'origine) → refusé, rien installé
e=await erreur(()=>db.exec(FR))
check('appels encore ouvert (avant appels_responsables.sql) → refusé', /Lancez d'abord appels_responsables.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
check('… rien installé (ni entree_file, ni nouveau corps)', (await q(`select count(*)::int n from information_schema.columns where table_name='commandes' and column_name='entree_file'`))[0].n===0
  && !(await q(`select prosrc from pg_proc where oid='public.statut_pending_commande()'::regprocedure`))[0].prosrc.includes('Renvoi refusé'))

// ---- des commandes et des appels
await db.exec(`set session_replication_role = replica`)
const L1=(await ins('livreurs',{tenant_id:T,nom:'Livreur Un',pays_id:AO,actif:true,zone:'Luanda'})).id
await db.exec(`set session_replication_role = origin`)
const c1=await commande({vendeur_id:U.seller, agent_id:A1})
const c2=await commande({vendeur_id:U.seller})
await db.exec(`set session_replication_role = replica`)
const ap1=(await ins('appels',{commande_id:c1.id,tenant_id:T,agent_id:A1,statut:'Unreached',notes:'Ne répond pas'})).id
const ap2=(await ins('appels',{commande_id:c2.id,tenant_id:T,agent_id:null,statut:'Cancelled'})).id
await db.exec(`set session_replication_role = origin`)

const voit=async(u)=>(await sous(u,'authenticated',()=>q(`select id from public.appels order by id`))).map(x=>x.id)
await db.exec(FA)
const politiques=async()=>JSON.stringify(await q(`select policyname, cmd, qual, with_check from pg_policies where tablename='appels' order by policyname`))
const polAvant=await politiques()

const photo=async()=>JSON.stringify(await q(`select id, statut_confirmation, updated_at, remonte_le from public.commandes order by id`))
const p0=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune commande modifiée', await photo()===p0)

// =====================================================================
// B. Ce fichier ne touche PAS aux politiques de `appels` (une seule
//    définition : appels_responsables.sql). Le relancer ne rouvre rien.
// =====================================================================
check('politiques de appels identiques après deux passages de ce fichier', await politiques()===polAvant)
check('… l\'agent ne lit toujours aucun appel', (await voit(U.agent)).length===0)
check('… le vendeur et le livreur non plus', (await voit(U.seller)).length===0 && (await voit(U.livreur)).length===0)
check('… le manager les lit', (await voit(U.manager)).includes(ap1) && (await voit(U.manager)).includes(ap2))
// un autre fichier rouvre `appels` (politique permissive en plus) → ce
// fichier refuse de s'installer, avec le nom du fichier à relancer
await db.exec(`create policy appels_rouvert on public.appels for select to authenticated using (agent_id is null)`)
e=await erreur(()=>db.exec(FR))
await db.exec('rollback').catch(()=>{})
check('appels rouvert par une autre politique → ce fichier refuse de finir', /Lancez d'abord appels_responsables.sql/.test(e||''), String(e))
await db.exec(`drop policy appels_rouvert on public.appels`)
check('le fichier ne contient aucune politique (ni create, ni drop policy)', !/\b(create|drop)\s+policy\b/i.test(FR))
// confirmer-appel (clé service → enregistrer_appel) écrit toujours l'appel d'un agent
const EA=`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`
e=await sous('','service_role',()=>q(EA,[c1.id,T,U.agent,A1,'Reminder','Unreached','rappeler',9,null,{}])).then(()=>null,x=>x.message)
check('confirmer-appel (enregistrer_appel) écrit toujours l\'appel de l\'agent', e===null, String(e))
check('… et l\'historique avec son nom', (await q(`select fait_par_nom n from public.historique_statuts where commande_id=$1 and statut='Reminder'`,[c1.id]))[0]?.n==='Agent Un')
check('4 politiques sur appels, pas une de plus', (await q(`select count(*)::int n from pg_policies where tablename='appels'`))[0].n===4)

// =====================================================================
// C. entree_file
// =====================================================================
const ef=async id=>(await q(`select entree_file, created_at, remonte_le from public.commandes where id=$1`,[id]))[0]
let x=await ef(c2.id)
check('entree_file = created_at tant que le lead n\'est pas remonté', String(x.entree_file)===String(x.created_at))
await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[c2.id])
const nR=(await sous(U.manager,'authenticated',()=>q(`select public.remonter_leads($1,$2) n`,[T,[c2.id]])))[0].n
x=await ef(c2.id)
check('remonté → entree_file = remonte_le', nR===1 && x.remonte_le && String(x.entree_file)===String(x.remonte_le), JSON.stringify(x))
await sous('','service_role',()=>q(EA,[c2.id,T,U.agent,A1,'Unreached','Unreached',null,4,null,{}]))
x=await ef(c2.id)
check('un appel efface la remontée → entree_file revient à created_at', x.remonte_le===null && String(x.entree_file)===String(x.created_at))
e=await erreur(()=>q(`update public.commandes set entree_file=now() where id=$1`,[c2.id]))
check('entree_file ne s\'écrit pas à la main', !!e, String(e))
const ordre=await q(`select lead_id from public.commandes where tenant_id=$1 order by entree_file desc, id desc`,[T])
check('le tri sur entree_file s\'exécute', ordre.length>0)


// =====================================================================
// D. « Renvoyer en attente » (§4)
// =====================================================================
const RETOUR=fs.readFileSync(R+'sql/renvoyer_en_attente_retour.sql','utf8')
const st=async id=>(await q(`select statut_confirmation s from public.commandes where id=$1`,[id]))[0].s
const neuve=async(extra={})=>{ const c=await commande({vendeur_id:U.seller, agent_id:A1, ...extra}); await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[c.id]); return c }
const parNavigateur=async(u,id)=>sous(u,'authenticated',()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1 returning id`,[id])).then(r=>r.length===1?null:'0 ligne (RLS)',x=>x.message)

for (const role of ['seller','agent','ceo']) {
  const c=await neuve(); e=await parNavigateur(U[role],c.id)
  check(`${role} depuis la console → refusé (rôle)`, /seuls un manager, un admin ou un super admin/.test(e||'') && await st(c.id)==='Unreached', String(e))
}
for (const role of ['manager','admin','super_admin']) {
  const c=await neuve(); e=await parNavigateur(U[role],c.id)
  check(`${role} → accepté`, e===null && await st(c.id)==='Pending', String(e))
}
let c=await neuve()
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[c.id]))
check('éditeur SQL (personne) → refusé', /il se fait depuis Commandes/.test(e||''), String(e))
e=await sous('','service_role',()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[c.id])).then(()=>null,x=>x.message)
check('clé service sans personne (import) → refusé', /il se fait depuis Commandes/.test(e||''), String(e))

// un livreur a la commande
c=await neuve()
await q(`insert into public.livraisons (commande_id, livreur_id, statut, tenant_id) values ($1,$2,'a_preparer',$3)`,[c.id,L1,T])
e=await parNavigateur(U.manager,c.id)
check('livreur sur la commande → manager refusé, livreur et état nommés', /Renvoi refusé : le livreur Livreur Un a cette commande \(livraison à préparer\)/.test(e||''), String(e))
e=await parNavigateur(U.super_admin,c.id)
check('… super_admin refusé aussi', /Renvoi refusé : le livreur/.test(e||''), String(e))
e=await parNavigateur(U.seller,c.id)
check('… le vendeur, lui, est refusé par son rôle et n\'apprend PAS le nom du livreur', /seuls un manager/.test(e||'') && !/Livreur Un/.test(e||''), String(e))
const mv0=(await q(`select count(*)::int n from public.mouvements_stock`))[0].n

// le chemin de confirmer-appel
const EA2=`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`
c=await neuve()
const nbAppels=async()=>(await q(`select count(*)::int n from public.appels`))[0].n
let a0=await nbAppels()
e=await sous('','service_role',()=>q(EA2,[c.id,T,U.agent,A1,'Pending','Unreached','Renvoyé en attente : x',null,null,{}])).then(()=>null,x=>x.message)
check('confirmer-appel pour un agent → refusé, et aucun appel écrit', /seuls un manager/.test(e||'') && await nbAppels()===a0 && await st(c.id)==='Unreached', String(e))
e=await sous('','service_role',()=>q(EA2,[c.id,T,U.manager,null,'Pending','Unreached','Renvoyé en attente : confirmée par erreur',null,null,{}])).then(()=>null,x=>x.message)
const hR=(await q(`select * from public.historique_statuts where commande_id=$1 and statut='Pending' and statut_precedent='Unreached'`,[c.id]))[0]
check('confirmer-appel pour un manager → accepté', e===null && await st(c.id)==='Pending', String(e))
check('… ligne d\'historique : qui, motif, sans durée, via confirmer-appel',
  hR?.fait_par===U.manager && hR?.note==='Renvoyé en attente : confirmée par erreur' && hR?.duree_secondes===null && hR?.via==='confirmer-appel', JSON.stringify(hR))
check('aucun mouvement de stock créé par un renvoi', (await q(`select count(*)::int n from public.mouvements_stock`))[0].n===mv0)

// rien d'autre n'a changé
check('une commande neuve est toujours « Pending »', await st((await commande()).id)==='Pending')
c=await commande(); await q(`update public.commandes set statut_confirmation='Pending', client_nom='Z' where id=$1`,[c.id])
check('Pending → Pending (réécrit) : accepté, sans personne', await st(c.id)==='Pending')
c=await commande(); await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[c.id])
check('un changement ordinaire passe toujours (éditeur SQL)', await st(c.id)==='Confirmed')

// =====================================================================
// E. Faute dans §4 → le fichier s'arrête, rien n'est installé
// =====================================================================
const corpsAvant=(await q(`select md5(prosrc) h from pg_proc where oid='public.statut_pending_commande()'::regprocedure`))[0].h
const FAUTIF=FR.replace("l.commande_id = new.id","l.commande_idd = new.id")
check('(témoin : la faute est bien injectée)', FAUTIF!==FR)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('colonne mal écrite dans §4 → arrêt à la répétition, avec la raison', /RÉPÉTITION ÉCHOUÉE.*commande_idd/s.test(e||''), String(e))
check('… et la fonction en place n\'a pas changé', (await q(`select md5(prosrc) h from pg_proc where oid='public.statut_pending_commande()'::regprocedure`))[0].h===corpsAvant)

// =====================================================================
// F. Le retour arrière
// =====================================================================
for (const run of [1,2]) { e=await erreur(()=>db.exec(RETOUR)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
c=await neuve(); e=await parNavigateur(U.manager,c.id)
check('après retour : l\'ancienne règle (tout retour refusé, ancien message)', /ne revient pas à « Pending »/.test(e||''), String(e))
check('après retour : une commande neuve est « Pending », les écritures marchent', await st((await commande()).id)==='Pending')
const sp=fs.readFileSync(R+'sql/statut_pending.sql','utf8')
check('après retour : le corps est EXACTEMENT celui de statut_pending.sql',
  (await q(`select prosrc from pg_proc where oid='public.statut_pending_commande()'::regprocedure`))[0].prosrc===sp.slice(sp.indexOf('as $$',sp.indexOf('function public.statut_pending_commande'))+5, sp.indexOf('$$',sp.indexOf('as $$',sp.indexOf('function public.statut_pending_commande'))+5)))
e=await erreur(()=>db.exec(FR))
check('réinstaller : accepté', e===null, String(e))
c=await neuve(); e=await parNavigateur(U.manager,c.id)
check('… le renvoi marche de nouveau', e===null && await st(c.id)==='Pending', String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
