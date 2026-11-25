// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// entrepot_commande.sql deux fois et vérifie la règle du 22/10 :
// l'entrepôt = celui du pays de la commande, le produit n'est qu'une note.
// Création (trigger), garde, livraison (fn_ajuster_stock_livraison),
// rattrapage, droits.
//
// AVANT=<chemin> : charge d'abord cette version du fichier (celle du 21/10,
// en production) et crée des commandes avec, pour vérifier le passage.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
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
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))

const FICHIER=fs.readFileSync(R+'sql/entrepot_commande.sql','utf8')
const RATTRAPAGE=fs.readFileSync(R+'sql/entrepot_commande_2_rattrapage.sql','utf8')
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
const refuse=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }

// ---- deux entreprises, quatre pays, un entrepôt par pays sauf le Mali
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const GA=(await ins('pays',{tenant_id:T,nom:'Gabon',code:'GA'})).id
const ML=(await ins('pays',{tenant_id:T,nom:'Mali',code:'ML'})).id           // pas d'entrepôt
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
const eGA=(await ins('entrepots',{tenant_id:T,nom:'Gabon',pays_id:GA,actif:true})).id
const eSans=(await ins('entrepots',{tenant_id:T,nom:'Sans pays',pays_id:null,actif:true})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
const eAO2=(await ins('entrepots',{tenant_id:T2,nom:'Angola',pays_id:AO2,actif:true})).id
const prod=async(nom,code,entrepots,tenant=T)=>{
  const p=await ins('produits',{tenant_id:tenant,product:nom,code,current_quantity:0})
  for(const e of entrepots) await ins('stocks',{tenant_id:tenant,produit_id:p.id,entrepot_id:e,quantite_disponible:0,quantite_reservee:0,quantite_defectueuse:0})
  return p.id }
const pUn   = await prod('Clearzal','clearzal',[eAO])
const pDeux = await prod('Shilajit','shilajit',[eAO,eCG])
const pColon= await prod('Colon Tea','colontea',[eAO])         // nom ≠ code
const pCongo= await prod('Golden oil','goldhuile',[eCG])       // stocké au Congo seulement
await prod('Crème Éclat',null,[eAO])
await prod('Doublon',null,[eAO]); await prod('doublon',null,[eAO])
await prod('Colon Tea','colontea',[eAO2],T2)
await db.exec(`set session_replication_role = origin`)

let n=0
const commande=async(produit,pays,extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:pays,client_nom:'C',client_telephone:'+244'+n,produit,quantite:1,prix:10,...extra})

// ---- 0. passage depuis la production (règle du 21/10)
{ let e=null; try { await db.exec(RATTRAPAGE) } catch(x){ e=x.message }
  check('fichier 2 avant le fichier 1 → refusé, nomme le fichier 1', /entrepot_commande\.sql/.test(e||''), String(e)) }
let ancien={}
if (process.env.AVANT) {
  await db.exec(fs.readFileSync(process.env.AVANT,'utf8'))
  ancien.congo=(await commande('Golden oil',AO)).id      // 21/10 : vide + note « stocké à Congo »
  ancien.inconnu=(await commande('kneehuile',AO)).id     // 21/10 : vide, sans note
  ancien.bon=(await commande('Clearzal',AO)).id          // 21/10 : Angola
}
const photo=async()=>JSON.stringify(await q(`select c.id, c.entrepot_id, to_jsonb(c)->'stock_note' n, to_jsonb(c)->'stock_ajuste' a from public.commandes c order by c.id`))
const avantFichier1=await photo()
for (const run of [1,2]) {
  try { await db.exec(FICHIER); check(`entrepot_commande.sql run ${run}`,true) }
  catch(e){ check(`entrepot_commande.sql run ${run}`,false,e.message); process.exit(1) }
}
check('fichier 1 : AUCUNE commande existante modifiée', await photo()===avantFichier1)
const lire=async id=>(await q(`select entrepot_id, stock_note, stock_ajuste from public.commandes where id=$1`,[id]))[0]
if (process.env.AVANT) {
  const c0=await lire(ancien.congo)
  check('prod, entre les deux fichiers : la commande « stockée au Congo » est encore sans entrepôt', c0.entrepot_id===null, JSON.stringify(c0))
  await db.exec(RATTRAPAGE)
  const c=await lire(ancien.congo), i=await lire(ancien.inconnu), b=await lire(ancien.bon)
  check('prod : le fichier 2 donne l\'Angola à la commande « stockée au Congo », et efface la note du 21/10', c.entrepot_id===eAO && c.stock_note===null, JSON.stringify(c))
  check('prod : … et à la commande au produit inconnu, sans note', i.entrepot_id===eAO && i.stock_note===null, JSON.stringify(i))
  check('prod : la commande déjà juste ne bouge pas', b.entrepot_id===eAO && b.stock_note===null, JSON.stringify(b))
}
check('colonne entrepot_choisi absente', (await cols('commandes')).every(c=>c.column_name!=='entrepot_choisi'))

// ---- 1. la règle, à la création : le pays décide, toujours
let c=await commande('Clearzal',AO)
check('produit rangé dans le pays → entrepôt du pays, pas de note', c.entrepot_id===eAO && c.stock_note===null, JSON.stringify([c.entrepot_id,c.stock_note]))
c=await commande('Shilajit',CG)
check('produit rangé dans deux pays, client au Congo → Congo', c.entrepot_id===eCG)
c=await commande('Shilajit',GA)
check('produit rangé ailleurs, client au Gabon → Gabon quand même', c.entrepot_id===eGA, String(c.entrepot_id))
check('… SANS note de stock à la création (le stock bouge : l\'écran le lit en direct)', c.stock_note===null, String(c.stock_note))
const rG=(await q(`select * from public.resoudre_entrepot_commande($1,'Shilajit',$2)`,[T,GA]))[0]
check('… la fonction dit quand même le cas et la raison (non_stocke)', rG.cas==='non_stocke' && /négatif/.test(rG.raison||'') && rG.note===null, JSON.stringify(rG))
c=await commande('Golden oil',AO)
check('stocké au Congo seulement, client en Angola → Angola, jamais le Congo', c.entrepot_id===eAO, String(c.entrepot_id))
c=await commande('kneehuile',AO)
check('produit inconnu → entrepôt du pays quand même, AUCUNE note', c.entrepot_id===eAO && c.stock_note===null, JSON.stringify([c.entrepot_id,c.stock_note]))
c=await commande('Doublon',AO)
check('deux produits au même nom → entrepôt du pays + note', c.entrepot_id===eAO && /2 produits/.test(c.stock_note||''), JSON.stringify([c.entrepot_id,c.stock_note]))
// produit vide : refusé à l'insert par valider_commande_trigger ; la branche se teste sur la fonction
c=(await q(`select * from public.resoudre_entrepot_commande($1,'  ',$2)`,[T,AO]))[0]
check('sans produit (fonction) → entrepôt du pays + note', c.entrepot_id===eAO && c.cas==='sans_produit' && /aucun nom de produit/.test(c.note||''), JSON.stringify(c))
c=await commande('Clearzal',ML)
check('pays SANS entrepôt → vide + note : le seul cas sans entrepôt', c.entrepot_id===null && /Mali/.test(c.stock_note||''), JSON.stringify([c.entrepot_id,c.stock_note]))
c=await commande('Colontea',AO)
check('Colon Tea retrouvé par le code : pas de note', c.entrepot_id===eAO && c.stock_note===null)
for (const t of ['Colontea','colontea',' COLONTEA ','Colon Tea','cölontéa']) {
  const r=(await q(`select * from public.produit_de_commande($1,$2)`,[T,t]))[0]
  check(`produit_de_commande(« ${t} ») → Colon Tea`, r.produit_id===pColon, JSON.stringify(r))
}
await db.exec(`set session_replication_role = replica`)
await ins('produits',{tenant_id:T,product:'Un',code:'Café'}); await ins('produits',{tenant_id:T,product:'Deux',code:'cafe'})
await db.exec(`set session_replication_role = origin`)
c=(await q(`select * from public.produit_de_commande($1,'CAFE')`,[T]))[0]
check('deux codes qui se confondent sans accents → ambigu', c.produit_id===null && c.cas==='produit_ambigu' && /code/.test(c.raison||''), JSON.stringify(c))
c=await commande('creme  eclat',AO)
check('nom sans accents ni espaces en trop : pas de note', c.entrepot_id===eAO && c.stock_note===null)
c=await ins('commandes',{lead_id:'X1',tenant_id:T2,pays_id:AO2,client_nom:'C',client_telephone:'+1',produit:'Colontea',quantite:1,prix:1})
check('autre entreprise : son propre entrepôt, jamais celui de la première', c.entrepot_id===eAO2, String(c.entrepot_id))
const sansPays=(await q(`select count(*)::int n from public.commandes where entrepot_id=$1`,[eSans]))[0].n
check('l\'entrepôt sans pays n\'est jamais choisi', sansPays===0)
c=(await q(`select * from public.resoudre_entrepot_commande($1,'Clearzal',null)`,[T]))[0]
check('pas de pays (fonction) → vide + raison', c.entrepot_id===null && c.cas==='sans_pays')
await q(`select set_config('test.uid','00000000-0000-0000-0000-00000000aaaa',false)`)
await db.exec(`create or replace function public.get_my_tenant_id() returns uuid language sql stable as $$ select '${T}'::uuid $$`)
c=(await q(`insert into public.commandes (lead_id,pays_id,client_nom,client_telephone,produit,quantite,prix) values ('SANS-T',$1,'C','+2','Clearzal',1,1) returning *`,[AO]))[0]
await q(`select set_config('test.uid','',false)`)
check('tenant_id rempli par l\'autre trigger AVANT le nôtre', c.tenant_id===T && c.entrepot_id===eAO, JSON.stringify([c.tenant_id,c.entrepot_id]))

// ---- 2. la garde : l'entrepôt fourni doit être celui du pays
c=await commande('Golden oil',AO,{entrepot_id:eAO})
check('entrepôt fourni = celui du pays (responsable à l\'import) → accepté', c.entrepot_id===eAO)
let e=await refuse(()=>commande('Golden oil',AO,{entrepot_id:eCG}))
check('entrepôt fourni d\'un autre pays → refusé, nomme le bon', /Entrepôt refusé/.test(e||'') && /Angola/.test(e||''), String(e))
e=await refuse(()=>commande('Clearzal',AO,{entrepot_id:eAO2}))
check('entrepôt d\'une autre entreprise → refusé', /Entrepôt refusé/.test(e||''), String(e))
e=await refuse(()=>commande('Clearzal',AO,{entrepot_id:eSans}))
check('entrepôt sans pays → refusé', /Entrepôt refusé/.test(e||''), String(e))
e=await refuse(()=>commande('Clearzal',ML,{entrepot_id:eAO}))
check('pays sans entrepôt + entrepôt fourni → refusé, le dit', /pas d'entrepôt/.test(e||''), String(e))
c=await commande('Clearzal',AO,{entrepot_id:null})
check('entrepot_id null envoyé (vendeur à l\'import) → rempli', c.entrepot_id===eAO)
const g=(await commande('Clearzal',AO)).id
e=await refuse(()=>q(`update public.commandes set entrepot_id=$2 where id=$1`,[g,eCG]))
check('update : entrepôt d\'un autre pays → refusé', /Entrepôt refusé/.test(e||''), String(e))
e=await refuse(()=>q(`update public.commandes set entrepot_id=null where id=$1`,[g]))
check('update : vider l\'entrepôt → refusé', /Entrepôt refusé/.test(e||''), String(e))
let u=(await q(`update public.commandes set pays_id=$2, entrepot_id=$3 where id=$1 returning entrepot_id`,[g,CG,eCG]))[0]
check('update : pays ET son entrepôt dans la même requête → accepté', u.entrepot_id===eCG, JSON.stringify(u))
u=(await q(`update public.commandes set entrepot_id=$2 where id=$1 returning entrepot_id`,[g,eCG]))[0]
check('update : même entrepôt réécrit → accepté', u.entrepot_id===eCG)

// ---- 3. modifier le produit ou le pays avant le départ
c=await commande('Golden oil',AO)
u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning entrepot_id, stock_note`,[c.id,CG]))[0]
check('pays corrigé → entrepôt du nouveau pays, note recalculée (rangé au Congo : plus de note)', u.entrepot_id===eCG && u.stock_note===null, JSON.stringify(u))
u=(await q(`update public.commandes set produit='Clearzal' where id=$1 returning entrepot_id, stock_note`,[c.id]))[0]
check('produit changé (rangé en Angola, client au Congo) → entrepôt GARDÉ, pas de note de stock', u.entrepot_id===eCG && u.stock_note===null, JSON.stringify(u))
u=(await q(`update public.commandes set produit='Doublon' where id=$1 returning entrepot_id, stock_note`,[c.id]))[0]
check('produit changé vers un nom ambigu → note recalculée', u.entrepot_id===eCG && /2 produits/.test(u.stock_note||''), JSON.stringify(u))
u=(await q(`update public.commandes set client_nom='Autre' where id=$1 returning entrepot_id, stock_note`,[c.id]))[0]
check('autre colonne modifiée : rien ne bouge', u.entrepot_id===eCG && /2 produits/.test(u.stock_note||''), JSON.stringify(u))
u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning entrepot_id, stock_note`,[c.id,ML]))[0]
check('pays corrigé vers un pays sans entrepôt → vide + note', u.entrepot_id===null && /Mali/.test(u.stock_note||''), JSON.stringify(u))

// livreur pour créer des livraisons
await db.exec(`set session_replication_role = replica`)
const UL='33333333-3333-3333-3333-333333333333'
await db.exec(`insert into auth.users values ('${UL}','l@x')`)
await ins('user_roles',{user_id:UL,tenant_id:T,role:'livreur'})
const liv=await ins('livreurs',{tenant_id:T,user_id:UL,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})
await db.exec(`set session_replication_role = origin`)
const livraison=async(cmd,statut='a_preparer')=>ins('livraisons',{tenant_id:T,commande_id:cmd,livreur_id:liv.id,statut})

c=await commande('Shilajit',AO)
let lv=await livraison(c.id,'a_preparer')
u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning entrepot_id`,[c.id,CG]))[0]
check('livraison à préparer : encore recalculé', u.entrepot_id===eCG, JSON.stringify(u))
await q(`update public.livraisons set statut='expedie' where id=$1`,[lv.id])
u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning entrepot_id`,[c.id,AO]))[0]
check('expédiée : pays corrigé après coup, l\'entrepôt d\'où elle est partie reste', u.entrepot_id===eCG, JSON.stringify(u))

// ---- 4. la livraison
const stock=async(p,e)=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,e]))[0]?.q
const sorties=async()=>(await q(`select count(*)::int n from public.mouvements_stock where type_mouvement='sortie'`))[0].n

c=await commande('Shilajit',CG); lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
check('livré : sort du Congo', await stock(pDeux,eCG)===-1 && await stock(pDeux,eAO)===0, JSON.stringify([await stock(pDeux,eCG),await stock(pDeux,eAO)]))
check('… sans note', (await lire(c.id)).stock_note===null)
await q(`update public.livraisons set statut='retour' where id=$1`,[lv.id])
check('dé-livré : revient au Congo', await stock(pDeux,eCG)===0, String(await stock(pDeux,eCG)))

c=await commande('Golden oil',AO); lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
let cc=await lire(c.id)
check('produit du Congo livré en Angola : sort de l\'ANGOLA (ligne créée, -1)', await stock(pCongo,eAO)===-1, String(await stock(pCongo,eAO)))
check('… jamais du Congo', await stock(pCongo,eCG)===0, String(await stock(pCongo,eCG)))
check('… stock_ajuste posé, note « livré sans stock déclaré … négatif »', cc.stock_ajuste!==null && cc.entrepot_id===eAO && /Livré sans stock déclaré dans l'entrepôt Angola/.test(cc.stock_note||''), JSON.stringify(cc))
await q(`update public.livraisons set statut='retour' where id=$1`,[lv.id])
cc=await lire(c.id)
check('… dé-livré : revient en Angola (0), note effacée', await stock(pCongo,eAO)===0 && cc.stock_note===null && cc.stock_ajuste===null, JSON.stringify([await stock(pCongo,eAO),cc]))

const avant=await sorties()
c=await commande('kneehuile',AO); lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
cc=await lire(c.id)
check('produit inconnu livré : AUCUN mouvement, note « introuvable »', await sorties()===avant && /introuvable au catalogue/.test(cc.stock_note||'') && cc.stock_ajuste===null, JSON.stringify(cc))

c=await commande('Clearzal',ML); lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
cc=await lire(c.id)
check('pays sans entrepôt livré : aucun mouvement, note', await sorties()===avant && /Aucun entrepôt/.test(cc.stock_note||''), JSON.stringify(cc))

c=await commande('Colontea',AO); lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
check('Colon Tea livré : décompté par le code', await stock(pColon,eAO)===-1, String(await stock(pColon,eAO)))

// commande ancienne sans entrepôt : la livraison prend celui du pays et l'écrit (passe la garde)
await db.exec(`set session_replication_role = replica`)
c=await commande('Clearzal',AO)
await q(`update public.commandes set entrepot_id=null where id=$1`,[c.id])
await db.exec(`set session_replication_role = origin`)
lv=await livraison(c.id)
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
cc=await lire(c.id)
check('livraison sans entrepôt : celui du pays, écrit sur la commande', cc.entrepot_id===eAO && await stock(pUn,eAO)===-1, JSON.stringify(cc))

// ---- 5. le rattrapage
await db.exec(`set session_replication_role = replica`)
const vieux={}
for (const [k,p,pays] of [['un','Clearzal',AO],['ailleurs','Shilajit',GA],['inconnu','kneehuile',AO],['mali','Clearzal',ML]])
  vieux[k]=(await commande(p,pays,{entrepot_id:null})).id
const partie=(await commande('Clearzal',AO)).id
await q(`update public.commandes set entrepot_id=null where id=$1`,[partie])
await ins('livraisons',{tenant_id:T,commande_id:partie,livreur_id:liv.id,statut:'livre'})
await db.exec(`set session_replication_role = origin`)
const res=await q(`select * from public.remplir_entrepots_commandes()`)
check('rattrapage : un entrepôt', (await lire(vieux.un)).entrepot_id===eAO)
check('rattrapage : produit rangé ailleurs → entrepôt du pays, sans note', (await lire(vieux.ailleurs)).entrepot_id===eGA && (await lire(vieux.ailleurs)).stock_note===null)
check('rattrapage : produit inconnu → entrepôt du pays, sans note', (await lire(vieux.inconnu)).entrepot_id===eAO && (await lire(vieux.inconnu)).stock_note===null)
check('rattrapage : pays sans entrepôt → vide + note', (await lire(vieux.mali)).entrepot_id===null && /Mali/.test((await lire(vieux.mali)).stock_note||''))
check('rattrapage : déjà partie → pas touchée, comptée à part', (await lire(partie)).entrepot_id===null && res.some(r=>r.cas==='deja_expediee'), JSON.stringify(res))
const inconnus=res.filter(r=>r.cas==='produit_inconnu').reduce((s,r)=>s+Number(r.nombre),0)
check('rattrapage : le produit inconnu est compté (il change)', inconnus===1, JSON.stringify(res))
const res2=await q(`select * from public.remplir_entrepots_commandes()`)
check('rattrapage rejoué : plus rien ne change', res2.every(r=>r.cas==='deja_expediee'), JSON.stringify(res2))
try { await db.exec(FICHIER); check('fichier 1 rejoué après rattrapage', true) } catch(x){ check('fichier 1 rejoué après rattrapage', false, x.message) }
try { await db.exec(RATTRAPAGE); check('fichier 2 rejoué', true) } catch(x){ check('fichier 2 rejoué', false, x.message) }

// ---- 6. droits
const priv=async(r,fn)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[r,fn]))[0].x
for (const fn of ['public.resoudre_entrepot_commande(uuid,text,uuid)','public.entrepot_du_pays(uuid,uuid)','public.produit_de_commande(uuid,text)','public.commande_expediee(uuid)','public.remplir_entrepots_commandes()'])
  for (const r of ['anon','authenticated']) check(`${r} ne peut pas appeler ${fn.split('(')[0]}`, !(await priv(r,fn)))
await q(`select set_config('test.uid','00000000-0000-0000-0000-00000000aaaa',false)`)
let ref=false; try { await q(`select * from public.remplir_entrepots_commandes()`) } catch { ref=true }
await q(`select set_config('test.uid','',false)`)
check('rattrapage refusé à un compte connecté', ref)

console.log(`\n${ok} passed, ${ko} failed`)
