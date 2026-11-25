// fk_entreprises.sql (12/11, T15) — 16 liens tenant_id → tenants : témoins avant (orpheline acceptée, config laissée
// derrière), fichier refusé s'il y a des orphelines ; après : la bonne règle sur chacune des 16, liens d'avant gardés,
// index tenant_id partout, orpheline refusée, entreprise vide supprimée avec sa config, entreprise avec relevé ou
// mouvement non ; fichier deux fois (répétition comprise), retour arrière deux fois, fichier après.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
const S=lire('fk_entreprises.sql'), SR=lire('fk_entreprises_retour.sql')
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
                   'commandes_statut_lot.sql','historique_affectations.sql','commandes_produit_id.sql','stock_livraison_autre_vendeur.sql','paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(lire(f))
  await db.exec(F); await db.exec(G)
  // le lien statuts → tenants de prod (statuts_entreprise.sql, CASCADE), posé à la main ici
  await db.exec(`do $$ begin if not exists (select 1 from pg_constraint where conrelid='public.statuts'::regclass and confrelid='public.tenants'::regclass) then
    alter table public.statuts add constraint statuts_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete cascade; end if; end $$;`)
  // la politique de prod, lue le 12/11
  await db.exec(`drop policy if exists commandes_delete on public.commandes;
    create policy commandes_delete on public.commandes for delete to authenticated
      using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id()) and (public.mon_role() = any (array['admin','ceo','manager']))));`)
}
const TABLES={ pays:'c', zones:'c', entrepots:'c', produits:'c', stocks:'c', livreurs:'c',
  appels:'r', livraisons:'r', paiements:'r', mouvements_stock:'r', expeditions:'r', expeditions_produits:'r', reglements:'r',
  reglements_commandes:'r', historique_statuts:'r', historique_affectations:'r' }
const liens=async()=>Object.fromEntries((await q(`select c.conrelid::regclass::text t, c.confdeltype::text r, obj_description(c.oid,'pg_constraint') m from pg_constraint c
  where c.contype='f' and c.confrelid='public.tenants'::regclass`)).map(x=>[x.t.replace('public.',''),x]))
const vide=async nom=>{ const t=(await ins('tenants',{nom_entreprise:nom})).id; const p=(await ins('pays',{tenant_id:t,nom:'P',code:'PP',devise:'X'})).id
  await ins('zones',{tenant_id:t,pays_id:p,nom_zone:'Z'}); const e=(await ins('entrepots',{tenant_id:t,nom:'E',pays_id:p,actif:true})).id
  const pr=(await ins('produits',{tenant_id:t,product:'Pr',code:'pr',price:1})).id
  await q(`insert into public.stocks (tenant_id,produit_id,entrepot_id,quantite_disponible,quantite_reservee,quantite_defectueuse) values ($1,$2,$3,0,0,0)`,[t,pr,e])
  await ins('livreurs',{tenant_id:t,nom:'L',pays_id:p,actif:true,zone:'Z'}); return t }
const reste=async t=>{ let n=0; for (const x of ['pays','zones','entrepots','produits','stocks','livreurs']) n+=Number((await q(`select count(*) n from public.${x} where tenant_id=$1`,[t]))[0].n); return n }

// témoin, avant
await base()
let e=await erreur(()=>ins('zones',{tenant_id:crypto.randomUUID(),nom_zone:'orpheline'}))
check('AVANT (témoin) : une zone vers une entreprise inexistante est acceptée', e===null, e)
let ta=await vide('Vide avant'); await q(`delete from public.tenants where id=$1`,[ta])
check('AVANT (témoin) : supprimer une entreprise laisse sa config derrière', await reste(ta)>0)
e=await erreur(()=>db.exec(S)); check('fichier refusé tant qu\'il y a des orphelines, et il les nomme', e?.includes('lignes sans entreprise valide') && e?.includes('zones'), e)

// après
await base()
for (const i of [1,2]) { e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
let L=await liens()
for (const [t,r] of Object.entries(TABLES)) check(`${t} → lien ${r==='c'?'CASCADE':'RESTRICT'}`, L[t]?.r===r, JSON.stringify(L[t]))
check('les liens d\'avant sont gardés (commandes, statuts…)', L.commandes && L.statuts && L.user_roles)
check('aucune table de la liste sans index tenant_id', (await q(`select count(*)::int n from (select unnest($1::text[]) t) x where not exists (select 1 from pg_index i where i.indrelid=('public.'||x.t)::regclass and i.indkey[0]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='tenant_id'))`,[Object.keys(TABLES)]))[0].n===0)

e=await erreur(()=>ins('zones',{tenant_id:crypto.randomUUID(),nom_zone:'orpheline'}))
check('une zone vers une entreprise inexistante → refusée', e?.includes('foreign key'), e)
e=await erreur(()=>ins('reglements',{tenant_id:crypto.randomUUID(),periode_debut:'2026-11-01',periode_fin:'2026-11-01'}))
check('un relevé vers une entreprise inexistante → refusé', e?.includes('foreign key'), e)
ta=await vide('Vide')
e=await erreur(()=>q(`delete from public.tenants where id=$1`,[ta]))
check('entreprise VIDE : se supprime, sa config avec (6 tables)', e===null && await reste(ta)===0, e)
const tb=await vide('Avec relevé'); await ins('reglements',{tenant_id:tb,periode_debut:'2026-11-01',periode_fin:'2026-11-01'})
e=await erreur(()=>q(`delete from public.tenants where id=$1`,[tb]))
check('entreprise avec un relevé : suppression refusée, rien ne part', e?.includes('foreign key') && await reste(tb)===6, e)
const tc=await vide('Avec mouvement'); const pc=(await q(`select id from public.produits where tenant_id=$1`,[tc]))[0].id, ec=(await q(`select id from public.entrepots where tenant_id=$1`,[tc]))[0].id
await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',5,'x')`,[tc,pc,ec])
e=await erreur(()=>q(`delete from public.tenants where id=$1`,[tc]))
check('entreprise avec un mouvement de stock : suppression refusée', e?.includes('foreign key'), e)
check('les données des entreprises en place sont intactes', (await q(`select count(*)::int n from public.pays where tenant_id=$1`,[T]))[0].n===1)
// 13/11 : le contrôle de fin de historique_affectations.sql (« toute clé en SET NULL ») voyait le lien RESTRICT vers tenants
const ancien=(await q(`select exists (select 1 from pg_constraint where conrelid='public.historique_affectations'::regclass and contype='f' and confdeltype <> 'n') x`))[0].x
const nouveau=(await q(`select exists (select 1 from pg_constraint where conrelid='public.historique_affectations'::regclass and contype='f' and confrelid <> 'public.tenants'::regclass and confdeltype <> 'n') x`))[0].x
check('historique_affectations.sql : l\'ancien contrôle aurait refusé, le nouveau passe', ancien===true && nouveau===false, ancien+' / '+nouveau)
check('… et son texte dans le fichier est le nouveau', lire('historique_affectations.sql').includes("confrelid <> 'public.tenants'::regclass and confdeltype <> 'n'"))

// retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
L=await liens()
check('retour : les 16 liens du fichier partis, ceux d\'avant gardés', Object.keys(TABLES).every(t=>!L[t]) && L.commandes && L.statuts && L.user_roles, Object.keys(L).join(','))
check('retour : index du fichier partis', (await q(`select count(*)::int n from pg_index i where obj_description(i.indexrelid,'pg_class')='fichier: fk_entreprises.sql'`))[0].n===0)
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
