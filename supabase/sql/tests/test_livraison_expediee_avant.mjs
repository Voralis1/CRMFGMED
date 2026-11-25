// « Livrée » seulement après « Expédiée » (livraison_expediee_avant.sql, 05/11) sur la chaîne réelle
// (règles de stock 05/11 + livraison atomique + paiement unique) :
//   · prérequis : refusé sans stock_regles.sql ; fichier deux fois ;
//   · à préparer → livrée : REFUSÉ par enregistrer_livraison (service role), par un manager en direct,
//     par l'éditeur SQL ; rien ne bouge (stock, paiement, commande) ;
//   · création directement « livre » refusée ;
//   · à préparer → expédiée → livrée : passe, stock sorti une fois, un paiement ;
//   · retour / annulé inchangés ; un trigger appelé par un compte (fonction fermée) marche ;
//   · mutant (règle qui laisse passer à_préparer → livre) arrêté par la répétition, rien installé ;
//   · livraison_atomique.sql rejoué avec la règle en place : passe ; retour arrière deux fois ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('livraison_expediee_avant.sql'), GRET=lire('livraison_expediee_avant_retour.sql')
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
await base({installer:false})
let e=await erreur(()=>db.exec(G))
check('prérequis : refusé sans stock_regles.sql', e?.includes('lancez d\'abord stock_regles.sql'), e)
check('… rien installé', (await q(`select count(*)::int n from pg_proc where proname='livraison_saut_livre'`))[0].n===0)

// ===== installation =====
await base()
for (const i of [1,2]) { e=await erreur(()=>db.exec(G)); check(`fichier, passage ${i} (avec sa répétition)`, e===null, e) }
const P=await produit('pa',3)
const paiements=async id=>(await q(`select count(*)::int n from public.paiements where commande_id=$1`,[id]))[0].n
const livSt=async l=>(await q(`select statut from public.livraisons where id=$1`,[l]))[0].statut
const cmdLiv=async id=>(await q(`select statut_livraison s from public.commandes where id=$1`,[id]))[0].s

// à préparer → livrée, par la fonction (chemin du livreur)
let a=await lead('pa'); await confirmer(a); let la=await livraison(a)
e=await erreur(()=>livStatut(la,'livre'))
check('à préparer → « Livré » (enregistrer_livraison) : REFUSÉ', e?.includes('Mettez d\'abord la livraison en « Expédiée »'), e)
check('… rien ne bouge : livraison à préparer, stock 3, aucun paiement, commande pas livrée',
  await livSt(la)==='a_preparer' && await stock(P)===3 && await paiements(a)===0 && await cmdLiv(a)!=='livre')

// par un manager, en direct depuis le navigateur
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.livraisons set statut='livre' where id=$1`,[la])))
check('manager, mise à jour directe à préparer → livre : REFUSÉ (pas « permission denied »)', e?.includes('Mettez d\'abord') , e)

// éditeur SQL
e=await erreur(()=>q(`update public.livraisons set statut='livre' where id=$1`,[la]))
check('éditeur SQL : REFUSÉ aussi', e?.includes('Mettez d\'abord'), e)

// création directement livrée
let b=await lead('pa'); await confirmer(b)
await q(`delete from public.livraisons where commande_id=$1`,[b])
e=await erreur(()=>ins('livraisons',{tenant_id:T,commande_id:b,livreur_id:LIV,statut:'livre'}))
check('création d\'une livraison directement « livre » : REFUSÉE', e?.includes('Mettez d\'abord'), e)

// le bon chemin
await livStatut(la,'expedie'); check('à préparer → expédiée : passe, stock 3 → 2', await livSt(la)==='expedie' && await stock(P)===2)
await livStatut(la,'livre')
check('expédiée → livrée : passe, stock reste 2, un paiement, commande livrée', await livSt(la)==='livre' && await stock(P)===2 && await paiements(a)===1 && await cmdLiv(a)==='livre')

// un compte (manager) sur le bon chemin : le trigger (fonction fermée aux comptes) ne casse rien
let lb=await livraison(b)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.livraisons set statut='expedie' where id=$1`,[lb])))
check('manager, à préparer → expédiée en direct : passe (pas de « permission denied »)', e===null && await livSt(lb)==='expedie', e)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`update public.livraisons set statut='livre' where id=$1`,[lb])))
check('manager, expédiée → livrée en direct : passe', e===null && await livSt(lb)==='livre', e)

// retour / annulé inchangés
let c=await lead('pa'); await confirmer(c); let lc=await livraison(c)
e=await erreur(()=>livStatut(lc,'annule')); check('à préparer → annulé : passe', e===null && await livSt(lc)==='annule', e)
let d=await lead('pa'); await confirmer(d); let ld=await livraison(d)
await livStatut(ld,'expedie'); const s1=await stock(P)
e=await erreur(()=>livStatut(ld,'retour')); check('expédiée → retour : passe, le stock revient', e===null && await livSt(ld)==='retour' && await stock(P)===s1+1, e)
e=await erreur(()=>q(`update public.livraisons set statut='livre' where id=$1`,[ld]))
check('retour → livre : REFUSÉ', e!==null, e)

// livraison_atomique.sql rejoué avec la règle en place (sa répétition prend une livraison expédiée)
let f=await lead('pa'); await confirmer(f); let lf=await livraison(f); await livStatut(lf,'expedie')
e=await erreur(()=>db.exec(lire('livraison_atomique.sql')))
check('livraison_atomique.sql rejoué avec la règle : passe', e===null, e)
check('… sa répétition n\'a rien laissé (livraison toujours expédiée, aucun paiement)', await livSt(lf)==='expedie' && await paiements(f)===0)

// ===== mutant =====
await base()
const M=G.replace(`coalesce(p_ancien, '') not in ('expedie', 'livre')`, `coalesce(p_ancien, '') not in ('expedie', 'livre', 'a_preparer')`)
check('mutant bien fabriqué', M!==G)
e=await erreur(()=>db.exec(M))
check('mutant (à préparer → livre accepté) arrêté par la répétition', e?.includes('la règle se trompe pour a_preparer → livre'), e)
check('… rien installé', (await q(`select count(*)::int n from pg_trigger where tgname='trg_aa_livraison_expediee_avant'`))[0].n===0)

// ===== retour arrière =====
await db.exec(G)
for (const i of [1,2]) { e=await erreur(()=>db.exec(GRET)); check(`retour arrière, passage ${i}`, e===null, e) }
const P2=await produit('pb',2)
let g=await lead('pb'); await confirmer(g); let lg=await livraison(g)
e=await erreur(()=>livStatut(lg,'livre'))
check('après retour arrière : « livré » direct de nouveau possible (stock sort à livrée)', e===null && await livSt(lg)==='livre' && await stock(P2)===1, e)
e=await erreur(()=>db.exec(G)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
