// Charge le schéma réel (supabase/migrations) dans PGlite, applique
// pays_defaut_source.sql deux fois et vérifie : défaut à la naissance quand
// l'entreprise n'a qu'un pays, rien deviné quand elle en a plusieurs, ajouter
// un pays ne retire rien, pays d'une autre entreprise refusé, seul un
// responsable le change, rattrapage des sources existantes, colonne lisible.
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
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type==='jsonb'?'{}':'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
// Une source webhook exige une empreinte de jeton (sources_import_config_complete).
const src=v=>ins('sources_import',{token_hash:crypto.randomUUID(),...v})
const as=async uid=>q(`select set_config('test.uid',$1,false)`,[uid||''])

// ---- avant le fichier : des sources existent déjà
const UN='11111111-1111-1111-1111-111111111111', DEUX='22222222-2222-2222-2222-222222222222'
await ins('tenants',{id:UN}); await ins('tenants',{id:DEUX})
const AO=(await ins('pays',{tenant_id:UN,nom:'Angola',code:'AO'})).id
const AO2=(await ins('pays',{tenant_id:DEUX,nom:'Angola',code:'AO'})).id
const CG2=(await ins('pays',{tenant_id:DEUX,nom:'Congo',code:'CG'})).id
const ancienne1=(await src({tenant_id:UN,nom:'Boutique',type:'webhook'})).id
const ancienne2=(await src({tenant_id:DEUX,nom:'Shop',type:'webhook'})).id

const FICHIER=fs.readFileSync(R+'sql/pays_defaut_source.sql','utf8')
for (const run of [1,2]) {
  try { await db.exec(FICHIER); check(`pays_defaut_source.sql run ${run}`,true) }
  catch(e){ check(`pays_defaut_source.sql run ${run}`,false,e.message); process.exit(1) }
}
const pd=async id=>(await q(`select pays_defaut from public.sources_import where id=$1`,[id]))[0].pays_defaut

check('rattrapage : entreprise à un pays → ce pays', await pd(ancienne1)===AO, String(await pd(ancienne1)))
check('rattrapage : entreprise à deux pays → rien deviné', await pd(ancienne2)===null, String(await pd(ancienne2)))

// ---- naissance
let s=await src({tenant_id:UN,nom:'Nouvelle',type:'webhook'})
check('naissance, entreprise à un pays → ce pays', s.pays_defaut===AO, String(s.pays_defaut))
s=await src({tenant_id:DEUX,nom:'Nouvelle',type:'webhook'})
check('naissance, entreprise à deux pays → vide', s.pays_defaut===null, String(s.pays_defaut))
s=await src({tenant_id:DEUX,nom:'Choisie',type:'webhook',pays_defaut:CG2})
check('naissance avec un pays choisi → gardé', s.pays_defaut===CG2, String(s.pays_defaut))
let refuse=''
try { await src({tenant_id:UN,nom:'Fraude',type:'webhook',pays_defaut:CG2}) } catch(e){ refuse=e.message }
check('pays d\'une autre entreprise refusé', /n'appartient pas/.test(refuse), refuse)

// ---- ajouter un pays plus tard ne retire rien
const s1=(await src({tenant_id:UN,nom:'Avant expansion',type:'webhook'})).id
await ins('pays',{tenant_id:UN,nom:'Congo',code:'CG'})
check('deuxième pays ajouté : la source garde le sien', await pd(s1)===AO)
s=await src({tenant_id:UN,nom:'Après expansion',type:'webhook'})
check('après l\'expansion, une nouvelle source ne devine plus', s.pays_defaut===null, String(s.pays_defaut))

// ---- qui le change
const SELLER='33333333-3333-3333-3333-333333333333', MANAGER='44444444-4444-4444-4444-444444444444'
await db.exec(`insert into auth.users values ('${SELLER}','s@x'),('${MANAGER}','m@x')`)
await ins('user_roles',{user_id:SELLER,tenant_id:DEUX,role:'seller'})
await ins('user_roles',{user_id:MANAGER,tenant_id:DEUX,role:'manager'})
const cible=(await src({tenant_id:DEUX,nom:'De Sami',type:'webhook',vendeur_id:SELLER})).id
await as(SELLER); refuse=''
try { await q(`update public.sources_import set pays_defaut=$2 where id=$1`,[cible,AO2]) } catch(e){ refuse=e.message }
await as('')
check('le vendeur ne change pas le pays de sa source', /Seul un responsable/.test(refuse) && await pd(cible)===null, refuse)
await as(SELLER); refuse=''
try { await q(`update public.sources_import set nom='Renommée' where id=$1`,[cible]) } catch(e){ refuse=e.message }
await as('')
check('… mais modifie toujours le reste de sa source', refuse==='', refuse)
await as(MANAGER)
await q(`update public.sources_import set pays_defaut=$2 where id=$1`,[cible,AO2])
await as('')
check('un manager le change', await pd(cible)===AO2)
await as(MANAGER); refuse=''
try { await q(`update public.sources_import set pays_defaut=$2 where id=$1`,[cible,AO]) } catch(e){ refuse=e.message }
await as('')
check('même un manager : pas un pays d\'une autre entreprise', /n'appartient pas/.test(refuse), refuse)

// ---- supprimer le pays ne supprime pas la source
await q(`delete from public.pays where id=$1`,[CG2]).catch(()=>{})
const reste=(await q(`select count(*)::int n from public.sources_import where nom='Choisie'`))[0].n
check('pays supprimé : la source reste, sans pays', reste===1 && (await q(`select pays_defaut from public.sources_import where nom='Choisie'`))[0].pays_defaut===null)

// ---- lisible par l'écran
const lisible=(await q(`select has_column_privilege('authenticated','public.sources_import','pays_defaut','select') x`))[0].x
check('authenticated lit pays_defaut', lisible)

try { await db.exec(FICHIER); check('fichier rejoué à la fin', true) } catch(e){ check('fichier rejoué à la fin', false, e.message) }
check('rejeu : le choix du manager tient', await pd(cible)===AO2)

console.log(`\n${ok} passed, ${ko} failed`)
