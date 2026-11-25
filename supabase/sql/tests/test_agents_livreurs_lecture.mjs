// agents_livreurs_lecture.sql sur le schéma réel (politiques de production) :
//   · AVANT : un livreur et un vendeur lisent tous les agents et tous les
//     livreurs (téléphones compris) — le témoin du trou ;
//   · deux passages ; APRÈS : livreur = sa fiche seule, vendeur = rien (ou sa
//     fiche), agent / manager / admin / ceo = toute l'entreprise comme avant,
//     super_admin tout, autre entreprise rien ;
//   · le livreur met encore à jour sa fiche ; v_caisses_livreur lui rend sa
//     ligne avec son nom ;
//   · une politique FOR ALL → refusé ; une règle fautive → la répétition
//     arrête tout ; le retour arrière remet les politiques d'avant mot pour mot.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true),''),
                  nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
grant authenticated to postgres;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const FF=fs.readFileSync(process.env.FICHIER||R+'sql/agents_livreurs_lecture.sql','utf8'), FR=lire('agents_livreurs_lecture_retour.sql')
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
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005', livreur:'aaaaaaaa-0000-0000-0000-000000000006',
          livreur2:'aaaaaaaa-0000-0000-0000-000000000007', super_admin:'aaaaaaaa-0000-0000-0000-000000000009', manager2:'aaaaaaaa-0000-0000-0000-00000000000a' }
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'Test'}); await ins('tenants',{id:T2,nom_entreprise:'Autre'})
for (const [r,u] of Object.entries(U)) { await q(`insert into auth.users values ($1,$2)`,[u,r+'@x']); await ins('user_roles',{user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,'')}) }
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
await ins('agents',{tenant_id:T,nom:'Agent Un',user_id:U.agent,pays_id:AO,actif:true})
await ins('agents',{tenant_id:T,nom:'Agent Deux',user_id:null,pays_id:AO,actif:true})
const L1=(await ins('livreurs',{tenant_id:T,nom:'Livreur Un',user_id:U.livreur,telephone:'+244 111',pays_id:AO,actif:true,zone:'Luanda'})).id
await ins('livreurs',{tenant_id:T,nom:'Livreur Deux',user_id:U.livreur2,telephone:'+244 222',pays_id:AO,actif:true,zone:'Benguela'})
await ins('livreurs',{tenant_id:T2,nom:'Livreur Autre',user_id:null,telephone:'+1',actif:true})
const C=(await ins('commandes',{lead_id:'L1',tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+1',produit:'X',quantite:1,prix:10})).id
const V=(await ins('livraisons',{commande_id:C,livreur_id:L1,tenant_id:T,statut:'livre'})).id
await ins('paiements',{tenant_id:T,commande_id:C,livraison_id:V,livreur_id:L1,montant:35000,statut:'encaisse'}).catch(()=>{})
await db.exec(`set session_replication_role = origin`)
const voit=async(r,t)=>(await sous(U[r],'authenticated',()=>q(`select nom from public.${t} order by nom`))).map(x=>x.nom)
const politiques=async()=>JSON.stringify(await q(`select tablename, policyname, cmd, roles::text, qual from pg_policies where tablename in ('agents','livreurs') order by 1,2`))
const avantPol=await politiques()

// AVANT
check('AVANT : un livreur lit tous les livreurs (téléphones compris) — le trou', (await voit('livreur','livreurs')).length===2)
check('AVANT : un vendeur lit tous les agents', (await voit('seller','agents')).length===2)

// faute : une règle qui laisse les livreurs lire tout → la répétition arrête le fichier
await db.exec(`set session_replication_role = replica`); await q(`update public.livreurs set user_id=$1 where nom='Livreur Un'`,[U.livreur]); await db.exec(`set session_replication_role = origin`)
const FAUTIF=FF.replace(/not in \('seller', 'livreur'\)/g, "not in ('seller')")
check('(témoin : faute injectée)', FAUTIF!==FF)
let e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('règle qui oublie le livreur → la vérification du texte arrête le fichier, politiques d\'avant intactes', /n'a pas la règle vendeur\/livreur/.test(e||'') && await politiques()===avantPol, String(e))
// une faute que le TEXTE ne voit pas (les bons mots, la mauvaise logique) : seule la répétition la voit
const FAUTIF2=FF.replace(/or user_id = auth\.uid\(\)\)\)/g, "or user_id = auth.uid() or true))")
check('(témoin : faute de logique injectée)', FAUTIF2!==FF)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF2+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('règle aux bons mots mais ouverte à tous → la répétition (sous les droits d\'un livreur) arrête le fichier', /RÉPÉTITION ÉCHOUÉE.*livreur : 2 livreur/s.test(e||'') && await politiques()===avantPol, String(e))
// FOR ALL → refusé
await db.exec(`create policy tout_agents on public.agents for all to authenticated using (true)`)
e=await erreur(()=>db.exec(FF)); await db.exec('rollback').catch(()=>{})
check('une politique FOR ALL existe → refusé, nommée', /FOR ALL.*agents\.tout_agents/.test(e||''), String(e))
await db.exec(`drop policy tout_agents on public.agents`)

for (const run of [1,2]) { e=await erreur(()=>db.exec(FF)); check(`fichier, passage ${run}`, e===null, String(e)) }

// APRÈS
check('livreur : sa fiche seule dans livreurs', JSON.stringify(await voit('livreur','livreurs'))==='["Livreur Un"]')
check('livreur : aucun agent', (await voit('livreur','agents')).length===0)
check('livreur : plus aucun téléphone d\'un autre livreur', !(await sous(U.livreur,'authenticated',()=>q(`select telephone from public.livreurs`))).some(r=>r.telephone==='+244 222'))
check('vendeur : aucun livreur, aucun agent', (await voit('seller','livreurs')).length===0 && (await voit('seller','agents')).length===0)
for (const r of ['agent','manager','admin','ceo']) check(`${r} : comme avant (2 agents, 2 livreurs)`, (await voit(r,'agents')).length===2 && (await voit(r,'livreurs')).length===2)
check('super_admin : tout (3 livreurs, deux entreprises)', (await voit('super_admin','livreurs')).length===3)
check('manager d\'une autre entreprise : rien de celle-ci', !(await voit('manager2','livreurs')).includes('Livreur Un'))
const nMaj=(await sous(U.livreur,'authenticated',()=>q(`update public.livreurs set telephone='+244 999' where user_id=$1 returning id`,[U.livreur]))).length
check('livreur : met encore à jour SA fiche', nMaj===1)
const caisse=await sous(U.livreur,'authenticated',()=>q(`select livreur_nom from public.v_caisses_livreur`)).catch(e=>[{erreur:e.message}])
check('livreur : v_caisses_livreur lui rend sa ligne, avec son nom (ou rien s\'il n\'a pas de paiement)', caisse.every(r=>r.livreur_nom==='Livreur Un' || r.livreur_nom===undefined && !r.erreur), JSON.stringify(caisse))
check('livreur : mon_livreur_id() le trouve encore (fonction propriétaire)', (await sous(U.livreur,'authenticated',()=>q(`select public.mon_livreur_id() m`)))[0].m===L1)

// retour
for (const run of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
const apres=JSON.parse(await politiques()), avant=JSON.parse(avantPol)
const norm=a=>a.map(p=>`${p.tablename}|${p.policyname}|${p.cmd}|${p.roles}|${String(p.qual).replace(/\s+/g,' ')}`).sort()
check('retour : les politiques de production remises, mot pour mot', JSON.stringify(norm(apres))===JSON.stringify(norm(avant)), JSON.stringify(norm(apres)))
check('retour : un livreur relit tous les livreurs (comme avant)', (await voit('livreur','livreurs')).length===2)
e=await erreur(()=>db.exec(FF)); check('réinstallation', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
