// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// correctif_urgent_14_10.sql puis nettoyage_triggers_14_10.sql (deux fois chacun)
// et vérifie : droits sur les fonctions, confirmation → livraison a_preparer,
// stock par mouvement, pas d'agent d'un autre pays, charge des livreurs.
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
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
// pglite lacks some Supabase bits: strip event triggers / extensions / owner lines
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
console.log('schema loaded')
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql'])
  for (const run of [1,2]) { try { await db.exec(fs.readFileSync(R+'sql/'+f,'utf8')); check(`${f} run ${run}`,true) } catch(e){ check(`${f} run ${run}`,false,e.message) } }

const priv=async(r,fn)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[r,fn]))[0].x
check('anon cannot vider', !(await priv('anon','public.vider_donnees_operationnelles(uuid)')))
check('authenticated cannot vider', !(await priv('authenticated','public.vider_donnees_operationnelles(uuid)')))
check('postgres can vider', await priv('postgres','public.vider_donnees_operationnelles(uuid)'))
check('anon cannot supprimer_pays', !(await priv('anon','public.supprimer_pays(uuid)')))
check('authenticated can supprimer_pays', await priv('authenticated','public.supprimer_pays(uuid)'))
check('authenticated can receptionner', await priv('authenticated','public.receptionner_expedition(uuid,timestamptz,uuid,jsonb)'))

// ---- data: tenant, pays, zone, livreur, agent, statut Confirmed, produit, entrepot, stock
await db.exec(`set session_replication_role = replica`) // seed without guard triggers
const T='11111111-1111-1111-1111-111111111111', P='22222222-2222-2222-2222-222222222222'
const UL='33333333-3333-3333-3333-333333333333', UA='44444444-4444-4444-4444-444444444444'
await db.exec(`insert into auth.users values ('${UL}','l@x'),('${UA}','a@x')`)
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
// generic insert helper filling NOT NULL columns without default
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
await ins('tenants',{id:T})
await ins('pays',{id:P,tenant_id:T,nom:'Gabon'})
const roleCols=(await cols('user_roles')).map(c=>c.column_name)
await ins('user_roles',{user_id:UL,tenant_id:T,role:'livreur'})
await ins('user_roles',{user_id:UA,tenant_id:T,role:'agent'})
const zcols=(await cols('zones')).map(c=>c.column_name)
await ins('zones',{tenant_id:T,pays_id:P,nom_zone:'Libreville',ville:'Libreville'})
const lcols=(await cols('livreurs')).map(c=>c.column_name)
const liv=await ins('livreurs',{tenant_id:T,user_id:UL,pays_id:P,actif:true,nom:'L',zone:'Libreville'})
await ins('agents',{tenant_id:T,user_id:UA,pays_id:P,actif:true,nom:'A'})
await ins('statuts',{tenant_id:T,nom:'Confirmed',code:'confirmed',declenche_assignation:true})
const prod=await ins('produits',{tenant_id:T,product:'Creme',current_quantity:10})
const ent=await ins('entrepots',{tenant_id:T,nom:'Gabon',pays_id:P,actif:true})
await db.exec(`set session_replication_role = origin`)
await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite) values ($1,$2,$3,'entree',10)`,[T,prod.id,ent.id])

// choisir_livreur must find our driver, otherwise the trigger test proves nothing
const cl=(await q(`select oid::regprocedure::text s from pg_proc where proname='choisir_livreur'`))[0].s
console.log('choisir_livreur signature:',cl)
const found=(await q(`select public.choisir_livreur($1,$2,'Libreville') x`,[T,P]))[0].x
check('choisir_livreur finds a driver (test is meaningful)', found===liv.id, String(found))

const cmd=await ins('commandes',{lead_id:'L1',tenant_id:T,pays_id:P,client_nom:'C',client_telephone:'+24100',ville_zone:'Libreville',produit:'Creme',quantite:2,prix:100})
check('agent auto-assigned (country trigger kept)', !!cmd.agent_id)
try { await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[cmd.id]); check('confirming an order no longer fails',true) }
catch(e){ check('confirming an order no longer fails',false,e.message) }
const lv=(await q(`select * from public.livraisons where commande_id=$1`,[cmd.id]))[0]
check('delivery created as a_preparer', lv?.statut==='a_preparer', JSON.stringify(lv?.statut))

await q(`update public.livraisons set statut='livre' where id=$1`,[lv.id])
const st=(await q(`select quantite_disponible from public.stocks where produit_id=$1 and entrepot_id=$2`,[prod.id,ent.id]))[0]
const pr=(await q(`select current_quantity from public.produits where id=$1`,[prod.id]))[0]
const mv=await q(`select type_mouvement,quantite from public.mouvements_stock where produit_id=$1 order by created_at`,[prod.id])
check('livre: warehouse stock 10 -> 8', st.quantite_disponible===8, JSON.stringify(st))
check('livre: produits 20 -> 18 (10 seed + 10 entree - 2)', pr.current_quantity===18, JSON.stringify(pr))
check('livre: one sortie movement recorded', mv.filter(m=>m.type_mouvement==='sortie').length===1, JSON.stringify(mv))
await q(`update public.livraisons set statut='livre', updated_at=now() where id=$1`,[lv.id]).catch(()=>{})
check('no double sortie on same-status update', (await q(`select count(*)::int n from public.mouvements_stock where type_mouvement='sortie'`))[0].n===1)

// order without any agent in its country stays unassigned (no cross-country assignment)
const P2=(await ins('pays',{tenant_id:T,nom:'Mali'})).id
const cmd2=await ins('commandes',{lead_id:'L2',tenant_id:T,pays_id:P2,client_nom:'D',client_telephone:'+223',produit:'Creme',quantite:1,prix:1})
check('no cross-country agent assignment', cmd2.agent_id===null, String(cmd2.agent_id))
check('debug functions gone', (await q(`select count(*)::int n from pg_proc where proname like 'debug_%'`))[0].n===0)
const UL2='55555555-5555-5555-5555-555555555555'
await db.exec(`set session_replication_role = replica`)
await db.exec(`insert into auth.users values ('${UL2}','l2@x')`)
await ins('user_roles',{user_id:UL2,tenant_id:T,role:'livreur'})
const liv2=await ins('livreurs',{tenant_id:T,user_id:UL2,pays_id:P,actif:true,nom:'L2',zone:'Libreville'})
await ins('livraisons',{tenant_id:T,commande_id:cmd2.id,livreur_id:liv.id,statut:'a_preparer'})
await db.exec(`set session_replication_role = origin`)
let picks=new Set(); for(let i=0;i<10;i++) picks.add((await q(`select public.choisir_livreur($1,$2,'Libreville') x`,[T,P]))[0].x)
check('choisir_livreur prefers the less busy driver', picks.size===1 && picks.has(liv2.id), JSON.stringify([...picks]))
console.log(`\n${ok} passed, ${ko} failed`)
