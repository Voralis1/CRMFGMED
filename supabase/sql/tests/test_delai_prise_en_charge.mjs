// delai_prise_en_charge.sql (02/11) sur le schéma réel + ce qui est en production
// (statut_pending, historique_statuts, leads_remontes, appels_responsables,
// renvoyer_en_attente, commandes_statut_lot) :
//   · est_tentative réécrite : même réponse sur chaque ligne d'historique et
//     chaque statut × lot ; fichier deux fois ; commandes_statut_lot.sql relancé
//     garde la nouvelle (garde) ;
//   · le départ (création, remontée, retour à Pending) et l'arrivée (début de
//     l'appel = enregistrement − durée) ; Non joint compte ; lot ne compte pas ;
//     correction sans durée ne compte pas ; fermé sans prise en charge ;
//   · tranches, médiane, moyenne ; période sur les pris en charge seulement ;
//   · par agent : celui qui a enregistré / l'agent affecté / « Sans agent » ;
//   · droits : manager, admin, ceo, super_admin ; refusé à vendeur, agent,
//     livreur, manager d'une autre entreprise ; aucune donnée modifiée ;
//   · retour arrière deux fois (est_tentative md5 d'avant), réinstallation.
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
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true),''),
                  nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
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
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
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

const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', livreur:'aaaaaaaa-0000-0000-0000-000000000006',
          manager2:'aaaaaaaa-0000-0000-0000-000000000007', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const urCols=(await cols('user_roles')).map(c=>c.column_name)
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
for (const [r,u] of Object.entries(U)) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  const v={user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,'')}
  if (urCols.includes('nom')) v.nom = r==='manager' ? 'Mme Manager' : null
  await ins('user_roles',v)
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
for (const [t,p] of [[T,AO],[T,CG],[T2,AO2]]) await ins('entrepots',{tenant_id:t,nom:'E'+p.slice(0,4),pays_id:p,actif:true})
for (const t of [T,T2]) for (const [nom,code,ferme,decl,rap] of [['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
  ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
  await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
// un statut ouvert propre au Congo
await ins('statuts',{tenant_id:T,nom:'Occupé',code:'occupe',ferme_le_lead:false,declenche_assignation:false,necessite_rappel:false,type:'appel',pays_id:CG})
const A1=(await ins('agents',{tenant_id:T,nom:'Agent Un',user_id:U.agent,pays_id:AO,actif:true})).id
const L1=(await ins('livreurs',{tenant_id:T,nom:'Livreur Un',user_id:U.livreur,pays_id:AO,actif:true,zone:'Luanda'})).id
await db.exec(`set session_replication_role = origin`)
await poserPermissions(db)
for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql']) await db.exec(lire(f))

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,ville_zone:'Nulle part',...extra})
const appel=(c,statut,prec,quand=null,uid=U.agent)=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,'note',10,$7,'{}'::jsonb)`,[c,T,uid,A1,statut,prec,quand]))
const suivi=async id=>(await q(`select nb_tentatives, derniere_tentative_statut, derniere_tentative_le, derniere_action_le, statut_confirmation, date_rappel from public.commandes where id=$1`,[id]))[0]
const lot=(uid,ids,statut,motif=null,date=null,t=T)=>sous(uid,'authenticated',()=>q(`select * from public.changer_statut_lot($1,$2,$3,$4,$5)`,[t,ids,statut,motif,date]))
const par=(res,id)=>res.find(r=>r.commande_id===id)
const dans=(j)=>new Date(Date.now()+j*86400000).toISOString()


await db.exec(lire('renvoyer_en_attente.sql'))
await db.exec(lire('commandes_statut_lot.sql'))
const FF=lire('delai_prise_en_charge.sql'), FR=lire('delai_prise_en_charge_retour.sql')

const MIN=60000
const ilya=(min)=>new Date(Date.now()-min*MIN).toISOString()
// un appel enregistré comme confirmer-appel le fait (durée en secondes, ou null = correction du tiroir)
const appelD=(c,statut,prec,duree=120,uid=U.agent,agent=A1)=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,'note',$7,null,'{}'::jsonb)`,[c,T,uid,agent,statut,prec,duree]))
const lotD=(uid,ids,statut,motif=null)=>sous(uid,'authenticated',()=>q(`select * from public.changer_statut_lot($1,$2,$3,$4,null)`,[T,ids,statut,motif]))
const mesure=(uid=U.manager,debut='-infinity',fin='infinity',t=T)=>sous(uid,'authenticated',async()=>(await q(`select public.delai_prise_en_charge($1,$2,$3) j`,[t,debut,fin]))[0].j)
const tentatives=async()=>JSON.stringify(await q(`select h.id, public.est_tentative(h.tenant_id,h.statut,h.lot_id) t from public.historique_statuts h order by h.id`))
const environ=(x,v,tol=1.5)=>x!=null && Math.abs(Number(x)-v)<=tol

// ---- l'existant, AVANT le fichier : des appels, un lot, une correction
const h1=await commande({agent_id:A1,created_at:ilya(30)}); await appelD(h1.id,'Unreached','Pending',60); await appelD(h1.id,'Confirmed','Unreached',90)
const h2=await commande({agent_id:A1,created_at:ilya(120)}); await lotD(U.manager,[h2.id],'Unreached')
const h3=await commande({agent_id:A1}); await appelD(h3.id,'Cancelled','Pending',null,U.manager,null)
const tentAvant=await tentatives()
const cmdAvant=JSON.stringify(await q(`select * from public.commandes order by id`))
const histAvant=JSON.stringify(await q(`select * from public.historique_statuts order by id`))

// =====================================================================
// A. Installation, est_tentative
// =====================================================================
for (const run of [1,2]) { let e=await erreur(()=>db.exec(FF)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('est_tentative : même réponse sur chaque ligne d\'historique', await tentatives()===tentAvant)
check('est_tentative repose sur est_prise_en_charge', (await q(`select prosrc from pg_proc where proname='est_tentative'`))[0].prosrc.includes('est_prise_en_charge'))
check('aucune commande modifiée', JSON.stringify(await q(`select * from public.commandes order by id`))===cmdAvant)
check('aucune ligne d\'historique ajoutée ou modifiée', JSON.stringify(await q(`select * from public.historique_statuts order by id`))===histAvant)
await db.exec(lire('commandes_statut_lot.sql'))
check('commandes_statut_lot.sql relancé : est_tentative gardée', (await q(`select prosrc from pg_proc where proname='est_tentative'`))[0].prosrc.includes('est_prise_en_charge'))
check('… et toujours la même réponse partout', await tentatives()===tentAvant)
// la preuve de la répétition attrape une est_tentative qui change
const FAUTIF=FF.replace("  select public.est_prise_en_charge(p_statut, p_lot)\n     and public.est_statut_ouvert(p_tenant, p_statut)","  select public.est_prise_en_charge(p_statut, p_lot)")
check('(témoin : est_tentative faussée)', FAUTIF!==FF)
await db.exec(FR)
let e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('est_tentative qui compte aussi les statuts qui ferment → refusée, nommée', /différente\(s\) de l'ancienne/.test(e||''), String(e))
check('… rien installé', (await q(`select count(*)::int n from pg_proc where proname in ('delai_prise_en_charge','est_prise_en_charge')`))[0].n===0)
await db.exec(FF)

// =====================================================================
// B. Les cas
// =====================================================================
let j=await mesure()
const total=(await q(`select count(*)::int n from public.commandes where tenant_id=$1`,[T]))[0].n
check('chaque commande dans un seul état', j.pris_en_charge.n + j.en_attente.n + j.fermes_sans_prise_en_charge===total, JSON.stringify(j))
check('h1 : pris en charge ≈ 30 − 1 min (début de l\'appel = enregistrement − durée)', environ(j.pris_en_charge.max_min, 29), JSON.stringify(j.pris_en_charge))
check('h2 : un lot « Non joint » ne compte pas → toujours en attente (~120 min)', environ(j.en_attente.max_min, 120), JSON.stringify(j.en_attente))
check('h3 : correction sans durée vers Annulée → fermé sans prise en charge', j.fermes_sans_prise_en_charge===1)

// Non joint compte
const c4=await commande({agent_id:A1,created_at:ilya(10)}); await appelD(c4.id,'Unreached','Pending',30)
// retour à Pending après une prise en charge : attend de nouveau, depuis le retour
const c5=await commande({agent_id:A1,created_at:ilya(600)}); await appelD(c5.id,'Confirmed','Pending',60)
await lotD(U.manager,[c5.id],'Pending','test')
// remonté : attend depuis la remontée
const c6=await commande({agent_id:A1,created_at:ilya(2000)}); await appelD(c6.id,'Unreached','Pending',60)
await sous(U.manager,'authenticated',()=>q(`select public.remonter_leads($1,$2)`,[T,[c6.id]]))
// sans agent, ancienne
const c7=await commande({pays_id:CG,created_at:ilya(300)})   // le Congo n'a pas d'agent : personne n'est affecté
j=await mesure()
const lignes=(k)=>j.par_agent.find(a=>a.cle===k)
check('« Non joint » compte comme prise en charge : c4 ≈ 9,5 min (< 15), h1 ≈ 29 min (15 min–1 h)', j.pris_en_charge.n===2 && j.pris_en_charge.tranches.moins_15_min===1 && j.pris_en_charge.tranches.de_15_min_a_1_h===1, JSON.stringify(j.pris_en_charge.tranches))
check('retour à Pending : c5 attend de nouveau (n en attente compte c5)', j.en_attente.n===4, JSON.stringify(j.en_attente))
check('… depuis le retour, pas depuis la création (aucune attente ≥ 600 min)', j.en_attente.max_min < 400, JSON.stringify(j.en_attente))
check('remonté : c6 attend, depuis la remontée (pas ~2000 min)', j.en_attente.max_min < 400)
check('tranches des attentes : c5/c6 < 15 min, h2 1–3 h, c7 > 3 h', j.en_attente.tranches.moins_15_min===2 && j.en_attente.tranches.de_1_h_a_3_h===1 && j.en_attente.tranches.plus_3_h===1, JSON.stringify(j.en_attente.tranches))
check('« Sans agent » : c7', lignes('sans')?.en_attente.n===1 && lignes('sans').agent==='Sans agent', JSON.stringify(j.par_agent))
check('l\'agent : ses pris en charge (h1, c4) et ses en attente (h2, c5, c6)', lignes(A1)?.pris_en_charge.n===2 && lignes(A1).en_attente.n===3, JSON.stringify(lignes(A1)))
check('médiane et moyenne données', j.pris_en_charge.mediane_min!=null && j.pris_en_charge.moyenne_min!=null)
// prise en charge enregistrée par un manager AVEC durée (panneau) : compte, sous son nom
const c8=await commande({agent_id:A1,created_at:ilya(5)}); await appelD(c8.id,'Confirmed','Pending',60,U.manager,null)
j=await mesure()
check('appel d\'un manager depuis le panneau (avec durée) : compte, sous le manager', j.par_agent.some(a=>a.cle==='u:'+U.manager && a.pris_en_charge.n===1), JSON.stringify(j.par_agent.map(a=>[a.cle,a.agent,a.pris_en_charge.n])))
// une correction sans durée PUIS un vrai appel : l'appel compte (la correction ne masque pas l'appel)
const c9=await commande({agent_id:A1,created_at:ilya(50)})
await appelD(c9.id,'Unreached','Pending',null,U.manager,null)
await appelD(c9.id,'Confirmed','Unreached',60)
const j9=await mesure()
check('correction sans durée puis appel : pris en charge à l\'appel (≈ 49 min, 15 min–1 h)', j9.pris_en_charge.n===j.pris_en_charge.n+1 && j9.pris_en_charge.tranches.de_15_min_a_1_h===j.pris_en_charge.tranches.de_15_min_a_1_h+1, JSON.stringify(j9.pris_en_charge))
j=j9
// période : sur les pris en charge par départ ; « en attente » ne bouge pas
const jp=await mesure(U.manager, ilya(20), new Date().toISOString())
check('période : seuls les pris en charge partis dedans (c4, c8)', jp.pris_en_charge.n===2, JSON.stringify(jp.pris_en_charge))
check('période : « en attente » identique (toujours maintenant)', JSON.stringify(jp.en_attente)===JSON.stringify(j.en_attente))

// =====================================================================
// C. Droits ; rien d'écrit
// =====================================================================
for (const r of ['manager','admin','ceo','super_admin']) { e=await erreur(()=>mesure(U[r])); check(`${r} : lit`, e===null, String(e)) }
for (const r of ['seller','agent','livreur']) { e=await erreur(()=>mesure(U[r])); check(`${r} : refusé`, /Accès refusé/.test(e||''), String(e)) }
e=await erreur(()=>mesure(U.manager2)); check('manager d\'une autre entreprise : refusé', /Accès refusé/.test(e||''), String(e))
e=await erreur(()=>sous(null,'anon',()=>q(`select public.delai_prise_en_charge($1,'-infinity','infinity')`,[T]))); check('anon : refusé', /permission denied/.test(e||''), String(e))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.resume_delais(array[1]::numeric[])`))); check('resume_delais fermée aux comptes de l\'app', /permission denied/.test(e||''), String(e))
const cAvant=JSON.stringify(await q(`select * from public.commandes order by id`)), hAvant=JSON.stringify(await q(`select * from public.historique_statuts order by id`))
await mesure(); await mesure(U.admin)
check('mesurer n\'écrit rien', JSON.stringify(await q(`select * from public.commandes order by id`))===cAvant && JSON.stringify(await q(`select * from public.historique_statuts order by id`))===hAvant)

// =====================================================================
// D. Retour arrière
// =====================================================================
const tentApres=await tentatives()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`retour, passage ${run}`, e===null, String(e)) }
check('retour : est_tentative = corps d\'avant (md5)', (await q(`select md5(prosrc) m from pg_proc where proname='est_tentative'`))[0].m==='90fc46af8a39c154bd0a2751fb5f55dd')
check('retour : mêmes réponses', await tentatives()===tentApres)
check('retour : mesure retirée', (await q(`select count(*)::int n from pg_proc where proname in ('delai_prise_en_charge','resume_delais','est_prise_en_charge')`))[0].n===0)
await db.exec(lire('commandes_statut_lot.sql'))
check('après le retour, commandes_statut_lot.sql peut réécrire est_tentative (sa marque)', (await q(`select obj_description('public.est_tentative(uuid,text,uuid)'::regprocedure,'pg_proc') c`))[0].c==='fichier: commandes_statut_lot.sql')
e=await erreur(()=>db.exec(FF)); check('réinstaller après le retour', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
