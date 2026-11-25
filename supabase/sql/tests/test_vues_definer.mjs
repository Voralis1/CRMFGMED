// Les trois vues SECURITY DEFINER que le linter Supabase signale (02/11) :
// v_historique_statuts, v_historique_affectations, v_pays_livrables.
// Elles tournent avec les droits de leur propriétaire : rien derrière leur
// WHERE. On charge leurs définitions DE PRODUCTION (fixture lue le 02/11), les
// quatre fonctions qu'elles appellent (corps de production) et les droits de
// production, puis, pour CHAQUE rôle, on compare ce que la vue rend à ce que
// la règle dit, calculé à part sur les tables :
//   · historique des statuts : super_admin tout ; manager/admin/ceo leur
//     entreprise, avec « qui » ; vendeur ses commandes (propriétaire actuel,
//     sinon celui gardé sur la ligne si la commande est supprimée), « qui »
//     vide ; agent, livreur, compte sans rôle, anon : rien ;
//   · historique des affectations : super_admin tout ; responsables leur
//     entreprise ; tous les autres rien ;
//   · pays livrables : les pays de SON entreprise qui ont un entrepôt ;
//     anon et compte sans rôle rien ; anon ne peut rien y écrire ;
//   · contre-épreuve : en security_invoker, un manager ne lit plus rien.
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
await poserPermissions(db, { actions_masse: ['manager','admin','super_admin'], assigner_livreur: ['manager','admin','super_admin'] })
for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql']) await db.exec(lire(f))

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,ville_zone:'Nulle part',...extra})
const appel=(c,statut,prec,quand=null,uid=U.agent)=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,'note',10,$7,'{}'::jsonb)`,[c,T,uid,A1,statut,prec,quand]))
const suivi=async id=>(await q(`select nb_tentatives, derniere_tentative_statut, derniere_tentative_le, derniere_action_le, statut_confirmation, date_rappel from public.commandes where id=$1`,[id]))[0]
const lot=(uid,ids,statut,motif=null,date=null,t=T)=>sous(uid,'authenticated',()=>q(`select * from public.changer_statut_lot($1,$2,$3,$4,$5)`,[t,ids,statut,motif,date]))
const par=(res,id)=>res.find(r=>r.commande_id===id)
const dans=(j)=>new Date(Date.now()+j*86400000).toISOString()


for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql','commandes_statut_lot.sql','historique_affectations.sql'])
  await db.exec(lire(f))
await db.exec(lire('tests/fixtures/vues_definer_prod_02_11.sql'))

// ---- les comptes en plus : un 2e vendeur, un vendeur de l'autre entreprise, un compte sans rôle
await db.exec(`set session_replication_role = replica`)
const S2=crypto.randomUUID(), S3=crypto.randomUUID(), SANS=crypto.randomUUID()
for (const [u,e] of [[S2,'s2@x'],[S3,'s3@x'],[SANS,'sans@x']]) await q(`insert into auth.users values ($1,$2)`,[u,e])
await ins('user_roles',{user_id:S2,tenant_id:T,role:'seller'}); await ins('user_roles',{user_id:S3,tenant_id:T2,role:'seller'})
await ins('pays',{tenant_id:T,nom:'Gabon',code:'GA'})                     // un pays SANS entrepôt
await db.exec(`set session_replication_role = origin`)
await poserPermissions(db, { actions_masse: ['manager','admin','super_admin'], assigner_livreur: ['manager','admin','super_admin'] })

// ---- des historiques : appels (avec « qui »), affectations, une commande déplacée, une supprimée
let k=0
const cmd=async(t,pays,vendeur,agent=null)=>ins('commandes',{lead_id:'V'+(++k),tenant_id:t,pays_id:pays,client_nom:'C'+k,client_telephone:'+1'+k,produit:'X',quantite:1,prix:1,ville_zone:'Z',vendeur_id:vendeur,agent_id:agent})
const appelA=(c,t,statut,prec)=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,'note',30,null,'{}'::jsonb)`,[c,t,U.agent,t===T?A1:null,statut,prec]))
const oA=await cmd(T,AO,U.seller,A1); await appelA(oA.id,T,'Unreached','Pending'); await appelA(oA.id,T,'Confirmed','Unreached')
const oB=await cmd(T,AO,S2,A1); await appelA(oB.id,T,'Cancelled','Pending')
const oM=await cmd(T,AO,U.seller,A1); await appelA(oM.id,T,'Unreached','Pending')
await q(`update public.commandes set vendeur_id=$1 where id=$2`,[S2,oM.id])              // déplacée de A vers S2
const oD=await cmd(T,AO,U.seller,A1); await appelA(oD.id,T,'Cancelled','Pending')
const oN=await cmd(T,AO,null,A1); await appelA(oN.id,T,'Unreached','Pending')            // sans vendeur
const o2=await cmd(T2,AO2,S3); await appelA(o2.id,T2,'Cancelled','Pending')
await q(`update public.commandes set agent_id=null where id in ($1,$2)`,[oA.id,oN.id])    // des affectations
await q(`update public.commandes set agent_id=$1 where id=$2`,[A1,oN.id])
await q(`delete from public.commandes where id=$1`,[oD.id])                                // supprimée : ses lignes restent

// ---- la règle, calculée à part (droits du propriétaire, sur les tables)
const hs=await q(`select h.id, h.tenant_id, h.fait_par, h.fait_par_nom, h.vendeur_id, (select c.vendeur_id from public.commandes c where c.id=h.commande_id) proprio from public.historique_statuts h`)
const ha=await q(`select id, tenant_id from public.historique_affectations`)
const pl=await q(`select distinct p.tenant_id, p.id pays_id from public.pays p join public.entrepots e on e.pays_id=p.id`)
check('les données couvrent les cas (lignes des deux entreprises, ligne supprimée, déplacée, affectations)',
  hs.some(h=>h.tenant_id===T2) && hs.some(h=>h.proprio==null && h.vendeur_id===U.seller) && hs.some(h=>h.proprio===S2 && h.vendeur_id===U.seller) && ha.length>=3 && ha.some(h=>h.tenant_id===T), JSON.stringify({hs:hs.length,ha:ha.length}))
const tenantDe=async u=>(await q(`select tenant_id from public.user_roles where user_id=$1 limit 1`,[u]))[0]?.tenant_id
const attendu=async(role,uid)=>{
  const t=uid?await tenantDe(uid):null
  if (role==='super_admin') return { s:hs.map(h=>h.id), a:ha.map(h=>h.id), p:pl, qui:true }
  if (['manager','admin','ceo','manager2'].includes(role)) return { s:hs.filter(h=>h.tenant_id===t).map(h=>h.id), a:ha.filter(h=>h.tenant_id===t).map(h=>h.id), p:pl.filter(x=>x.tenant_id===t), qui:true }
  if (role.startsWith('seller')) return { s:hs.filter(h=>h.tenant_id===t && (h.proprio ?? h.vendeur_id)===uid).map(h=>h.id), a:[], p:pl.filter(x=>x.tenant_id===t), qui:false }
  if (role==='sans' || role==='anon') return { s:[], a:[], p:[], qui:false }
  return { s:[], a:[], p:pl.filter(x=>x.tenant_id===t), qui:false }            // agent, livreur
}
const lire3=async()=>{
  const r={}
  for (const [cle,v] of [['s','v_historique_statuts'],['a','v_historique_affectations'],['p','v_pays_livrables']]) {
    try { r[cle]=await q(`select * from public.${v}`) } catch(e){ r[cle]='REFUS: '+e.message }
  }
  return r }
const trie=a=>JSON.stringify([...a].sort())
const COMPTES={ super_admin:U.super_admin, manager:U.manager, admin:U.admin, ceo:U.ceo, manager2:U.manager2, seller:U.seller, seller2:S2, seller3:S3, agent:U.agent, livreur:U.livreur, sans:SANS }
for (const [role,uid] of Object.entries(COMPTES)) {
  const att=await attendu(role,uid), r=await sous(uid,'authenticated',lire3)
  check(`${role} : historique des statuts = la règle (${att.s.length} ligne(s))`, Array.isArray(r.s) && trie(r.s.map(x=>x.id))===trie(att.s), Array.isArray(r.s)?trie(r.s.map(x=>x.id)):r.s)
  if (Array.isArray(r.s) && r.s.length) {
    if (att.qui) check(`${role} : « qui » donné, identique à la table`, r.s.every(x=>{ const h=hs.find(y=>y.id===x.id); return x.fait_par===h.fait_par && x.fait_par_nom===h.fait_par_nom }) && (r.s.some(x=>x.fait_par) || !att.s.some(id=>hs.find(h=>h.id===id).fait_par)))
    else check(`${role} : « qui » vide sur chaque ligne`, r.s.every(x=>x.fait_par===null && x.fait_par_nom===null))
  }
  check(`${role} : historique des affectations = la règle (${att.a.length} ligne(s))`, Array.isArray(r.a) && trie(r.a.map(x=>x.id))===trie(att.a), Array.isArray(r.a)?trie(r.a.map(x=>x.id)):r.a)
  check(`${role} : pays livrables = la règle (${att.p.length})`, Array.isArray(r.p) && trie(r.p.map(x=>x.tenant_id+'/'+x.pays_id))===trie(att.p.map(x=>x.tenant_id+'/'+x.pays_id)), JSON.stringify(r.p))
}
check('le vendeur ne voit plus la commande déplacée chez S2, S2 la voit', (await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.v_historique_statuts where commande_id=$1`,[oM.id])))[0].n===0 && (await sous(S2,'authenticated',()=>q(`select count(*)::int n from public.v_historique_statuts where commande_id=$1`,[oM.id])))[0].n>0)
check('le vendeur voit encore l\'historique de sa commande supprimée', (await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.v_historique_statuts where commande_supprimee`)))[0].n>0)
check('le pays sans entrepôt n\'est livrable pour personne', (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.v_pays_livrables where nom='Gabon'`)))[0].n===0)

// anon
const ra=await sous(null,'anon',lire3)
check('anon : historique des statuts refusé', typeof ra.s==='string' && /permission denied/.test(ra.s), String(ra.s))
check('anon : historique des affectations refusé', typeof ra.a==='string' && /permission denied/.test(ra.a), String(ra.a))
check('anon : pays livrables — 0 ligne (seul le WHERE l\'arrête : get_my_tenant_id() est NULL)', Array.isArray(ra.p) && ra.p.length===0, JSON.stringify(ra.p))
let e=await erreur(()=>sous(null,'anon',()=>q(`insert into public.v_pays_livrables (tenant_id, pays_id, nom) values ($1,$2,'X')`,[T,AO])))
check('anon : écrire dans v_pays_livrables échoue (vue non modifiable : DISTINCT + jointure)', /cannot insert into view|not automatically updatable/i.test(e||''), String(e))
e=await erreur(()=>sous(U.seller,'authenticated',()=>q(`select * from public.historique_statuts`)))
check('la table historique_statuts reste fermée à un compte de l\'app', /permission denied/.test(e||''), String(e))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.historique_affectations`)))
check('la table historique_affectations aussi (même pour un manager)', /permission denied/.test(e||''), String(e))
e=await erreur(()=>sous(U.seller,'authenticated',()=>q(`select * from public.entrepots`)))
const entVendeur=e?-1:(await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.entrepots`)))[0].n
check('un vendeur ne lit pas entrepots (c\'est pourquoi v_pays_livrables tourne en propriétaire)', entVendeur===0, String(e||entVendeur))

// contre-épreuve : security_invoker = on
const basculer=(v)=>db.exec(`alter view public.v_historique_statuts set (security_invoker = ${v}); alter view public.v_historique_affectations set (security_invoker = ${v}); alter view public.v_pays_livrables set (security_invoker = ${v});`)
await basculer('on')
const inv=await sous(U.manager,'authenticated',lire3), invS=await sous(U.seller,'authenticated',lire3)
await basculer('off')
check('en security_invoker, un manager ne lit plus l\'historique des statuts', typeof inv.s==='string' || inv.s.length===0, JSON.stringify(inv.s).slice(0,80))
check('… ni celui des affectations', typeof inv.a==='string' || inv.a.length===0, JSON.stringify(inv.a).slice(0,80))
check('… et un vendeur n\'a plus aucun pays livrable', typeof invS.p==='string' || invS.p.length===0, JSON.stringify(invS.p).slice(0,80))
check('(remis : la vue répond de nouveau au manager)', (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.v_historique_statuts`)))[0].n>0)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
