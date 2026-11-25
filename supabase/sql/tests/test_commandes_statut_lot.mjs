// commandes_statut_lot.sql sur le schéma réel + ce qui est en production
// (statut_pending, historique_statuts, leads_remontes, appels_responsables,
// renvoyer_en_attente) :
//   · prérequis ; une faute dans le trigger → la répétition arrête tout ;
//   · deux passages : seules les quatre colonnes de suivi bougent ; elles
//     disent ce que le badge affichait (copie figée de affichageStatut.mjs) ;
//   · une tentative = un vrai changement vers un statut ouvert ≠ Pending, PAS
//     un lot ; dernière action = toute ligne ;
//   · changer_statut_lot : lot mixte, raisons, même lot_id, motif, aucune
//     ligne dans appels, droits, Pending (motif, livreur nommé), Rappel
//     (heure, bornes), Non joint efface l'heure ;
//   · NOUVEAU REFUS : Non joint / Rappel sur une commande qu'un livreur a,
//     par tous les chemins (lot, navigateur, confirmer-appel) ; un statut qui
//     ferme passe toujours ;
//   · garde des colonnes ; vue (lot_id) ; retour arrière ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
import { resumeTentatives, estTentative } from './fixtures/affichageStatut_28_10.mjs'
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
const FF=fs.readFileSync(process.env.FICHIER||R+'sql/commandes_statut_lot.sql','utf8')
const FRET=lire('commandes_statut_lot_retour.sql')
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

// =====================================================================
// A. Prérequis, faute injectée
// =====================================================================
let e=await erreur(()=>db.exec(FF))
check('sans renvoyer_en_attente.sql → refusé', /renvoyer_en_attente.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
await db.exec(lire('renvoyer_en_attente.sql'))

// ---- l'existant : des commandes avec un historique d'avant le fichier
const v1=await commande({agent_id:A1}); await appel(v1.id,'Unreached','Pending'); await appel(v1.id,'Reminder','Unreached',dans(1))
const v2=await commande({agent_id:A1}); await appel(v2.id,'Unreached','Pending'); await appel(v2.id,'Confirmed','Unreached')
const v3=await commande()
const v4=await commande({agent_id:A1}); await appel(v4.id,'Unreached','Pending'); await appel(v4.id,'Unreached','Unreached'); await appel(v4.id,'Cancelled','Unreached')

const FAUTIF=FF.replace('  perform public.recalculer_suivi_statuts(new.id);\n  return null;','  return null;')
check('(témoin : faute injectée)', FAUTIF!==FF)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('trigger qui ne recalcule plus → la répétition arrête le fichier', /RÉPÉTITION ÉCHOUÉE/.test(e||''), String(e))
check('… rien installé (ni colonnes, ni fonction de lot, ancien corps du trigger)',
  (await q(`select count(*)::int n from information_schema.columns where table_name='commandes' and column_name='nb_tentatives'`))[0].n===0
  && (await q(`select count(*)::int n from pg_proc where proname='changer_statut_lot'`))[0].n===0
  && !(await q(`select prosrc from pg_proc where proname='ecrire_historique_statut'`))[0].prosrc.includes('recalculer'))

// =====================================================================
// B. Installation : seules les colonnes de suivi bougent ; elles = le badge d'avant
// =====================================================================
const photo=async()=>JSON.stringify(await q(`select id, statut_confirmation, updated_at, agent_id, date_rappel, adresse from public.commandes order by id`))
const avant=await photo()
const histAvant=(await q(`select count(*)::int n from public.historique_statuts`))[0].n
for (const run of [1,2]) { e=await erreur(()=>db.exec(FF)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune autre colonne de commande modifiée (statut, updated_at…)', await photo()===avant)
check('historique : aucune ligne ajoutée par l\'installation', (await q(`select count(*)::int n from public.historique_statuts`))[0].n===histAvant)
check('répétition : rien ne reste', (await q(`select (select count(*) from public.commandes where lead_id like 'REPETITION-%') + (select count(*) from public.historique_statuts where commande_lead_id like 'REPETITION-%') n`))[0].n==0)
const statutsT=await q(`select * from public.statuts where tenant_id=$1 order by nom`,[T])
for (const c of [v1,v2,v3,v4]) {
  const noms=statutsT.filter(s=>estTentative(s.nom,statutsT)).map(s=>s.nom)
  const lignes=await q(`select statut, cree_le from public.historique_statuts where commande_id=$1 and statut = any($2)`,[c.id,noms])
  const b=resumeTentatives(lignes,statutsT), s=await suivi(c.id)
  const pareil = b===null ? s.nb_tentatives===0 && s.derniere_tentative_statut===null
                          : s.nb_tentatives===b.n && s.derniere_tentative_statut===b.statut && new Date(s.derniere_tentative_le).getTime()===new Date(b.date).getTime()
  check(`${c.lead_id} : colonnes = ce que le badge affichait (${b?b.n+' × '+b.statut:'aucune'})`, pareil, JSON.stringify({b,s}))
}
check('dernière action = la dernière ligne d\'historique', new Date((await suivi(v4.id)).derniere_action_le).getTime()
  === new Date((await q(`select max(cree_le) m from public.historique_statuts where commande_id=$1`,[v4.id]))[0].m).getTime())

// =====================================================================
// C. Une tentative = un vrai changement ; un lot n'en est pas une
// =====================================================================
const t1=await commande({agent_id:A1})
check('naissance : 0 tentative, dernière action posée', (await suivi(t1.id)).nb_tentatives===0 && (await suivi(t1.id)).derniere_action_le!==null)
await appel(t1.id,'Unreached','Pending')
check('appel Non joint → 1 tentative, dernier mot Unreached', (await suivi(t1.id)).nb_tentatives===1 && (await suivi(t1.id)).derniere_tentative_statut==='Unreached')
await sous(U.manager,'authenticated',()=>q(`update public.commandes set statut_confirmation='Reminder', date_rappel=$2 where id=$1`,[t1.id,dans(1)]))
check('changement direct (navigateur) vers Rappel → 2 tentatives', (await suivi(t1.id)).nb_tentatives===2)
const actAvant=(await suivi(t1.id)).derniere_action_le
let res=await lot(U.manager,[t1.id],'Unreached')
check('lot → Non joint : appliqué', res[0]?.resultat==='applique', JSON.stringify(res))
check('… PAS compté comme tentative (toujours 2, dernier mot Reminder)', (await suivi(t1.id)).nb_tentatives===2 && (await suivi(t1.id)).derniere_tentative_statut==='Reminder')
check('… mais la dernière action avance', new Date((await suivi(t1.id)).derniere_action_le) > new Date(actAvant))
check('… et l\'heure de rappel est effacée', (await suivi(t1.id)).date_rappel===null)

// =====================================================================
// D. changer_statut_lot : lot mixte
// =====================================================================
const m1=await commande(), m2=await commande(), dejaNJ=await commande(), congo=await commande({pays_id:CG})
await appel(dejaNJ.id,'Unreached','Pending')
const autre=await ins('commandes',{lead_id:'X1',tenant_id:T2,pays_id:AO2,client_nom:'Z',client_telephone:'+1',produit:'X',quantite:1,prix:1})
const inconnue=crypto.randomUUID()
const appelsAvant=(await q(`select count(*)::int n from public.appels`))[0].n
res=await lot(U.manager,[m1.id,m2.id,m1.id,dejaNJ.id,congo.id,autre.id,inconnue],'Unreached','rappel groupé')
check('une réponse par commande distincte', res.length===6, JSON.stringify(res))
check('m1, m2 appliqués ; déjà Non joint → inchangé', par(res,m1.id)?.resultat==='applique' && par(res,m2.id)?.resultat==='applique' && par(res,dejaNJ.id)?.resultat==='inchange')
check('Congo : Unreached vaut pour tous les pays → appliqué', par(res,congo.id)?.resultat==='applique')
check('autre entreprise / inconnue → « introuvable »', /introuvable/.test(par(res,autre.id)?.motif) && /introuvable/.test(par(res,inconnue)?.motif))
const lh=await q(`select * from public.historique_statuts where commande_id = any($1) and via='lot'`,[[m1.id,m2.id,congo.id]])
check('une ligne d\'historique par commande appliquée, même lot_id, motif, qui', lh.length===3 && lh.every(l=>l.lot_id && l.lot_id===lh[0].lot_id && l.note==='rappel groupé' && l.fait_par===U.manager && l.fait_par_nom==='Mme Manager'))
check('aucune ligne dans appels (personne n\'a appelé)', (await q(`select count(*)::int n from public.appels`))[0].n===appelsAvant)
check('numéro de lot pas laissé posé', (await q(`select coalesce(current_setting('crm.statut_lot',true),'') v`))[0].v==='')
res=await lot(U.manager,[m1.id],'Occupé')
check('statut d\'un autre pays (Occupé = Congo) sur une commande d\'Angola → refusé', res[0]?.resultat==='refuse' && /pays/.test(res[0].motif), JSON.stringify(res))
res=await lot(U.manager,[congo.id],'Occupé')
check('… sur une commande du Congo → appliqué', res[0]?.resultat==='applique')
const vue=await sous(U.manager,'authenticated',()=>q(`select lot_id from public.v_historique_statuts where commande_id=$1 and via='lot'`,[m1.id]))
check('la vue rend lot_id', vue.length===1 && vue[0].lot_id===lh[0].lot_id)

// statuts refusés pour tout le lot
for (const [st,re] of [['Confirmed',/Seuls En attente, Non joint et Rappel/],['Cancelled',/Seuls En attente/],['Inexistant',/Seuls En attente/]]) {
  e=await erreur(()=>lot(U.manager,[m1.id],st)); check(`lot → ${st} : tout refusé`, re.test(e||''), String(e))
}

// droits
for (const [qui,uid] of [['ceo',U.ceo],['agent',U.agent],['vendeur',U.seller],['livreur',U.livreur],['manager d\'une autre entreprise',U.manager2]]) {
  e=await erreur(()=>lot(uid,[m1.id],'Unreached')); check(`${qui} → refusé`, /Seuls un manager ou un admin/.test(e||''), String(e))
}
e=await erreur(()=>sous(null,'anon',()=>q(`select * from public.changer_statut_lot($1,$2,'Unreached',null,null)`,[T,[m1.id]])))
check('anon → refusé', /permission denied/.test(e||''), String(e))
check('admin et super_admin → passent', (await lot(U.admin,[m2.id],'Reminder',null,dans(2)))[0]?.resultat==='applique' && (await lot(U.super_admin,[m2.id],'Unreached'))[0]?.resultat==='applique')
e=await erreur(()=>lot(U.manager,Array.from({length:501},()=>crypto.randomUUID()),'Unreached')); check('501 commandes → refusé', /Au plus 500/.test(e||''), String(e))

// =====================================================================
// E. Pending : la règle de « Renvoyer en attente »
// =====================================================================
for (const motif of [null,'   ']) {
  e=await erreur(()=>lot(U.manager,[m1.id],'Pending',motif)); check(`Pending sans motif (${JSON.stringify(motif)}) → tout refusé`, /motif est obligatoire/.test(e||''), String(e))
}
res=await lot(U.manager,[m1.id],'Pending','erreur de saisie')
check('Pending avec motif → appliqué, note « Renvoyé en attente : … »', res[0]?.resultat==='applique'
  && (await q(`select count(*)::int n from public.historique_statuts where commande_id=$1 and statut='Pending' and note='Renvoyé en attente : erreur de saisie' and via='lot'`,[m1.id]))[0].n===1)
// une commande qu'un livreur a
const pl=await commande({agent_id:A1, ville_zone:'Nulle part'}); await appel(pl.id,'Confirmed','Pending')
await db.exec(`set session_replication_role = replica`); await ins('livraisons',{commande_id:pl.id,livreur_id:L1,tenant_id:T,statut:'a_preparer'}); await db.exec(`set session_replication_role = origin`)
res=await lot(U.manager,[pl.id],'Pending','test')
check('Pending sur une commande qu\'un livreur a → refusé, livreur nommé (règle de renvoyer_en_attente.sql)', res[0]?.resultat==='refuse' && /Livreur Un/.test(res[0].motif), JSON.stringify(res))

// =====================================================================
// F. NOUVEAU : Non joint / Rappel sur une commande qu'un livreur a
// =====================================================================
const avantRefus=(await q(`select count(*)::int n from public.historique_statuts where commande_id=$1`,[pl.id]))[0].n
res=await lot(U.manager,[pl.id],'Unreached')
check('lot → Non joint, livreur sur la commande → refusé, nommé', res[0]?.resultat==='refuse' && /Statut « Non joint » refusé : le livreur Livreur Un a cette commande \(livraison à préparer\)/.test(res[0].motif), JSON.stringify(res))
res=await lot(U.manager,[pl.id],'Reminder',null,dans(1))
check('lot → Rappel, idem', res[0]?.resultat==='refuse' && /Statut « Rappel » refusé/.test(res[0].motif))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[pl.id])))
check('update direct (navigateur) → refusé aussi', /Statut « Non joint » refusé/.test(e||''), String(e))
e=await erreur(()=>appel(pl.id,'Unreached','Confirmed'))
check('panneau d\'appel de l\'agent (enregistrer_appel, clé service) → refusé aussi', /Statut « Non joint » refusé/.test(e||''), String(e))
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Occupé' where id=$1`,[pl.id]))
check('statut ouvert d\'un autre pays : n\'est pas « ouvert » pour cette commande → ce trigger ne le juge pas', e===null || !/refusé : le livreur/.test(e), String(e))
await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[pl.id]).catch(()=>{})
check('rien d\'écrit par les refus', (await q(`select count(*)::int n from public.historique_statuts where commande_id=$1 and statut in ('Unreached','Reminder')`,[pl.id]))[0].n===0)
e=await erreur(()=>appel(pl.id,'Cancelled','Confirmed'))
check('un statut qui FERME passe toujours (Annulée, livreur présent)', e===null, String(e))
for (const st of ['expedie','livre','retour','annule']) {
  const x=await commande({agent_id:A1}); await appel(x.id,'Confirmed','Pending')
  await db.exec(`set session_replication_role = replica`); await ins('livraisons',{commande_id:x.id,livreur_id:L1,tenant_id:T,statut:st}); await db.exec(`set session_replication_role = origin`)
  res=await lot(U.manager,[x.id],'Unreached')
  check(`livraison « ${st} » → refusé aussi (toute livraison, comme Pending)`, res[0]?.resultat==='refuse' && /Livreur Un/.test(res[0].motif))
}

// =====================================================================
// G. Rappel : une heure, bornée
// =====================================================================
const r1=await commande()
for (const [quand,re,nom] of [[null,/Choisissez la date/,'sans heure'],[new Date(Date.now()-3600e3).toISOString(),/déjà passée/,'passée'],[dans(31),/30 jours au plus/,'à 31 jours']]) {
  e=await erreur(()=>lot(U.manager,[r1.id],'Reminder',null,quand)); check(`Rappel ${nom} → tout refusé`, re.test(e||''), String(e))
}
const h=dans(3)
res=await lot(U.manager,[r1.id],'Reminder',null,h)
check('Rappel à 3 jours → appliqué, date_rappel posée', res[0]?.resultat==='applique' && new Date((await suivi(r1.id)).date_rappel).getTime()===new Date(h).getTime())

// =====================================================================
// H. Garde des colonnes de suivi
// =====================================================================
for (const [qui,fn] of [['manager',f=>sous(U.manager,'authenticated',f)],['clé service',f=>sous(null,'service_role',f)],['éditeur SQL',f=>f()]]) {
  e=await erreur(()=>fn(()=>q(`update public.commandes set nb_tentatives=9 where id=$1`,[t1.id])))
  check(`${qui} : écrire nb_tentatives → refusé`, /ne s'écrit pas à la main/.test(e||''), String(e))
}
e=await erreur(()=>q(`update public.commandes set derniere_action_le=now() where id=$1`,[t1.id]))
check('écrire derniere_action_le → refusé', /ne s'écrit pas à la main/.test(e||''), String(e))
const neuve=await ins('commandes',{lead_id:'N1',tenant_id:T,pays_id:AO,client_nom:'N',client_telephone:'+9',produit:'X',quantite:1,prix:1,nb_tentatives:42})
check('insertion avec nb_tentatives=42 → ignoré (0)', (await suivi(neuve.id)).nb_tentatives===0)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.recalculer_suivi_statuts($1)`,[t1.id])))
check('recalculer_suivi_statuts pas appelable par l\'app', /permission denied/.test(e||''), String(e))
const ecarts=(await q(`select count(*)::int n from public.commandes c cross join lateral public.suivi_statuts(c.id) s
  where (c.nb_tentatives,c.derniere_tentative_statut,c.derniere_tentative_le,c.derniere_action_le) is distinct from (s.nb_tentatives,s.derniere_tentative_statut,s.derniere_tentative_le,s.derniere_action_le)`))[0].n
check('toutes les commandes : colonnes = historique recompté', ecarts===0, String(ecarts))

// =====================================================================
// I. Retour arrière COMPLET, réinstallation
// =====================================================================
const LIVE_MD5='2e40025a2a103a42be3ddbfc93757c4d'   // ecrire_historique_statut en production, lu le 29/10
const lotsAvant=(await q(`select count(*)::int n from public.historique_statuts where via='lot'`))[0].n
for (const run of [1,2]) { e=await erreur(()=>db.exec(FRET)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
const corps=(await q(`select md5(prosrc) m, length(prosrc)::int l from pg_proc where proname='ecrire_historique_statut'`))[0]
check('retour : trigger d\'historique identique, octet pour octet, à la production (md5)', corps.m===LIVE_MD5 && corps.l===2040, JSON.stringify(corps))
check('retour : les quatre colonnes et lot_id supprimés', (await q(`select count(*)::int n from information_schema.columns where table_schema='public'
  and ((table_name='commandes' and column_name in ('nb_tentatives','derniere_tentative_statut','derniere_tentative_le','derniere_action_le'))
    or (table_name in ('historique_statuts','v_historique_statuts') and column_name='lot_id'))`))[0].n===0)
check('retour : changer_statut_lot et toutes les fonctions du fichier supprimées', (await q(`select count(*)::int n from pg_proc where proname in
  ('changer_statut_lot','remplir_suivi_statuts','recalculer_suivi_statuts','suivi_statuts','est_tentative','est_statut_ouvert','suivi_statuts_garde','statut_ouvert_sans_livreur')`))[0].n===0)
check('retour : les deux triggers retirés', (await q(`select count(*)::int n from pg_trigger where tgname in ('trg_ab_statut_ouvert_livreur','trg_suivi_statuts_garde')`))[0].n===0)
check('retour : les lignes « lot » restent (l\'historique ne s\'efface pas)', (await q(`select count(*)::int n from public.historique_statuts where via='lot'`))[0].n===lotsAvant && lotsAvant>0)
check('retour : des lignes « lot » existent → la contrainte garde « lot »', /'lot'/.test((await q(`select pg_get_constraintdef(oid) d from pg_constraint where conname='historique_statuts_via_check'`))[0].d))
const vueApres=await sous(U.manager,'authenticated',()=>q(`select * from public.v_historique_statuts limit 1`))
check('retour : la vue se lit, sans lot_id, mêmes droits', vueApres.length===1 && !('lot_id' in vueApres[0]))
e=await erreur(()=>sous(null,'anon',()=>q(`select * from public.v_historique_statuts`))); check('retour : anon toujours refusé sur la vue', /permission denied/.test(e||''), String(e))
const apresRet=await commande(); e=await erreur(()=>appel(apresRet.id,'Unreached','Pending'))
check('retour : un appel s\'enregistre comme avant (historique écrit)', e===null && (await q(`select count(*)::int n from public.historique_statuts where commande_id=$1`,[apresRet.id]))[0].n===2, String(e))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[pl.id])))
check('retour : le refus « livreur sur Non joint » a disparu avec le fichier (état d\'avant)', e===null || !/refusé : le livreur/.test(e), String(e))
e=await erreur(()=>db.exec(FF)); check('réinstallation après le retour', e===null, String(e))
check('… le suivi rattrape ce qui s\'est passé pendant le retour', (await suivi(apresRet.id)).nb_tentatives===1)

// Le retour sur une base où le fichier n'a jamais tourné : il passe, ne casse rien.
const db2ok = FRET.includes('drop column if exists') && FRET.includes('drop function if exists') && FRET.includes('drop trigger if exists')
check('retour écrit pour tourner même si le fichier n\'a jamais tourné (if exists partout)', db2ok)

// « Actions en masse » (30/10) : sans la permission, un lot de 2 est refusé, une commande passe.
await db.exec(`delete from public.role_permissions where permission_code='actions_masse' and role_id=(select role_id from public.user_roles where user_id='${U.manager}')`)
{
  const m1=await commande(), m2=await commande()
  const e2=await lot(U.manager,[m1.id,m2.id],'Unreached').then(()=>null,x=>x.message)
  check('masse : manager sans « actions_masse », 2 commandes → refusé', /Actions en masse/.test(e2||''), String(e2))
  check('… aucune des deux n\'a changé', (await q(`select count(*)::int n from public.commandes where id = any($1) and statut_confirmation='Pending'`,[[m1.id,m2.id]]))[0].n===2)
  const r1=await lot(U.manager,[m1.id],'Unreached').catch(x=>[{resultat:x.message}])
  check('masse : sans la permission, UNE commande → appliqué (le tiroir)', r1[0]?.resultat==='applique', JSON.stringify(r1))
}

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
