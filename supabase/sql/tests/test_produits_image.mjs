// Charge le schéma réel (supabase/migrations) dans PGlite + ce qui est en
// prod au 26/10 jusqu'à produits_proprietaire.sql, simule le schéma
// `storage` de Supabase (buckets, objects avec RLS — seulement les colonnes
// que le fichier lit), puis applique produits_image.sql deux fois.
//
// Ce que PGlite ne montre pas : l'API Storage elle-même (upload, remove,
// plafond de 2 Mo, types MIME, lecture publique). Ici, ce sont les policies
// qu'elle consulte, la contrainte sur le chemin et la vue des orphelins.
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
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create function extensions.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
-- Le strict nécessaire du schéma storage de Supabase.
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon, service_role;
grant all on storage.objects, storage.buckets to authenticated, anon, service_role;
`)
let schema=fs.readFileSync(fs.readdirSync(R+'migrations').map(f=>R+'migrations/'+f)[0],'utf8')
schema=schema.replace(/CREATE EVENT TRIGGER[\s\S]*?;\n/g,'').replace(/ALTER [A-Z ]+ OWNER TO [^;]+;\n/g,'')
try { await db.exec(schema) } catch(e){ console.log('SCHEMA LOAD ERROR:', e.message); process.exit(1) }
for (const f of ['correctif_urgent_14_10.sql','nettoyage_triggers_14_10.sql','entrepot_commande.sql']) await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
await db.exec(`alter table public.commandes add column if not exists articles jsonb`)
await db.exec(`create unique index idx_produits_code_unique on public.produits (tenant_id, lower(btrim(code))) where code is not null and btrim(code) <> ''`)
await db.exec(fs.readFileSync(R+'sql/tests/fixtures/receptionner_expedition_prod_23_10.sql','utf8'))
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
               grant all on all tables in schema public to authenticated, anon, service_role`)

const cols=async t=>(await q(`select column_name,is_nullable,data_type,column_default from information_schema.columns where table_schema='public' and table_name=$1`,[t]))
const ins=async(t,vals)=>{
  const c=await cols(t); const v={...vals}
  for(const x of c) if(!(x.column_name in v) && x.is_nullable==='NO' && !x.column_default){
    v[x.column_name]= x.data_type==='uuid'? crypto.randomUUID(): x.data_type.includes('int')||x.data_type==='numeric'?0: x.data_type==='boolean'?false:'x'}
  const k=Object.keys(v); const r=await q(`insert into public.${t} (${k.map(s=>'"'+s+'"').join(',')}) values (${k.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(v)); return r[0]}
const erreur=async(fn)=>{ try { await fn(); return null } catch(e){ return e.message } }
const comme=async(uid,fn)=>{
  await q(`select set_config('test.uid',$1,false)`,[uid||''])
  await db.exec(`set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role`); await q(`select set_config('test.uid','',false)`) }
}
const essai=(uid,fn)=>comme(uid,fn).then(r=>({r,e:null}),x=>({r:null,e:x.message}))

const T='9183429e-c75c-4ed2-a869-f8bfa011bbc2', T2='17144700-2b95-43fa-9849-9e7a8f35104e'
const A='00ad0558-c26d-44fb-aaaf-cdd6172aaf4a'
const U=(n)=>`cccccccc-0000-0000-0000-${String(n).padStart(12,'0')}`
const B=U(2), MANAGER=U(3), CEO=U(4), AGENT=U(5), LIVREUR=U(6), SUPER=U(7), AUTRE=U(8)
await db.exec(`set session_replication_role = replica`)
await ins('tenants',{id:T}); await ins('tenants',{id:T2})
for (const u of [A,B,MANAGER,CEO,AGENT,LIVREUR,SUPER,AUTRE]) await q(`insert into auth.users values ($1,$2)`,[u,u.slice(-2)+'@x'])
for (const [u,t,r] of [[A,T,'seller'],[B,T,'seller'],[MANAGER,T,'manager'],[CEO,T,'ceo'],[AGENT,T,'agent'],[LIVREUR,T,'livreur'],[SUPER,T2,'super_admin'],[AUTRE,T2,'manager']])
  await ins('user_roles',{user_id:u,tenant_id:t,role:r})
const AO=(await ins('pays',{tenant_id:T,nom:'Angola',code:'AO'})).id
await ins('entrepots',{tenant_id:T,nom:'Angola',pays_id:AO,actif:true})
await db.exec(`set session_replication_role = origin`)
for (const f of ['produits_suppression.sql','produits_historique_nom.sql','produits_proprietaire.sql','produits_rattacher_ecriture.sql'])
  await db.exec(fs.readFileSync(R+'sql/'+f,'utf8'))
await db.exec(`grant all on all tables in schema public to authenticated, anon, service_role`)

const pA=(await ins('produits',{tenant_id:T,product:'Colon Tea',code:'colontea',vendeur_id:A})).id
const pB=(await ins('produits',{tenant_id:T,product:'Shilajit',code:'shilajit',vendeur_id:B})).id
const pX=(await ins('produits',{tenant_id:T2,product:'Ailleurs',code:'ailleurs'})).id

// ---- 1. le fichier, deux fois
const FICHIER=fs.readFileSync(R+'sql/produits_image.sql','utf8')
for (const run of [1,2]) { const e=await erreur(()=>db.exec(FICHIER)); check(`fichier, passage ${run}`, e===null, String(e)) }
const bk=(await q(`select * from storage.buckets where id='produits'`))[0]
check('bucket « produits » : public, 2 Mo, jpg/png/webp',
  bk && bk.public===true && Number(bk.file_size_limit)===2097152 && JSON.stringify(bk.allowed_mime_types)==='["image/jpeg","image/png","image/webp"]', JSON.stringify(bk))
check('quatre policies produits_images_*', (await q(`select count(*)::int n from pg_policies where schemaname='storage' and policyname like 'produits_images_%'`))[0].n===4)

const uuid=()=>crypto.randomUUID()
const chemin=(t,p,ext='webp')=>`${t}/${p}/${uuid()}.${ext}`

// ---- 2. la contrainte sur produits.image_chemin
const c1=chemin(T,pA)
let e=await erreur(()=>q(`update public.produits set image_chemin=$1 where id=$2`,[c1,pA]))
check('chemin de CE produit : accepté', e===null, String(e))
e=await erreur(()=>q(`update public.produits set image_chemin=$1 where id=$2`,[chemin(T,pB),pA]))
check('chemin d\'un AUTRE produit : refusé', /produits_image_chemin_valide/.test(e||''), String(e))
e=await erreur(()=>q(`update public.produits set image_chemin=$1 where id=$2`,[chemin(T2,pA),pA]))
check('chemin d\'une AUTRE entreprise : refusé', /produits_image_chemin_valide/.test(e||''), String(e))
e=await erreur(()=>q(`update public.produits set image_chemin=$1 where id=$2`,[`${T}/${pA}/photo.webp`,pA]))
check('nom de fichier qui n\'est pas un uuid : refusé', /produits_image_chemin_valide/.test(e||''), String(e))
e=await erreur(()=>q(`update public.produits set image_chemin=$1 where id=$2`,[chemin(T,pA,'gif'),pA]))
check('extension .gif : refusée', /produits_image_chemin_valide/.test(e||''), String(e))
e=await erreur(()=>q(`update public.produits set image_chemin=null where id=$1`,[pA]))
check('NULL (pas d\'image) : accepté', e===null, String(e))

// ---- 3. qui peut déposer un fichier
// Sans RETURNING : un RETURNING passerait aussi par la policy SELECT, qui
// refuserait de son côté et masquerait une policy INSERT trop large.
const deposer=(uid,nom,bucket='produits')=>essai(uid,()=>q(`insert into storage.objects (bucket_id, name, metadata) values ($1,$2,'{"size":1000}')`,[bucket,nom]))
let r=await deposer(A,chemin(T,pA))
check('vendeur A, son produit : dépôt accepté', r.e===null, String(r.e))
r=await deposer(A,chemin(T,pB))
check('vendeur A, produit de B : refusé', /row-level security/.test(r.e||''), String(r.e))
r=await deposer(A,chemin(T,uuid()))
check('vendeur A, produit qui n\'existe pas (pas encore créé) : refusé', /row-level security/.test(r.e||''), String(r.e))
r=await deposer(A,`${T}/${pA}/photo.webp`)
check('nom libre au lieu d\'un uuid : refusé', /row-level security/.test(r.e||''), String(r.e))
r=await deposer(A,'nimporte/quoi')
check('chemin sans forme : refusé, sans erreur de cast', /row-level security/.test(r.e||''), String(r.e))
r=await deposer(MANAGER,chemin(T,pB))
check('manager, n\'importe quel produit de l\'entreprise : accepté', r.e===null, String(r.e))
for (const [nom,uid] of [['ceo',CEO],['agent',AGENT],['livreur',LIVREUR]]) {
  r=await deposer(uid,chemin(T,pA))
  check(`${nom} : refusé (lecture seule)`, /row-level security/.test(r.e||''), String(r.e))
}
r=await deposer(AUTRE,chemin(T,pA))
check('manager d\'une AUTRE entreprise : refusé', /row-level security/.test(r.e||''), String(r.e))
r=await deposer(SUPER,chemin(T,pA))
check('super_admin : accepté', r.e===null, String(r.e))
r=await deposer(MANAGER,chemin(T,pA),'autre-bucket')
check('un autre bucket n\'est pas ouvert par ces policies', /row-level security/.test(r.e||''), String(r.e))

// ---- 4. lire / retirer
const nomA=chemin(T,pA)
await q(`insert into storage.objects (bucket_id, name, metadata) values ('produits',$1,'{"size":2000}')`,[nomA])
await q(`update public.produits set image_chemin=$1 where id=$2`,[nomA,pA])
r=await essai(B,()=>q(`delete from storage.objects where name=$1 returning id`,[nomA]))
check('vendeur B retire l\'image de A : 0 ligne', r.e===null && r.r.length===0, JSON.stringify(r))
r=await essai(B,()=>q(`select name from storage.objects where bucket_id='produits'`))
check('vendeur B ne liste aucun fichier de A par l\'API', r.e===null && !r.r.some(x=>x.name.includes(pA)), JSON.stringify(r))
r=await essai(AGENT,()=>q(`select name from storage.objects where bucket_id='produits'`))
check('agent : aucun fichier par l\'API (il lit les images par l\'URL publique)', r.e===null && r.r.length===0, JSON.stringify(r))

// ---- 5. les orphelins
const orphelins=async()=>q(`select chemin, raison from public.v_images_produits_orphelines order by chemin`)
let o=await orphelins()
check('l\'image courante de A n\'est pas orpheline', !o.some(x=>x.chemin===nomA))
check('les fichiers déposés sans être écrits sur le produit sont « remplacée »',
  o.length>0 && o.every(x=>x.raison.startsWith('remplacée')), JSON.stringify(o))
// Remplacement : nouvelle image écrite, l'ancienne retirée par A.
const nomA2=chemin(T,pA)
await comme(A,()=>q(`insert into storage.objects (bucket_id, name) values ('produits',$1)`,[nomA2]))
await comme(A,()=>q(`update public.produits set image_chemin=$1 where id=$2`,[nomA2,pA]))
r=await essai(A,()=>q(`delete from storage.objects where name=$1 returning id`,[nomA]))
check('remplacement : A retire son ancienne image', r.e===null && r.r.length===1, JSON.stringify(r))
// Produit supprimé AVANT son fichier : plus personne ne peut le retirer par l'API.
const nomB=chemin(T,pB)
await comme(B,()=>q(`insert into storage.objects (bucket_id, name) values ('produits',$1)`,[nomB]))
await comme(B,()=>q(`update public.produits set image_chemin=$1 where id=$2`,[nomB,pB]))
await q(`delete from public.produits where id=$1`,[pB])
r=await essai(MANAGER,()=>q(`delete from storage.objects where name=$1 returning id`,[nomB]))
check('produit supprimé d\'abord : son fichier n\'est plus retirable (d\'où l\'ordre de l\'écran)', r.e===null && r.r.length===0, JSON.stringify(r))
o=await orphelins()
check('… et il apparaît dans la vue : « produit supprimé »', o.some(x=>x.chemin===nomB && x.raison==='produit supprimé'), JSON.stringify(o))
const v=(await q(`select octets from public.v_images_produits_orphelines where chemin=$1`,[nomB]))[0]
check('la vue donne la taille (métadonnée size), NULL si absente', v && v.octets===null)
r=await essai(MANAGER,()=>q(`select * from public.v_images_produits_orphelines`))
check('la vue est fermée aux comptes de l\'app', /permission denied/.test(r.e||''), String(r.e))

const priv=async(role,f)=>(await q(`select has_function_privilege($1,$2,'execute') x`,[role,f]))[0].x
check('peut_modifier_image_produit : fermée à anon', !(await priv('anon','public.peut_modifier_image_produit(text)')))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
