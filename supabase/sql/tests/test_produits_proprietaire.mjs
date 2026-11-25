// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production au 26/10 (correctifs 14/10, entrepot_commande.sql,
// produits_suppression.sql puis produits_historique_nom.sql), puis applique
// produits_proprietaire.sql deux fois.
//
// La règle : un vendeur ne voit et ne touche que SES produits. Tous les autres
// rôles gardent exactement ce qu'ils avaient — mesuré AVANT le fichier, puis
// comparé APRÈS, rôle par rôle (lecture, modification, suppression, création).
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
// intake_generique.sql (16/10), en prod : un code par entreprise.
await db.exec(`create unique index idx_produits_code_unique on public.produits (tenant_id, lower(btrim(code)))
               where code is not null and btrim(code) <> ''`)
await db.exec(fs.readFileSync(R+'sql/tests/fixtures/receptionner_expedition_prod_23_10.sql','utf8'))
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
const FICHIER=fs.readFileSync(R+'sql/produits_proprietaire.sql','utf8')

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
const comme=(uid,fn)=>sous(uid,'authenticated',fn)
const essai=async(uid,fn)=>comme(uid,fn).then(r=>({r,e:null}),x=>({r:null,e:x.message}))
// Une écriture tentée puis annulée : on mesure ce que la policy laisse passer
// sans rien changer aux données du test.
const annule=async(uid,sql,p)=>{
  await db.exec('begin')
  try { return await comme(uid,()=>q(sql,p)).then(r=>r.length,x=>'ERR:'+x.message) }
  finally { await db.exec('rollback') }
}
const replica=()=>db.exec(`set session_replication_role = replica`)
const origine=()=>db.exec(`set session_replication_role = origin`)

// ---- l'entreprise réelle (9183429e), celle de test (17144700), les comptes
const T='9183429e-c75c-4ed2-a869-f8bfa011bbc2', TT='17144700-2b95-43fa-9849-9e7a8f35104e'
const TARIK='00ad0558-c26d-44fb-aaaf-cdd6172aaf4a'
const U=(n)=>`aaaaaaaa-0000-0000-0000-${String(n).padStart(12,'0')}`
const VB=U(2), MANAGER=U(3), ADMIN=U(4), CEO=U(5), AGENT=U(6), LIVREUR=U(7), SUPER=U(8), VTEST=U(9), SANSROLE=U(10)
await replica()
await ins('tenants',{id:T}); await ins('tenants',{id:TT})
for (const [id,e] of [[TARIK,'tarik'],[VB,'vb'],[MANAGER,'m'],[ADMIN,'a'],[CEO,'c'],[AGENT,'ag'],[LIVREUR,'l'],[SUPER,'s'],[VTEST,'vt'],[SANSROLE,'sr']])
  await q(`insert into auth.users values ($1,$2)`,[id,e+'@x'])
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
await origine()
// Après les entrepôts : le §5 de produits_historique_nom.sql en a besoin
// pour sa propre vérification.
await db.exec(fs.readFileSync(R+'sql/produits_suppression.sql','utf8'))                  // en prod le 23/10
await db.exec(fs.readFileSync(R+'sql/produits_historique_nom.sql','utf8'))               // en prod (lu le 26/10)
await db.exec(`grant all on all tables in schema public to authenticated, anon, service_role`)

// Les 12 produits de prod, avec leurs vrais identifiants (le §5 les nomme).
const DOUZE={
  'f1c6985c-4a5e-4644-ac39-07c0d6d9e7d0':['Anti rugas','Retinol'], '4a0f8428-ba81-478d-8f4f-8fe846b6660f':['Clearzal','clearzal'],
  '84183b3e-6a7b-4ad6-abdf-cc7bb6bc7a83':['Colon Tea','colontea'], '1c6d6b00-50c3-4dbe-bc71-046a7e1cbb00':['Golden oil','goldhuile'],
  '279226ae-36b6-4a8a-8f7f-42f67991a76b':['Joint and Bone','bonegel'], '239aede0-520b-4281-9540-6ab55ebb5774':['Kidnea tea limpeza de rins','kidneytea'],
  '7ad2c377-ac7a-4f8e-9a4c-3bd15c59e56d':['Liver Detox Tea','livertea'], 'f6620c3a-2e72-4274-b539-5e1f3fd15b44':['Oleo de gengibre','gingeroil'],
  '330afd96-8703-41fb-a88e-cdc325454459':['Oleo miao','huilejap'], '7f33f154-623b-4c3e-9515-225b34b6a15f':['Shilajit','Shilajit'],
  'c5ad18ac-2048-4ece-ab0f-0ef4bb9f2ec5':['Sp-4','Sp4'], '20471796-8ac5-49fc-905e-1b0acfbe656b':['Warming spray','warming'],
}
for (const [id,[nom,code]] of Object.entries(DOUZE)) await ins('produits',{id,tenant_id:T,product:nom,code,seller:'Tarik Ouadi'})
const COLON='84183b3e-6a7b-4ad6-abdf-cc7bb6bc7a83', CLEAR='4a0f8428-ba81-478d-8f4f-8fe846b6660f'
const pTest=(await ins('produits',{tenant_id:TT,product:'test'})).id
// Un 13e produit de 9183429e, hors liste : il doit rester sans propriétaire.
const pHors=(await ins('produits',{tenant_id:T,product:'Hors liste',code:'hors'})).id
await replica()
await ins('stocks',{tenant_id:T,produit_id:COLON,entrepot_id:eAO,quantite_disponible:5,quantite_reservee:0,quantite_defectueuse:0})
await ins('stocks',{tenant_id:T,produit_id:COLON,entrepot_id:eCG,quantite_disponible:0,quantite_reservee:0,quantite_defectueuse:0})
await origine()

// ---- 0. sans le compte de Tarik vendeur de 9183429e : arrêt, rien installé
let e=await erreur(()=>db.exec(FICHIER))
check('§1 : Tarik pas vendeur → le fichier s\'arrête', /Arrêt : le compte 00ad0558/.test(e||''), String(e))
check('… et n\'installe rien (pas de colonne vendeur_id)',
  (await q(`select count(*)::int n from information_schema.columns where table_name='produits' and column_name='vendeur_id'`))[0].n===0)

await replica()
for (const [u,t,r] of [[TARIK,T,'seller'],[VB,T,'seller'],[MANAGER,T,'manager'],[ADMIN,T,'admin'],[CEO,T,'ceo'],
                       [AGENT,T,'agent'],[LIVREUR,T,'livreur'],[SUPER,TT,'super_admin'],[VTEST,TT,'seller']])
  await ins('user_roles',{user_id:u,tenant_id:t,role:r})
await ins('user_roles',{user_id:SANSROLE,tenant_id:T,role:null})
await origine()

// ---- AVANT : ce que chaque rôle autre que vendeur peut faire, sur la règle de prod
const NON_VENDEURS={manager:MANAGER, admin:ADMIN, ceo:CEO, agent:AGENT, livreur:LIVREUR, super_admin:SUPER, sans_role:SANSROLE}
const mesure=async()=>{
  const m={}
  for (const [nom,uid] of Object.entries(NON_VENDEURS)) {
    m[nom]={
      lit: (await comme(uid,()=>q(`select id from public.produits order by id`))).map(r=>r.id).join(','),
      modifie: await annule(uid,`update public.produits set price=price where tenant_id=$1 returning id`,[T]),
      supprime: await annule(uid,`delete from public.produits where tenant_id=$1 returning id`,[T]),
      cree: await annule(uid,`insert into public.produits (tenant_id, product) values ($1,'Nouveau') returning id`,[T]),
    }
  }
  return m
}
const avant=await mesure()

// ---- 1. le fichier, deux fois
for (const run of [1,2]) { e=await erreur(()=>db.exec(FICHIER)); check(`fichier, passage ${run}`, e===null, String(e)) }
const proprio=async id=>(await q(`select vendeur_id v from public.produits where id=$1`,[id]))[0]?.v
check('remplissage : les 12 produits → Tarik',
  (await q(`select count(*)::int n from public.produits where id = any($1) and vendeur_id=$2`,[Object.keys(DOUZE),TARIK]))[0].n===12)
check('remplissage : le produit de l\'entreprise de test reste sans propriétaire', await proprio(pTest)===null)
check('remplissage : un produit de 9183429e hors liste reste sans propriétaire', await proprio(pHors)===null)
check('`seller` est gardé (pas supprimé), contenu intact',
  (await q(`select count(*)::int n from public.produits where seller='Tarik Ouadi'`))[0].n===12)
const regle=(await q(`select confdeltype d from pg_constraint where conrelid='public.produits'::regclass and contype='f' and pg_get_constraintdef(oid) like '%vendeur_id%'`))[0]?.d
check('vendeur_id → auth.users ON DELETE SET NULL (comme sources_import / commandes)', regle==='n', String(regle))

// ---- 2. RIEN n'est retiré aux autres rôles : mesuré avant, comparé après
const apres=await mesure()
for (const nom of Object.keys(NON_VENDEURS)) {
  for (const k of ['lit','modifie','supprime','cree']) {
    // La seule différence attendue pour une ligne : « lit » compte le même
    // ensemble de produits (aucun n'a été créé ni supprimé entre-temps).
    check(`${nom} — ${k} : identique avant / après`, JSON.stringify(avant[nom][k])===JSON.stringify(apres[nom][k]),
      `avant=${JSON.stringify(avant[nom][k])} après=${JSON.stringify(apres[nom][k])}`)
  }
}
check('manager lit les 13 produits de 9183429e, sans propriétaire compris', avant.manager.lit.split(',').length===13)
check('agent et livreur lisent tout, sans propriétaire compris', apres.agent.lit.split(',').length===13 && apres.livreur.lit.split(',').length===13)
check('ceo / agent / livreur : aucune écriture, comme avant',
  ['ceo','agent','livreur'].every(n=>apres[n].modifie===0 && apres[n].supprime===0 && String(apres[n].cree).startsWith('ERR:')))
check('super_admin lit les deux entreprises', apres.super_admin.lit.split(',').length===14)

// ---- 3. le vendeur : SES produits seulement
const voit=async uid=>(await comme(uid,()=>q(`select id from public.produits`))).map(r=>r.id)
check('Tarik voit ses 12 produits, ni le hors-liste sans propriétaire', (await voit(TARIK)).length===12 && !(await voit(TARIK)).includes(pHors))
check('le vendeur B ne voit rien', (await voit(VB)).length===0)
check('le vendeur de l\'entreprise de test ne voit pas « test » (sans propriétaire)', (await voit(VTEST)).length===0)
let r=await essai(VB,()=>q(`update public.produits set product='Volé' where id=$1 returning id`,[COLON]))
check('B modifie un produit de Tarik : 0 ligne', r.e===null && r.r.length===0, JSON.stringify(r))
r=await essai(VB,()=>q(`delete from public.produits where id=$1 returning id`,[COLON]))
check('B supprime un produit de Tarik : 0 ligne, le produit est là', r.e===null && r.r.length===0 && await proprio(COLON)===TARIK, JSON.stringify(r))
r=await essai(VB,()=>q(`insert into public.produits (tenant_id, product, code, vendeur_id) values ($1,'Le mien','lemien',$2) returning vendeur_id`,[T,TARIK]))
check('B crée en se faisant passer pour Tarik : le produit est à B', r.e===null && r.r[0].vendeur_id===VB, JSON.stringify(r))
const pB=(await q(`select id from public.produits where code='lemien'`))[0].id
r=await essai(VB,()=>q(`insert into public.produits (product, code) values ('Sans rien','sansrien') returning vendeur_id, tenant_id`))
check('B crée sans rien préciser : à B, dans son entreprise', r.e===null && r.r[0].vendeur_id===VB && r.r[0].tenant_id===T, JSON.stringify(r))
r=await essai(VB,()=>q(`update public.produits set product='Renommé' where id=$1 returning id`,[pB]))
check('B modifie son produit', r.e===null && r.r.length===1, JSON.stringify(r))
r=await essai(VB,()=>q(`update public.produits set vendeur_id=$1 where id=$2`,[TARIK,pB]))
check('B donne son produit à Tarik : refusé, avec la raison', r.e==='Un vendeur ne change pas le propriétaire d\'un produit.', String(r.e))
r=await essai(VB,()=>q(`update public.produits set tenant_id=$1 where id=$2 returning id`,[TT,pB]))
check('B déplace son produit dans une autre entreprise : refusé', r.e!==null || r.r.length===0, JSON.stringify(r))
r=await essai(VB,()=>q(`select vendeur_id from public.produits where id=$1`,[pB]))
check('la colonne vendeur_id est lisible par le vendeur', r.e===null && r.r[0].vendeur_id===VB, JSON.stringify(r))
r=await essai(VB,()=>q(`insert into public.produits (tenant_id, product, code) values ($1,'Copie','COLONTEA ')`,[T]))
check('B prend un code déjà utilisé par Tarik : refusé par idx_produits_code_unique (l\'écran s\'en sert)',
  /idx_produits_code_unique/.test(r.e||''), String(r.e))

// ---- 4. le responsable choisit le vendeur
r=await essai(MANAGER,()=>q(`insert into public.produits (tenant_id, product, code, vendeur_id) values ($1,'Pour B','pourb',$2) returning vendeur_id`,[T,VB]))
check('manager crée pour B : à B', r.e===null && r.r[0].vendeur_id===VB, JSON.stringify(r))
r=await essai(MANAGER,()=>q(`insert into public.produits (tenant_id, product, code, vendeur_id) values ($1,'Pour agent','pa',$2)`,[T,AGENT]))
check('manager donne un produit à un agent : refusé', /doit être un compte vendeur/.test(r.e||''), String(r.e))
r=await essai(MANAGER,()=>q(`insert into public.produits (tenant_id, product, code, vendeur_id) values ($1,'Ailleurs','ai',$2)`,[T,VTEST]))
check('manager donne un produit au vendeur d\'une AUTRE entreprise : refusé', /doit être un compte vendeur/.test(r.e||''), String(r.e))
r=await essai(MANAGER,()=>q(`insert into public.produits (tenant_id, product, code) values ($1,'Sans vendeur','sv') returning vendeur_id`,[T]))
check('manager crée sans vendeur : accepté (comme avant — l\'écran l\'impose, pas la base)', r.e===null && r.r[0].vendeur_id===null, JSON.stringify(r))
r=await essai(ADMIN,()=>q(`update public.produits set vendeur_id=$1 where id=$2 returning vendeur_id`,[VB,CLEAR]))
check('admin passe Clearzal de Tarik à B', r.e===null && r.r[0].vendeur_id===VB, JSON.stringify(r))
check('… Tarik ne le voit plus, B le voit', !(await voit(TARIK)).includes(CLEAR) && (await voit(VB)).includes(CLEAR))
await q(`update public.produits set vendeur_id=$1 where id=$2`,[TARIK,CLEAR])
r=await essai(SUPER,()=>q(`insert into public.produits (tenant_id, product, code, vendeur_id) values ($1,'Du super','dsa',$2) returning vendeur_id`,[T,TARIK]))
check('super_admin crée pour Tarik dans 9183429e', r.e===null && r.r[0].vendeur_id===TARIK, JSON.stringify(r))
e=await erreur(()=>q(`update public.produits set vendeur_id=$1 where id=$2`,[AGENT,COLON]))
check('éditeur SQL : un propriétaire non vendeur est refusé aussi', /doit être un compte vendeur/.test(e||''), String(e))

// ---- 5. les portes
r=await essai(VB,()=>q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[COLON,[]]))
check('rattacher_produit_pays : B sur le produit de Tarik → refusé', r.e==='Ce produit n\'est pas dans votre catalogue', String(r.e))
check('… et les lignes de stock de Tarik sont intactes (2)', (await q(`select count(*)::int n from public.stocks where produit_id=$1`,[COLON]))[0].n===2)
r=await essai(TARIK,()=>q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[COLON,[AO]]))
check('rattacher : Tarik sur le sien → Congo vide retiré, Angola gardé', r.e===null && r.r[0].retires===1, JSON.stringify(r))
r=await essai(MANAGER,()=>q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[COLON,[AO,CG]]))
check('rattacher : manager sur le produit de Tarik → passe (inchangé)', r.e===null && r.r[0].ajoutes===1, JSON.stringify(r))
// 26/10 (produits_rattacher_ecriture.sql, recopié dans ce fichier) : qui
// n'écrit pas les produits ne passe pas ici non plus.
const lignesColon=async()=>JSON.stringify(await q(`select entrepot_id, quantite_disponible from public.stocks where produit_id=$1 order by entrepot_id`,[COLON]))
const avantPorte=await lignesColon()
for (const [nom,uid] of [['ceo',CEO],['agent',AGENT],['livreur',LIVREUR],['sans rôle',SANSROLE]]) {
  r=await essai(uid,()=>q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[COLON,[]]))
  check(`rattacher : ${nom} → refusé`, r.e==='Votre rôle ne permet pas de modifier les produits', String(r.e))
}
check('… et aucune ligne de stock touchée', await lignesColon()===avantPorte)
r=await essai(SUPER,()=>q(`select * from public.rattacher_produit_pays($1, $2::uuid[])`,[COLON,[AO,CG]]))
check('rattacher : super_admin → passe', r.e===null, String(r.e))
r=await essai(VB,()=>q(`select * from public.pays_du_produit($1)`,[COLON]))
check('pays_du_produit : B sur le produit de Tarik → rien', r.e===null && r.r.length===0, JSON.stringify(r))
r=await essai(TARIK,()=>q(`select * from public.pays_du_produit($1)`,[COLON]))
check('pays_du_produit : Tarik → ses 2 pays', r.e===null && r.r.length===2, JSON.stringify(r))
r=await essai(CEO,()=>q(`select * from public.pays_du_produit($1)`,[COLON]))
check('pays_du_produit : ceo → 2 pays (inchangé)', r.e===null && r.r.length===2, JSON.stringify(r))
r=await essai(VB,()=>q(`select * from public.produits_en_stock($1, $2::uuid[])`,[AO,[COLON]]))
check('produits_en_stock : B sur le produit de Tarik (5 en Angola) → rien', r.e===null && r.r.length===0, JSON.stringify(r))
r=await essai(TARIK,()=>q(`select * from public.produits_en_stock($1, $2::uuid[])`,[AO,[COLON]]))
check('produits_en_stock : Tarik → en stock', r.e===null && r.r.length===1, JSON.stringify(r))
r=await essai(MANAGER,()=>q(`select * from public.produits_en_stock($1, $2::uuid[])`,[AO,[COLON]]))
check('produits_en_stock : manager → en stock (inchangé)', r.e===null && r.r.length===1, JSON.stringify(r))
const priv=async(role,f)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[role,f]))[0].x
check('les trois portes : authenticated oui, anon non',
  await priv('authenticated','public.rattacher_produit_pays(uuid,uuid[])') && !(await priv('anon','public.rattacher_produit_pays(uuid,uuid[])')) &&
  await priv('authenticated','public.pays_du_produit(uuid)') && !(await priv('anon','public.pays_du_produit(uuid)')) &&
  await priv('authenticated','public.produits_en_stock(uuid,uuid[])') && !(await priv('anon','public.produits_en_stock(uuid,uuid[])')))
check('les fonctions des triggers et est_vendeur_du_tenant : fermées à authenticated',
  !(await priv('authenticated','public.est_vendeur_du_tenant(uuid,uuid)')) && !(await priv('authenticated','public.produits_proprietaire()')) &&
  !(await priv('authenticated','public.expeditions_produits_du_vendeur()')))

// ---- 6. produit_de_commande reste à l'échelle de l'entreprise
const pc=(await q(`select * from public.produit_de_commande($1,'colontea')`,[T]))[0]
check('produit_de_commande : inchangée, trouve le produit quel que soit son propriétaire', pc.produit_id===COLON && pc.cas==='trouve', JSON.stringify(pc))

// ---- 7. expéditions
const expB=(await comme(VB,()=>q(`insert into public.expeditions (tenant_id, vendeur_id, statut, pays_destination_id) values ($1,$2,'en_attente',$3) returning id`,[T,VB,AO])))[0].id
r=await essai(VB,()=>q(`insert into public.expeditions_produits (tenant_id, expedition_id, produit_id, quantite) values ($1,$2,$3,10)`,[T,expB,COLON]))
check('B met le produit de Tarik dans son expédition : refusé', r.e==='Ce produit n\'est pas dans votre catalogue.', String(r.e))
r=await essai(VB,()=>q(`insert into public.expeditions_produits (tenant_id, expedition_id, produit_id, quantite) values ($1,$2,$3,10) returning id`,[T,expB,pB]))
check('B met son produit : accepté', r.e===null && r.r.length===1, String(r.e))
const ligneB=r.r[0].id
r=await essai(VB,()=>q(`update public.expeditions_produits set produit_id=$1 where id=$2`,[COLON,ligneB]))
check('B change sa ligne pour le produit de Tarik : refusé', r.e==='Ce produit n\'est pas dans votre catalogue.', String(r.e))
r=await essai(VB,()=>q(`update public.expeditions_produits set quantite=12 where id=$1 returning id`,[ligneB]))
check('B change la quantité de sa ligne : accepté', r.e===null && r.r.length===1, String(r.e))
r=await essai(MANAGER,()=>q(`insert into public.expeditions_produits (tenant_id, expedition_id, produit_id, quantite) values ($1,$2,$3,3) returning id`,[T,expB,COLON]))
check('manager met n\'importe quel produit de l\'entreprise : accepté (inchangé)', r.e===null && r.r.length===1, String(r.e))

// ---- 8. un vendeur supprimé : ses produits restent, sans propriétaire
// Comme l'app : le rôle d'abord, puis le compte.
await q(`delete from public.user_roles where user_id=$1`,[VB])
await q(`delete from auth.users where id=$1`,[VB])
check('compte de B supprimé : son produit reste, vendeur_id NULL', await proprio(pB)===null)
check('… invisible à Tarik, visible au manager', !(await voit(TARIK)).includes(pB) && (await voit(MANAGER)).includes(pB))

// ---- 9. rejoué après tout ça : rien ne bouge
const photo=async()=>JSON.stringify(await q(`select id, vendeur_id from public.produits order by id`))
const p1=await photo()
e=await erreur(()=>db.exec(FICHIER))
check('rejoué : passe, aucun propriétaire changé (Clearzal rendu, B supprimé, hors-liste NULL)', e===null && await photo()===p1, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
