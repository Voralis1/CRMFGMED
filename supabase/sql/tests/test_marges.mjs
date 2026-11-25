// marges.sql (12/11) — A « Marge FGMED » et B « Marge produits », sur la chaîne des règles de stock,
// livraison + paiement et frais vendeurs (frais_vendeurs.sql + retenues_releve.sql) :
//   · coûts : l'admin saisit et lit ; manager, CEO, vendeur, agent, livreur, autre entreprise ni l'un ni l'autre ;
//     négatif refusé, mois = 1er du mois, pays d'une autre entreprise refusé ;
//   · A : l'exemple (2 unités à 30 000 → revenus 14 500, coûts 6 500, marge 8 000), retour, confirmations,
//     frais copiés du relevé, coûts fixes répartis par vendeur, prorata d'une semaine, pays sans livraison ;
//   · B : 30 000 − 10 000 − 14 500 = 5 500 ; produit sans coût → marge vide ; retour non compté ;
//   · calculs refusés aux autres rôles, calcul interne fermé, permission décochée ; fichier deux fois
//     (répétition comprise), retour arrière deux fois (voir_marges gardée, renommée ; statut_le retirée). Fichier RETIRÉ le 12/11.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { poserPermissions } from './aide_permissions.mjs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('stock_regles.sql'), G=lire('stock_portes.sql')
const M=lire('marges.sql'), MR=lire('marges_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', T2='22222222-2222-2222-2222-222222222222'
const U={ seller:'aaaaaaaa-0000-0000-0000-000000000001', manager:'aaaaaaaa-0000-0000-0000-000000000002', admin:'aaaaaaaa-0000-0000-0000-000000000003',
          ceo:'aaaaaaaa-0000-0000-0000-000000000004', agent:'aaaaaaaa-0000-0000-0000-000000000005',
          livreur:'aaaaaaaa-0000-0000-0000-000000000006', super_admin:'aaaaaaaa-0000-0000-0000-000000000009' }
const SELLER2='aaaaaaaa-0000-0000-0000-000000000011', MGR2='aaaaaaaa-0000-0000-0000-000000000012'
let db, AO, ENT, LIV, CG, P2, n=0
const ADM2='aaaaaaaa-0000-0000-0000-000000000013'
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
async function base(){
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
  for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql']) await db.exec(lire(f))
  await db.exec(`alter table public.commandes add column if not exists articles jsonb;
    alter table public.produits add column if not exists vendeur_id uuid references auth.users(id) on delete set null;`)
  await db.exec(lire('tests/fixtures/produit_de_commande_prod_29_10.sql')); await db.exec(lire('tests/fixtures/stats_dashboard_prod_29_10.sql'))
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'})
  await ins('tenants',{id:T2,nom_entreprise:'Autre'})
  for (const [r,u] of Object.entries(U)) {
    await q(`insert into auth.users values ($1,$2)`,[u,r+'@x'])
    await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:r+'@x'})
  }
  for (const [r,u] of [['seller',SELLER2]]) { await q(`insert into auth.users values ($1,'seller2@x')`,[u]); await ins('user_roles',{user_id:u,tenant_id:T,role:r,email:'seller2@x'}) }
  await q(`insert into auth.users values ($1,'mgr2@x')`,[MGR2]); await ins('user_roles',{user_id:MGR2,tenant_id:T2,role:'manager',email:'mgr2@x'})
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,nom:'Livreur Joao',user_id:U.livreur,pays_id:AO,actif:true,zone:'Ailleurs'})).id
  await ins('agents',{tenant_id:T,nom:'Agent',user_id:U.agent,pays_id:AO,actif:true})
  for (const [nom,code,ferme,decl,rap] of [['Pending','pending',false,false,false],['Confirmed','confirmed',true,true,false],['Cancelled','cancelled',true,false,false],
    ['Unreached','unreached',false,false,false],['Reminder','reminder',false,false,true]])
    await ins('statuts',{tenant_id:T,nom,code,ferme_le_lead:ferme,declenche_assignation:decl,necessite_rappel:rap,type:'appel'})
  await db.exec(`set session_replication_role = origin`)
  await poserPermissions(db,{ actions_masse:['manager','admin','super_admin'], gerer_reglements:['manager','admin','super_admin'], assigner_livreur:['manager','admin','super_admin'] })
  for (const f of ['statut_pending.sql','historique_statuts.sql','leads_remontes.sql','appels_responsables.sql','renvoyer_en_attente.sql',
                   'commandes_statut_lot.sql','commandes_produit_id.sql','stock_livraison_autre_vendeur.sql','paiement_unique_commande.sql','livraison_atomique.sql','vendeur_commande.sql'])
    await db.exec(lire(f))
  await db.exec(F); await db.exec(G)
  await db.exec(lire('frais_vendeurs.sql')); await db.exec(lire('retenues_releve.sql'))
  CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG',devise:'XAF'})).id
  P2=(await ins('pays',{tenant_id:T2,nom:'Angola',code:'AO',devise:'AOA'})).id
  await q(`insert into auth.users values ($1,'admin2@x')`,[ADM2]); await ins('user_roles',{user_id:ADM2,tenant_id:T2,role:'admin',email:'admin2@x'})
  await poserPermissions(db,{})
  // la politique de prod, lue le 12/11
  await db.exec(`drop policy if exists commandes_delete on public.commandes;
    create policy commandes_delete on public.commandes for delete to authenticated
      using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id()) and (public.mon_role() = any (array['admin','ceo','manager']))));`)
}
const produit=async(code,stock)=>{
  const id=(await ins('produits',{tenant_id:T,product:'Produit '+code,code,price:1})).id
  if (stock) await q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'entree',$4,'stock initial')`,[T,id,ENT,stock])
  return id
}
const lead=async(code,vendeur=U.seller,qte=1,prix=1)=>(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C'+n,client_telephone:'+244'+n,produit:code,quantite:qte,prix,ville_zone:'Luanda',adresse:'rue',vendeur_id:vendeur})).id
const confirmer=id=>q(`update public.commandes set statut_confirmation='Confirmed' where id=$1`,[id])
const livraison=async id=>{ const l=(await q(`select id from public.livraisons where commande_id=$1`,[id]))[0]; return l? l.id : (await ins('livraisons',{tenant_id:T,commande_id:id,livreur_id:LIV,statut:'a_preparer'})).id }
const livStatut=(l,s,montant=null)=>sous(null,'service_role',()=>q(`select * from public.enregistrer_livraison($1,$2,$3,$4)`,[l,s,s==='retour'?'refus client':null,s==='livre'?montant:null]))
const livrer=async(id,montant)=>{ await confirmer(id); const l=await livraison(id); await livStatut(l,'expedie'); await livStatut(l,'livre',montant); return l }
const P=async()=>(await q(`select date_trunc('month',current_date)::date d, (date_trunc('month',current_date)+interval '1 month - 1 day')::date f, extract(day from date_trunc('month',current_date)+interval '1 month - 1 day')::int j`))[0]
const A=async(uid,d,f,tenant=T)=>sous(uid,'authenticated',()=>q(`select * from public.marge_fgmed($1,$2,$3)`,[tenant,d,f]))
const B=async(uid,d,f,tenant=T)=>sous(uid,'authenticated',()=>q(`select * from public.marge_produits($1,$2,$3)`,[tenant,d,f]))
const num=x=>x==null?null:Number(x)
const ligne=(rows,vendeur,pays=AO)=>rows.find(r=>r.pays_id===pays && r.vendeur_id===vendeur && !r.non_reparti)

await base()
for (const i of [1,2]) { const e=await erreur(()=>db.exec(M)); check(`fichier, passage ${i} (répétition comprise)`, e===null, e) }
check('voir_marges → admin, super_admin', (await q(`select string_agg(r.nom, ',' order by r.nom) s from public.role_permissions rp join public.roles r on r.id=rp.role_id where rp.permission_code='voir_marges'`))[0].s==='admin,super_admin')
check('la répétition ne laisse aucun coût', (await q(`select (select count(*) from public.couts_fgmed)+(select count(*) from public.couts_fixes)::int n`))[0].n==0)

// le tarif vendeur du pays (Paramètres → Frais vendeurs), comme en prod : 1 000 / 12 000 / 1 500
await q(`insert into public.tarifs_vendeurs (tenant_id,pays_id,frais_commande,frais_livraison,frais_upsell_unite,valide_depuis) values ($1,$2,1000,12000,1500,'2026-01-01')`,[T,AO])
const {d,f,j}=await P()

// --- les coûts : l'admin les saisit, les autres non
let e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`insert into public.couts_fgmed (tenant_id,pays_id,cout_livraison,cout_retour,cout_confirmation,valide_depuis) values ($1,$2,5500,2000,1000,'2026-01-01')`,[T,AO])))
check('admin saisit les coûts FGMED (5 500 / 2 000 / 1 000)', e===null, e)
for (const qui of ['manager','ceo','seller','agent','livreur']) {
  e=await erreur(()=>sous(U[qui],'authenticated',()=>q(`insert into public.couts_fgmed (tenant_id,pays_id,cout_livraison,valide_depuis) values ($1,$2,1,'2026-02-01')`,[T,AO])))
  const lu=(await sous(U[qui],'authenticated',()=>q(`select (select count(*) from public.couts_fgmed)+(select count(*) from public.couts_produits)+(select count(*) from public.couts_fixes) n`)))[0].n
  check(`${qui} : ne saisit pas, ne lit pas les coûts`, e?.includes('row-level security') && Number(lu)===0, e+' lu '+lu)
}
e=await erreur(()=>sous(ADM2,'authenticated',()=>q(`insert into public.couts_fgmed (tenant_id,pays_id,cout_livraison) values ($1,$2,1)`,[T2,AO])))
check('admin d\'une autre entreprise : pays d\'ailleurs refusé', e?.includes('pas de cette entreprise'), e)
check('admin d\'une autre entreprise ne lit pas nos coûts', Number((await sous(ADM2,'authenticated',()=>q(`select count(*) n from public.couts_fgmed`)))[0].n)===0)
e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`insert into public.couts_fgmed (tenant_id,pays_id,cout_livraison,valide_depuis) values ($1,$2,-1,'2026-03-01')`,[T,AO])))
check('coût négatif refusé', e?.includes('check'), e)
e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`insert into public.couts_fixes (tenant_id,pays_id,mois,montant) values ($1,$2,'2026-11-15',1)`,[T,AO])))
check('coût fixe : un mois = le 1er du mois', e?.includes('check'), e)

// --- A : l'exemple de la démo (2 unités à 30 000)
const PA=await produit('pa',50)
const o1=await lead('pa',U.seller,2,30000); await livrer(o1,30000)
let a=await A(U.admin,d,f); let s1=ligne(a,U.seller)
check('A : 1 livrée, 1 confirmée, encaissé 30 000', s1?.nb_livrees===1 && s1?.nb_confirmees===1 && num(s1?.encaisse)===30000, JSON.stringify(s1))
check('A : revenus 14 500 (1 000 + 12 000 + 1 500)', num(s1?.revenus)===14500, s1?.revenus)
check('A : coûts 5 500 + 1 000, marge 8 000', num(s1?.cout_livraisons)===5500 && num(s1?.cout_confirmations)===1000 && num(s1?.marge)===8000, JSON.stringify(s1))
check('A : livraisons.statut_le posée', (await q(`select statut_le from public.livraisons where commande_id=$1`,[o1]))[0].statut_le!==null)

// --- B : coût d'achat 5 000
e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`insert into public.couts_produits (tenant_id,produit_id,cout_unite,valide_depuis) values ($1,$2,5000,'2026-01-01')`,[T,PA])))
check('admin saisit le coût d\'achat (5 000)', e===null, e)
let b=await B(U.admin,d,f); let pb=b.find(r=>r.produit_id===PA)
check('B : 30 000 − 10 000 − 14 500 = 5 500', num(pb?.encaisse)===30000 && num(pb?.cout_achat)===10000 && num(pb?.frais_fgmed)===14500 && num(pb?.marge)===5500 && pb?.unites===2, JSON.stringify(pb))
const PB=await produit('pb',50)
const o2=await lead('pb',U.seller,1,20000); await livrer(o2,20000)
b=await B(U.admin,d,f); let pbb=b.find(r=>r.produit_id===PB)
check('B : produit sans coût → marge vide, 1 sans coût', pbb?.marge===null && pbb?.nb_sans_cout===1, JSON.stringify(pbb))
check('B : le produit avec coût garde sa marge', num(b.find(r=>r.produit_id===PA)?.marge)===5500)

// --- A : un retour
const o3=await lead('pa',U.seller,1,10000); await confirmer(o3); const l3=await livraison(o3); await livStatut(l3,'expedie'); await livStatut(l3,'retour')
a=await A(U.admin,d,f); s1=ligne(a,U.seller)
// livrées : o1 (14 500), o2 (13 000) ; confirmées : o1, o2, o3 ; retour : o3
check('A : 1 retour coûte 2 000 ; 3 confirmés 3 000 ; 2 livrées 11 000', s1?.nb_retours===1 && num(s1?.cout_retours)===2000 && s1?.nb_confirmees===3 && num(s1?.cout_confirmations)===3000 && num(s1?.cout_livraisons)===11000, JSON.stringify(s1))
check('A : marge = 27 500 − 16 000 = 11 500', num(s1?.revenus)===27500 && num(s1?.marge)===11500, JSON.stringify(s1))
check('B : le retour ne compte pas (pas livré)', b.find(r=>r.produit_id===PA)?.nb_livrees===1)

// --- frais copiés du relevé
const reg=await ins('reglements',{tenant_id:T,vendeur_id:U.seller,periode_debut:'2026-11-01',periode_fin:'2026-11-07'})
await db.exec(`set session_replication_role = replica`)
await ins('reglements_commandes',{commande_id:o2,reglement_id:reg.id,tenant_id:T,montant:20000,quantite:1,total_commande:20000,frais_commande:1000,frais_livraison:10000,frais_upsell:0,net:9000})
await db.exec(`set session_replication_role = origin`)
a=await A(U.admin,d,f); s1=ligne(a,U.seller)
check('A : une commande sur un relevé lit ses frais COPIÉS (11 000, pas 13 000)', num(s1?.revenus)===25500, s1?.revenus)

// --- coûts fixes : au prorata, répartis par vendeur
const o4=await lead('pa',SELLER2,1,15000); await livrer(o4,15000)
await sous(U.admin,'authenticated',()=>q(`insert into public.couts_fixes (tenant_id,pays_id,mois,montant,note) values ($1,$2,$3,30000,'loyer')`,[T,AO,d]))
a=await A(U.admin,d,f)
const fx1=num(ligne(a,U.seller)?.cout_fixes), fx2=num(ligne(a,SELLER2)?.cout_fixes)
check('fixes, mois entier : 30 000 répartis 2 livrées / 1 livrée → 20 000 / 10 000', fx1===20000 && fx2===10000, fx1+' / '+fx2)
const fin7=(await q(`select ($1::date + 6) f`,[d]))[0].f
a=await A(U.admin,d,fin7)
const tot7=a.filter(r=>r.pays_id===AO).reduce((t,r)=>t+num(r.cout_fixes),0)
check(`fixes, une semaine : 30 000 × 7/${j} comptés`, Math.abs(tot7-Math.round(30000*7/j*100)/100)<0.05, tot7)
await sous(U.admin,'authenticated',()=>q(`insert into public.couts_fixes (tenant_id,pays_id,mois,montant) values ($1,$2,$3,9000)`,[T,CG,d]))
a=await A(U.admin,d,f); const nr=a.find(r=>r.pays_id===CG)
check('fixes d\'un pays sans livraison → ligne « non répartie », marge −9 000, devise XAF', nr?.non_reparti===true && nr?.vendeur_id===null && num(nr?.marge)===-9000 && nr?.devise==='XAF', JSON.stringify(nr))

// --- qui calcule
for (const qui of ['manager','ceo','seller','agent','livreur']) {
  e=await erreur(()=>A(U[qui],d,f)); const e2=await erreur(()=>B(U[qui],d,f))
  check(`${qui} : A et B refusés`, e?.includes('réservées') && e2?.includes('réservées'), e+' / '+e2) }
check('super admin calcule', (await A(U.super_admin,d,f)).length>0)
e=await erreur(()=>A(ADM2,d,f,T)); check('admin d\'une autre entreprise : refusé', e?.includes('réservées'), e)
e=await erreur(()=>sous(U.admin,'authenticated',()=>q(`select * from public.marges_livrees($1,$2,$3)`,[T,d,f])))
check('le calcul interne est fermé au navigateur', e?.includes('permission denied'), e)
e=await erreur(()=>A(U.admin,f,d)); check('période à l\'envers refusée', e?.includes('période'), e)
// l'admin perd la permission → plus rien
await db.exec(`delete from public.role_permissions where permission_code='voir_marges' and role_id=(select id from public.roles where nom='admin' limit 1)`)
e=await erreur(()=>A(U.admin,d,f))
check('permission décochée → admin refusé, ne lit plus les coûts', e?.includes('réservées') && Number((await sous(U.admin,'authenticated',()=>q(`select count(*) n from public.couts_fgmed`)))[0].n)===0, e)

// --- retour arrière
for (const i of [1,2]) { e=await erreur(()=>db.exec(MR)); check(`retour arrière, passage ${i}`, e===null, e) }
check('retour : tables, calculs, statut_le partis ; voir_marges gardée et renommée ; livraisons gardées',
  (await q(`select to_regclass('public.couts_fgmed') t`))[0].t===null && (await q(`select to_regprocedure('public.marge_fgmed(uuid,date,date)') t`))[0].t===null
  && (await q(`select count(*)::int n from information_schema.columns where table_name='livraisons' and column_name='statut_le'`))[0].n===0
  && (await q(`select nom from public.permissions where code='voir_marges'`))[0]?.nom==='Simulateur de rentabilité'
  && (await q(`select count(*)::int n from public.livraisons`))[0].n===4)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
