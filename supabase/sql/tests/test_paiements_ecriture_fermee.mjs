// paiements_ecriture_fermee.sql (13/11, revue de sécurité / T5) — témoins (le livreur met son paiement à 0
// « remis », le CEO en modifie un) ; après : 7 rôles ne modifient / créent / suppriment plus, la lecture reste,
// la livraison (enregistrer_livraison), « Encaisser » et « Remettre » (clé service) passent ; fichier deux fois
// (répétition comprise), retour arrière deux fois, fichier après.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
const S=lire('paiements_ecriture_fermee.sql'), SR=lire('paiements_ecriture_fermee_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='22222222-2222-2222-2222-222222222222'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const SELLER2='aaaaaaaa-0000-0000-0000-000000000011', MGR2='aaaaaaaa-0000-0000-0000-000000000012'
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
    grant all on all sequences in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'})
  await ins('tenants',{id:T2,nom_entreprise:'Autre'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:r+'@x'})
  }
  for (const [r,u] of [['seller',SELLER2]]) { await q(`insert into auth.users values ($1,'seller2@x')`,[u]); await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:'seller2@x'}) }
  await q(`insert into auth.users values ($1,'mgr2@x')`,[MGR2]); await ins('user_roles',{user_id:MGR2,tenant_id:T2,role:'manager',email:'mgr2@x'})
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,nom:'Livreur Joao',user_id:U.livreur,pays_id:AO,actif:true,zone:'Ailleurs'})).id
  await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:AO,actif:true})
  for (const [nom,code,ferme,decl,rap] of [['Pending','pending',false,false,false],['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
    ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql',
                   'commandes_statut_lot.sql','commandes_produit_id.sql','stock_livraison_autre_vendeur.sql','paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(lire(f))
  await db.exec(F); await db.exec(G)
  // la politique de prod, lue le 12/11
  await db.exec(`drop policy if exists commandes_delete on public.commandes;
    create policy commandes_delete on public.commandes for delete to authenticated
      using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id()) and (public.mon_role() = any (array['admin','ceo','manager']))));`)
}
const produit=async(code,stock)=>{
  const id=(await ins('produits',{tenant_id:T,product:'Produit '+code,code,price:1})).id
  if (stock) await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',$4,'stock initial')`,[T,id,ENT,stock])
  return id
}
const lead=async(code,vendeur=U.seller,qte=1)=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:code,quantite:qte,prix:1,ville_zone:'Luanda',adresse:'rue',vendeur_id:vendeur})).id
const statut=async id=>(await q(`select statut_confirmation s from public.commandes where id=$1`,[id]))[0]?.s
const existe=async id=>(await q(`select 1 from public.commandes where id=$1`,[id])).length===1
const confirmer=id=>q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[id])
const stock=async p=>(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,ENT]))[0]?.q
const livraison=async id=>{ const l=(await q(`select id from public.livraisons where commande_id=$1`,[id]))[0]; return l? l.id : (await ins('livraisons',{tenant_id:T,commande_id:id,livreur_id:LIV,statut:'a_preparer'})).id }
const livStatut=(l,s)=>sous(null,'service_role',()=>q(`select * from public.enregistrer_livraison($1,$2,null,$3)`,[l,s,s==='livre'?1:null]))
const supprimer=(uid,ids,raison='test',tenant=T)=>sous(uid,'authenticated',()=>q(`select * from public.supprimer_commandes($1,$2::uuid[],$3)`,[tenant,ids,raison]))
const possible=async(uid,id)=>(await sous(uid,'authenticated',()=>q(`select * from public.suppression_commande_possible($1)`,[id])))[0]
const tenter=id=>db.exec(`select set_config('crm.suivi_recalcul','oui',false); update public.commandes set nb_tentatives=1 where id='${id}'; select set_config('crm.suivi_recalcul','',false);`)
const roles=async code=>(await q(`select string_agg(r.nom, ',' order by r.nom) s from public.role_permissions rp join public.roles r on r.id=rp.role_id where rp.permission_code=$1`,[code]))[0].s


// la règle de prod lue le 13/11 (le schéma de départ des tests n'a pas forcément la même)
const REGLES_PROD=lire('paiements_ecriture_fermee_retour.sql')
const ecrire=(uid,sql,p=[])=>erreur(()=>sous(uid,'authenticated',()=>q(sql,p)))
const montant=async id=>Number((await q(`select montant from public.paiements where id=$1`,[id]))[0].montant)
const unPaiement=async()=>{ const PA=await produit('p'+(++n),5); const c=await lead('p'+n); await confirmer(c); const l=await livraison(c); await livStatut(l,'expedie')
  await livStatut(l,'livre'); return (await q(`select id from public.paiements where commande_id=$1`,[c]))[0].id }

// ===== témoins : les règles d'avant (prod 13/11) =====
await base(); await db.exec(REGLES_PROD)
let pai=await unPaiement()
let e=await ecrire(U.livreur,`update public.paiements set montant=0, statut='remis' where id=$1`,[pai])
check('AVANT (témoin) : le livreur met SON paiement à 0, « remis »', e===null && await montant(pai)===0, e)
pai=await unPaiement()
e=await ecrire(U.ceo,`update public.paiements set montant=7 where id=$1`,[pai])
check('AVANT (témoin) : le CEO modifie un paiement', e===null && await montant(pai)===7, e)

// ===== après =====
await base(); await db.exec(REGLES_PROD)
for (const i of [1,2]) { e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
pai=await unPaiement()
check('la livraison (serveur, enregistrer_livraison) crée toujours le paiement', !!pai && await montant(pai)===1)
for (const qui of ['livreur','ceo','manager','admin','super_admin','seller','agent']) {
  const e1=await ecrire(U[qui],`update public.paiements set montant=0 where id=$1`,[pai])
  const e2=await ecrire(U[qui],`insert into public.paiements (tenant_id,montant,statut) values ($1,0,'remis')`,[T])
  const e3=await ecrire(U[qui],`delete from public.paiements where id=$1`,[pai])
  check(`${qui} : modifier / créer / supprimer un paiement → refusé`, [e1,e2,e3].every(x=>x?.includes('permission denied')) && await montant(pai)===1, [e1,e2,e3].join(' | '))
}
check('le livreur lit toujours SES paiements', (await sous(U.livreur,'authenticated',()=>q(`select count(*)::int n from public.paiements`)))[0].n>=1)
check('le manager lit toujours les paiements', (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.paiements`)))[0].n>=1)
e=await erreur(()=>sous(null,'service_role',()=>q(`update public.paiements set statut='encaisse', date_encaissement=now() where id=$1`,[pai])))
check('« Encaisser » (Edge Function, clé service) passe', e===null && (await q(`select statut from public.paiements where id=$1`,[pai]))[0].statut==='encaisse', e)
e=await erreur(()=>sous(null,'service_role',()=>q(`update public.paiements set statut='remis' where id=$1`,[pai])))
check('« Remettre la caisse » (Edge Function, clé service) passe', e===null && (await q(`select statut from public.paiements where id=$1`,[pai]))[0].statut==='remis', e)
check('aucune règle d\'écriture ne reste, la lecture est là', (await q(`select string_agg(cmd, ',' order by cmd) s from pg_policies where tablename='paiements'`))[0].s==='SELECT')

// ===== retour arrière =====
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
e=await ecrire(U.livreur,`update public.paiements set montant=0 where id=$1`,[pai])
check('retour : comportement d\'avant (le livreur réécrit son paiement)', e===null && await montant(pai)===0, e)
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
