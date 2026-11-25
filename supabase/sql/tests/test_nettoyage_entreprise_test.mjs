// nettoyage_entreprise_test.sql (04/11) sur le schéma réel + les gardes d'aujourd'hui
// (historique des statuts et des affectations, paiement unique, relevé en une étape) :
//   · une autre entreprise / un nom différent → refus, RIEN supprimé ;
//   · l'entreprise de test vidée : commandes, appels, livraisons, paiements, relevés
//     (même payé), expéditions, mouvements ; stock et totaux produits à 0 (la ligne
//     à −1 comprise) ; produits et entrepôt gardés ; historique gardé (sans commande) ;
//   · l'autre entreprise (Fgmed-like) intacte, ligne par ligne ;
//   · relancé : rien à supprimer, passe ;
//   · mutant (la remise à zéro du stock retirée de la fonction) → arrêté par §4, tout annulé.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('nettoyage_entreprise_test.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='9183429e-c75c-4ed2-a869-f8bfa011bbc2'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', seller2:'aaaaaaaa-0000-0000-0000-000000000011', manager2:'aaaaaaaa-0000-0000-0000-000000000012',
          agent2:'aaaaaaaa-0000-0000-0000-000000000015', livreur2:'aaaaaaaa-0000-0000-0000-000000000016' }
let db, n=0
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type.startsWith('json')?'{}': x.data_type.includes('timestamp')||x.data_type==='date'?'2026-11-01':'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const TABLES=['commandes','appels','imports_bruts','livraisons','paiements','reglements','reglements_commandes','expeditions','expeditions_produits','mouvements_stock']
const compte=async(t,tenant)=>(await q(`select count(*)::int n from public.${t} where tenant_id=$1`,[tenant]))[0].n
const photo=async tenant=>{ const o={}; for (const t of [...TABLES,'stocks','produits','entrepots','historique_statuts','historique_affectations']) o[t]=await compte(t,tenant); return o }
const lignesFgmed=async()=>JSON.stringify(await q(`select id, statut_confirmation, quantite, prix from public.commandes where tenant_id=$1 order by id`,[T2]))
  +JSON.stringify(await q(`select produit_id, quantite_disponible from public.stocks where tenant_id=$1 order by produit_id`,[T2]))

async function base({nomTest='FGMED (Données Existantes)'}={}){
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
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:nomTest}); await ins('tenants',{id:T2,nom_entreprise:'Fgmed Angola'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:/2$/.test(r)?T2:T,role:r.replace(/\d$/,''),email:r+'@x'})
  }
  const pays={}, ent={}, agent={}, liv={}
  for (const t of [T,T2]) {
    pays[t]=(await ins('pays',{tenant_id:t,nom:'Angola',code:'AO',devise:'AOA'})).id
    ent[t]=(await ins('entrepots',{tenant_id:t,nom:'Angola',pays_id:pays[t],actif:true})).id
    for (const [nom,code,ferme,decl,rap] of [['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
      ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
      await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  }
  agent[T]=(await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:pays[T],actif:true})).id
  agent[T2]=(await ins('agents',{tenant_id:T2,nom:'Agent2',user_id:U.agent2,pays_id:pays[T2],actif:true})).id
  liv[T]=(await ins('livreurs',{tenant_id:T,nom:'Livreur',user_id:U.livreur,pays_id:pays[T],actif:true,zone:'Luanda'})).id
  liv[T2]=(await ins('livreurs',{tenant_id:T2,nom:'Livreur2',user_id:U.livreur2,pays_id:pays[T2],actif:true,zone:'Luanda'})).id
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], payer_reglements:['admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql',
                   'commandes_statut_lot.sql','historique_affectations.sql','paiement_unique_commande.sql','reglement_sur_encaisse.sql','frais_vendeurs.sql','retenues_releve.sql','reglement_atomique.sql'])
    await db.exec(lire(f))
  // 05/11 : des frais à 0 (le relevé calcule les frais de chaque lead ; ce n'est pas ce que ce fichier teste)
  await db.exec(`insert into public.tarifs_vendeurs (tenant_id,pays_id,frais_commande,frais_livraison,frais_upsell_unite,valide_depuis)
                 select tenant_id, id, 0, 0, 0, date '2000-01-01' from public.pays`)

  // des données dans les deux entreprises
  for (const t of [T,T2]) {
    const seller = t===T?U.seller:U.seller2, mgr = t===T?U.manager:U.manager2, agUid = t===T?U.agent:U.agent2
    const prodA=(await ins('produits',{tenant_id:t,product:'product a',code:'product-a',price:1})).id
    const prodC=(await ins('produits',{tenant_id:t,product:'product c',code:'product-c',price:1})).id
    await db.exec(`set session_replication_role = replica`)
    await ins('stocks',{tenant_id:t,produit_id:prodC,entrepot_id:ent[t],quantite_disponible:0,quantite_reservee:0,quantite_defectueuse:0})
    await db.exec(`set session_replication_role = origin`)
    await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',10,'réception')`,[t,prodA,ent[t]])
    const ids=[]
    for (const i of [1,2,3]) {
      const c=await ins('commandes',{lead_id:'L'+(++n),tenant_id:t,pays_id:pays[t],client_nom:'C'+n,client_telephone:'+244'+n,produit:i===3?'product-c':'product-a',quantite:1,prix:1000,ville_zone:'Nulle part',vendeur_id:seller,adresse:'rue '+n})
      ids.push(c.id)
      await sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,'Confirmed','Pending','note',10,null,'{}'::jsonb)`,[c.id,t,agUid,t===T?agent[T]:agent[T2]]))
    }
    // une livraison livrée + payée + remise par commande, et un relevé payé
    for (const id of ids) {
      await db.exec(`set session_replication_role = replica`)
      const l=await ins('livraisons',{tenant_id:t,commande_id:id,livreur_id:liv[t],statut:'expedie'})
      await db.exec(`set session_replication_role = origin`)
      await q(`update public.livraisons set statut='livre' where id=$1`,[l.id])
      await db.exec(`set session_replication_role = replica`)
      await q(`update public.commandes set statut_livraison='livre' where id=$1`,[id])
      await ins('paiements',{tenant_id:t,commande_id:id,livreur_id:liv[t],montant:1000,methode:'cod',statut:'remis'})
      await db.exec(`set session_replication_role = origin`)
    }
    const r=(await sous(mgr,'authenticated',()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[t,seller,ids])))[0]
    await sous(null,'service_role',()=>q(`update public.reglements set statut='paye' where id=$1`,[r.reglement_id]))
    // une expédition avec une ligne, un import brut
    await db.exec(`set session_replication_role = replica`)
    const ex=(await ins('expeditions',{tenant_id:t})).id
    await ins('expeditions_produits',{tenant_id:t,expedition_id:ex,produit_id:prodA,quantite:5})
    await ins('imports_bruts',{tenant_id:t})
    await db.exec(`set session_replication_role = origin`)
  }
}

// ===== état de départ (témoin) =====
await base()
let avant=await photo(T)
check('départ : de tout dans l\'entreprise de test', TABLES.every(t=>avant[t]>0), JSON.stringify(avant))
check('départ : la ligne « product c » est à −1 (livrée sans stock)', (await q(`select s.quantite_disponible q from public.stocks s join public.produits p on p.id=s.produit_id where s.tenant_id=$1 and p.product='product c'`,[T]))[0].q===-1)
check('départ : historique écrit (statuts)', avant.historique_statuts>0)
check('départ : un relevé PAYÉ existe', (await q(`select count(*)::int n from public.reglements where tenant_id=$1 and statut='paye'`,[T]))[0].n===1)
const fgmedAvant=await lignesFgmed(), fgmedPhoto=await photo(T2)

// ===== mauvaise entreprise =====
await base({nomTest:'Fgmed Angola bis'})
let ph=await photo(T)
let e=await erreur(()=>db.exec(F))
check('l\'entreprise 17144700 porte un autre nom → refus, nommé', e?.includes('s\'appelle « Fgmed Angola bis »'), e)
check('… RIEN supprimé', JSON.stringify(await photo(T))===JSON.stringify(ph))
await q(`delete from public.tenants where id=$1`,[crypto.randomUUID()])
const FAUX=F.replace(`c_tenant constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';`,`c_tenant constant uuid := '${T2}';`)
await base()
ph=await photo(T2)
e=await erreur(()=>db.exec(FAUX))
check('l\'id de Fgmed Angola collé à la place → refus (le nom ne correspond pas)', e?.includes('s\'appelle « Fgmed Angola »'), e)
check('… Fgmed Angola : RIEN supprimé', JSON.stringify(await photo(T2))===JSON.stringify(ph))

// ===== le nettoyage =====
await base()
avant=await photo(T)
const fgmedAvantMeme=await lignesFgmed(), fgmedPhotoMeme=await photo(T2)
let avis=[]
e=await erreur(()=>db.exec(F,{onNotice:m=>avis.push(m.message)}))
check('le fichier passe avec les gardes d\'aujourd\'hui (historique, paiement unique, relevé figé)', e===null, e)
const apres=await photo(T)
check('vidé : commandes, appels, imports, livraisons, paiements, relevés (+lignes), expéditions (+lignes), mouvements', TABLES.every(t=>apres[t]===0), JSON.stringify(apres))
check('stock : chaque ligne à 0 (le −1 compris)', (await q(`select count(*)::int n from public.stocks where tenant_id=$1 and (quantite_disponible<>0 or quantite_reservee<>0 or quantite_defectueuse<>0)`,[T]))[0].n===0)
check('totaux produits à 0', (await q(`select count(*)::int n from public.produits where tenant_id=$1 and (coalesce(current_quantity,0)<>0 or coalesce(defected_quantity,0)<>0)`,[T]))[0].n===0)
check('produits, lignes de stock et entrepôt gardés', apres.produits===avant.produits && apres.stocks===avant.stocks && apres.entrepots===avant.entrepots)
check('historique gardé (même nombre de lignes), plus relié à aucune commande',
  apres.historique_statuts===avant.historique_statuts && apres.historique_affectations===avant.historique_affectations
  && (await q(`select count(*)::int n from public.historique_statuts where tenant_id=$1 and commande_id is not null`,[T]))[0].n===0)
check('Fgmed Angola intacte, ligne par ligne', await lignesFgmed()===fgmedAvantMeme && JSON.stringify(await photo(T2))===JSON.stringify(fgmedPhotoMeme))
check('avis : le −1 de « product c » est nommé avant la remise à 0', avis.some(a=>a.includes('product c') && a.includes('−1')||a.includes('product c') && a.includes('-1')), avis.join(' | '))
check('avis : les comptes avant suppression sont affichés', avis.some(a=>a.startsWith('À supprimer : 3 commandes')), avis.find(a=>a.startsWith('À supprimer'))||'')
avis=[]
e=await erreur(()=>db.exec(F,{onNotice:m=>avis.push(m.message)}))
check('relancé : rien à supprimer, passe', e===null && avis.some(a=>a.startsWith('À supprimer : 0 commandes')), e||avis.join(' | '))

// ===== mutant : la fonction ne remet plus le stock à 0 =====
await base()
await db.exec(`create or replace function public.vider_donnees_operationnelles(p_tenant uuid) returns table(etape text, lignes bigint)
  language plpgsql security definer set search_path = public as $$
  declare t text; n bigint;
  begin
    foreach t in array array['reglements_commandes','reglements','paiements','livraisons','appels','imports_bruts','commandes','expeditions_produits','expeditions','mouvements_stock'] loop
      execute format('delete from public.%I where tenant_id = $1', t) using p_tenant; get diagnostics n = row_count; etape := t; lignes := n; return next;
    end loop;
  end $$;`)
ph=await photo(T)
e=await erreur(()=>db.exec(F))
check('mutant (stock pas remis à 0) : arrêté par la vérification, tout annulé', e?.includes('n\'est pas à 0') && JSON.stringify(await photo(T))===JSON.stringify(ph), e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
