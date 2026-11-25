// historique_affectations.sql sur le schéma réel (supabase/migrations) + ce qui
// est en production depuis (statut_pending.sql, historique_statuts.sql) :
//   · refusé sans historique_statuts.sql ; une faute dans un trigger → la
//     répétition du §9 arrête le fichier, rien installé ;
//   · deux passages, aucune commande ni livraison modifiée ;
//   · agent : naissance, update direct (navigateur, avec noms), clé service
//     (systeme), autre colonne → rien ;
//   · affecter_agent_lot : lot mixte → une ligne par commande appliquée, même
//     lot_id, rien pour les refusées ; raisons ; doublons ; une ligne qui casse
//     n'annule pas les autres ; droits (ceo, agent, vendeur, autre entreprise,
//     anon) ; agent inactif / > 500 → tout le lot refusé, rien écrit ;
//   · affecter_livreur_lot : création, changement, inchangé, pas confirmée,
//     autre pays, livraison partie ; lit livraisons.statut, PAS le miroir
//     commandes.statut_livraison (mensonge dans les deux sens) ;
//   · livreur automatique à la confirmation → via automatique, qui = celui
//     qui confirme ;
//   · garde ; commande supprimée → lignes gardées ; vue par rôle.
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
-- Comme en production : le compte vient des claims du JWT (la répétition du
-- fichier les pose) ; test.uid pour les tests.
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
// a_la_permission : le corps lu en production le 29/10 (rls_sources_import.sql).
await db.exec(`create or replace function public.a_la_permission(p_code text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                  where ur.user_id = auth.uid() and rp.permission_code = p_code) $$;`)
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
const FP=fs.readFileSync(R+'sql/statut_pending.sql','utf8')
const FH=fs.readFileSync(R+'sql/historique_statuts.sql','utf8')
const FA=fs.readFileSync(process.env.FICHIER||R+'sql/historique_affectations.sql','utf8')
const FRET=fs.readFileSync(R+'sql/historique_affectations_retour.sql','utf8')
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

// ---- deux entreprises, des rôles avec leurs permissions
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const TEST='17144700-2b95-43fa-9849-9e7a8f35104e'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', livreur:'aaaaaaaa-0000-0000-0000-000000000006',
          manager2:'aaaaaaaa-0000-0000-0000-000000000007', super_admin:'aaaaaaaa-0000-0000-0000-000000000009',
          agent2:'aaaaaaaa-0000-0000-0000-00000000000a', agentcg:'aaaaaaaa-0000-0000-0000-00000000000b', mtest:'aaaaaaaa-0000-0000-0000-00000000000c' }
const urCols=(await cols('user_roles')).map(c=>c.column_name)
await db.exec(`set session_replication_role = replica`)
for (const [id,nom] of [[T,'FG'],[T2,'Autre'],[TEST,'Test']]) await ins('tenants',{id,nom_entreprise:nom})
const roleId={}
for (const r of ['seller','agent','livreur','manager','admin','ceo','super_admin']) roleId[r]=(await ins('roles',{nom:r})).id
await ins('permissions',{code:'assigner_livreur',module:'livraisons'}).catch(()=>{})
await ins('permissions',{code:'actions_masse',module:'commandes'}).catch(()=>{})
for (const r of ['manager','admin','super_admin']) for (const p of ['assigner_livreur','actions_masse']) await ins('role_permissions',{role_id:roleId[r],permission_code:p})
for (const [r,u] of Object.entries(U)) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  const role=r==='mtest'?'manager':r.replace(/\d$|cg$/,'')
  const v={user_id:u,tenant_id:r==='manager2'?T2:r==='mtest'?TEST:T,role}
  if (urCols.includes('role_id')) v.role_id=roleId[role]
  if (urCols.includes('nom')) v.nom = r==='manager' ? 'Mme Manager' : null
  if (urCols.includes('email')) v.email = r+'@x'
  await ins('user_roles',v)
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
const AOT=(await ins('pays',{tenant_id:TEST,nom:'Angola',code:'AO'})).id
for (const [t,p] of [[T,AO],[T,CG],[T2,AO2],[TEST,AOT]]) await ins('entrepots',{tenant_id:t,nom:'E'+p.slice(0,4),pays_id:p,actif:true})
for (const t of [T,T2,TEST]) for (const [nom,code,ferme,decl,rap] of [['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
  ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
  await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
const A1=(await ins('agents',{tenant_id:T,nom:'Agent Un',user_id:U.agent,pays_id:AO,actif:true})).id
const A2=(await ins('agents',{tenant_id:T,nom:'Agent Deux',user_id:U.agent2,pays_id:AO,actif:true})).id
const ACG=(await ins('agents',{tenant_id:T,nom:'Agent Congo',user_id:U.agentcg,pays_id:CG,actif:true})).id
const AINACTIF=(await ins('agents',{tenant_id:T,nom:'Agent Parti',user_id:null,pays_id:AO,actif:false})).id
const AT2=(await ins('agents',{tenant_id:T2,nom:'Agent Autre',user_id:null,pays_id:AO2,actif:true})).id
const ATEST=(await ins('agents',{tenant_id:TEST,nom:'Agent Test',user_id:U.agent2,pays_id:AOT,actif:true})).id
const L1=(await ins('livreurs',{tenant_id:T,nom:'Livreur Luanda',user_id:U.livreur,pays_id:AO,actif:true,zone:'Luanda'})).id
const L2=(await ins('livreurs',{tenant_id:T,nom:'Livreur Benguela',pays_id:AO,actif:true,zone:'Benguela'})).id
const LCG=(await ins('livreurs',{tenant_id:T,nom:'Livreur Congo',pays_id:CG,actif:true,zone:'Brazzaville'})).id
const LOFF=(await ins('livreurs',{tenant_id:T,nom:'Livreur Off',pays_id:AO,actif:false,zone:'Luanda'})).id
await ins('livreurs',{tenant_id:TEST,nom:'Livreur Test',pays_id:AOT,actif:true,zone:'Luanda'})
await db.exec(`set session_replication_role = origin`)

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,ville_zone:'Nulle part',...extra})
const hist=async id=>q(`select * from public.historique_affectations where commande_id=$1 order by cree_le, id`,[id])
const nbHist=async()=>(await q(`select count(*)::int n from public.historique_affectations`))[0].n
const lotAgent=async(uid,ids,agent,t=T)=>sous(uid,'authenticated',()=>q(`select * from public.affecter_agent_lot($1,$2,$3)`,[t,ids,agent]))
const lotLiv=async(uid,ids,liv,t=T)=>sous(uid,'authenticated',()=>q(`select * from public.affecter_livreur_lot($1,$2,$3)`,[t,ids,liv]))
const par=(res,id)=>res.find(r=>r.commande_id===id)

// =====================================================================
// A. Prérequis, faute injectée
// =====================================================================
let e=await erreur(()=>db.exec(FA))
check('sans historique_statuts.sql → refusé', /Lancez d'abord historique_statuts.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
await db.exec(FP); await db.exec(FH)

const FAUTIF=FA.replace('p_commande.lead_id, p_commande.tracking_number,','p_commande.lead_id, p_commande.tracking_numbr,')
check('(témoin : faute injectée)', FAUTIF!==FA)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('trigger fautif → la répétition arrête le fichier, avec la raison', /RÉPÉTITION ÉCHOUÉE.*tracking_numbr/s.test(e||''), String(e))
check('… rien installé (table, triggers, fonctions)',
  (await q(`select to_regclass('public.historique_affectations') t`))[0].t===null
  && (await q(`select count(*)::int n from pg_trigger where tgname in ('trg_historique_agent','trg_historique_livreur')`))[0].n===0
  && (await q(`select count(*)::int n from pg_proc where proname in ('affecter_agent_lot','affecter_livreur_lot')`))[0].n===0)
// Un lot qui ne pose pas son numéro : la répétition le voit.
const FAUTIF2=FA.replace(/perform set_config\('crm\.affectation_lot', gen_random_uuid\(\)::text, true\);/g,'null;')
e=await erreur(()=>db.exec('begin;\n'+FAUTIF2+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('lot sans numéro → la répétition refuse aussi', /RÉPÉTITION ÉCHOUÉE.*lot/s.test(e||''), String(e))
// Une fonction qui lirait le miroir : la vérification §8 le refuse.
const FAUTIF3=FA.replace("where v.commande_id = v_id and v.statut is distinct from 'a_preparer';",
  "where v.commande_id = v_id and v.statut is distinct from 'a_preparer' and v_cmd.statut_livraison is distinct from 'x';")
check('(témoin : lecture du miroir injectée)', FAUTIF3!==FA)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF3+'\ncommit;'))
await db.exec('rollback').catch(()=>{})
check('fonction qui lit commandes.statut_livraison → refusé par §8', /miroir faux/.test(e||''), String(e))

// =====================================================================
// B. L'existant, deux passages
// =====================================================================
const v0=await commande({agent_id:A1})
await db.exec(`set session_replication_role = replica`)
await ins('livraisons',{commande_id:v0.id,livreur_id:L1,tenant_id:T,statut:'a_preparer'})
await db.exec(`set session_replication_role = origin`)
const photo=async()=>JSON.stringify([await q(`select * from public.commandes order by id`), await q(`select * from public.livraisons order by id`)])
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FA)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune commande ni livraison modifiée', await photo()===avant)
check('répétition : rien ne reste', (await q(`select (select count(*) from public.commandes where lead_id like 'REPETITION-%')+(select count(*) from public.historique_affectations where commande_lead_id like 'REPETITION-%') n`))[0].n==0)
check('pas de reprise du passé : 0 ligne', await nbHist()===0)
check('request.jwt.claims pas laissé posé', (await q(`select coalesce(current_setting('request.jwt.claims',true),'') v`))[0].v==='')

// =====================================================================
// C. Agent : tous les chemins
// =====================================================================
const c1=await commande()          // auto-agent à la naissance (choisir_agent)
let h=await hist(c1.id)
const agentNe=(await q(`select agent_id from public.commandes where id=$1`,[c1.id]))[0].agent_id
check('naissance avec agent → 1 ligne « creation », avant vide', agentNe && h.length===1 && h[0].via==='creation' && h[0].avant_id===null && h[0].apres_id===agentNe && h[0].quoi==='agent', JSON.stringify(h))
check('… porte lead, client, produit, entreprise', h[0]?.commande_lead_id===c1.lead_id && h[0]?.commande_client===c1.client_nom && h[0]?.tenant_id===T)
const cSans=await commande({pays_id:CG, agent_id:null})
await q(`update public.commandes set agent_id=null where id=$1`,[cSans.id])
const nSans=(await hist(cSans.id)).length
await sous(U.manager,'authenticated',()=>q(`update public.commandes set agent_id=$2 where id=$1`,[c1.id, agentNe===A1?A2:A1]))
h=await hist(c1.id)
const dern=h[h.length-1]
check('update direct d\'un manager → « navigateur », qui + son nom, noms avant/après', h.length===2 && dern.via==='navigateur' && dern.fait_par===U.manager && dern.fait_par_nom==='Mme Manager'
  && dern.avant_id===agentNe && ['Agent Un','Agent Deux'].includes(dern.avant_nom) && ['Agent Un','Agent Deux'].includes(dern.apres_nom) && dern.lot_id===null, JSON.stringify(dern))
await sous(U.manager,'authenticated',()=>q(`update public.commandes set adresse='Rua 1', agent_id=agent_id where id=$1`,[c1.id]))
check('autre colonne, même agent → aucune ligne', (await hist(c1.id)).length===2)
await sous(null,'service_role',()=>q(`update public.commandes set agent_id=null where id=$1`,[c1.id]))
h=await hist(c1.id)
check('clé service → « systeme », personne, après vide', h.length===3 && h[2].via==='systeme' && h[2].fait_par===null && h[2].apres_id===null)
await q(`update public.commandes set agent_id=$2 where id=$1`,[c1.id,A1])
check('éditeur SQL → « systeme »', (await hist(c1.id)).at(-1).via==='systeme')

// =====================================================================
// D. affecter_agent_lot
// =====================================================================
const p1=await commande({agent_id:A1}), p2=await commande({agent_id:A1}), p3=await commande({agent_id:A2})
const traite=await commande({agent_id:A1})
// Le lead traité par Agent Un : son appel (comme confirmer-appel, clé service) et sa ligne de statut.
await sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,'Unreached','Pending','Ne répond pas',12,null,'{}'::jsonb)`,[traite.id,T,U.agent,A1]))
const confAvecLiv=await commande({agent_id:A1}); await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[confAvecLiv.id])
const congo=await commande({pays_id:CG, agent_id:ACG})
const autreEnt=await ins('commandes',{lead_id:'X1',tenant_id:T2,pays_id:AO2,client_nom:'Z',client_telephone:'+1',produit:'X',quantite:1,prix:1})
const inconnue=crypto.randomUUID()
const avantLot=await nbHist()
let res=await lotAgent(U.manager,[p1.id,p2.id,p3.id,p1.id,traite.id,confAvecLiv.id,congo.id,autreEnt.id,inconnue],A2)
check('lot : une réponse par commande distincte (doublon compté une fois)', res.length===8, JSON.stringify(res))
check('… p1, p2 appliqués', par(res,p1.id)?.resultat==='applique' && par(res,p2.id)?.resultat==='applique')
check('… p3 (avait déjà A2) inchangé', par(res,p3.id)?.resultat==='inchange')
check('… lead traité (Unreached) : appliqué aussi (plus de règle Pending)', par(res,traite.id)?.resultat==='applique', JSON.stringify(par(res,traite.id)))
check('… lead confirmé : appliqué aussi', par(res,confAvecLiv.id)?.resultat==='applique')
const hsTraite=await q(`select fait_par, statut from public.historique_statuts where commande_id=$1 and statut='Unreached'`,[traite.id])
check('… sa ligne de statut garde son auteur (Agent Un), pas le nouvel agent', hsTraite.length===1 && hsTraite[0].fait_par===U.agent, JSON.stringify(hsTraite))
check('… son appel garde son agent (Performances compte appels.agent_id)', (await q(`select agent_id from public.appels where commande_id=$1 and statut='Unreached'`,[traite.id]))[0]?.agent_id===A1)
check('… autre pays refusé, agent nommé', par(res,congo.id)?.resultat==='refuse' && /Agent Deux ne travaille pas dans le pays/.test(par(res,congo.id).motif))
check('… autre entreprise / inconnue → « introuvable »', /introuvable/.test(par(res,autreEnt.id)?.motif) && /introuvable/.test(par(res,inconnue)?.motif))
check('… les refusées n\'ont pas bougé', (await q(`select agent_id from public.commandes where id=any($1)`,[[congo.id]])).every(r=>r.agent_id!==A2)
  && (await q(`select agent_id from public.commandes where id=$1`,[autreEnt.id]))[0].agent_id!==A2)
const lignesLot=await q(`select * from public.historique_affectations where cree_le >= (select max(cree_le) from public.historique_affectations) - interval '1 hour' and via='affectation'`)
check('… exactement 4 lignes d\'historique (une par commande appliquée)', await nbHist()-avantLot===4, String(await nbHist()-avantLot))
check('… même lot_id, via « affectation », qui = le manager', lignesLot.length===4 && lignesLot[0].lot_id && lignesLot.every(l=>l.lot_id===lignesLot[0].lot_id)
  && lignesLot.every(l=>l.fait_par===U.manager && l.apres_id===A2 && l.avant_id===A1))
check('… numéro de lot pas laissé posé', (await q(`select coalesce(current_setting('crm.affectation_lot',true),'') v`))[0].v==='')
res=await lotAgent(U.admin,[p1.id],A1)
const lot2=(await hist(p1.id)).at(-1).lot_id
check('deuxième clic → un autre lot_id', lot2 && lot2!==lignesLot[0].lot_id)

// une ligne qui casse dans la base : elle seule est refusée, son historique aussi
await db.exec(`create function public.t_casse() returns trigger language plpgsql as $$ begin
  if new.lead_id = 'CASSE' then raise exception 'règle de test : cette commande refuse'; end if; return new; end $$;
  create trigger t_casse before update of agent_id on public.commandes for each row execute function public.t_casse();`)
const casse=await commande({agent_id:A1, lead_id:'CASSE'}), saine=await commande({agent_id:A1})
const avantCasse=await nbHist()
res=await lotAgent(U.manager,[casse.id,saine.id],A2).catch(e=>[{commande_id:null,resultat:'TOUT LE LOT A ÉCHOUÉ',motif:e.message}])
check('erreur de la base sur une ligne → elle seule refusée, avec le texte', par(res,casse.id)?.resultat==='refuse' && /règle de test/.test(par(res,casse.id).motif) && par(res,saine.id)?.resultat==='applique')
check('… pas de ligne d\'historique pour elle, une pour l\'autre', await nbHist()-avantCasse===1 && (await hist(casse.id)).every(l=>l.via!=='affectation'))
await db.exec(`drop trigger t_casse on public.commandes; drop function public.t_casse();`)

// droits
const avantDroits=await nbHist()
for (const [qui,uid] of [['ceo',U.ceo],['agent',U.agent],['vendeur',U.seller],['livreur',U.livreur]]) {
  e=await erreur(()=>lotAgent(uid,[p2.id],A1))
  check(`${qui} → refusé`, /Seuls un manager ou un admin/.test(e||''), String(e))
}
e=await erreur(()=>lotAgent(U.manager2,[p2.id],A1)); check('manager d\'une autre entreprise → refusé', /Seuls un manager/.test(e||''), String(e))
e=await erreur(()=>lotAgent(U.manager2,[autreEnt.id],AT2,T)); check('… même en visant l\'autre entreprise', /Seuls un manager/.test(e||''), String(e))
e=await erreur(()=>sous(null,'anon',()=>q(`select * from public.affecter_agent_lot($1,$2,$3)`,[T,[p2.id],A1]))); check('anon → refusé', /permission denied/.test(e||''), String(e))
e=await erreur(()=>lotAgent(U.manager,[p2.id],AINACTIF)); check('agent inactif → tout le lot refusé, nommé', /Agent Parti est inactif/.test(e||''), String(e))
e=await erreur(()=>lotAgent(U.manager,[p2.id],AT2)); check('agent d\'une autre entreprise → refusé', /introuvable/.test(e||''), String(e))
e=await erreur(()=>lotAgent(U.manager,Array.from({length:501},()=>crypto.randomUUID()),A1)); check('501 commandes → refusé', /Au plus 500/.test(e||''), String(e))
check('aucun refus de lot n\'a écrit', await nbHist()===avantDroits && (await q(`select agent_id from public.commandes where id=$1`,[p2.id]))[0].agent_id===A2)
res=await lotAgent(U.super_admin,[p2.id],A1)
check('super_admin → appliqué', res[0]?.resultat==='applique')
check('lot vide → rien', (await lotAgent(U.manager,[],A1)).length===0)

// =====================================================================
// E. affecter_livreur_lot — et le miroir qui ment
// =====================================================================
const conf=async(extra={})=>{ const c=await commande(extra); await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[c.id]); return c }
const d1=await conf(), d2=await conf(), dPend=await commande(), dCg=await conf({pays_id:CG})
check('(ville sans livreur : pas de livraison automatique)', (await q(`select count(*)::int n from public.livraisons where commande_id=any($1)`,[[d1.id,d2.id]]))[0].n===0)
const avantLiv=await nbHist()
res=await lotLiv(U.manager,[d1.id,d2.id,dPend.id,dCg.id],L1)
check('lot livreur : 2 appliqués', par(res,d1.id)?.resultat==='applique' && par(res,d2.id)?.resultat==='applique', JSON.stringify(res))
check('… pas confirmée → refusée', par(res,dPend.id)?.resultat==='refuse' && /pas confirmée/.test(par(res,dPend.id).motif))
check('… autre pays → refusée, livreur nommé', /Livreur Luanda ne livre pas/.test(par(res,dCg.id)?.motif||''))
check('… livraisons créées « a_preparer »', (await q(`select count(*)::int n from public.livraisons where commande_id=any($1) and livreur_id=$2 and statut='a_preparer'`,[[d1.id,d2.id],L1]))[0].n===2)
const lh=await q(`select * from public.historique_affectations where quoi='livreur' and commande_id=any($1)`,[[d1.id,d2.id]])
check('… 2 lignes « livreur », même lot, nom du livreur, qui', await nbHist()-avantLiv===2 && lh.length===2 && lh[0].lot_id===lh[1].lot_id && lh.every(l=>l.apres_nom==='Livreur Luanda' && l.avant_id===null && l.fait_par===U.manager && l.via==='affectation'))
res=await lotLiv(U.manager,[d1.id],L1)
check('même livreur → inchangé, aucune ligne', res[0].resultat==='inchange' && await nbHist()-avantLiv===2)
res=await lotLiv(U.admin,[d1.id],L2)
h=(await hist(d1.id)).filter(l=>l.quoi==='livreur')
check('changement → la livraison change de livreur, ligne avant/après', res[0].resultat==='applique' && h.length===2 && h[1].avant_nom==='Livreur Luanda' && h[1].apres_nom==='Livreur Benguela'
  && (await q(`select livreur_id from public.livraisons where commande_id=$1`,[d1.id]))[0].livreur_id===L2)

// (c) CHANGER le livreur de plusieurs commandes qui en ont déjà un, en un lot
const ch=[await conf(), await conf(), await conf(), await conf()]
await lotLiv(U.manager,[ch[0].id,ch[1].id,ch[2].id],L1)
await lotLiv(U.manager,[ch[3].id],L2)
const livCh2=(await q(`select id from public.livraisons where commande_id=$1`,[ch[2].id]))[0].id
await db.exec(`set session_replication_role = replica`); await q(`update public.livraisons set statut='expedie' where id=$1`,[livCh2]); await db.exec(`set session_replication_role = origin`)
const livCh0=(await q(`select id from public.livraisons where commande_id=$1`,[ch[0].id]))[0].id
const voitAncien=async()=>(await sous(U.livreur,'authenticated',()=>q(`select id from public.livraisons where id=$1`,[livCh0]))).length
check('(c) avant : l\'ancien livreur voit sa livraison', await voitAncien()===1)
const avantCh=await nbHist()
res=await lotLiv(U.manager,ch.map(c=>c.id),L2)
check('(c) lot de changement : 2 changées, 1 déjà à lui, 1 partie refusée', par(res,ch[0].id)?.resultat==='applique' && par(res,ch[1].id)?.resultat==='applique'
  && par(res,ch[3].id)?.resultat==='inchange' && par(res,ch[2].id)?.resultat==='refuse', JSON.stringify(res))
check('(c) … la MÊME ligne de livraison change de livreur (pas de deuxième livraison)',
  (await q(`select count(*)::int n from public.livraisons where commande_id=any($1)`,[[ch[0].id,ch[1].id]]))[0].n===2
  && (await q(`select livreur_id, statut from public.livraisons where id=$1`,[livCh0]))[0].livreur_id===L2)
const hCh=await q(`select * from public.historique_affectations where quoi='livreur' and commande_id=any($1) and avant_id=$2 and apres_id=$3`,[[ch[0].id,ch[1].id],L1,L2])
check('(c) … 2 lignes Livreur Luanda → Livreur Benguela, même lot', await nbHist()-avantCh===2 && hCh.length===2 && hCh[0].lot_id===hCh[1].lot_id
  && hCh.every(l=>l.avant_nom==='Livreur Luanda' && l.apres_nom==='Livreur Benguela'))
check('(c) … la partie garde son livreur', (await q(`select livreur_id from public.livraisons where id=$1`,[livCh2]))[0].livreur_id===L1)
check('(c) après : l\'ancien livreur ne la lit plus (RLS)', await voitAncien()===0)
check('(c) … et ne lit pas pourquoi (aucune ligne d\'historique pour lui)', (await sous(U.livreur,'authenticated',()=>q(`select * from public.v_historique_affectations`))).length===0)

// le miroir ment dans les deux sens : on suit livraisons
await db.exec(`set session_replication_role = replica`)
await q(`update public.commandes set statut_livraison='livre' where id=$1`,[d2.id])          // miroir : livrée ; vrai : à préparer
await q(`update public.livraisons set statut='expedie' where commande_id=$1`,[d1.id])        // vrai : expédiée
await q(`update public.commandes set statut_livraison=null where id=$1`,[d1.id])             // miroir : rien
await db.exec(`set session_replication_role = origin`)
res=await lotLiv(U.manager,[d1.id,d2.id],LOFF).catch(e=>e.message)
check('livreur désactivé → tout le lot refusé', /Livreur Off est désactivé/.test(String(res)), String(res))
res=await lotLiv(U.manager,[d1.id,d2.id],L1)
check('miroir « livrée » mais livraison à préparer → appliqué (on lit livraisons)', par(res,d2.id)?.resultat==='applique' || par(res,d2.id)?.resultat==='inchange', JSON.stringify(res))
check('miroir vide mais livraison expédiée → refusé « expédiée »', par(res,d1.id)?.resultat==='refuse' && /déjà expédiée/.test(par(res,d1.id).motif), JSON.stringify(res))
for (const [st,mot] of [['livre','livrée'],['retour','en retour'],['annule','annulée']]) {
  await db.exec(`set session_replication_role = replica`); await q(`update public.livraisons set statut=$2 where commande_id=$1`,[d1.id,st]); await db.exec(`set session_replication_role = origin`)
  res=await lotLiv(U.manager,[d1.id],L1)
  check(`livraison ${st} → refusé « ${mot} »`, res[0].resultat==='refuse' && res[0].motif.includes(mot), res[0].motif)
}

// droits livreur
for (const [qui,uid] of [['ceo',U.ceo],['agent',U.agent],['vendeur',U.seller],['livreur',U.livreur],['manager autre entreprise',U.manager2]]) {
  e=await erreur(()=>lotLiv(uid,[d2.id],L2)); check(`livreur : ${qui} → refusé`, /pas le droit d'assigner/.test(e||''), String(e))
}
await q(`delete from public.role_permissions where role_id=$1 and permission_code='assigner_livreur'`,[roleId.manager])
e=await erreur(()=>lotLiv(U.manager,[d2.id],L2)); check('manager à qui on retire assigner_livreur → refusé (la permission décide, pas le nom du rôle)', /pas le droit/.test(e||''), String(e))
await ins('role_permissions',{role_id:roleId.manager,permission_code:'assigner_livreur'})

// livreur automatique à la confirmation
const auto=await commande({ville_zone:'Luanda', agent_id:A1})
const majAuto=await sous(U.agent,'authenticated',()=>q(`update public.commandes set statut_confirmation='Confirmed' where id=$1 returning id`,[auto.id]))
check('(témoin : l\'agent a bien pu confirmer son lead)', majAuto.length===1)
h=(await hist(auto.id)).filter(l=>l.quoi==='livreur')
check('livreur choisi à la confirmation → ligne « automatique », qui = l\'agent qui confirme', h.length===1 && h[0].via==='automatique' && h[0].fait_par===U.agent && h[0].apres_id===L1, JSON.stringify(h))
// par enregistrer_appel (clé service) : qui = ce qu'il a posé
const auto2=await commande({ville_zone:'Luanda'})
await sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,null,'Confirmed','Pending','ok',5,null,'{}'::jsonb)`,[auto2.id,T,U.agent]))
h=(await hist(auto2.id)).filter(l=>l.quoi==='livreur')
check('… via confirmer-appel (enregistrer_appel) → « automatique », qui = l\'appelant', h.length===1 && h[0].via==='automatique' && h[0].fait_par===U.agent, JSON.stringify(h))

// =====================================================================
// F. Garde, suppression
// =====================================================================
const uneLigne=(await hist(p1.id))[0]
e=await erreur(()=>q(`insert into public.historique_affectations (tenant_id,quoi,via) values ($1,'agent','systeme')`,[T]))
check('insertion à la main (éditeur SQL) → refusée', /ne s'écrit pas à la main/.test(e||''), String(e))
e=await erreur(()=>sous(null,'service_role',()=>q(`insert into public.historique_affectations (tenant_id,quoi,via) values ($1,'agent','systeme')`,[T])))
check('… clé service aussi', e!==null, String(e))
e=await erreur(()=>q(`select public.historiser_affectation('agent', c, null, null, false) from public.commandes c where id=$1`,[p1.id]))
check('fonction d\'écriture appelée à la main → refusée', /ne s'écrit pas à la main/.test(e||''), String(e))
e=await erreur(()=>q(`update public.historique_affectations set apres_nom='X' where id=$1`,[uneLigne.id])); check('modification → refusée', /ne se modifie pas/.test(e||''), String(e))
e=await erreur(()=>q(`delete from public.historique_affectations where id=$1`,[uneLigne.id])); check('suppression → refusée', /ne se supprime pas/.test(e||''), String(e))
e=await erreur(()=>db.exec(`truncate public.historique_affectations`)); check('truncate → refusé', /ne se vide pas/.test(e||''), String(e))
for (const [r,uid] of [['authenticated',U.manager],['anon',null]]) {
  e=await erreur(()=>sous(uid,r,()=>q(`select * from public.historique_affectations`))); check(`${r} ne lit pas la table`, /permission denied/.test(e||''), String(e))
}
const nP1=(await hist(p1.id)).length
await q(`delete from public.historique_statuts where false`) // (rien)
await q(`delete from public.livraisons where commande_id=$1`,[p1.id]); await q(`delete from public.appels where commande_id=$1`,[p1.id])
await q(`delete from public.commandes where id=$1`,[p1.id])
check('commande supprimée → ses lignes restent, sans lien, lisibles par le lead', (await q(`select count(*)::int n from public.historique_affectations where commande_id is null and commande_lead_id=$1`,[p1.lead_id]))[0].n===nP1 && nP1>0)
const dDel=d2.id
await q(`delete from public.livraisons where commande_id=$1`,[dDel]); await q(`delete from public.commandes where id=$1`,[dDel])
check('… livraison + commande supprimées → lignes livreur gardées', (await q(`select count(*)::int n from public.historique_affectations where commande_lead_id=$1 and quoi='livreur'`,[d2.lead_id]))[0].n>=1)

// =====================================================================
// G. La vue
// =====================================================================
const total=(await q(`select count(*)::int n from public.historique_affectations where tenant_id=$1`,[T]))[0].n
const vue=uid=>sous(uid,'authenticated',()=>q(`select * from public.v_historique_affectations`))
for (const r of ['manager','admin','ceo']) { const v=await vue(U[r]); check(`vue : ${r} lit toute son entreprise, avec qui`, v.length===total && v.some(x=>x.fait_par), `${v.length}/${total}`) }
for (const r of ['seller','agent','livreur']) check(`vue : ${r} → aucune ligne`, (await vue(U[r])).length===0)
check('vue : manager d\'une autre entreprise → aucune ligne de FG', (await vue(U.manager2)).every(x=>x.tenant_id!==T))
check('vue : super_admin → tout', (await vue(U.super_admin)).length===await nbHist())
const vl=(await vue(U.manager)).find(x=>x.lot_id===lignesLot[0].lot_id)
check('vue : lot_taille = 4 pour le premier lot', Number(vl?.lot_taille)===4, String(vl?.lot_taille))
check('vue : commande_supprimee vraie pour p1', (await vue(U.manager)).filter(x=>x.commande_lead_id===p1.lead_id).every(x=>x.commande_supprimee))
e=await erreur(()=>sous(null,'anon',()=>q(`select * from public.v_historique_affectations`))); check('vue : anon refusé', /permission denied/.test(e||''), String(e))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`delete from public.v_historique_affectations`))); check('vue : pas d\'écriture', /permission denied/.test(e||''), String(e))

// =====================================================================
// G bis. « Actions en masse » (30/10) : un lot de plus d'une commande exige
//        la permission, en plus du droit de l'action ; une seule commande non.
// =====================================================================
await q(`delete from public.role_permissions where role_id=$1 and permission_code='actions_masse'`,[roleId.manager])
{
  const m1=await commande({agent_id:A1}), m2=await commande({agent_id:A1})
  let e2=await lotAgent(U.manager,[m1.id,m2.id],A2).then(()=>null,x=>x.message)
  check('masse : manager sans « actions_masse », 2 leads → agent refusé', /Actions en masse/.test(e2||''), String(e2))
  check('… rien n\'a changé', (await q(`select count(*)::int n from public.commandes where id = any($1) and agent_id=$2`,[[m1.id,m2.id],A2]))[0].n===0)
  const r1=await lotAgent(U.manager,[m1.id],A2).catch(x=>[{resultat:x.message}])
  check('masse : sans la permission, UNE commande → agent changé', r1[0]?.resultat==='applique', JSON.stringify(r1))
  await q(`update public.commandes set statut_confirmation='Confirmed', adresse='Rua 1' where id = any($1)`,[[m1.id,m2.id]])
  e2=await lotLiv(U.manager,[m1.id,m2.id],L2).then(()=>null,x=>x.message)
  check('masse : manager sans « actions_masse », 2 commandes → livreur refusé', /Actions en masse/.test(e2||''), String(e2))
  const r2=await lotLiv(U.manager,[m1.id],L2).catch(x=>[{resultat:x.message}])
  check('masse : sans la permission, UNE commande → livreur (droit assigner_livreur suffit)', r2[0]?.resultat==='applique', JSON.stringify(r2))
  e2=await lotAgent(U.super_admin,[m1.id,m2.id],A1).then(()=>null,x=>x.message)
  check('masse : super_admin passe sans la ligne', e2===null, String(e2))
}
await ins('role_permissions',{role_id:roleId.manager,permission_code:'actions_masse'})

// =====================================================================
// H. Rejouer, puis le retour arrière
// =====================================================================
const nAvant=await nbHist()
e=await erreur(()=>db.exec(FA)); check('troisième passage sur une base qui a des lignes', e===null, String(e))
check('… aucune ligne perdue ni ajoutée', await nbHist()===nAvant)
for (const run of [1,2]) { e=await erreur(()=>db.exec(FRET)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
check('retour : les quatre triggers sont partis', (await q(`select count(*)::int n from pg_trigger where tgname in ('trg_historique_agent','trg_historique_livreur','trg_historique_affectations_garde','trg_historique_affectations_garde_vider')`))[0].n===0)
check('retour : les lignes restent', await nbHist()===nAvant)
const apresRet=await commande({agent_id:A1})
await q(`update public.commandes set agent_id=$2 where id=$1`,[apresRet.id,A2])
check('retour : les écritures sur commandes passent, sans ligne', await nbHist()===nAvant)
res=await lotAgent(U.manager,[apresRet.id],A1)
check('retour : les écrans marchent encore (le lot applique, sans historique)', res[0]?.resultat==='applique' && await nbHist()===nAvant)
e=await erreur(()=>db.exec(FA)); check('réinstaller après le retour', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
