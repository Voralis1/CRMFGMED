// commandes_suppression.sql (12/11) — sur la chaîne des règles de stock (statuts, livraison + paiement, vendeur,
// stock_regles, stock_portes), avec la politique commandes_delete de prod (lue le 12/11) :
//   · AVANT (témoins) : le CEO supprime une commande payée en direct — le paiement part avec, le stock sorti reste sorti ;
//   · après : vendeur = SES leads non traités ; refusé dès une tentative / un appel / un autre statut ;
//     manager / admin = commande traitée, réservée (les « Rupture » repassent En attente), expédiée (stock rendu,
//     avertissement livreur) ; payée, livrée, sur un relevé → refusé pour tous ; agent / CEO / livreur refusés ;
//     suppression directe refusée ; lot = actions_masse ; raison obligatoire ; autre entreprise ; lead renvoyé
//     accepté ; historique gardé ; fichier deux fois (répétition comprise) ; retour arrière deux fois puis fichier.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
const S=lire('commandes_suppression.sql'), SR=lire('commandes_suppression_retour.sql')
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

// ===== témoins, avant le fichier =====
await base()
let PA=await produit('pa',5)
let c=await lead('pa'); await confirmer(c); let l=await livraison(c); await livStatut(l,'expedie'); await livStatut(l,'livre')
check('AVANT (témoin) : commande livrée et payée, stock 4', await stock(PA)===4 && (await q(`select count(*)::int n from public.paiements where commande_id=$1`,[c]))[0].n===1)
await sous(U.ceo,'authenticated',()=>q(`delete from public.commandes where id=$1`,[c]))
check('AVANT (témoin) : le CEO la supprime en direct — paiement parti, stock reste à 4', !(await existe(c)) && (await q(`select count(*)::int n from public.paiements`))[0].n===0 && await stock(PA)===4)

// ===== après =====
await base()
for (const i of [1,2]) { const e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
check('supprimer_leads → seller, super_admin', await roles('supprimer_leads')==='seller,super_admin', await roles('supprimer_leads'))
check('supprimer_commandes → admin, manager, super_admin', await roles('supprimer_commandes')==='admin,manager,super_admin', await roles('supprimer_commandes'))
check('la répétition ne laisse rien (0 commande, 0 journal)', (await q(`select count(*)::int n from public.commandes`))[0].n===0 && (await q(`select count(*)::int n from public.commandes_supprimees`))[0].n===0)

PA=await produit('pa',5)
// --- le vendeur
let a=await lead('pa')
check('lead neuf : le vendeur peut (écran)', (await possible(U.seller,a))?.permis===true)
let r=await supprimer(U.seller,[a],'doublon client')
check('le vendeur supprime son lead neuf', r[0]?.resultat==='applique' && !(await existe(a)), JSON.stringify(r))
let j=(await q(`select * from public.commandes_supprimees where commande_id=$1`,[a]))[0]
check('journal : raison, qui, nom, commande entière', j?.raison==='doublon client' && j?.supprime_par===U.seller && j?.supprime_par_nom==='seller@x' && j?.donnees?.lead_id===j?.lead_id && j?.stock_rendu===0)
const b=await lead('pa',SELLER2)
r=await supprimer(U.seller,[b]); check('le lead d\'un autre vendeur → refusé', r[0]?.resultat==='refuse' && await existe(b), JSON.stringify(r))
const t1=await lead('pa'); await tenter(t1)
r=await supprimer(U.seller,[t1]); check('lead déjà tenté → refusé « déjà traité »', r[0]?.resultat==='refuse' && r[0]?.motif.includes('déjà traité'), JSON.stringify(r))
const t2=await lead('pa'); await db.exec(`set session_replication_role = replica`); await ins('appels',{tenant_id:T,commande_id:t2,statut:'Unreached'}); await db.exec(`set session_replication_role = origin`)
r=await supprimer(U.seller,[t2]); check('lead avec un appel → refusé', r[0]?.resultat==='refuse' && r[0]?.motif.includes('déjà traité'), JSON.stringify(r))
const t3=await lead('pa'); await confirmer(t3)
r=await supprimer(U.seller,[t3]); check('lead confirmé → refusé au vendeur', r[0]?.resultat==='refuse', JSON.stringify(r))
const rp=await lead('nexistepas')
check('lead « Produit non reconnu » = non traité', await statut(rp)==='Produit non reconnu')
r=await supprimer(U.seller,[rp]); check('… le vendeur le supprime', r[0]?.resultat==='applique', JSON.stringify(r))
let e=await erreur(()=>supprimer(U.seller,[b,t1])); check('vendeur : 2 à la fois → refusé (actions_masse)', e?.includes('actions_masse'), e)
e=await erreur(()=>supprimer(U.seller,[t1],'   ')); check('raison vide → refusé', e?.includes('raison'), e)

// --- manager : traité, réservé
r=await supprimer(U.manager,[t1]); check('manager : lead tenté → supprimé', r[0]?.resultat==='applique' && !(await existe(t1)), JSON.stringify(r))
const PR=await produit('pr',1)
const res=await lead('pr'); await confirmer(res)
const rup=await lead('pr')
check('stock 1 réservé par une confirmée → le suivant en Rupture', await statut(rup)==='Rupture de stock')
r=await supprimer(U.manager,[res]); check('manager supprime la confirmée → la Rupture repasse En attente', r[0]?.resultat==='applique' && await statut(rup)==='Pending', JSON.stringify(r)+' '+await statut(rup))
check('… stock inchangé (rien n\'était sorti)', await stock(PR)===1)

// --- manager : expédiée → stock rendu
const PE=await produit('pe',5)
const ex=await lead('pe'); await confirmer(ex); const lx=await livraison(ex); await livStatut(lx,'expedie')
check('expédiée : stock 4', await stock(PE)===4)
let p=await possible(U.manager,ex)
check('écran : manager peut, avertissement « chez le livreur Livreur Joao »', p?.permis===true && p?.avertissement?.includes('Livreur Joao'), JSON.stringify(p))
check('écran : le vendeur ne peut pas (déjà traité)', (await possible(U.seller,ex))?.permis===false)
r=await supprimer(U.manager,[ex],'client injoignable')
check('manager supprime l\'expédiée → stock 5', r[0]?.resultat==='applique' && await stock(PE)===5, JSON.stringify(r)+' stock '+await stock(PE))
const mvt=(await q(`select type_mouvement t, quantite q, notes from public.mouvements_stock where produit_id=$1 order by created_at desc limit 1`,[PE]))[0]
check('… un « retour_ok » de 1 avec la note de suppression', mvt?.t==='retour_ok' && mvt?.q===1 && mvt?.notes.includes('Suppression commande') && mvt?.notes.includes('client injoignable'), JSON.stringify(mvt))
check('… journal stock_rendu 1, statut livraison expedie', (await q(`select stock_rendu s, statut_livraison l from public.commandes_supprimees where commande_id=$1`,[ex]))[0]?.s===1)
check('… livraison partie avec', (await q(`select count(*)::int n from public.livraisons where commande_id=$1`,[ex]))[0].n===0)
const lidEx=(await q(`select lead_id from public.commandes_supprimees where commande_id=$1`,[ex]))[0].lead_id
check('… son historique de statut reste (Confirmed…), sans lien', (await q(`select count(*)::int n from public.historique_statuts where commande_lead_id=$1 and commande_id is null`,[lidEx]))[0].n>=1)

// --- argent : refusé pour tous
const pay=await lead('pe'); await confirmer(pay); const lp=await livraison(pay); await livStatut(lp,'expedie'); await livStatut(lp,'livre')
for (const qui of ['manager','admin','super_admin']) {
  r=await supprimer(U[qui],[pay]); check(`livrée + payée → refusée (${qui})`, r[0]?.resultat==='refuse' && r[0]?.motif.includes('paiement') && await existe(pay), JSON.stringify(r)) }
const rel=await lead('pe'); await confirmer(rel)
const reg=await ins('reglements',{tenant_id:T,vendeur_id:U.seller,periode_debut:'2026-11-01',periode_fin:'2026-11-07'})
await ins('reglements_commandes',{commande_id:rel,reglement_id:reg.id,tenant_id:T,montant:1})
r=await supprimer(U.admin,[rel]); check('sur un relevé vendeur → refusée (admin)', r[0]?.resultat==='refuse' && r[0]?.motif.includes('relevé'), JSON.stringify(r))

// --- rôles sans droit
const x=await lead('pa')
for (const qui of ['agent','ceo','livreur']) {
  r=await supprimer(U[qui],[x]); check(`${qui} → refusé`, r[0]?.resultat==='refuse' && r[0]?.motif.includes('rôle'), JSON.stringify(r)) }
for (const qui of ['manager','admin','ceo','super_admin']) {
  e=await erreur(()=>sous(U[qui],'authenticated',()=>q(`delete from public.commandes where id=$1`,[x])))
  check(`suppression directe refusée (${qui})`, e?.includes('permission denied') && await existe(x), e) }
check('journal : écriture directe refusée', (await erreur(()=>sous(U.manager,'authenticated',()=>q(`insert into public.commandes_supprimees (tenant_id,commande_id,raison,donnees) values ($1,gen_random_uuid(),'x','{}')`,[T]))))?.includes('permission denied'))
check('journal : le vendeur ne le lit pas, le manager oui',
  (await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.commandes_supprimees`)))[0].n===0 &&
  (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.commandes_supprimees`)))[0].n>=4)

// --- lot
const l1=await lead('pa'), l2=await lead('pa')
r=await supprimer(U.manager,[l1,l2,pay])
check('lot de 3 (1 payée) → 2 appliquées, 1 refusée', r.filter(z=>z.resultat==='applique').length===2 && r.find(z=>z.commande_id===pay)?.resultat==='refuse', JSON.stringify(r))

// --- autre entreprise
e=await erreur(()=>supprimer(MGR2,[x],'test',T)); check('manager d\'une autre entreprise → refusé', e?.includes('pas la vôtre') && await existe(x), e)
check('écran : autre entreprise → introuvable', (await possible(MGR2,x))?.permis===false)

// --- lead renvoyé : accepté comme nouveau
const lid=(await q(`select lead_id from public.commandes where id=$1`,[x]))[0].lead_id
await supprimer(U.manager,[x])
e=await erreur(()=>ins('commandes',{lead_id:lid,tenant_id:T,pays_id:AO,client_nom:'Renvoi',client_telephone:'+2449',produit:'pa',quantite:1,prix:1,ville_zone:'Luanda',adresse:'rue',vendeur_id:U.seller}))
check('le même lead renvoyé → accepté, En attente', e===null && (await q(`select statut_confirmation s from public.commandes where lead_id=$1`,[lid]))[0]?.s==='Pending', e)

// --- retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : politique et droit rendus, permissions et journal partis',
  (await q(`select count(*)::int n from pg_policies where tablename='commandes' and policyname='commandes_delete'`))[0].n===1
  && (await q(`select has_table_privilege('authenticated','public.commandes','delete') d`))[0].d===true
  && (await q(`select count(*)::int n from public.permissions where code like 'supprimer_%'`))[0].n===0
  && (await q(`select to_regclass('public.commandes_supprimees') t`))[0].t===null)
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
