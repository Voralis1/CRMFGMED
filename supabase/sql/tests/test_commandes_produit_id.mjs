// commandes_produit_id.sql sur le schéma réel + l'état de PRODUCTION
// (produit_de_commande et stats_dashboard lus le 29/10, tests/fixtures) :
//   · prérequis ; une normalisation qui changerait UNE réponse → §3 arrête le
//     fichier, rien installé ; un trigger fautif → la répétition arrête tout ;
//   · deux passages : le TEXTE des commandes identique octet pour octet,
//     seul produit_id ajouté ; chaque lien = la règle du stock ;
//   · trigger : id envoyé ignoré, texte changé → recalculé, id à la main
//     refusé (navigateur, clé service, éditeur SQL), produit renommé →
//     lien gardé, supprimé → NULL ; rattrapage : remplit les vides, ne
//     détache jamais ;
//   · Top Produits : AVANT (prod) les deux orthographes séparées, APRÈS un
//     seul produit, « Produit non reconnu » sans rang ; un vendeur : les
//     produits d'un autre vendeur tombent dans « non reconnu » ;
//   · produit_de_commande : même texte dans entrepot_commande.sql et ici ;
//   · retour arrière : les deux corps de production remis (md5), colonne
//     retirée, textes intacts ; réinstallation.
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
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql'])
  await db.exec(lire(f))
await db.exec(`alter table public.commandes add column if not exists articles jsonb`)
// Comme en production le 29/10 : l'ancien produit_de_commande (expression recopiée) et stats_dashboard.
const PROD_PRODUIT=lire('tests/fixtures/produit_de_commande_prod_29_10.sql'), PROD_STATS=lire('tests/fixtures/stats_dashboard_prod_29_10.sql')
await db.exec(PROD_PRODUIT); await db.exec(PROD_STATS)
await db.exec(`grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on function public.stats_dashboard(uuid, timestamptz, timestamptz) to authenticated;`)
const FF=fs.readFileSync(process.env.FICHIER||R+'sql/commandes_produit_id.sql','utf8')
const FRET=lire('commandes_produit_id_retour.sql')
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

const T='11111111-1111-1111-1111-111111111111'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', seller2:'aaaaaaaa-0000-0000-0000-000000000008', manager:'aaaaaaaa-0000-0000-0000-000000000002' }
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'})
for (const [r,u] of Object.entries(U)) { await q(`insert into auth.users values ($1,$2)`,[u,r+'@x']); await ins('user_roles',{user_id:u,tenant_id:T,role:r.replace(/\d$/,'')}) }
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})
for (const [nom,code,ferme,decl] of [['Confirmed','confirmed',true,true],['Unreached','unreached',false,false]])
  await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,type:'appel'})
const P={}
for (const [nom,code] of [['product a','product-a'],['product c','product-c'],['Potencia masculina','potencia'],['test',null]])
  P[nom]=(await ins('produits',{tenant_id:T,product:nom,code,current_quantity:0})).id
await db.exec(`set session_replication_role = origin`)
const hasCol=(await cols('produits')).some(c=>c.column_name==='vendeur_id')
let n=0
const commande=async(produit,extra={})=>ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit,quantite:1,prix:10,...extra})
// l'existant, comme le 29/10 : plusieurs orthographes
const textes=['product-c','product-c','product c','Product-a','potencia','potencia','Colontea','colontea','Produit de test','  PRODUCT-C ','test']
const existantes=[]; for (const t of textes) existantes.push(await commande(t,{quantite: t==='product c'?2:1}))
const top=async(uid)=>{
  const lire=()=>q(`select public.stats_dashboard($1, now()-interval '1 day', now()+interval '1 day')->'topProduits' t`,[T])
  return (await (uid ? sous(uid,'authenticated',lire) : lire()))[0].t
}
const topAvant=await top()

// =====================================================================
// A. Prérequis, fautes injectées
// =====================================================================
const FAUSSE=FF.replace("  v_nom := public.texte_normalise(v_texte);","  v_nom := lower(v_texte);")
check('(témoin : normalisation faussée injectée)', FAUSSE!==FF)
let e=await erreur(()=>db.exec('begin;\n'+FAUSSE+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('une normalisation qui change UNE réponse → §3 arrête le fichier, l\'exemple nommé', /ne répond pas comme avant pour \d+ texte/.test(e||''), String(e))
check('… rien installé (ni colonne, ni nouveau corps)', (await q(`select count(*)::int n from information_schema.columns where table_name='commandes' and column_name='produit_id'`))[0].n===0
  && (await q(`select prosrc from pg_proc where proname='produit_de_commande'`))[0].prosrc.includes('regexp_replace'))
const FAUTIF=FF.replace("    select r.produit_id into new.produit_id\n      from public.produit_de_commande(new.tenant_id, new.produit) r;\n    return new;","    return new;")
check('(témoin : trigger fautif injecté)', FAUTIF!==FF)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('trigger qui ne pose pas le lien → la répétition arrête le fichier', /RÉPÉTITION ÉCHOUÉE/.test(e||''), String(e))

// =====================================================================
// B. Installation : le texte ne bouge pas
// =====================================================================
const photo=async()=>JSON.stringify(await q(`select id, produit, quantite, updated_at, statut_confirmation from public.commandes order by id`))
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FF)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('le TEXTE de chaque commande identique octet pour octet (et rien d\'autre ne bouge)', await photo()===avant)
const lien=async id=>(await q(`select produit_id from public.commandes where id=$1`,[id]))[0].produit_id
const attendus={'product-c':P['product c'],'product c':P['product c'],'Product-a':P['product a'],'potencia':P['Potencia masculina'],'  PRODUCT-C ':P['product c'],'test':P['test']}
for (const c of existantes) {
  const a=attendus[c.produit] ?? null
  check(`« ${c.produit} » → ${a?Object.keys(P).find(k=>P[k]===a):'non reconnu'}`, await lien(c.id)===a)
}
check('aucune commande reliée à un autre produit que la règle', (await q(`select count(*)::int n from public.commandes c cross join lateral public.produit_de_commande(c.tenant_id,c.produit) r where c.produit_id is not null and c.produit_id is distinct from r.produit_id`))[0].n===0)
check('répétition : rien ne reste', (await q(`select (select count(*) from public.commandes where lead_id like 'REPETITION-%')+(select count(*) from public.produits where code like 'repet%') n`))[0].n==0)
check('produit_de_commande : plus d\'expression recopiée', !(await q(`select prosrc from pg_proc where proname='produit_de_commande'`))[0].prosrc.includes('regexp_replace'))
// UNE définition : le même texte dans entrepot_commande.sql et dans ce fichier.
const extrait=t=>t.slice(t.indexOf('create or replace function public.produit_de_commande'), t.indexOf('revoke all on function public.produit_de_commande'))
check('produit_de_commande : texte identique dans entrepot_commande.sql et commandes_produit_id.sql', extrait(lire('entrepot_commande.sql'))===extrait(FF) && extrait(FF).length>500)

// =====================================================================
// C. Le trigger
// =====================================================================
let x=await commande('product-a',{produit_id:P['test']})
check('insertion avec un produit_id envoyé → ignoré, relié par le texte', await lien(x.id)===P['product a'])
await q(`update public.commandes set produit='potencia' where id=$1`,[x.id])
check('texte changé → lien recalculé', await lien(x.id)===P['Potencia masculina'])
await q(`update public.commandes set client_nom='Autre' where id=$1`,[x.id])
check('autre colonne changée → lien inchangé', await lien(x.id)===P['Potencia masculina'])
for (const [qui,fn] of [['manager',f=>sous(U.manager,'authenticated',f)],['clé service',f=>sous(null,'service_role',f)],['éditeur SQL',f=>f()]]) {
  e=await erreur(()=>fn(()=>q(`update public.commandes set produit_id=$2 where id=$1`,[x.id,P['test']])))
  check(`${qui} : produit_id écrit à la main → refusé`, /se déduit de son texte/.test(e||''), String(e))
}
await q(`update public.produits set product='Potencia renommé', code='potencia-v2' where id=$1`,[P['Potencia masculina']])
check('produit renommé (nom ET code) → la commande garde son lien et son texte', await lien(x.id)===P['Potencia masculina']
  && (await q(`select produit from public.commandes where id=$1`,[x.id]))[0].produit==='potencia')
const rempli=(await q(`select public.remplir_produits_commandes() n`))[0].n
check('rattrapage après le renommage : ne détache rien', await lien(x.id)===P['Potencia masculina'], String(rempli))
const kneeA=await commande('kneehuile'), kneeB=await commande('KneeHuile ')
check('texte inconnu → non reconnu (NULL)', await lien(kneeA.id)===null)
await db.exec(`set session_replication_role = replica`); const PK=(await ins('produits',{tenant_id:T,product:'Huile du genou',code:'kneehuile'})).id; await db.exec(`set session_replication_role = origin`)
const n2=(await q(`select public.remplir_produits_commandes() n`))[0].n
check('le produit arrive ensuite → le rattrapage relie les commandes restées vides (2)', await lien(kneeA.id)===PK && await lien(kneeB.id)===PK && n2===2, String(n2))
const aSupprimer=await commande('test')
await q(`delete from public.produits where id=$1`,[P['test']])
check('produit supprimé → la commande passe en non reconnu, texte inchangé', await lien(aSupprimer.id)===null
  && (await q(`select produit from public.commandes where id=$1`,[aSupprimer.id]))[0].produit==='test')

// =====================================================================
// D. Top Produits : avant / après
// =====================================================================
const noms=t=>(t||[]).map(r=>`${r.rang ?? '–'}:${r.nom}=${r.qte}`)
check('AVANT (production) : « product-c » et « product c » classés comme deux produits', (topAvant||[]).some(r=>r.nom==='product-c') && (topAvant||[]).some(r=>r.nom==='product c'), JSON.stringify(noms(topAvant)))
const topApres=await top()
const pc=(topApres||[]).find(r=>r.nom==='product c')
check('APRÈS : un seul « product c », toutes orthographes comptées (2+1+1+2 = 5)', pc && pc.qte===5 && !(topApres||[]).some(r=>r.nom==='product-c'), JSON.stringify(noms(topApres)))
const nr=(topApres||[]).at(-1)
check('APRÈS : « Produit non reconnu » en dernier, sans rang', nr?.nom==='Produit non reconnu' && nr.rang==null, JSON.stringify(noms(topApres)))
check('APRÈS : rangs 1..n sans trou, par quantité', (topApres||[]).filter(r=>r.rang!=null).every((r,i,a)=>r.rang===i+1 && (i===0||a[i-1].qte>=r.qte)), JSON.stringify(noms(topApres)))
if (hasCol) {
  // le catch-all : un vendeur ne voit que SES produits ; le reste de ses commandes tombe dans « non reconnu »
  await db.exec(`set session_replication_role = replica`)
  await q(`update public.produits set vendeur_id=$2 where id=$1`,[P['product a'],U.seller])
  await q(`update public.produits set vendeur_id=$2 where id=$1`,[P['product c'],U.seller2])
  await db.exec(`set session_replication_role = origin`)
  const sa=await commande('product-a',{vendeur_id:U.seller}), sc=await commande('product-c',{vendeur_id:U.seller})
  const topV=await top(U.seller)
  check('vendeur : son produit sous son nom', (topV||[]).some(r=>r.nom==='product a' && r.rang!=null), JSON.stringify(noms(topV)))
  check('vendeur : le produit d\'un AUTRE vendeur → « Produit non reconnu », jamais son nom', !(topV||[]).some(r=>r.nom==='product c') && (topV||[]).some(r=>r.nom==='Produit non reconnu' && r.rang==null), JSON.stringify(noms(topV)))
}

// =====================================================================
// E. Retour arrière, réinstallation
// =====================================================================
const textesAvantRetour=JSON.stringify(await q(`select id, produit from public.commandes order by id`))
for (const run of [1,2]) { e=await erreur(()=>db.exec(FRET)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
const md5=async nom=>(await q(`select md5(prosrc) m from pg_proc where proname=$1`,[nom]))[0].m
check('retour : stats_dashboard identique à la production (md5)', await md5('stats_dashboard')==='ad8a7de2cb734f63bc32ddee2b69d377')
check('retour : produit_de_commande identique à la production (md5)', await md5('produit_de_commande')==='4112f39b12057d67b1daaf1a36df44e2')
check('retour : colonne, trigger, fonctions retirés', (await q(`select (select count(*) from information_schema.columns where table_name='commandes' and column_name='produit_id')
  + (select count(*) from pg_trigger where tgname='trg_zz_produit_commande') + (select count(*) from pg_proc where proname in ('commande_produit_id','remplir_produits_commandes')) n`))[0].n==0)
check('retour : aucun texte de commande touché', JSON.stringify(await q(`select id, produit from public.commandes order by id`))===textesAvantRetour)
check('retour : le Top Produits redevient celui de production (par texte)', (await top()||[]).some(r=>r.nom==='product-c'))
e=await erreur(()=>db.exec(FF)); check('réinstallation', e===null, String(e))
check('… les liens sont reposés', await lien(existantes[0].id)===P['product c'])

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
