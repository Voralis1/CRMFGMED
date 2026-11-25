// sku_ecran.sql (11/11, T20) sur la chaîne de prod (règles de stock, SKU fichier 1) : ajouter un SKU depuis l'écran
// relie les leads qui l'attendent ; retirer refusé s'il relie une commande ; liste des SKU inconnus ; droits.
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


await base()
if (!(await q(`select to_regprocedure('public.gere_la_config()') f`))[0].f)
  await db.exec(`create function public.gere_la_config() returns boolean language sql stable security definer set search_path=public as
    $$ select exists (select 1 from public.user_roles u where u.user_id=auth.uid() and lower(u.role) in ('admin','manager')) $$`)
const S=lire('sku_ecran.sql'), SR=lire('sku_ecran_retour.sql')
for (const i of [1,2]) { const e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i}`, e===null, e) }
const T3='Cuidado Articular de Ação Rápida - Pacote Mais Vendido – 3 unidades'
const a=await boutique('bonegel-AO-3',T3,{prix:58000}), b=await boutique('bonegel-AO-3',T3,{prix:58000})
check('2 leads avec un SKU jamais saisi → « Produit non reconnu »', a.statut_confirmation==='Produit non reconnu' && b.statut_confirmation==='Produit non reconnu')
const inc=await sous(U.manager,'authenticated',()=>q(`select * from public.skus_inconnus($1)`,[TF]))
check('liste des SKU inconnus : bonegel-AO-3, 2 leads, son titre', inc.length===1 && inc[0].sku==='bonegel-AO-3' && inc[0].nb_commandes===2 && inc[0].titre===T3, JSON.stringify(inc))
let e=await erreur(()=>sous(U.agent,'authenticated',()=>q(`select * from public.skus_inconnus($1)`,[TF]))); check('agent : ne voit pas la liste', e?.includes('ne permet pas'), e)
e=await erreur(()=>sous(U.tarik,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'x',$2,1)`,[SRC,P.bonegel]))); check('vendeur : n\'ajoute pas de SKU', e?.includes('ne permet pas'), e)
e=await erreur(()=>sous(U.manager2,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'x',$2,1)`,[SRC,P.bonegel]))); check('manager d\'une autre entreprise : refusé', e?.includes('ne permet pas'), e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'bonegel-AO-3',$2,0)`,[SRC,P.bonegel]))); check('pack 0 → refusé', e?.includes('entre 1 et 100'), e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'bonegel-AO-3',$2,3)`,[SRC,PB_LIVER]))); check('produit d\'un autre vendeur → refusé (garde)', e?.includes('n\'est pas celui du vendeur'), e)
const r=(await sous(U.manager,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,' bonegel-AO-3 ',$2,3)`,[SRC,P.bonegel])))[0]
check('manager : SKU ajouté → les 2 leads qui attendaient sont reliés', r.commandes_reliees===2, JSON.stringify(r))
const ca=await cmd(a.id)
check('… produit bonegel, quantité 1 × 3 = 3, prix intact, « En attente » (stock 10)', ca.produit_id===P.bonegel && ca.quantite===3 && Number(ca.prix)===58000 && ca.statut_confirmation==='Pending', JSON.stringify([ca.quantite,ca.statut_confirmation]))
check('… le titre de la boutique est gardé sur le SKU', (await q(`select titre_vu from public.correspondances_sku where id=$1`,[r.correspondance_id]))[0].titre_vu===T3)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'BONEGEL-ao-3',$2,3)`,[SRC,P.bonegel]))); check('le même SKU deux fois (casse) → refusé', e?.includes('existe déjà'), e)
const nouv=await boutique('bonegel-AO-3',T3,{prix:58000}); check('un nouveau lead avec ce SKU → relié dès l\'arrivée, quantité 3', nouv.produit_id===P.bonegel && nouv.quantite===3)
check('la liste des inconnus est vide', (await sous(U.manager,'authenticated',()=>q(`select * from public.skus_inconnus($1)`,[TF]))).length===0)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.retirer_correspondance_sku($1)`,[r.correspondance_id]))); check('retirer un SKU qui relie des commandes → refusé', e?.includes('relie déjà 3 commande'), e)
const r2=(await sous(U.manager,'authenticated',()=>q(`select * from public.ajouter_correspondance_sku($1,'warming-AO-9',$2,9)`,[SRC,P.warming])))[0]
check('SKU pour un pack pas encore reçu → ajouté, 0 lead relié', r2.commandes_reliees===0)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.retirer_correspondance_sku($1)`,[r2.correspondance_id]))); check('… et retiré (aucune commande ne l\'utilise)', e===null && (await q(`select count(*)::int n from public.correspondances_sku where id=$1`,[r2.correspondance_id]))[0].n===0, e)
check('le manager lit les SKU de son entreprise (lecture de la table)', (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.correspondances_sku`)))[0].n>=17)
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i} (les SKU ajoutés restent)`, e===null && (await q(`select count(*)::int n from public.correspondances_sku where id=$1`,[r.correspondance_id]))[0].n===1, e) }

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
