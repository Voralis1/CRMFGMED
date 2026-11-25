-- =============================================================================
-- LE VENDEUR D'UNE EXPÉDITION — 11/11/2026 (sa demande : comme l'import des
-- leads et les produits, un responsable CHOISIT le vendeur)
-- NE MODIFIE AUCUNE DONNÉE. Ajoute 2 contrôles (triggers).
-- =============================================================================
--
-- LE TROU : un manager / admin qui créait une expédition en devenait le
-- « vendeur » (la page écrivait vendeur_id = lui) ; et ses produits n'étaient
-- vérifiés que quand un VENDEUR créait l'expédition
-- (expeditions_produits_du_vendeur, produits_proprietaire.sql) — un responsable
-- pouvait mêler les produits de deux vendeurs. Lu le 11/11 : 5 expéditions,
-- toutes créées par leur vendeur, 0 ligne avec le produit d'un autre vendeur.
--
-- LA RÈGLE (tout compte de l'application ; éditeur SQL / service role passent) :
--   §1 une expédition a pour vendeur un VENDEUR de son entreprise. Un vendeur
--      reste le sien (expeditions_garde le pose, inchangé). Changer le vendeur :
--      seulement avant la réception (le stock n'est pas encore entré), et
--      seulement si ses produits ne sont pas ceux de l'ancien vendeur.
--   §2 chaque produit d'une expédition est un produit DE SON VENDEUR, ou un
--      produit sans vendeur (commun à tous, sa règle du 10/11).
--
-- RETOUR ARRIÈRE : expedition_vendeur_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.est_vendeur_du_tenant(uuid, uuid)') is null then
    raise exception 'expedition_vendeur.sql : est_vendeur_du_tenant absente (produits_proprietaire.sql). Rien n''est installé.';
  end if;
end $$;

-- §1 Le vendeur de l'expédition ------------------------------------------------------
-- « zy » : après tr_expeditions_garde (qui pose le vendeur d'un vendeur).
create or replace function public.expedition_vendeur_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.vendeur_id is null or not public.est_vendeur_du_tenant(new.vendeur_id, new.tenant_id) then
    raise exception 'Choisissez le vendeur de cette expédition (un vendeur de l''entreprise).' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.vendeur_id is distinct from old.vendeur_id then
    if old.entrepot_reception_id is not null then
      raise exception 'Cette expédition est déjà reçue : son vendeur ne change plus.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.expeditions_produits ep join public.produits p on p.id = ep.produit_id
                where ep.expedition_id = new.id and p.vendeur_id is not null and p.vendeur_id <> new.vendeur_id) then
      raise exception 'Cette expédition contient des produits de l''ancien vendeur : retirez-les avant de changer de vendeur.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.expedition_vendeur_garde() from public, anon, authenticated;
comment on function public.expedition_vendeur_garde() is 'fichier: expedition_vendeur.sql';

drop trigger if exists trg_zy_expedition_vendeur on public.expeditions;
create trigger trg_zy_expedition_vendeur
  before insert or update of vendeur_id, tenant_id on public.expeditions
  for each row execute function public.expedition_vendeur_garde();

-- §2 Les produits de l'expédition ----------------------------------------------------------
create or replace function public.expedition_ligne_vendeur_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_vend uuid; v_pvend uuid; v_nom text;
begin
  if auth.uid() is null or new.produit_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.produit_id is not distinct from old.produit_id then
    return new;
  end if;
  select e.vendeur_id into v_vend from public.expeditions e where e.id = new.expedition_id;
  select p.vendeur_id, coalesce(nullif(btrim(p.code), ''), p.product) into v_pvend, v_nom
    from public.produits p where p.id = new.produit_id;
  if v_pvend is not null and v_pvend is distinct from v_vend then
    raise exception 'Le produit « % » n''est pas un produit du vendeur de cette expédition.', v_nom using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.expedition_ligne_vendeur_garde() from public, anon, authenticated;
comment on function public.expedition_ligne_vendeur_garde() is 'fichier: expedition_vendeur.sql';

drop trigger if exists trg_zz_expedition_ligne_vendeur on public.expeditions_produits;
create trigger trg_zz_expedition_ligne_vendeur
  before insert or update of produit_id on public.expeditions_produits
  for each row execute function public.expedition_ligne_vendeur_garde();

-- Vérification -----------------------------------------------------------------------------
do $$
declare n integer;
begin
  if (select count(*) from pg_trigger where tgname in ('trg_zy_expedition_vendeur', 'trg_zz_expedition_ligne_vendeur') and tgenabled = 'O') <> 2 then
    raise exception 'expedition_vendeur.sql : les 2 contrôles ne sont pas actifs. Rien n''est installé.';
  end if;
  -- l'existant, pour information (rien n'est changé)
  select count(*) into n from public.expeditions_produits ep
    join public.expeditions e on e.id = ep.expedition_id join public.produits p on p.id = ep.produit_id
   where p.vendeur_id is not null and p.vendeur_id <> e.vendeur_id;
  if n > 0 then
    raise notice 'expedition_vendeur.sql : % ligne(s) existante(s) portent le produit d''un autre vendeur (gardées telles quelles).', n;
  end if;
  raise notice 'expedition_vendeur.sql : vendeur obligatoire (un vendeur de l''entreprise), produits de ce vendeur seulement. Aucune donnée modifiée.';
end $$;

commit;
