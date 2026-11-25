// frais_vendeurs.sql + retenues_releve.sql (09/11) + reglement_atomique.sql : SES 3 RELEVÉS D'ANGOLA, recalculés par le CRM.
//   Angola : frais commande 1 000, livraison 12 000, upsell 1 500 par unité en plus.
//   · Relevé 2 (1/08 → 17/09) : 21 leads (3 × 2 unités, 3 × 3), total 828 000, charges 314 700 → 226 800 ;
//   · Relevé 3 : 35 leads (10 × 2, 2 × 3), total 1 369 000, charges 129 360 → 763 640 ;
//   · Relevé 1 : 65 leads (12 × 2, 8 × 3), total 2 566 999, charges 110 060 → 1 569 939
//     (12 × 1 500 = 18 000 ; son calcul écrit 16 500) ;
//   · chaque ligne : total, frais commande, livraison, upsell × (qté − 1), net — figés ;
//   · tarif du vendeur prioritaire ; tarif qui change à une date → chaque lead au tarif de SON jour ;
//     changer un tarif après coup ne change pas un relevé établi ; pas de tarif → refus nommé ;
//   · charges : note obligatoire, recalcul, refusées sur un relevé payé, refusées au vendeur / ceo ;
//     les montants ne s'écrivent pas à la main ;
//   · tarifs : admin écrit, manager lit sans écrire, vendeur ne lit rien ; pays / vendeur d'une autre entreprise refusés ;
//   · prérequis : reglement_atomique refusé sans frais_vendeurs ; retours arrière.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const FV=lire('frais_vendeurs.sql'), RR=lire('retenues_releve.sql'), RA=lire('reglement_atomique.sql'), VUE=lire('reglement_sur_encaisse.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='99999999-9999-9999-9999-999999999999'
const U={ v1:'aaaaaaaa-0000-0000-0000-000000000001', v2:'aaaaaaaa-0000-0000-0000-000000000011', v3:'aaaaaaaa-0000-0000-0000-000000000021',
          v4:'aaaaaaaa-0000-0000-0000-000000000031', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', livreur:'aaaaaaaa-0000-0000-0000-000000000006', seller2:'aaaaaaaa-0000-0000-0000-000000000041' }
const ROLE={v1:'seller',v2:'seller',v3:'seller',v4:'seller',manager:'manager',admin:'admin',ceo:'ceo',livreur:'livreur',seller2:'seller'}
let db, AO, AO2, LIV, n=0
const q=async(s,p)=>(await db.query(s,p)).rows
const erreur=async fn=>{ try{ await fn(); return null }catch(e){ try{ await db.exec('rollback') }catch(_){} return e.message } }
const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false: x.data_type.startsWith('json')?'{}':'x'}
  const k=Object.keys(v); return (await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)))[0]}
const sous=async(uid,role,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
async function base({frais=true, releve=true}={}){
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
  for (const [k,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,k+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:k==='seller2'?T2:T,role:ROLE[k],email:k+'@x'})
  }
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  AO2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO',devise:'AOA'})).id
  LIV=(await ins('livreurs',{tenant_id:T,user_id:U.livreur,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ gerer_reglements:['manager','admin','super_admin'], payer_reglements:['admin','super_admin'] })
  await db.exec(VUE)
  if (frais) await db.exec(FV)
  if (releve) { await db.exec(RR); await db.exec(RA) }
}
// un lead livré (à une date), payé, argent remis
const lead=async(vendeur,qte,total,jour='2026-09-01')=>{
  await db.exec(`set session_replication_role = replica`)
  const c=(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit:'p',quantite:qte,prix:total,vendeur_id:vendeur,statut_livraison:'livre',updated_at:jour+'T10:00:00Z'})).id
  await ins('livraisons',{tenant_id:T,commande_id:c,livreur_id:LIV,statut:'livre',date_livraison:jour+'T10:00:00Z'})
  await ins('paiements',{tenant_id:T,commande_id:c,livreur_id:LIV,montant:total,methode:'cod',statut:'remis'})
  await db.exec(`set session_replication_role = origin`)
  return c
}
const lot=async(vendeur,specs,jour)=>{ const ids=[]; for (const [nb,qte,montant] of specs) for (let i=0;i<nb;i++) ids.push(await lead(vendeur,qte,montant,jour)); return ids }
const etablir=(uid,vendeur,ids)=>sous(uid,'authenticated',()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,vendeur,ids])).then(r=>r[0])
// 09/11 : les charges sont des ajustements « Autre » (retenues_releve.sql)
const charges=(uid,reg,montant,note)=>sous(uid,'authenticated',()=>q(`select public.ajouter_ajustement($1,'autre',$2,null,$3) id`,[reg,montant,note]))
const releve=async id=>(await q(`select * from public.reglements where id=$1`,[id]))[0]
const nombre=x=>Number(x)
const tarif=(vals)=>sous(U.admin,'authenticated',()=>q(`insert into public.tarifs_vendeurs (tenant_id,pays_id,vendeur_id,frais_commande,frais_livraison,frais_upsell_unite,valide_depuis) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [T,AO,vals.vendeur??null,vals.fc??1000,vals.fl??12000,vals.fu??1500,vals.depuis??'2026-01-01']))

// ===== prérequis =====
await base({frais:false, releve:false})
let e=await erreur(()=>db.exec(RA))
check('reglement_atomique (05/11) refusé sans frais_vendeurs.sql', e?.includes('lancez frais_vendeurs.sql d\'abord'), e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(FV)); check(`frais_vendeurs.sql, passage ${i}`, e===null, e) }
e=await erreur(()=>db.exec(RA))
check('reglement_atomique (09/11) refusé sans retenues_releve.sql', e?.includes('lancez retenues_releve.sql d\'abord'), e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RR)); check(`retenues_releve.sql, passage ${i}`, e===null, e) }
for (const i of [1,2]) { e=await erreur(()=>db.exec(RA)); check(`reglement_atomique.sql, passage ${i}`, e===null, e) }

// ===== tarifs : qui =====
e=await erreur(()=>tarif({}))
check('admin : saisit Angola 1 000 / 12 000 / 1 500', e===null, e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.tarifs_vendeurs (tenant_id,pays_id,frais_commande,frais_livraison,frais_upsell_unite,valide_depuis) values ($1,$2,1,1,1,'2026-02-01')`,[T,AO])))
check('manager : ne saisit pas les frais (admin seulement)', e?.includes('row-level security') || e?.includes('violates'), e)
check('manager : lit les frais', (await sous(U.manager,'authenticated',()=>q(`select count(*)::int n from public.tarifs_vendeurs`)))[0].n===1)
check('vendeur : ne lit rien', (await sous(U.v1,'authenticated',()=>q(`select count(*)::int n from public.tarifs_vendeurs`)))[0].n===0)
e=await sous(U.admin,'authenticated',()=>erreur(()=>q(`insert into public.tarifs_vendeurs (tenant_id,pays_id,frais_commande,frais_livraison,frais_upsell_unite) values ($1,$2,1,1,1)`,[T,AO2])))
check('pays d\'une autre entreprise → refusé', e?.includes('pas de l\'entreprise'), e)
e=await erreur(()=>tarif({vendeur:U.manager,depuis:'2026-03-01'}))
check('« vendeur » qui est un manager → refusé', e?.includes('pas un vendeur'), e)

// ===== SES 3 RELEVÉS =====
const cas=[
  { nom:'Relevé 2 (1/08 → 17/09)', vendeur:U.v2, specs:[[15,1,35000],[3,2,45000],[3,3,56000]], total:828000, upsell:13500, fc:21000, fl:252000, charges:314700, apayer:226800 },
  { nom:'Relevé 3', vendeur:U.v3, specs:[[23,1,35000],[10,2,45000],[2,3,57000]], total:1369000, upsell:21000, fc:35000, fl:420000, charges:129360, apayer:763640 },
  { nom:'Relevé 1', vendeur:U.v1, specs:[[44,1,35000],[1,1,38999],[12,2,45000],[8,3,56000]], total:2566999, upsell:42000, fc:65000, fl:780000, charges:110060, apayer:1569939 },
]
for (const x of cas) {
  const ids=await lot(x.vendeur,x.specs,'2026-09-01')
  const r=await etablir(U.manager,x.vendeur,ids)
  let f=await releve(r.reglement_id)
  check(`${x.nom} : ${ids.length} leads, total ${x.total}`, f.nb_commandes===ids.length && nombre(f.total_ventes)===x.total, JSON.stringify([f.nb_commandes,f.total_ventes]))
  check(`${x.nom} : frais commande ${x.fc}, livraison ${x.fl}, upsell ${x.upsell}`, nombre(f.frais_confirmation)===x.fc && nombre(f.frais_livraison)===x.fl && nombre(f.frais_upsell)===x.upsell,
    JSON.stringify([f.frais_confirmation,f.frais_livraison,f.frais_upsell]))
  await charges(U.manager,r.reglement_id,x.charges,'charges du mois')
  f=await releve(r.reglement_id)
  check(`${x.nom} : charges ${x.charges} → À PAYER ${x.apayer}`, nombre(f.net_a_payer)===x.apayer && nombre(f.frais_divers)===x.charges, `${f.net_a_payer}`)
}
// une ligne, en détail
const l2=(await q(`select rc.* from public.reglements_commandes rc join public.commandes c on c.id=rc.commande_id where c.vendeur_id=$1 and rc.quantite=2 limit 1`,[U.v2]))[0]
check('une ligne de 2 unités à 45 000 : 1 000 + 12 000 + 1 500 → net 30 500', nombre(l2.total_commande)===45000 && nombre(l2.frais_commande)===1000 && nombre(l2.frais_livraison)===12000 && nombre(l2.frais_upsell)===1500 && nombre(l2.net)===30500, JSON.stringify(l2))
const l3=(await q(`select rc.* from public.reglements_commandes rc join public.commandes c on c.id=rc.commande_id where c.vendeur_id=$1 and rc.quantite=3 limit 1`,[U.v2]))[0]
check('une ligne de 3 unités à 56 000 : upsell 3 000 → net 40 000', nombre(l3.frais_upsell)===3000 && nombre(l3.net)===40000, JSON.stringify(l3))

// ===== tarif du vendeur, tarif à une date, relevé figé =====
await tarif({vendeur:U.v4, fl:10000, depuis:'2026-01-01'})
await tarif({fl:15000, depuis:'2026-10-01'})   // le pays change de tarif au 1er octobre
const avant=await lead(U.v4,1,35000,'2026-09-15'), apres=await lead(U.v4,1,35000,'2026-10-15')
const ids4=[avant,apres]
const r4=await etablir(U.manager,U.v4,ids4)
const lignes4=await q(`select commande_id, frais_livraison from public.reglements_commandes where reglement_id=$1`,[r4.reglement_id])
check('tarif du VENDEUR prioritaire sur celui du pays (10 000, même après le changement du pays)', lignes4.every(l=>nombre(l.frais_livraison)===10000), JSON.stringify(lignes4))
const ids1=[await lead(U.v1,1,35000,'2026-09-15'), await lead(U.v1,1,35000,'2026-10-15')]
const r1=await etablir(U.manager,U.v1,ids1)
const lignes1=Object.fromEntries((await q(`select commande_id, frais_livraison from public.reglements_commandes where reglement_id=$1`,[r1.reglement_id])).map(l=>[l.commande_id,nombre(l.frais_livraison)]))
check('le pays change de tarif au 1/10 : livré le 15/09 → 12 000, livré le 15/10 → 15 000', lignes1[ids1[0]]===12000 && lignes1[ids1[1]]===15000, JSON.stringify(lignes1))
await sous(U.admin,'authenticated',()=>q(`update public.tarifs_vendeurs set frais_livraison=99999 where vendeur_id is null and valide_depuis='2026-10-01'`))
check('changer un tarif après coup ne change PAS un relevé établi', (await q(`select frais_livraison f from public.reglements_commandes where commande_id=$1`,[ids1[1]]))[0].f==15000)

// ===== pas de tarif =====
await sous(U.admin,'authenticated',()=>q(`delete from public.tarifs_vendeurs`))
const sans=[await lead(U.v1,1,35000)]
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`select * from public.etablir_releve($1,$2,$3,'especes',null,null)`,[T,U.v1,sans])))
check('aucun tarif saisi → relevé refusé, le pays nommé, rien créé', e?.includes('Aucun frais vendeur saisi pour Angola') && (await q(`select count(*)::int n from public.reglements_commandes where commande_id=$1`,[sans[0]]))[0].n===0, e)
// 09/11 (prod) : Angola n'a plus qu'une ligne d'UN vendeur, datée d'aujourd'hui — la répétition doit passer quand même
await tarif({vendeur:U.v1, depuis:new Date().toISOString().slice(0,10)})
await q(`update public.tarifs_vendeurs set frais_transfert_pct=1.5`)   // comme en prod le 09/11 : 1,5 % de transfert
e=await erreur(()=>db.exec(RA))
check('reglement_atomique.sql rejoué quand le pays n\'a qu\'une ligne d\'un vendeur (datée du jour, transfert 1,5 %) : la répétition passe, rien laissé',
  e===null && (await q(`select count(*)::int n from public.tarifs_vendeurs`))[0].n===1, e)
await sous(U.admin,'authenticated',()=>q(`delete from public.tarifs_vendeurs`))

// ===== charges : règles =====
const regs=await q(`select id from public.reglements order by created_at limit 1`)
e=await erreur(()=>charges(U.manager,regs[0].id,5000,'  '))
check('charges sans note → refusé', e?.includes('note obligatoire'), e)
e=await erreur(()=>charges(U.manager,regs[0].id,-1,'x'))
check('charges négatives → refusé', e?.includes('plus grand que 0'), e)
const avantDeux=nombre((await releve(regs[0].id)).frais_divers)
await charges(U.manager,regs[0].id,1000,'note 1')
await charges(U.manager,regs[0].id,1000,'note 2')
let rn=await q(`select note from public.reglements_ajustements where reglement_id=$1 and note like 'note %' order by note`,[regs[0].id])
check('deux charges → deux lignes avec leur note, charges du relevé +2 000', JSON.stringify(rn.map(x=>x.note))==='["note 1","note 2"]' && nombre((await releve(regs[0].id)).frais_divers)===avantDeux+2000, JSON.stringify(rn))
for (const [qui,uid] of [['vendeur',U.v2],['ceo',U.ceo]]) {
  e=await erreur(()=>charges(uid,regs[0].id,1,'x'))
  check(`${qui} → ne fixe pas les charges`, e?.includes('ne permet pas'), e)
}
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set net_a_payer=1 where id=$1`,[regs[0].id])))
check('« à payer » écrit à la main → refusé (garde)', e?.includes('ne se modifient pas'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set frais_upsell=0 where id=$1`,[regs[0].id])))
check('frais upsell écrits à la main → refusé (garde)', e?.includes('ne se modifient pas'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set statut='paye' where id=$1`,[regs[0].id])))
check('manager : « Marquer payé » refusé (admin / super admin seulement, 09/11)', e?.includes('Seul un admin'), e)
await sous(U.admin,'authenticated',()=>q(`update public.reglements set statut='paye' where id=$1`,[regs[0].id]))
e=await erreur(()=>charges(U.manager,regs[0].id,1,'x'))
check('relevé payé → charges refusées', e?.includes('déjà payé'), e)
check('vendeur : lit SON relevé et ses lignes avec les frais', (await sous(U.v2,'authenticated',()=>q(`select count(*)::int n from public.reglements_commandes rc join public.reglements r on r.id=rc.reglement_id where r.vendeur_id=$1 and rc.frais_livraison>0`,[U.v2])))[0].n===21)

// ===== retours =====
await base()
await tarif({})
const idsR=await lot(U.v2,[[2,1,35000]],'2026-09-01')
const rR=await etablir(U.manager,U.v2,idsR)
e=await erreur(()=>db.exec(FV)); check('frais_vendeurs.sql rejoué : passe, fixer_charges_releve reste reprise (gardée)', e===null && (await q(`select obj_description('public.fixer_charges_releve(uuid,numeric,text)'::regprocedure,'pg_proc') m`))[0].m==='fichier: retenues_releve.sql', e)
e=await erreur(()=>db.exec(lire('retenues_releve_retour.sql'))); check('retour retenues refusé tant que reglement_atomique (09/11) est là', e?.includes('reglement_atomique_retour_09_11.sql'), e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(lire('reglement_atomique_retour_09_11.sql'))); check(`retour reglement_atomique (09/11), passage ${i}`, e===null, e) }
for (const i of [1,2]) { e=await erreur(()=>db.exec(lire('retenues_releve_retour.sql'))); check(`retour retenues_releve, passage ${i}`, e===null, e) }
for (const i of [1,2]) { e=await erreur(()=>db.exec(lire('reglement_atomique_retour_05_11.sql'))); check(`retour reglement_atomique (05/11), passage ${i}`, e===null, e) }
for (const i of [1,2]) { e=await erreur(()=>db.exec(lire('frais_vendeurs_retour.sql'))); check(`retour frais_vendeurs, passage ${i}`, e===null, e) }
check('… le relevé déjà établi garde ses frais', nombre((await releve(rR.reglement_id)).frais_livraison)===24000)
const idsS=await lot(U.v3,[[1,1,35000]],'2026-09-01')
const rS=await etablir(U.manager,U.v3,idsS)
check('… un relevé se fait comme le 03/11 (sans frais : net = encaissé)', nombre((await releve(rS.reglement_id)).net_a_payer)===35000)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
