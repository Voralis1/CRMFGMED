// correspondances_sku_3_packs.sql (09/11) + le rattrapage (fichier 2) sur la chaîne de prod du 09/11
// (règles de stock, SKU fichier 1) :
//   · avant : un pack jamais saisi → « Produit non reconnu » ; une commande arrivée avant sa correspondance → non reliée ;
//   · fichier 3 deux fois : 6 ajoutées puis 0 ; aucune commande touchée ;
//   · fichier 2 : les commandes qui attendent sont reliées, quantité × pack, et passent « En attente »
//     (stock suffisant) ou « Rupture de stock » (stock 0) d'elles-mêmes ; rejoué → rien de plus ;
//   · une NOUVELLE commande avec un de ces packs est reliée dès l'arrivée ;
//   · retour du fichier 3 refusé tant que des commandes sont reliées par ces packs ; après le retour 2, il passe.
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


const F3=lire('correspondances_sku_3_packs.sql'), RET3=lire('correspondances_sku_3_packs_retour.sql')
await base()
const T_CZ2='ClearZal™ – Alívio Rápido - Pacote Recomendado – 2 unidades', T_SP3='SP-4 Clareador – Elimina anos de manchas - Pacote Mais Vendido – 3 unidades'
const T_WA3='Spray Anti-dor - Pacote Mais Vendido – 3 unidades', T_KI1='🌞 Chá DETOX para a limpeza dos rins e cálculos renais - Pacote Solo – 1 unidade'
const cz2=await boutique('clearzal-AO-2',T_CZ2,{prix:45000})
const sp3=await boutique('Sp4-AO-3',T_SP3,{prix:58000})
const wa3=await boutique('warming-AO-3',T_WA3,{prix:58000})
// la 7e : arrivée AVANT sa correspondance (comme MABOUTIQUE-9985) — En attente, non reliée
await db.exec(`set session_replication_role = replica`)
const ki1=(await ins('commandes',{tenant_id:TF,lead_id:'MABOUTIQUE-9985',client_nom:'C',client_telephone:'+2449985',produit:T_KI1,quantite:1,prix:35000,pays_id:AO,ville_zone:'Luanda',
  vendeur_id:U.tarik,source_id:SRC,source:'webhook',articles:JSON.stringify([{code:'kidneytea-AO-1',produit:T_KI1,quantite:1,prix:35000}]),statut_confirmation:'Pending'})).id
await db.exec(`set session_replication_role = origin`)
check('AVANT : packs jamais saisis → « Produit non reconnu », non reliés, quantité 1',
  [cz2,sp3,wa3].every(c=>c.statut_confirmation==='Produit non reconnu' && c.produit_id===null && c.quantite===1), JSON.stringify([cz2,sp3,wa3].map(c=>[c.statut_confirmation,c.produit_id,c.quantite])))

for (const i of [1,2]) { const e=await erreur(()=>db.exec(F3)); check(`fichier 3, passage ${i}`, e===null, e) }
const ajout=await q(`select sku, multiplicateur m from public.correspondances_sku where lower(sku) in ('clearzal-ao-2','clearzal-ao-3','sp4-ao-3','livertea-ao-3','bonegel-ao-2','warming-ao-3') order by sku`)
const attendu={'clearzal-ao-2':2,'clearzal-ao-3':3,'sp4-ao-3':3,'livertea-ao-3':3,'bonegel-ao-2':2,'warming-ao-3':3}
check('6 correspondances ajoutées une fois, au bon multiplicateur', ajout.length===6 && ajout.every(x=>attendu[x.sku.toLowerCase()]===x.m), JSON.stringify(ajout))
check('… aucune commande touchée par le fichier 3', (await cmd(cz2.id)).produit_id===null && (await cmd(ki1)).produit_id===null)

let e=await erreur(()=>db.exec(F2)); check('fichier 2 (rattrapage) passe avec les règles de stock', e===null, e)
const a=await cmd(cz2.id), b=await cmd(sp3.id), c=await cmd(wa3.id), d=await cmd(ki1)
check('clearzal-AO-2 : relié à clearzal, quantité 2, prix intact, « En attente » (stock 10)', a.produit_id===P.clearzal && a.quantite===2 && Number(a.prix)===45000 && a.statut_confirmation==='Pending', JSON.stringify([a.produit_id===P.clearzal,a.quantite,a.statut_confirmation]))
check('Sp4-AO-3 : relié, quantité 3, « Rupture de stock » (stock 0)', b.produit_id===P.Sp4 && b.quantite===3 && b.statut_confirmation==='Rupture de stock', JSON.stringify([b.quantite,b.statut_confirmation]))
check('warming-AO-3 : relié, quantité 3, « En attente »', c.produit_id===P.warming && c.quantite===3 && c.statut_confirmation==='Pending', JSON.stringify([c.quantite,c.statut_confirmation]))
check('la 7e (kidneytea-AO-1, arrivée avant) : reliée, quantité 1, reste « En attente »', d.produit_id===P.kidneytea && d.quantite===1 && d.statut_confirmation==='Pending', JSON.stringify([d.quantite,d.statut_confirmation]))
check('aucun mouvement de stock (rien n\'est encore sorti)', (await q(`select count(*)::int n from public.mouvements_stock`))[0].n===0)
e=await erreur(()=>db.exec(F2)); check('fichier 2 rejoué : passe, rien multiplié deux fois', e===null && (await cmd(cz2.id)).quantite===2, e)

const neuve=await boutique('clearzal-AO-3','ClearZal™ – Alívio Rápido - Pacote Mais Vendido – 3 unidades',{prix:58000})
check('NOUVELLE commande clearzal-AO-3 : reliée dès l\'arrivée, quantité 3, « En attente »', neuve.produit_id===P.clearzal && neuve.quantite===3 && neuve.statut_confirmation==='Pending', JSON.stringify([neuve.produit_id===P.clearzal,neuve.quantite,neuve.statut_confirmation]))

e=await erreur(()=>db.exec(RET3)); check('retour 3 refusé tant que des commandes sont reliées par ces packs', e?.includes('correspondances_sku_2_retour.sql'), e)

e=await erreur(()=>db.exec(RET2)); check('retour 2 (rattrapage) passe', e===null, e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET3)); check(`retour 3, passage ${i} : les 6 correspondances retirées`, e===null
  && (await q(`select count(*)::int n from public.correspondances_sku where lower(sku) in ('clearzal-ao-2','clearzal-ao-3','sp4-ao-3','livertea-ao-3','bonegel-ao-2','warming-ao-3')`))[0].n===0, e) }
console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
