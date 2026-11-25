// produit_meme_vendeur.sql (13/11) — une commande ne pointe jamais vers le produit d'un autre vendeur : témoins
// (lien forcé gardé ; produit et boutique changent de vendeur malgré commandes / SKU) ; après : lien forcé retiré →
// « Produit non reconnu », changement de vendeur de la commande, produit sans vendeur pour tous, même nom chez deux
// vendeurs ; produit / boutique : changement refusé s'il croiserait, permis sinon et vers vide ; retour arrière, fichier.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const S=lire('produit_meme_vendeur.sql'), SR=lire('produit_meme_vendeur_retour.sql')

const TF='9183429e-c75c-4ed2-a869-f8bfa011bbc2', T2='99999999-9999-9999-9999-999999999999'
const SRC='59768ff7-30a8-4c05-9ab2-c4d9c70e1978'
const U={ tarik:'00ad0558-c26d-44fb-aaaf-cdd6172aaf4a', vendeurB:'bbbbbbbb-0000-0000-0000-000000000002', manager:'bbbbbbbb-0000-0000-0000-000000000003',
          agent:'bbbbbbbb-0000-0000-0000-000000000004', livreur:'bbbbbbbb-0000-0000-0000-000000000005', manager2:'bbbbbbbb-0000-0000-0000-000000000006',
          super_admin:'bbbbbbbb-0000-0000-0000-000000000009' }
const CODES=['bonegel','clearzal','colontea','gingeroil','goldhuile','kidneytea','livertea','Retinol','Sp4','warming','Shilajit','huilejap']

let db
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
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

let P, AO, ENT, LIV, SRC2, PB_LIVER, PAUTRE
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
    revoke all on all tables in schema public from anon;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:TF,nom_entreprise:'Fgmed Angola'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:r==='manager2'?T2:TF,role:r==='tarik'||r==='vendeurB'?'seller':r.replace(/\d$/,'')})
  }
  AO=(await ins('pays',{tenant_id:TF,nom:'Angola',code:'AO'})).id
  const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
  ENT=(await ins('entrepots',{tenant_id:TF,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:TF,user_id:U.livreur,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  for (const [nom,code,ferme,decl] of [['Confirmed','confirmed',true,true],['Pending','pending',false,false]])
    await ins('statuts',{tenant_id:TF,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,type:'appel'})
  P={}
  for (const c of CODES) {
    P[c]=(await ins('produits',{tenant_id:TF,product:c==='livertea'?'Liver Detox Tea':c,code:c,vendeur_id:U.tarik,current_quantity:0})).id
    await ins('stocks',{tenant_id:TF,produit_id:P[c],entrepot_id:ENT,quantite_disponible:c==='Sp4'?0:10,quantite_reservee:0,quantite_defectueuse:0})
  }
  // même NOM chez un autre vendeur : un autre produit
  PB_LIVER=(await ins('produits',{tenant_id:TF,product:'Liver Detox Tea',code:'liver-b',vendeur_id:U.vendeurB})).id
  PAUTRE=(await ins('produits',{tenant_id:T2,product:'Liver Detox Tea',code:'livertea'})).id
  await ins('sources_import',{id:SRC,tenant_id:TF,nom:'Ma boutique',type:'webhook',token_hash:'h1',vendeur_id:U.tarik,actif:true})
  SRC2=(await ins('sources_import',{tenant_id:TF,nom:'Boutique 2',type:'webhook',token_hash:'h2',vendeur_id:U.tarik,actif:true})).id
  await ins('sources_import',{tenant_id:T2,nom:'Ailleurs',type:'webhook',token_hash:'h3',actif:true})
  await db.exec(`set session_replication_role = origin`)
  // la chaîne en prod le 09/11 : statuts, historique, renvoi, produit_id, livraison 05/11, paiement, vendeur, RÈGLES DE STOCK
  await db.exec(`set session_replication_role = replica`)
  for (const [nom,code,ferme,decl,rap] of [['Cancelled','cancelled',true,false,false],['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:TF,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql',
                   'commandes_statut_lot.sql','commandes_produit_id.sql','stock_livraison_autre_vendeur.sql','paiement_unique_commande.sql',
                   'livraison_atomique.sql','vendeur_commande.sql','stock_regles.sql','correspondances_sku.sql','produits_par_vendeur.sql']) await db.exec(lire(f))
}
let n=0
const commande=async(vendeur,produit,extra={})=>(await ins('commandes',{tenant_id:TF,lead_id:'L'+(++n),client_nom:'C',client_telephone:'+244'+n,produit,quantite:1,prix:1,pays_id:AO,ville_zone:'Luanda',vendeur_id:vendeur,...extra}))
const lien=async id=>(await q(`select produit_id from public.commandes where id=$1`,[id]))[0].produit_id
const forcer=(id,prod)=>db.exec(`select set_config('crm.produit_rattrapage','oui',false); update public.commandes set produit_id='${prod}' where id='${id}'; select set_config('crm.produit_rattrapage','',false);`)
const mapper=(src,sku,prod)=>ins('correspondances_sku',{tenant_id:TF,source_id:src,sku,produit_id:prod,multiplicateur:1})

// ===== témoins, avant =====
await base()
let c=await commande(U.vendeurB,'autre'); await forcer(c.id,P.bonegel)
check('AVANT (témoin) : la commande de B forcée vers le produit de Tarik garde le lien', await lien(c.id)===P.bonegel)
await commande(U.tarik,'colontea')
let e=await erreur(()=>q(`update public.produits set vendeur_id=$2 where id=$1`,[P.colontea,U.vendeurB]))
check('AVANT (témoin) : le produit de Tarik passe à B malgré la commande de Tarik', e===null, e)
await mapper(SRC,'GOLD-1',P.goldhuile)
e=await erreur(()=>q(`update public.sources_import set vendeur_id=$2 where id=$1`,[SRC,U.vendeurB]))
check('AVANT (témoin) : la boutique de Tarik passe à B malgré ses SKU vers les produits de Tarik', e===null, e)

// ===== après =====
await base()
for (const i of [1,2]) { e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i}`, e===null, e) }
// 1. la commande
c=await commande(U.tarik,'bonegel'); check('commande de Tarik « bonegel » → son produit', await lien(c.id)===P.bonegel)
let cb=await commande(U.vendeurB,'bonegel'); check('commande de B « bonegel » (B n\'en a pas) → pas reliée au produit de Tarik', await lien(cb.id)===null)
await forcer(cb.id,P.bonegel); check('commande de B forcée vers le produit de Tarik → lien retiré', await lien(cb.id)===null)
check('… elle devient « Produit non reconnu » à l\'arrivée', (await q(`select statut_confirmation s from public.commandes where id=$1`,[cb.id]))[0].s==='Produit non reconnu')
await q(`update public.commandes set vendeur_id=$2 where id=$1`,[c.id,U.vendeurB])
check('commande de Tarik passée à B → plus reliée au produit de Tarik', await lien(c.id)!==P.bonegel)
const PLIBRE=(await ins('produits',{tenant_id:TF,product:'Libre',code:'libre'})).id
const cl=await commande(U.vendeurB,'libre'); check('produit SANS vendeur → B s\'en sert (règle du 10/11)', await lien(cl.id)===PLIBRE)
const sansV=await commande(null,'goldhuile'); check('commande sans vendeur → le lien calculé reste', await lien(sansV.id)!==undefined)
const cliver=await commande(U.vendeurB,'Liver Detox Tea'); check('même NOM chez B et Tarik → le produit de B', await lien(cliver.id)===PB_LIVER, await lien(cliver.id))
// 2. le produit
await commande(U.tarik,'colontea')
e=await erreur(()=>q(`update public.produits set vendeur_id=$2 where id=$1`,[P.colontea,U.vendeurB]))
check('produit de Tarik avec une commande de Tarik → ne passe pas à B, le message le dit', e?.includes('ne change pas de vendeur') && e?.includes('1 commande'), e)
await mapper(SRC,'GOLD-1',P.goldhuile)
e=await erreur(()=>q(`update public.produits set vendeur_id=$2 where id=$1`,[P.goldhuile,U.vendeurB]))
check('produit de Tarik avec des SKU de la boutique de Tarik → ne passe pas à B', e?.includes('SKU de boutique') && !e?.includes(' 0 SKU'), e)
check('(huilejap : aucun SKU, aucune commande)', Number((await q(`select (select count(*) from public.correspondances_sku where produit_id=$1)+(select count(*) from public.commandes where produit_id=$1) n`,[P.huilejap]))[0].n)===0)
e=await erreur(()=>q(`update public.produits set vendeur_id=$2 where id=$1`,[P.huilejap,U.vendeurB]))
check('produit de Tarik sans commande ni SKU → passe à B', e===null, e)
e=await erreur(()=>q(`update public.produits set vendeur_id=null where id=$1`,[P.colontea]))
check('vendeur → vide (compte supprimé) : toujours permis', e===null, e)
// 3. la boutique
e=await erreur(()=>q(`update public.sources_import set vendeur_id=$2 where id=$1`,[SRC,U.vendeurB]))
check('boutique de Tarik avec des SKU vers ses produits → ne passe pas à B, le message le dit', e?.includes('ne change pas de vendeur') && e?.includes('SKU'), e)
e=await erreur(()=>q(`update public.sources_import set vendeur_id=$2 where id=$1`,[SRC2,U.vendeurB]))
check('boutique sans SKU → passe à B', e===null, e)
e=await erreur(()=>q(`update public.sources_import set vendeur_id=null where id=$1`,[SRC]))
check('boutique → vendeur vide : permis', e===null, e)
check('aucune commande croisée créée par ces essais', (await q(`select count(*)::int n from public.commandes c join public.produits p on p.id=c.produit_id where c.vendeur_id is not null and p.vendeur_id is not null and p.vendeur_id<>c.vendeur_id`))[0].n===0)

// ===== retour arrière =====
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
const cr=await commande(U.vendeurB,'x'); await forcer(cr.id,P.bonegel)
check('retour : comportement d\'avant (le lien forcé reste)', await lien(cr.id)===P.bonegel)
await q(`delete from public.commandes where id=$1`,[cr.id])
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
