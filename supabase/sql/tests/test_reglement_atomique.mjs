// reglement_atomique.sql (03/11) sur le schéma réel + reglement_sur_encaisse.sql :
//   · AVANT (témoins) : en-tête sans lignes possible (total sans commande) ;
//     total écrit à la main ; relevé payé qui repasse « en attente » ;
//   · prérequis ; fichier deux fois ;
//   · etablir_releve : une étape, total = l'encaissé, lignes = l'encaissé,
//     période des commandes ou donnée ; refus NOMMÉS sans rien laisser
//     (déjà dans un relevé = double clic, autre vendeur, pas remis, pas livrée,
//     autre entreprise, introuvable, deux devises, liste vide, « vendeur » qui
//     n'en est pas un, fin avant début) ; droits : manager, admin, super admin
//     oui ; ceo, vendeur, manager d'une autre entreprise, anon non ;
//   · plus d'écriture directe (relevé, lignes) depuis le navigateur ;
//   · garde : non payé → montants/vendeur/période figés, statut/méthode/note
//     libres ; payé → plus rien ne change ; « Marquer payé » met la date ;
//     supprimer un relevé non payé passe (ses lignes avec), un payé non ;
//   · éditeur SQL non contrôlé (comme avant) ;
//   · mutants (total écrit 0 ; contrôle « remis » retiré) arrêtés par la répétition ;
//   · retour arrière deux fois = politiques, droits, corps de la garde d'avant ; réinstallation.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('reglement_atomique.sql'), RET=lire('reglement_atomique_retour.sql'), VUE=lire('reglement_sur_encaisse.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='99999999-9999-9999-9999-999999999999'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', seller2:'aaaaaaaa-0000-0000-0000-000000000011', manager:'aaaaaaaa-0000-0000-0000-000000000002',
          admin:'aaaaaaaa-0000-0000-0000-000000000003', ceo:'aaaaaaaa-0000-0000-0000-000000000004', super_admin:'aaaaaaaa-0000-0000-0000-000000000009',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', manager2:'aaaaaaaa-0000-0000-0000-000000000007' }
let db, AO, CG, LIV, n=0, C={}
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
const cas=async(nom,{vendeur=U.seller,prix=10000,paiement='remis',encaisse=prix,livraison='livre',tenant=T,pays=null,quand='2026-11-02'}={})=>{
  await db.exec(`set session_replication_role = replica`)
  const c=(await ins('commandes',{lead_id:nom,tenant_id:tenant,pays_id:pays||AO,client_nom:'C',client_telephone:'+244'+(++n),produit:'p',quantite:1,prix,vendeur_id:vendeur,statut_livraison:livraison,updated_at:quand+'T10:00:00Z'})).id
  if (livraison) await ins('livraisons',{tenant_id:tenant,commande_id:c,livreur_id:LIV,statut:livraison})
  if (paiement) await ins('paiements',{tenant_id:tenant,commande_id:c,livreur_id:LIV,montant:encaisse,methode:'cod',statut:paiement})
  await db.exec(`set session_replication_role = origin`)
  return (C[nom]=c)
}
const etablir=(uid,ids,{vendeur=U.seller,tenant=T,debut=null,fin=null}={})=>sous(uid,'authenticated',()=>q(
  `select * from public.etablir_releve($1,$2,$3,'especes',$4,$5)`,[tenant,vendeur,ids,debut,fin]))
const nbReleves=async()=>(await q(`select count(*)::int n from public.reglements`))[0].n

async function base({installer=true}={}){
  db=new PGlite()
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
  alter role service_role bypassrls;`)
  let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
  schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
  await db.exec(schema)
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;
    revoke all on all tables in schema public from anon;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T}); await ins('tenants',{id:T2})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:r==='manager2'?T2:T,role:r.replace(/\d$/,''),email:r+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG',devise:'XAF'})).id
  LIV=(await ins('livreurs',{tenant_id:T,user_id:U.livreur,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ gerer_reglements:['manager','admin','super_admin'], payer_reglements:['admin','super_admin'] })
  await db.exec(VUE)
  // 05/11 : etablir_releve calcule les frais de chaque lead (frais_vendeurs.sql). Ici, des frais à 0 :
  // ce fichier teste l'établissement en une étape, pas le calcul des frais (test_frais_vendeurs.mjs).
  await db.exec(fs.readFileSync(R+'sql/frais_vendeurs.sql','utf8'))
  await db.exec(fs.readFileSync(R+'sql/retenues_releve.sql','utf8'))
  await db.exec(`insert into public.tarifs_vendeurs (tenant_id,pays_id,frais_commande,frais_livraison,frais_upsell_unite,valide_depuis)
                 select tenant_id, id, 0, 0, 0, date '2000-01-01' from public.pays`)
  for (const [k,o] of Object.entries({ A1:{quand:'2026-11-01'}, A2:{prix:20000,encaisse:18000,quand:'2026-11-03'}, A3:{}, PAS_REMIS:{paiement:'encaisse'},
      PAS_LIVREE:{livraison:'a_preparer',paiement:null}, AUTRE_VENDEUR:{vendeur:U.seller2}, CONGO:{pays:CG}, MANAGER_VEND:{vendeur:U.manager} })) await cas(k,o)
  if (installer) await db.exec(F)
}

// ===== AVANT (témoins) =====
await base({installer:false})
let e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.reglements (tenant_id,vendeur_id,periode_debut,periode_fin,total_ventes,net_a_payer) values ($1,$2,'2026-11-01','2026-11-03',999999,999999)`,[T,U.seller])))
check('AVANT (témoin) : un manager crée un relevé de 999 999 sans aucune commande', e===null, e)
const regPaye=(await q(`select id from public.reglements limit 1`))[0].id
await sous(U.manager,'authenticated',()=>q(`update public.reglements set statut='paye' where id=$1`,[regPaye]))
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set statut='en_attente' where id=$1`,[regPaye])))
check('AVANT (témoin) : le relevé payé repasse « en attente »', e===null && (await q(`select statut from public.reglements where id=$1`,[regPaye]))[0].statut==='en_attente', e)

// ===== prérequis =====
await base({installer:false})
await db.exec(lire('reglement_sur_encaisse_retour.sql'))
e=await erreur(()=>db.exec(F))
check('prérequis : refusé sans la vue « à régler » sur l\'argent remis', e?.includes('reglement_sur_encaisse.sql'), e)

// ===== installation =====
await base({installer:false})
for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }
check('aucun relevé créé par le fichier (répétition annulée)', await nbReleves()===0)

// ===== la porte =====
let r=(await etablir(U.manager,[C.A1,C.A2,C.A3]))[0]
check('manager : relevé établi en une étape — 3 commandes, total = l\'encaissé (10 000 + 18 000 + 10 000)', r && r.nb_commandes===3 && Number(r.total)===38000, JSON.stringify(r))
const reg=(await q(`select * from public.reglements where id=$1`,[r.reglement_id]))[0]
check('… en-tête : vendeur, devise AOA, total = net, référence, créé par le manager', reg.vendeur_id===U.seller && reg.devise==='AOA' && Number(reg.total_ventes)===38000 && Number(reg.net_a_payer)===38000 && /^REG-\d{6}$/.test(reg.reference) && reg.cree_par===U.manager)
check('… période = celle des commandes (01/11 → 03/11)', String(reg.periode_debut).startsWith('2026-11-01')||new Date(reg.periode_debut).toISOString().startsWith('2026-11-01'), String(reg.periode_debut))
const lignes=await q(`select commande_id, montant from public.reglements_commandes where reglement_id=$1`,[r.reglement_id])
check('… 3 lignes, montant de A2 = 18 000 (l\'encaissé, pas le prix 20 000)', lignes.length===3 && Number(lignes.find(l=>l.commande_id===C.A2).montant)===18000)
const avantDouble=await nbReleves()
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,U.seller,[C.A1]])))
check('les mêmes commandes encore (double clic) → refusé, nommé « déjà dans un relevé »', e?.includes('A1 : déjà dans un relevé'), e)
check('… et AUCUN relevé de plus', await nbReleves()===avantDouble)
for (const [quoi,ids,attendu,opts] of [
  ['argent pas remis',[C.PAS_REMIS],'PAS_REMIS : argent pas encore remis'],
  ['pas livrée',[C.PAS_LIVREE],'PAS_LIVREE : pas livrée'],
  ['commande d\'un autre vendeur',[C.AUTRE_VENDEUR],'AUTRE_VENDEUR : d\'un autre vendeur'],
  ['introuvable',['00000000-0000-0000-0000-000000000000'],'introuvable'],
  ['deux devises (AOA + XAF)',[C.CONGO,(await cas('A4'))],'faites un relevé par devise'],
  ['liste vide',[],'Aucune commande'],
  ['« vendeur » qui est un manager',[C.MANAGER_VEND],'n\'est pas un vendeur',{vendeur:U.manager}],
  ['fin avant début',[C.A4],'est avant son début',{debut:'2026-11-03',fin:'2026-11-01'}],
]) {
  const nb=await nbReleves()
  e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',$4,$5)`,[T,opts?.vendeur||U.seller,ids,opts?.debut||null,opts?.fin||null])))
  check(`${quoi} → refusé, dit pourquoi, rien laissé`, e?.includes(attendu) && await nbReleves()===nb, e)
}
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,U.seller,[C.A4,C.PAS_REMIS]])))
check('une bonne + une mauvaise → TOUT refusé (la bonne reste à régler)', e?.includes('PAS_REMIS') && (await q(`select count(*)::int n from public.reglements_commandes where commande_id=$1`,[C.A4]))[0].n===0, e)
r=(await etablir(U.admin,[C.A4],{debut:'2026-10-01',fin:'2026-11-30'}))[0]
check('admin : passe ; période donnée gardée', r?.nb_commandes===1 && String((await q(`select periode_fin::text f from public.reglements where id=$1`,[r.reglement_id]))[0].f)==='2026-11-30')
const A5=await cas('A5')
r=(await etablir(U.super_admin,[A5]))[0]
check('super admin : passe', r?.nb_commandes===1)
const A6=await cas('A6')
for (const [qui,u,attendu] of [['ceo',U.ceo,'ne permet pas'],['vendeur',U.seller,'ne permet pas'],['manager d\'une autre entreprise',U.manager2,'ne permet pas']]) {
  e=await sous(u,'authenticated',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,U.seller,[A6]])))
  check(`${qui} → refusé`, e?.includes(attendu), e)
}
e=await sous(null,'anon',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,U.seller,[A6]])))
check('anon → pas le droit d\'exécuter', e?.includes('permission denied'), e)

// ===== plus d'écriture directe =====
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.reglements (tenant_id,vendeur_id,periode_debut,periode_fin) values ($1,$2,'2026-11-01','2026-11-01')`,[T,U.seller])))
check('navigateur : créer un relevé directement → refusé', e?.includes('permission denied'), e)
const regEA=(await etablir(U.manager,[A6]))[0].reglement_id
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.reglements_commandes (commande_id,reglement_id,tenant_id,montant) values ($1,$2,$3,1)`,[C.PAS_REMIS,regEA,T])))
check('navigateur : ajouter une commande à un relevé → refusé', e?.includes('permission denied'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`delete from public.reglements_commandes where reglement_id=$1`,[regEA])))
check('navigateur : retirer une commande d\'un relevé → refusé', e?.includes('permission denied'), e)

// ===== la garde =====
for (const [champ,val] of [['total_ventes',1],['net_a_payer',1],['nb_commandes',9],['vendeur_id',U.seller2],['periode_fin','2027-01-01'],['devise','XAF']]) {
  e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set ${champ}=$1 where id=$2`,[val,regEA])))
  check(`non payé : ${champ} à la main → refusé`, e?.includes('ne se modifient pas'), e)
}
await sous(U.manager,'authenticated',()=>q(`update public.reglements set methode='virement', note='ok' where id=$1`,[regEA]))
check('non payé : méthode et note changent', (await q(`select methode, note from public.reglements where id=$1`,[regEA]))[0].methode==='virement')
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set statut='paye' where id=$1`,[regEA])))
check('manager : « Marquer payé » refusé (09/11 : admin / super admin seulement)', e?.includes('Seul un admin'), e)
await sous(U.admin,'authenticated',()=>q(`update public.reglements set statut='paye' where id=$1`,[regEA]))
const p=(await q(`select statut, date_paiement, paye_par from public.reglements where id=$1`,[regEA]))[0]
check('admin : « Marquer payé » passe, met la date et « payé par »', p.statut==='paye' && p.date_paiement!==null && p.paye_par===U.admin)
for (const [quoi,sql] of [['repasser « en attente »',`statut='en_attente'`],['« annulé »',`statut='annule'`],['changer la note',`note='x'`],['changer la méthode',`methode='cheque'`]]) {
  e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set ${sql} where id=$1`,[regEA])))
  check(`payé : ${quoi} → refusé`, e?.includes('déjà payé'), e)
}
const del=await sous(U.manager,'authenticated',()=>q(`delete from public.reglements where id=$1 returning id`,[regEA]))
check('payé : la suppression ne touche rien (0 ligne)', del.length===0 && (await q(`select count(*)::int n from public.reglements where id=$1`,[regEA]))[0].n===1)
const A7=await cas('A7'); const regSup=(await etablir(U.manager,[A7]))[0].reglement_id
const del2=await sous(U.manager,'authenticated',()=>q(`delete from public.reglements where id=$1 returning id`,[regSup]))
check('non payé : supprimé, ses lignes avec, la commande redevient à régler', del2.length===1 && (await q(`select count(*)::int n from public.v_commandes_a_regler where commande_id=$1`,[A7]))[0].n===1)
await q(`update public.reglements set note='corrigé à la main' where id=$1`,[regEA])
check('éditeur SQL : non contrôlé, comme avant', (await q(`select note from public.reglements where id=$1`,[regEA]))[0].note==='corrigé à la main')

// ===== mutants =====
for (const [nom,mut,etape] of [
  ['total écrit à 0', F.replace(`     set total_ventes       = x.total,`,`     set total_ventes       = 0,`), 'total = l'],
  ['payé rouvrable', F.replace(`if old.statut = 'paye' and (to_jsonb(new) - 'taux_mad') is distinct from (to_jsonb(old) - 'taux_mad') then`,`if false then`), 'se rouvre'],
  ['manager paie', F.replace(`and not (public.is_super_admin() or public.a_la_permission('payer_reglements')) then`,`and false then`), 'le manager ne marque pas'],
]) {
  await base({installer:false})
  check(`(témoin : ${nom})`, mut!==F)
  e=await erreur(()=>db.exec(mut))
  check(`mutant « ${nom} » : arrêté par la répétition, rien installé`, e?.includes('RÉPÉTITION ÉCHOUÉE') && e?.includes(etape)
    && (await q(`select count(*)::int n from pg_proc where proname='etablir_releve'`))[0].n===0, e)
}

// ===== retour =====
await base({installer:false})
const pol=async()=>JSON.stringify(await q(`select tablename, policyname, cmd, qual, with_check, roles::text from pg_policies where tablename in ('reglements','reglements_commandes') order by 1,2`))
const droits=async()=>JSON.stringify(await q(`select t, array_to_string(array(select unnest(relacl)::text order by 1),',') a from (select relname t, relacl from pg_class where relname in ('reglements','reglements_commandes')) x order by 1`))
const garde=async()=>(await q(`select md5(prosrc) m from pg_proc where proname='reglements_garde'`))[0].m
const polAvant=await pol(), droitsAvant=await droits()
await db.exec(F)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : politiques identiques à avant', await pol()===polAvant)
check('retour : droits identiques à avant', await droits()===droitsAvant, (await droits())+' vs '+droitsAvant)
check('retour : garde = le corps de prod du 03/11 (md5 6f5f9bed…)', await garde()==='6f5f9bed9035a2615fd4ab95120f03ee', await garde())
check('retour : etablir_releve retirée', (await q(`select count(*)::int n from pg_proc where proname='etablir_releve'`))[0].n===0)
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
