// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production depuis (correctifs 14/10, entrepot_commande.sql), puis applique
// commandes_pays_entreprise.sql deux fois.
//
// La règle : le pays d'une commande appartient à son entreprise. Pour TOUT
// le monde : navigateur (authenticated + RLS), clé service (auth.uid() NULL,
// le chemin de confirmer-appel), éditeur SQL (postgres).
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
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
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
-- Comme chez Supabase : la clé service ignore la RLS. C'est ce qui rend
-- le trigger indispensable sur ce chemin.
alter role service_role bypassrls;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
const FICHIER=fs.readFileSync(R+'sql/commandes_pays_entreprise.sql','utf8')

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}

// ---- deux entreprises, chacune son « Angola » (comme en production le 23/10)
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const VENDEUR='aaaaaaaa-0000-0000-0000-000000000001', MANAGER='aaaaaaaa-0000-0000-0000-000000000002'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
for (const [u,t,r] of [[VENDEUR,T,'seller'],[MANAGER,T,'manager']]) {
  await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
  await ins('user_roles',{user_id:u,tenant_id:t,role:r})
}
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
const eAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const eCG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
const eAO2=(await ins('entrepots',{tenant_id:T2,nom:'Angola',pays_id:AO2,actif:true})).id
await db.exec(`set session_replication_role = origin`)

let n=0
const ligne=(pays,extra={})=>({lead_id:'L'+(++n),tenant_id:T,pays_id:pays,client_nom:'C',client_telephone:'+244'+n,produit:'Clearzal',quantite:1,prix:10,...extra})
const commande=async(pays,extra={})=>ins('commandes',ligne(pays,extra))
const lire=async id=>(await q(`select pays_id, tenant_id, entrepot_id from public.commandes where id=$1`,[id]))[0]

// ---- 0. AVANT le fichier : le trou existe (sinon le test ne prouve rien)
const trou=await commande(AO2)
check('avant le fichier : un pays d\'une autre entreprise passe (le trou)', (await lire(trou.id)).pays_id===AO2)

// ---- 1. §1 arrête tout s'il existe déjà une commande fautive
const e1=await erreur(()=>db.exec(FICHIER))
check('§1 : une commande fautive existante → le fichier s\'arrête', /Arrêt : 1 commande/.test(e1||''), String(e1))
check('… et la nomme (id + lead)', (e1||'').includes(trou.id) && (e1||'').includes(trou.lead_id), String(e1))
check('… sans rien installer (ni trigger ni fonction)',
  (await q(`select count(*)::int n from pg_trigger where tgname='trg_zy_pays_commande'`))[0].n===0 &&
  (await q(`select count(*)::int n from pg_proc where proname='commande_pays_de_l_entreprise'`))[0].n===0)
await q(`delete from public.commandes where id=$1`,[trou.id])

// ---- 2. le fichier passe deux fois, sans toucher à l'existant
const existante=await commande(AO)
const photo=async()=>JSON.stringify(await q(`select * from public.commandes order by id`))
const avant=await photo()
for (const run of [1,2]) {
  const e=await erreur(()=>db.exec(FICHIER))
  check(`fichier, passage ${run}`, e===null, String(e))
}
check('aucune commande existante modifiée (la tentative du §3 est annulée)', await photo()===avant)
check('un seul trigger trg_zy_pays_commande', (await q(`select count(*)::int n from pg_trigger where tgname='trg_zy_pays_commande'`))[0].n===1)
const f=(await q(`select prosecdef, proacl::text acl from pg_proc where proname='commande_pays_de_l_entreprise'`))[0]
check('fonction SECURITY DEFINER', f.prosecdef===true)
check('… non exécutable par anon / authenticated', !/(^|[{,])(anon|authenticated)=/.test(f.acl||'') && !/(^|[{,])=X/.test(f.acl||''), String(f.acl))

// ---- 3. l'éditeur SQL (postgres) : pas d'exemption
let e=await erreur(()=>commande(AO2))
check('éditeur SQL : insert avec un pays d\'une autre entreprise → refusé', /^Pays refusé/.test(e||''), String(e))
check('… le message ne nomme pas le pays étranger', !/Angola/.test(e||''))
e=await erreur(()=>q(`update public.commandes set pays_id=$2 where id=$1`,[existante.id,AO2]))
check('éditeur SQL : update vers un pays d\'une autre entreprise → refusé', /^Pays refusé/.test(e||''), String(e))
check('… la commande garde son pays', (await lire(existante.id)).pays_id===AO)
e=await erreur(()=>q(`update public.commandes set tenant_id=$2 where id=$1`,[existante.id,T2]))
check('déplacer la commande vers une autre entreprise, pays inchangé → refusé', /^Pays refusé/.test(e||''), String(e))
e=await erreur(()=>q(`update public.commandes set pays_id=gen_random_uuid() where id=$1`,[existante.id]))
check('pays inexistant → c\'est le trigger qui répond, avant la clé étrangère', /^Pays refusé/.test(e||''), String(e))
e=await erreur(()=>commande(AO2,{entrepot_id:eAO2}))
check('pays ET entrepôt d\'une autre entreprise → le refus parle du pays (passe avant trg_zz)', /^Pays refusé/.test(e||''), String(e))

// ---- 4. la clé service (auth.uid() NULL) : le chemin de confirmer-appel
e=await sous('', 'service_role', ()=>q(`update public.commandes set pays_id=$2 where id=$1`,[existante.id,AO2]))
  .then(()=>null, x=>x.message)
check('clé service : update vers un pays étranger → refusé (pas d\'exemption auth.uid() NULL)', /^Pays refusé/.test(e||''), String(e))
e=await sous('', 'service_role', ()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix) values ('S1',$1,$2,'C','+1','Clearzal',1,1)`,[T,AO2]))
  .then(()=>null, x=>x.message)
check('clé service : insert avec un pays étranger → refusé', /^Pays refusé/.test(e||''), String(e))
const s1=await sous('', 'service_role', ()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix) values ('S2',$1,$2,'C','+1','Clearzal',1,1) returning id, entrepot_id`,[T,AO]))
check('clé service : insert avec un pays de l\'entreprise → accepté, entrepôt du pays', s1[0]?.entrepot_id===eAO, JSON.stringify(s1))

// ---- 5. le navigateur (authenticated + RLS)
e=await sous(VENDEUR,'authenticated',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,vendeur_id) values ('V1',$1,$2,'C','+1','Clearzal',1,1,$3)`,[T,AO2,VENDEUR]))
  .then(()=>null, x=>x.message)
check('vendeur, console du navigateur : insert avec un pays étranger → refusé', /^Pays refusé/.test(e||''), String(e))
const v2=await sous(VENDEUR,'authenticated',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,vendeur_id) values ('V2',$1,$2,'C','+1','Clearzal',1,1,$3) returning id`,[T,AO,VENDEUR]))
check('vendeur : insert avec son pays → accepté', !!v2[0]?.id)
e=await sous(MANAGER,'authenticated',()=>q(`update public.commandes set pays_id=$2 where id=$1`,[existante.id,AO2]))
  .then(()=>null, x=>x.message)
check('manager : update vers un pays étranger → refusé', /^Pays refusé/.test(e||''), String(e))

// ---- 6. ce qui doit continuer à marcher
let u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning pays_id, entrepot_id`,[existante.id,CG]))[0]
check('changer pour un autre pays de l\'entreprise → accepté, l\'entrepôt suit', u.pays_id===CG && u.entrepot_id===eCG, JSON.stringify(u))
u=(await q(`update public.commandes set pays_id=$2 where id=$1 returning pays_id`,[existante.id,CG]))[0]
check('réécrire le même pays → accepté', u.pays_id===CG)
u=(await q(`update public.commandes set statut_confirmation='Unreached' where id=$1 returning id`,[existante.id]))[0]
check('un update qui ne touche pas au pays → accepté', !!u?.id)
const autre=await ins('commandes',{lead_id:'X1',tenant_id:T2,pays_id:AO2,client_nom:'C',client_telephone:'+1',produit:'x',quantite:1,prix:1})
check('l\'autre entreprise avec son propre Angola → accepté', autre.entrepot_id===eAO2, String(autre.entrepot_id))
// Le même pays, mais lu comme tenant_id = celui de l'autre : déplacer AVEC un pays de la cible passe.
u=(await q(`update public.commandes set tenant_id=$2, pays_id=$3 where id=$1 returning tenant_id`,[autre.id,T,AO]))[0]
check('déplacer vers une entreprise AVEC un pays de cette entreprise → accepté (le trigger ne juge que la cohérence)', u.tenant_id===T)

// ---- 7. §3 sans second pays étranger dans la base : repli sur un pays inventé
await db.exec(`set session_replication_role = replica`)
await q(`delete from public.commandes where tenant_id=$1`,[T2])
await q(`delete from public.entrepots where tenant_id=$1`,[T2])
await q(`delete from public.pays where tenant_id=$1`,[T2])
await db.exec(`set session_replication_role = origin`)
const avant3=await photo()
e=await erreur(()=>db.exec(FICHIER))
check('une seule entreprise avec des pays : le fichier passe quand même (pays inventé)', e===null, String(e))
check('… aucune commande modifiée', await photo()===avant3)

// ---- 8. §3 détecte un trigger désactivé
await db.exec(`alter table public.commandes disable trigger trg_zy_pays_commande`)
const sec3=FICHIER.slice(FICHIER.indexOf('-- §3'))
e=await erreur(()=>db.exec(sec3))
check('§3 seul, trigger désactivé → l\'échec est dit', /absent ou désactivé/.test(e||''), String(e))
await db.exec(`alter table public.commandes enable trigger trg_zy_pays_commande`)
// trigger présent mais vidé de sa règle : la tentative passe, §3 doit le dire (et l'annuler)
await db.exec(`create or replace function public.commande_pays_de_l_entreprise() returns trigger language plpgsql as $$ begin return new; end $$`)
await db.exec(`set session_replication_role = replica`)
const AO3=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
await db.exec(`set session_replication_role = origin`)
const avant8=await photo()
e=await erreur(()=>db.exec(sec3))
check('§3 seul, règle vidée → « ÉCHEC » dit', /ÉCHEC — un pays d'une autre entreprise a été accepté/.test(e||''), String(e))
check('… et la tentative est annulée', await photo()===avant8)
// et sans trigger du tout, la tentative passerait : §3 doit le dire (on rejoue §3 après un drop)
await db.exec(`drop trigger trg_zy_pays_commande on public.commandes`)
e=await erreur(()=>db.exec(sec3))
check('§3 seul, trigger supprimé → l\'échec est dit', /absent ou désactivé/.test(e||''), String(e))
check('… et toujours aucune commande modifiée', await photo()===avant3)
e=await erreur(()=>db.exec(FICHIER))
check('rejouer le fichier remet le trigger', e===null && (await q(`select count(*)::int n from pg_trigger where tgname='trg_zy_pays_commande'`))[0].n===1, String(e))

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
