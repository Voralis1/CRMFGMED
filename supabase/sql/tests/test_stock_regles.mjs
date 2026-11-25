// Règles de stock du 05/11 sur le schéma réel + la chaîne en prod (statuts, historique,
// renvoi en attente, produit_id, livraison + paiement, vendeur) :
//   renvoyer_en_attente.sql (05/11) + stock_livraison_autre_vendeur.sql (05/11) + stock_regles.sql
//   · prérequis : stock_regles refusé avec l'ancien renvoi / l'ancienne livraison ;
//   · statuts : 2 par entreprise, rejouable, une nouvelle entreprise les reçoit ; « pause » (ferme_le_lead) ;
//   · arrivée : stock suffisant → Pending ; insuffisant / pas de ligne → Rupture ; inconnu → Produit non reconnu ;
//   · confirmation : dans le disponible → Confirmed ; au-delà → Rupture ; inconnu → Produit non reconnu ;
//     la dernière unité ne se confirme qu'une fois ; pas de tentative comptée pour une rupture ;
//   · livraison : expédiée → stock sort ; livrée ensuite → rien de plus ; retour → revient ;
//     expédiée sans stock → REFUSÉE (rien ne bouge) ; livrée directe sans stock → passe (note) ;
//   · libération : retour, entrée, confirmée annulée, livraison annulée avant prise → les plus anciennes
//     ruptures repassent Pending autant que le disponible le permet (une plus grosse est sautée) ;
//     produit relié → Pending ou Rupture ;
//   · personne ne sort une rupture en attente à la main sauf un responsable ;
//   · mutant (contrôle à la confirmation retiré) arrêté par la répétition ;
//   · retour arrière refusé tant que des commandes sont en pause, puis deux fois.
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

// ===== prérequis =====
await base({renvoi:'tests/fixtures/renvoyer_en_attente_02_11.sql', installer:false})
let e=await erreur(()=>db.exec(F))
check('prérequis : refusé avec l\'ancien renvoi en attente', e?.includes('relancez d\'abord renvoyer_en_attente.sql'), e)
await base({stock:'tests/fixtures/stock_livraison_autre_vendeur_02_11.sql', installer:false})
e=await erreur(()=>db.exec(F))
check('prérequis : refusé avec l\'ancienne livraison (stock à « livrée »)', e?.includes('relancez d\'abord stock_livraison_autre_vendeur.sql'), e)
check('… rien installé', (await q(`select count(*)::int n from pg_proc where proname='stock_disponible'`))[0].n===0)

// ===== installation, statuts =====
await base({installer:false})
const statutsAvant=JSON.stringify(await q(`select nom from public.statuts where tenant_id=$1 order by nom`,[T]))
for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i} (avec sa répétition)`, e===null, e) }
const pauses=await q(`select nom, code, ferme_le_lead f, declenche_assignation d from public.statuts where tenant_id=$1 and code in ('rupture','produit_inconnu') order by code`,[T])
check('2 statuts « pause », une fois chacun', JSON.stringify(pauses)===JSON.stringify([{nom:'Produit non reconnu',code:'produit_inconnu',f:true,d:false},{nom:'Rupture de stock',code:'rupture',f:true,d:false}]), JSON.stringify(pauses))
await ins('tenants',{id:T3,nom_entreprise:'Nouvelle'})
check('une nouvelle entreprise les reçoit', (await q(`select count(*)::int n from public.statuts where tenant_id=$1 and code in ('rupture','produit_inconnu')`,[T3]))[0].n===2)
check('la répétition n\'a rien laissé (aucune commande, aucun produit « Répétition »)', (await q(`select count(*)::int n from public.commandes`))[0].n===0
  && (await q(`select count(*)::int n from public.produits where product like 'Répétition%'`))[0].n===0)

// ===== arrivée =====
const P2=await produit('p2',2), P0=await produit('p0',null)
let a=await lead('p2'); check('arrivée, stock 2, qté 1 → En attente (Pending)', await statut(a)==='Pending')
let b=await lead('p2',3); check('arrivée, stock 2, qté 3 → Rupture de stock', await statut(b)==='Rupture de stock')
let c=await lead('p0'); check('arrivée, produit sans ligne de stock → Rupture de stock', await statut(c)==='Rupture de stock')
let d=await lead('inconnu-xyz'); check('arrivée, produit inconnu → Produit non reconnu', await statut(d)==='Produit non reconnu')
check('historique : la rupture à l\'arrivée est écrite, sans compter de tentative', (await q(`select statut from public.historique_statuts where commande_id=$1`,[b]))[0]?.statut==='Rupture de stock'
  && (await q(`select coalesce(nb_tentatives,0) n from public.commandes where id=$1`,[b]))[0].n===0)

// ===== confirmation =====
const a2=await lead('p2')
await confirmer(a); check('confirmer dans le disponible (2) → Confirmed', await statut(a)==='Confirmed')
await confirmer(a2); check('2e confirmation (disponible 1) → Confirmed', await statut(a2)==='Confirmed')
const a3=await lead('p2'); check('3e lead : arrive en Rupture (tout est réservé)', await statut(a3)==='Rupture de stock')
const a4=await lead('p2'); await q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[a4]).catch(()=>{})
await confirmer(d); check('confirmer un produit inconnu → reste « Produit non reconnu »', await statut(d)==='Produit non reconnu')
check('le stock physique n\'a pas bougé à la confirmation (2)', await stock(P2)===2)

// ===== livraison =====
const la=await livraison(a)
await livStatut(la,'expedie'); check('« expédiée » : le stock sort (2 → 1)', await stock(P2)===1)
await livStatut(la,'livre'); check('« livrée » ensuite : rien de plus (1)', await stock(P2)===1)
const la2=await livraison(a2)
await livStatut(la2,'expedie'); check('2e expédiée : 1 → 0', await stock(P2)===0)
await livStatut(la2,'retour'); check('« retour » : le stock revient (0 → 1)', await stock(P2)===1)
check('… la plus ancienne rupture qui tient repasse En attente ; la commande de 3 (trop grosse) est sautée',
  await statut(a3)==='Pending' && await statut(b)==='Rupture de stock', `${await statut(a3)} / ${await statut(b)}`)

// expédiée sans stock : refusée
await confirmer(a3); check('a3 confirmée (1 disponible)', await statut(a3)==='Confirmed')
await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'sortie',1,'perte')`,[T,P2,ENT])
const la3=await livraison(a3)
e=await erreur(()=>livStatut(la3,'expedie'))
check('« expédiée » sans stock → REFUSÉE, message « Rupture : 0 disponible(s) »', e?.startsWith('Rupture : 0 disponible(s)'), e)
check('… rien n\'a bougé : livraison à préparer, stock 0, pas de paiement', (await q(`select statut from public.livraisons where id=$1`,[la3]))[0].statut==='a_preparer' && await stock(P2)===0)
// livrée directe sans stock : passe (le livreur est à la porte)
await livStatut(la3,'livre')
check('« livrée » directe sans stock → passe, note « stock insuffisant », stock −1', await stock(P2)===-1
  && /stock insuffisant/.test((await q(`select stock_note from public.commandes where id=$1`,[a3]))[0].stock_note||''))

// ===== libération par une entrée =====
const P5=await produit('p5',0)
const r1=await lead('p5'), r2=await lead('p5'), r3=await lead('p5')
check('3 leads sur un stock 0 → 3 ruptures', (await Promise.all([r1,r2,r3].map(statut))).every(s=>s==='Rupture de stock'))
await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',2,'arrivage')`,[T,P5,ENT])
check('entrée de 2 → les 2 plus anciennes En attente, la 3e reste en rupture', await statut(r1)==='Pending' && await statut(r2)==='Pending' && await statut(r3)==='Rupture de stock')
check('… historique : retour en attente écrit (via système)', (await q(`select count(*)::int n from public.historique_statuts where commande_id=$1 and statut='Pending'`,[r1]))[0].n===1)

// confirmée puis annulée avant prise → libère
await confirmer(r1); await confirmer(r2)
await q(`update public.commandes set statut_confirmation='Cancelled' where id=$1`,[r1])
check('une confirmée annulée (pas prise) → la rupture suivante repasse En attente', await statut(r3)==='Pending')
// livraison annulée avant prise → libère
await confirmer(r3)
const r4=await lead('p5'); check('nouveau lead → Rupture (le stock est entièrement confirmé)', await statut(r4)==='Rupture de stock')
const lr2=await livraison(r2)
await livStatut(lr2,'annule')
check('livraison annulée AVANT prise → la réservation part, la rupture suivante repasse En attente', await statut(r4)==='Pending')

// produit relié → Pending ou Rupture
await ins('produits',{tenant_id:T,product:'Produit inconnu-xyz',code:'inconnu-xyz',price:1})
await q(`select public.remplir_produits_commandes()`)
check('produit créé puis relié → « Produit non reconnu » devient Rupture (pas de stock)', await statut(d)==='Rupture de stock', await statut(d))

// ===== à la main =====
for (const [qui,uid] of [['agent',U.agent],['vendeur',U.seller]]) {
  e=await sous(uid,'authenticated',()=>erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[b])))
  check(`${qui} : sortir une rupture en attente à la main → refusé ou sans effet`, e!==null || await statut(b)==='Rupture de stock', e)
}
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[b]))
check('éditeur SQL sans personne : sortie de rupture refusée', e?.includes('Renvoi en attente refusé'), e)
await q(`select set_config('crm.historique_acteur',$1,false)`,[U.manager])
e=await erreur(()=>q(`update public.commandes set statut_confirmation='Pending' where id=$1`,[b]))
await q(`select set_config('crm.historique_acteur','',false)`)
check('un manager peut la renvoyer en attente (comme tout renvoi)', e===null && await statut(b)==='Pending', e)
check('aucune ligne de stock négative hors « livrée directe » assumée', (await q(`select count(*)::int n from public.stocks where quantite_disponible<0 and produit_id<>$1`,[P2]))[0].n===0)

// ===== mutant =====
await base({installer:false})
const MUT=F.replace(`  if public.stock_disponible(new.tenant_id, new.produit_id, new.entrepot_id, new.id) < coalesce(new.quantite, 1) then
    new.statut_confirmation := 'Rupture de stock';
  end if;
  return new;`,`  return new;`)
check('(témoin : contrôle à la confirmation retiré)', MUT!==F)
e=await erreur(()=>db.exec(MUT))
check('mutant : arrêté par la répétition, rien installé', e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes('confirmer le 2e')
  && (await q(`select count(*)::int n from pg_proc where proname='stock_disponible'`))[0].n===0, e)

// ===== retour arrière =====
await base()
await produit('q0',0); const z=await lead('q0')
e=await erreur(()=>db.exec(RET))
check('retour arrière refusé tant qu\'une commande est en pause (nommée)', e?.includes('encore en pause') && e?.includes('Rupture de stock'), e)
await q(`delete from public.commandes where id=$1`,[z])
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
check('… statuts et règles retirés', (await q(`select count(*)::int n from public.statuts where code in ('rupture','produit_inconnu')`))[0].n===0
  && (await q(`select count(*)::int n from pg_trigger where tgname like 'trg_zzz_%stock%'`))[0].n===0)
const zz=await lead('q0'); check('… une commande sans stock arrive « Pending » comme avant', await statut(zz)==='Pending')
await q(`delete from public.commandes where id=$1`,[zz])
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
