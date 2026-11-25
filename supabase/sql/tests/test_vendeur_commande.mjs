// vendeur_commande.sql (04/11, T7) sur le schéma réel :
//   · AVANT (témoin) : un manager accepté comme « vendeur » ;
//   · une commande existante qui viole la règle → le fichier s'arrête et la NOMME ;
//   · APRÈS : vendeur de l'entreprise accepté ; vide accepté ; manager, admin,
//     super admin, agent → refusés ; vendeur d'une autre entreprise refusé ;
//     compte inconnu refusé — navigateur (manager), clé service (API), éditeur SQL ;
//   · update : passer à un manager refusé ; vers un autre vendeur accepté ; changer
//     un autre champ d'une commande dont le vendeur a changé de rôle depuis : accepté ;
//     changer d'entreprise sans vendeur de cette entreprise refusé ;
//   · fichier deux fois ; mutant (le contrôle du rôle retiré) arrêté par la répétition ;
//   · retour arrière deux fois, réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('vendeur_commande.sql'), RET=lire('vendeur_commande_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='9183429e-c75c-4ed2-a869-f8bfa011bbc2'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', seller_b:'aaaaaaaa-0000-0000-0000-000000000021', manager:'aaaaaaaa-0000-0000-0000-000000000002',
          admin:'aaaaaaaa-0000-0000-0000-000000000003', super_admin:'aaaaaaaa-0000-0000-0000-000000000009', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          seller2:'aaaaaaaa-0000-0000-0000-000000000011' }
let db, AO, AO2, n=0
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
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'}); await ins('tenants',{id:T2,nom_entreprise:'Fgmed Angola'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:r==='seller2'?T2:T,role:r.replace(/_b$/,'').replace(/2$/,''),email:r+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
  AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
  await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true}); await ins('entrepots',{tenant_id:T2,nom:'Angola',pays_id:AO2,actif:true})
  await db.exec(`set session_replication_role = origin`)
}
const commande=(vendeur,{tenant=T,pays=null}={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:tenant,pays_id:pays||(tenant===T?AO:AO2),client_nom:'C',client_telephone:'+244'+n,produit:'p',quantite:1,prix:1,ville_zone:'Luanda',vendeur_id:vendeur})

// ===== témoin + violation existante =====
await base()
let e=await erreur(()=>commande(U.manager))
check('AVANT (témoin) : un manager accepté comme « vendeur »', e===null, e)
e=await erreur(()=>db.exec(F))
check('une commande existante avec un manager comme vendeur → arrêt, nommée', e?.includes('L1 (manager)'), e)
check('… rien installé', (await q(`select count(*)::int n from pg_trigger where tgname='trg_zx_vendeur_commande'`))[0].n===0)

// ===== installation =====
await base()
for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }
e=await erreur(()=>commande(U.seller)); check('vendeur de l\'entreprise → accepté', e===null, e)
e=await erreur(()=>commande(null)); check('sans vendeur → accepté', e===null, e)
for (const [qui,u,attendu] of [['manager',U.manager,'manager'],['admin',U.admin,'admin'],['super admin',U.super_admin,'super_admin'],['agent',U.agent,'agent'],
                               ['vendeur d\'une autre entreprise',U.seller2,'hors de cette entreprise'],['compte inconnu','bbbbbbbb-0000-0000-0000-000000000000','hors de cette entreprise']]) {
  e=await erreur(()=>commande(u)); check(`${qui} comme vendeur → refusé (« ${attendu} »)`, e?.includes('doit être un compte vendeur') && e?.includes(attendu), e)
}
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.commandes (tenant_id,lead_id,client_nom,client_telephone,produit,quantite,prix,pays_id,ville_zone,vendeur_id) values ($1,'NAV-1','C','+1','p',1,1,$2,'L',$3)`,[T,AO,U.manager])))
check('navigateur (manager connecté) : lui-même comme vendeur → refusé', e?.includes('doit être un compte vendeur'), e)
e=await sous(null,'service_role',()=>erreur(()=>q(`insert into public.commandes (tenant_id,lead_id,client_nom,client_telephone,produit,quantite,prix,pays_id,ville_zone,vendeur_id) values ($1,'API-1','C','+1','p',1,1,$2,'L',$3)`,[T,AO,U.admin])))
check('clé service (API) : un admin comme vendeur → refusé aussi', e?.includes('doit être un compte vendeur'), e)
e=await sous(null,'service_role',()=>erreur(()=>q(`insert into public.commandes (tenant_id,lead_id,client_nom,client_telephone,produit,quantite,prix,pays_id,ville_zone,vendeur_id) values ($1,'API-2','C','+1','p',1,1,$2,'L',$3)`,[T,AO,U.seller])))
check('clé service (API) : un vrai vendeur → accepté', e===null, e)

// ===== update =====
const c=await commande(U.seller)
e=await erreur(()=>q(`update public.commandes set vendeur_id=$1 where id=$2`,[U.manager,c.id]))
check('passer le vendeur à un manager → refusé', e?.includes('doit être un compte vendeur'), e)
e=await erreur(()=>q(`update public.commandes set vendeur_id=$1 where id=$2`,[U.seller_b,c.id]))
check('passer à un autre vendeur de l\'entreprise → accepté', e===null, e)
e=await erreur(()=>q(`update public.commandes set vendeur_id=null where id=$1`,[c.id]))
check('vider le vendeur → accepté', e===null, e)
const c2=await commande(U.seller)
await q(`update public.user_roles set role='manager' where user_id=$1`,[U.seller])   // le vendeur change de rôle
e=await erreur(()=>q(`update public.commandes set client_nom='Nouveau nom' where id=$1`,[c2.id]))
check('vendeur devenu manager depuis : modifier un AUTRE champ de sa commande → accepté', e===null, e)
e=await erreur(()=>q(`update public.commandes set vendeur_id=vendeur_id where id=$1`,[c2.id]))
check('… réécrire le même vendeur (même valeur) → accepté (rien ne change)', e===null, e)
await q(`update public.user_roles set role='seller' where user_id=$1`,[U.seller])

// ===== mutant =====
await base()
await commande(U.seller)
const MUT=F.replace(`  if v_role is distinct from 'seller' then`,`  if v_role is null then`)
check('(témoin : contrôle du rôle retiré)', MUT!==F)
e=await erreur(()=>db.exec(MUT))
check('mutant : arrêté par la répétition, rien installé', e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes('manager comme vendeur')
  && (await q(`select count(*)::int n from pg_trigger where tgname='trg_zx_vendeur_commande'`))[0].n===0, e)

// ===== retour =====
await base(); await db.exec(F)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
e=await erreur(()=>commande(U.manager)); check('… le trou est rouvert (manager accepté)', e===null, e)
await q(`delete from public.commandes where vendeur_id=$1`,[U.manager])
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
