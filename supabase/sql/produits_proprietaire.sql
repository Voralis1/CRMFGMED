-- =====================================================================
-- UN PRODUIT APPARTIENT À UN VENDEUR — 26/10/2026
-- Un seul fichier. Rejouable. Modifie 12 produits existants (le §5 : leur
-- propriétaire), rien d'autre.
-- =====================================================================
--
-- Le bug : un vendeur voyait, modifiait et supprimait les produits d'un
-- autre vendeur de la même entreprise. Les policies de `produits` ne
-- regardaient que l'entreprise et le rôle ; rien ne reliait un produit à
-- son propriétaire. `produits.seller` est un texte tapé à la main (« Tarik
-- Ouadi » pour un compte nommé « Tarik ouadi ») : il ne prouve rien.
--
-- La règle : produits.vendeur_id, même forme que sources_import.vendeur_id
-- et commandes.vendeur_id (auth.users, ON DELETE SET NULL).
--
-- CE QUI SE RESSERRE : ce que voit et touche un VENDEUR, et rien d'autre.
--   · vendeur      : lit, crée, modifie, supprime SES produits seulement.
--                    Un produit qu'il crée est à lui : la base l'écrit, il
--                    ne choisit pas.
--   · admin, manager : tous les produits de l'entreprise, lecture et
--                    écriture — inchangé.
--   · ceo, agent, livreur : tous les produits de l'entreprise, en lecture —
--                    inchangé (un agent travaille les commandes de plusieurs
--                    vendeurs : il doit tous les voir).
--   · super_admin  : tout — inchangé.
-- Les expressions des policies sont celles d'avant, à une condition près
-- pour le vendeur : « mon_role() <> 'seller' OR vendeur_id = auth.uid() ».
--
-- Un produit SANS propriétaire : c'est le cas HÉRITÉ (les produits d'avant
-- cette colonne, et celui d'un vendeur dont le compte a été supprimé), pas
-- une fonctionnalité. Aucun vendeur ne le voit ; les autres rôles le voient
-- comme aujourd'hui.
--
-- Ce que fait le fichier :
--   §1  vérifie que le compte de Tarik est bien vendeur de 9183429e — sinon
--       s'arrête là, rien n'est installé ;
--   §2  la colonne vendeur_id (+ index), et le commentaire de `seller` ;
--   §3  le trigger de propriétaire (création, changement, contrôle) ;
--   §4  les quatre policies de `produits`, toutes supprimées puis recréées ;
--   §5  le remplissage : les 12 produits de 9183429e → Tarik ;
--   §6  les portes SECURITY DEFINER : rattacher_produit_pays,
--       pays_du_produit, produits_en_stock vérifient le propriétaire pour
--       un vendeur ;
--   §7  une ligne d'expédition d'un vendeur : un de SES produits ;
--   §8  la vérification de ce qui est en place.
--
-- PAS touché, exprès : produit_de_commande reste à l'échelle de
-- l'entreprise. Elle répond à « quel produit est-ce ? », pas à « avez-vous
-- le droit de l'utiliser ? », et le trigger d'entrepôt en a besoin pour
-- toutes les commandes, celles de l'API comprises.
-- =====================================================================


-- §1 — Le compte à qui reviennent les 12 produits ------------------------
-- Relu au moment du passage. Une erreur ici annule tout le fichier.
do $$
begin
  if not exists (
    select 1
      from public.user_roles ur
      left join public.roles r on r.id = ur.role_id
     where ur.user_id   = '00ad0558-c26d-44fb-aaaf-cdd6172aaf4a'
       and ur.tenant_id = '9183429e-c75c-4ed2-a869-f8bfa011bbc2'
       and lower(coalesce(r.nom, ur.role)) = 'seller'
  ) then
    raise exception 'Arrêt : le compte 00ad0558… (Tarik) n''est pas vendeur de l''entreprise 9183429e. Rien n''a été installé.';
  end if;
end $$;


-- §2 — La colonne -------------------------------------------------------
alter table public.produits
  add column if not exists vendeur_id uuid references auth.users(id) on delete set null;

create index if not exists idx_produits_tenant_vendeur
  on public.produits (tenant_id, vendeur_id);

comment on column public.produits.vendeur_id is
  'Le vendeur propriétaire du produit. Écrit par la base quand un vendeur crée ; choisi par un responsable. NULL = cas hérité (produit d''avant cette colonne, ou vendeur supprimé) : invisible aux vendeurs.';

-- `seller` est gardé, pas supprimé : c'est une donnée qu'on voudra peut-être
-- relire une fois. Plus aucun écran ne l'écrit ni ne s'en sert.
comment on column public.produits.seller is
  'ANCIEN texte libre, ignoré depuis le 26/10/2026. Le propriétaire est vendeur_id.';


-- §3 — Le propriétaire, écrit et contrôlé par la base -------------------
-- Vrai si ce compte est vendeur DANS cette entreprise. Même lecture du rôle
-- que mon_role() : roles.nom d'abord, sinon user_roles.role.
create or replace function public.est_vendeur_du_tenant(p_user uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      left join public.roles r on r.id = ur.role_id
     where ur.user_id   = p_user
       and ur.tenant_id = p_tenant
       and lower(coalesce(r.nom, ur.role)) = 'seller'
  )
$$;

-- Appelée seulement par les triggers : fermée aux rôles de l'API (sinon une
-- question « tel compte est-il vendeur chez tel client ? » posée à la base).
revoke all on function public.est_vendeur_du_tenant(uuid, uuid) from public, anon, authenticated;

create or replace function public.produits_proprietaire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendeur boolean := auth.uid() is not null
                       and lower(coalesce(public.mon_role(), '')) = 'seller';
begin
  if tg_op = 'INSERT' then
    -- Le vendeur ne choisit pas : ce qu'il crée est à lui, quoi qu'il envoie.
    -- Comme set_tenant_id_auto pour l'entreprise.
    if v_vendeur then
      new.vendeur_id := auth.uid();
    end if;
  else
    if new.vendeur_id is not distinct from old.vendeur_id
       and new.tenant_id is not distinct from old.tenant_id then
      return new;
    end if;
    -- La policy le refuserait aussi (with check vendeur_id = auth.uid()),
    -- mais avec un message qui ne dit pas pourquoi.
    if v_vendeur and new.vendeur_id is distinct from old.vendeur_id then
      raise exception 'Un vendeur ne change pas le propriétaire d''un produit.'
        using errcode = '42501';
    end if;
  end if;

  -- Un propriétaire, quand il y en a un, est un compte vendeur de la MÊME
  -- entreprise. Sur tous les chemins : navigateur, clé service, éditeur SQL.
  -- Le NULL qui arrive par la suppression d'un compte (ON DELETE SET NULL)
  -- passe : NULL n'a rien à vérifier.
  if new.vendeur_id is not null
     and not public.est_vendeur_du_tenant(new.vendeur_id, new.tenant_id) then
    raise exception 'Le propriétaire d''un produit doit être un compte vendeur de la même entreprise.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.produits_proprietaire() from public, anon, authenticated;

-- « zz » : les triggers BEFORE s'exécutent dans l'ordre des noms, et celui-ci
-- doit passer APRÈS trg_set_tenant_id_produits (il a besoin de tenant_id).
drop trigger if exists trg_zz_produits_proprietaire on public.produits;
create trigger trg_zz_produits_proprietaire
  before insert or update of vendeur_id, tenant_id on public.produits
  for each row execute function public.produits_proprietaire();


-- §4 — Les policies de `produits` ----------------------------------------
-- Toutes supprimées d'abord : des policies PERMISSIVE s'additionnent, une
-- ancienne plus large laissée en place annulerait la nouvelle.
do $$ declare p record; begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'produits'
  loop execute format('drop policy %I on public.produits', p.policyname); end loop;
end $$;

alter table public.produits enable row level security;

-- Lecture : avant, toute l'entreprise. Maintenant, toute l'entreprise SAUF
-- pour un vendeur, qui ne lit que les siens. coalesce : un compte sans rôle
-- lisait avant, il lit toujours (on ne retire rien à personne d'autre).
create policy produits_select on public.produits
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(coalesce(public.mon_role(), '')) <> 'seller'
             or vendeur_id = auth.uid()))
  );

-- Écriture : admin et manager comme avant ; le vendeur, sur les siens.
-- ceo, agent, livreur : pas d'écriture, comme avant.
create policy produits_insert on public.produits
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(public.mon_role()) = any (array['admin', 'manager'])
             or (lower(public.mon_role()) = 'seller' and vendeur_id = auth.uid())))
  );

create policy produits_update on public.produits
  for update to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(public.mon_role()) = any (array['admin', 'manager'])
             or (lower(public.mon_role()) = 'seller' and vendeur_id = auth.uid())))
  )
  with check (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(public.mon_role()) = any (array['admin', 'manager'])
             or (lower(public.mon_role()) = 'seller' and vendeur_id = auth.uid())))
  );

create policy produits_delete on public.produits
  for delete to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.get_my_tenant_id()
        and (lower(public.mon_role()) = any (array['admin', 'manager'])
             or (lower(public.mon_role()) = 'seller' and vendeur_id = auth.uid())))
  );


-- §5 — Le remplissage ----------------------------------------------------
-- Les 12 produits de 9183429e, saisis par Tarik (lu le 26/10 : tous « Tarik
-- Ouadi », il est le seul vendeur de l'entreprise). Nommés un par un : un
-- produit SANS propriétaire créé plus tard dans cette entreprise (vendeur
-- supprimé) ne doit pas lui revenir si le fichier est relancé.
-- `vendeur_id is null` : un propriétaire déjà changé par un responsable
-- n'est pas écrasé.
-- L'entreprise de test (17144700) : laissée sans propriétaire, exprès.
update public.produits
   set vendeur_id = '00ad0558-c26d-44fb-aaaf-cdd6172aaf4a'
 where tenant_id  = '9183429e-c75c-4ed2-a869-f8bfa011bbc2'
   and vendeur_id is null
   and id in (
     'f1c6985c-4a5e-4644-ac39-07c0d6d9e7d0',  -- Anti rugas         Retinol
     '4a0f8428-ba81-478d-8f4f-8fe846b6660f',  -- Clearzal           clearzal
     '84183b3e-6a7b-4ad6-abdf-cc7bb6bc7a83',  -- Colon Tea          colontea
     '1c6d6b00-50c3-4dbe-bc71-046a7e1cbb00',  -- Golden oil         goldhuile
     '279226ae-36b6-4a8a-8f7f-42f67991a76b',  -- Joint and Bone     bonegel
     '239aede0-520b-4281-9540-6ab55ebb5774',  -- Kidnea tea         kidneytea
     '7ad2c377-ac7a-4f8e-9a4c-3bd15c59e56d',  -- Liver Detox Tea    livertea
     'f6620c3a-2e72-4274-b539-5e1f3fd15b44',  -- Oleo de gengibre   gingeroil
     '330afd96-8703-41fb-a88e-cdc325454459',  -- Oleo miao          huilejap
     '7f33f154-623b-4c3e-9515-225b34b6a15f',  -- Shilajit           Shilajit
     'c5ad18ac-2048-4ece-ab0f-0ef4bb9f2ec5',  -- Sp-4               Sp4
     '20471796-8ac5-49fc-905e-1b0acfbe656b'   -- Warming spray      warming
   );


-- §6 — Les portes SECURITY DEFINER ----------------------------------------
-- En SECURITY DEFINER il n'y a plus de RLS : chaque porte refait le contrôle
-- à la main. Jusqu'ici, l'entreprise seulement ; maintenant, pour un vendeur,
-- le propriétaire aussi. Les autres rôles : inchangés.

-- rattacher_produit_pays : un vendeur rattachait ou détachait les pays du
-- produit d'un autre vendeur, et effaçait ses lignes de stock vides. Corps
-- identique à la prod du 26/10 (négatif = « plein », 23/10), plus le
-- contrôle de propriétaire.
-- 26/10 : corps recopié de produits_rattacher_ecriture.sql (fermée aussi à
-- qui n'écrit pas les produits : ceo, agent, livreur), pour que relancer ce
-- fichier ne rouvre pas la porte. Une seule version : modifier les deux ensemble.
create or replace function public.rattacher_produit_pays(p_produit uuid, p_pays uuid[])
returns table(ajoutes integer, retires integer, gardes_pleins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid;
  v_vendeur uuid;
  v_role    text := lower(coalesce(public.mon_role(), ''));
  v_pays    uuid[] := coalesce(p_pays, '{}'::uuid[]);
begin
  -- L'entreprise du produit, pas celle que l'appelant prétend.
  select tenant_id, vendeur_id into v_tenant, v_vendeur
    from public.produits where id = p_produit;
  if v_tenant is null then
    raise exception 'Produit introuvable';
  end if;

  if not (public.is_super_admin() or v_tenant = public.get_my_tenant_id()) then
    raise exception 'Ce produit n''appartient pas à votre entreprise';
  end if;

  -- Qui peut écrire les produits, comme la policy produits_update. ceo,
  -- agent, livreur n'écrivent aucun produit : ils ne passent pas ici non
  -- plus (26/10, produits_rattacher_ecriture.sql).
  if not (public.is_super_admin() or v_role in ('admin', 'manager', 'seller')) then
    raise exception 'Votre rôle ne permet pas de modifier les produits' using errcode = '42501';
  end if;

  -- Un vendeur, sur SES produits seulement. Même message qu'un produit qui
  -- n'existe pas chez lui : il n'apprend rien de celui d'un autre.
  if not public.is_super_admin() and v_role = 'seller'
     and v_vendeur is distinct from auth.uid() then
    raise exception 'Ce produit n''est pas dans votre catalogue' using errcode = '42501';
  end if;

  -- Les pays doivent être ceux de l'entreprise, et avoir un entrepôt. Un
  -- identifiant venu d'ailleurs est ignoré, pas refusé : il ne correspond à
  -- aucun entrepôt, donc il ne crée rien.
  with vise as (
    select e.id as entrepot_id
    from public.entrepots e
    where e.tenant_id = v_tenant
      and e.pays_id = any (v_pays)
  ),
  nouveaux as (
    insert into public.stocks (tenant_id, produit_id, entrepot_id,
                               quantite_disponible, quantite_defectueuse)
    select v_tenant, p_produit, v.entrepot_id, 0, 0
    from vise v
    where not exists (
      select 1 from public.stocks s
      where s.produit_id = p_produit and s.entrepot_id = v.entrepot_id
    )
    returning 1
  )
  select count(*)::int into ajoutes from nouveaux;

  -- À retirer : les lignes de ce produit dont l'entrepôt n'est plus dans les
  -- pays choisis. On sépare les vides des pleines. « Pleine » = une quantité
  -- qui n'est pas zéro, NÉGATIVE comprise (23/10).
  with a_retirer as (
    select s.id, (coalesce(s.quantite_disponible, 0) <> 0
                  or coalesce(s.quantite_defectueuse, 0) <> 0
                  or coalesce(s.quantite_reservee, 0) <> 0) as plein
    from public.stocks s
    join public.entrepots e on e.id = s.entrepot_id
    where s.produit_id = p_produit
      and s.tenant_id = v_tenant
      and (e.pays_id is null or not (e.pays_id = any (v_pays)))
  ),
  supprimees as (
    delete from public.stocks
    where id in (select id from a_retirer where not plein)
    returning 1
  )
  select
    (select count(*)::int from supprimees),
    (select count(*)::int from a_retirer where plein)
  into retires, gardes_pleins;

  return next;
end;
$$;

-- pays_du_produit : un vendeur apprenait dans quels pays était rattaché le
-- produit d'un autre. Maintenant : rien, pour un produit qui n'est pas à lui.
create or replace function public.pays_du_produit(p_produit uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct e.pays_id
  from public.stocks s
  join public.entrepots e on e.id = s.entrepot_id
  join public.produits  p on p.id = s.produit_id
  where s.produit_id = p_produit
    and e.pays_id is not null
    -- Le contrôle d'entreprise, à la main : en SECURITY DEFINER il n'y a plus
    -- de RLS pour le faire.
    and (
      public.is_super_admin()
      or s.tenant_id = public.get_my_tenant_id()
    )
    -- Un vendeur : ses produits seulement.
    and (lower(coalesce(public.mon_role(), '')) <> 'seller'
         or p.vendeur_id = auth.uid())
$$;

-- produits_en_stock : un vendeur apprenait si le produit d'un autre était en
-- rupture. Maintenant : un produit qui n'est pas à lui ne revient jamais (il
-- passe pour « en rupture », mais l'import le refuse avant : il n'est pas
-- dans son catalogue).
create or replace function public.produits_en_stock(p_pays uuid, p_produits uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.produit_id
    from public.entrepots e
    join public.stocks    s on s.entrepot_id = e.id and s.tenant_id = e.tenant_id
    join public.produits  p on p.id = s.produit_id
   where e.pays_id = p_pays
     and s.produit_id = any (coalesce(p_produits, '{}'::uuid[]))
     and s.quantite_disponible > 0
     -- Le contrôle d'entreprise, à la main : en SECURITY DEFINER il n'y a
     -- plus de RLS pour le faire.
     and (public.is_super_admin() or e.tenant_id = public.get_my_tenant_id())
     -- Un vendeur : ses produits seulement.
     and (lower(coalesce(public.mon_role(), '')) <> 'seller'
          or p.vendeur_id = auth.uid());
$$;
-- Marque (02/11) : ce fichier définit produits_en_stock. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.produits_en_stock(uuid, uuid[]) is 'fichier: produits_proprietaire.sql';

-- Les droits d'exécution ne changent pas (create or replace les garde) ;
-- réécrits pour qu'un passage sur une base où ils auraient bougé les remette.
revoke all on function public.rattacher_produit_pays(uuid, uuid[]) from public, anon;
revoke all on function public.pays_du_produit(uuid)               from public, anon;
revoke all on function public.produits_en_stock(uuid, uuid[])     from public, anon;
grant execute on function public.rattacher_produit_pays(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.pays_du_produit(uuid)               to authenticated, service_role;
grant execute on function public.produits_en_stock(uuid, uuid[])     to authenticated, service_role;


-- §7 — Une expédition de vendeur ne porte que SES produits -----------------
-- Les policies d'expeditions_produits ne regardent que l'expédition. Un
-- vendeur pouvait y mettre l'identifiant du produit d'un autre : à la
-- réception, la marchandise entrait dans le stock de l'autre. L'écran ne le
-- propose plus (la RLS ne lui rend que ses produits) ; la base le refuse.
-- Un trigger plutôt qu'une 5e policy : les quatre policies en place ne
-- bougent pas. Les responsables : inchangés (ils expédient pour n'importe
-- quel vendeur).
create or replace function public.expeditions_produits_du_vendeur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or new.produit_id is null
     or lower(coalesce(public.mon_role(), '')) <> 'seller' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.produit_id is not distinct from old.produit_id then
    return new;
  end if;
  if not exists (select 1 from public.produits p
                  where p.id = new.produit_id and p.vendeur_id = auth.uid()) then
    raise exception 'Ce produit n''est pas dans votre catalogue.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.expeditions_produits_du_vendeur() from public, anon, authenticated;

drop trigger if exists trg_expeditions_produits_du_vendeur on public.expeditions_produits;
create trigger trg_expeditions_produits_du_vendeur
  before insert or update of produit_id on public.expeditions_produits
  for each row execute function public.expeditions_produits_du_vendeur();


-- §8 — Vérification ----------------------------------------------------------
-- Lève une erreur (et annule tout) si quelque chose manque.
do $$
declare
  v_policies text;
  v_sans     int;
begin
  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'produits';
  if v_policies is distinct from
     'produits_delete:DELETE, produits_insert:INSERT, produits_select:SELECT, produits_update:UPDATE' then
    raise exception 'Policies de produits inattendues : %', v_policies;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_zz_produits_proprietaire'
                  and tgrelid = 'public.produits'::regclass and tgenabled <> 'D') then
    raise exception 'trg_zz_produits_proprietaire absent ou désactivé';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_expeditions_produits_du_vendeur'
                  and tgrelid = 'public.expeditions_produits'::regclass and tgenabled <> 'D') then
    raise exception 'trg_expeditions_produits_du_vendeur absent ou désactivé';
  end if;

  select count(*) into v_sans from public.produits
   where tenant_id = '9183429e-c75c-4ed2-a869-f8bfa011bbc2' and vendeur_id is null;
  raise notice 'Produits de 9183429e sans propriétaire : % (attendu : 0)', v_sans;
  raise notice 'Produits par propriétaire : %', (
    select string_agg(coalesce(left(vendeur_id::text, 8), 'aucun') || ' × ' || n, ', ')
      from (select vendeur_id, count(*) n from public.produits group by vendeur_id) x);
end $$;
