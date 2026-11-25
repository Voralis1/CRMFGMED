// choisir_fermes.sql + vendeur_sans_equipe.sql (02/11) sur le schéma réel :
//   · choisir_agent / choisir_livreur : un compte connecté (toute entreprise) ne
//     peut plus les appeler ; une commande créée par un vendeur, un manager ou
//     le service role reçoit TOUJOURS son agent (trigger) ; même agent qu'avant
//     pour la même file ; nettoyage_triggers_14_10.sql relancé ne rouvre rien ;
//   · v_caisses_livreur / v_commandes_a_assigner : par rôle, les lignes AVANT
//     et APRÈS — identiques pour manager, admin, ceo, agent, livreur,
//     super_admin, service role ; vendeur → 0 ; les deux fichiers deux fois ;
//   · les retours arrière remettent l'état d'avant (droits, lignes).
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
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
alter role service_role bypassrls;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql'])
  await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}

const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', livreur:'aaaaaaaa-0000-0000-0000-000000000006',
          manager2:'aaaaaaaa-0000-0000-0000-000000000007', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const urCols=(await cols('user_roles')).map(c=>c.column_name)
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
for (const [r,u] of Object.entries(U)) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  const v={user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,'')}
  if (urCols.includes('nom')) v.nom = r==='manager' ? 'Mme Manager' : null
  await ins('user_roles',v)
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
for (const [t,p] of [[T,AO],[T,CG],[T2,AO2]]) await ins('entrepots',{tenant_id:t,nom:'E'+p.slice(0,4),pays_id:p,actif:true})
for (const t of [T,T2]) for (const [nom,code,ferme,decl,rap] of [['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
  ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
  await ins('statuts',{tenant_id:t,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
// un statut ouvert propre au Congo
await ins('statuts',{tenant_id:T,nom:'Occupé',code:'occupe',ferme_le_lead:false,declenche_assignation:false,necessite_rappel:false,type:'appel',pays_id:CG})
const A1=(await ins('agents',{tenant_id:T,nom:'Agent Un',user_id:U.agent,pays_id:AO,actif:true})).id
const L1=(await ins('livreurs',{tenant_id:T,nom:'Livreur Un',user_id:U.livreur,pays_id:AO,actif:true,zone:'Luanda'})).id
await db.exec(`set session_replication_role = origin`)

await poserPermissions(db)
await db.exec(lire('agents_livreurs_lecture.sql'))
// l'état de production : choisir_* ouvertes à authenticated (lu le 02/11)
await db.exec(`grant execute on function public.choisir_agent(uuid, uuid) to authenticated, service_role;
  grant execute on function public.choisir_livreur(uuid, uuid, text, uuid) to authenticated, service_role;`)

// Données : commandes du vendeur confirmées sans livreur, livraisons, paiements encaissés.
await db.exec(`set session_replication_role = replica`)
const vendeur2=crypto.randomUUID()
await q(`insert into auth.users values ($1,'seller2@x')`,[vendeur2]); await ins('user_roles',{user_id:vendeur2,tenant_id:T,role:'seller'})
let n=0
const cmd=async(extra)=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'X',quantite:1,prix:100*n,ville_zone:'Luanda',vendeur_id:U.seller,agent_id:A1,...extra})
for (let i=0;i<3;i++) await cmd({statut_confirmation:'Confirmed'})                 // à assigner
await cmd({statut_confirmation:'Confirmed',vendeur_id:vendeur2})
for (let i=0;i<4;i++) { const c=await cmd({statut_confirmation:'Confirmed',statut_livraison:'livre'})
  await ins('livraisons',{tenant_id:T,commande_id:c.id,livreur_id:L1,statut:'livre'})
  await ins('paiements',{tenant_id:T,commande_id:c.id,livreur_id:L1,montant:c.prix,statut:'encaisse',methode:'cod'}) }
const c2=await cmd({statut_confirmation:'Confirmed',vendeur_id:vendeur2,statut_livraison:'livre'})
await ins('livraisons',{tenant_id:T,commande_id:c2.id,livreur_id:L1,statut:'livre'})
await ins('paiements',{tenant_id:T,commande_id:c2.id,livreur_id:L1,montant:7,statut:'encaisse',methode:'cod'})
await db.exec(`set session_replication_role = origin`)
await poserPermissions(db)   // le second vendeur reçoit son role_id (après les données : l'aide remet les triggers)

const VUES=['v_caisses_livreur','v_commandes_a_assigner']
const ROLES=['seller','manager','admin','ceo','agent','livreur','super_admin']
const lignes=async(v)=>JSON.stringify((await q(`select * from public.${v}`)).map(r=>JSON.stringify(r)).sort())
const photo=async()=>{ const o={}
  for (const r of ROLES) for (const v of VUES) o[r+'/'+v]=await sous(U[r],'authenticated',()=>lignes(v))
  for (const v of VUES) o['service_role/'+v]=await sous(null,'service_role',()=>lignes(v))
  for (const v of VUES) o['editeur/'+v]=await lignes(v)
  return o }
const peutAppeler=async(role)=>sous(U[role],'authenticated',async()=>{ try { await q(`select public.choisir_agent($1,$2)`,[T,AO]); return true } catch(e){ return /permission denied/.test(e.message) ? false : 'ERREUR '+e.message } })
const agentDuTrigger=async(uid,role)=>{ const id=(await sous(uid,role,()=>q(`insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id) values ($1,$2,'N','+1','X',1,1,$3,'Luanda',$4) returning id`,[T,'N'+(++n),AO,U.seller])))[0].id
  return (await q(`select agent_id from public.commandes where id=$1`,[id]))[0].agent_id }

const COLS_AVANT=(await q(`select table_name, string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name in ('v_caisses_livreur','v_commandes_a_assigner') group by 1 order by 1`))
const AVANT=await photo()
check('avant : un vendeur lit des lignes de v_caisses_livreur (le trou)', AVANT['seller/v_caisses_livreur']!=='[]')
check('avant : un vendeur lit agent_id dans v_commandes_a_assigner (le trou)', /agent_id/.test(AVANT['seller/v_commandes_a_assigner']) && AVANT['seller/v_commandes_a_assigner']!=='[]')
check('avant : un vendeur appelle choisir_agent (le trou)', await peutAppeler('seller')===true)
check('avant : le manager d\'une AUTRE entreprise aussi', await peutAppeler('manager2')===true)

const FS=lire('vendeur_sans_equipe.sql'), FC=lire('choisir_fermes.sql'), RS=lire('vendeur_sans_equipe_retour.sql'), RC=lire('choisir_fermes_retour.sql')
for (const run of [1,2]) { let e=await erreur(()=>db.exec(FS)); check(`vendeur_sans_equipe.sql, passage ${run}`, e===null, String(e)) }
for (const run of [1,2]) { let e=await erreur(()=>db.exec(FC)); check(`choisir_fermes.sql, passage ${run}`, e===null, String(e)) }
const APRES=await photo()
for (const k of Object.keys(AVANT)) {
  if (k.startsWith('seller/')) check(`après : ${k} → 0 ligne`, APRES[k]==='[]', APRES[k])
  else check(`après : ${k} identique (${JSON.parse(AVANT[k]).length} ligne(s))`, APRES[k]===AVANT[k])
}
check('après : les vues gardent leurs colonnes', JSON.stringify((await q(`select table_name, string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name in ('v_caisses_livreur','v_commandes_a_assigner') group by 1 order by 1`)))===JSON.stringify(COLS_AVANT))
for (const r of ROLES) check(`après : ${r} ne peut plus appeler choisir_agent`, await peutAppeler(r)===false)
check('après : manager2 (autre entreprise) non plus', await peutAppeler('manager2')===false)
check('après : anon non plus', (await q(`select has_function_privilege('anon','public.choisir_agent(uuid,uuid)','execute') a, has_function_privilege('anon','public.choisir_livreur(uuid,uuid,text,uuid)','execute') b, has_function_privilege('authenticated','public.choisir_livreur(uuid,uuid,text,uuid)','execute') c`))[0].a===false)
check('après : service_role peut toujours', (await q(`select has_function_privilege('service_role','public.choisir_agent(uuid,uuid)','execute') a`))[0].a===true)
check('après : commande créée par un vendeur → agent posé par le trigger', await agentDuTrigger(U.seller,'authenticated')===A1)
check('après : … par un manager → agent posé', await agentDuTrigger(U.manager,'authenticated')===A1)
check('après : … par le service role (API) → agent posé', await agentDuTrigger(null,'service_role')===A1)
await db.exec(lire('nettoyage_triggers_14_10.sql'))
check('nettoyage_triggers_14_10.sql relancé : toujours fermé', await peutAppeler('seller')===false && await peutAppeler('manager')===false)
check('… et le trigger pose toujours l\'agent', await agentDuTrigger(U.seller,'authenticated')===A1)

for (const run of [1,2]) { let e=await erreur(()=>db.exec(RS)); check(`retour vues, passage ${run}`, e===null, String(e)) }
for (const run of [1,2]) { let e=await erreur(()=>db.exec(RC)); check(`retour droits, passage ${run}`, e===null, String(e)) }
const RETOUR=await photo()
check('retour : chaque rôle relit exactement ce qu\'il lisait avant', Object.keys(AVANT).every(k=>RETOUR[k]===AVANT[k]))
check('retour : le vendeur rappelle choisir_agent (état d\'avant)', await peutAppeler('seller')===true)
check('retour : plus de marque sur les vues', (await q(`select obj_description('public.v_caisses_livreur'::regclass,'pg_class') a, obj_description('public.v_commandes_a_assigner'::regclass,'pg_class') b`))[0].a===null)
let e=await erreur(()=>db.exec(FS)); check('réinstaller après le retour', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
