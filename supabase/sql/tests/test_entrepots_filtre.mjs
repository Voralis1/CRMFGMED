// entrepots_filtre.sql (11/11) : le menu des entrepôts par compte (vendeur : les siens seulement ; autres : ceux de
// l'entreprise ; jamais une autre entreprise), les produits d'un entrepôt, le tableau de bord d'un entrepôt.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), RET=lire('stock_regles_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T3='33333333-3333-3333-3333-333333333333'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
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
async function base({renvoi='renvoyer_en_attente.sql', stock='stock_livraison_autre_vendeur.sql', installer=true}={}){
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
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:r+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,nom:'Livreur',user_id:U.livreur,pays_id:AO,actif:true,zone:'Ailleurs'})).id
  await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:AO,actif:true})
  for (const [nom,code,ferme,decl,rap] of [['Pending','pending',false,false,false],['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
    ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql',renvoi,
                   'commandes_statut_lot.sql','commandes_produit_id.sql',stock,'paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(f.startsWith('tests/')?lire(f):lire(f))
  if (installer) await db.exec(F)
}
const produit=async(code,stock)=>{
  const id=(await ins('produits',{tenant_id:T,product:'Produit '+code,code,price:1})).id
  if (stock!==null) await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',$4,'stock initial')`,[T,id,ENT,stock])
  return id
}
const lead=async(code,qte=1)=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:code,quantite:qte,prix:1,ville_zone:'Luanda',adresse:'rue'})).id
const statut=async id=>(await q(`select statut_confirmation s from public.commandes where id=$1`,[id]))[0].s
const confirmer=id=>q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[id])
const stock=async p=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,ENT]))[0]?.q
const livraison=async id=>{ const l=(await q(`select id from public.livraisons where commande_id=$1`,[id]))[0]; return l? l.id : (await ins('livraisons',{tenant_id:T,commande_id:id,livreur_id:LIV,statut:'a_preparer'})).id }
const livStatut=(l,s)=>sous(null,'service_role',()=>q(`select * from public.enregistrer_livraison($1,$2,null,$3)`,[l,s,s==='livre'?1:null]))


await base()
const FE=lire('entrepots_filtre.sql'), FER=lire('entrepots_filtre_retour.sql')
for (const i of [1,2]) { const e=await erreur(()=>db.exec(FE)); check(`fichier, passage ${i}`, e===null, e) }
// un 2e entrepôt (Congo) et une autre entreprise
await db.exec(`set session_replication_role = replica`)
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG',devise:'XAF'})).id
const ENT2=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
await ins('tenants',{id:T3,nom_entreprise:'Autre'}); const AO3=(await ins('pays',{tenant_id:T3,nom:'Angola',code:'AO'})).id
await ins('entrepots',{tenant_id:T3,nom:'Ailleurs',pays_id:AO3,actif:true})
await db.exec(`set session_replication_role = origin`)
const PA=await produit('pa',5)                      // sans vendeur, stock à Angola
const PS=(await ins('produits',{tenant_id:T,product:'Du vendeur',code:'ps',price:1,vendeur_id:U.seller})).id
await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',3,'x')`,[T,PS,ENT2])
const liste=async uid=>(await sous(uid,'authenticated',()=>q(`select nom from public.entrepots_du_compte($1) order by nom`,[T]))).map(r=>r.nom)
check('manager : les 2 entrepôts de SON entreprise (pas « Ailleurs »)', JSON.stringify(await liste(U.manager))==='["Angola","Congo"]', JSON.stringify(await liste(U.manager)))
check('agent : les mêmes', JSON.stringify(await liste(U.agent))==='["Angola","Congo"]')
check('vendeur : seulement l\'entrepôt où SES produits sont (Congo)', JSON.stringify(await liste(U.seller))==='["Congo"]', JSON.stringify(await liste(U.seller)))
let e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.entrepots_du_compte($1)`,[T3])))
check('une autre entreprise → refusé', e?.includes('pas la vôtre'), e)
const prods=async(uid,ent)=>(await sous(uid,'authenticated',()=>q(`select x from public.produits_de_l_entrepot($1,$2) x`,[T,ent]))).map(r=>r.x)
check('produits d\'Angola (manager) : pa', JSON.stringify(await prods(U.manager,ENT))===JSON.stringify([PA]))
check('produits du Congo (vendeur) : les siens', JSON.stringify(await prods(U.seller,ENT2))===JSON.stringify([PS]))
check('produits d\'Angola (vendeur) : rien (pa n\'est pas à lui)', (await prods(U.seller,ENT)).length===0)
// le tableau de bord
const l1=await lead('pa'), l2=await lead('pa')
await db.exec(`set session_replication_role = replica`)
const l3=(await ins('commandes',{lead_id:'CG1',tenant_id:T,pays_id:CG,entrepot_id:ENT2,client_nom:'X',client_telephone:'+2421',produit:'ps',quantite:1,prix:1,ville_zone:'B',adresse:'r',statut_confirmation:'Pending'})).id
await db.exec(`set session_replication_role = origin`)
const st=async(ent)=>(await sous(U.manager,'authenticated',()=>q(ent===undefined?`select public.stats_dashboard($1,now()-interval '1 day',now()+interval '1 day') s`:`select public.stats_dashboard($1,now()-interval '1 day',now()+interval '1 day',$2) s`, ent===undefined?[T]:[T,ent])))[0].s
const tout=await st(), nul=await st(null), ang=await st(ENT), cgo=await st(ENT2)
check('tableau de bord, entrepôt vide = l\'entreprise entière (identique)', JSON.stringify(nul)===JSON.stringify(tout))
check('Angola : 2 commandes ; Congo : 1 ; entreprise : 3', ang.kpis.commandesTotal===2 && cgo.kpis.commandesTotal===1 && tout.kpis.commandesTotal===3, JSON.stringify([ang.kpis.commandesTotal,cgo.kpis.commandesTotal,tout.kpis.commandesTotal]))
for (const i of [1,2]) { e=await erreur(()=>db.exec(FER)); check(`retour arrière, passage ${i}`, e===null, e) }
check('… le tableau de bord d\'origine reste', (await st()).kpis.commandesTotal===3)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
