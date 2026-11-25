// correspondances_sku.sql + _2_rattrapage.sql (03/11) sur le schéma réel, avec
// commandes_produit_id.sql et la livraison du 03/11 (stock_livraison_autre_vendeur.sql) :
//   · prérequis : refusé tant que la livraison relit le produit depuis le texte ;
//   · AVANT (témoin) : une commande de la boutique n'a ni produit ni la bonne quantité ;
//   · fichier 1 deux fois : 16 correspondances, aucune commande existante touchée ;
//   · à la création : SKU connu → produit du vendeur de la source × multiplicateur
//     (prix et texte intacts), casse/espaces du SKU ignorés ; SKU absent de la table
//     → rien, même s'il « ressemble » (Livertea-AO-3 : jamais découpé) ; ligne
//     sans SKU → règle d'avant ; deux lignes → inchangé ; autre source → rien ;
//     produit_id / multiplicateur_sku envoyés par le client ignorés ;
//   · garde : produit d'un autre vendeur (même nom !), d'une autre entreprise,
//     source d'une autre entreprise → refusé, à la création comme à la modification ;
//   · la trace ne s'écrit pas à la main ; texte changé → lien gardé, pas re-multiplié ;
//   · livraison : sort le produit lié, 2 unités pour un pack de 2 ; ligne courte → note ;
//     SKU inconnu → aucun mouvement, « introuvable » ;
//   · lecture : responsables de l'entreprise, super admin ; vendeur, agent, autre
//     entreprise : rien ; personne n'écrit depuis le navigateur ;
//   · rattrapage : refusé sans le fichier 1 ; lie, corrige la quantité des packs,
//     laisse l'inconnu et le déjà-décompté, updated_at intact, rejoué → 0 ;
//   · mutants (multiplicateur oublié, garde du vendeur retirée) arrêtés par la répétition ;
//   · retours : fichier 1 refusé tant que des quantités sont multipliées ; retour 2
//     remet quantités et liens, deux fois ; retour 1 deux fois ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
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
  await db.exec(lire('commandes_produit_id.sql'))   // sa répétition a besoin d'une entreprise avec un pays
  await db.exec(STOCK_0211)   // la livraison du 02/11 (relit le texte)
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

// ===== A. prérequis, témoins =====
await base()
let e=await erreur(()=>db.exec(F1))
check('fichier 1 refusé tant que la livraison relit le texte (stock du 02/11)', e?.includes('stock_livraison_autre_vendeur.sql'), e)
check('… rien installé', (await q(`select to_regclass('public.correspondances_sku') r`))[0].r===null)
const avant1=await boutique('Livertea-AO-2',TITRE2)
const avant2=await boutique('Sp4-AO-1','SP-4 Clareador – Elimina anos de manchas - Pacote Solo – 1 unidade')
const avant3=await boutique('inconnu-AO-1','Produit inconnu - Pacote Solo – 1 unidade')
const avant4=await boutique('Livertea-AO-2',TITRE2)
await db.exec(`set session_replication_role = replica`); await q(`update public.commandes set stock_ajuste=now() where id=$1`,[avant4.id]); await db.exec(`set session_replication_role = origin`)
check('AVANT (témoin) : pack de 2 de la boutique → aucun produit, quantité 1', avant1.produit_id===null && avant1.quantite===1)
e=await erreur(()=>db.exec(F2))
check('fichier 2 refusé sans le fichier 1', e?.includes('lancez correspondances_sku.sql'), e)

// ===== B. installation =====
for (const i of [1,2]) { e=await erreur(()=>db.exec(STOCK)); check(`stock_livraison_autre_vendeur.sql (03/11), passage ${i}`, e===null, e) }
const photo=async()=>JSON.stringify(await q(`select id, produit, produit_id, quantite, prix, updated_at from public.commandes order by id`))
const ph=await photo()
let avis=[]
for (const i of [1,2]) { avis=[]; e=await erreur(()=>db.exec(F1,{onNotice:m=>avis.push(m.message)})); check(`fichier 1, passage ${i}`, e===null, e) }
check('16 correspondances, la 2e passe n\'en ajoute aucune', (await q(`select count(*)::int n from public.correspondances_sku`))[0].n===16 && avis.some(a=>a.includes('0 correspondance')), avis.join(' | '))
check('… toutes vers un produit de Tarik', (await q(`select count(*)::int n from public.correspondances_sku c join public.produits p on p.id=c.produit_id where p.vendeur_id=$1`,[U.tarik]))[0].n===16)
check('fichier 1 ne touche AUCUNE commande existante', (await photo())===ph)

// ===== C. à la création =====
let c=await boutique('Livertea-AO-2',TITRE2,{prix:45000})
check('SKU connu, pack de 2 : Liver Detox Tea de Tarik, quantité 2, prix 45000, texte intact, trace 2',
  c.produit_id===P.livertea && c.quantite===2 && Number(c.prix)===45000 && c.produit===TITRE2 && c.multiplicateur_sku===2, JSON.stringify([c.produit_id,c.quantite,c.prix,c.multiplicateur_sku]))
check('… jamais le « Liver Detox Tea » de l\'autre vendeur', c.produit_id!==PB_LIVER)
c=await boutique('Livertea-AO-2',TITRE2,{qte:3,prix:120000})
check('3 packs de 2 → 6 unités', c.quantite===6 && c.multiplicateur_sku===2)
c=await boutique('  livertea-ao-1 ',TITRE1)
check('SKU en minuscules, espaces → trouvé, ×1', c.produit_id===P.livertea && c.quantite===1 && c.multiplicateur_sku===1)
c=await boutique('Livertea-AO-3','Chá de Limpeza do Fígado - Pacote 3 unidades')
check('« Livertea-AO-3 » (pas de ligne) → AUCUN produit, quantité 1 : le SKU n\'est jamais découpé', c.produit_id===null && c.quantite===1 && c.multiplicateur_sku===null)
c=await boutique('nouveau-AO-1','Produit nouveau')
check('SKU inconnu → non reconnu, quantité intacte', c.produit_id===null && c.quantite===1)
c=await boutique(null,'livertea')
check('ligne SANS SKU → la règle d\'avant (texte = code)', c.produit_id===P.livertea && c.multiplicateur_sku===null)
c=await boutique(null,TITRE2)
check('ligne sans SKU, titre de boutique → non reconnu (règle d\'avant)', c.produit_id===null && c.quantite===1)
c=await boutique(null,'A ×1 + B ×1',{qte:2,articles:JSON.stringify([{code:'Livertea-AO-2',quantite:1},{code:'Sp4-AO-1',quantite:1}])})
check('deux lignes → inchangé', c.produit_id===null && c.quantite===2 && c.multiplicateur_sku===null)
c=await boutique('Livertea-AO-2',TITRE2,{source:SRC2})
check('même SKU, AUTRE source → rien (une correspondance est par source)', c.produit_id===null && c.quantite===1)
c=await boutique('nouveau-AO-1','Produit nouveau',{extra:{produit_id:P.warming,multiplicateur_sku:5}})
check('produit_id / multiplicateur_sku envoyés par le client → ignorés', c.produit_id===null && c.multiplicateur_sku===null)
c=await boutique(null,'livertea',{extra:{}}) // contrôle
const csv=await ins('commandes',{lead_id:'CSV-1',tenant_id:TF,pays_id:AO,client_nom:'C',client_telephone:'+2440',produit:'livertea',quantite:1,prix:1,vendeur_id:U.tarik})
check('commande sans source (CSV) → la règle d\'avant', csv.produit_id===P.livertea && csv.multiplicateur_sku===null)

// ===== D. la garde =====
for (const [quoi,prod,tenant,src] of [['produit d\'un autre vendeur (même nom)',PB_LIVER,TF,SRC],['produit d\'une autre entreprise',PAUTRE,TF,SRC]]) {
  e=await erreur(()=>q(`insert into public.correspondances_sku (tenant_id,source_id,sku,produit_id) values ($1,$2,'X-1',$3)`,[tenant,src,prod]))
  check(`correspondance vers le ${quoi} : refusée`, e!==null && /vendeur de la source|pas de cette entreprise/.test(e), e)
}
const src3=(await q(`select id from public.sources_import where tenant_id=$1`,[T2]))[0].id
e=await erreur(()=>q(`insert into public.correspondances_sku (tenant_id,source_id,sku,produit_id) values ($1,$2,'X-1',$3)`,[TF,src3,P.warming]))
check('source d\'une autre entreprise : refusée', e?.includes('source n\'est pas de cette entreprise'), e)
e=await erreur(()=>q(`update public.correspondances_sku set produit_id=$1 where sku='Livertea-AO-1'`,[PB_LIVER]))
check('modifier une correspondance vers l\'autre vendeur : refusé aussi', e?.includes('vendeur de la source'), e)
e=await erreur(()=>q(`insert into public.correspondances_sku (tenant_id,source_id,sku,produit_id) values ($1,$2,' livertea-ao-1',$3)`,[TF,SRC,P.livertea]))
check('le même SKU deux fois (casse/espaces) : refusé (index)', e?.includes('correspondances_sku_source_sku'), e)
e=await erreur(()=>q(`insert into public.correspondances_sku (tenant_id,source_id,sku,produit_id,multiplicateur) values ($1,$2,'Z-0',$3,0)`,[TF,SRC,P.warming]))
check('multiplicateur 0 : refusé', e?.includes('check'), e)

// ===== E. la trace, le texte =====
c=await boutique('Livertea-AO-2',TITRE2)
for (const [qui,role,uid] of [['éditeur SQL','postgres',null],['clé service','service_role',null]]) {
  e=await sous(uid,role,()=>erreur(()=>q(`update public.commandes set multiplicateur_sku=1 where id=$1`,[c.id])))
  check(`${qui} : multiplicateur_sku à la main refusé`, e?.includes('ne s\'écrit pas à la main'), e)
}
e=await erreur(()=>q(`update public.commandes set produit_id=$1 where id=$2`,[P.warming,c.id]))
check('produit_id à la main : toujours refusé (règle du 29/10)', e?.includes('ne s\'écrit pas à la main'), e)
await q(`update public.commandes set produit='Chá Fígado (corrigé)' where id=$1`,[c.id])
let cc=await cmd(c.id)
check('texte changé par un agent → lien SKU gardé, quantité PAS re-multipliée', cc.produit_id===P.livertea && cc.quantite===2 && cc.multiplicateur_sku===2, JSON.stringify([cc.produit_id,cc.quantite]))
await q(`update public.commandes set quantite=4 where id=$1`,[c.id])
check('quantité changée à la main → gardée telle quelle', (await cmd(c.id)).quantite===4)

// ===== F. livraison =====
c=await boutique('Livertea-AO-2',TITRE2)
const s0=await stock('livertea'); await livrer(c)
check('livraison d\'un pack de 2 lié par SKU : 2 unités sortent de Liver Detox Tea (Tarik)',
  await stock('livertea')===s0-2 && JSON.stringify((await mvts(c.id)).map(m=>[m.produit_id===P.livertea,m.t,m.q]))==='[[true,"sortie",2]]' && (await cmd(c.id)).stock_note===null, JSON.stringify(await mvts(c.id)))
c=await boutique('Sp4-AO-1','SP-4 Clareador – Elimina anos de manchas - Pacote Solo – 1 unidade'); await livrer(c)
check('ligne Sp-4 à 0 → -1 et la note « stock insuffisant »', await stock('Sp4')===-1 && /stock insuffisant/.test((await cmd(c.id)).stock_note||''))
c=await boutique('nouveau-AO-1','Produit nouveau'); await livrer(c)
check('SKU inconnu livré → aucun mouvement, « introuvable »', (await mvts(c.id)).length===0 && /introuvable/.test((await cmd(c.id)).stock_note||''))

// le seul effet sur une commande d'avant : produit RENOMMÉ après la commande
const ren=await ins('commandes',{lead_id:'REN-1',tenant_id:TF,pays_id:AO,client_nom:'C',client_telephone:'+2441',produit:'goldhuile',quantite:1,prix:1,vendeur_id:U.tarik})
await q(`update public.produits set code='golden-oil-v2', product='Golden oil v2' where id=$1`,[P.goldhuile])
const sg=await stock('goldhuile'); await livrer(ren)
check('produit renommé depuis la commande : la livraison suit le lien, 1 unité sort (avant : « introuvable »)', ren.produit_id===P.goldhuile && await stock('goldhuile')===sg-1, String(await stock('goldhuile')))
const sup=await ins('commandes',{lead_id:'SUP-1',tenant_id:TF,pays_id:AO,client_nom:'C',client_telephone:'+2442',produit:'huilejap',quantite:1,prix:1,vendeur_id:U.tarik})
await q(`delete from public.stocks where produit_id=$1`,[P.huilejap]); await q(`delete from public.produits where id=$1`,[P.huilejap])
await livrer(sup)
check('produit supprimé : lien vidé, la livraison retombe sur le texte → « introuvable », aucun mouvement', (await mvts(sup.id)).length===0 && /introuvable/.test((await cmd(sup.id)).stock_note||''))

// ===== G. qui lit =====
const lecture=async(uid)=>sous(uid,'authenticated',()=>q(`select count(*)::int n from public.correspondances_sku`)).then(r=>r[0].n)
check('manager de l\'entreprise : lit les 16', await lecture(U.manager)===16)
check('super admin : lit les 16', await lecture(U.super_admin)===16)
for (const [qui,u] of [['vendeur (Tarik)',U.tarik],['agent',U.agent],['livreur',U.livreur],['manager d\'une autre entreprise',U.manager2]])
  check(`${qui} : 0`, await lecture(u)===0)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.correspondances_sku (tenant_id,source_id,sku,produit_id) values ($1,$2,'W-1',$3)`,[TF,SRC,P.warming])))
check('manager : n\'écrit pas depuis le navigateur', e?.includes('permission denied'), e)
e=await sous(null,'anon',()=>erreur(()=>q(`select 1 from public.correspondances_sku`)))
check('anon : refusé', e?.includes('permission denied'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`select * from public.correspondance_de_commande($1,'[]')`,[SRC])))
check('correspondance_de_commande : fermée aux comptes', e?.includes('permission denied'), e)

// ===== H. rattrapage =====
const updAvant=(await cmd(avant1.id)).updated_at
const lignes=[]
for (const i of [1,2]) { e=await erreur(async()=>{ const r=await db.exec(F2); lignes.push(r[r.length-1].rows) }); check(`rattrapage, passage ${i}`, e===null, e) }
let a1=await cmd(avant1.id), a2=await cmd(avant2.id), a3=await cmd(avant3.id), a4=await cmd(avant4.id)
check('pack de 2 d\'avant : lié, quantité 1 → 2, prix et texte intacts', a1.produit_id===P.livertea && a1.quantite===2 && a1.multiplicateur_sku===2 && a1.produit===TITRE2 && Number(a1.prix)===Number(avant1.prix))
check('… updated_at intact', String(a1.updated_at)===String(updAvant))
check('Sp-4 solo d\'avant : lié, quantité 1', a2.produit_id===P.Sp4 && a2.quantite===1 && a2.multiplicateur_sku===1)
check('SKU inconnu d\'avant : laissé', a3.produit_id===null && a3.quantite===1 && a3.multiplicateur_sku===null)
check('déjà décomptée du stock : laissée', a4.produit_id===null && a4.quantite===1 && a4.multiplicateur_sku===null)
check('rapport : 1er passage les 2 commandes d\'avant (+ les non liées de la même forme), 2e passage 0', lignes[0].length>=2 && lignes[1].length===0, JSON.stringify(lignes.map(l=>l.length)))
check('… jamais multiplié deux fois', (await cmd(avant1.id)).quantite===2)

// ===== I. mutants =====
for (const [nom,remplace,de] of [
  ['multiplicateur oublié', F1.replace('new.quantite           := coalesce(new.quantite, 1) * v_mult;','new.quantite           := coalesce(new.quantite, 1);'), 'pack de 2'],
  ['garde du vendeur retirée', F1.replace('if v_prod.vendeur_id is distinct from v_src.vendeur_id then','if false then'), 'autre vendeur']]) {
  await base(); await db.exec(STOCK)
  check(`(témoin : ${nom} injecté)`, remplace!==F1)
  e=await erreur(()=>db.exec(remplace))
  check(`mutant « ${nom} » : arrêté par la répétition, étape nommée`, e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes(de), e)
  check('… rien installé', (await q(`select to_regclass('public.correspondances_sku') r`))[0].r===null)
}

// ===== J. retours =====
await base(); await db.exec(STOCK)
const r1=await boutique('Livertea-AO-2',TITRE2), r2=await boutique('Retinol-AO-1','Creme de Retinol… Solo')
const phR=await photo()
await db.exec(F1); await db.exec(F2)
const r3=await boutique('warming-AO-2','Spray Anti-dor - Pacote Recomendado – 2 unidades')   // lié par le trigger
e=await erreur(()=>db.exec(RET1))
check('retour du fichier 1 refusé tant que des quantités sont multipliées', e?.includes('correspondances_sku_2_retour.sql'), e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET2)); check(`retour 2, passage ${i}`, e===null, e) }
check('retour 2 : commandes d\'avant = exactement comme avant le fichier', JSON.stringify(JSON.parse(await photo()).filter(x=>x.id!==r3.id))===phR)
let x3=await cmd(r3.id)
check('… celle liée par le trigger : quantité 2 → 1, plus de lien SKU', x3.quantite===1 && x3.produit_id===null && x3.multiplicateur_sku===null, JSON.stringify([x3.quantite,x3.produit_id]))
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET1)); check(`retour 1, passage ${i}`, e===null, e) }
check('… table, trigger, colonne retirés', (await q(`select to_regclass('public.correspondances_sku') r`))[0].r===null &&
  (await q(`select count(*)::int n from pg_trigger where tgname='trg_zz_produit_sku'`))[0].n===0 &&
  (await q(`select count(*)::int n from information_schema.columns where table_name='commandes' and column_name='multiplicateur_sku'`))[0].n===0)
c=await boutique('Livertea-AO-2',TITRE2)
check('… une commande de la boutique se crée comme avant (aucun produit, quantité 1)', c.produit_id===null && c.quantite===1)
e=await erreur(()=>db.exec(F1)); check('réinstallation : passe', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
