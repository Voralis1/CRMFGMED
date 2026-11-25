// retenues_releve.sql (09/11) — le bas du relevé, sur le schéma réel + frais_vendeurs + reglement_atomique :
//   · prérequis ; fichier deux fois ; les charges d'avant → une ligne « Autre » (même total, pas en double) ;
//   · l'exemple du document : 79 000 ; transfert 1,5 % copié → 1 185 / 77 815 ; crédit 10 000 → 1 035 / 67 965 ;
//     pénalité 1 000 → 1 020 / 66 980 ; remboursement, correction (sens obligatoire), retrait recalculé ;
//   · crédit : date + kg + prix au kg + montant TAPÉS (pas recalculé), note facultative, tout vide = 0 ; refus (un champ manquant, poids 0, montant < 0) ;
//   · droits : manager / admin oui ; vendeur, ceo non ; vendeur LIT ses lignes, pas celles d'un autre ;
//     aucune écriture directe (table, colonnes du relevé) ; payé = figé ; relevé supprimé = lignes parties ;
//   · % du vendeur prioritaire ; % changé après coup ne change pas un relevé ; ancienne porte des charges refusée ;
//   · mutant (calcul du transfert faux) arrêté par la répétition.
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


const tarifPct=async(vals)=>{ const id=(await tarif(vals))[0].id; await q(`update public.tarifs_vendeurs set frais_transfert_pct=$2 where id=$1`,[id,vals.pct??0]); return id }
// 09/11 soir : date + kg + prix au kg + montant, TOUS tapés ; tout vide = 0
const credit=(uid,reg,jour,poids,prix,montant,note)=>sous(uid,'authenticated',()=>q(`select public.fixer_credit_expedition($1,$2,$3,$4,$5,$6) net`,[reg,jour,poids,prix,montant,note]))
const ajust=(uid,reg,type,m,plus,note)=>sous(uid,'authenticated',()=>q(`select public.ajouter_ajustement($1,$2,$3,$4,$5) id`,[reg,type,m,plus,note])).then(r=>r[0].id)
const retirer=(uid,id)=>sous(uid,'authenticated',()=>q(`select public.retirer_ajustement($1) net`,[id]))
const chiffres=async id=>{ const r=await releve(id); return [nombre(r.credit_expedition),nombre(r.frais_divers),nombre(r.frais_transfert),nombre(r.net_a_payer)] }

// ===== prérequis =====
await base({frais:false, releve:false})
let e=await erreur(()=>db.exec(RR))
check('prérequis : refusé sans frais_vendeurs.sql', e?.includes('lancez d\'abord frais_vendeurs.sql'), e)

// ===== reprise des charges d'avant =====
await db.exec(FV)
await db.exec(`set session_replication_role = replica`)
const ancien=(await ins('reglements',{tenant_id:T,vendeur_id:U.v1,total_ventes:22000,net_a_payer:20000,frais_divers:2000,frais_divers_note:'test 3',statut:'paye',nb_commandes:1,periode_debut:'2026-09-01',periode_fin:'2026-09-30'})).id
const ancien0=(await ins('reglements',{tenant_id:T,vendeur_id:U.v1,total_ventes:5000,net_a_payer:5000,frais_divers:0,statut:'en_attente',nb_commandes:1,periode_debut:'2026-09-01',periode_fin:'2026-09-30'})).id
await db.exec(`set session_replication_role = origin`)
for (const i of [1,2]) { e=await erreur(()=>db.exec(RR)); check(`retenues_releve.sql, passage ${i} (avec sa répétition)`, e===null, e) }
await db.exec(`create function public.fixer_credit_expedition(uuid, numeric, text, numeric, numeric) returns numeric language sql as $$ select 0::numeric $$`)
await db.exec(`create function public.fixer_credit_expedition(uuid, date, numeric, numeric, text) returns numeric language sql as $$ select 0::numeric $$`)
e=await erreur(()=>db.exec(RR))
check('rejoué sur la prod du 09/11 matin : les 2 anciennes portes du crédit sont retirées, une seule reste', e===null && (await q(`select count(*)::int n from pg_proc where proname='fixer_credit_expedition'`))[0].n===1, e)
let la=await q(`select type, montant, en_plus, note from public.reglements_ajustements where reglement_id=$1`,[ancien])
check('charges d\'avant (2 000 « test 3 », payé) → UNE ligne « Autre » 2 000 « test 3 », pas en double', la.length===1 && la[0].type==='autre' && nombre(la[0].montant)===2000 && la[0].en_plus===false && la[0].note==='test 3', JSON.stringify(la))
check('… son « à payer » ne bouge pas (20 000), un relevé sans charges n\'a pas de ligne', nombre((await releve(ancien)).net_a_payer)===20000
  && (await q(`select count(*)::int n from public.reglements_ajustements where reglement_id=$1`,[ancien0]))[0].n===0)
await db.exec(RA)

// ===== l'exemple du document =====
await tarifPct({fc:0, fl:6000, fu:2000, pct:1.5})
const ids=[await lead(U.v2,1,33000), await lead(U.v2,2,60000)]
const r=(await etablir(U.manager,U.v2,ids)).reglement_id
let f=await releve(r)
check('établi : % de transfert copié (1,5), transfert 1 185, à payer 77 815', nombre(f.frais_transfert_pct)===1.5 && JSON.stringify(await chiffres(r))==='[0,0,1185,77815]', JSON.stringify(await chiffres(r)))
await credit(U.manager,r,'2026-09-02',20,500,10000,'avion')
check('crédit d\'expédition 10 000 → transfert 1 035, à payer 67 965 (le document)', JSON.stringify(await chiffres(r))==='[10000,0,1035,67965]', JSON.stringify(await chiffres(r)))
const pen=await ajust(U.manager,r,'penalite',1000,null,'retard')
check('pénalité 1 000 → transfert 1 020, à payer 66 980', JSON.stringify(await chiffres(r))==='[10000,1000,1020,66980]', JSON.stringify(await chiffres(r)))
const remb=await ajust(U.admin,r,'remboursement',500,false,'colis abîmé')
check('remboursement 500 (sens forcé : rendu au vendeur, même si « false » est envoyé) → ajustements 500, à payer 67 472,50',
  (await q(`select en_plus from public.reglements_ajustements where id=$1`,[remb]))[0].en_plus===true && JSON.stringify(await chiffres(r))==='[10000,500,1027.5,67472.5]', JSON.stringify(await chiffres(r)))
e=await erreur(()=>ajust(U.manager,r,'correction',100,null,'x'))
check('correction sans sens → refusée', e?.includes('choisissez'), e)
await ajust(U.manager,r,'correction',100,true,'erreur de prix')
check('correction rendue 100 → ajustements 400', (await chiffres(r))[1]===400)
const ligne=(await q(`select cree_par, cree_le from public.reglements_ajustements where id=$1`,[pen]))[0]
check('qui et quand sont enregistrés', ligne.cree_par===U.manager && ligne.cree_le!==null)
await retirer(U.manager,pen)
check('pénalité retirée → recalculé (ajustements −600 : à payer 69 600 − 1 044)', JSON.stringify(await chiffres(r))==='[10000,-600,1044,68556]', JSON.stringify(await chiffres(r)))
f=await releve(r)
check('crédit : date, 20 kg, 500 / kg, note gardés ; montant TAPÉ 10 000', nombre(f.credit_expedition)===10000 && nombre(f.credit_expedition_poids)===20 && nombre(f.credit_expedition_prix_kg)===500
  && f.credit_expedition_date!==null && f.credit_expedition_note==='avion', JSON.stringify([f.credit_expedition,f.credit_expedition_date,f.credit_expedition_note]))
await credit(U.manager,r,'2026-09-02',20,500,9000,null)
check('montant tapé ≠ kg × prix (9 000) : gardé tel quel, pas recalculé ; note facultative', (await releve(r)).credit_expedition_note===null && nombre((await releve(r)).credit_expedition)===9000)
await credit(U.manager,r,null,null,null,null,null)
check('tout vide → crédit 0, date / poids / prix vidés', nombre((await releve(r)).credit_expedition)===0 && (await releve(r)).credit_expedition_poids===null && (await releve(r)).credit_expedition_date===null)
await credit(U.manager,r,'2026-09-02',20,500,10000,'avion')

// ===== refus =====
for (const [nom,fn,msg] of [
  ['poids sans prix', ()=>credit(U.manager,r,'2026-09-02',20,null,10000,'x'), 'ET le montant'],
  ['sans date', ()=>credit(U.manager,r,null,20,500,10000,'x'), 'ET le montant'],
  ['sans montant', ()=>credit(U.manager,r,'2026-09-02',20,500,null,'x'), 'ET le montant'],
  ['poids 0', ()=>credit(U.manager,r,'2026-09-02',0,500,10000,'x'), 'invalide'],
  ['montant négatif', ()=>credit(U.manager,r,'2026-09-02',20,500,-1,'x'), 'invalide'],
  ['ajustement à 0', ()=>ajust(U.manager,r,'penalite',0,null,'x'), 'plus grand que 0'],
  ['ajustement sans note', ()=>ajust(U.manager,r,'penalite',10,null,'  '), 'note obligatoire'],
  ['type inconnu', ()=>ajust(U.manager,r,'cadeau',10,null,'x'), 'inconnu'],
  ['vendeur ajoute', ()=>ajust(U.v2,r,'remboursement',10,null,'x'), 'ne permet pas'],
  ['ceo fixe le crédit', ()=>credit(U.ceo,r,'2026-09-02',1,1,1,'x'), 'ne permet pas'],
  ['vendeur retire', ()=>retirer(U.v2,remb), 'ne permet pas'],
  ['ancienne porte des charges', ()=>sous(U.manager,'authenticated',()=>q(`select public.fixer_charges_releve($1,1,'x')`,[r])), 'rechargez la page'],
]) { e=await erreur(fn); check(`refusé : ${nom}`, e?.includes(msg), e) }
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`insert into public.reglements_ajustements (reglement_id,tenant_id,type,montant,note) values ($1,$2,'autre',1,'x')`,[r,T])))
check('manager : écriture directe dans les ajustements → refusée', e?.includes('permission denied'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set credit_expedition=1 where id=$1`,[r])))
check('manager : crédit écrit à la main sur le relevé → refusé (garde)', e?.includes('ne se modifient pas'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set credit_expedition_date='2020-01-01' where id=$1`,[r])))
check('manager : date d\'expédition écrite à la main → refusée (garde)', e?.includes('ne se modifient pas'), e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set frais_transfert_pct=0 where id=$1`,[r])))
check('manager : % de transfert écrit à la main → refusé (garde)', e?.includes('ne se modifient pas'), e)
check('vendeur : lit les lignes de SON relevé', (await sous(U.v2,'authenticated',()=>q(`select count(*)::int n from public.reglements_ajustements where reglement_id=$1`,[r])))[0].n===2)
check('autre vendeur : ne lit rien', (await sous(U.v3,'authenticated',()=>q(`select count(*)::int n from public.reglements_ajustements`)))[0].n===0)

// ===== % : vendeur prioritaire, figé après coup =====
await tarifPct({vendeur:U.v3, fc:0, fl:6000, fu:2000, pct:3, depuis:'2026-01-02'})
const r3=(await etablir(U.manager,U.v3,[await lead(U.v3,1,33000)])).reglement_id
check('% du vendeur (3) prioritaire sur celui du pays (1,5) : 27 000 → 810', nombre((await releve(r3)).frais_transfert_pct)===3 && (await chiffres(r3))[2]===810, JSON.stringify(await chiffres(r3)))
await q(`update public.tarifs_vendeurs set frais_transfert_pct=50`)
await ajust(U.manager,r3,'penalite',1000,null,'x')
check('% changé dans Paramètres après coup : le relevé garde le sien (3 % de 26 000 = 780)', (await chiffres(r3))[2]===780, JSON.stringify(await chiffres(r3)))

// ===== P8 (11/11) : le taux MAD =====
{
  let e2=await erreur(()=>db.exec(lire('taux_mad_releve.sql'))); check('taux_mad_releve.sql installé (deux fois)', e2===null && (await erreur(()=>db.exec(lire('taux_mad_releve.sql'))))===null, e2)
  const net=nombre((await releve(r)).net_a_payer)
  const mad=(await sous(U.manager,'authenticated',()=>q(`select public.fixer_taux_mad($1,0.0105) m`,[r])))[0].m
  check('taux 0,0105 → équivalent = à payer × taux', nombre(mad)===Math.round(net*0.0105*100)/100 && nombre((await releve(r)).taux_mad)===0.0105, `${mad} / ${net}`)
  e2=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.fixer_taux_mad($1,0)`,[r]))); check('taux 0 → refusé', e2?.includes('plus grand que 0'), e2)
  e2=await erreur(()=>sous(U.v2,'authenticated',()=>q(`select public.fixer_taux_mad($1,1)`,[r]))); check('vendeur → refusé', e2?.includes('ne permet pas'), e2)
  await sous(U.manager,'authenticated',()=>q(`select public.fixer_taux_mad($1,null)`,[r]))
  check('taux vide → enlevé', (await releve(r)).taux_mad===null)
  await sous(U.manager,'authenticated',()=>q(`select public.fixer_taux_mad($1,0.0105)`,[r]))
  check('le relevé n\'a pas changé de montant', nombre((await releve(r)).net_a_payer)===net)
}

// ===== payé = figé ; supprimé = lignes parties =====
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set paye_par=$2 where id=$1`,[r,U.admin])))
check('« payé par » écrit à la main → refusé (garde)', e?.includes('ne se modifient pas'), e)
check('créé par : le manager qui a établi le relevé', (await releve(r)).cree_par===U.manager)
await sous(U.admin,'authenticated',()=>q(`update public.reglements set statut='paye' where id=$1`,[r]))
check('payé par : l\'admin qui a cliqué « Marquer payé », avec la date', (await releve(r)).paye_par===U.admin && (await releve(r)).date_paiement!==null)
e=await erreur(()=>sous(U.manager,'authenticated',()=>q(`select public.fixer_taux_mad($1,0.02)`,[r])))
check('payé → le taux MAD change encore (pour information, sa décision 11/11)', e===null && nombre((await releve(r)).taux_mad)===0.02, e)
e=await sous(U.manager,'authenticated',()=>erreur(()=>q(`update public.reglements set net_a_payer=1, taux_mad=0.03 where id=$1`,[r])))
check('payé → le taux ne fait pas passer un autre champ (à payer)', e?.includes('déjà payé'), e)
e=await erreur(()=>sous(U.v2,'authenticated',()=>q(`select public.fixer_taux_mad($1,0.05)`,[r])))
check('payé → le vendeur ne change pas le taux', e?.includes('ne permet pas'), e)
for (const [nom,fn] of [['crédit',()=>credit(U.manager,r,'2026-09-02',1,1,1,'x')],['ajout',()=>ajust(U.manager,r,'penalite',1,null,'x')],['retrait',()=>retirer(U.manager,remb)]]) {
  e=await erreur(fn); check(`payé → ${nom} refusé`, e?.includes('déjà payé'), e) }
await sous(U.manager,'authenticated',()=>q(`delete from public.reglements where id=$1`,[r3]))
check('relevé non payé supprimé → ses ajustements partis', (await q(`select count(*)::int n from public.reglements_ajustements where reglement_id=$1`,[r3]))[0].n===0)

// ===== mutant =====
await base({frais:true, releve:false})
const M=RR.replace(`round(s.st * coalesce(p_pct, 0) / 100, 2)`, `round(s.st * coalesce(p_pct, 0) / 10, 2)`)
check('mutant bien fabriqué', M!==RR)
e=await erreur(()=>db.exec(M))
check('mutant (transfert ×10) arrêté par la répétition, rien installé', e?.includes('le calcul se trompe') && (await q(`select to_regclass('public.reglements_ajustements') t`))[0].t===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
