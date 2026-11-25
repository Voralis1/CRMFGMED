// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production depuis (correctifs 14/10, entrepot_commande.sql, la colonne
// commandes.articles), puis applique produits_suppression.sql deux fois.
//
// La règle : un produit qui a un historique (mouvements, expéditions, stock
// non nul, commandes qui le nomment) ne se supprime pas — refus qui nomme
// ce qui bloque. Sans historique, il se supprime, ses lignes de stock à zéro
// avec lui. Pour tous : vendeur (RLS), clé service, éditeur SQL.
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
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
const FICHIER=fs.readFileSync(R+'sql/produits_suppression.sql','utf8')

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

// ---- deux entreprises, un vendeur, l'Angola et le Congo
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const VENDEUR='aaaaaaaa-0000-0000-0000-000000000001'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
await q(`insert into auth.users values ($1,'v@x')`,[VENDEUR])
await ins('user_roles',{user_id:VENDEUR,tenant_id:T,role:'seller'})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
await db.exec(`set session_replication_role = origin`)

const produit=async(nom,code,tenant=T)=>(await ins('produits',{tenant_id:tenant,product:nom,code,current_quantity:0})).id
const ligneStock=async(p,e,dispo=0,extra={})=>{
  await db.exec(`set session_replication_role = replica`)
  await ins('stocks',{tenant_id:T,produit_id:p,entrepot_id:e,quantite_disponible:dispo,quantite_reservee:0,quantite_defectueuse:0,...extra})
  await db.exec(`set session_replication_role = origin`)
}
// Mouvements sans le trigger de stock : on veut l'historique, pas la quantité.
const mouvements=async(p,n)=>{
  await db.exec(`set session_replication_role = replica`)
  for(let i=0;i<n;i++) await ins('mouvements_stock',{tenant_id:T,produit_id:p,entrepot_id:eAO,type_mouvement:i%2?'sortie':'entree',quantite:1})
  await db.exec(`set session_replication_role = origin`)
}
let nc=0
const commande=async(texte,extra={})=>{
  await db.exec(`set session_replication_role = replica`)
  await ins('commandes',{lead_id:'L'+(++nc),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+nc,produit:texte,quantite:1,prix:10,...extra})
  await db.exec(`set session_replication_role = origin`)
}

// ---- 0. AVANT le fichier : le trou (la cascade efface l'historique)
const pTrou=await produit('Trou','trou'); await ligneStock(pTrou,eAO,5); await mouvements(pTrou,3)
await supprimer(pTrou)
check('avant le fichier : supprimer un produit efface ses 3 mouvements et son stock (le trou)',
  !(await existe(pTrou)) && (await nb('mouvements_stock',pTrou))===0 && (await nb('stocks',pTrou))===0)

// ---- les produits du test
const pClear=await produit('Clearzal','clearzal')
await mouvements(pClear,14)
const exp=await ins('expeditions',{tenant_id:T,reference:'EXP-1',statut:'en_attente'})
await db.exec(`set session_replication_role = replica`)
await ins('expeditions_produits',{tenant_id:T,expedition_id:exp.id,produit_id:pClear,quantite:3})
await db.exec(`set session_replication_role = origin`)
for(let i=0;i<11;i++) await commande(i%2?'Clearzal':'CLEARZAL ')
const pUn=await produit('Uno','uno'); await mouvements(pUn,1)
const pNeg=await produit('Neg Oil','negoil'); await ligneStock(pNeg,eAO,-2)
const pRes=await produit('Reserve','reserve'); await ligneStock(pRes,eAO,0,{quantite_reservee:1})
const pDef=await produit('Defect','defect'); await ligneStock(pDef,eAO,0,{quantite_defectueuse:3})
const pCode=await produit('Thé du côlon','CT-1'); await commande('ct-1')
const pNom=await produit('Crème Éclat',null); await commande('creme   eclat')
const pCsv=await produit('Golden oil','goldhuile'); await commande('Clearzal + Golden oil')
const pApi=await produit('Shilajit','shilajit'); await commande('Shilajit ×2 + Autre ×1')
const pArt=await produit('Sp-4','Sp4'); await commande('n importe quoi',{articles:[{produit:'X',code:'SP4',quantite:1}]})
const pMal=await produit('Kneehuile','kneehuile'); await commande('kneehuille')                 // mal orthographié
const pAutre=await produit('Retinol','retinol'); await db.exec(`set session_replication_role = replica`)
await ins('commandes',{lead_id:'X1',tenant_id:T2,pays_id:AO2,client_nom:'C',client_telephone:'+1',produit:'retinol',quantite:1,prix:1})
await db.exec(`set session_replication_role = origin`)
const pFrais=await produit('Faute de frappe','fdf'); await ligneStock(pFrais,eAO,0); await ligneStock(pFrais,eCG,0)
const pVendeur=await produit('Neuf du vendeur','neufv'); await ligneStock(pVendeur,eAO,0)
const pLien=await produit('Lie','lie'); await db.exec(`update public.produits set upsell_produit_id=$1 where id=$2`.replace('$1',`'${pLien}'`).replace('$2',`'${pUn}'`))

// ---- 1. le fichier, deux fois, sans toucher aux données
const photo=async()=>JSON.stringify(await q(`select (select json_agg(p order by id) from public.produits p) a, (select json_agg(s order by id) from public.stocks s) b, (select count(*) from public.mouvements_stock) c`))
const avant=await photo()
for (const run of [1,2]) { const e=await erreur(()=>db.exec(FICHIER)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('aucune donnée modifiée (les tentatives du §5 sont annulées)', await photo()===avant)
const regle=async c=>(await q(`select confdeltype from pg_constraint where conname=$1`,[c]))[0]?.confdeltype
check('stocks_produit_id_fkey en RESTRICT', await regle('stocks_produit_id_fkey')==='r')
check('mouvements_stock_produit_id_fkey en RESTRICT', await regle('mouvements_stock_produit_id_fkey')==='r')
check('expeditions_produits reste RESTRICT', await regle('expeditions_produits_produit_id_fkey')==='r')
check('upsell reste SET NULL', await regle('produits_upsell_produit_id_fkey')==='n')
const priv=async(r,f)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[r,f]))[0].x
check('historique_produit fermé à authenticated / anon', !(await priv('authenticated','public.historique_produit(uuid)')) && !(await priv('anon','public.historique_produit(uuid)')))

// ---- 2. le refus, et ce qu'il dit
let e=await erreur(()=>supprimer(pClear))
// 11 commandes « Clearzal » + la commande CSV « Clearzal + Golden oil » = 12.
check('le message du ticket, mot pour mot', e==='« Clearzal » ne peut pas être supprimé : 14 mouvements de stock, 1 expédition, 12 commandes.', String(e))
check('… et rien n\'est parti', await existe(pClear) && (await nb('mouvements_stock',pClear))===14)
e=await erreur(()=>supprimer(pUn));    check('singulier : « 1 mouvement de stock »', /: 1 mouvement de stock\.$/.test(e||''), String(e))
e=await erreur(()=>supprimer(pNeg));   check('stock NÉGATIF (-2) → bloque : « 1 ligne de stock non nulle »', /1 ligne de stock non nulle\./.test(e||''), String(e))
e=await erreur(()=>supprimer(pRes));   check('stock réservé → bloque', /ligne de stock non nulle/.test(e||''), String(e))
e=await erreur(()=>supprimer(pDef));   check('stock défectueux → bloque', /ligne de stock non nulle/.test(e||''), String(e))
e=await erreur(()=>supprimer(pCode));  check('commande qui écrit le CODE (casse) → bloque', /1 commande\./.test(e||''), String(e))
e=await erreur(()=>supprimer(pNom));   check('commande qui écrit le nom sans accents, espaces en trop → bloque', /1 commande\./.test(e||''), String(e))
e=await erreur(()=>supprimer(pCsv));   check('commande CSV à deux produits « A + B » → bloque', /1 commande\./.test(e||''), String(e))
e=await erreur(()=>supprimer(pApi));   check('commande API « A ×2 + B ×1 » → bloque', /1 commande\./.test(e||''), String(e))
e=await erreur(()=>supprimer(pArt));   check('commandes.articles (code, autre casse) → bloque', /1 commande\./.test(e||''), String(e))
check('… Clearzal compte la commande à deux produits', (await q(`select public.historique_produit($1) h`,[pClear]))[0].h.includes('12 commandes'))

// ---- 3. ce qui ne bloque pas (et ce que ça manque, dit dans le fichier)
e=await erreur(()=>supprimer(pMal));   check('commande mal orthographiée → ne bloque pas (manqué, dit dans l\'en-tête)', e===null && !(await existe(pMal)), String(e))
e=await erreur(()=>supprimer(pAutre)); check('commande d\'une AUTRE entreprise au même nom → ne bloque pas', e===null && !(await existe(pAutre)), String(e))
e=await erreur(()=>supprimer(pFrais))
check('sans historique : supprimé, ses 2 lignes de stock à zéro avec lui', e===null && !(await existe(pFrais)) && (await nb('stocks',pFrais))===0, String(e))
e=await erreur(()=>supprimer(pLien))
check('produit cité en up-sell d\'un autre : supprimé, le lien passe à null', e===null && (await q(`select upsell_produit_id u from public.produits where id=$1`,[pUn]))[0].u===null, String(e))

// ---- 4. pour tous
e=await sous(VENDEUR,'authenticated',()=>q(`delete from public.produits where id=$1`,[pVendeur])).then(()=>null,x=>x.message)
check('vendeur, sans historique : supprimé (le trigger retire la ligne de stock qu\'il ne peut pas écrire)',
  e===null && !(await existe(pVendeur)) && (await nb('stocks',pVendeur))===0, String(e))
e=await sous(VENDEUR,'authenticated',()=>q(`delete from public.produits where id=$1`,[pClear])).then(()=>null,x=>x.message)
check('vendeur, console du navigateur : refusé avec le message', /^« Clearzal » ne peut pas être supprimé/.test(e||''), String(e))
e=await sous('','service_role',()=>q(`delete from public.produits where id=$1`,[pClear])).then(()=>null,x=>x.message)
check('clé service : refusé (pas d\'exemption)', /ne peut pas être supprimé/.test(e||''), String(e))
e=await erreur(()=>supprimer(pClear))
check('éditeur SQL (postgres) : refusé', /ne peut pas être supprimé/.test(e||''), String(e))

// ---- 5. le filet : trigger désactivé, les clés tiennent seules
await db.exec(`alter table public.produits disable trigger trg_produits_suppression`)
e=await erreur(()=>supprimer(pUn))
check('trigger désactivé, mouvements → la clé RESTRICT refuse', /mouvements_stock_produit_id_fkey/.test(e||''), String(e))
e=await erreur(()=>supprimer(pNeg))
check('trigger désactivé, ligne de stock → la clé RESTRICT refuse', /stocks_produit_id_fkey/.test(e||''), String(e))
await db.exec(`alter table public.produits enable trigger trg_produits_suppression`)

// ---- 6. rattacher_produit_pays : un négatif n'est pas un vide
const pR=await produit('Rattache','rattache'); await ligneStock(pR,eAO,0); await ligneStock(pR,eCG,-2)
let r=(await q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[pR,`{}`]))[0]
check('retirer tous les pays : la ligne à 0 part, la ligne à -2 reste (gardes_pleins = 1)',
  r.retires===1 && r.gardes_pleins===1 && (await q(`select quantite_disponible q from public.stocks where produit_id=$1`,[pR])).map(x=>x.q).join()==='-2', JSON.stringify(r))
e=await erreur(()=>supprimer(pR))
check('… et la suppression reste refusée', /1 ligne de stock non nulle/.test(e||''), String(e))
r=(await q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[pR,`{${AO},${CG}}`]))[0]
check('rattacher de nouveau : la ligne Angola revient, le -2 du Congo est intact', r.ajoutes===1 &&
  (await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[pR,eCG]))[0].q===-2, JSON.stringify(r))

// ---- 7. archiver
await sous(VENDEUR,'authenticated',()=>q(`update public.produits set statut='inactif' where id=$1`,[pClear]))
check('vendeur : archiver (statut inactif) passe', (await q(`select statut from public.produits where id=$1`,[pClear]))[0].statut==='inactif')
const trouve=(await q(`select * from public.produit_de_commande($1,'clearzal')`,[T]))[0]
check('archivé : produit_de_commande le trouve toujours (le stock d\'une livraison suit)', trouve.produit_id===pClear, JSON.stringify(trouve))
await sous(VENDEUR,'authenticated',()=>q(`update public.produits set statut='actif' where id=$1`,[pClear]))
check('désarchiver passe', (await q(`select statut from public.produits where id=$1`,[pClear]))[0].statut==='actif')
e=await erreur(()=>q(`update public.produits set statut='archive' where id=$1`,[pClear]))
check('statut hors actif/inactif refusé par la contrainte existante', /produits_statut_valide/.test(e||''), String(e))

// ---- 8. rejouer après usage
const e8=await erreur(()=>db.exec(FICHIER)); check('rejouer le fichier après usage', e8===null, String(e8))

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
