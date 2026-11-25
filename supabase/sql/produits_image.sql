-- =====================================================================
-- UNE IMAGE PAR PRODUIT — 26/10/2026
-- Un seul fichier. Ne modifie aucune donnée existante. Rejouable.
-- Premier usage de Supabase Storage dans ce projet.
-- =====================================================================
--
-- Ce que fait le fichier :
--   §1  produits.image_chemin (le CHEMIN dans le bucket, pas une URL : il
--       survit à un changement d'URL du projet) + une contrainte sur sa forme ;
--   §2  le bucket `produits` : PUBLIC en lecture, 2 Mo max, jpg/png/webp ;
--   §3  qui peut écrire un fichier : qui peut modifier ce produit ;
--   §4  les quatre policies de storage.objects pour ce bucket ;
--   §5  la vue des fichiers orphelins (éditeur SQL seulement) ;
--   §6  la vérification.
--
-- LECTURE PUBLIQUE — UN CHOIX, PAS UN OUBLI. N'importe qui ayant l'URL d'une
-- image la voit, sans compte. Une photo de produit n'est pas sensible, et le
-- nom du fichier est un uuid tiré au hasard : on ne le devine pas, on ne
-- liste pas le bucket (la lecture publique sert un fichier dont on connaît
-- le nom, elle ne donne pas la liste). C'est ce qui permet d'afficher la
-- vignette partout (liste, commandes, livreur) sans URL signée à renouveler.
--
-- Le chemin : <entreprise>/<produit>/<uuid>.webp. L'identifiant du produit
-- dans le chemin est ce qui permet à la policy de demander « cette personne
-- peut-elle modifier CE produit ? » — la même règle que la policy
-- produits_update (produits_proprietaire.sql) : super_admin ; admin et
-- manager sur tout produit de l'entreprise ; vendeur sur les siens. ceo,
-- agent, livreur : lecture seulement (publique, comme tout le monde).
-- Conséquence : on ne peut déposer l'image qu'une fois le produit créé.
-- L'écran enregistre le produit, PUIS envoie l'image, en un seul clic.
--
-- 2 Mo est un PLAFOND que le bucket impose à tout le monde (même un appel
-- qui contourne l'écran). Ce qui est réellement envoyé, c'est une image
-- réduite par le navigateur : ~800 px de large, en WebP.
--
-- CE QUE LA BASE NE PEUT PAS FAIRE : supprimer un fichier. Storage n'est pas
-- Postgres — aucune clé étrangère ne l'atteint, et Supabase refuse un DELETE
-- sur storage.objects (« Use the Storage API instead »). C'est donc l'écran
-- qui retire le fichier : en remplaçant une image, en la retirant, en
-- supprimant le produit (Produits ET Paramètres). Un produit supprimé par un
-- autre chemin (éditeur SQL) laisse son fichier : il apparaît dans la vue
-- v_images_produits_orphelines (§5), à vider depuis le tableau de bord
-- Storage. Voir CLAUDE.md §10.
-- =====================================================================


-- §1 — La colonne -----------------------------------------------------------
alter table public.produits add column if not exists image_chemin text;

comment on column public.produits.image_chemin is
  'Chemin de l''image dans le bucket Storage « produits » : <tenant_id>/<produit_id>/<uuid>.<webp|jpg|jpeg|png>. NULL = pas d''image. L''URL publique se calcule à partir du chemin.';

-- La forme du chemin, sur tous les chemins d'écriture : ce dossier-ci (cette
-- entreprise, CE produit), un uuid, une extension d'image. Un produit ne peut
-- pas pointer vers l'image d'un autre produit ni d'une autre entreprise.
alter table public.produits drop constraint if exists produits_image_chemin_valide;
alter table public.produits add constraint produits_image_chemin_valide check (
  image_chemin is null
  or image_chemin ~ ('^' || tenant_id::text || '/' || id::text
                     || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$')
);


-- §2 — Le bucket ------------------------------------------------------------
-- lifecycle_* laissés NULL : Supabase refuse de les écrire hors de son rôle
-- de service (storage.protect_bucket_control_columns).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produits', 'produits', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- §3 — Qui peut écrire un fichier -------------------------------------------
-- La forme d'un nom de fichier acceptable, sans regarder les droits.
create or replace function public.chemin_image_produit_valide(p_nom text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_nom ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                         || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                         || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$'),
                  false)
$$;

-- Vrai si l'appelant peut modifier le produit que nomme ce chemin. SECURITY
-- DEFINER : un vendeur ne lit pas les produits des autres, et la policy doit
-- pouvoir répondre « non » sans dépendre de ce qu'il voit. La forme est
-- vérifiée AVANT tout cast en uuid (un cast raté lèverait une erreur).
create or replace function public.peut_modifier_image_produit(p_nom text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant  uuid;
  v_produit uuid;
  v_role    text := lower(coalesce(public.mon_role(), ''));
begin
  if auth.uid() is null or not public.chemin_image_produit_valide(p_nom) then
    return false;
  end if;
  v_tenant  := split_part(p_nom, '/', 1)::uuid;
  v_produit := split_part(p_nom, '/', 2)::uuid;
  return exists (
    select 1 from public.produits p
     where p.id = v_produit
       and p.tenant_id = v_tenant
       and (public.is_super_admin()
            or (p.tenant_id = public.get_my_tenant_id()
                and (v_role in ('admin', 'manager')
                     or (v_role = 'seller' and p.vendeur_id = auth.uid()))))
  );
end;
$$;

revoke all on function public.peut_modifier_image_produit(text) from public, anon;
grant execute on function public.peut_modifier_image_produit(text) to authenticated;
grant execute on function public.chemin_image_produit_valide(text) to authenticated;


-- §4 — Les policies de storage.objects, pour ce bucket seulement ------------
-- Pas de « supprimer toutes les policies de la table » ici : storage.objects
-- sert tous les buckets du projet. On supprime les NÔTRES par leur nom, et
-- le §6 signale toute autre policy qui ne se limiterait pas à son bucket.
--
-- SELECT : la lecture publique (URL) ne passe pas par ces policies. Celle-ci
-- sert à l'API Storage, qui doit lire l'objet pour le remplacer ou le
-- supprimer : mêmes personnes que l'écriture.
drop policy if exists produits_images_select on storage.objects;
drop policy if exists produits_images_insert on storage.objects;
drop policy if exists produits_images_update on storage.objects;
drop policy if exists produits_images_delete on storage.objects;

create policy produits_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'produits' and public.peut_modifier_image_produit(name));

create policy produits_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'produits' and public.peut_modifier_image_produit(name));

create policy produits_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'produits' and public.peut_modifier_image_produit(name))
  with check (bucket_id = 'produits' and public.peut_modifier_image_produit(name));

-- Le fichier se retire AVANT le produit (l'écran le fait dans cet ordre) :
-- une fois le produit supprimé, plus personne ne « peut le modifier ».
create policy produits_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'produits' and public.peut_modifier_image_produit(name));


-- §5 — Les fichiers orphelins ----------------------------------------------
-- Un fichier du bucket qu'aucun produit ne désigne : son produit a été
-- supprimé hors des écrans, ou un remplacement n'a pas pu retirer l'ancien.
-- À lire dans l'éditeur SQL :
--     select * from public.v_images_produits_orphelines;
-- puis supprimer ces fichiers dans Storage → produits (tableau de bord).
-- Fermée aux rôles de l'API : c'est un outil de maintenance.
create or replace view public.v_images_produits_orphelines
with (security_invoker = on) as
select o.name                          as chemin,
       o.created_at                    as depose_le,
       (o.metadata ->> 'size')::bigint as octets,
       case
         when p.id is null then 'produit supprimé'
         else 'remplacée (le produit pointe vers une autre image)'
       end                             as raison
  from storage.objects o
  left join public.produits p
    on p.id::text = split_part(o.name, '/', 2)
 where o.bucket_id = 'produits'
   and (p.id is null or p.image_chemin is distinct from o.name);

revoke all on public.v_images_produits_orphelines from public, anon, authenticated;


-- §6 — Vérification ----------------------------------------------------------
do $$
declare
  v_b      record;
  v_autres text;
begin
  select public, file_size_limit, allowed_mime_types into v_b
    from storage.buckets where id = 'produits';
  if not found or not v_b.public or v_b.file_size_limit <> 2097152
     or v_b.allowed_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception 'Bucket « produits » absent ou mal réglé.';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('produits_images_select', 'produits_images_insert',
                            'produits_images_update', 'produits_images_delete')) <> 4 then
    raise exception 'Les quatre policies produits_images_* ne sont pas toutes en place.';
  end if;

  -- Des policies PERMISSIVE s'additionnent : une autre policy de
  -- storage.objects qui ne se limite pas à SON bucket ouvrirait celui-ci.
  select string_agg(policyname, ', ') into v_autres
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname not like 'produits_images_%'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%';
  if v_autres is not null then
    raise warning 'Policies de storage.objects sans filtre de bucket, à vérifier : %', v_autres;
  end if;

  raise notice 'Images produits : bucket, policies et vue en place.';
end $$;
