// entreprise_suspendue.sql (12/11, T11) — une entreprise suspendue est fermée dans la base et avant chaque
// requête du navigateur (pgrst.db_pre_request), le super admin jamais ; témoin avant ; active inchangée ;
// suspendue : porte fermée pour 6 rôles, get_my_tenant_id vide, rien lu, rien écrit, aucune donnée touchée ;
// autre entreprise intacte ; tout statut ≠ actif ferme ; réactivée rouvre ; fichier deux fois (répétition
// comprise), retour arrière deux fois (réglage retiré AVANT la fonction), fichier après.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
const S=lire('entreprise_suspendue.sql'), SR=lire('entreprise_suspendue_retour.sql')
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
  create role anon; create role authenticated; create role authenticator; create role service_role; create role supabase_admin;
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
const lead=async(tenant=T,pays=AO)=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:tenant,pays_id:pays,client_nom:'C'+n,client_telephone:'+244'+n,produit:'x',quantite:1,prix:1,ville_zone:'Luanda',adresse:'rue'})).id
const comme=(uid,sql,p=[])=>sous(uid,'authenticated',()=>q(sql,p))
const nb=async(uid,t)=>Number((await comme(uid,`select count(*) n from public.${t}`))[0].n)
const tenantDe=async uid=>(await comme(uid,`select public.get_my_tenant_id() t`))[0].t
const porte=uid=>erreur(()=>comme(uid,`select public.verifier_entreprise_active()`))
const suspendre=(t,s)=>q(`update public.tenants set statut=$2 where id=$1`,[t,s])

await base()
const P2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO',devise:'AOA'})).id
await lead(); await lead(); await lead(T2,P2)

// témoin, avant
await suspendre(T,'suspendu')
check('AVANT (témoin) : entreprise suspendue, le manager lit encore ses 2 commandes', await nb(U.manager,'commandes')===2)
await suspendre(T,'actif')

for (const i of [1,2]) { const e=await erreur(()=>db.exec(S)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
check('réglage PostgREST posé sur authenticator', (await q(`select rolconfig::text c from pg_roles where rolname='authenticator'`))[0].c?.includes('pgrst.db_pre_request=public.verifier_entreprise_active'))
check('la répétition n\'a pas laissé l\'entreprise de test suspendue', (await q(`select statut from public.tenants where id=$1`,[T]))[0].statut==='actif')
check('anon ne peut pas appeler la porte', (await q(`select has_function_privilege('anon','public.verifier_entreprise_active()','execute') x`))[0].x===false)

// active : rien ne change
check('active : manager, get_my_tenant_id = son entreprise', await tenantDe(U.manager)===T)
check('active : la porte laisse passer', (await porte(U.manager))===null)
check('active : le manager lit ses 2 commandes', await nb(U.manager,'commandes')===2)

// suspendue
await suspendre(T,'suspendu')
for (const qui of ['manager','admin','seller','agent','livreur','ceo']) {
  const e=await porte(U[qui])
  check(`suspendue : ${qui} — porte fermée « Entreprise suspendue »`, e?.includes('Entreprise suspendue'), e)
}
check('suspendue : get_my_tenant_id vide', (await tenantDe(U.manager))===null)
check('suspendue : le manager ne lit plus aucune commande', await nb(U.manager,'commandes')===0)
check('suspendue : ni statuts, ni produits, ni pays', await nb(U.manager,'statuts')===0 && await nb(U.manager,'produits')===0 && await nb(U.manager,'pays')===0)
let e=await erreur(()=>comme(U.manager,`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,prix) values ('X1',$1,$2,'c','1','x',1)`,[T,AO]))
check('suspendue : créer une commande refusé', e!==null, e)
e=await erreur(()=>comme(U.manager,`update public.statuts set nom=nom where tenant_id=$1 returning id`,[T]))
const maj=e===null ? (await comme(U.manager,`update public.statuts set nom=nom where tenant_id=$1 returning id`,[T])).length : -1
check('suspendue : modifier un statut ne touche rien', maj===0 || e!==null, e)
check('suspendue : 2 commandes toujours là (aucune donnée touchée)', (await q(`select count(*)::int n from public.commandes where tenant_id=$1`,[T]))[0].n===2)
check('suspendue : le super admin passe et voit tout', (await porte(U.super_admin))===null && await nb(U.super_admin,'commandes')===3)
check('suspendue : l\'autre entreprise (active) n\'est pas touchée', (await porte(MGR2))===null && await tenantDe(MGR2)===T2 && await nb(MGR2,'commandes')===1)
e=await porte(null); check('sans connexion (service, éditeur SQL) : la porte ne bloque pas', e===null, e)
await suspendre(T,'archive')
check('tout statut autre que « actif » ferme (archive)', (await porte(U.manager))?.includes('Entreprise suspendue'))

// réactivée
await suspendre(T,'actif')
check('réactivée : tout rouvre tout de suite', (await porte(U.manager))===null && await nb(U.manager,'commandes')===2 && await tenantDe(U.manager)===T)

// retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(SR)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : réglage retiré, porte partie',
  !((await q(`select coalesce(rolconfig::text,'') c from pg_roles where rolname='authenticator'`))[0].c.includes('db_pre_request'))
  && (await q(`select to_regprocedure('public.verifier_entreprise_active()') f`))[0].f===null)
await suspendre(T,'suspendu')
check('retour : comportement d\'avant (suspendue, le manager lit encore)', await nb(U.manager,'commandes')===2)
await suspendre(T,'actif')
e=await erreur(()=>db.exec(S)); check('fichier après le retour arrière', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
