// Charge le schéma réel (supabase/migrations) dans PGlite, plus ce qui est en
// production depuis (correctifs 14/10, entrepot_commande.sql,
// commandes_pays_entreprise.sql), puis :
//   · zone_commande.sql (la zone d'une commande, depuis sa ville) ;
//   · zone_commande_2_rattrapage.sql (les commandes existantes) ;
//   · livreur_par_zone.sql (l'affectation par la zone ; sans zone, la ville doit
//     ÊTRE le nom de la zone du livreur — plus jamais « contient », 27/10).
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
alter role service_role bypassrls;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql'])
  await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
const FICHIER1=fs.readFileSync(R+'sql/zone_commande.sql','utf8')
const FICHIER2=fs.readFileSync(R+'sql/zone_commande_2_rattrapage.sql','utf8')
const FICHIER3=fs.readFileSync(R+'sql/livreur_par_zone.sql','utf8')

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

// ---- deux entreprises ; T a l'Angola et le Congo, chacun avec une zone « Luanda »
const T='11111111-1111-1111-1111-111111111111', T2='99999999-9999-9999-9999-999999999999'
const VENDEUR='aaaaaaaa-0000-0000-0000-000000000001'
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T,nom_entreprise:'FG'}); await ins('tenants',{id:T2,nom_entreprise:'Test'})
await q(`insert into auth.users values ($1,'v@x')`,[VENDEUR])
await ins('user_roles',{user_id:VENDEUR,tenant_id:T,role:'seller'})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const ML=(await ins('pays',{tenant_id:T,nom:'Mali',code:'ML'})).id
const AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO'})).id
for (const [t,p] of [[T,AO],[T,CG],[T,ML],[T2,AO2]]) await ins('entrepots',{tenant_id:t,nom:'E'+p.slice(0,4),pays_id:p,actif:true})
const zLuanda=(await ins('zones',{tenant_id:T,pays_id:AO,nom_zone:'luanda',frais_livraison:1000})).id
const zAnda=(await ins('zones',{tenant_id:T,pays_id:AO,nom_zone:'Anda',frais_livraison:500})).id
const zVide=(await ins('zones',{tenant_id:T,pays_id:AO,nom_zone:'Huambo',frais_livraison:700})).id
const zLuandaCG=(await ins('zones',{tenant_id:T,pays_id:CG,nom_zone:'Luanda',frais_livraison:9})).id
const zLuandaT2=(await ins('zones',{tenant_id:T2,pays_id:AO2,nom_zone:'Luanda',frais_livraison:9})).id
// Mali : deux zones au même nom normalisé → ambigu
await ins('zones',{tenant_id:T,pays_id:ML,nom_zone:'Bamako'}); await ins('zones',{tenant_id:T,pays_id:ML,nom_zone:'BAMAKO '})
await ins('statuts',{tenant_id:T,nom:'Confirmed',code:'confirmed',declenche_assignation:true,ferme_le_lead:true})
await ins('statuts',{tenant_id:T,nom:'Unreached',code:'unreached'})
await db.exec(`set session_replication_role = origin`)

let n=0
const ligne=(pays,ville,extra={})=>({lead_id:'L'+(++n),tenant_id:T,pays_id:pays,client_nom:'C',client_telephone:'+244'+n,produit:'X',quantite:1,prix:10,ville_zone:ville,...extra})
const commande=async(pays,ville,extra={})=>ins('commandes',ligne(pays,ville,extra))
const lire=async id=>(await q(`select zone_id, ville_zone, pays_id from public.commandes where id=$1`,[id]))[0]
const nbZones=async()=>(await q(`select count(*)::int n from public.zones`))[0].n
const photo=async()=>JSON.stringify(await q(`select * from public.commandes order by id`))

// =====================================================================
// A. Avant les fichiers
// =====================================================================
let e=await erreur(()=>db.exec(FICHIER2))
check('fichier 2 avant le fichier 1 → refusé', /Lancez d'abord zone_commande.sql/.test(e||''), String(e))
e=await erreur(()=>db.exec(FICHIER3))
check('livreur_par_zone.sql avant le fichier 1 → refusé', /Lancez d'abord zone_commande.sql/.test(e||''), String(e))
const ex1=await commande(AO,'Luanda'), ex2=await commande(AO,'Luanda '), ex3=await commande(AO,'Kilamba')
const ex4=await commande(AO,'luanda') // partira
const ex5=await commande(ML,'Bamako')  // ambiguë
const ex6=await commande(AO,'LUANDA',{zone_id:zAnda}) // zone déjà choisie, même fausse : on n'y touche pas
const ex7=await commande(AO,'Luanda')  // sera refusée par une autre règle au rattrapage
const exT2=await ins('commandes',{lead_id:'Z1',tenant_id:T2,pays_id:AO2,client_nom:'C',client_telephone:'+1',produit:'x',quantite:1,prix:1,ville_zone:'luanda'})
check('avant : une commande « Luanda » arrive sans zone (le bug)', (await lire(ex1.id)).zone_id===null)
await db.exec(`set session_replication_role = replica`)
await ins('livraisons',{commande_id:ex4.id,tenant_id:T,statut:'expedie'})
await q(`update public.commandes set client_nom='' where id=$1`,[ex7.id])
await db.exec(`set session_replication_role = origin`)

// =====================================================================
// B. Fichier 1
// =====================================================================
const avant=await photo(), zonesAvant=await nbZones()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FICHIER1)); check(`fichier 1, passage ${run}`, e===null, String(e)) }
check('fichier 1 : aucune commande existante modifiée', await photo()===avant)
check('un seul trigger trg_zz_zone_commande', (await q(`select count(*)::int n from pg_trigger where tgname='trg_zz_zone_commande'`))[0].n===1)
const ordre=(await q(`select tgname from pg_trigger where tgrelid='public.commandes'::regclass and not tgisinternal and tgtype & 2 = 2 order by tgname`)).map(r=>r.tgname)
check('passe après trg_set_tenant_id, trg_zy_pays, trg_zz_entrepot', ordre.indexOf('trg_zz_zone_commande')>ordre.indexOf('trg_zz_entrepot_commande') && ordre.indexOf('trg_zz_zone_commande')>ordre.indexOf('trg_set_tenant_id_commandes'), ordre.join(','))
check('texte_normalise(« Luánda  Sul ») = « luanda sul »', (await q(`select public.texte_normalise(' Luánda   Sul ') v`))[0].v==='luanda sul')
check('texte_normalise(vide / espaces / NULL) = NULL', (await q(`select public.texte_normalise('') a, public.texte_normalise('   ') b, public.texte_normalise(null) c`)).every(r=>r.a===null&&r.b===null&&r.c===null))
for (const r of ['anon','authenticated']) {
  e=await sous('',r,()=>q(`select public.zone_de_commande($1,$2,'luanda')`,[T,AO])).then(()=>null,x=>x.message)
  check(`zone_de_commande fermée à ${r}`, /permission denied/.test(e||''), String(e))
}

// ---- insertion
for (const v of ['luanda','Luanda','LUANDA','  Luanda  ','Luánda','LUÂNDA']) {
  const c=await commande(AO,v)
  const l=await lire(c.id)
  check(`insert « ${v} » → zone luanda, ville gardée telle quelle`, l.zone_id===zLuanda && l.ville_zone===v, JSON.stringify(l))
}
let c=await commande(CG,'luanda')
check('même nom, autre pays : la zone du pays de la commande (Congo)', (await lire(c.id)).zone_id===zLuandaCG)
c=await ins('commandes',{lead_id:'Z2',tenant_id:T2,pays_id:AO2,client_nom:'C',client_telephone:'+1',produit:'x',quantite:1,prix:1,ville_zone:'LUANDA'})
check('autre entreprise : sa propre zone, jamais celle de FG', (await lire(c.id)).zone_id===zLuandaT2)
for (const v of ['Kilamba','Luanda Cazenga','Lua','', null]) {
  c=await commande(AO,v)
  const l=await lire(c.id)
  check(`insert « ${v} » → pas de zone (égalité, jamais « contient »), ville gardée`, l.zone_id===null && l.ville_zone===v, JSON.stringify(l))
}
c=await commande(ML,'bamako')
check('deux zones du même nom dans le pays → pas de zone', (await lire(c.id)).zone_id===null)
c=await commande(AO,'Luanda',{zone_id:zAnda})
check('insert avec une zone fournie → gardée, même si la ville dit autre chose', (await lire(c.id)).zone_id===zAnda)
check('aucune zone créée', await nbZones()===zonesAvant)

// ---- tous les chemins
const v1=await sous(VENDEUR,'authenticated',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,vendeur_id,ville_zone) values ('V1',$1,$2,'C','+1','X',1,1,$3,'Luanda') returning id`,[T,AO,VENDEUR]))
check('vendeur (import CSV / saisie, sans droit de lecture sur zones) → zone remplie', (await lire(v1[0].id)).zone_id===zLuanda)
const s1=await sous('','service_role',()=>q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,ville_zone) values ('S1',$1,$2,'C','+1','X',1,1,'luanda ') returning id`,[T,AO]))
check('clé service (API) → zone remplie', (await lire(s1[0].id)).zone_id===zLuanda)

// ---- modification
c=await commande(AO,'Luanda')
await q(`update public.commandes set zone_id=null where id=$1`,[c.id])
check('l\'agent vide la zone → elle reste vide', (await lire(c.id)).zone_id===null)
await q(`update public.commandes set statut_confirmation='Unreached', ville_zone='Luanda', pays_id=$2 where id=$1`,[c.id,AO])
check('… un update qui réécrit la même ville et le même pays ne la remet pas', (await lire(c.id)).zone_id===null)
await q(`update public.commandes set ville_zone=' LUANDA' where id=$1`,[c.id])
check('… ni une ville égale aux espaces/casse près', (await lire(c.id)).zone_id===null)
await sous('','service_role',()=>q(`update public.commandes set zone_id=null, ville_zone='Luanda', adresse='Rua 1' where id=$1`,[c.id]))
check('… ni l\'enregistrement du panneau (zone_id vide renvoyé, clé service)', (await lire(c.id)).zone_id===null)
await q(`update public.commandes set ville_zone='Kilamba' where id=$1`,[c.id])
await q(`update public.commandes set ville_zone='Luanda' where id=$1`,[c.id])
check('la ville change vraiment (vers une ville connue) → zone remplie', (await lire(c.id)).zone_id===zLuanda)
await q(`update public.commandes set ville_zone='Kilamba' where id=$1`,[c.id])
check('la ville change vers une ville inconnue → l\'ancienne zone ne convient plus, vide', (await lire(c.id)).zone_id===null)
c=await commande(AO,'Kilamba')
await q(`update public.commandes set zone_id=$2, ville_zone='luanda' where id=$1`,[c.id,zAnda])
check('zone et ville écrites ensemble (l\'agent choisit) → le choix gagne', (await lire(c.id)).zone_id===zAnda)
c=await commande(AO,'Luanda')
await q(`update public.commandes set pays_id=$2 where id=$1`,[c.id,CG])
check('le pays change → la zone du nouveau pays', (await lire(c.id)).zone_id===zLuandaCG)
c=await commande(AO,'Luanda')
await db.exec(`set session_replication_role = replica`)
await ins('livraisons',{commande_id:c.id,tenant_id:T,statut:'livre'})
await db.exec(`set session_replication_role = origin`)
await q(`update public.commandes set ville_zone='Kilamba' where id=$1`,[c.id])
check('déjà partie : la ville change, la zone reste (un fait)', (await lire(c.id)).zone_id===zLuanda)
check('toujours aucune zone créée', await nbZones()===zonesAvant)

// =====================================================================
// C. Fichier 2 — le rattrapage
// =====================================================================
// le fichier entier, comme dans l'éditeur SQL
const garde=await erreur(()=>db.exec(FICHIER2))
check('fichier 2, en entier', garde===null, String(garde))
const z=async id=>(await lire(id)).zone_id
check('rattrapage : « Luanda » et « Luanda␠ » → zone luanda', await z(ex1.id)===zLuanda && await z(ex2.id)===zLuanda)
check('rattrapage : « Kilamba » reste vide', await z(ex3.id)===null)
check('rattrapage : déjà partie, reste vide', await z(ex4.id)===null)
check('rattrapage : ambiguë, reste vide', await z(ex5.id)===null)
check('rattrapage : zone déjà choisie, non touchée', await z(ex6.id)===zAnda)
check('rattrapage : refusée par une autre règle, reste vide', await z(ex7.id)===null)
check('rattrapage : l\'autre entreprise, sa propre zone', await z(exT2.id)===zLuandaT2)
check('rattrapage : aucune zone créée', await nbZones()===zonesAvant)
// le compte rendu d'un passage : rejouer sur une base où il reste à faire
await db.exec(`set session_replication_role = replica`)
const ex8=await commande(AO,'LUANDA')
await db.exec(`set session_replication_role = origin`)
const rep=await q(`select * from public.remplir_zones_commandes()`)
const ligneRep=(res,zn)=>rep.filter(r=>r.resultat.startsWith(res)&&(zn===undefined||r.zone===zn)&&r.entreprise==='FG')
check('compte rendu : « 1. zone remplie » luanda = 1 (la seule restante)', ligneRep('1.','luanda')[0]?.commandes==1, JSON.stringify(rep))
check('compte rendu : « 2. déjà partie » = 1', ligneRep('2.')[0]?.commandes==1, JSON.stringify(rep))
check('compte rendu : « 4. plusieurs zones » nommé (Mali)', ligneRep('4.').some(r=>r.pays==='Mali'), JSON.stringify(rep))
check('compte rendu : « 5. refusée » avec le message de la base', ligneRep('5.').some(r=>/client est obligatoire/.test(r.resultat)), JSON.stringify(rep))
check('compte rendu : « 0. déjà une zone » compté', ligneRep('0.').length>0)
check('… ex8 remplie', await z(ex8.id)===zLuanda)
const avantRejeu=await photo()
const rep2=await q(`select * from public.remplir_zones_commandes()`)
check('rejouer : plus rien à remplir', !rep2.some(r=>r.resultat.startsWith('1.')) && await photo()===avantRejeu, JSON.stringify(rep2))
for (const r of ['anon','authenticated','service_role']) {
  e=await sous('',r,()=>q(`select * from public.remplir_zones_commandes()`)).then(()=>null,x=>x.message)
  check(`remplir_zones_commandes fermée à ${r}`, /permission denied/.test(e||''), String(e))
}

// =====================================================================
// D. Fichier 3 — le livreur par la zone
// =====================================================================
const livreur=async(nom,zone,extra={})=>{
  const u=crypto.randomUUID(); await q(`insert into auth.users values ($1,$2)`,[u,nom+'@x'])
  return (await ins('livreurs',{user_id:u,nom,tenant_id:T,pays_id:AO,zone,actif:true,...extra})).id }
const L_LUANDA=await livreur('Luanda1','luanda')
const L_ANA=await livreur('Anda1','Anda')
// le livreur de Luanda est chargé : à l'ancienne, « Anda » prend « Luanda »
await db.exec(`set session_replication_role = replica`)
for (let i=0;i<3;i++){ const x=await commande(AO,'zzz'); await ins('livraisons',{commande_id:x.id,livreur_id:L_LUANDA,tenant_id:T,statut:'a_preparer'}) }
await db.exec(`set session_replication_role = origin`)
const confirmer=async id=>{ await q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[id]); return (await q(`select livreur_id from public.livraisons where commande_id=$1`,[id]))[0]?.livreur_id ?? null }
c=await commande(AO,'Luanda')
check('AVANT livreur_par_zone : « Luanda » part chez le livreur de « Anda » (le trou)', await confirmer(c.id)===L_ANA)

for (const run of [1,2]) { e=await erreur(()=>db.exec(FICHIER3)); check(`livreur_par_zone.sql, passage ${run}`, e===null, String(e)) }
e=await sous('','authenticated',()=>q(`select public.livreur_pour_commande($1,$2,null,'x')`,[T,AO])).then(()=>null,x=>x.message)
check('livreur_pour_commande fermée à authenticated', /permission denied/.test(e||''), String(e))
const acl=(await q(`select proacl::text a from pg_proc where proname='choisir_livreur'`))[0].a
// 02/11 : choisir_livreur n'est plus ouverte à authenticated (choisir_fermes.sql, nettoyage_triggers_14_10.sql) ;
// livreur_par_zone.sql ne doit pas la rouvrir.
check('choisir_livreur garde ses droits (service_role, pas authenticated)', /service_role=X/.test(acl||'') && !/authenticated=X/.test(acl||''), String(acl))

c=await commande(AO,'Luanda')
check('zone luanda → le livreur de luanda, même plus chargé', await confirmer(c.id)===L_LUANDA)
c=await commande(AO,'anda')
check('zone Anda → le livreur de Anda', await confirmer(c.id)===L_ANA)
c=await commande(AO,'Huambo')
check('zone sans livreur → personne (pas de repli sur le texte)', await confirmer(c.id)===null)
c=await commande(AO,'Luanda Cazenga')
check('sans zone, « Luanda Cazenga » → PERSONNE (plus de « contient ») : il va dans « À assigner »', await confirmer(c.id)===null)
c=await commande(AO,'Luanda')
await q(`update public.commandes set zone_id=null where id=$1`,[c.id])
check('sans zone (vidée par l\'agent), ville « Luanda » → le livreur de « luanda » (égalité normalisée)', await confirmer(c.id)===L_LUANDA)
c=await commande(AO,'  LUÁNDA ')
await q(`update public.commandes set zone_id=null where id=$1`,[c.id])
check('… « LUÁNDA » avec espaces → le même, jamais « Anda »', await confirmer(c.id)===L_LUANDA)
c=await commande(AO,'Kilamba')
check('sans zone, aucun texte ne correspond → personne', await confirmer(c.id)===null)
c=await commande(AO,'Luanda',{zone_id:zLuandaCG})
check('zone d\'un autre pays sur la commande → ignorée, repli sur l\'égalité : « Luanda » → luanda, pas Anda', await confirmer(c.id)===L_LUANDA)
await q(`update public.zones set nom_zone='LUANDA ' where id=$1`,[zLuanda])
c=await commande(AO,'luanda')
check('zone renommée (casse/espaces) → le livreur « luanda » la garde', await confirmer(c.id)===L_LUANDA)
await q(`update public.zones set nom_zone='luanda' where id=$1`,[zLuanda])
await q(`update public.livreurs set actif=false where id=$1`,[L_LUANDA])
c=await commande(AO,'Luanda')
check('livreur de la zone inactif → personne', await confirmer(c.id)===null)
await q(`update public.livreurs set actif=true where id=$1`,[L_LUANDA])
const sc=await sous('','service_role',async()=>{ const x=await q(`insert into public.commandes (lead_id,tenant_id,pays_id,client_nom,client_telephone,produit,quantite,prix,ville_zone) values ('S9',$1,$2,'C','+1','X',1,1,'LUANDA') returning id`,[T,AO]); await q(`update public.commandes set statut_confirmation='Confirmed', adresse='Rua 2' where id=$1`,[x[0].id]); return x[0].id })
check('chemin confirmer-appel (clé service) → le livreur de la zone', (await q(`select livreur_id from public.livraisons where commande_id=$1`,[sc]))[0]?.livreur_id===L_LUANDA)
check('choisir_livreur (ancienne signature) répond toujours, par égalité : « Luanda » → luanda', (await q(`select public.choisir_livreur($1,$2,'Luanda') v`,[T,AO]))[0].v===L_LUANDA)
check('choisir_livreur « Luanda Angola » → personne', (await q(`select public.choisir_livreur($1,$2,'Luanda Angola') v`,[T,AO]))[0].v===null)
// rejouer correctif_urgent_14_10.sql remet l'ancien appel : relancer le fichier 3 répare
await db.exec(fs.readFileSync(R+'sql/correctif_urgent_14_10.sql','utf8'))
await db.exec(FICHIER3)
c=await commande(AO,'Luanda')
check('correctif_urgent_14_10 rejoué puis ce fichier → de nouveau par la zone', await confirmer(c.id)===L_LUANDA)

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko?1:0)
