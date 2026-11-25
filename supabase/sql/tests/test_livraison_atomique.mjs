// livraison_atomique.sql (04/11) sur le schéma réel + la livraison de stock + paiement unique :
//   · « livre » : livraison, copie sur la commande, paiement en_attente (montant tapé),
//     statut_paiement, stock sorti — ensemble ;
//   · le paiement ÉCHOUE (panne injectée) → RIEN n'a bougé : livraison, copie, stock, mouvement ;
//   · un paiement déjà là → refusé AVANT de toucher la livraison, message clair ;
//   · 2e appui → « déjà close », un seul paiement ; retour / annulé avec motif, sans paiement ;
//     expédiée ; statut invalide, montant négatif ou vide refusés ;
//   · droits : clé service oui ; compte connecté, anon non ;
//   · fichier deux fois ; mutant (contrôle « paiement existe » retiré) arrêté par la répétition ;
//   · retour arrière deux fois.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
const F=lire('livraison_atomique.sql'), RET=lire('livraison_atomique_retour.sql')
const T='17144700-2b95-43fa-9849-9e7a8f35104e', UL='aaaaaaaa-0000-0000-0000-000000000006', UM='aaaaaaaa-0000-0000-0000-000000000002'
let db, AO, ENT, LIV, PROD, n=0
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
  for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql','commandes_pays_entreprise.sql']) await db.exec(lire(f))
  await db.exec(`grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    alter default privileges in schema public grant all on functions to authenticated;`)
  await db.exec(`set session_replication_role = replica`)
  await ins('tenants',{id:T,nom_entreprise:'FGMED (Données Existantes)'})
  await q(`insert into auth.users values ($1,'l@x'),($2,'m@x')`,[UL,UM])
  await ins('user_roles',{user_id:UL,tenant_id:T,role:'livreur'}); await ins('user_roles',{user_id:UM,tenant_id:T,role:'manager'})
  AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO',devise:'AOA'})).id
  ENT=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
  LIV=(await ins('livreurs',{tenant_id:T,user_id:UL,pays_id:AO,actif:true,nom:'L',zone:'Luanda'})).id
  PROD=(await ins('produits',{tenant_id:T,product:'product a',code:'product-a',price:1})).id
  await ins('stocks',{tenant_id:T,produit_id:PROD,entrepot_id:ENT,quantite_disponible:5,quantite_reservee:0,quantite_defectueuse:0})
  await db.exec(`set session_replication_role = origin`)
  await db.exec(lire('paiement_unique_commande.sql'))
  if (installer) await db.exec(F)
}
const livraison=async(statut='expedie')=>{
  await db.exec(`set session_replication_role = replica`)
  const c=(await ins('commandes',{lead_id:'L'+(++n),tenant_id:T,pays_id:AO,client_nom:'C',client_telephone:'+244'+n,produit:'product-a',quantite:1,prix:1000,entrepot_id:ENT})).id
  const l=(await ins('livraisons',{tenant_id:T,commande_id:c,livreur_id:LIV,statut})).id
  await db.exec(`set session_replication_role = origin`)
  return {c,l}
}
const appel=(l,statut,montant=null,motif=null)=>sous(null,'service_role',()=>q(`select * from public.enregistrer_livraison($1,$2,$3,$4)`,[l,statut,motif,montant]))
const etat=async({c,l})=>({
  liv:(await q(`select statut, motif_retour, date_livraison from public.livraisons where id=$1`,[l]))[0],
  cmd:(await q(`select statut_livraison, statut_paiement, stock_ajuste from public.commandes where id=$1`,[c]))[0],
  pai:await q(`select montant, statut from public.paiements where commande_id=$1`,[c]),
  stock:(await q(`select quantite_disponible q from public.stocks where produit_id=$1 and entrepot_id=$2`,[PROD,ENT]))[0].q,
  mvts:(await q(`select count(*)::int n from public.mouvements_stock where notes like '%'||$1`,[c]))[0].n })

// ===== installation =====
await base({installer:false})
for (const i of [1,2]) { const e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }

// ===== « livre » : tout ensemble =====
let x=await livraison(), r=(await appel(x.l,'livre',1000))[0], s=await etat(x)
check('« Livré » : livraison livre + date', s.liv.statut==='livre' && s.liv.date_livraison!==null)
check('… copie sur la commande = livre, statut_paiement = en_attente', s.cmd.statut_livraison==='livre' && s.cmd.statut_paiement==='en_attente')
check('… UN paiement en_attente de 1000 (le montant tapé)', s.pai.length===1 && Number(s.pai[0].montant)===1000 && s.pai[0].statut==='en_attente' && r.paiement_id)
check('… stock sorti (5 → 4), un mouvement', s.stock===4 && s.mvts===1, JSON.stringify(s))

// ===== le paiement échoue : rien ne bouge =====
await db.exec(`create or replace function public._panne() returns trigger language plpgsql as $$ begin raise exception 'panne réseau simulée'; end $$;
  create trigger zz_panne before insert on public.paiements for each row execute function public._panne();`)
x=await livraison(); const avant=await etat(x)
let e=await erreur(()=>appel(x.l,'livre',1000))
s=await etat(x)
check('paiement qui échoue → erreur renvoyée', e?.includes('panne réseau simulée'), e)
check('… la livraison n\'a PAS bougé (toujours expédiée, pas de date)', s.liv.statut==='expedie' && s.liv.date_livraison===null)
check('… la copie sur la commande n\'a pas bougé', s.cmd.statut_livraison===avant.cmd.statut_livraison && s.cmd.stock_ajuste===null)
check('… le stock n\'a PAS bougé, aucun mouvement', s.stock===avant.stock && s.mvts===0, JSON.stringify(s))
check('… aucun paiement', s.pai.length===0)
await db.exec(`drop trigger zz_panne on public.paiements`)
r=(await appel(x.l,'livre',1000))[0]
check('… le livreur réappuie : cette fois tout passe', (await etat(x)).liv.statut==='livre' && (await etat(x)).pai.length===1)

// ===== un paiement déjà là =====
x=await livraison()
await db.exec(`set session_replication_role = replica`)
await ins('paiements',{tenant_id:T,commande_id:x.c,livreur_id:LIV,montant:1,methode:'cod',statut:'en_attente'})
await db.exec(`set session_replication_role = origin`)
const st0=(await etat(x)).stock
e=await erreur(()=>appel(x.l,'livre',1000))
check('paiement déjà là → refusé, message clair (pas « duplicate key »)', e?.includes('Un paiement existe déjà') && !e.includes('duplicate'), e)
check('… livraison et stock intacts', (await etat(x)).liv.statut==='expedie' && (await etat(x)).stock===st0)

// ===== 2e appui, retour, annulé, expédiée, refus =====
x=await livraison(); await appel(x.l,'livre',500)
e=await erreur(()=>appel(x.l,'livre',500))
check('2e « Livré » → « déjà close (livre) », un seul paiement', e?.includes('déjà close (livre)') && (await etat(x)).pai.length===1, e)
e=await erreur(()=>appel(x.l,'retour',null,'client absent'))
check('… et un retour sur une livraison livrée → « déjà close » aussi', e?.includes('déjà close'), e)
x=await livraison(); await appel(x.l,'retour',null,'  client absent  ')
s=await etat(x)
check('retour : motif gardé (espaces retirés), aucun paiement, aucun mouvement', s.liv.statut==='retour' && s.liv.motif_retour==='client absent' && s.pai.length===0 && s.mvts===0 && s.cmd.statut_livraison==='retour')
x=await livraison(); await appel(x.l,'annule',null,'')
s=await etat(x)
check('annulé, motif vide → motif NULL, aucun paiement', s.liv.statut==='annule' && s.liv.motif_retour===null && s.pai.length===0)
x=await livraison('a_preparer'); await appel(x.l,'expedie')
s=await etat(x)
check('à préparer → expédiée : statut + copie, pas de paiement', s.liv.statut==='expedie' && s.cmd.statut_livraison==='expedie' && s.pai.length===0)
for (const [quoi,st,m,attendu] of [['statut « a_preparer »','a_preparer',null,'invalide'],['statut inconnu','livree',1,'invalide'],['montant négatif','livre',-5,'Montant encaissé invalide'],['montant vide','livre',null,'Montant encaissé invalide']]) {
  x=await livraison(); e=await erreur(()=>appel(x.l,st,m))
  check(`${quoi} → refusé, rien ne bouge`, e?.includes(attendu) && (await etat(x)).liv.statut==='expedie', e)
}
e=await erreur(()=>appel('00000000-0000-0000-0000-000000000000','livre',1))
check('livraison introuvable → refusé', e?.includes('introuvable'), e)

// ===== droits =====
x=await livraison()
for (const [qui,uid,role] of [['livreur connecté',UL,'authenticated'],['manager connecté',UM,'authenticated'],['anon',null,'anon']]) {
  e=await sous(uid,role,()=>erreur(()=>q(`select * from public.enregistrer_livraison($1,'livre',null,1)`,[x.l])))
  check(`${qui} → ne peut pas appeler la fonction (seulement par confirmer-livraison)`, e?.includes('permission denied'), e)
}
check('… la livraison n\'a pas bougé', (await etat(x)).liv.statut==='expedie')

// ===== mutant =====
await base({installer:false})
await livraison()
const MUT=F.replace(`    if exists (select 1 from public.paiements where commande_id = v_liv.commande_id) then
      raise exception 'Un paiement existe déjà pour cette commande.';
    end if;
`,'')
check('(témoin : contrôle « paiement existe déjà » retiré)', MUT!==F)
e=await erreur(()=>db.exec(MUT))
check('mutant : arrêté par la répétition, rien installé', e?.includes('RÉPÉTITION ÉCHOUÉE') && (await q(`select to_regprocedure('public.enregistrer_livraison(uuid, text, text, numeric)') f`))[0].f===null, e)

// ===== retour =====
await base()
for (const i of [1,2]) { e=await erreur(()=>db.exec(RET)); check(`retour arrière, passage ${i}`, e===null, e) }
check('… fonction retirée', (await q(`select to_regprocedure('public.enregistrer_livraison(uuid, text, text, numeric)') f`))[0].f===null)
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
