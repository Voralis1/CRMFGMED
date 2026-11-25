// statuts_entreprise.sql sur le schéma réel, depuis l'état de production du 30/10
// (statut_pending.sql avec le corps de production de statut_pending_fige,
// remis par le fichier retour — ce qui prouve aussi que le retour rend le corps
// de production au md5 près) :
//   · AVANT : une entreprise créée n'a aucun statut ; une supprimée laisse les siens ;
//   · première installation : une entreprise qui diffère de la liste → arrêt, rien installé ;
//     des données portant l'id d'une entreprise supprimée → arrêt, nommé, rien installé ;
//   · fautes injectées (exception de la cascade fausse, liste amputée) → arrêt ;
//   · deux passages : orphelins partis, clé CASCADE, statuts existants intacts (ids compris) ;
//   · repasser avec une couleur changée → avis, rien réécrit ;
//   · nouvelle entreprise (éditeur SQL, clé service) → les huit ; supprimée → plus rien,
//     y compris le nettoyage d'une création ratée (creer-tenant) ;
//   · Pending d'une entreprise vivante : ni supprimé ni renommé ;
//   · entreprise qui a des commandes : suppression refusée, statuts intacts (le trou connu) ;
//   · semer_statuts fermé au navigateur ; relancer statut_pending.sql garde l'exception ;
//   · retour arrière deux fois, puis réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import crypto from 'crypto'
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
create function auth.role() returns text language sql stable as $$ select null::text $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
alter role service_role bypassrls;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const FF=fs.readFileSync(process.env.FICHIER||R+'sql/statuts_entreprise.sql','utf8'), FR=lire('statuts_entreprise_retour.sql'), FP=lire('statut_pending.sql')
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

// ---- l'état de production du 30/10 : deux entreprises aux huit statuts identiques, 7 orphelins
const LISTE=[['Pending','pending','#C9C1B1',false,false,false],['Unreached','unreached','#8a5a1f',false,false,false],
  ['Reminder','reminder','#FFB162',false,true,false],['Confirmed','confirmed','#2E7D53',true,false,true],
  ['Cancelled','cancelled','#A35139',false,false,true],['Double','double','#6B7A8C',false,false,true],
  ['Test','test','#7E6BA8',false,false,true],['Spam','spam','#1B2632',false,false,true]]
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='9183429e-c75c-4ed2-a869-f8bfa011bbc2', MORT='53ef8d4e-338a-4a7f-8546-b373f7eb6e2d'
const ADMIN='aaaaaaaa-0000-0000-0000-000000000003'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'}); await ins('tenants',{id:T2,nom_entreprise:'Fgmed Angola'})
await q(`insert into auth.users values ($1,'admin@x')`,[ADMIN]); await ins('user_roles',{user_id:ADMIN,tenant_id:T,role:'admin'})
for (const t of [T,T2]) for (const [nom,code,couleur,decl,rap,ferme] of LISTE)
  await ins('statuts',{tenant_id:t,nom,code,couleur,type:'appel',pays_id:null,declenche_assignation:decl,necessite_rappel:rap,ferme_le_lead:ferme})
for (const [nom,code,couleur,decl,rap,ferme] of LISTE.filter(l=>l[1]!=='pending'))
  await ins('statuts',{tenant_id:MORT,nom,code,couleur,type:'appel',pays_id:null,declenche_assignation:decl,necessite_rappel:rap,ferme_le_lead:ferme})
const AO=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
await db.exec(`set session_replication_role = origin`)
await db.exec(FP)                       // statut_pending.sql (son Pending existe déjà : rien d'ajouté)
let e=await erreur(()=>db.exec(FR))     // → le corps de production de statut_pending_fige
check('état de départ : le retour rend statut_pending_fige au md5 de production', e===null && (await q(`select md5(prosrc) m from pg_proc where proname='statut_pending_fige'`))[0].m==='d93c86ab4da035fd9f431341f78d4f00', String(e))

const nb=async t=>(await q(`select count(*)::int n from public.statuts where tenant_id=$1`,[t]))[0].n
const instantane=async()=>JSON.stringify(await q(`select * from public.statuts where tenant_id in ($1,$2) order by id`,[T,T2]))
const installe=async()=>(await q(`select (select count(*) from pg_constraint where conname='statuts_tenant_id_fkey')+(select count(*) from pg_trigger where tgname='trg_tenants_semer_statuts')+(select count(*) from pg_proc where proname in ('semer_statuts','statuts_standard_liste')) n`))[0].n
const conformes=async t=>(await q(`select count(*)::int n from public.statuts s join (values ${LISTE.map((l,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4}::boolean,$${i*6+5}::boolean,$${i*6+6}::boolean)`).join(',')}) l(nom,code,couleur,d,r,f)
  on s.code=l.code and s.nom=l.nom and s.couleur=l.couleur and s.declenche_assignation=l.d and s.necessite_rappel=l.r and s.ferme_le_lead=l.f and s.type='appel' and s.pays_id is null where s.tenant_id=$${LISTE.length*6+1}`,[...LISTE.flat(),t]))[0].n

// ---- AVANT
const N1=(await q(`insert into public.tenants (nom_entreprise) values ('Avant') returning id`))[0].id
check('AVANT : une entreprise créée n\'a aucun statut — le trou', await nb(N1)===0)
await q(`insert into public.statuts (tenant_id,nom,code,type) values ($1,'X','x','appel')`,[N1])
await q(`delete from public.tenants where id=$1`,[N1])
check('AVANT : une entreprise supprimée laisse ses statuts', await nb(N1)===1)
await q(`delete from public.statuts where tenant_id=$1`,[N1])
const avant=await instantane()

// ---- première installation : une entreprise qui diffère de la liste → arrêt
await q(`update public.statuts set couleur='#000000' where tenant_id=$1 and code='spam'`,[T2])
e=await erreur(()=>db.exec(FF)); await db.exec('rollback').catch(()=>{})
check('1re installation, une couleur différente → arrêt, entreprise et statut nommés', /ne dit plus ce qui est en place.*Fgmed Angola \/ Spam : couleur #000000/s.test(e||''), String(e))
check('… rien installé, orphelins toujours là', await installe()===0 && await nb(MORT)===7)
await q(`update public.statuts set couleur='#1B2632' where tenant_id=$1 and code='spam'`,[T2])

// ---- des données portent l'id de l'entreprise supprimée → arrêt
await db.exec(`set session_replication_role = replica`)
const zfant=(await ins('zones',{tenant_id:MORT,nom_zone:'Fantôme'})).id
await db.exec(`set session_replication_role = origin`)
e=await erreur(()=>db.exec(FF)); await db.exec('rollback').catch(()=>{})
check('orphelin dont l\'id sert encore (zones) → arrêt, table nommée, « pas à régler en relançant »', /ARRÊTÉ.*53ef8d4e.*zones \(1 ligne\(s\)\).*PAS à régler en relançant/s.test(e||''), String(e))
check('… rien installé, orphelins toujours là', await installe()===0 && await nb(MORT)===7)
await q(`delete from public.zones where id=$1`,[zfant])

// ---- fautes injectées
const FAUTIF=FF.replace("if old.tenant_id is not null\n         and not exists","if old.tenant_id is null\n         and not exists")
check('(témoin : exception de la cascade faussée)', FAUTIF!==FF)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('exception de la cascade fausse (le texte passe) → la répétition arrête le fichier', /RÉPÉTITION ÉCHOUÉE/.test(e||''), String(e))
check('… rien installé', await installe()===0 && await nb(MORT)===7)
const FAUTIF2=FF.replace("    ('Spam',      'spam',      '#1B2632', 'appel', false, false, true)\n","").replace("('Test',      'test',      '#7E6BA8', 'appel', false, false, true),","('Test',      'test',      '#7E6BA8', 'appel', false, false, true)")
check('(témoin : liste amputée)', FAUTIF2!==FF)
await db.exec(`set session_replication_role = replica`); await q(`insert into public.tenants (nom_entreprise) values ('Vide')`); await db.exec(`set session_replication_role = origin`)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF2+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('liste amputée → arrêt (une entreprise n\'aurait pas ses huit)', /RÉPÉTITION ÉCHOUÉE.*7 statut\(s\) conformes sur 8/s.test(e||''), String(e))
await q(`delete from public.tenants where nom_entreprise='Vide'`)

// ---- deux passages
for (const run of [1,2]) { e=await erreur(()=>db.exec(FF)); check(`fichier, passage ${run}`, e===null, String(e)) }
check('orphelins supprimés (7 → 0)', await nb(MORT)===0)
check('clé statuts.tenant_id → tenants ON DELETE CASCADE', (await q(`select confdeltype from pg_constraint where conname='statuts_tenant_id_fkey'`))[0]?.confdeltype==='c')
check('statuts des deux entreprises intacts, ids compris', await instantane()===avant)
check('répétition : aucune entreprise ni statut laissé', (await q(`select count(*)::int n from public.tenants where nom_entreprise like 'RÉPÉTITION%'`))[0].n===0)

// ---- repasser avec une couleur changée → avis, rien réécrit
await q(`update public.statuts set couleur='#123456' where tenant_id=$1 and code='reminder'`,[T])
e=await erreur(()=>db.exec(FF))
check('repasser avec une couleur changée par un admin → passe (avis seulement)', e===null, String(e))
check('… la couleur n\'est pas réécrite', (await q(`select couleur from public.statuts where tenant_id=$1 and code='reminder'`,[T]))[0].couleur==='#123456')
await q(`update public.statuts set couleur='#FFB162' where tenant_id=$1 and code='reminder'`,[T])

// ---- nouvelle entreprise, tous chemins
const N2=(await q(`insert into public.tenants (nom_entreprise) values ('Nouvelle') returning id`))[0].id
check('éditeur SQL : nouvelle entreprise → ses huit statuts, conformes à la liste', await nb(N2)===8 && await conformes(N2)===8)
const N3=(await sous(null,'service_role',()=>q(`insert into public.tenants (nom_entreprise) values ('Par creer-tenant') returning id`)))[0].id
check('clé service (creer-tenant) : les huit', await nb(N3)===8 && await conformes(N3)===8)
e=await erreur(()=>sous(null,'service_role',()=>q(`delete from public.tenants where id=$1`,[N3])))
check('création ratée : creer-tenant supprime l\'entreprise → accepté, ses statuts partent (Pending compris)', e===null && await nb(N3)===0, String(e))
check('semer à nouveau une entreprise complète : 0 ajouté', (await q(`select public.semer_statuts($1) n`,[N2]))[0].n===0)
await q(`update public.statuts set couleur='#000001' where tenant_id=$1 and code='confirmed'`,[N2])
await q(`delete from public.statuts where tenant_id=$1 and code='spam'`,[N2])
check('semer complète ce qui manque sans réécrire le reste', (await q(`select public.semer_statuts($1) n`,[N2]))[0].n===1
  && (await q(`select couleur from public.statuts where tenant_id=$1 and code='confirmed'`,[N2]))[0].couleur==='#000001')

// ---- le Pending d'une entreprise vivante
e=await erreur(()=>q(`delete from public.statuts where tenant_id=$1 and code='pending'`,[T]))
check('Pending d\'une entreprise vivante : suppression refusée (éditeur SQL)', /ne se supprime pas/.test(e||''), String(e))
e=await erreur(()=>sous(ADMIN,'authenticated',()=>q(`delete from public.statuts where tenant_id=$1 and code='pending' returning id`,[T])))
check('… ni par un admin de l\'entreprise', /ne se supprime pas/.test(e||'') || e===null && await nb(T)===8, String(e))
e=await erreur(()=>q(`update public.statuts set nom='Nouveau' where tenant_id=$1 and code='pending'`,[T]))
check('… ni renommé', /ne se renomme pas/.test(e||''), String(e))

// ---- le trou connu : une entreprise qui a de l'historique ne se supprime pas
const N4=(await q(`insert into public.tenants (nom_entreprise) values ('Avec commandes') returning id`))[0].id
const AO4=(await ins('pays',{tenant_id:N4,nom:'Angola',code:'AO'})).id
await ins('commandes',{lead_id:'X1',tenant_id:N4,pays_id:AO4,client_nom:'C',client_telephone:'+1',produit:'P',quantite:1,prix:1})
e=await erreur(()=>q(`delete from public.tenants where id=$1`,[N4]))
check('entreprise avec des commandes : suppression refusée (clé commandes), statuts intacts', /foreign key|violates/.test(e||'') && await nb(N4)===8, String(e))

// ---- droits
for (const r of ['authenticated','anon']) {
  e=await erreur(()=>sous(ADMIN,r,()=>q(`select public.semer_statuts($1)`,[T])))
  check(`semer_statuts : refusé à ${r}`, /permission denied/.test(e||''), String(e))
}

// ---- relancer statut_pending.sql ne défait rien
const corps=f=>f.match(/create or replace function public\.statut_pending_fige\(\)[\s\S]*?\n\$\$;\n/)[0]
check('statut_pending.sql porte le MÊME corps de statut_pending_fige que ce fichier', corps(FP)===corps(FF))
e=await erreur(()=>db.exec(FP))
const N5=(await q(`insert into public.tenants (nom_entreprise) values ('Après statut_pending') returning id`))[0].id
e=e||await erreur(()=>q(`delete from public.tenants where id=$1`,[N5]))
check('relancer statut_pending.sql : une entreprise se supprime encore avec ses statuts', e===null && await nb(N5)===0, String(e))

// ---- retour arrière
for (const run of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`retour arrière, passage ${run}`, e===null, String(e)) }
check('retour : plus de clé, de trigger ni de fonctions ; corps de production (md5)', await installe()===0
  && (await q(`select md5(prosrc) m, prosecdef s from pg_proc where proname='statut_pending_fige'`))[0].m==='d93c86ab4da035fd9f431341f78d4f00')
const N6=(await q(`insert into public.tenants (nom_entreprise) values ('Après retour') returning id`))[0].id
check('retour : une nouvelle entreprise n\'a de nouveau aucun statut', await nb(N6)===0)
check('retour : les statuts semés entre-temps restent', await nb(N2)===8)
e=await erreur(()=>db.exec(FF))
check('réinstaller avec une entreprise qui diffère (couleur de « Nouvelle ») → arrêt : c\'est une 1re installation', /Nouvelle \/ Confirmed : couleur #000001/.test(e||''), String(e))
await q(`update public.statuts set couleur='#2E7D53' where tenant_id=$1 and code='confirmed'`,[N2])
e=await erreur(()=>db.exec(FF)); check('réinstallation après le retour', e===null, String(e))
check('… l\'entreprise créée pendant le retour reçoit ses huit', await nb(N6)===8)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
