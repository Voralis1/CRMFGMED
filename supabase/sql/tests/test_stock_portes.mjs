// stock_portes.sql (11/11, T22) — partie A sur la chaîne des règles de stock (statuts, livraison + paiement,
// vendeur) ; partie B sur la réception d'expédition et la correction de quantité de prod :
//   · AVANT (témoins) : Sortie 5 sur 2 → −3 ; Entrée −5 ; mouvement modifié / supprimé ; stock tapé ;
//     ligne négative effacée ; entrepôt avec historique supprimé ;
//   · après : Sortie > disponible refusée (les unités promises aux confirmées comptent), Sortie OK passe,
//     quantité ≤ 0 refusée, mouvement ni modifié ni supprimé, stock pas tapé, ligne créée à 0 OK, ligne à 0
//     supprimable, négative non, entrepôt avec mouvements non ;
//   · le système passe : livraison (expédiée → sortie, retour), réception, correction de quantité reçue,
//     éditeur SQL ; fichier deux fois ; retour arrière deux fois.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), RET=lire('stock_regles_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T3='33333333-3333-3333-3333-333333333333'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
let db, AO, ENT, LIV, n=0
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type.startsWith('json')?'{}':'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
async function base({renvoi='renvoyer_en_attente.sql', stock='stock_livraison_autre_vendeur.sql', installer=true}={}){
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
    grant all on all sequences in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:r+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,nom:'Livreur',user_id:U.livreur,pays_id:AO,actif:true,zone:'Ailleurs'})).id
  await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:AO,actif:true})
  for (const [nom,code,ferme,decl,rap] of [['Pending','pending',false,false,false],['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
    ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql',renvoi,
                   'commandes_statut_lot.sql','commandes_produit_id.sql',stock,'paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(f.startsWith('tests/')?lire(f):lire(f))
  if (installer) await db.exec(F)
}
const produit=async(code,stock)=>{
  const id=(await ins('produits',{tenant_id:T,product:'Produit '+code,code,price:1})).id
  if (stock!==null) await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',$4,'stock initial')`,[T,id,ENT,stock])
  return id
}
const lead=async(code,qte=1)=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:code,quantite:qte,prix:1,ville_zone:'Luanda',adresse:'rue'})).id
const statut=async id=>(await q(`select statut_confirmation s from public.commandes where id=$1`,[id]))[0].s
const confirmer=id=>q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[id])
const stock=async p=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,ENT]))[0]?.q
const livraison=async id=>{ const l=(await q(`select id from public.livraisons where commande_id=$1`,[id]))[0]; return l? l.id : (await ins('livraisons',{tenant_id:T,commande_id:id,livreur_id:LIV,statut:'a_preparer'})).id }
const livStatut=(l,s)=>sous(null,'service_role',()=>q(`select * from public.enregistrer_livraison($1,$2,null,$3)`,[l,s,s==='livre'?1:null]))


const G=lire('stock_portes.sql'), GR=lire('stock_portes_retour.sql')
const mvt=(uid,p,type,qte,note='test')=>sous(uid,'authenticated',()=>q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,$4,$5,$6) returning id`,[T,p,ENT,type,qte,note]))

// ===== A. témoins, avant le fichier =====
await base()
let PB=await produit('pb',2)
await mvt(U.manager,PB,'sortie',5)
check('AVANT (témoin) : Sortie 5 sur un stock de 2 → acceptée, stock −3', await stock(PB)===-3)
await mvt(U.manager,PB,'entree',-5)
check('AVANT (témoin) : Entrée de −5 → acceptée, le stock baisse encore (−8)', await stock(PB)===-8)
const m0=(await q(`select id from public.mouvements_stock where produit_id=$1 order by created_at limit 1`,[PB]))[0].id
await sous(U.manager,'authenticated',()=>q(`update public.mouvements_stock set quantite=999 where id=$1`,[m0]))
check('AVANT (témoin) : un mouvement passé se modifie (le stock ne suit pas)', (await q(`select quantite from public.mouvements_stock where id=$1`,[m0]))[0].quantite==999 && await stock(PB)===-8)
await sous(U.manager,'authenticated',()=>q(`update public.stocks set quantite_disponible=50 where produit_id=$1`,[PB]))
check('AVANT (témoin) : le stock se tape à la main (50)', await stock(PB)===50)

// ===== A. après =====
await base()
for (const i of [1,2]) { const e=await erreur(()=>db.exec(G)); check(`fichier, passage ${i}`, e===null, e) }
PB=await produit('pb',2)
let e=await erreur(()=>mvt(U.manager,PB,'sortie',5))
check('Sortie 5 sur 2 → refusée, message nommé, stock 2', e?.includes('Sortie refusée : 2 disponible(s) de pb dans l\'entrepôt Angola') && await stock(PB)===2, e)
e=await erreur(()=>mvt(U.manager,PB,'sortie',1)); check('Sortie 1 sur 2 → passe, stock 1', e===null && await stock(PB)===1, e)
const c1=await lead('pb'); await confirmer(c1)
check('une commande confirmée de 1 (promise, pas encore sortie)', await statut(c1)==='Confirmed' && await stock(PB)===1)
e=await erreur(()=>mvt(U.manager,PB,'sortie',1))
check('Sortie de l\'unité promise → refusée (0 disponible)', e?.includes('0 disponible(s)'), e)
for (const [nom,type,qte] of [['Entrée de −5','entree',-5],['Entrée de 0','entree',0],['Sortie de −3','sortie',-3]]) {
  e=await erreur(()=>mvt(U.manager,PB,type,qte)); check(`${nom} → refusée`, e?.includes('plus grande que 0'), e) }
e=await erreur(()=>mvt(U.manager,PB,'entree',3)); check('Entrée 3 → passe, stock 4', e===null && await stock(PB)===4, e)
const mv=(await q(`select id from public.mouvements_stock where produit_id=$1 order by created_at desc limit 1`,[PB]))[0].id
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.mouvements_stock set quantite=999 where id=$1`,[mv])))
check('modifier un mouvement → refusé', e?.includes('l\'historique'), e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`delete from public.mouvements_stock where id=$1`,[mv])))
check('supprimer un mouvement → refusé', e?.includes('l\'historique'), e)
e=await erreur(()=>sous(U.super_admin,'authenticated',()=>q(`delete from public.mouvements_stock where id=$1`,[mv])))
check('… super admin aussi', e?.includes('l\'historique'), e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.stocks set quantite_disponible=50 where produit_id=$1`,[PB])))
check('taper le stock → refusé, stock 4', e?.includes('ne se tape pas') && await stock(PB)===4, e)
const P0=(await ins('produits',{tenant_id:T,product:'Produit vide',code:'pv',price:1})).id
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`insert into public.stocks (tenant_id,produit_id,entrepot_id,quantite_disponible,quantite_reservee,quantite_defectueuse) values ($1,$2,$3,0,0,0)`,[T,P0,ENT])))
check('créer une ligne de stock à 0 (écran Produits) → passe', e===null, e)
const P7=(await ins('produits',{tenant_id:T,product:'P7',code:'p7',price:1})).id
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`insert into public.stocks (tenant_id,produit_id,entrepot_id,quantite_disponible,quantite_reservee,quantite_defectueuse) values ($1,$2,$3,7,0,0)`,[T,P7,ENT])))
check('créer une ligne de stock à 7 → refusé', e?.includes('se crée à 0'), e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`delete from public.stocks where produit_id=$1`,[P0])))
check('supprimer une ligne à 0 → passe', e===null && (await stock(P0))===undefined, e)
await q(`update public.stocks set quantite_disponible=-3 where produit_id=$1`,[PB])   // éditeur SQL : une ligne négative (comme avant)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`delete from public.stocks where produit_id=$1`,[PB])))
check('supprimer une ligne NÉGATIVE → refusé (le −3 ne disparaît pas)', e?.includes('n\'est pas à 0') && await stock(PB)===-3, e)
await q(`update public.stocks set quantite_disponible=4 where produit_id=$1`,[PB])
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`delete from public.entrepots where id=$1`,[ENT])))
check('supprimer un entrepôt avec des mouvements → refusé', e?.includes('il ne se supprime pas'), e)

// le système passe
const la=await livraison(c1)
e=await erreur(()=>livStatut(la,'expedie')); check('livraison : expédiée → la sortie du système passe, stock 3', e===null && await stock(PB)===3, e)
e=await erreur(()=>livStatut(la,'retour')); check('livraison : retour → le stock revient, 4', e===null && await stock(PB)===4, e)
e=await erreur(()=>q(`update public.mouvements_stock set notes='corrigé' where id=$1`,[mv]))
check('éditeur SQL : passe', e===null, e)

for (const i of [1,2]) { e=await erreur(()=>db.exec(GR)); check(`retour arrière, passage ${i}`, e===null, e) }
e=await erreur(()=>mvt(U.manager,PB,'sortie',50)); check('après retour : Sortie 50 de nouveau acceptée (l\'ancien trou)', e===null, e)
e=await erreur(()=>db.exec(G)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
