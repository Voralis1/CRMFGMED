// anon_aucun_droit.sql + _retour.sql (02/11) — le fichier le plus dangereux :
// il change des droits dont dépend chaque politique.
//   · même générateur que la production : les fichiers de test ne diffèrent
//     des fichiers livrés QUE par leurs littéraux ;
//   · aller : anon ne tient plus rien (tables, colonnes, séquences, fonctions) ;
//     les droits effectifs de authenticated, service_role, postgres,
//     supabase_admin identiques objet par objet ; les droits par défaut ne
//     donnent plus rien à anon/PUBLIC (une table et une fonction créées après
//     le prouvent) ; répétition des vrais chemins ; deuxième passage = « déjà » ;
//   · retour : la base = la photo, exactement (lu indépendamment), deux fois ;
//     l'aller repasse après le retour ;
//   · garde-fous : base différente de la photo → refus, rien changé ; droit
//     perdu par un autre rôle (aller sans la redonne) → refus, rien changé ;
//     chemin cassé dans la répétition → refus, rien changé ; retour incomplet
//     → annulé.
import { execFileSync } from 'child_process'
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
for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql']) await db.exec(lire(f))

let n=0
const commande=async(extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,ville_zone:'Nulle part',...extra})
const appel=(c,statut,prec,quand=null,uid=U.agent)=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,$5,$6,'note',10,$7,'{}'::jsonb)`,[c,T,uid,A1,statut,prec,quand]))
const suivi=async id=>(await q(`select nb_tentatives, derniere_tentative_statut, derniere_tentative_le, derniere_action_le, statut_confirmation, date_rappel from public.commandes where id=$1`,[id]))[0]
const lot=(uid,ids,statut,motif=null,date=null,t=T)=>sous(uid,'authenticated',()=>q(`select * from public.changer_statut_lot($1,$2,$3,$4,$5)`,[t,ids,statut,motif,date]))
const par=(res,id)=>res.find(r=>r.commande_id===id)
const dans=(j)=>new Date(Date.now()+j*86400000).toISOString()


await poserPermissions(db, { actions_masse: ['manager','admin','super_admin'], assigner_livreur: ['manager','admin','super_admin'] })
for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql','commandes_statut_lot.sql','historique_affectations.sql','delai_prise_en_charge.sql'])
  await db.exec(lire(f))
// Les droits comme en production : anon partout, par les droits par défaut de postgres et supabase_admin
await db.exec(`
  grant execute on all functions in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges for role supabase_admin in schema public grant execute on functions to anon, authenticated, service_role;
  revoke all on public.historique_statuts, public.historique_affectations from anon, authenticated;`)
// Les données des chemins : un livreur avec une livraison à préparer, des leads « Pending » sans livraison
await db.exec(`set session_replication_role = replica`)
let k=0
const cmd=async(extra={})=>ins('commandes',{lead_id:'P'+(++k),tenant_id:T,pays_id:AO,client_nom:'C'+k,client_telephone:'+1'+k,produit:'X',quantite:1,prix:5,ville_zone:'Z',vendeur_id:U.seller,agent_id:A1,statut_confirmation:'Pending',...extra})
for (let i=0;i<4;i++) await cmd()
const cl=await cmd({statut_confirmation:'Confirmed'})
await ins('livraisons',{tenant_id:T,commande_id:cl.id,livreur_id:L1,statut:'a_preparer'})
await db.exec(`set session_replication_role = origin`)
await q(`select set_config('test.uid','',false)`)

// ---- les fichiers : générés depuis CETTE base, par le générateur de la production
const GEN=R+'sql/tests/generer_anon_aucun_droit.py'
const LECTURE=execFileSync('python3',[GEN,'lecture']).toString()
const photo=async()=>(await q(LECTURE+' order by 1, 2'))
const OUT=fs.mkdtempSync('/tmp/anon-')
const generer=async()=>{ fs.writeFileSync(OUT+'/photo.json', JSON.stringify(await photo())); execFileSync('python3',[GEN,'ecrire',OUT+'/photo.json',OUT,'TEST']) }
await generer()
const ALLER=fs.readFileSync(OUT+'/anon_aucun_droit.sql','utf8'), RETOUR=fs.readFileSync(OUT+'/anon_aucun_droit_retour.sql','utf8')
const sansLitteraux=t=>t.replace(/-- ===== LITTÉRAUX[\s\S]*?-- ===== FIN DES LITTÉRAUX =====\n/,'').replace(/02\/11\/2026|TEST/g,'DATE')
check('aller livré = aller de test, aux littéraux près', sansLitteraux(lire('anon_aucun_droit.sql'))===sansLitteraux(ALLER))
check('retour livré = retour de test, aux littéraux près', sansLitteraux(lire('anon_aucun_droit_retour.sql'))===sansLitteraux(RETOUR))

// ---- lectures indépendantes (pas les fonctions du fichier)
const ROLES=['authenticated','service_role','postgres','supabase_admin']
const effectifs=async()=>JSON.stringify(await q(`
  select r.role, 'rel' quoi, c.relname::text objet, p, has_table_privilege(r.role, c.oid, p) ok
    from (select unnest($1::text[]) role) r, pg_class c, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')
  union all select r.role, 'seq', c.relname, p, has_sequence_privilege(r.role, c.oid, p)
    from (select unnest($1::text[]) role) r, pg_class c, unnest(array['SELECT','UPDATE','USAGE']) p where c.relnamespace='public'::regnamespace and c.relkind='S'
  union all select r.role, 'col', c.relname||'.'||a.attname, p, has_column_privilege(r.role, c.oid, a.attnum, p)
    from (select unnest($1::text[]) role) r, pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped, unnest(array['SELECT','INSERT','UPDATE']) p
   where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')
  union all select r.role, 'fn', p.oid::regprocedure::text, 'EXECUTE', has_function_privilege(r.role, p.oid, 'EXECUTE')
    from (select unnest($1::text[]) role) r, pg_proc p where p.pronamespace='public'::regnamespace
  order by 1,2,3,4`,[ROLES]))
const anonTient=async()=>(await q(`
  select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','S')
     and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE'))
  union all select p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')`)).map(x=>x.relname)
let avis=[]
const run=async sql=>{ avis=[]; try { await db.exec(sql,{onNotice:n=>avis.push(n.message)}); return null } catch(e){ try{await db.exec('rollback')}catch(_){}; await db.exec('reset role').catch(()=>{}); return e.message } }

const PHOTO0=JSON.stringify(await photo()), EFF0=await effectifs()
check('avant : anon tient beaucoup (comme en production)', (await anonTient()).length>50, (await anonTient()).length)

// =====================================================================
// A. Garde-fous : RIEN ne change quand ils refusent
// =====================================================================
// base différente de la photo
await db.exec(`grant select on public.zones to supabase_admin`)
let e=await run(ALLER)
check('base ≠ photo → refus nommé', /n'est plus celle de la photo.*rel zones/.test(e||''), String(e))
await db.exec(`revoke select on public.zones from supabase_admin`)
check('… rien changé', JSON.stringify(await photo())===PHOTO0)
// aller sans la redonne explicite → un rôle perd une fonction
const SANS_REDON=ALLER.replace("    execute format('grant execute on function %s to %I', r.oid::regprocedure, r.role);\n","")
check('(témoin : redonne retirée)', SANS_REDON!==ALLER)
e=await run(SANS_REDON)
check('un autre rôle perd une exécution → VÉRIFICATION ÉCHOUÉE, nommée', /VÉRIFICATION ÉCHOUÉE, un autre rôle.*fn .* : avant true, après false/.test(e||''), String(e).slice(0,300))
check('… rien changé (droits, droits par défaut)', JSON.stringify(await photo())===PHOTO0 && await effectifs()===EFF0)
// un chemin qui n'aboutit plus
const CASSE=ALLER.replace("from public.changer_statut_lot(v_t, array[v_lead2], 'Unreached', null, null)","from public.changer_statut_lot(v_t, array[v_lead2], 'Statut inexistant', null, null)")
check('(témoin : lot cassé)', CASSE!==ALLER)
e=await run(CASSE)
check('un chemin cassé (le lot du manager) → RÉPÉTITION ÉCHOUÉE', /RÉPÉTITION ÉCHOUÉE \(étape : manager \(lot\)\)/.test(e||''), String(e).slice(0,300))
check('… rien changé', JSON.stringify(await photo())===PHOTO0)
// un appel qui ne s'enregistre plus (service_role perd enregistrer_appel APRÈS la photo de l'aller)
const CASSE2=ALLER.replace("  -- §5 ----","  execute 'revoke execute on function public.enregistrer_appel(uuid, uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb) from service_role';\n  -- §5 ----")
e=await run(CASSE2)
check('service_role perd enregistrer_appel → la vérification totale l\'attrape avant même la répétition', /VÉRIFICATION ÉCHOUÉE, un autre rôle.*service_role fn enregistrer_appel/.test(e||''), String(e).slice(0,300))
check('… rien changé', JSON.stringify(await photo())===PHOTO0)

// =====================================================================
// B. L'aller
// =====================================================================
const nCmd=(await q(`select count(*)::int n from public.commandes`))[0].n
e=await run(ALLER)
check('aller : passe', e===null, String(e))
check('aller : il le dit (répétition réussie)', avis.some(a=>/fait\. anon ne tient plus rien.*Répétition .* réussie et annulée/.test(a)), avis.join(' | ').slice(0,300))
check('aller : la répétition n\'a rien laissé', (await q(`select count(*)::int n from public.commandes`))[0].n===nCmd && (await q(`select count(*)::int n from public.commandes where lead_id like 'REPETITION-ANON-%'`))[0].n===0)
check('anon ne tient plus RIEN dans public', (await anonTient()).length===0, JSON.stringify(await anonTient()))
check('authenticated, service_role, postgres, supabase_admin : droits identiques, objet par objet, colonne par colonne', await effectifs()===EFF0)
check('anon garde l\'accès au schéma (USAGE)', (await q(`select has_schema_privilege('anon','public','USAGE') v`))[0].v===true)
check('v_pays_livrables : security_barrier', (await q(`select reloptions::text o from pg_class where relname='v_pays_livrables'`))[0].o.includes('security_barrier=true'))
// les droits par défaut : un nouvel objet ne donne plus rien à anon
await db.exec(`create table public.zz_nouvelle (id int); create function public.zz_nouvelle_fn() returns int language sql as 'select 1'; create sequence public.zz_seq;`)
const nv=(await q(`select has_table_privilege('anon','public.zz_nouvelle','SELECT') a, has_table_privilege('authenticated','public.zz_nouvelle','SELECT') b,
  has_function_privilege('anon','public.zz_nouvelle_fn()','EXECUTE') c, has_function_privilege('authenticated','public.zz_nouvelle_fn()','EXECUTE') d,
  has_function_privilege('service_role','public.zz_nouvelle_fn()','EXECUTE') f, has_sequence_privilege('anon','public.zz_seq','USAGE') g`))[0]
check('nouvelle table : anon rien, authenticated oui (défaut)', nv.a===false && nv.b===true, JSON.stringify(nv))
check('nouvelle fonction : ni anon ni PUBLIC ; authenticated et service_role oui', nv.c===false && nv.d===true && nv.f===true, JSON.stringify(nv))
check('nouvelle séquence : anon rien', nv.g===false)
await db.exec(`drop table public.zz_nouvelle; drop function public.zz_nouvelle_fn(); drop sequence public.zz_seq;`)
// les vrais chemins, vus de dehors
const seller=(await sous(U.seller,'authenticated',()=>q(`select count(*)::int n from public.commandes`)))[0].n
check('vendeur : lit ses commandes', seller===(await q(`select count(*)::int n from public.commandes where vendeur_id=$1`,[U.seller]))[0].n && seller>0)
const lead=(await q(`select id from public.commandes where statut_confirmation='Pending' and not exists (select 1 from public.livraisons v where v.commande_id=commandes.id) limit 1`))[0].id
e=await erreur(()=>sous(null,'service_role',()=>q(`select public.enregistrer_appel($1,$2,$3,$4,'Unreached','Pending','note',20,null,'{}'::jsonb)`,[lead,T,U.agent,A1])))
check('confirmer-appel (clé service) : l\'appel s\'enregistre', e===null, String(e))
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select * from public.changer_statut_lot($1,$2,'Pending','test',null)`,[T,[lead]])))
check('manager : un lot passe', e===null, String(e))
for (const [nom,sql] of [['lire commandes','select 1 from public.commandes limit 1'],['is_super_admin()','select public.is_super_admin()'],['setval du n° de suivi',`select setval('public.commandes_tracking_seq', 1)`],['TRUNCATE','truncate public.motifs_retour'],['v_pays_livrables','select 1 from public.v_pays_livrables']]) {
  e=await erreur(()=>sous(null,'anon',()=>q(sql)))
  check(`anon : ${nom} refusé`, /permission denied/.test(e||''), String(e))
}
// deuxième passage
e=await run(ALLER)
check('aller relancé : « déjà en place », rien fait', e===null && avis.some(a=>/déjà en place/.test(a)), String(e)+' '+avis.join('|'))

// =====================================================================
// C. Le retour
// =====================================================================
const RETOUR_CASSE=RETOUR.replace("  for r in select * from _acl_lu where quoi in ('rel', 'col', 'fn') order by quoi, objet loop","  for r in select * from _acl_lu where quoi in ('rel', 'col') order by quoi, objet loop")
check('(témoin : retour sans les fonctions)', RETOUR_CASSE!==RETOUR)
const PHOTO1=JSON.stringify(await photo())
e=await run(RETOUR_CASSE)
check('retour incomplet → RETOUR INCOMPLET, nommé', /RETOUR INCOMPLET.*fn /.test(e||''), String(e).slice(0,300))
check('… il s\'annule en entier (la base reste comme après l\'aller)', JSON.stringify(await photo())===PHOTO1)
for (const run2 of [1,2]) { e=await run(RETOUR); check(`retour, passage ${run2}`, e===null, String(e)) }
check('retour : la base = la photo d\'avant, exactement (lecture indépendante)', JSON.stringify(await photo())===PHOTO0)
check('retour : droits effectifs de tous les rôles comme avant', await effectifs()===EFF0)
check('retour : anon a retrouvé ses droits (état d\'avant)', (await anonTient()).length>50)
e=await run(ALLER)
check('l\'aller repasse après le retour', e===null && avis.some(a=>/fait\. anon ne tient plus rien/.test(a)), String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
