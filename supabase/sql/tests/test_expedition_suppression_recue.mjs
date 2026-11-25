// expedition_suppression_recue.sql (10/11, T19 (a)) sur le schéma réel + la réception et la correction de
// quantité de prod (receptionner_expedition, expeditions_quantite_recue.sql) :
//   · AVANT (témoin) : une expédition reçue se supprime, son stock reste ;
//   · après : reçue → suppression refusée (vendeur, manager, super admin), stock intact ; sa ligne non plus ;
//   · la correction passe : quantité à 0 → stock 0 ; pas encore reçue → supprimable ;
//   · ligne reçue sans mouvement (produit supprimé) → retirable ; éditeur SQL (nettoyages) → passe ;
//   · fichier deux fois ; retour arrière deux fois.
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
const T='11111111-1111-1111-1111-111111111111', VEND='aaaaaaaa-0000-0000-0000-000000000001', MAN='aaaaaaaa-0000-0000-0000-000000000002', SA='aaaaaaaa-0000-0000-0000-000000000009'
await db.exec(`set session_replication_role = replica`)
await q(`insert into auth.users values ($1,'v@x'),($2,'m@x'),($3,'sa@x')`,[VEND,MAN,SA])
await ins('user_roles',{user_id:SA,tenant_id:T,role:'super_admin'})
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


const F=lire('expedition_suppression_recue.sql'), FR=lire('expedition_suppression_recue_retour.sql')
await db.exec(FQ)
const stockDe=async p=>(await q(`select quantite_disponible d from public.stocks where produit_id=$1 and entrepot_id=$2`,[p,EAO]))[0]?.d
const existe=async x=>(await q(`select count(*)::int n from public.expeditions where id=$1`,[x]))[0].n===1
const supprimer=(uid,x)=>sous(uid,'authenticated',()=>q(`delete from public.expeditions where id=$1 returning id`,[x]))

// témoin, avant le fichier
const p0=await produit(); const x0=await expedition(); await ligne(x0,p0,100); await recevoir(x0)
let r=await supprimer(MAN,x0)
check('AVANT (témoin) : le manager supprime une expédition reçue, son stock de 100 reste', r.length===1 && !(await existe(x0)) && await stockDe(p0)===100, JSON.stringify([r.length, await stockDe(p0)]))

for (const i of [1,2]) { const e=await erreur(()=>db.exec(F)); check(`fichier, passage ${i}`, e===null, e) }

const p1=await produit(); const x1=await expedition(); const l1=await ligne(x1,p1,5); await recevoir(x1)
check('reçue : stock 5', await stockDe(p1)===5)
for (const [qui,uid] of [['manager',MAN],['super admin',SA]]) {
  const e=await erreur(()=>supprimer(uid,x1))
  check(`${qui} : suppression d'une expédition reçue → refusée`, e?.includes('déjà reçue') && await existe(x1) && await stockDe(p1)===5, e)
}
// le vendeur : sa règle de suppression ne couvre déjà pas une reçue (0 ligne) — rien ne part
let rv=null; const ev=await erreur(async()=>{ rv=await supprimer(VEND,x1) })
check('vendeur : rien ne part (refusé ou 0 ligne), stock intact', (ev?.includes('déjà reçue') || rv?.length===0) && await existe(x1) && await stockDe(p1)===5, ev)
let e=await erreur(()=>sous(MAN,'authenticated',()=>q(`delete from public.expeditions_produits where id=$1`,[l1])))
check('manager : retirer une ligne reçue → refusé, stock intact', e?.includes('ne se retire pas') && await stockDe(p1)===5, e)
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=2 where id=$1`,[l1])))
check('la correction passe : quantité 5 → 2, stock 2', e===null && await stockDe(p1)===2, e+' / '+await stockDe(p1))

const x2=await expedition(); await ligne(x2,await produit(),3)
r=await supprimer(MAN,x2)
check('pas encore reçue → supprimable (avec ses lignes)', r.length===1 && !(await existe(x2)))

const p3=await produit(); const x3=await expedition(); const l3=await ligne(x3,p3,2); await recevoir(x3)
await db.exec(`set session_replication_role = replica`); await q(`update public.expeditions_produits set recu_sans_mouvement=true where id=$1`,[l3]); await db.exec(`set session_replication_role = origin`)
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`delete from public.expeditions_produits where id=$1`,[l3])))
check('ligne reçue SANS mouvement (produit supprimé) → retirable', e===null && (await q(`select count(*)::int n from public.expeditions_produits where id=$1`,[l3]))[0].n===0, e)

e=await erreur(()=>q(`delete from public.expeditions where id=$1`,[x1]))
check('éditeur SQL (nettoyages) : passe', e===null && !(await existe(x1)), e)

for (const i of [1,2]) { const e2=await erreur(()=>db.exec(FR)); check(`retour arrière, passage ${i}`, e2===null, e2) }
const x4=await expedition(); await ligne(x4,await produit(),1); await recevoir(x4)
r=await supprimer(MAN,x4)
check('après retour arrière : une reçue redevient supprimable', r.length===1)
e=await erreur(()=>db.exec(F)); check('réinstallation', e===null, e)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
