// La suppression des commandes de la société de test (22/10) : fichier 1
// ne modifie rien, fichier 2 supprime tout chez 17144700 et rien ailleurs,
// et refuse de tourner si l'id vise une vraie entreprise.
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
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type.startsWith('json')?'{}':'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}

const TEST='17144700-2b95-43fa-9849-9e7a8f35104e', REEL='9183429e-0000-0000-0000-000000000000'
await db.exec(`set session_replication_role = replica`)
for (const t of [TEST,REEL]) await ins('tenants',{id:t})
const pT=(await ins('pays',{tenant_id:TEST,nom:'Angola',code:'AO'})).id
const pR=(await ins('pays',{tenant_id:REEL,nom:'Angola',code:'AO'})).id
await ins('produits',{tenant_id:TEST,product:'test'})
for (const n of ['Clearzal','Colon Tea']) await ins('produits',{tenant_id:REEL,product:n,code:n.toLowerCase().replace(/ /g,'')})
const UL='33333333-3333-3333-3333-333333333333'
await db.exec(`insert into auth.users values ('${UL}','l@x')`)
const liv=await ins('livreurs',{tenant_id:TEST,user_id:UL,pays_id:pT,actif:true,nom:'L',zone:'Z'})
const cmd=async(t,pays,produit)=>ins('commandes',{lead_id:'L'+Math.random(),tenant_id:t,pays_id:pays,client_nom:'C',client_telephone:'+1',produit,quantite:1,prix:1})
const ids=[]
for (const p of ['Produit de test','Produit de test','clearzal','colontea','test']) ids.push((await cmd(TEST,pT,p)).id)
const reelles=[(await cmd(REEL,pR,'clearzal')).id,(await cmd(REEL,pR,'Colontea')).id]
await ins('appels',{tenant_id:TEST,commande_id:ids[0]})
await ins('livraisons',{tenant_id:TEST,commande_id:ids[1],livreur_id:liv.id,statut:'livre'})
await ins('paiements',{tenant_id:TEST,commande_id:ids[1],livreur_id:liv.id,montant:1})
await ins('imports_bruts',{tenant_id:TEST,commande_id:ids[2]})
await ins('appels',{tenant_id:REEL,commande_id:reelles[0]})
await db.exec(`set session_replication_role = origin`)

const compte=async(t,tenant)=>(await q(`select count(*)::int n from public.${t} where tenant_id=$1`,[tenant]))[0].n
const L1=fs.readFileSync(R+'sql/commandes_test_1_liste.sql','utf8'), L2=fs.readFileSync(R+'sql/commandes_test_2_suppression.sql','utf8')
const avant=await compte('commandes',TEST)
await db.exec(L1)
check('fichier 1 : rien ne change', await compte('commandes',TEST)===avant && avant===5)
const res=await db.exec(L1)
const parProduit=res[0].rows
check('fichier 1 : compte par produit', parProduit.find(r=>r.produit==='Produit de test').commandes==2 && parProduit.length===4, JSON.stringify(parProduit))
const dep=res[1].rows[0]
check('fichier 1 : dépendances comptées', dep.appels_supprimes==1 && dep.livraisons_supprimees==1 && dep.paiements_supprimes==1 && dep.imports_bruts_gardes==1, JSON.stringify(dep))

await db.exec(L2)
check('fichier 2 : 0 commande chez la société de test', await compte('commandes',TEST)===0)
check('… appels, livraisons, paiements partis', await compte('appels',TEST)===0 && await compte('livraisons',TEST)===0 && await compte('paiements',TEST)===0)
const ib=(await q(`select commande_id from public.imports_bruts where tenant_id=$1`,[TEST]))
check('… imports_bruts gardé, commande_id → null', ib.length===1 && ib[0].commande_id===null)
check('… le catalogue de test reste', await compte('produits',TEST)===1)
check('vraie entreprise : commandes et appels intacts', await compte('commandes',REEL)===2 && await compte('appels',REEL)===1)
try { await db.exec(L2); check('fichier 2 rejoué : sans erreur', true) } catch(e){ check('fichier 2 rejoué : sans erreur', false, e.message) }

let e=null
try { await db.exec(L2.replace(/'17144700-2b95-43fa-9849-9e7a8f35104e'/g, `'${REEL}'`)) } catch(x){ e=x.message }
check('id d\'une vraie entreprise collé par erreur → refusé', /n'est pas la société de test/.test(e||''), String(e))
check('… et rien supprimé', await compte('commandes',REEL)===2)
console.log(`\n${ok} passed, ${ko} failed`)
