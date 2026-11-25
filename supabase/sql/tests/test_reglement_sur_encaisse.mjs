// reglement_sur_encaisse.sql (03/11) sur le schéma réel :
//   · AVANT (témoin) : livrée mais argent pas remis → à régler ; montant = prix
//     même si le livreur a encaissé moins ; « vendeur » manager → à régler ;
//   · fichier deux fois, avis « quitte la liste » ;
//   · APRÈS : en_attente / encaisse → pas à régler ; remis → à régler, montant
//     encaissé ; manager / super admin comme vendeur → absent ; déjà dans un
//     relevé → absent ; copie de statut fausse dans les deux sens → la livraison décide ;
//   · colonnes : les 12 d'avant dans le même ordre + montant_encaisse ;
//     security_invoker reste on ; droits inchangés ;
//   · par rôle : manager toute l'entreprise, vendeur les siennes, manager d'une
//     autre entreprise rien ;
//   · mutant (condition « remis » retirée) → arrêté par la vérification §3 ;
//   · retour arrière deux fois = la vue d'avant (définition, droits) ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('reglement_sur_encaisse.sql'), RET=lire('reglement_sur_encaisse_retour.sql')
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', seller2:'aaaaaaaa-0000-0000-0000-000000000011', manager:'aaaaaaaa-0000-0000-0000-000000000002',
          super_admin:'aaaaaaaa-0000-0000-0000-000000000009', livreur:'aaaaaaaa-0000-0000-0000-000000000006', manager2:'aaaaaaaa-0000-0000-0000-000000000007' }
let db, AO, LIV, n=0
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
// Une commande livrée avec son paiement : statut du paiement, montant encaissé, copie de statut sur la commande.
const cas=async(nom,{vendeur=U.seller,prix=10000,paiement='remis',encaisse=prix,livraison='livre',copie='livre',tenant=T}={})=>{
  await db.exec(`set session_replication_role = replica`)
  const c=(await ins('commandes',{lead_id:nom,tenant_id:tenant,pays_id:AO,client_nom:'C',client_telephone:'+244'+(++n),produit:'p',quantite:1,prix,vendeur_id:vendeur,statut_livraison:copie})).id
  if (livraison) await ins('livraisons',{tenant_id:tenant,commande_id:c,livreur_id:LIV,statut:livraison})
  if (paiement) await ins('paiements',{tenant_id:tenant,commande_id:c,livreur_id:LIV,montant:encaisse,methode:'cod',statut:paiement})
  await db.exec(`set session_replication_role = origin`)
  return c
}
const liste=async()=>Object.fromEntries((await q(`select lead_id, prix, montant_encaisse from public.v_commandes_a_regler`)).map(r=>[r.lead_id,r]))
const listeAvant=async()=>Object.fromEntries((await q(`select lead_id, prix from public.v_commandes_a_regler`)).map(r=>[r.lead_id,r]))

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
  // les droits lus en prod le 03/11 sur la vue (anon : rien)
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    revoke all on all tables in schema public from anon;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T}); await ins('tenants',{id:T2})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,''),email:r+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  LIV=(await ins('livreurs',{tenant_id:T,user_id:U.livreur,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  await db.exec(`set session_replication_role = origin`)
  await cas('REMIS')
  await cas('EN_ATTENTE',{paiement:'en_attente'})
  await cas('ENCAISSE',{paiement:'encaisse'})
  await cas('MOINS',{prix:10000,encaisse:8000})
  await cas('MANAGER',{vendeur:U.manager,prix:987})
  await cas('SUPERADMIN',{vendeur:U.super_admin,prix:0})
  await cas('COPIE_FAUSSE_LIVRE',{livraison:'retour',copie:'livre'})
  await cas('COPIE_VIDE',{copie:null})
  await cas('SELLER2',{vendeur:U.seller2})
  const deja=await cas('DEJA_RELEVE')
  const reg=(await ins('reglements',{tenant_id:T,vendeur_id:U.seller,periode_debut:'2026-11-01',periode_fin:'2026-11-03',methode:'especes'})).id
  await db.exec(`set session_replication_role = replica`)
  await ins('reglements_commandes',{commande_id:deja,reglement_id:reg,tenant_id:T,montant:10000})
  await db.exec(`set session_replication_role = origin`)
}

// ===== AVANT (témoins) =====
await base()
const defAvant=(await q(`select pg_get_viewdef('public.v_commandes_a_regler'::regclass,true) d`))[0].d
// mêmes entrées dans l'ACL ; l'ordre n'a pas de sens
const droits=async()=>(await q(`select array_to_string(array(select unnest(relacl)::text order by 1),',') a from pg_class where oid='public.v_commandes_a_regler'::regclass`))[0].a
const droitsAvant=await droits()
let L=await listeAvant()
check('AVANT (témoin) : argent pas remis (en_attente) → à régler', 'EN_ATTENTE' in L)
check('AVANT (témoin) : encaissé 8 000 sur 10 000 → la liste dit 10 000', Number(L.MOINS?.prix)===10000)
check('AVANT (témoin) : « vendeur » manager → à régler', 'MANAGER' in L)
check('AVANT (témoin) : livraison en retour mais copie « livre » → à régler', 'COPIE_FAUSSE_LIVRE' in L)

// ===== installation =====
let avis=[]
for (const i of [1,2]) { avis=[]; const e=await erreur(()=>db.exec(F,{onNotice:m=>avis.push(m.message)})); check(`fichier, passage ${i}`, e===null, e) }
const avis1=avis
avis=[]; await base(); await db.exec(F,{onNotice:m=>avis.push(m.message)})
check('§1 : chaque commande qui quitte la liste est nommée avec sa raison',
  avis.some(a=>a.includes('EN_ATTENTE') && a.includes('pas encore remis')) && avis.some(a=>a.includes('MANAGER') && a.includes('pas un vendeur'))
  && avis.some(a=>a.includes('COPIE_FAUSSE_LIVRE') && a.includes('livraison pas')), avis.join(' | '))
check('§1 : au 2e passage, plus personne ne quitte la liste', avis1.some(a=>a.includes('0 commande(s) quittent')), avis1.join(' | '))

L=await liste()
check('remis → à régler', 'REMIS' in L)
check('en_attente → PAS à régler', !('EN_ATTENTE' in L))
check('encaisse (pas remis) → PAS à régler', !('ENCAISSE' in L))
check('montant = l\'encaissé : 8 000 (prix 10 000)', Number(L.MOINS?.montant_encaisse)===8000 && Number(L.MOINS?.prix)===10000)
check('« vendeur » manager → absent', !('MANAGER' in L))
check('« vendeur » super admin → absent', !('SUPERADMIN' in L))
check('copie « livre » mais livraison en retour → absent (la livraison décide)', !('COPIE_FAUSSE_LIVRE' in L))
check('copie vide mais livraison livrée + remis → à régler', 'COPIE_VIDE' in L)
check('déjà dans un relevé → absent', !('DEJA_RELEVE' in L))
check('total : REMIS, MOINS, COPIE_VIDE, SELLER2', JSON.stringify(Object.keys(L).sort())===JSON.stringify(['COPIE_VIDE','MOINS','REMIS','SELLER2']), JSON.stringify(Object.keys(L)))
const colonnes=(await q(`select column_name from information_schema.columns where table_name='v_commandes_a_regler' order by ordinal_position`)).map(r=>r.column_name)
check('colonnes : les 12 d\'avant, même ordre, + montant_encaisse',
  JSON.stringify(colonnes)===JSON.stringify(['commande_id','tenant_id','vendeur_id','lead_id','client_nom','produit','quantite','prix','statut_livraison','updated_at','created_at','devise','montant_encaisse']), JSON.stringify(colonnes))
check('security_invoker reste on', (await q(`select array_to_string(reloptions,',') o from pg_class where oid='public.v_commandes_a_regler'::regclass`))[0].o.includes('security_invoker=on'))
check('droits sur la vue inchangés', await droits()===droitsAvant)

// ===== par rôle =====
const voit=async(uid)=>(await sous(uid,'authenticated',()=>q(`select lead_id from public.v_commandes_a_regler order by 1`))).map(r=>r.lead_id)
check('manager : toute son entreprise (4)', (await voit(U.manager)).length===4, JSON.stringify(await voit(U.manager)))
check('vendeur : seulement les siennes', JSON.stringify(await voit(U.seller))===JSON.stringify(['COPIE_VIDE','MOINS','REMIS']), JSON.stringify(await voit(U.seller)))
check('autre vendeur : seulement la sienne', JSON.stringify(await voit(U.seller2))===JSON.stringify(['SELLER2']), JSON.stringify(await voit(U.seller2)))
check('manager d\'une autre entreprise : rien', (await voit(U.manager2)).length===0)
let e=await sous(null,'anon',()=>erreur(()=>q(`select 1 from public.v_commandes_a_regler`)))
check('anon : refusé', e?.includes('permission denied'), e)

// ===== mutant =====
await base()
const MUT=F.replace(`join public.paiements p   on p.commande_id = c.id and p.statut = 'remis'`,`join public.paiements p   on p.commande_id = c.id`)
check('(témoin : condition « remis » retirée)', MUT!==F)
e=await erreur(()=>db.exec(MUT))
check('mutant : arrêté par la vérification §3, rien changé', e?.includes('ne respectent pas la règle')
  && (await q(`select pg_get_viewdef('public.v_commandes_a_regler'::regclass,true) d`))[0].d===defAvant, e)

// ===== retour =====
await base(); await db.exec(F)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : la définition d\'avant, mot pour mot', (await q(`select pg_get_viewdef('public.v_commandes_a_regler'::regclass,true) d`))[0].d===defAvant)
check('retour : les droits d\'avant (mêmes entrées)', await droits()===droitsAvant, (await droits())+' vs '+droitsAvant)
check('retour : security_invoker on', (await q(`select array_to_string(reloptions,',') o from pg_class where oid='public.v_commandes_a_regler'::regclass`))[0].o.includes('security_invoker=on'))
check('retour : en_attente redevient à régler (comme avant)', 'EN_ATTENTE' in await listeAvant())
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
