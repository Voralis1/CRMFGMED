// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production depuis (statut_pending.sql), puis historique_statuts.sql :
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
const FH=fs.readFileSync(process.env.FICHIER||R+'sql/historique_statuts.sql','utf8')
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

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,...extra})
const hist=async id=>q(`select * from public.historique_statuts where commande_id=$1 order by cree_le, statut_precedent nulls first`,[id])
const nbHist=async()=>(await q(`select count(*)::int n from public.historique_statuts`))[0].n

// =====================================================================
// A. Sans statut_pending.sql : refusé, rien installé
// =====================================================================
let e=await erreur(()=>db.exec(FH))
check('sans statut_pending.sql → refusé', /Lancez d'abord statut_pending.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
check('… rien installé', (await q(`select to_regclass('public.historique_statuts') t`))[0].t===null)
await db.exec(FP)

// Une faute que Postgres accepte à la création (colonne mal écrite dans le
// trigger) : la répétition du §9 l'attrape, et dans UNE transaction (comme
// l'éditeur SQL) rien n'est installé.
const FAUTIF=FH.replace('new.lead_id, new.tracking_number,','new.lead_id, new.tracking_numbr,')
check('(témoin : la faute est bien injectée)', FAUTIF!==FH)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('trigger fautif → le fichier s\'arrête à la répétition, avec la raison', /RÉPÉTITION ÉCHOUÉE.*tracking_numbr/s.test(e||''), String(e))
check('… et rien n\'est installé (ni table, ni trigger sur commandes)',
  (await q(`select to_regclass('public.historique_statuts') t`))[0].t===null
  && (await q(`select count(*)::int n from pg_trigger where tgname='trg_historique_statut'`))[0].n===0)
const FAUTIF2=FH.replace("v_appel  := nullif(current_setting('crm.historique_appel', true), '')::uuid;","v_appel  := null;")
e=await erreur(()=>db.exec('begin;\n'+FAUTIF2+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('ligne incomplète (appel non relié) → la répétition refuse aussi', /RÉPÉTITION ÉCHOUÉE.*enregistrer_appel/s.test(e||''), String(e))

// =====================================================================
// B. L'existant : des commandes et des appels d'avant
// =====================================================================
const v1=await commande({vendeur_id:U.seller, agent_id:A1})
const v2=await commande({vendeur_id:U.seller2})
const v3=await commande()
const appel=async(c, statut, prec, extra={})=>ins('appels',{commande_id:c,tenant_id:T,statut,statut_precedent:prec,...extra})
await appel(v1.id,'en_attente',null)                                            // fausse ligne d'import
await appel(v1.id,'Unreached','Pending',{agent_id:A1,duree_secondes:14,notes:'Ne répond pas'})
await appel(v1.id,'Confirmed','Unreached',{agent_id:A1,duree_secondes:51})
await appel(v2.id,'en_attente',null)
await appel(v2.id,'Cancelled',null,{duree_secondes:3})                           // d'un responsable : pas d'agent
await appel(v3.id,'Confirmed','Confirmed',{notes:'Adresse corrigée depuis Commandes'}) // statut inchangé
await db.exec(`set session_replication_role = replica`)
await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[v1.id])
await q(`update public.commandes set statut_confirmation='Cancelled' where id=$1`,[v2.id])
await db.exec(`set session_replication_role = origin`)

const photo=async()=>JSON.stringify(await q(`select * from public.commandes order by id`))
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FH)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune commande modifiée par le fichier', await photo()===avant)
check('répétition : aucune commande, aucun appel, aucune ligne « REPETITION » ne reste',
  (await q(`select (select count(*) from public.commandes where lead_id like 'REPETITION-%') + (select count(*) from public.historique_statuts where commande_lead_id like 'REPETITION-%') + (select count(*) from public.appels where notes='Répétition') n`))[0].n==0)

// =====================================================================
// C. La reprise
// =====================================================================
const mig=await q(`select * from public.historique_statuts where via='migration' order by cree_le`)
check('reprise : 3 appels réels (pas les « en_attente », pas le statut inchangé)', mig.length===3, mig.map(m=>m.statut).join(','))
check('… pas de doublon après deux passages', (await q(`select count(*)::int n from (select appel_id from public.historique_statuts where appel_id is not null group by 1 having count(*)>1) x`))[0].n===0)
const m1=mig.find(m=>m.statut==='Unreached')
check('… durée et commentaire recopiés tels quels', m1?.duree_secondes===14 && m1?.note==='Ne répond pas')
check('… qui = la fiche agent de l\'appel (compte + nom)', m1?.fait_par===U.agent && m1?.fait_par_nom==='Agent Un')
const m2=mig.find(m=>m.statut==='Cancelled')
check('… appel sans agent : personne', m2 && m2.fait_par===null && m2.fait_par_nom===null)
check('… date = celle de l\'appel', mig.every(m=>m.appel_id))

// =====================================================================
// D. Une ligne par changement, par tous les chemins
// =====================================================================
// insertion (éditeur SQL : pas de compte)
const c1=await commande({vendeur_id:U.seller})
let h=await hist(c1.id)
check('insertion → une ligne « → Pending », via systeme', h.length===1 && h[0].statut==='Pending' && h[0].statut_precedent===null && h[0].via==='systeme' && h[0].fait_par===null)
// insertion par le vendeur (navigateur)
const c2=(await sous(U.seller,'authenticated',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,vendeur_id) values ('V9',$1,$2,'C','+1','X',1,1,$3) returning id`,[T,AO,U.seller])))[0]
h=await hist(c2.id)
check('insertion par le vendeur → via navigateur, fait_par = lui', h.length===1 && h[0].via==='navigateur' && h[0].fait_par===U.seller)
// clé service (import-commande)
const c3=(await sous('','service_role',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix) values ('S9',$1,$2,'C','+1','X',1,1) returning id`,[T,AO])))[0]
h=await hist(c3.id)
check('insertion par la clé service → via systeme, personne', h.length===1 && h[0].via==='systeme' && h[0].fait_par===null)
// update direct depuis le navigateur par l'agent (la RLS le permet)
await sous(U.agent,'authenticated',()=>q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[c1.id]))
h=await hist(c1.id)
check('update direct de l\'agent → ligne Pending → Unreached, via navigateur, nom de sa fiche',
  h.length===2 && h[1].statut_precedent==='Pending' && h[1].statut==='Unreached' && h[1].via==='navigateur' && h[1].fait_par===U.agent && h[1].fait_par_nom==='Agent Un' && h[1].duree_secondes===null)
// adresse seule, statut réécrit identique
await q(`update public.commandes set adresse='Rua 1', statut_confirmation='Unreached' where id=$1`,[c1.id])
check('adresse corrigée, statut inchangé → aucune ligne', (await hist(c1.id)).length===2)
// éditeur SQL
await q(`update public.commandes set statut_confirmation='Reminder' where id=$1`,[c1.id])
h=await hist(c1.id)
check('éditeur SQL → via systeme', h.length===3 && h[2].via==='systeme' && h[2].statut==='Reminder')
// un changement refusé n'écrit rien
const avantRefus=await nbHist()
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[c1.id]))
check('retour à Pending refusé → aucune ligne', !!e && await nbHist()===avantRefus, String(e))

// =====================================================================
// E. enregistrer_appel (confirmer-appel)
// =====================================================================
const EA=`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`
const c4=await commande({vendeur_id:U.seller})
const nbAppels=async()=>(await q(`select count(*)::int n from public.appels`))[0].n
let a0=await nbAppels()
let r=(await sous('','service_role',()=>q(EA,[c4.id,T,U.agent,A1,'Unreached','Pending','Hors ligne',37,null,{adresse:'Rua 2'}])))[0].r
h=await hist(c4.id)
check('enregistrer_appel : un appel écrit et renvoyé', await nbAppels()===a0+1 && r?.statut==='Unreached' && r?.duree_secondes===37)
check('… la commande changée (statut + champ envoyé)', (await q(`select statut_confirmation s, adresse a from public.commandes where id=$1`,[c4.id]))[0].s==='Unreached'
  && (await q(`select adresse a from public.commandes where id=$1`,[c4.id]))[0].a==='Rua 2')
check('… une ligne : via confirmer-appel, qui, commentaire, durée, appel',
  h.length===2 && h[1].via==='confirmer-appel' && h[1].fait_par===U.agent && h[1].fait_par_nom==='Agent Un' && h[1].note==='Hors ligne' && h[1].duree_secondes===37 && h[1].appel_id===r.id)
// depuis Commandes : un responsable, pas de durée
await sous('','service_role',()=>q(EA,[c4.id,T,U.manager,null,'Confirmed','Unreached','Statut corrigé depuis Commandes',null,null,{}]))
h=await hist(c4.id)
check('correction depuis Commandes : durée vide (pas 0), nom du compte', h[2].duree_secondes===null && h[2].fait_par_nom==='Mme Manager' && h[2].statut==='Confirmed')
// un champ non envoyé n'est pas touché
check('… champ non envoyé (adresse) gardé', (await q(`select adresse a from public.commandes where id=$1`,[c4.id]))[0].a==='Rua 2')
// refus : rien du tout
a0=await nbAppels(); const h0=await nbHist()
e=await sous('','service_role',()=>q(EA,[c4.id,T,U.manager,null,'Pending','Confirmed',null,null,null,{}])).then(()=>null,x=>x.message)
check('changement refusé par la base → ni appel, ni ligne (une transaction)', !!e && await nbAppels()===a0 && await nbHist()===h0, String(e))
e=await sous('','service_role',()=>q(EA,[crypto.randomUUID(),T,U.manager,null,'Confirmed',null,null,null,null,{}])).then(()=>null,x=>x.message)
check('commande introuvable → refusé (clé étrangère ou message), aucun appel orphelin', /introuvable|foreign key/.test(e||'') && await nbAppels()===a0, String(e))
// les réglages ne débordent pas sur la suite de la transaction
const c5=await commande(), c6=await commande()
await db.exec('begin')
await q(EA,[c5.id,T,U.agent,A1,'Unreached','Pending','note',5,null,{}])
await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[c6.id])
await db.exec('commit')
h=await hist(c6.id)
check('après enregistrer_appel, un autre update de la même transaction → via systeme, sans qui ni note', h[1]?.via==='systeme' && h[1]?.fait_par===null && h[1]?.note===null)
// un compte connecté ne peut pas emprunter la porte, ni se faire passer pour un autre
for (const role of ['authenticated','anon']) {
  e=await sous(U.manager,role,()=>q(EA,[c5.id,T,U.agent,A1,'Confirmed','Unreached',null,null,null,{}])).then(()=>null,x=>x.message)
  check(`enregistrer_appel refusé à ${role}`, /permission denied/.test(e||''), String(e))
}

// =====================================================================
// F. La garde
// =====================================================================
e=await erreur(()=>q(`insert into public.historique_statuts (tenant_id,commande_id,statut,via) values ($1,$2,'Confirmed','systeme')`,[T,c5.id]))
check('écrire une ligne à la main (éditeur SQL) → refusé', /ne s'écrit pas à la main/.test(e||''), String(e))
e=await erreur(()=>q(`update public.historique_statuts set note='x' where commande_id=$1`,[c4.id]))
check('modifier une ligne (éditeur SQL) → refusé', /ne se modifie pas/.test(e||''), String(e))
e=await erreur(()=>q(`delete from public.historique_statuts where commande_id=$1`,[c4.id]))
check('supprimer une ligne d\'une commande qui existe → refusé', /ne se supprime pas/.test(e||''), String(e))
e=await erreur(()=>q(`truncate public.historique_statuts`))
check('TRUNCATE → refusé', /ne se vide pas/.test(e||''), String(e))
for (const role of ['authenticated','anon']) {
  e=await sous(U.manager,role,()=>q(`select * from public.historique_statuts`)).then(()=>null,x=>x.message)
  check(`la table elle-même illisible pour ${role}`, /permission denied/.test(e||''), String(e))
}
e=await sous('','service_role',()=>q(`update public.historique_statuts set note='x'`)).then(()=>null,x=>x.message)
check('clé service : pas de modification', /permission denied|ne se modifie pas/.test(e||''), String(e))
// supprimer la commande : ses lignes RESTENT (SET NULL), lisibles par ce
// qu'elles ont gardé
const lignesC4=await hist(c4.id)
const nbAvant=await nbHist()
e=await erreur(()=>q(`delete from public.commandes where id=$1`,[c4.id]))
const orph=await q(`select * from public.historique_statuts where commande_lead_id=$1 order by cree_le`,[c4.lead_id])
check('supprimer la commande → accepté, AUCUNE ligne supprimée', e===null && await nbHist()===nbAvant, String(e))
check('… ses lignes restent, lien NULL', orph.length===lignesC4.length && orph.length===3 && orph.every(x=>x.commande_id===null), String(orph.length))
check('… elles gardent entreprise, vendeur, n° de lead, tracking, client, produit',
  orph.every(x=>x.tenant_id===T && x.vendeur_id===U.seller && x.commande_lead_id===c4.lead_id && /^FG\d{10}$/.test(x.commande_tracking||'') && x.commande_client==='C' && x.commande_produit==='X'))
check('… et tout le reste à l\'identique (seul le lien a changé)',
  JSON.stringify(orph.map(({commande_id,...x})=>x))===JSON.stringify(lignesC4.map(({commande_id,...x})=>x)))
e=await erreur(()=>q(`delete from public.historique_statuts where commande_id is null`))
check('supprimer une ligne dont la commande est supprimée → refusé aussi', /ne se supprime pas/.test(e||''), String(e))
e=await erreur(()=>q(`update public.historique_statuts set note='x' where commande_id is null`))
check('modifier une ligne orpheline → refusé', /ne se modifie pas/.test(e||''), String(e))
e=await erreur(()=>q(`update public.historique_statuts set commande_id=null where commande_id=$1`,[c1.id]))
check('mettre le lien à NULL alors que la commande existe → refusé', /ne se modifie pas/.test(e||''), String(e))
// le SET NULL à la main, commande disparue : permis seul, refusé avec autre chose
const cX=await commande()
await db.exec(`set session_replication_role = replica`); await q(`delete from public.commandes where id=$1`,[cX.id]); await db.exec(`set session_replication_role = origin`)
e=await erreur(()=>q(`update public.historique_statuts set commande_id=null, note='x' where commande_id=$1`,[cX.id]))
check('commande disparue : lien NULL + autre colonne → refusé', /ne se modifie pas/.test(e||''), String(e))
e=await erreur(()=>q(`update public.historique_statuts set commande_id=null where commande_id=$1`,[cX.id]))
check('commande disparue : lien NULL seul → accepté (ce que fait la suppression)', e===null, String(e))
// par un manager depuis le navigateur
const cR=await commande({vendeur_id:U.seller}); await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[cR.id])
e=await sous(U.manager,'authenticated',()=>q(`delete from public.commandes where id=$1 returning id`,[cR.id])).then(r=>r.length===1?null:'0 ligne',x=>x.message)
check('… supprimée par un manager depuis le navigateur : lignes gardées',
  e===null && (await q(`select count(*)::int n from public.historique_statuts where commande_lead_id=$1 and commande_id is null`,[cR.lead_id]))[0].n===2, String(e))

// =====================================================================
// G. La vue
// =====================================================================
const V=`select * from public.v_historique_statuts`
const total=(await q(`select count(*)::int n from public.historique_statuts where tenant_id=$1`,[T]))[0].n
for (const role of ['manager','admin','ceo']) {
  const rows=await sous(U[role],'authenticated',()=>q(V))
  check(`${role} : toute son entreprise (${total} lignes, commandes supprimées comprises), avec qui`, rows.length===total && rows.some(x=>x.fait_par_nom==='Agent Un') && rows.some(x=>x.commande_supprimee && x.commande_lead_id===c4.lead_id), String(rows.length))
}
const sa=await sous(U.super_admin,'authenticated',()=>q(V))
check('super_admin : tout', sa.length===await nbHist())
const vs=await sous(U.seller,'authenticated',()=>q(V))
const sesCommandes=(await q(`select id from public.commandes where vendeur_id=$1`,[U.seller])).map(x=>x.id)
check('vendeur : seulement ses commandes (vivantes)', vs.length>0 && vs.filter(x=>x.commande_id).every(x=>sesCommandes.includes(x.commande_id)), String(vs.length))
check('… et l\'historique de SES commandes supprimées, lisible par le n° de lead',
  [c4.lead_id, cR.lead_id].every(l=>vs.some(x=>x.commande_lead_id===l && x.commande_supprimee===true)))
check('… jamais les commandes supprimées d\'un autre', vs.filter(x=>x.commande_supprimee).every(x=>[c4.lead_id,cR.lead_id].includes(x.commande_lead_id)))
const vs2=await sous(U.seller2,'authenticated',()=>q(V))
check('autre vendeur : ne voit pas l\'historique des commandes supprimées du premier', !vs2.some(x=>[c4.lead_id,cR.lead_id].includes(x.commande_lead_id)))
check('… jamais la commande d\'un autre vendeur', !vs.some(x=>x.commande_id===v2.id))
check('… aucun qui : fait_par et fait_par_nom vides sur chaque ligne', vs.every(x=>x.fait_par===null && x.fait_par_nom===null))
check('… le commentaire reste visible', vs.some(x=>x.note==='Ne répond pas'))
check('… pas de colonne appel_id dans la vue', !('appel_id' in (vs[0]||{})))
const vf=await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.v_historique_statuts where fait_par_nom = 'Agent Un' or fait_par = $1`,[U.agent]))
check('… filtrer sur l\'agent ne retrouve rien (vidé par la vue, pas par l\'écran)', vf[0].n===0)
for (const role of ['agent','livreur']) {
  const rows=await sous(U[role],'authenticated',()=>q(V))
  check(`${role} : aucune ligne`, rows.length===0, String(rows.length))
}
check('manager d\'une autre entreprise : rien de celle-ci', (await sous(U.manager2,'authenticated',()=>q(V))).every(x=>x.tenant_id===T2))
e=await sous('','anon',()=>q(V)).then(()=>null,x=>x.message)
check('anon : refusé', /permission denied/.test(e||''), String(e))
e=await sous(U.manager,'authenticated',()=>q(`insert into public.v_historique_statuts (tenant_id,commande_id,statut,via) values ($1,$2,'Confirmed','systeme')`,[T,c5.id])).then(()=>null,x=>x.message)
check('écrire par la vue (manager) → refusé', /permission denied/.test(e||''), String(e))
e=await sous(U.manager,'authenticated',()=>q(`delete from public.v_historique_statuts`)).then(()=>null,x=>x.message)
check('supprimer par la vue (manager) → refusé', /permission denied/.test(e||''), String(e))

// =====================================================================
// H. Rejouer le fichier ne change rien
// =====================================================================
const avantRejeu=JSON.stringify(await q(`select * from public.historique_statuts order by id`))
e=await erreur(()=>db.exec(FH))
check('troisième passage : accepté', e===null, String(e))
check('… aucune ligne ajoutée ni changée (les appels d\'après l\'installation ne sont pas re-repris)',
  JSON.stringify(await q(`select * from public.historique_statuts order by id`))===avantRejeu)

// =====================================================================
// I. Le retour arrière (historique_statuts_retour.sql), sur un trigger
//    VOLONTAIREMENT cassé
// =====================================================================
const RETOUR=fs.readFileSync(R+'sql/historique_statuts_retour.sql','utf8')
const cB=await commande({vendeur_id:U.seller})
// la panne : le trigger de commandes et la garde lèvent une erreur
await db.exec(`create or replace function public.ecrire_historique_statut() returns trigger language plpgsql as $$ begin raise exception 'PANNE historique'; end $$;`)
await db.exec(`create or replace function public.historique_statuts_garde() returns trigger language plpgsql as $$ begin raise exception 'PANNE garde'; end $$;`)
e=await erreur(()=>commande())
check('panne : une insertion dans commandes échoue', /PANNE historique/.test(e||''), String(e))
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[cB.id]))
check('panne : un changement de statut échoue', /PANNE historique/.test(e||''), String(e))
e=await sous('','service_role',()=>q(EA,[cB.id,T,U.agent,A1,'Unreached','Pending',null,5,null,{}])).then(()=>null,x=>x.message)
check('panne : confirmer-appel (enregistrer_appel) échoue', /PANNE historique/.test(e||''), String(e))
e=await erreur(()=>q(`delete from public.commandes where id=$1`,[cB.id]))
check('panne de la garde : supprimer une commande qui a un historique échoue', /PANNE garde/.test(e||''), String(e))
const lignesAvantRetour=await nbHist()
for (const run of [1,2]) { e=await erreur(()=>db.exec(RETOUR)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
check('après retour : plus aucun trigger d\'historique', (await q(`select count(*)::int n from pg_trigger where tgname like 'trg_historique%'`))[0].n===0)
check('après retour : la table et ses lignes sont là', await nbHist()===lignesAvantRetour)
const cOK=await erreur(()=>commande())
check('après retour : insertion dans commandes OK', cOK===null, String(cOK))
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Reminder' where id=$1`,[cB.id]))
check('après retour : changement de statut OK', e===null && (await q(`select statut_confirmation s from public.commandes where id=$1`,[cB.id]))[0].s==='Reminder', String(e))
e=await sous('','service_role',()=>q(EA,[cB.id,T,U.agent,A1,'Confirmed','Reminder',null,5,null,{adresse:'Rua 9'}])).then(()=>null,x=>x.message)
check('après retour : confirmer-appel (enregistrer_appel) OK sans redéploiement', e===null, String(e))
e=await sous(U.manager,'authenticated',()=>q(`delete from public.commandes where id=$1 returning id`,[cB.id])).then(r=>r.length===1?null:'0 ligne',x=>x.message)
check('après retour : supprimer une commande (manager) OK, ses lignes restent (SET NULL)', e===null && await nbHist()===lignesAvantRetour, String(e))
check('après retour : la vue répond', (await sous(U.manager,'authenticated',()=>q(V))).length>0)
// réinstaller
e=await erreur(()=>db.exec(FH))
check('réinstaller (relancer le fichier) : accepté', e===null, String(e))
const cRe=await commande()
check('… l\'historique s\'écrit de nouveau', (await hist(cRe.id)).length===1)
e=await erreur(()=>q(`delete from public.historique_statuts where commande_id=$1`,[cRe.id]))
check('… et la garde est de retour', /ne se supprime pas/.test(e||''), String(e))
// le retour sur une base où rien n'a jamais été installé
const db2=new PGlite(); await db2.exec(`create table public.commandes (id int)`)
e=await db2.exec(RETOUR).then(()=>null,x=>x.message)
check('retour sur une base sans historique_statuts : accepté (rien à faire)', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
