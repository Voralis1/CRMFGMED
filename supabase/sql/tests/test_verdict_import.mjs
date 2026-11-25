// Le verdict produit de l'import CSV et la rupture affichée sur les
// commandes (lib/verdictImport.mjs, 22/10), sur le schéma réel avec la RLS :
// le vendeur et le responsable lisent le catalogue et appellent la porte
// produits_en_stock sous leur propre compte ; le même fichier doit donner le
// même verdict. Un seul refus : le produit hors catalogue. Le stock avertit.
//
//   node supabase/sql/tests/test_verdict_import.mjs
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
const { verdictProduits, produitDuCatalogue, commandesEnRupture, produitDeCommande, produitDuCatalogueVendeur } = await import(R+'../lib/verdictImport.mjs')
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
grant usage on schema auth to authenticated, anon;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}

const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const VENDEUR='aaaaaaaa-0000-0000-0000-000000000001', MANAGER='aaaaaaaa-0000-0000-0000-000000000002', AUTRE='aaaaaaaa-0000-0000-0000-000000000003'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
for (const [u,t,r] of [[VENDEUR,T,'seller'],[MANAGER,T,'manager'],[AUTRE,T2,'seller']]) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  await ins('user_roles',{user_id:u,tenant_id:t,role:r})
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
const prod=async(nom,code,lignes,tenant=T)=>{
  const p=await ins('produits',{tenant_id:tenant,product:nom,code,current_quantity:0})
  for(const [e,qte] of lignes) await ins('stocks',{tenant_id:tenant,produit_id:p.id,entrepot_id:e,quantite_disponible:qte,quantite_reservee:0,quantite_defectueuse:0})
  return p.id }
await prod('Clearzal','clearzal',[[eAO,40]])            // reçu en Angola
await prod('Colon Tea','colontea',[[eCG,10]])           // reçu au Congo seulement
await prod('Zero Tea','zerotea',[[eAO,0]])              // ligne à ZÉRO en Angola
const pNeg=await prod('Neg Oil','negoil',[[eAO,-2]])      // passé en négatif
await prod('Doublon',null,[[eAO,5]]); await prod('doublon',null,[[eAO,5]])
const pAutre=await prod('Clearzal','clearzal',[[eAO,1]],T2)  // même code, autre entreprise
await db.exec(`set session_replication_role = origin`)

// Ce que la page fait, sous le compte de l'utilisateur.
const sous=async(uid,fn,role='authenticated')=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const catalogueDe=uid=>sous(uid,()=>q(`select id, code, product from public.produits where tenant_id=$1`,[T]))
const enStockDe=uid=>async(pays,ids)=>sous(uid,async()=>(await q(`select * from public.produits_en_stock($1,$2) x`,[pays,ids])).map(r=>r.x))
const idDe=async code=>(await q(`select id from public.produits where tenant_id=$1 and code=$2`,[T,code]))[0].id

// Le fichier : produits tels que l'import les écrira, et leur nombre de lignes.
const FICHIER=[
  { produit:'clearzal', lignes:3 },             // en stock (40)
  { produit:'COLON TEA', lignes:8 },            // au catalogue (par le nom), pas de ligne en Angola
  { produit:'kneehuile', lignes:12 },           // absent du catalogue
  { produit:'zerotea', lignes:2 },              // ligne à zéro
  { produit:'', lignes:1 },                     // sans produit
  { produit:'clearzal + colontea', lignes:1 },  // deux produits sur une ligne
  { produit:'Doublon', lignes:1 },              // deux produits de ce nom
  { produit:'negoil', lignes:1 },               // stock négatif
]
const verdictDe=async(uid,paysId,nom)=>verdictProduits({
  produits:FICHIER, catalogue:await catalogueDe(uid), paysId, nomEntrepot:nom, enStock:enStockDe(uid) })

// ---- 1. le vendeur ne lit pas le stock, mais obtient la réponse
const stocksVendeur=await sous(VENDEUR,()=>q(`select * from public.stocks`))
check('vendeur : `stocks` illisible (0 ligne)', stocksVendeur.length===0, String(stocksVendeur.length))
check('vendeur : le catalogue de son entreprise est lisible', (await catalogueDe(VENDEUR)).length===6)

// ---- 2. le verdict (vendeur, pays Angola)
const V=await verdictDe(VENDEUR,AO,'Angola')
const de=p=>V.find(v=>v.produit===p)
check('en stock → accepté, sans avertissement', de('clearzal').ok===true && de('clearzal').cas==='ok' && de('clearzal').message===null)
check('absent du catalogue → REFUSÉ', de('kneehuile').ok===false && de('kneehuile').cas==='inconnu')
check('… message : nom, lignes, quoi faire', de('kneehuile').message==='« kneehuile » (12 lignes) : absent du catalogue — ajoutez le produit, puis réimportez.', de('kneehuile').message)
check('au catalogue, aucune ligne de stock ici → ACCEPTÉ, avertissement rupture', de('COLON TEA').ok===true && de('COLON TEA').cas==='rupture')
check('… message', de('COLON TEA').message==="« COLON TEA » (8 lignes) : rupture de stock dans l'entrepôt Angola.", de('COLON TEA').message)
check('ligne à ZÉRO → acceptée, avertissement rupture', de('zerotea').ok===true && de('zerotea').cas==='rupture')
check('stock négatif → accepté, avertissement rupture', de('negoil').ok===true && de('negoil').cas==='rupture')
check('sans produit → refusé', de('').ok===false && /1 ligne sans produit/.test(de('').message), de('').message)
check('deux produits sur une ligne → refusé', de('clearzal + colontea').ok===false && de('clearzal + colontea').cas==='plusieurs')
check('deux produits du même nom → refusé, demande le code', de('Doublon').ok===false && /écrivez son code/.test(de('Doublon').message))
check('mélange : 4 refusés (tous catalogue), 3 en rupture, 1 net', V.filter(v=>!v.ok).length===4 && V.filter(v=>v.cas==='rupture').length===3 && V.filter(v=>v.cas==='ok').length===1, JSON.stringify(V.map(v=>[v.produit,v.cas])))
check('aucun refus pour cause de stock', V.filter(v=>!v.ok).every(v=>['inconnu','vide','plusieurs','ambigu'].includes(v.cas)))
check('ordre du fichier conservé', V.map(v=>v.produit).join('|')===FICHIER.map(f=>f.produit).join('|'))

// ---- 3. le même fichier, vendeur et responsable : le même verdict
const M=await verdictDe(MANAGER,AO,'Angola')    // le responsable choisit l'entrepôt Angola → son pays
check('responsable : même verdict que le vendeur, ligne pour ligne', JSON.stringify(M)===JSON.stringify(V), JSON.stringify(M))
const VC=await verdictDe(VENDEUR,CG,'Congo'), MC=await verdictDe(MANAGER,CG,'Congo')
check('Congo : même verdict aussi', JSON.stringify(VC)===JSON.stringify(MC))
check('Congo : colontea net, clearzal et zerotea en rupture', VC.find(v=>v.produit==='COLON TEA').cas==='ok' && VC.find(v=>v.produit==='clearzal').cas==='rupture' && VC.find(v=>v.produit==='zerotea').cas==='rupture')

// ---- 4. la porte produits_en_stock : ce qu'elle dit, ce qu'elle tait
const tous=[await idDe('clearzal'),await idDe('colontea'),await idDe('zerotea'),pNeg]
const rep=await sous(VENDEUR,()=>q(`select * from public.produits_en_stock($1,$2) x`,[AO,tous]))
check('vendeur : seuls les produits > 0 dans l\'entrepôt du pays', rep.length===1 && rep[0].x===tous[0], JSON.stringify(rep))
check('… un id par ligne, aucune quantité, aucun entrepôt', Object.keys(rep[0]).length===1)
check('vendeur d\'une autre entreprise : rien, même pour un produit en stock', (await sous(AUTRE,()=>q(`select * from public.produits_en_stock($1,$2) x`,[AO,tous]))).length===0)
check('vendeur : rien sur le produit d\'une autre entreprise (même code, en stock)', (await sous(VENDEUR,()=>q(`select * from public.produits_en_stock($1,$2) x`,[AO,[pAutre]]))).length===0)
check('liste vide ou null → rien', (await sous(VENDEUR,()=>q(`select * from public.produits_en_stock($1,null) x`,[AO]))).length===0)
let anon=null; try { await sous(null,()=>q(`select * from public.produits_en_stock($1,$2)`,[AO,tous]),'anon') } catch(e){ anon=e.message }
check('anon : refusé', /permission denied/.test(anon||''), String(anon))

// ---- 5. la rupture sur les commandes (lue en direct)
const cmds=[
  { id:'c1', produit:'clearzal', pays_id:AO }, { id:'c2', produit:'Colon Tea', pays_id:AO },
  { id:'c3', produit:'colontea', pays_id:CG }, { id:'c4', produit:'kneehuile', pays_id:AO },
  { id:'c5', produit:'zerotea', pays_id:AO },
]
const rV=await commandesEnRupture({ commandes:cmds, catalogue:await catalogueDe(VENDEUR), enStock:enStockDe(VENDEUR) })
const rM=await commandesEnRupture({ commandes:cmds, catalogue:await catalogueDe(MANAGER), enStock:enStockDe(MANAGER) })
check('commandes : en rupture = c2 (pas de ligne) et c5 (zéro)', [...rV].sort().join()==='c2,c5', [...rV].join())
check('commandes : produit inconnu jamais marqué en rupture (la note le dit)', !rV.has('c4'))
check('commandes : vendeur et responsable voient la même chose', [...rV].sort().join()===[...rM].sort().join())
await db.exec(`set session_replication_role = replica`)
await q(`update public.stocks set quantite_disponible=7 where produit_id=$1`,[await idDe('zerotea')])
await db.exec(`set session_replication_role = origin`)
const rApres=await commandesEnRupture({ commandes:cmds, catalogue:await catalogueDe(VENDEUR), enStock:enStockDe(VENDEUR) })
check('réassort : la rupture disparaît au chargement suivant (rien d\'écrit sur la commande)', !rApres.has('c5') && rApres.has('c2'), [...rApres].join())

// ---- 6. la lecture du produit, sans base
const cat=[{id:'1',code:'colontea',product:'Colon Tea'},{id:'2',code:null,product:'Crème Éclat'}]
check('par le code, casse et espaces ignorés', produitDuCatalogue('  COLONTEA ',cat).produit?.id==='1')
check('par le nom sans accents', produitDuCatalogue('creme  eclat',cat).produit?.id==='2')
const panne=await verdictProduits({ produits:[{produit:'colontea',lignes:1},{produit:'inconnu',lignes:2}], catalogue:cat, paysId:'x', nomEntrepot:'A', enStock:async()=>{ throw new Error('réseau') } })
check('porte en panne → stock « non vérifié », la ligne entre quand même', panne[0].ok===true && panne[0].cas==='stock_non_verifie', JSON.stringify(panne[0]))
check('… et le refus catalogue tient toujours', panne[1].ok===false && panne[1].cas==='inconnu')
// ---- 7. le cas qui compte : « Colon Tea », code colontea, écrit de quatre façons
const catR=await catalogueDe(VENDEUR), idColon=await idDe('colontea')
const quatre=['Colontea','colontea',' COLONTEA ','Colon Tea'].map(t=>[t,produitDuCatalogue(t,catR)])
check('les quatre écritures trouvent le MÊME produit', quatre.every(([,r])=>r.produit?.id===idColon), JSON.stringify(quatre.map(([t,r])=>[t,r.produit?.id,r.par])))
check('… les trois premières par le code', quatre.slice(0,3).every(([,r])=>r.par==='code'))
check('… « Colon Tea » par le nom', quatre[3][1].par==='nom')
const V4=await verdictProduits({ produits:['Colontea','colontea',' COLONTEA ','Colon Tea'].map(produit=>({produit,lignes:1})), catalogue:catR, paysId:CG, nomEntrepot:'Congo', enStock:enStockDe(VENDEUR) })
check('… toutes acceptées', V4.every(v=>v.ok && v.cas==='ok'), JSON.stringify(V4.map(v=>v.cas)))
check('… seul le nom porte l\'avertissement, avec le code à utiliser', V4.slice(0,3).every(v=>v.avisNom===null) && V4[3].avisNom==="« Colon Tea » : reconnu par son nom. Utilisez le code colontea pour éviter les erreurs d'orthographe.", V4[3].avisNom)
check('code : les accents sont ignorés aussi', produitDuCatalogue('cölontéa',catR).produit?.id===idColon && produitDuCatalogue('cölontéa',catR).par==='code')
const catAcc=[{id:'a',code:'Café',product:'Un'},{id:'b',code:'cafe',product:'Deux'},{id:'c',code:null,product:'Sans Code'}]
check('deux codes qui se confondent sans accents → ambigu, aucun choisi', produitDuCatalogue('CAFE',catAcc).cas==='ambigu')
const VS=await verdictProduits({ produits:[{produit:'sans code',lignes:1}], catalogue:catAcc, paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>ids })
check('produit sans code trouvé par le nom → avertissement « ajoutez-en un »', VS[0].ok && /n'a pas de code : ajoutez-en un dans Produits/.test(VS[0].avisNom||''), VS[0].avisNom)
check('rupture ET nom : les deux avertissements', (await verdictProduits({ produits:[{produit:'Colon Tea',lignes:2}], catalogue:catR, paysId:AO, nomEntrepot:'Angola', enStock:enStockDe(VENDEUR) }))
  .every(v=>v.cas==='rupture' && /reconnu par son nom/.test(v.avisNom||'')))

let appels=0
await verdictProduits({ produits:[{produit:'colontea',lignes:1},{produit:'Colon Tea',lignes:1}], catalogue:cat, paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>{ appels++; return ids } })
check('un appel à la porte pour tout le fichier', appels===1, String(appels))
appels=0
await verdictProduits({ produits:[{produit:'inconnu',lignes:1}], catalogue:cat, paysId:'x', nomEntrepot:'A', enStock:async()=>{ appels++; return [] } })
check('aucun produit du catalogue → aucun appel', appels===0)

// ---- 26/10 : le catalogue d'un VENDEUR ne contient que ses produits. Le
// produit d'un autre vendeur est refusé (ce n'est pas le sien), avec un
// message vrai : pas « absent du catalogue », il existe ailleurs.
const VV=await verdictProduits({ produits:[{produit:'kneehuile',lignes:12},{produit:'Café',lignes:1}], catalogue:catAcc,
  paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>ids, duVendeur:true })
check('vendeur : produit hors de SON catalogue → refusé', VV[0].ok===false && VV[0].cas==='inconnu')
check('… message : « pas dans votre catalogue », jamais « absent du catalogue »',
  VV[0].message==="« kneehuile » (12 lignes) : ce produit n'est pas dans votre catalogue — vérifiez le code ; si c'est un nouveau produit, créez-le dans Produits, puis réimportez.", VV[0].message)
check('vendeur : ambigu dit « votre catalogue »', VV[1].cas==='ambigu' && /de votre catalogue portent ce nom/.test(VV[1].message), VV[1].message)
const VR=await verdictProduits({ produits:[{produit:'kneehuile',lignes:12}], catalogue:catAcc, paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>ids })
check('responsable (défaut) : message inchangé', VR[0].message==='« kneehuile » (12 lignes) : absent du catalogue — ajoutez le produit, puis réimportez.', VR[0].message)

// ===== T9 (10/11) : le produit d'une commande par son LIEN d'abord =====
{
  const cat=[{id:'p-cz',code:'clearzal',product:'ClearZal',image_chemin:'cz.jpg'},{id:'p-sp',code:'Sp4',product:'SP-4',image_chemin:'sp.jpg'}]
  const titre='ClearZal™ – Alívio Rápido - Pacote Mais Vendido – 3 unidades'
  check('T9 témoin : le titre de la boutique, cherché par le texte → rien', !produitDuCatalogue(titre, cat).produit)
  check('T9 : commande reliée (produit_id) → son produit, même avec le titre de la boutique', produitDeCommande({produit:titre, produit_id:'p-cz'}, cat).produit?.image_chemin==='cz.jpg')
  check('T9 : le lien passe AVANT le texte (texte = un autre code)', produitDeCommande({produit:'Sp4', produit_id:'p-cz'}, cat).produit?.id==='p-cz')
  check('T9 : sans lien → le texte, comme avant (code)', produitDeCommande({produit:'sp4'}, cat).produit?.id==='p-sp')
  check('T9 : lien vers un produit hors du catalogue chargé → le texte', produitDeCommande({produit:'clearzal', produit_id:'absent'}, cat).produit?.id==='p-cz')
  check('T9 : ni lien ni texte reconnu → rien', !produitDeCommande({produit:titre}, cat).produit && !produitDeCommande(null, cat).produit)
  let demandes=[]
  const r=await commandesEnRupture({ commandes:[{id:'c1',produit:titre,produit_id:'p-cz',pays_id:'ao'}], catalogue:cat,
    enStock:async(pays,ids)=>{ demandes.push(ids); return [] } })
  check('T9 : la rupture d\'une commande de boutique reliée est vue (avant : ignorée)', r.has('c1') && JSON.stringify(demandes)==='[["p-cz"]]', JSON.stringify([...r, demandes]))
}

// ===== T14 (10/11) : le catalogue du vendeur du fichier =====
{
  const cat=[{id:'a',code:'clearzal',product:'ClearZal',vendeur_id:'vA'},{id:'b',code:'clearzal',product:'ClearZal',vendeur_id:'vB'},
             {id:'s',code:'commun',product:'Commun',vendeur_id:null}]
  check('T14 témoin : sans vendeur, deux « clearzal » → ambigu', produitDuCatalogue('clearzal', cat).cas==='ambigu')
  check('T14 : vendeur B → son clearzal', produitDuCatalogueVendeur('clearzal', cat, 'vB').produit?.id==='b')
  check('T14 : vendeur A → le sien', produitDuCatalogueVendeur('ClearZal', cat, 'vA').produit?.id==='a')
  check('T14 : produit sans vendeur → pour tous', produitDuCatalogueVendeur('commun', cat, 'vA').produit?.id==='s')
  check('T14 : un vendeur C n\'a pas clearzal → inconnu (jamais celui de A ou B)', produitDuCatalogueVendeur('clearzal', cat, 'vC').cas==='inconnu')
  const V=await verdictProduits({ produits:[{produit:'clearzal',lignes:2}], catalogue:cat, paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>ids, vendeurId:'vB' })
  check('T14 : verdict du fichier du vendeur B → accepté', V[0].ok===true, JSON.stringify(V[0]))
  const V2=await verdictProduits({ produits:[{produit:'clearzal',lignes:2}], catalogue:cat, paysId:'x', nomEntrepot:'A', enStock:async(p,ids)=>ids, vendeurId:'vC' })
  check('T14 : fichier du vendeur C → refusé (« absent du catalogue »)', V2[0].ok===false && V2[0].cas==='inconnu', JSON.stringify(V2[0]))
}

console.log(`\n${ok} passed, ${ko} failed`)
