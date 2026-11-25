// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production depuis, puis :
//   · statut_pending.sql (« Pending » devient un vrai statut) ;
//   · statut_pending_2_rattrapage.sql (NULL → Pending, puis NOT NULL) ;
//   · leads_remontes.sql (la marque « remonté », le bouton, l'effacement).
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
const F1=fs.readFileSync(R+'sql/statut_pending.sql','utf8')
const F2=fs.readFileSync(R+'sql/statut_pending_2_rattrapage.sql','utf8')
const F3=fs.readFileSync(R+'sql/leads_remontes.sql','utf8')
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

// ---- deux entreprises, les sept statuts dans chacune (comme statuts_standard.sql)
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', agent2:'aaaaaaaa-0000-0000-0000-000000000006',
          manager2:'aaaaaaaa-0000-0000-0000-000000000007' }
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
for (const [r,u] of Object.entries(U)) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  await ins('user_roles',{user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,'')})
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true}); await ins('entrepots',{tenant_id:T2,nom:'Angola',pays_id:AO2,actif:true})
const SEPT=[['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],['Double','double',true,false,false],
  ['Test','test',true,false,false],['Spam','spam',true,false,false],['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]]
for (const t of [T,T2]) for (const [nom,code,ferme,decl,rap] of SEPT)
  await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
const A1=(await ins('agents',{tenant_id:T,nom:'A1',user_id:U.agent,pays_id:AO,actif:true})).id
const A2=(await ins('agents',{tenant_id:T,nom:'A2',user_id:U.agent2,pays_id:AO,actif:true})).id
await db.exec(`set session_replication_role = origin`)
await poserPermissions(db)

let n=0
const ligne=(extra={})=>({lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,...extra})
const commande=async(extra={})=>ins('commandes',ligne(extra))
const statut=async id=>(await q(`select statut_confirmation s from public.commandes where id=$1`,[id]))[0].s

// =====================================================================
// A. Avant : fichier 2 refusé, des commandes à NULL existent
// =====================================================================
let e=await erreur(()=>db.exec(F2))
check('fichier 2 avant le fichier 1 → refusé', /Lancez d'abord statut_pending.sql/.test(e||''), String(e))
await db.exec('rollback').catch(()=>{})
const ex1=await commande(), ex2=await commande({tenant_id:T2,pays_id:AO2}), ex3=await commande({statut_confirmation:'Unreached'})
check('avant : un lead neuf est NULL', await statut(ex1.id)===null)

// =====================================================================
// B. Fichier 1
// =====================================================================
const photo=async()=>JSON.stringify(await q(`select id, statut_confirmation, updated_at from public.commandes order by id`))
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(F1)); check(`fichier 1, passage ${run}`, e===null, String(e)) }
check('fichier 1 : aucune commande existante modifiée (NULL reste NULL)', await photo()===avant)
check('une ligne « Pending » par entreprise, pas deux après deux passages',
  JSON.stringify(await q(`select tenant_id::text t, count(*)::int n from public.statuts where code='pending' group by 1 order by 1`))===JSON.stringify([{t:T,n:1},{t:T2,n:1}]))
const p=(await q(`select * from public.statuts where code='pending' and tenant_id=$1`,[T]))[0]
check('… « Pending », ouvert, n\'envoie pas au livreur, tous pays', p.nom==='Pending' && !p.ferme_le_lead && !p.declenche_assignation && p.pays_id===null)

// insertions, par tous les chemins
check('insert sans statut (saisie, CSV) → « Pending »', await statut((await commande()).id)==='Pending')
check('insert statut NULL explicite (l\'API) → « Pending »', await statut((await commande({statut_confirmation:null})).id)==='Pending')
check('insert statut vide → « Pending »', await statut((await commande({statut_confirmation:'  '})).id)==='Pending')
const sv=await sous('','service_role',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,statut_confirmation) values ('S1',$1,$2,'C','+1','X',1,1,null) returning id`,[T,AO]))
check('clé service (import-commande) → « Pending »', await statut(sv[0].id)==='Pending')
const vd=await sous(U.seller,'authenticated',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,vendeur_id) values ('V1',$1,$2,'C','+1','X',1,1,$3) returning id`,[T,AO,U.seller]))
check('vendeur (navigateur, RLS) → « Pending »', await statut(vd[0].id)==='Pending')
check('… une entreprise SANS ligne Pending a quand même des leads « Pending » (texte posé par la base)',
  await (async()=>{ await db.exec(`set session_replication_role = replica`); await q(`delete from public.statuts where code='pending' and tenant_id=$1`,[T2]); await db.exec(`set session_replication_role = origin`)
    const c=await commande({tenant_id:T2,pays_id:AO2}); const s=await statut(c.id); await db.exec(F1); return s==='Pending' })())

// mises à jour
const c1=await commande()
await q(`update public.commandes set statut_confirmation='Unreached' where id=$1`,[c1.id])
check('Pending → Unreached : accepté', await statut(c1.id)==='Unreached')
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[c1.id]))
check('Unreached → Pending : refusé (un seul chemin de retour)', /ne revient pas à « Pending »/.test(e||''), String(e))
e=await erreur(()=>q(`update public.commandes set statut_confirmation=null where id=$1`,[c1.id]))
check('Unreached → NULL : refusé aussi (NULL devient Pending)', /ne revient pas à « Pending »/.test(e||''), String(e))
e=await sous('','service_role',()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[c1.id])).then(()=>null,x=>x.message)
check('… même par la clé service (confirmer-appel)', /ne revient pas à « Pending »/.test(e||''), String(e))
await q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[ex1.id])
check('NULL existant → Pending : accepté (ce que fait le rattrapage)', await statut(ex1.id)==='Pending')
const c2=await commande(); await q(`update public.commandes set statut_confirmation='Pending', client_nom='D' where id=$1`,[c2.id])
check('Pending → Pending (réécrit) : accepté', await statut(c2.id)==='Pending')

// la ligne Pending est fixe
e=await erreur(()=>q(`update public.statuts set nom='En attente' where code='pending' and tenant_id=$1`,[T]))
check('renommer « Pending » : refusé', /ne se renomme pas/.test(e||''), String(e))
e=await erreur(()=>q(`update public.statuts set ferme_le_lead=true where code='pending' and tenant_id=$1`,[T]))
check('faire fermer le lead à « Pending » : refusé', /ne se renomme pas/.test(e||''), String(e))
e=await erreur(()=>q(`delete from public.statuts where code='pending' and tenant_id=$1`,[T]))
check('supprimer « Pending » : refusé', /ne se supprime pas/.test(e||''), String(e))
e=await erreur(()=>q(`update public.statuts set couleur='#000000' where code='pending' and tenant_id=$1`,[T]))
check('changer sa couleur : accepté', e===null, String(e))
e=await erreur(()=>q(`update public.statuts set couleur='#111111' where code='reminder' and tenant_id=$1`,[T]))
check('les autres statuts : inchangés (couleur modifiable)', e===null, String(e))

// choisir_agent compte « Pending »
await db.exec(`set session_replication_role = replica`)
await q(`update public.commandes set agent_id=$1 where tenant_id=$2`,[A1,T])
await db.exec(`set session_replication_role = origin`)
const choix=new Set(); for (let i=0;i<8;i++) choix.add((await q(`select public.choisir_agent($1,$2) a`,[T,AO]))[0].a)
check('choisir_agent : A1 a des leads « Pending », A2 aucun → A2 à chaque fois', choix.size===1 && choix.has(A2), JSON.stringify([...choix]))

// stats_dashboard : NULL et Pending, une seule part « Pending »
const st=(await q(`select public.stats_dashboard($1, now()-interval '1 day', now()+interval '1 day') s`,[T]))[0].s
const parts=st.overviewAppels.map(x=>x.label)
check('stats : NULL et « Pending » forment UNE part « Pending », pas de « En file »', parts.filter(l=>l==='Pending').length===1 && !parts.includes('En file'), JSON.stringify(st.overviewAppels))

// l'affectation du livreur marche toujours
const L=(await q(`insert into auth.users values (gen_random_uuid(),'l@x') returning id`))[0].id
await db.exec(`set session_replication_role = replica`)
await ins('zones',{tenant_id:T,pays_id:AO,nom_zone:'Luanda'}); await ins('livreurs',{tenant_id:T,pays_id:AO,user_id:L,nom:'L',zone:'Luanda',actif:true})
await db.exec(`set session_replication_role = origin`)
const c3=await commande({ville_zone:'Luanda'})
await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[c3.id])
check('Pending → Confirmed : le livreur est toujours affecté', (await q(`select count(*)::int n from public.livraisons where commande_id=$1`,[c3.id]))[0].n===1)

// =====================================================================
// C. Fichier 2 — le rattrapage
// =====================================================================
const nuls=(await q(`select count(*)::int n from public.commandes where statut_confirmation is null`))[0].n
const majAvant=JSON.stringify(await q(`select id, updated_at from public.commandes order by id`))
let res=await q(F2.slice(F2.indexOf('-- Le résultat')))  // (lecture seule de la table temp. : vide avant)
  .catch(()=>null)
e=await erreur(()=>db.exec(F2)); check('fichier 2, en entier', e===null, String(e))
res=await q(`select coalesce(t.nom_entreprise, r.tenant_id::text) e, r.n::int n from _pending_rattrapage r left join public.tenants t on t.id=r.tenant_id order by 1`)
check(`rattrapage : il restait ${nuls} NULL, le compte rendu dit ${nuls}`, res.reduce((s,r)=>s+r.n,0)===nuls && nuls>0, JSON.stringify(res))
check('plus aucune commande à NULL', (await q(`select count(*)::int n from public.commandes where statut_confirmation is null`))[0].n===0)
check('updated_at inchangé (l\'ordre « dernière mise à jour » ne bouge pas)', JSON.stringify(await q(`select id, updated_at from public.commandes order by id`))===majAvant)
const colonne=(await q(`select is_nullable, column_default from information_schema.columns where table_name='commandes' and column_name='statut_confirmation'`))[0]
check('colonne NOT NULL, « Pending » par défaut', colonne.is_nullable==='NO' && /Pending/.test(colonne.column_default||''), JSON.stringify(colonne))
check('ex3 (Unreached) intouché', await statut(ex3.id)==='Unreached')
e=await erreur(()=>db.exec(F2)); check('fichier 2, rejoué : passe', e===null, String(e))
res=await q(`select coalesce(sum(n),0)::int n from _pending_rattrapage`)
check('… et ne modifie plus rien (0)', res[0].n===0, JSON.stringify(res))
e=await erreur(()=>db.exec(F1)); check('fichier 1 rejoué après le 2 : passe', e===null, String(e))

// =====================================================================
// D. Fichier 3 — remonter des leads
// =====================================================================
for (const run of [1,2]) { e=await erreur(()=>db.exec(F3)); check(`leads_remontes.sql, passage ${run}`, e===null, String(e)) }
const mk=async(s,extra={})=>(await commande({statut_confirmation:s,...extra})).id
const u1=await mk('Unreached'), u2=await mk('Unreached'), pe=await mk(null), rm=await mk('Reminder'), cf=await mk('Confirmed'), ca=await mk('Cancelled')
const uL=await mk('Unreached'); await db.exec(`set session_replication_role = replica`); await q(`update public.commandes set statut_livraison='livre' where id=$1`,[uL]); await db.exec(`set session_replication_role = origin`)
const uT2=await mk('Unreached',{tenant_id:T2,pays_id:AO2})
const tous=[u1,u2,pe,rm,cf,ca,uL,uT2]
const remonter=(uid,t,ids)=>sous(uid,'authenticated',()=>q(`select public.remonter_leads($1,$2::uuid[]) n`,[t,ids])).then(r=>r[0].n, x=>x.message)
const marque=async id=>(await q(`select remonte_le, remonte_par from public.commandes where id=$1`,[id]))[0]
let r=await remonter(U.manager,T,tous)
check('manager : seuls les 2 Unreached de SON entreprise, en cours, sont remontés', r===2, String(r))
check('… u1 marqué, par le manager', (await marque(u1)).remonte_le!==null && (await marque(u1)).remonte_par===U.manager)
check('… ni Pending, ni Reminder, ni Confirmed, ni Cancelled, ni livré, ni l\'autre entreprise',
  (await Promise.all([pe,rm,cf,ca,uL,uT2].map(marque))).every(m=>m.remonte_le===null))
check('… le statut ne change pas (Unreached reste Unreached)', await statut(u1)==='Unreached')
const date1=(await marque(u1)).remonte_le
r=await remonter(U.admin,T,[u1,u2])
check('remonter encore : 0, la date d\'origine est gardée (pas de saut de file)', r===0 && +(await marque(u1)).remonte_le===+date1, String(r))
for (const role of ['ceo','agent','seller']) {
  r=await remonter(U[role],T,[u2])
  check(`${role} : refusé`, /Seuls un manager ou un admin/.test(String(r)), String(r))
}
r=await remonter(U.manager2,T,[u2])
check('manager d\'une AUTRE entreprise : refusé', /Seuls un manager ou un admin/.test(String(r)), String(r))
// sur un lead qui est le sien (sinon la RLS le cache : 0 ligne, pas d'erreur, rien de prouvé)
await db.exec(`set session_replication_role = replica`); await q(`update public.commandes set agent_id=$2 where id=$1`,[pe,A1]); await db.exec(`set session_replication_role = origin`)
e=await sous(U.agent,'authenticated',()=>q(`update public.commandes set remonte_le=now() where id=$1 returning id`,[pe])).then((r)=>r.length?null:'0 ligne',x=>x.message)
check('agent, console : poser la marque à la main → refusé', /Seuls un manager ou un admin/.test(e||''), String(e))
e=await sous('','anon',()=>q(`select public.remonter_leads($1,$2::uuid[])`,[T,[u2]])).then(()=>null,x=>x.message)
check('anon : refusé', /permission denied|Connexion requise/.test(e||''), String(e))

// un appel efface la marque, quel que soit le statut
await q(`insert into public.appels (commande_id, tenant_id, statut) values ($1,$2,'Unreached')`,[u1,T])
check('un appel enregistré (même statut) efface la marque', (await marque(u1)).remonte_le===null)
await sous('','service_role',()=>q(`insert into public.appels (commande_id, tenant_id, statut) values ($1,$2,'Confirmed')`,[u2,T]))
check('… par la clé service aussi (confirmer-appel)', (await marque(u2)).remonte_le===null)
r=await remonter(U.manager,T,[u1])
check('remonté de nouveau après l\'appel : possible', r===1, String(r))

// « Actions en masse » (30/10) : Remonter l'exige toujours, même pour un seul lead.
{
  await db.exec(`delete from public.role_permissions where permission_code='actions_masse' and role_id=(select role_id from public.user_roles where user_id='${U.manager}')`)
  const m=await commande({statut_confirmation:'Unreached'})
  const r2=await remonter(U.manager,T,[m.id])
  check('masse : manager sans « actions_masse » → Remonter refusé, même pour un lead', /Actions en masse/.test(String(r2)), String(r2))
  check('… la marque n\'est pas posée', (await q(`select remonte_le from public.commandes where id=$1`,[m.id]))[0].remonte_le===null)
}

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
