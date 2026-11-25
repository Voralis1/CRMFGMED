// Deux fichiers du 30/10 sur le schéma réel + l'état de production
// (receptionner_expedition et le trigger de stock lus en production) :
//   expeditions_pays_destination.sql — le pays de destination dérivé de
//     l'entrepôt, jamais effacé ; rattrapage de l'expédition sans pays ;
//   expeditions_quantite_recue.sql (+ fichier 2) — la quantité d'une ligne
//     REÇUE réécrit le mouvement d'origine ; entrepôt, produit, total et
//     quantite_recue recalculés ; refus si le stock deviendrait négatif, avec
//     ce qui est déjà sorti ; aucun mouvement ajouté ; rattrapage des lignes
//     changées avant le fichier (EXP-000031) ; retours arrière.
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
const T='11111111-1111-1111-1111-111111111111', VEND='aaaaaaaa-0000-0000-0000-000000000001', MAN='aaaaaaaa-0000-0000-0000-000000000002'
await db.exec(`set session_replication_role = replica`)
await q(`insert into auth.users values ($1,'v@x'),($2,'m@x')`,[VEND,MAN])
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

// =====================================================================
// A. Le pays de destination
// =====================================================================
// l'existant : EXP-000031 (pays effacé par un responsable), une autre sans pays mais reçue
const x31=await expedition({entrepot_destination_id:EAO, pays_destination_id:null})
const xRec=await expedition({pays_destination_id:null}); await db.exec(`set session_replication_role = replica`); await q(`update public.expeditions set entrepot_reception_id=$2 where id=$1`,[xRec,ECG]); await db.exec(`set session_replication_role = origin`)
const xOk=await expedition({pays_destination_id:AO})
let e
for (const run of [1,2]) { e=await erreur(()=>db.exec(FD)); check(`pays : fichier, passage ${run}`, e===null, String(e)) }
const pays=async x=>(await q(`select pays_destination_id p from public.expeditions where id=$1`,[x]))[0].p
check('rattrapage : l\'expédition au pays effacé reprend le pays de son entrepôt (EXP-000031)', await pays(x31)===AO)
check('rattrapage : sans entrepôt de destination, le pays de l\'entrepôt de RÉCEPTION', await pays(xRec)===CG)
check('rattrapage : une expédition qui avait son pays n\'est pas touchée', await pays(xOk)===AO)
const xs=await sous(VEND,'authenticated',async()=>(await q(`insert into public.expeditions (tenant_id,pays,pays_destination_id,statut,vendeur_id) values ($1,'Chine',$2,'en_attente',$3) returning id`,[T,AO,VEND]))[0].id)
check('vendeur : son pays reste tel quel', await pays(xs)===AO)
await sous(MAN,'authenticated',()=>q(`update public.expeditions set entrepot_destination_id=$2, pays_destination_id=null where id=$1`,[xs,ECG]))
check('enregistrement d\'un responsable (entrepôt + pays NULL, l\'ancienne page) → le pays DE l\'entrepôt choisi', await pays(xs)===CG)
await sous(MAN,'authenticated',()=>q(`update public.expeditions set entrepot_destination_id=null, pays_destination_id=null where id=$1`,[xs]))
check('pays NULL sans entrepôt → le pays n\'est pas effacé', await pays(xs)===CG)
for (const run of [1,2]) { e=await erreur(()=>db.exec(FDR)); check(`pays : retour arrière, passage ${run}`, e===null, String(e)) }
check('pays : retour → trigger retiré, le pays rattrapé reste', (await q(`select count(*)::int n from pg_trigger where tgname='trg_zz_expedition_pays_destination'`))[0].n===0 && await pays(x31)===AO)
await db.exec(FD)

// =====================================================================
// B. La quantité d'une expédition reçue — prérequis, fautes
// =====================================================================
// l'existant (EXP-000031) : 150 reçus, puis la ligne passée à 140 AVANT le fichier
const p31=await produit(); const x0=await expedition({entrepot_destination_id:EAO}); const l31=await ligne(x0,p31,150)
await recevoir(x0)
await q(`update public.expeditions_produits set quantite=140 where id=$1`,[l31])
let s0=await etat(p31,l31)
check('(l\'existant : ligne 140, entrepôt 150, mouvement 150 — le trou)', s0.ligne===140 && s0.entrepot===150 && s0.entrees[0]===150, JSON.stringify(s0))
// Le trigger de stock rendu actif aussi à la MODIFICATION : le fichier refuse (sinon double compte).
await db.exec(`drop trigger trg_actualiser_stock on public.mouvements_stock; create trigger trg_actualiser_stock after insert or update on public.mouvements_stock for each row execute function public.actualiser_stock_apres_mouvement();`)
e=await erreur(()=>db.exec(FQ)); await db.exec('rollback').catch(()=>{})
check('trigger de stock qui tournerait aussi à la modification → le fichier refuse', /MODIFICATION d'un mouvement/.test(e||''), String(e))
await db.exec(`drop trigger trg_actualiser_stock on public.mouvements_stock; create trigger trg_actualiser_stock after insert on public.mouvements_stock for each row execute function public.actualiser_stock_apres_mouvement();`)
const FAUTIF=FQ.replace("  update public.stocks set quantite_disponible = quantite_disponible + v_delta where id = v_s.id;\n","")
check('(témoin : faute injectée — l\'entrepôt n\'est plus ajusté)', FAUTIF!==FQ)
e=await erreur(()=>db.exec('begin;\n'+FAUTIF+'\ncommit;')); await db.exec('rollback').catch(()=>{})
check('… la répétition arrête le fichier, rien installé', /RÉPÉTITION ÉCHOUÉE/.test(e||'') && (await q(`select count(*)::int n from pg_trigger where tgname='trg_zz_expedition_quantite_recue'`))[0].n===0, String(e))
const photo=async()=>JSON.stringify([await q(`select * from public.expeditions_produits order by id`), await q(`select * from public.stocks order by id`), await q(`select id,quantite from public.mouvements_stock order by id`)])
const avant=await photo()
for (const run of [1,2]) { e=await erreur(()=>db.exec(FQ)); check(`quantité : fichier, passage ${run}`, e===null, String(e)) }
check('le fichier 1 ne modifie aucune ligne existante (EXP-000031 attend le fichier 2)', await photo()===avant)

// =====================================================================
// C. La règle
// =====================================================================
const p=await produit(); const x=await expedition({entrepot_destination_id:EAO}); const l=await ligne(x,p,50)
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=55 where id=$1`,[l]))
let s=await etat(p,l)
check('avant réception : la quantité change, rien côté stock (comme avant)', s.ligne===55 && s.entrepot==null && s.entrees.length===0 && s.recue==null, JSON.stringify(s))
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=50 where id=$1`,[l]))
await recevoir(x)
await sortie(p,45)
s=await etat(p,l)
check('(50 reçus, 45 sortis : entrepôt 5)', s.entrepot===5 && s.produit===5 && s.total===50, JSON.stringify(s))
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=40 where id=$1`,[l])))
check('50 → 40 avec 45 sortis → refusé, le message dit 45 sortis, il en reste 5, et −5', /Refusé : 45 « Produit 2 » sont déjà sortis de l'entrepôt Angola depuis cette réception \(il en reste 5\)\. Passer de 50 à 40 mettrait le stock à -5\./.test(e||''), String(e))
const sRefus=await etat(p,l)
check('… rien n\'a bougé (ligne, mouvement, entrepôt, produit, total)', JSON.stringify(sRefus)===JSON.stringify(s), JSON.stringify(sRefus))
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=45 where id=$1`,[l]))
s=await etat(p,l)
check('50 → 45 (stock exactement à 0) → accepté : entrepôt 0, produit 0, total 45, mouvement 45, reçu 45', s.entrepot===0 && s.produit===0 && s.total===45 && s.entrees.join()==='45' && s.recue===45, JSON.stringify(s))
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=60 where id=$1`,[l]))
s=await etat(p,l)
check('45 → 60 : entrepôt 15, produit 15, total 60, mouvement 60, reçu 60', s.entrepot===15 && s.produit===15 && s.total===60 && s.entrees.join()==='60' && s.recue===60, JSON.stringify(s))
check('… l\'entrepôt = entrées − sorties (aucune double écriture)', s.entrepot===s.somme, JSON.stringify(s))
check('… aucun mouvement ajouté (réécrit, pas « +50 puis −10 »)', (await q(`select count(*)::int n from public.mouvements_stock where produit_id=$1`,[p]))[0].n===2)
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=quantite where id=$1`,[l]))
check('même quantité ré-enregistrée → rien ne bouge', JSON.stringify(await etat(p,l))===JSON.stringify(s))
// deux lignes : chacune son produit
const pA=await produit(), pB=await produit(); const x2=await expedition({entrepot_destination_id:EAO}); const lA=await ligne(x2,pA,10), lB=await ligne(x2,pB,20)
await recevoir(x2)
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=12 where id=$1`,[lA]))
check('deux lignes : seule la ligne changée bouge', (await etat(pA,lA)).entrepot===12 && (await etat(pB,lB)).entrepot===20)
// un vendeur ne modifie pas une expédition approuvée (règle d'avant)
const nV=(await sous(VEND,'authenticated',()=>q(`update public.expeditions_produits set quantite=1 where id=$1 returning id`,[lB]))).length
check('vendeur : ne modifie pas une ligne approuvée (règle d\'avant, 0 ligne)', nV===0 && (await etat(pB,lB)).entrepot===20)
// mouvement introuvable (note changée à la main) → refusé
await q(`update public.mouvements_stock set notes='changée' where produit_id=$1 and type_mouvement='entree'`,[pB])
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=25 where id=$1`,[lB])))
check('mouvement d\'origine introuvable → refusé, rien ne change', /introuvable \(0 trouvé/.test(e||'') && (await etat(pB,lB)).ligne===20, String(e))
// produit supprimé après réception : la quantité change, pas de stock à recalculer, pas d'erreur
const pD=await produit(); const x3=await expedition({entrepot_destination_id:EAO}); const lD=await ligne(x3,pD,7); await recevoir(x3)
await q(`delete from public.produits where id=$1`,[pD])
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=8 where id=$1`,[lD])))
check('ligne d\'un produit supprimé : la quantité change sans erreur (plus de stock à recalculer)', e===null && (await q(`select quantite from public.expeditions_produits where id=$1`,[lD]))[0].quantite===8, String(e))
e=await erreur(()=>sous(MAN,'authenticated',()=>q(`select public.corriger_quantite_recue($1, 3)`,[l])))
check('corriger_quantite_recue pas appelable par l\'app', /permission denied/.test(e||''), String(e))

// =====================================================================
// D. Le rattrapage (fichier 2) : EXP-000031
// =====================================================================
// une deuxième ligne d'avant qui, alignée, passerait en négatif → refusée, nommée
const pN=await produit(); const xN=await expedition({entrepot_destination_id:EAO}); const lN=await ligne(xN,pN,30); await recevoir(xN); await sortie(pN,25)
await db.exec(`alter table public.expeditions_produits disable trigger trg_zz_expedition_quantite_recue`)
await q(`update public.expeditions_produits set quantite=3 where id=$1`,[lN])
await db.exec(`alter table public.expeditions_produits enable trigger trg_zz_expedition_quantite_recue`)
const notices=[]; db.onNotice?.((n)=>notices.push(n.message))
e=await erreur(()=>db.exec(FQ2)); check('rattrapage, passage 1', e===null, String(e))
s0=await etat(p31,l31)
check('EXP-000031 : 150 → 140 partout (mouvement, entrepôt, produit, total, reçu)', s0.entrees.join()==='140' && s0.entrepot===140 && s0.produit===140 && s0.total===140 && s0.recue===140, JSON.stringify(s0))
const sN=await etat(pN,lN)
check('la ligne qui irait en négatif est refusée et laissée telle quelle', sN.entrees.join()==='30' && sN.entrepot===5, JSON.stringify(sN))
const avant2=await photo()
e=await erreur(()=>db.exec(FQ2)); check('rattrapage, passage 2 : rien de plus (sauf la ligne toujours refusée)', e===null && await photo()===avant2, String(e))

// =====================================================================
// E. Retour arrière
// =====================================================================
for (const run of [1,2]) { e=await erreur(()=>db.exec(FQR)); check(`quantité : retour arrière, passage ${run}`, e===null, String(e)) }
await sous(MAN,'authenticated',()=>q(`update public.expeditions_produits set quantite=61 where id=$1`,[l]))
const sR=await etat(p,l)
check('retour : la quantité change de nouveau sans toucher au stock (état d\'avant), les corrections faites restent', sR.ligne===61 && sR.entrepot===15 && (await etat(p31,l31)).entrepot===140, JSON.stringify(sR))
e=await erreur(()=>db.exec(FQ)); check('réinstallation', e===null, String(e))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko?1:0)
