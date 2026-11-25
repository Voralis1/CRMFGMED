// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production au 26/10 (correctifs 14/10, entrepot_commande.sql — version
// d'avant, lue dans git —, produits_suppression.sql puis
// produits_historique_nom.sql, produits_proprietaire.sql), puis applique
// produits_rattacher_ecriture.sql et stock_livraison_autre_vendeur.sql deux
// fois.
//
// La règle, à la livraison : commande d'un vendeur, produit d'un AUTRE
// vendeur → aucun mouvement, une note. Produit sans vendeur, ou commande sans
// vendeur → comme avant. Le retour n'est pas contrôlé.
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
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
// entrepot_commande.sql (le fichier du disque porte la recopie du 26/10),
// puis la fonction de livraison telle qu'en prod le 26/10 : l'état d'avant.
const ENTREPOT=fs.readFileSync(R+'sql/entrepot_commande.sql','utf8')
await db.exec(ENTREPOT)
await db.exec(fs.readFileSync(R+'sql/tests/fixtures/fn_ajuster_stock_livraison_prod_26_10.sql','utf8'))
await db.exec(`alter table public.commandes add column if not exists articles jsonb`)   // intake_generique.sql, en prod
await db.exec(`create unique index idx_produits_code_unique on public.produits (tenant_id, lower(btrim(code)))
               where code is not null and btrim(code) <> ''`)
await db.exec(fs.readFileSync(R+'sql/tests/fixtures/receptionner_expedition_prod_23_10.sql','utf8'))
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const replica=()=>db.exec(`set session_replication_role = replica`)
const origine=()=>db.exec(`set session_replication_role = origin`)

const T='9183429e-c75c-4ed2-a869-f8bfa011bbc2'
const A='00ad0558-c26d-44fb-aaaf-cdd6172aaf4a'           // Tarik : produits_proprietaire.sql §1 l'exige
const B='bbbbbbbb-0000-0000-0000-000000000002', UL='bbbbbbbb-0000-0000-0000-000000000003'
await replica()
await ins('tenants',{id:T})
await q(`insert into auth.users values ($1,'a@x'),($2,'b@x'),($3,'l@x')`,[A,B,UL])
await ins('user_roles',{user_id:A,tenant_id:T,role:'seller'})
await ins('user_roles',{user_id:B,tenant_id:T,role:'seller'})
await ins('user_roles',{user_id:UL,tenant_id:T,role:'livreur'})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const liv=await ins('livreurs',{tenant_id:T,user_id:UL,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})
await origine()
await db.exec(fs.readFileSync(R+'sql/produits_suppression.sql','utf8'))
await db.exec(fs.readFileSync(R+'sql/produits_historique_nom.sql','utf8'))

// ---- 0. le nouveau fichier refuse de tourner sans produits.vendeur_id
const FICHIER=fs.readFileSync(R+'sql/stock_livraison_autre_vendeur.sql','utf8')
let e=await erreur(()=>db.exec(FICHIER))
check('§1 : sans produits.vendeur_id → arrêt', /Arrêt : produits.vendeur_id absent/.test(e||''), String(e))
check('… rien installé (le corps d\'avant est toujours là)',
  !(await q(`select pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure) d`))[0].d.includes('autre vendeur'))

await db.exec(fs.readFileSync(R+'sql/produits_proprietaire.sql','utf8'))
await db.exec(`grant all on all tables in schema public to authenticated, anon, service_role`)

// ---- 1. les deux fichiers, deux fois
for (const run of [1,2]) {
  e=await erreur(()=>db.exec(fs.readFileSync(R+'sql/produits_rattacher_ecriture.sql','utf8')))
  check(`produits_rattacher_ecriture.sql, passage ${run}`, e===null, String(e))
  e=await erreur(()=>db.exec(FICHIER))
  check(`stock_livraison_autre_vendeur.sql, passage ${run}`, e===null, String(e))
}

const produit=async(nom,code,vendeur)=>{
  const id=(await ins('produits',{tenant_id:T,product:nom,code,vendeur_id:vendeur})).id
  await replica(); await ins('stocks',{tenant_id:T,produit_id:id,entrepot_id:eAO,quantite_disponible:10,quantite_reservee:0,quantite_defectueuse:0}); await origine()
  return id
}
const pA=await produit('Colon Tea','colontea',A)
const pB=await produit('Shilajit','shilajit',B)
const pX=await produit('Ancien','ancien',null)
let n=0
const commande=async(produit,vendeur)=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit,quantite:2,prix:10,vendeur_id:vendeur})
const livrer=async(c)=>{ const l=await ins('livraisons',{tenant_id:T,commande_id:c.id,livreur_id:liv.id,statut:'a_preparer'}); await q(`update public.livraisons set statut='livre' where id=$1`,[l.id]); return l }
const stock=async p=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,eAO]))[0]?.q
const lire=async id=>(await q(`select stock_note, stock_ajuste from public.commandes where id=$1`,[id]))[0]
const mvts=async id=>(await q(`select type_mouvement t, quantite q from public.mouvements_stock where notes like '%'||$1`,[id]))

// ---- 2. la règle
let c=await commande('colontea',A); await livrer(c)
check('A vend le produit de A : sortie, -2', await stock(pA)===8 && (await lire(c.id)).stock_ajuste!==null && (await lire(c.id)).stock_note===null)

c=await commande('shilajit',A); let lv=await livrer(c); let l=await lire(c.id)
check('A vend le produit de B : AUCUN mouvement, stock de B intact', await stock(pB)===10 && (await mvts(c.id)).length===0, String(await stock(pB)))
check('… stock_ajuste reste vide (rien n\'a été compté)', l.stock_ajuste===null)
check('… la note dit pourquoi, sans nommer l\'autre vendeur',
  l.stock_note==="Le produit « shilajit » est celui d'un autre vendeur : aucun mouvement de stock. Corrigez le produit ou le vendeur de la commande.", l.stock_note)
await q(`update public.livraisons set statut='retour' where id=$1`,[lv.id])
check('… dé-livrée : rien à rendre, rien ne bouge', await stock(pB)===10 && (await mvts(c.id)).length===0)
// Corrigée au bureau : le bon vendeur, puis relivrée.
await q(`update public.commandes set vendeur_id=$1, stock_note=null where id=$2`,[B,c.id])
await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
check('… corrigée (vendeur B) puis relivrée : sort du stock de B', await stock(pB)===8 && (await lire(c.id)).stock_ajuste!==null)

c=await commande('ancien',A); await livrer(c)
check('produit SANS vendeur (hérité) : comme avant, sortie', await stock(pX)===8 && (await lire(c.id)).stock_note===null)

c=await commande('colontea',null); await livrer(c)
check('commande SANS vendeur, produit de A : comme avant, sortie', await stock(pA)===6)

c=await commande('inconnu',A); await livrer(c)
check('produit inconnu : comme avant (note « introuvable », aucun mouvement)', /introuvable au catalogue/.test((await lire(c.id)).stock_note||'') && (await mvts(c.id)).length===0)

// Le retour n'est pas contrôlé : ce qui est sorti revient au même produit,
// même si son vendeur a changé entre-temps.
c=await commande('colontea',A); lv=await livrer(c)
check('A vend le sien : sortie (6 → 4)', await stock(pA)===4)
await q(`update public.produits set vendeur_id=$1 where id=$2`,[B,pA])
await q(`update public.livraisons set statut='retour' where id=$1`,[lv.id])
check('… produit passé à B, puis retour : la marchandise revient (4 → 6)', await stock(pA)===6 && (await lire(c.id)).stock_ajuste===null, String(await stock(pA)))
await q(`update public.produits set vendeur_id=$1 where id=$2`,[A,pA])

// Insertion directe en « livré » (même trigger, branche INSERT)
c=await commande('shilajit',A)
await ins('livraisons',{tenant_id:T,commande_id:c.id,livreur_id:liv.id,statut:'livre'})
check('livraison créée directement « livré », produit de B : aucun mouvement, note', (await mvts(c.id)).length===0 && /autre vendeur/.test((await lire(c.id)).stock_note||''))

// ---- 3. relancer les fichiers déjà appliqués ne remet pas l'ancienne règle
e=await erreur(()=>db.exec(ENTREPOT))
check('entrepot_commande.sql relancé : passe', e===null, String(e))
c=await commande('shilajit',A); await livrer(c)
check('… le contrôle du vendeur est toujours là (corps recopié)', (await mvts(c.id)).length===0 && /autre vendeur/.test((await lire(c.id)).stock_note||''))
e=await erreur(()=>db.exec(fs.readFileSync(R+'sql/produits_proprietaire.sql','utf8')))
check('produits_proprietaire.sql relancé : passe', e===null, String(e))
check('… rattacher_produit_pays reste fermée aux rôles qui n\'écrivent pas',
  (await q(`select pg_get_functiondef('public.rattacher_produit_pays(uuid,uuid[])'::regprocedure) d`))[0].d.includes('Votre rôle ne permet pas'))

// ---- 3 bis. 03/11 : la note quand la ligne existe mais ne suffit pas (option A)
const produitStock=async(nom,code,qte)=>{
  const id=(await ins('produits',{tenant_id:T,product:nom,code,vendeur_id:A})).id
  if(qte!==null){ await replica(); await ins('stocks',{tenant_id:T,produit_id:id,entrepot_id:eAO,quantite_disponible:qte,quantite_reservee:0,quantite_defectueuse:0}); await origine() }
  return id
}
const commandeQ=async(produit,quantite)=>ins('commandes',{lead_id:'Q'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit,quantite,prix:10,vendeur_id:A})
const RETOUR=fs.readFileSync(R+'sql/stock_livraison_autre_vendeur_retour.sql','utf8')
// témoin : le corps du 03/11 (retour arrière), une ligne à 0 passe à -1 sans note
e=await erreur(()=>db.exec(RETOUR)); check('retour arrière : passe (corps du 03/11, md5 vérifié)', e===null, String(e))
let pz=await produitStock('Zero avant','zero-avant',0); c=await commandeQ('zero-avant',1); await livrer(c)
check('AVANT (témoin) : ligne à 0, livré 1 → -1 et AUCUNE note', await stock(pz)===-1 && (await lire(c.id)).stock_note===null, String((await lire(c.id)).stock_note))
e=await erreur(()=>db.exec(FICHIER)); check('fichier relancé après le retour : passe', e===null, String(e))
pz=await produitStock('Zero','zero',0); c=await commandeQ('zero',1); await livrer(c)
check('ligne à 0, livré 1 → -1, note avec les chiffres', await stock(pz)===-1 &&
  (await lire(c.id)).stock_note==="Livré avec un stock insuffisant dans l'entrepôt Angola : 0 disponible(s) pour 1 livré(s), son stock y est maintenant à -1. Déclarez l'entrée de la marchandise.", (await lire(c.id)).stock_note)
check('… la sortie a bien eu lieu (stock_ajuste, un mouvement de 1)', (await lire(c.id)).stock_ajuste!==null && JSON.stringify(await mvts(c.id))==='[{"t":"sortie","q":1}]')
let pc=await produitStock('Court','court',1); c=await commandeQ('court',2); lv=await livrer(c)
check('ligne à 1, livré 2 → -1, note « 1 disponible(s) pour 2 »', await stock(pc)===-1 && /: 1 disponible\(s\) pour 2 livré\(s\), son stock y est maintenant à -1\./.test((await lire(c.id)).stock_note||''), (await lire(c.id)).stock_note)
await q(`update public.livraisons set statut='retour' where id=$1`,[lv.id])
check('… dé-livrée : la marchandise revient (→ 1), la note s\'efface', await stock(pc)===1 && (await lire(c.id)).stock_note===null)
let pj=await produitStock('Juste','juste',2); c=await commandeQ('juste',2); await livrer(c)
check('ligne à 2, livré 2 → 0, PAS de note (le stock suffisait)', await stock(pj)===0 && (await lire(c.id)).stock_note===null)
c=await commandeQ('juste',1); await livrer(c)
check('ligne déjà à 0 ensuite, livré 1 → -1, note', await stock(pj)===-1 && /0 disponible\(s\) pour 1 livré\(s\)/.test((await lire(c.id)).stock_note||''))
c=await commandeQ('juste',3); await livrer(c)
check('ligne NÉGATIVE (-1), livré 3 → -4, note « -1 disponible(s) … à -4 »', await stock(pj)===-4 && /: -1 disponible\(s\) pour 3 livré\(s\), son stock y est maintenant à -4\./.test((await lire(c.id)).stock_note||''), (await lire(c.id)).stock_note)
let pn=await produitStock('Sans ligne','sans-ligne',null); c=await commandeQ('sans-ligne',1); await livrer(c)
check('ligne ABSENTE : l\'ancienne note, inchangée', /Livré sans stock déclaré dans l'entrepôt Angola : son stock y est passé en négatif/.test((await lire(c.id)).stock_note||'') && await stock(pn)===-1)
c=await commandeQ('shilajit',2); await livrer(c)
check('produit d\'un autre vendeur : toujours aucun mouvement, la note du vendeur (pas celle du stock)', (await mvts(c.id)).length===0 && /autre vendeur/.test((await lire(c.id)).stock_note||''))
c=await commandeQ('inconnu-xyz',1); await livrer(c)
check('produit inconnu : toujours « introuvable », aucun mouvement', /introuvable/.test((await lire(c.id)).stock_note||'') && (await mvts(c.id)).length===0)
e=await erreur(()=>db.exec(ENTREPOT)); 
c=await commandeQ('zero',1); await livrer(c)
check('entrepot_commande.sql relancé : la note « stock insuffisant » reste (sa copie est gardée)', e===null && /stock insuffisant/.test((await lire(c.id)).stock_note||''), String(e))
for(const i of [1,2]){ e=await erreur(()=>db.exec(RETOUR)); check(`retour arrière (${i}) : passe`, e===null, String(e)) }
check('… le corps est celui du 03/11 (md5)', (await q(`select md5(prosrc) m from pg_proc where oid='public.fn_ajuster_stock_livraison()'::regprocedure`))[0].m==='8226f286b1d0731294abcabb6cbc7ce4')
e=await erreur(()=>db.exec(FICHIER)); check('réinstallation après retour : passe', e===null, String(e))

// ---- 4. entrepot_commande.sql sur une base SANS produits.vendeur_id : la
// livraison marche comme avant (to_jsonb lit NULL, pas d'erreur de colonne).
const db2=new PGlite()
await db2.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;`)
await db2.exec(schema)
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql']) await db2.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
await db2.exec(ENTREPOT)
const q2=async(sql,p)=>(await db2.query(sql,p)).rows
// Même aide que `ins`, sur la seconde base.
const ins2=async(t,vals)=>{
  const c=await q2(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); return (await q2(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
check('base sans vendeur_id : la colonne n\'existe pas', (await q2(`select count(*)::int n from information_schema.columns where table_name='produits' and column_name='vendeur_id'`))[0].n===0)
await db2.exec(`set session_replication_role = replica`)
await ins2('tenants',{id:T})
await q2(`insert into auth.users values ($1,'a@x'),($2,'l@x')`,[A,UL])
const pays2=(await ins2('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const ent2=(await ins2('entrepots',{tenant_id:T,nom:'Angola',pays_id:pays2,actif:true})).id
const liv2=(await ins2('livreurs',{tenant_id:T,user_id:UL,pays_id:pays2,actif:true,nom:'L',zone:'Luanda'})).id
await db2.exec(`set session_replication_role = origin`)
const prod2=(await ins2('produits',{tenant_id:T,product:'Colon Tea',code:'colontea'})).id
const cmd2=(await ins2('commandes',{lead_id:'X1',tenant_id:T,pays_id:pays2,client_nom:'C',client_telephone:'+2449',produit:'colontea',quantite:1,prix:10,vendeur_id:A})).id
e=await (async()=>{ try { await ins2('livraisons',{tenant_id:T,commande_id:cmd2,livreur_id:liv2,statut:'livre'}); return null } catch(x){ return x.message } })()
const st2=(await q2(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[prod2,ent2]))[0]?.q
check('… une livraison passe et sort le stock (-1), sans erreur de colonne', e===null && st2===-1, `${e} / ${st2}`)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
