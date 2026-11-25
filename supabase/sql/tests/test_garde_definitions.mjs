// La garde des définitions (02/11) sur le schéma réel :
//   · les fichiers anciens, lancés dans l'ordre de la prod, marquent ce qu'ils
//     créent ; nettoyage → entrepot_commande : le plus récent l'emporte ;
//   · les corps des fichiers qui définissent aujourd'hui les 7 fonctions
//     (extraits tels quels) ont EXACTEMENT le md5 lu en production le 02/11 ;
//   · les 5 fichiers anciens relancés deux fois en entier : aucun des 7 corps
//     ne bouge, chacun dit « gardée » ; TÉMOIN : les mêmes fichiers d'avant le
//     02/11 (AVANT=<dossier>) remettent les anciens corps ;
//   · une fonction marquée par le fichier ancien lui-même est réécrite ;
//   · garde_definitions.sql : marque, rejouable, refuse un corps changé, une
//     marque étrangère, une fonction absente — et alors ne marque RIEN ;
//   · les retours arrière qui remettent un ancien corps posent la marque de
//     l'ancien fichier, qui peut alors être relancé ;
//   · garde_definitions_retour.sql efface les marques, deux fois.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ try { await db.exec('rollback') } catch(_){} return e.message } }
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
await db.exec(schema)
// Ce test reconstruit l'état du 02/11 : le fichier qui a changé depuis est lu dans sa
// version du 02/11 (fixture). Son changement du 03/11 est testé dans
// test_stock_livraison_autre_vendeur.mjs.
const VERSION_02_11={'stock_livraison_autre_vendeur.sql':'tests/fixtures/stock_livraison_autre_vendeur_02_11.sql',
  'renvoyer_en_attente.sql':'tests/fixtures/renvoyer_en_attente_02_11.sql'}
const lire=f=>fs.readFileSync(R+'sql/'+(VERSION_02_11[f]||f),'utf8')
const AVANT=process.env.AVANT   // dossier des fichiers d'avant la garde (témoin)

// Ce que la prod a lu le 02/11.
const F={
  'public.produits_en_stock(uuid, uuid[])':                   ['produits_proprietaire.sql',        'ada9a6a777f3dac5c46aa3d5f432e0de'],
  'public.fn_ajuster_stock_livraison()':                      ['stock_livraison_autre_vendeur.sql','8226f286b1d0731294abcabb6cbc7ce4'],
  'public.statut_pending_commande()':                         ['renvoyer_en_attente.sql',          '78176ec3baeccc7d9c8c39970deb60b1'],
  'public.stats_dashboard(uuid, timestamptz, timestamptz)':   ['commandes_produit_id.sql',         '376fa0fc31d11e0ec9c69f6d87ab94fb'],
  'public.auto_affecter_livreur()':                           ['livreur_par_zone.sql',             'b9f604fa62a038ef8b8fd940ecdc09bc'],
  'public.choisir_livreur(uuid, uuid, text, uuid)':           ['livreur_par_zone.sql',             'fa9e0378d533b0aed933f75028156cd5'],
  'public.ecrire_historique_statut()':                        ['commandes_statut_lot.sql',         '6555320b93a3b7f63bbdd863c869d36d'],
}
const ANCIENS=['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','statut_pending.sql','historique_statuts.sql']
const etat=async()=>Object.fromEntries(await Promise.all(Object.keys(F).map(async f=>{
  const r=(await q(`select md5(prosrc) m, obj_description(oid,'pg_proc') c from pg_proc where oid=to_regprocedure($1)`,[f]))[0]
  return [f, r||{m:null,c:null}] })))
// L'instruction create … ; du fichier, telle quelle.
const instruction=(texte,nom)=>{
  const re=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+nom+'\\s*\\(','i')
  const s=texte.search(re); if(s<0) throw new Error('absente : '+nom)
  const tag=/\bas\s+(\$\w*\$)/i.exec(texte.slice(s)); const a=s+tag.index+tag[0].length
  const fin=texte.indexOf(tag[1],a)+tag[1].length
  const pv=texte.indexOf(';',fin), garde=texte.indexOf('\n$def$',fin)
  return garde>=0 && garde<pv ? texte.slice(s,garde)+';' : texte.slice(s,pv+1)
}
const nomDe=f=>f.match(/public\.(\w+)\(/)[1]
const sigDe=f=>f.slice(f.indexOf('('))
let avis=[]
const execAvis=async sql=>{ avis=[]; return db.exec(sql,{onNotice:n=>avis.push(n.message)}) }

// -----------------------------------------------------------------------------
// A. Les fichiers anciens dans l'ordre de la prod (base vierge des marques)
// -----------------------------------------------------------------------------
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql'])
  { const e=await erreur(()=>db.exec(lire(f))); check(`A. ${f} passe sur le schéma réel`, e===null, String(e)) }
// Données comme test_commandes_statut_lot.mjs : les répétitions des fichiers en ont besoin.
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
for (const f of ['statut_pending.sql','historique_statuts.sql'])

  { const e=await erreur(()=>db.exec(lire(f))); check(`A. ${f} passe sur le schéma réel`, e===null, String(e)) }
let s=await etat()
check('A. produits_en_stock marquée entrepot_commande', s['public.produits_en_stock(uuid, uuid[])'].c==='fichier: entrepot_commande.sql', s['public.produits_en_stock(uuid, uuid[])'].c)
check('A. fn_ajuster : nettoyage puis entrepot_commande → le plus récent l\'emporte', s['public.fn_ajuster_stock_livraison()'].c==='fichier: entrepot_commande.sql', s['public.fn_ajuster_stock_livraison()'].c)
check('A. choisir_livreur marquée nettoyage', s['public.choisir_livreur(uuid, uuid, text, uuid)'].c==='fichier: nettoyage_triggers_14_10.sql')
check('A. auto_affecter_livreur marquée correctif', s['public.auto_affecter_livreur()'].c==='fichier: correctif_urgent_14_10.sql')
check('A. statut_pending_commande + stats_dashboard marquées statut_pending', s['public.statut_pending_commande()'].c==='fichier: statut_pending.sql' && s['public.stats_dashboard(uuid, timestamptz, timestamptz)'].c==='fichier: statut_pending.sql')
check('A. ecrire_historique_statut marquée historique_statuts', s['public.ecrire_historique_statut()'].c==='fichier: historique_statuts.sql')
const vue=async()=>({c:(await q(`select obj_description(to_regclass('public.v_historique_statuts'),'pg_class') c`))[0].c,
  lot:(await q(`select count(*)::int n from information_schema.columns where table_name='v_historique_statuts' and column_name='lot_id'`))[0].n===1})
check('A. vue v_historique_statuts marquée historique_statuts', (await vue()).c==='fichier: historique_statuts.sql')
// Une fonction marquée par le fichier lui-même est réécrite (rejouer un fichier ancien seul reste possible).
await db.exec(`create or replace function public.auto_affecter_livreur() returns trigger language plpgsql as $$ begin return new; end $$`)
await db.exec(lire('correctif_urgent_14_10.sql'))
s=await etat()
check('A. sa propre marque → réécrite', s['public.auto_affecter_livreur()'].m!==null && (await q(`select position('a_preparer' in prosrc)>0 x from pg_proc where oid='public.auto_affecter_livreur()'::regprocedure`))[0].x)

// -----------------------------------------------------------------------------
// B. Les corps d'aujourd'hui, extraits des fichiers qui les définissent
// -----------------------------------------------------------------------------
// prérequis des corps d'aujourd'hui : les fichiers de la prod qui les posent, lancés en vrai,
// puis ce que produits_proprietaire.sql et livreur_par_zone.sql apportent.
for (const f of ['leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql','commandes_statut_lot.sql'])
  { const e=await erreur(()=>db.exec(lire(f))); check(`B. prérequis ${f} installé`, e===null, String(e)) }
await db.exec(`alter table public.produits add column if not exists vendeur_id uuid`)
await db.exec(instruction(lire('livreur_par_zone.sql'),'livreur_pour_commande'))
for (const [f,[fich]] of Object.entries(F)) {
  const e=await erreur(()=>db.exec(instruction(lire(fich), nomDe(f))+`\ncomment on function ${f} is null;`))
  check(`B. corps de ${fich} installé (${nomDe(f)})`, e===null, String(e))
}
s=await etat()
for (const [f,[fich,m]] of Object.entries(F)) check(`B. ${nomDe(f)} : md5 = celui lu en production le 02/11`, s[f].m===m, s[f].m)
const PROD=Object.fromEntries(Object.entries(F).map(([f,[,m]])=>[f,m]))

// -----------------------------------------------------------------------------
// C. garde_definitions.sql
// -----------------------------------------------------------------------------
const G=lire('garde_definitions.sql'), GR=lire('garde_definitions_retour.sql')
// refus : un corps changé → rien de marqué
await db.exec(instruction(lire('nettoyage_triggers_14_10.sql').replace(/[\s\S]*?(create or replace function public\.choisir_livreur)/i,'$1'),'choisir_livreur'))
let e=await erreur(()=>db.exec(G))
s=await etat()
check('C. corps changé → refusé, nommé', /choisir_livreur.*n'a plus le corps/.test(e||''), String(e))
check('C. … et RIEN n\'est marqué', Object.values(s).every(x=>x.c===null), JSON.stringify(Object.values(s).map(x=>x.c)))
await db.exec(instruction(lire('livreur_par_zone.sql'),'choisir_livreur'))
// refus : une marque étrangère
await db.exec(`comment on function public.auto_affecter_livreur() is 'autre chose'`)
e=await erreur(()=>db.exec(G)); s=await etat()
check('C. commentaire étranger → refusé, nommé, rien de marqué', /auto_affecter_livreur.*autre chose/.test(e||'') && Object.entries(s).every(([f,x])=>f.includes('auto_affecter')||x.c===null), String(e))
await db.exec(`comment on function public.auto_affecter_livreur() is null`)
for (const run of [1,2]) { e=await erreur(()=>db.exec(G)); check(`C. garde_definitions.sql, passage ${run}`, e===null, String(e)) }
s=await etat()
for (const [f,[fich]] of Object.entries(F)) check(`C. ${nomDe(f)} marquée ${fich}`, s[f].c==='fichier: '+fich, s[f].c)
check('C. aucun corps modifié', Object.entries(s).every(([f,x])=>x.m===PROD[f]))
check('C. vue marquée commandes_statut_lot (elle a lot_id)', (await vue()).c==='fichier: commandes_statut_lot.sql' && (await vue()).lot)

// -----------------------------------------------------------------------------
// D. Les 5 fichiers anciens relancés en entier, deux fois
// -----------------------------------------------------------------------------
for (const run of [1,2]) for (const f of ANCIENS) {
  e=await erreur(()=>execAvis(lire(f)))
  check(`D. ${f} relancé (passage ${run}) : passe`, e===null, String(e))
  const attendus={'correctif_urgent_14_10.sql':1,'nettoyage_triggers_14_10.sql':2,'entrepot_commande.sql':2,'statut_pending.sql':2,'historique_statuts.sql':2}[f]
  check(`D. ${f} (passage ${run}) : dit « gardée » ${attendus} fois`, avis.filter(a=>/gardée/.test(a)).length===attendus, avis.filter(a=>/gardée/.test(a)).join(' | '))
}
s=await etat()
check('D. vue v_historique_statuts : lot_id toujours là, marque intacte', (await vue()).lot && (await vue()).c==='fichier: commandes_statut_lot.sql')
for (const [f] of Object.entries(F)) check(`D. ${nomDe(f)} : corps intact, marque intacte`, s[f].m===PROD[f] && s[f].c==='fichier: '+F[f][0], JSON.stringify(s[f]))
// le fichier qui définit la fonction la réécrit toujours (et la marque)
for (const fich of [...new Set(Object.values(F).map(([x])=>x))]) {
  for (const [f] of Object.entries(F).filter(([,[x]])=>x===fich)) {
    e=await erreur(()=>db.exec(instruction(lire(fich), nomDe(f))+`\ncomment on function ${f} is 'fichier: ${fich}';`))
    check(`D. ${fich} garde la main sur ${nomDe(f)}`, e===null, String(e))
  }
  const t=lire(fich)
  for (const [f] of Object.entries(F).filter(([,[x]])=>x===fich))
    check(`D. ${fich} pose sa marque sur ${nomDe(f)} (texte du fichier)`, t.includes(`comment on function public.${nomDe(f)}${sigDe(f).replace('(','(')} is 'fichier: ${fich}';`))
}

// -----------------------------------------------------------------------------
// E. Témoin : les fichiers d'AVANT la garde remettent les anciens corps
// -----------------------------------------------------------------------------
if (AVANT) {
  // historique_statuts.sql d'avant échoue en entier (la vue) : témoin à part, dans une transaction annulée
  e=await erreur(()=>db.exec(fs.readFileSync(AVANT+'/historique_statuts.sql','utf8')))
  check('E. TÉMOIN : historique_statuts.sql d\'avant échouait en entier sur la vue', /cannot drop columns from view/.test(e||''), String(e))
  await db.exec(`begin`); await db.exec(fs.readFileSync(AVANT+'/historique_statuts.sql','utf8').replace(/create or replace view public\.v_historique_statuts[\s\S]*?;\n/,'').replace(/(revoke all on public\.v_historique_statuts[^;]*;|grant select on public\.v_historique_statuts[^;]*;)/g,''))
  check('E. TÉMOIN : … et, vue retirée, il remettait l\'ancien trigger d\'historique', (await etat())['public.ecrire_historique_statut()'].m!==PROD['public.ecrire_historique_statut()'])
  await db.exec(`rollback`)
  for (const f of ANCIENS.filter(f=>f!=='historique_statuts.sql')) await db.exec(fs.readFileSync(AVANT+'/'+f,'utf8'))
  s=await etat()
  const changes=Object.entries(s).filter(([f,x])=>x.m!==PROD[f]).map(([f])=>nomDe(f))
  // fn_ajuster : la copie d'entrepot_commande est IDENTIQUE à celle d'aujourd'hui (et passe en dernier)
  check('E. TÉMOIN : sans la garde, les 5 autres corps à copie différente sont remplacés', changes.length===5 && !changes.includes('fn_ajuster_stock_livraison') && !changes.includes('ecrire_historique_statut'), changes.join(','))
  await db.exec(fs.readFileSync(AVANT+'/nettoyage_triggers_14_10.sql','utf8'))
  check('E. TÉMOIN : nettoyage d\'avant seul remplace fn_ajuster_stock_livraison', (await etat())['public.fn_ajuster_stock_livraison()'].m!==PROD['public.fn_ajuster_stock_livraison()'])
  for (const [f,[fich]] of Object.entries(F)) await db.exec(instruction(lire(fich), nomDe(f)))
  s=await etat()
  check('E. corps d\'aujourd\'hui remis', Object.entries(s).every(([f,x])=>x.m===PROD[f]))
} else console.log('(E. témoin non lancé : AVANT=<dossier des fichiers d\'avant le 02/11>)')

// -----------------------------------------------------------------------------
// F. Retours arrière : l'ancien corps porte la marque de l'ancien fichier
// -----------------------------------------------------------------------------
for (const [ret,fn,ancien] of [['commandes_statut_lot_retour.sql','public.ecrire_historique_statut()','historique_statuts.sql'],
                               ['renvoyer_en_attente_retour.sql','public.statut_pending_commande()','statut_pending.sql'],
                               ['commandes_produit_id_retour.sql','public.stats_dashboard(uuid, timestamptz, timestamptz)','statut_pending.sql']]) {
  const t=lire(ret)
  const corps=x=>{ const m=/\bas\s+(\$\w*\$)([\s\S]*?)\1/i.exec(x); return m[2] }
  check(`F. ${ret} remet le corps de ${ancien} et sa marque`, corps(instruction(t,nomDe(fn)))===corps(instruction(lire(ancien),nomDe(fn))) && t.includes(`comment on function ${fn} is 'fichier: ${ancien}';`))
  // l'effet : après le retour, relancer l'ancien fichier n'est pas bloqué par une marque fausse
  await db.exec(instruction(t,nomDe(fn))+`\ncomment on function ${fn} is 'fichier: ${ancien}';`)
  await db.exec(lire(ancien))
  const x=(await etat())[fn]
  check(`F. après ${ret}, ${ancien} relancé réécrit ${nomDe(fn)} (sa marque)`, x.c==='fichier: '+ancien && x.m!==PROD[fn], JSON.stringify(x))
  await db.exec(instruction(lire(F[fn][0]),nomDe(fn))+`\ncomment on function ${fn} is 'fichier: ${F[fn][0]}';`)
}

// -----------------------------------------------------------------------------
// G. Retour arrière de la garde
// -----------------------------------------------------------------------------
for (const run of [1,2]) { e=await erreur(()=>db.exec(GR)); check(`G. garde_definitions_retour.sql, passage ${run}`, e===null, String(e)) }
s=await etat()
check('G. plus aucune marque, aucun corps changé', Object.entries(s).every(([f,x])=>x.c===null && x.m===PROD[f]))
check('G. vue : marque effacée', (await vue()).c===null)
await db.exec(`comment on function public.auto_affecter_livreur() is 'note humaine'`); await db.exec(GR)
check('G. un commentaire qui n\'est pas une marque est laissé', (await etat())['public.auto_affecter_livreur()'].c==='note humaine')
await db.exec(`comment on function public.auto_affecter_livreur() is null`)
e=await erreur(()=>db.exec(G)); check('G. réinstaller après le retour : accepté', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
