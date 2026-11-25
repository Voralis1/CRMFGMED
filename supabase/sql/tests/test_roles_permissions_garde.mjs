// roles_permissions_garde.sql (03/11) sur le schéma réel :
//   · AVANT (témoins) : l'ancienne page (delete puis insert) laisse un rôle à
//     zéro si l'insert échoue ; supprimer un rôle porté met role_id à NULL ;
//   · la porte remplacer_permissions_role : différence appliquée, vide /
//     inconnu / super_admin incomplet refusés SANS rien toucher, non-super
//     admin refusé (manager, vendeur, service role) ;
//   · super_admin : aucune ligne retirée/modifiée (navigateur, éditeur SQL,
//     TRUNCATE), sauf quand la permission elle-même est supprimée ; une
//     nouvelle permission lui va ;
//   · roles : système ni supprimé ni renommé ; rôle porté refusé (rien ne
//     bouge) ; rôle libre supprimé avec ses permissions en une requête ;
//   · l'ancienne page après le fichier échoue sans rien changer ;
//   · fichier deux fois ; mutant (refus du vide retiré) arrêté par la
//     répétition, rien installé ; retour arrière deux fois puis réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')

const T='11111111-1111-1111-1111-111111111111'
const U={ super_admin:'aaaaaaaa-0000-0000-0000-000000000009', manager:'aaaaaaaa-0000-0000-0000-000000000002',
          seller:'aaaaaaaa-0000-0000-0000-000000000001', seller2:'aaaaaaaa-0000-0000-0000-000000000011' }
const ROLES=['super_admin','ceo','manager','admin','seller','agent','livreur']
const PERMS=['menu_dashboard','menu_commandes','menu_gestion_roles','actions_masse','gerer_produits','menu_produits']

async function base(){
  const db = new PGlite()
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
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    revoke all on all tables in schema public from anon;`)
  // l'état lu en prod le 03/11 : 7 rôles système sans entreprise, super_admin a tout
  await db.exec(`set session_replication_role = replica`)
  await db.query(`insert into public.tenants (id, nom) values ($1,'Test')`,[T]).catch(async()=>{
    const c=(await db.query(`select column_name from information_schema.columns where table_name='tenants' and is_nullable='NO' and column_default is null`)).rows.map(r=>r.column_name)
    const v={id:T}; for(const k of c) if(!(k in v)) v[k]='x'
    await db.query(`insert into public.tenants (${Object.keys(v).join(',')}) values (${Object.keys(v).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(v)) })
  for(const r of ROLES) await db.query(`insert into public.roles (nom,is_system,tenant_id) values ($1,true,null)`,[r])
  for(const p of PERMS) await db.query(`insert into public.permissions (code,nom,module) values ($1,$1,'general')`,[p])
  await db.exec(`insert into public.role_permissions select r.id, p.code from public.roles r, public.permissions p where r.nom='super_admin';
    insert into public.role_permissions select r.id, p.code from public.roles r, public.permissions p where r.nom='manager' and p.code in ('menu_dashboard','menu_commandes','actions_masse');
    insert into public.role_permissions select r.id, p.code from public.roles r, public.permissions p where r.nom='seller' and p.code in ('menu_dashboard','menu_produits');`)
  const roleId=async n=>(await db.query(`select id from public.roles where nom=$1`,[n])).rows[0].id
  for(const [u,r] of [[U.super_admin,'super_admin'],[U.manager,'manager'],[U.seller,'seller'],[U.seller2,'seller']])
    await db.query(`insert into public.user_roles (user_id,role,tenant_id,role_id,email) values ($1,$2,$3,$4,$5)`,[u,r,T,await roleId(r),r+'@x'])
  await db.exec(`set session_replication_role = origin`)
  return db
}

let db
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ return e.message } }
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const id=async n=>(await q(`select id from public.roles where nom=$1`,[n]))[0]?.id
const perms=async n=>(await q(`select permission_code c from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.nom=$1 order by 1`,[n])).map(r=>r.c)
const etat=async()=>JSON.stringify(await q(`select r.nom, rp.permission_code from public.role_permissions rp join public.roles r on r.id=rp.role_id order by 1,2`))

// ===== AVANT : les deux trous, reproduits =====
db=await base()
const m0=await id('manager')
await sous(U.super_admin,'authenticated',async()=>{
  // l'ancienne page : delete, puis l'insert échoue (code inconnu → FK) = rôle vide
  await q(`delete from public.role_permissions where role_id=$1`,[m0])
  await erreur(()=>q(`insert into public.role_permissions (role_id,permission_code) values ($1,'menu_dashboard'),($1,'perdu_en_route')`,[m0]))
})
check('AVANT témoin : delete puis insert raté → manager à 0 permission',(await perms('manager')).length===0)
const s0=await id('seller')
await sous(U.super_admin,'authenticated',async()=>{
  await q(`delete from public.role_permissions where role_id=$1`,[s0])
  await q(`delete from public.roles where id=$1`,[s0])
})
check('AVANT témoin : supprimer « seller » passe, ses 2 comptes perdent leur rôle (role_id NULL)',
  (await q(`select count(*)::int n from public.user_roles where role_id is null`))[0].n===2)

// ===== Installation =====
db=await base()
await q(`delete from public.role_permissions where role_id=(select id from public.roles where nom='super_admin') and permission_code='gerer_produits'`)
const avantInstall=await etat()
let e=await erreur(()=>db.exec(lire('roles_permissions_garde.sql')))
check('fichier passe (1re fois)',e===null,e)
check('§1 : la permission manquante est rendue au super admin',(await perms('super_admin')).length===PERMS.length)
check('§1 : aucune autre ligne touchée',JSON.stringify(JSON.parse(await etat()).filter(r=>!(r.nom==='super_admin'&&r.permission_code==='gerer_produits')))===avantInstall)
e=await erreur(()=>db.exec(lire('roles_permissions_garde.sql')))
check('fichier passe (2e fois), rien ne change',e===null && (await perms('super_admin')).length===PERMS.length,e)

// ===== La porte =====
const mgr=await id('manager')
let n=await sous(U.super_admin,'authenticated',()=>q(`select public.remplacer_permissions_role($1,$2) n`,[mgr,['menu_dashboard','gerer_produits',' gerer_produits ','']]))
check('super admin : 2 codes (doublon, espaces, vide ignorés) → 2',n[0].n===2 && JSON.stringify(await perms('manager'))==='["gerer_produits","menu_dashboard"]')
const av=await etat()
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,[]])))
check('liste vide refusée, message clair',e?.includes('sans aucune permission'),e)
check('… et rien n\'a bougé',(await etat())===av)
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,null])))
check('liste NULL refusée',e?.includes('sans aucune permission'),e)
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,['menu_dashboard','pas_un_code']])))
check('code inconnu refusé et nommé, rien n\'a bougé',e?.includes('pas_un_code') && (await etat())===av,e)
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,['00000000-0000-0000-0000-000000000000',['menu_dashboard']])))
check('rôle inexistant refusé',e?.includes('introuvable'),e)
for(const [qui,u] of [['manager',U.manager],['vendeur',U.seller]]){
  e=await sous(u,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,['menu_dashboard']])))
  check(`${qui} refusé`,e?.includes('Seul le super admin'),e)
}
e=await sous(null,'service_role',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,['menu_dashboard']])))
check('service role refusé (pas de compte super admin)',e?.includes('Seul le super admin'),e)
e=await sous(null,'anon',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[mgr,['menu_dashboard']])))
check('anon : pas le droit d\'exécuter',e?.includes('permission denied'),e)
check('… rien n\'a bougé après tous ces refus',(await etat())===av)

// ===== super_admin protégé =====
const sa=await id('super_admin')
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`select public.remplacer_permissions_role($1,$2)`,[sa,PERMS.filter(p=>p!=='menu_gestion_roles')])))
check('super_admin sans menu_gestion_roles : refusé, permission nommée',e?.includes('menu_gestion_roles'),e)
n=await sous(U.super_admin,'authenticated',()=>q(`select public.remplacer_permissions_role($1,$2) n`,[sa,PERMS]))
check('super_admin : tout coché passe',n[0].n===PERMS.length)
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`delete from public.role_permissions where role_id=$1`,[sa])))
check('navigateur : delete direct refusé (droit retiré)',e?.includes('permission denied'),e)
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`insert into public.role_permissions values ($1,'menu_dashboard')`,[mgr])))
check('navigateur : insert direct refusé',e?.includes('permission denied'),e)
e=await erreur(()=>q(`delete from public.role_permissions where role_id=$1 and permission_code='menu_gestion_roles'`,[sa]))
check('éditeur SQL : retirer menu_gestion_roles au super admin refusé',e?.includes('garde toutes les permissions'),e)
e=await erreur(()=>q(`update public.role_permissions set role_id=$2 where role_id=$1 and permission_code='actions_masse'`,[sa,mgr]))
check('éditeur SQL : déplacer une ligne du super admin refusé',e?.includes('garde toutes les permissions'),e)
e=await erreur(()=>q(`delete from public.role_permissions`))
check('éditeur SQL : tout vider refusé',e?.includes('garde toutes les permissions'),e)
e=await erreur(()=>db.exec(`truncate public.role_permissions`))
check('TRUNCATE refusé',e?.includes('TRUNCATE'),e)
check('… super_admin a toujours tout',(await perms('super_admin')).length===PERMS.length)
e=await sous(null,'service_role',()=>erreur(()=>q(`delete from public.role_permissions where role_id=$1`,[sa])))
check('service role : refusé aussi',e?.includes('garde toutes les permissions'),e)
// autres rôles : l'éditeur SQL garde la main
await q(`delete from public.role_permissions where role_id=$1 and permission_code='gerer_produits'`,[mgr])
check('éditeur SQL : retirer une permission au manager reste possible',JSON.stringify(await perms('manager'))==='["menu_dashboard"]')

await q(`insert into public.permissions (code,nom,module) values ('nouvelle','Nouvelle','general')`)
check('nouvelle permission → donnée au super admin, à personne d\'autre',
  (await perms('super_admin')).includes('nouvelle') && (await q(`select count(*)::int n from public.role_permissions where permission_code='nouvelle'`))[0].n===1)
await q(`insert into public.role_permissions values ($1,'nouvelle')`,[mgr])
e=await erreur(()=>q(`delete from public.permissions where code='nouvelle'`))
check('supprimer la PERMISSION passe (cascade, super admin compris)',e===null && (await q(`select count(*)::int n from public.role_permissions where permission_code='nouvelle'`))[0].n===0,e)

// ===== roles =====
for(const r of ['seller','super_admin','manager']){
  const rid=await id(r)
  e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`delete from public.roles where id=$1`,[rid])))
  check(`supprimer le rôle système « ${r} » refusé (navigateur)`,e?.includes('rôle du système'),e)
}
e=await erreur(()=>q(`delete from public.roles where nom='seller'`))
check('… et depuis l\'éditeur SQL',e?.includes('rôle du système'),e)
e=await erreur(()=>q(`update public.roles set nom='Super_Admin' where nom='super_admin'`))
check('renommer super_admin refusé',e?.includes('ne se renomme pas'),e)
await q(`update public.roles set description='ok' where nom='seller'`)
check('changer la description d\'un rôle système passe',(await q(`select description from public.roles where nom='seller'`))[0].description==='ok')
check('… les vendeurs ont toujours leur rôle',(await q(`select count(*)::int n from public.user_roles where role_id is null`))[0].n===0)

// rôle libre, porté par un compte
const libre=(await sous(U.super_admin,'authenticated',()=>q(`insert into public.roles (nom) values ('SUPERVISEUR') returning id`)))[0].id
await sous(U.super_admin,'authenticated',()=>q(`select public.remplacer_permissions_role($1,$2)`,[libre,['menu_dashboard','menu_commandes']]))
await q(`update public.user_roles set role_id=$1 where user_id=$2`,[libre,U.seller2])
e=await sous(U.super_admin,'authenticated',()=>erreur(()=>q(`delete from public.roles where id=$1`,[libre])))
check('rôle porté : refusé, compte nommé',e?.includes('seller@x') && e?.includes('réassignez'),e)
check('… rien n\'a bougé (rôle, 2 permissions, compte)',(await perms('SUPERVISEUR')).length===2 && (await q(`select role_id from public.user_roles where user_id=$1`,[U.seller2]))[0].role_id===libre)
await q(`update public.user_roles set role_id=$1 where user_id=$2`,[await id('seller'),U.seller2])
n=await sous(U.super_admin,'authenticated',()=>q(`delete from public.roles where id=$1 returning id`,[libre]))
check('rôle libre : supprimé en UNE requête, ses permissions avec',n.length===1 && (await q(`select count(*)::int n from public.role_permissions where role_id=$1`,[libre]))[0].n===0)
e=await sous(U.manager,'authenticated',async()=>{ const r=await q(`delete from public.roles where nom='SUPERVISEUR2' returning id`); return r.length })
check('manager : ne supprime aucun rôle (politique inchangée)',e===0)

// ===== l'ancienne page, après le fichier =====
const av2=await etat()
await sous(U.super_admin,'authenticated',async()=>{
  e=await erreur(()=>q(`delete from public.role_permissions where role_id=$1`,[mgr]))
  const e2=await erreur(()=>q(`insert into public.role_permissions (role_id,permission_code) values ($1,'menu_dashboard')`,[mgr]))
  check('ancienne page : son delete et son insert échouent',e!==null && e2!==null,e+' / '+e2)
})
check('… et le rôle est intact',(await etat())===av2)

// ===== mutant : le refus du vide retiré → la répétition l'arrête, rien installé =====
db=await base()
const mutant=lire('roles_permissions_garde.sql').replace(`if cardinality(v_codes) = 0 then`,`if false then`)
e=await erreur(()=>db.exec(mutant))
await db.exec(`rollback`).catch(()=>{})   // l'éditeur SQL fait de même : la transaction en échec est abandonnée
check('mutant (vide accepté) : refusé par la répétition',e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes('liste vide'),e)
check('… rien installé (ni fonction, ni trigger, politiques intactes)',
  (await q(`select count(*)::int n from pg_proc where proname in ('remplacer_permissions_role','role_super_admin')`))[0].n===0 &&
  (await q(`select count(*)::int n from pg_trigger where tgname like 'trg_role%' or tgname like 'trg_permission%'`))[0].n===0 &&
  (await q(`select count(*)::int n from pg_policies where tablename='role_permissions'`))[0].n===4)

db=await base()
e=await erreur(()=>db.exec(lire('roles_permissions_garde.sql').replace(`if old.role_id = public.role_super_admin() then`,`if false then`)))
await db.exec(`rollback`).catch(()=>{})
check('mutant (garde du super admin retirée) : refusé par la répétition, étape nommée',e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes('super admin'),e)
check('… rien installé',(await q(`select count(*)::int n from pg_proc where proname='remplacer_permissions_role'`))[0].n===0)

// ===== retour arrière =====
db=await base()
const politiquesAvant=JSON.stringify(await q(`select policyname,cmd,qual,with_check,roles::text from pg_policies where tablename='role_permissions' order by 1`))
const droitsAvant=JSON.stringify(await q(`select has_table_privilege('authenticated','public.role_permissions',p) d from unnest(array['select','insert','update','delete','truncate']) p`))
const etatAvant=await etat()
await db.exec(lire('roles_permissions_garde.sql'))
for(const i of [1,2]){
  e=await erreur(()=>db.exec(lire('roles_permissions_garde_retour.sql')))
  check(`retour arrière (${i}) passe`,e===null,e)
}
check('retour : politiques identiques à avant',JSON.stringify(await q(`select policyname,cmd,qual,with_check,roles::text from pg_policies where tablename='role_permissions' order by 1`))===politiquesAvant)
check('retour : droits d\'authenticated identiques',JSON.stringify(await q(`select has_table_privilege('authenticated','public.role_permissions',p) d from unnest(array['select','insert','update','delete','truncate']) p`))===droitsAvant)
check('retour : aucun trigger, aucune fonction restante',
  (await q(`select count(*)::int n from pg_trigger where tgname like 'trg_role%' or tgname like 'trg_permission%'`))[0].n===0 &&
  (await q(`select count(*)::int n from pg_proc where proname in ('remplacer_permissions_role','role_super_admin','roles_garde','role_permissions_garde','permission_au_super_admin')`))[0].n===0)
check('retour : aucune permission retirée',(await etat())===etatAvant)
e=await erreur(()=>db.exec(lire('roles_permissions_garde.sql')))
check('réinstallation après retour',e===null,e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
