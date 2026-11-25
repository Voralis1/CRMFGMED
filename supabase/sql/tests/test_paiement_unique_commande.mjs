// paiement_unique_commande.sql (03/11) sur le schéma réel :
//   · AVANT (témoin) : deux paiements pour une commande sont acceptés ;
//   · un doublon existant → le fichier s'arrête, NOMME la commande, ne crée rien ;
//   · fichier deux fois ; second paiement refusé (éditeur SQL, clé service, livreur) ;
//     un paiement par commande pour deux commandes différentes : accepté ;
//   · index du même nom mais faux → refus nommé ;
//   · mutant (index non unique) → la répétition l'arrête ;
//   · retour arrière deux fois → un doublon redevient possible ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('paiement_unique_commande.sql'), RET=lire('paiement_unique_commande_retour.sql')
const T='11111111-1111-1111-1111-111111111111', UL='aaaaaaaa-0000-0000-0000-000000000006'
let db, LIV, C1, C2, C3
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const payer=(c,m=10)=>q(`insert into public.paiements (commande_id,livreur_id,tenant_id,montant,methode,statut) values ($1,$2,$3,$4,'cod','en_attente')`,[c,LIV,T,m])

async function base(){
  db=new PGlite()
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
  alter role service_role bypassrls;`)
  let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
  schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
  await db.exec(schema)
  await db.exec(`grant usage on schema public to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T})
  await q(`insert into auth.users values ($1,'l@x')`,[UL])
  await ins('user_roles',{user_id:UL,tenant_id:T,role:'livreur'})
  const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
  LIV=(await ins('livreurs',{tenant_id:T,user_id:UL,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  const cmd=async i=>(await ins('commandes',{lead_id:'L'+i,tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+i,produit:'p',quantite:1,prix:10,tracking_number:'FG00000000'+i})).id
  C1=await cmd(1); C2=await cmd(2); C3=await cmd(3)
  await db.exec(`set session_replication_role = origin`)
}

// ===== témoin + doublon existant =====
await base()
await payer(C1); let e=await erreur(()=>payer(C1))
check('AVANT (témoin) : deux paiements pour la même commande acceptés', e===null, e)
e=await erreur(()=>db.exec(F))
check('doublon existant → le fichier s\'arrête et NOMME la commande', e?.includes('FG000000001') && e?.includes('2 paiements'), e)
check('… rien créé', (await q(`select count(*)::int n from pg_indexes where indexname='paiements_commande_unique'`))[0].n===0)

// ===== installation =====
await base()
await payer(C1)
for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }
check('l\'index est unique (commande_id)', (await q(`select indexdef from pg_indexes where indexname='paiements_commande_unique'`))[0]?.indexdef==='CREATE UNIQUE INDEX paiements_commande_unique ON public.paiements USING btree (commande_id)')
check('les données ne bougent pas (1 paiement)', (await q(`select count(*)::int n from public.paiements`))[0].n===1)
e=await erreur(()=>payer(C1))
check('éditeur SQL : second paiement pour la même commande → refusé', e?.includes('paiements_commande_unique'), e)
e=await sous(null,'service_role',()=>erreur(()=>payer(C1)))
check('clé service (confirmer-livraison) : refusé aussi', e?.includes('paiements_commande_unique'), e)
e=await erreur(()=>payer(C2))
check('une AUTRE commande : son paiement passe', e===null, e)
e=await erreur(()=>payer(C3,0))
check('montant 0 sur une troisième commande : passe (la règle ne regarde que la commande)', e===null, e)
check('3 commandes, 3 paiements', (await q(`select count(*)::int n from public.paiements`))[0].n===3)

// ===== index du même nom, faux =====
await base()
await db.exec(`create index paiements_commande_unique on public.paiements (tenant_id)`)
e=await erreur(()=>db.exec(F))
check('index du même nom mais pas « unique (commande_id) » → refus nommé', e?.includes('n\'est pas « unique (commande_id) »'), e)

// ===== mutant : index non unique =====
await base()
await payer(C1)
const MUTANT=F.replace('create unique index if not exists paiements_commande_unique','create index if not exists paiements_commande_unique')
  .replace(`indexdef = 'CREATE UNIQUE INDEX paiements_commande_unique ON public.paiements USING btree (commande_id)'`,`true`)
check('(témoin : index non unique injecté)', MUTANT!==F)
e=await erreur(()=>db.exec(MUTANT))
check('mutant « index non unique » : arrêté par la répétition', e?.includes('RÉPÉTITION ÉCHOUÉE'), e)
check('… rien créé', (await q(`select count(*)::int n from pg_indexes where indexname='paiements_commande_unique'`))[0].n===0)

// ===== retour =====
await base()
await payer(C1)
await db.exec(F)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
check('… index retiré', (await q(`select count(*)::int n from pg_indexes where indexname='paiements_commande_unique'`))[0].n===0)
e=await erreur(()=>payer(C1))
check('… un second paiement redevient possible (le trou est rouvert)', e===null, e)
await q(`delete from public.paiements where commande_id=$1 and montant=10 and ctid <> (select min(ctid) from public.paiements where commande_id=$1)`,[C1])
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
