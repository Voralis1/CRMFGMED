// expedition_vendeur.sql (11/11) sur la chaîne des expéditions : le vendeur d'une expédition est un vendeur de
// l'entreprise, choisi par un responsable ; ses produits sont ceux de ce vendeur (ou communs) ; reçue → vendeur figé.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R=new URL('../../', import.meta.url).pathname
const db = new PGlite()
const q = async (sql, p) => (await db.query(sql, p)).rows
let ok=0, ko=0
const check=(name,cond,extra='')=>{cond?ok++:ko++; console.log((cond?'PASS ':'FAIL ')+name+(cond?'':'  '+extra))}
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
do $$ begin if not exists (select 1 from pg_roles where rolname='postgres') then create role postgres; end if; end $$;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true),''),
                  nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
const lire=f=>fs.readFileSync(R+'sql/'+f,'utf8')
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(lire(f))
await db.exec(`alter table public.commandes add column if not exists articles jsonb`)
// L'ordre de test_produits_historique_nom.mjs (sa répétition en dépend), puis l'état de prod du 29–30/10.
// L'entreprise existe AVANT : la vérification §5 de produits_historique_nom.sql insère pour « la
// première entreprise » — sans entreprise, elle n'insère rien et croit le refus absent.
await db.exec(`set session_replication_role = replica; insert into public.tenants (id, nom_entreprise) values ('11111111-1111-1111-1111-111111111111','FG'); set session_replication_role = origin;`)
await db.exec(lire('tests/fixtures/receptionner_expedition_prod_23_10.sql'))
await db.exec(lire('produits_suppression.sql'))
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)
await db.exec(lire('produits_historique_nom.sql'))
await db.exec(lire('tests/fixtures/receptionner_expedition_prod_29_10.sql'))
await db.exec(lire('tests/fixtures/actualiser_stock_prod_30_10.sql'))
const FD=lire('expeditions_pays_destination.sql'), FDR=lire('expeditions_pays_destination_retour.sql')
const FQ=fs.readFileSync(process.env.FICHIER||R+'sql/expeditions_quantite_recue.sql','utf8'), FQ2=lire('expeditions_quantite_recue_2_rattrapage.sql'), FQR=lire('expeditions_quantite_recue_retour.sql')
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
const T='11111111-1111-1111-1111-111111111111', VEND='aaaaaaaa-0000-0000-0000-000000000001', MAN='aaaaaaaa-0000-0000-0000-000000000002', SA='aaaaaaaa-0000-0000-0000-000000000009', VEND2='aaaaaaaa-0000-0000-0000-000000000003'
await db.exec(`set session_replication_role = replica`)
await q(`insert into auth.users values ($1,'v@x'),($2,'m@x'),($3,'sa@x')`,[VEND,MAN,SA])
await ins('user_roles',{user_id:SA,tenant_id:T,role:'super_admin'})
await q(`insert into auth.users values ($1,'v2@x')`,[VEND2]); await ins('user_roles',{user_id:VEND2,tenant_id:T,role:'seller'})
await ins('user_roles',{user_id:VEND,tenant_id:T,role:'seller'}); await ins('user_roles',{user_id:MAN,tenant_id:T,role:'manager'})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
const CG=(await ins('pays',{tenant_id:T,nom:'Congo',code:'CG'})).id
const EAO=(await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})).id
const ECG=(await ins('entrepots',{tenant_id:T,nom:'Congo',pays_id:CG,actif:true})).id
await db.exec(`set session_replication_role = origin`)
let nP=0
const produit=async()=>(await ins('produits',{tenant_id:T,product:'Produit '+(++nP),code:'P'+nP,current_quantity:0})).id
const expedition=async(extra={})=>(await ins('expeditions',{tenant_id:T,pays:'Chine',statut:'en_attente',vendeur_id:VEND,...extra})).id
const ligne=async(x,p,quantite)=>(await ins('expeditions_produits',{tenant_id:T,expedition_id:x,produit_id:p,quantite})).id
const recevoir=(x)=>sous(MAN,'authenticated',()=>q(`select * from public.receptionner_expedition($1, now(), $2, '[]'::jsonb)`,[x,EAO]))
const sortie=async(p,n)=>q(`insert into public.mouvements_stock (tenant_id,produit_id,entrepot_id,type_mouvement,quantite,notes) values ($1,$2,$3,'sortie',$4,'livraison')`,[T,p,EAO,n])
const etat=async(p,l)=>{
  const s=(await q(`select quantite_disponible d from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,EAO]))[0]?.d
  const pr=(await q(`select current_quantity c, quantite_totale t from public.produits where id=$1`,[p]))[0]
  const m=(await q(`select quantite from public.mouvements_stock where produit_id=$1 and type_mouvement='entree'`,[p])).map(r=>r.quantite)
  const li=l?(await q(`select quantite, quantite_recue from public.expeditions_produits where id=$1`,[l]))[0]:null
  const somme=(await q(`select coalesce(sum(case type_mouvement when 'entree' then quantite when 'sortie' then -quantite else 0 end),0)::int s from public.mouvements_stock where produit_id=$1 and entrepot_id=$2`,[p,EAO]))[0].s
  return { entrepot:s, produit:pr.c, total:pr.t, entrees:m, ligne:li?.quantite, recue:li?.quantite_recue, somme }
}


await db.exec(FQ)
if (!(await q(`select to_regprocedure('public.est_vendeur_du_tenant(uuid, uuid)') f`))[0].f)
  await db.exec(`create function public.est_vendeur_du_tenant(p_user uuid, p_tenant uuid) returns boolean language sql stable security definer set search_path=public as
    $$ select exists (select 1 from public.user_roles u where u.user_id=p_user and u.tenant_id=p_tenant and lower(u.role)='seller') $$`)
await q(`alter table public.produits add column if not exists vendeur_id uuid`)
const F=fs.readFileSync(R+'sql/expedition_vendeur.sql','utf8'), FR=fs.readFileSync(R+'sql/expedition_vendeur_retour.sql','utf8')
const nouvelle=(uid,vend)=>sous(uid,'authenticated',()=>q(`insert into public.expeditions (tenant_id,pays,statut,vendeur_id) values ($1,'Chine','en_attente',$2) returning id, vendeur_id`,[T,vend])).then(r=>r[0])
const lig=(uid,x,p)=>sous(uid,'authenticated',()=>q(`insert into public.expeditions_produits (tenant_id,expedition_id,produit_id,quantite) values ($1,$2,$3,1) returning id`,[T,x,p]))
const prodDe=async v=>(await ins('produits',{tenant_id:T,product:'P '+Math.random(),code:'c'+Math.random(),current_quantity:0,vendeur_id:v})).id
const pA=await prodDe(VEND), pB=await prodDe(VEND2), pC=await prodDe(null)

// témoin
let x=await nouvelle(MAN,MAN)
check('AVANT (témoin) : un manager crée une expédition à son propre nom', x.vendeur_id===MAN)
let e=await erreur(async()=>{ await lig(MAN,x.id,pA); await lig(MAN,x.id,pB) })
check('AVANT (témoin) : … avec les produits de DEUX vendeurs', e===null, e)

for (const i of [1,2]) { e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }
e=await erreur(()=>nouvelle(MAN,MAN)); check('manager : expédition à son propre nom → refusée', e?.includes('Choisissez le vendeur'), e)
e=await erreur(()=>nouvelle(MAN,null)); check('manager : sans vendeur → refusée', e?.includes('Choisissez le vendeur'), e)
x=await nouvelle(MAN,VEND); check('manager : expédition pour le vendeur A → acceptée', x.vendeur_id===VEND)
e=await erreur(()=>lig(MAN,x.id,pA)); check('… produit du vendeur A → accepté', e===null, e)
e=await erreur(()=>lig(MAN,x.id,pC)); check('… produit commun (sans vendeur) → accepté', e===null, e)
e=await erreur(()=>lig(MAN,x.id,pB)); check('… produit du vendeur B → refusé, nommé', e?.includes('n\'est pas un produit du vendeur'), e)
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions set vendeur_id=$2 where id=$1`,[x.id,VEND2])))
check('changer de vendeur avec les produits de l\'ancien → refusé', e?.includes('produits de l\'ancien vendeur'), e)
const x2=await nouvelle(MAN,VEND); await lig(MAN,x2.id,pC)
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions set vendeur_id=$2 where id=$1`,[x2.id,VEND2])))
check('changer de vendeur (seulement des produits communs, pas reçue) → passe', e===null, e)
const x3=await nouvelle(MAN,VEND); await ligne(x3.id,pA,2); await recevoir(x3.id)
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions set vendeur_id=$2 where id=$1`,[x3.id,VEND2])))
check('reçue → son vendeur ne change plus', e?.includes('déjà reçue'), e)
const xs=await nouvelle(VEND,VEND2)
check('vendeur : son expédition est à LUI, même s\'il envoie un autre nom', xs.vendeur_id===VEND)
e=await erreur(()=>lig(VEND,xs.id,pA)); check('vendeur : son produit → accepté', e===null, e)
e=await erreur(()=>q(`insert into public.expeditions (tenant_id,pays,statut,vendeur_id) values ($1,'x','en_attente',$2)`,[T,MAN]))
check('éditeur SQL : passe', e===null, e)
for (const i of [1,2]) { e=await erreur(()=>db.exec(FR)); check(`retour arrière, passage ${i}`, e===null, e) }
e=await erreur(()=>nouvelle(MAN,MAN)); check('après retour : l\'ancien comportement revient', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
