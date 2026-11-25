// produits_par_vendeur.sql (10/11, T14) sur la chaîne de prod du 10/11 (règles de stock, SKU, vendeur obligatoire) :
//   · AVANT (témoins) : un 2e vendeur ne peut pas reprendre un code ; sa commande est reliée au produit de Tarik ;
//   · fichier deux fois ; code unique par VENDEUR ; la commande trouve son produit chez SON vendeur (code, puis nom),
//     puis dans les produits sans vendeur — jamais chez un autre ; ambigu chez un même vendeur → rien ;
//   · changer le vendeur relie de nouveau (sauf une commande reliée par son SKU) ; produit_id à la main refusé ;
//   · commandes_produit_id.sql rejoué : gardé ; mutant arrêté par la répétition ;
//   · retour refusé tant qu'un code est partagé, puis deux fois ; règle d'avant revenue.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F1=lire('correspondances_sku.sql'), F2=lire('correspondances_sku_2_rattrapage.sql')
const RET1=lire('correspondances_sku_retour.sql'), RET2=lire('correspondances_sku_2_retour.sql')
const STOCK=lire('stock_livraison_autre_vendeur.sql'), STOCK_0211=lire('tests/fixtures/stock_livraison_autre_vendeur_02_11.sql')

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
                   'livraison_atomique.sql','vendeur_commande.sql','stock_regles.sql','correspondances_sku.sql']) await db.exec(lire(f))
}
let n=0
const ligne=(sku,titre,qte=1,prix=35000)=>JSON.stringify([sku===null?{produit:titre,quantite:qte,prix}:{code:sku,produit:titre,quantite:qte,prix}])
const boutique=async(sku,titre,{qte=1,prix=35000,source=SRC,articles,extra={}}={})=>
  (await sous(null,'service_role',()=>q(`insert into public.commandes (tenant_id,lead_id,client_nom,client_telephone,produit,quantite,prix,pays_id,ville_zone,vendeur_id,source_id,source,articles${Object.keys(extra).map(k=>','+k).join('')})
     values ($1,$2,'C','+244'||$2,$3,$4,$5,$6,'Luanda',$7,$8,'webhook',$9${Object.keys(extra).map((_,i)=>',$'+(10+i)).join('')}) returning *`,
     [TF,'MABOUTIQUE-'+(++n),titre,qte,prix,AO,U.tarik,source,articles??ligne(sku,titre,qte,prix),...Object.values(extra)])))[0]
const cmd=async id=>(await q(`select * from public.commandes where id=$1`,[id]))[0]
const livrer=async c=>{ const l=await ins('livraisons',{tenant_id:TF,commande_id:c.id,livreur_id:LIV,statut:'a_preparer'}); await q(`update public.livraisons set statut='livre' where id=$1`,[l.id]); return l }
const stock=async code=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[P[code],ENT]))[0]?.q
const mvts=async id=>(await q(`select produit_id, type_mouvement t, quantite q from public.mouvements_stock where notes like '%'||$1`,[id]))
const TITRE2='Chá de Limpeza do Fígado - Pacote Recomendado – 2 unidades', TITRE1='Chá de Limpeza do Fígado - Pacote Solo – 1 unidade'


const F=lire('produits_par_vendeur.sql'), FR=lire('produits_par_vendeur_retour.sql')
// l'index de prod (lu le 10/11, posé par intake_generique.sql) : un code par ENTREPRISE
const INDEX_PROD=`drop index if exists public.idx_produits_code_unique;
  create unique index idx_produits_code_unique on public.produits (tenant_id, lower(btrim(code))) where code is not null and btrim(code) <> '';`
await base(); await db.exec(INDEX_PROD)
let n2=0
const commande=async(vendeur,texte)=>(await ins('commandes',{tenant_id:TF,lead_id:'T14-'+(++n2),client_nom:'C',client_telephone:'+244777'+n2,produit:texte,quantite:1,prix:1000,pays_id:AO,ville_zone:'Luanda',adresse:'rue',vendeur_id:vendeur}))
const lien=async id=>(await q(`select produit_id from public.commandes where id=$1`,[id]))[0].produit_id
const produitB=(code,nom=code)=>ins('produits',{tenant_id:TF,product:nom,code,vendeur_id:U.vendeurB})

// ===== témoins =====
let e=await erreur(()=>produitB('clearzal','ClearZal B'))
check('AVANT (témoin) : le vendeur B ne peut pas avoir son « clearzal » (code pris par Tarik)', e?.includes('idx_produits_code_unique'), e)
let c=await commande(U.vendeurB,'bonegel')
check('AVANT (témoin) : la commande du vendeur B « bonegel » est reliée au produit de TARIK', await lien(c.id)===P.bonegel)

// ===== installation =====
for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i} (avec sa répétition)`, e===null, e) }
check('… la répétition n\'a rien laissé', (await q(`select count(*)::int n from public.produits where code like 'repetition-t14%'`))[0].n===0)
check('les commandes déjà reliées ne bougent pas', await lien(c.id)===P.bonegel)

const czB=(await produitB('clearzal','ClearZal B')).id
check('vendeur B : son propre « clearzal » est accepté', !!czB)
e=await erreur(()=>produitB('CLEARZAL ','ClearZal B2'))
check('un même vendeur, deux fois le même code (casse, espaces) → refusé', e?.includes('idx_produits_code_unique'), e)

c=await commande(U.vendeurB,'clearzal'); check('commande du vendeur B « clearzal » → SON produit', await lien(c.id)===czB)
c=await commande(U.tarik,'clearzal'); const cTarik=c.id; check('commande de Tarik « clearzal » → le produit de Tarik', await lien(c.id)===P.clearzal)
c=await commande(U.vendeurB,'bonegel'); check('vendeur B « bonegel » (code de Tarik seulement) → rien, jamais le produit de Tarik', await lien(c.id)===null)
c=await commande(U.vendeurB,'Liver Detox Tea'); check('par le NOM « Liver Detox Tea » (Tarik et B l\'ont) → celui de B', await lien(c.id)===PB_LIVER)
c=await commande(U.tarik,'Liver Detox Tea'); check('… et pour Tarik → le sien', await lien(c.id)===P.livertea)

const commun=(await ins('produits',{tenant_id:TF,product:'Produit commun',code:'commun',vendeur_id:null})).id
c=await commande(U.vendeurB,'commun'); check('produit SANS vendeur : utilisable par tous (vendeur B)', await lien(c.id)===commun)
const communB=(await produitB('commun','Commun de B')).id
c=await commande(U.vendeurB,'commun'); check('… mais le produit du vendeur passe AVANT celui sans vendeur', await lien(c.id)===communB)
c=await commande(U.tarik,'commun'); check('… Tarik, lui, reçoit le produit sans vendeur', await lien(c.id)===commun)
await ins('produits',{tenant_id:TF,product:'Double',code:'dbl-1',vendeur_id:U.vendeurB}); await ins('produits',{tenant_id:TF,product:'Double',code:'dbl-2',vendeur_id:U.vendeurB})
c=await commande(U.vendeurB,'Double'); check('deux produits au même nom chez un même vendeur → ambigu, rien', await lien(c.id)===null)

// changer le vendeur
await q(`update public.commandes set vendeur_id=$2 where id=$1`,[cTarik,U.vendeurB])
check('changer le vendeur (Tarik → B) : la commande « clearzal » est reliée de nouveau, au produit de B', await lien(cTarik)===czB)
const sku=await boutique('clearzal-AO-1','ClearZal™ – Alívio Rápido - Pacote Solo – 1 unidade')
check('commande de boutique reliée par son SKU (Tarik)', sku.produit_id===P.clearzal)
await q(`update public.commandes set vendeur_id=$2 where id=$1`,[sku.id,U.vendeurB])
check('… changer son vendeur garde le lien du SKU', await lien(sku.id)===P.clearzal)
e=await erreur(()=>q(`update public.commandes set produit_id=$2 where id=$1`,[cTarik,P.clearzal]))
check('produit_id écrit à la main → toujours refusé', e?.includes('ne s\'écrit pas à la main'), e)

// l'outil « relier les liens vides » : par vendeur
await db.exec(`set session_replication_role = replica`)
const vide=(await ins('commandes',{tenant_id:TF,lead_id:'T14-VIDE',client_nom:'C',client_telephone:'+244700',produit:'clearzal',quantite:1,prix:1,pays_id:AO,ville_zone:'Luanda',adresse:'r',vendeur_id:U.vendeurB,produit_id:null})).id
await db.exec(`set session_replication_role = origin`)
await q(`select public.remplir_produits_commandes()`)
check('remplir_produits_commandes : relie la commande sans lien du vendeur B à SON clearzal', await lien(vide)===czB)
// rejouer l'ancien propriétaire
e=await erreur(()=>db.exec(lire('commandes_produit_id.sql')))
check('commandes_produit_id.sql rejoué : passe et garde la nouvelle règle', e===null && (await q(`select obj_description('public.commande_produit_id()'::regprocedure,'pg_proc') m`))[0].m==='fichier: produits_par_vendeur.sql', e)
c=await commande(U.vendeurB,'bonegel'); check('… toujours par vendeur après ce rejeu', await lien(c.id)===null)

// ===== retour =====
e=await erreur(()=>db.exec(FR)); check('retour refusé tant que deux vendeurs partagent un code', e?.includes('partagent un code'), e)
await q(`delete from public.produits where vendeur_id=$1`,[U.vendeurB]); await q(`delete from public.produits where code='commun'`)
for (const i of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`retour, passage ${i}`, e===null, e) }
c=await commande(U.vendeurB,'bonegel'); check('après retour : la règle d\'avant (toute l\'entreprise) est revenue', await lien(c.id)===P.bonegel)

// ===== mutant =====
await base(); await db.exec(INDEX_PROD)
const M=F.replace(`(case when v_partage then p.vendeur_id is null else p.vendeur_id = p_vendeur end)
       and p.code is not null`,`true
       and p.code is not null`)
check('mutant bien fabriqué', M!==F)
e=await erreur(()=>db.exec(M))
check('mutant (le code cherché chez tous les vendeurs) arrêté par la répétition, rien installé', e?.includes('RÉPÉTITION ÉCHOUÉE')
  && (await q(`select count(*)::int n from pg_proc where proname='produit_de_commande_vendeur'`))[0].n===0, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
