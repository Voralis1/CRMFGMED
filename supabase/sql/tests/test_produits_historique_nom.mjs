// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production au 23/10 (correctifs 14/10, entrepot_commande.sql,
// produits_suppression.sql — le refus —, receptionner_expedition tel qu'il est
// en prod), puis applique produits_historique_nom.sql deux fois.
//
// La règle : un produit se supprime, toujours. Ses mouvements de stock et ses
// lignes d'expédition restent, avec leurs quantités, leurs dates et le nom du
// produit écrit sur la ligne (figé à l'écriture). Ses lignes de stock partent
// avec lui (CASCADE).
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
await db.exec(`alter table public.commandes add column if not exists articles jsonb`)   // intake_generique.sql, en prod
await db.exec(fs.readFileSync(R+'sql/tests/fixtures/receptionner_expedition_prod_23_10.sql','utf8'))
const ANCIEN=fs.readFileSync(R+'sql/produits_suppression.sql','utf8')
await db.exec(ANCIEN)                                                                   // en prod depuis le 23/10
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
const FICHIER=fs.readFileSync(R+'sql/produits_historique_nom.sql','utf8')

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const existe=async id=>(await q(`select count(*)::int n from public.produits where id=$1`,[id]))[0].n===1
const nb=async(t,id)=>(await q(`select count(*)::int n from public.${t} where produit_id=$1`,[id]))[0].n
const supprimer=(id)=>q(`delete from public.produits where id=$1`,[id])
const replica=()=>db.exec(`set session_replication_role = replica`)
const origine=()=>db.exec(`set session_replication_role = origin`)

// ---- deux entreprises, un vendeur, un manager, l'Angola et le Congo
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const VENDEUR='aaaaaaaa-0000-0000-0000-000000000001', MANAGER='aaaaaaaa-0000-0000-0000-000000000002'
await replica()
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
await q(`insert into auth.users values ($1,'v@x'),($2,'m@x')`,[VENDEUR,MANAGER])
await ins('user_roles',{user_id:VENDEUR,tenant_id:T,role:'seller'})
await ins('user_roles',{user_id:MANAGER,tenant_id:T,role:'manager'})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
await origine()

const produit=async(nom,code,tenant=T)=>(await ins('produits',{tenant_id:tenant,product:nom,code,current_quantity:0})).id
const ligneStock=async(p,e,dispo=0,extra={})=>{
  await replica()
  await ins('stocks',{tenant_id:T,produit_id:p,entrepot_id:e,quantite_disponible:dispo,quantite_reservee:0,quantite_defectueuse:0,...extra})
  await origine()
}
// Mouvements AVANT le fichier : comme en prod, sans nom écrit.
const mouvementsAnciens=async(p,n)=>{
  await replica()
  for(let i=0;i<n;i++) await ins('mouvements_stock',{tenant_id:T,produit_id:p,entrepot_id:eAO,type_mouvement:i%2?'sortie':'entree',quantite:i+1,created_at:'2026-10-15T10:00:00Z'})
  await origine()
}
const expedition=async(ref,statut='en_attente')=>(await ins('expeditions',{tenant_id:T,reference:ref,statut,pays_destination_id:AO}))
const ligneExp=async(exp,p,qte,extra={})=>{ await replica(); const r=await ins('expeditions_produits',{tenant_id:T,expedition_id:exp,produit_id:p,quantite:qte,...extra}); await origine(); return r }

// ---- 0. l'état de la prod : le refus est en place
const pClear=await produit('Clearzal','clearzal'); await mouvementsAnciens(pClear,14); await ligneStock(pClear,eAO,7)
const expRecue=await expedition('EXP-1','confirmee'); await ligneExp(expRecue.id,pClear,3,{quantite_recue:3})
let e=await erreur(()=>supprimer(pClear))
check('avant le fichier : la prod refuse (« ne peut pas être supprimé »)', /ne peut pas être supprimé/.test(e||''), String(e))

// ---- les autres produits du test
const pRenomme=await produit('Colon Tea','CT-1'); await mouvementsAnciens(pRenomme,2)
const pNeg=await produit('Neg Oil','negoil'); await ligneStock(pNeg,eAO,-2)
const pTransit=await produit('Kneehuile','kneehuile')
const pReste=await produit('Goldhuile','goldhuile')
const expTransit=await expedition('EXP-2'); await ligneExp(expTransit.id,pTransit,5); await ligneExp(expTransit.id,pReste,4)
const pVendeur=await produit('Du vendeur','dv'); await mouvementsAnciens(pVendeur,1)
const pService=await produit('Clé service','cs'); await mouvementsAnciens(pService,1)
const pLien=await produit('Lie','lie'); await q(`update public.produits set upsell_produit_id=$1 where id=$2`,[pLien,pReste])
const pAutre=await produit('Autre boîte','autre',T2)

// ---- 1. le fichier, deux fois
const photo=async()=>JSON.stringify(await q(`select
   (select json_agg(p order by id) from public.produits p) a,
   (select json_agg(s order by id) from public.stocks s) b,
   (select json_agg(json_build_object('id',id,'p',produit_id,'q',quantite,'t',type_mouvement,'d',created_at) order by id) from public.mouvements_stock) c,
   (select json_agg(json_build_object('id',id,'p',produit_id,'q',quantite,'r',quantite_recue) order by id) from public.expeditions_produits) d`))
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FICHIER)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune donnée modifiée hors les deux colonnes (la suppression du §5 est annulée)', await photo()===avant)
const regle=async c=>(await q(`select confdeltype from pg_constraint where conname=$1`,[c]))[0]?.confdeltype
check('mouvements_stock → produits : SET NULL', await regle('mouvements_stock_produit_id_fkey')==='n')
check('expeditions_produits → produits : SET NULL', await regle('expeditions_produits_produit_id_fkey')==='n')
check('stocks → produits : CASCADE', await regle('stocks_produit_id_fkey')==='c')
check('upsell / crosssell : SET NULL, non touchés', await regle('produits_upsell_produit_id_fkey')==='n' && await regle('produits_crosssell_produit_id_fkey')==='n')
check('expeditions_produits.produit_id n\'est plus NOT NULL',
  (await q(`select is_nullable from information_schema.columns where table_name='expeditions_produits' and column_name='produit_id'`))[0].is_nullable==='YES')
check('trg_produits_suppression supprimé', (await q(`select count(*)::int n from pg_trigger where tgname='trg_produits_suppression'`))[0].n===0)
check('ses trois fonctions supprimées', (await q(`select count(*)::int n from pg_proc where proname in ('produit_suppression_garde','historique_produit','nom_produit_normalise')`))[0].n===0)
const nomsM=await q(`select distinct produit_nom n, produit_code c from public.mouvements_stock where produit_id=$1`,[pClear])
check('remplissage : les 14 anciens mouvements de Clearzal portent « Clearzal » / clearzal', nomsM.length===1 && nomsM[0].n==='Clearzal' && nomsM[0].c==='clearzal', JSON.stringify(nomsM))
check('remplissage : les lignes d\'expédition existantes portent leur nom',
  (await q(`select count(*)::int n from public.expeditions_produits where produit_nom is null`))[0].n===0)
const priv=async(r,f)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[r,f]))[0].x
check('la fonction du trigger est fermée à authenticated / anon',
  !(await priv('authenticated','public.ecrire_nom_produit_historique()')) && !(await priv('anon','public.ecrire_nom_produit_historique()')))

// ---- 2. le nom est figé à l'écriture, pareil sur les deux tables
await q(`update public.produits set product='Colontea' where id=$1`,[pRenomme])
// Une ligne d'expédition écrite (par le trigger) sous l'ancien nom : on remet
// « Colon Tea » le temps de l'écrire.
const expR=await expedition('EXP-3')
await q(`update public.produits set product='Colon Tea' where id=$1`,[pRenomme])
const lAvant=(await ins('expeditions_produits',{tenant_id:T,expedition_id:expR.id,produit_id:pRenomme,quantite:2}))
await q(`update public.produits set product='Colontea' where id=$1`,[pRenomme])
const mApres=await ins('mouvements_stock',{tenant_id:T,produit_id:pRenomme,entrepot_id:eAO,type_mouvement:'entree',quantite:9})
check('renommé après coup : les anciens mouvements gardent « Colon Tea »',
  (await q(`select count(*)::int n from public.mouvements_stock where produit_id=$1 and produit_nom='Colon Tea'`,[pRenomme]))[0].n===2)
check('renommé après coup : la ligne d\'expédition garde « Colon Tea » (même règle)',
  (await q(`select produit_nom n from public.expeditions_produits where id=$1`,[lAvant.id]))[0].n==='Colon Tea')
check('un mouvement écrit après le renommage porte « Colontea »', mApres.produit_nom==='Colontea' && mApres.produit_code==='CT-1', JSON.stringify(mApres))

// ---- 3. ce que le trigger refuse ou ignore
e=await erreur(()=>ins('mouvements_stock',{tenant_id:T,produit_id:null,entrepot_id:eAO,type_mouvement:'entree',quantite:1}))
check('NOUVEAU mouvement sans produit : refusé', e==='Un mouvement de stock doit nommer son produit.', String(e))
e=await erreur(()=>ins('expeditions_produits',{tenant_id:T,expedition_id:expR.id,produit_id:null,quantite:1}))
check('NOUVELLE ligne d\'expédition sans produit : refusée (comme avant, quand la colonne était NOT NULL)', e==='Une ligne d\'expédition doit nommer son produit.', String(e))
const mFaux=await ins('mouvements_stock',{tenant_id:T,produit_id:pReste,entrepot_id:eAO,type_mouvement:'entree',quantite:1,produit_nom:'Faux',produit_code:'faux'})
check('un nom envoyé par l\'appelant est ignoré : la base écrit le vrai', mFaux.produit_nom==='Goldhuile' && mFaux.produit_code==='goldhuile', JSON.stringify(mFaux))
await q(`update public.mouvements_stock set produit_nom='Réécrit' where id=$1`,[mFaux.id])
check('réécrire le nom à la main : ignoré', (await q(`select produit_nom n from public.mouvements_stock where id=$1`,[mFaux.id]))[0].n==='Goldhuile')
await q(`update public.mouvements_stock set produit_id=$1 where id=$2`,[pNeg,mFaux.id])
check('produit_id changé pour un autre produit : le nom suit', (await q(`select produit_nom n from public.mouvements_stock where id=$1`,[mFaux.id]))[0].n==='Neg Oil')
const mAutre=await ins('mouvements_stock',{tenant_id:T,produit_id:pAutre,entrepot_id:eAO,type_mouvement:'entree',quantite:1})
check('produit d\'une AUTRE entreprise : son nom n\'est pas recopié', mAutre.produit_nom===null, JSON.stringify(mAutre))
await q(`delete from public.mouvements_stock where id=$1`,[mAutre.id])

// ---- 4. la suppression : toujours possible, l'historique reste
const dates=JSON.stringify(await q(`select id, quantite, type_mouvement, created_at from public.mouvements_stock where produit_id=$1 order by id`,[pClear]))
e=await erreur(()=>supprimer(pClear))
check('éditeur SQL : Clearzal (14 mouvements, 1 expédition, stock 7) se supprime', e===null && !(await existe(pClear)), String(e))
const restes=await q(`select id, quantite, type_mouvement, created_at, produit_id, produit_nom from public.mouvements_stock where produit_nom='Clearzal' order by id`)
check('… ses 14 mouvements restent, produit_id NULL, nom « Clearzal »', restes.length===14 && restes.every(m=>m.produit_id===null))
check('… avec leurs quantités, types et dates intacts', JSON.stringify(restes.map(({id,quantite,type_mouvement,created_at})=>({id,quantite,type_mouvement,created_at})))===dates)
const lr=(await q(`select produit_id, produit_nom, quantite, quantite_recue from public.expeditions_produits where expedition_id=$1`,[expRecue.id]))
check('… sa ligne d\'expédition reste, nommée, quantité intacte', lr.length===1 && lr[0].produit_id===null && lr[0].produit_nom==='Clearzal' && lr[0].quantite===3, JSON.stringify(lr))
check('… sa ligne de stock (7) part avec lui (CASCADE)', (await nb('stocks',pClear))===0)
e=await erreur(()=>supprimer(pNeg))
check('stock négatif : se supprime aussi, la ligne part', e===null && (await nb('stocks',pNeg))===0, String(e))
check('… le mouvement repassé sur Neg Oil garde son nom', (await q(`select produit_nom n, produit_id p from public.mouvements_stock where id=$1`,[mFaux.id]))[0].n==='Neg Oil')
e=await erreur(()=>supprimer(pRenomme))
const noms=(await q(`select produit_nom n from public.mouvements_stock where produit_code='CT-1' order by quantite`)).map(r=>r.n).join(',')
check('renommé puis supprimé : chaque mouvement garde le nom de son moment', e===null && noms==='Colon Tea,Colon Tea,Colontea', noms)
check('… et la ligne d\'expédition aussi', (await q(`select produit_nom n from public.expeditions_produits where id=$1`,[lAvant.id]))[0].n==='Colon Tea')
e=await sous(VENDEUR,'authenticated',()=>q(`delete from public.produits where id=$1`,[pVendeur])).then(()=>null,x=>x.message)
check('vendeur (RLS) : supprime un produit avec un mouvement, le mouvement reste', e===null && !(await existe(pVendeur)) &&
  (await q(`select count(*)::int n from public.mouvements_stock where produit_nom='Du vendeur'`))[0].n===1, String(e))
e=await sous('','service_role',()=>q(`delete from public.produits where id=$1`,[pService])).then(()=>null,x=>x.message)
check('clé service : supprime, le mouvement reste', e===null && !(await existe(pService)) &&
  (await q(`select count(*)::int n from public.mouvements_stock where produit_nom='Clé service'`))[0].n===1, String(e))
e=await erreur(()=>supprimer(pLien))
check('produit cité en up-sell : supprimé, le lien passe à NULL', e===null && (await q(`select upsell_produit_id u from public.produits where id=$1`,[pReste]))[0].u===null, String(e))

// ---- 5. supprimé pendant le transport : la ligne reste, la réception compte sans mouvement
e=await erreur(()=>supprimer(pTransit))
check('produit d\'une expédition en attente : supprimé, sa ligne reste nommée', e===null &&
  (await q(`select produit_nom n from public.expeditions_produits where expedition_id=$1 and produit_id is null`,[expTransit.id]))[0]?.n==='Kneehuile', String(e))
// L'écran, en modifiant un brouillon : il ne purge et ne réécrit que les lignes qui ont un produit.
await q(`delete from public.expeditions_produits where expedition_id=$1 and produit_id is not null`,[expTransit.id])
await ins('expeditions_produits',{tenant_id:T,expedition_id:expTransit.id,produit_id:pReste,quantite:6})
const brouillon=await q(`select produit_id, produit_nom, quantite from public.expeditions_produits where expedition_id=$1 order by produit_nom`,[expTransit.id])
check('brouillon réenregistré : la ligne du produit supprimé est intacte, l\'autre réécrite', brouillon.length===2 &&
  brouillon[0].produit_nom==='Goldhuile' && brouillon[0].quantite===6 && brouillon[1].produit_nom==='Kneehuile' && brouillon[1].quantite===5 && brouillon[1].produit_id===null, JSON.stringify(brouillon))
const mvAvant=(await q(`select count(*)::int n from public.mouvements_stock`))[0].n
e=await sous(MANAGER,'authenticated',()=>q(`select * from public.receptionner_expedition($1, now(), null, '[]'::jsonb)`,[expTransit.id])).then(()=>null,x=>x.message)
const recu=await q(`select produit_id, produit_nom, quantite_recue from public.expeditions_produits where expedition_id=$1 order by produit_nom`,[expTransit.id])
const mvRecep=await q(`select produit_nom, quantite from public.mouvements_stock where notes like 'Expédition EXP-2%'`)
check('réception (manager) : passe', e===null, String(e))
check('… la ligne supprimée reçoit sa quantité reçue (5), nom gardé', recu[1].quantite_recue===5 && recu[1].produit_nom==='Kneehuile', JSON.stringify(recu))
const drap=(await q(`select produit_nom n, recu_sans_mouvement d from public.expeditions_produits where expedition_id=$1 order by produit_nom`,[expTransit.id])).map(r=>r.n+':'+r.d).join()
check('… recu_sans_mouvement : vrai pour Kneehuile, faux pour Goldhuile', drap==='Goldhuile:false,Kneehuile:true', drap)
check('… supprimé APRÈS sa réception (Clearzal, EXP-1) : faux — son mouvement existe',
  (await q(`select recu_sans_mouvement d from public.expeditions_produits where expedition_id=$1`,[expRecue.id]))[0].d===false)
await q(`update public.expeditions_produits set recu_sans_mouvement=false where expedition_id=$1`,[expTransit.id])
check('… le drapeau ne s\'écrit pas à la main', (await q(`select count(*)::int n from public.expeditions_produits where expedition_id=$1 and recu_sans_mouvement`,[expTransit.id]))[0].n===1)
check('… un seul mouvement : Goldhuile 6, aucun pour Kneehuile', (await q(`select count(*)::int n from public.mouvements_stock`))[0].n===mvAvant+1 &&
  mvRecep.length===1 && mvRecep[0].produit_nom==='Goldhuile' && mvRecep[0].quantite===6, JSON.stringify(mvRecep))

// ---- 6. rattacher_produit_pays : la correction du 23/10 reste
const pR=await produit('Rattache','rattache'); await ligneStock(pR,eAO,0); await ligneStock(pR,eCG,-2)
const r=(await q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[pR,`{}`]))[0]
check('rattacher_produit_pays : la ligne à -2 reste (gardes_pleins = 1)', r.retires===1 && r.gardes_pleins===1, JSON.stringify(r))

// ---- 7. l'ancien fichier ne peut plus remettre le refus
const avant7=await photo()
e=await erreur(()=>db.exec(`begin; ${ANCIEN}; commit;`)); await erreur(()=>db.exec('rollback'))
check('rejouer produits_suppression.sql : refusé, il nomme le nouveau fichier', /remplacé par produits_historique_nom\.sql/.test(e||''), String(e))
check('… rien n\'a bougé (ni trigger, ni clé)', await photo()===avant7 && await regle('mouvements_stock_produit_id_fkey')==='n' &&
  (await q(`select count(*)::int n from pg_trigger where tgname='trg_produits_suppression'`))[0].n===0)

// ---- 8. rejouer après usage
const avant8=await photo()
e=await erreur(()=>db.exec(FICHIER)); check('rejouer le fichier après usage', e===null, String(e))
check('… aucun nom réécrit, aucune ligne touchée', await photo()===avant8 &&
  (await q(`select produit_nom n from public.expeditions_produits where id=$1`,[lAvant.id]))[0].n==='Colon Tea')

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
