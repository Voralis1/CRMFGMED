-- =====================================================================
-- RATTACHER UN PRODUIT À DES PAYS : SEULEMENT QUI PEUT ÉCRIRE LES PRODUITS
-- 26/10/2026. Un seul fichier. Ne modifie aucune donnée. Rejouable.
-- =====================================================================
--
-- rattacher_produit_pays est SECURITY DEFINER : la RLS ne joue pas, la
-- fonction fait ses contrôles à la main. Elle vérifiait l'entreprise, et
-- depuis produits_proprietaire.sql le propriétaire pour un vendeur. Rien
-- d'autre : un ceo, un agent ou un livreur pouvait rattacher un produit à
-- des pays (lignes de stock créées) et l'en détacher (lignes vides
-- supprimées).
--
-- Ce n'est pas un droit qu'on leur retire : c'est une porte qui n'aurait
-- jamais dû exister. Les policies de `produits` disent que ces trois rôles
-- n'écrivent rien sur un produit, et le ceo lit tout et n'écrit rien (fiche
-- de passation). La fonction contredisait le modèle de rôles au lieu de
-- l'appliquer.
--
-- La règle, maintenant : la même que produits_update.
--   · super_admin                       → oui
--   · admin, manager (de l'entreprise)  → oui, tout produit
--   · vendeur                           → ses produits seulement
--   · tout autre rôle, ou sans rôle     → refusé
--
-- La même version est recopiée dans produits_proprietaire.sql : relancer ce
-- fichier-là ne rouvre pas la porte.
-- =====================================================================


-- §1 — La fonction ----------------------------------------------------------
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

revoke all on function public.rattacher_produit_pays(uuid, uuid[]) from public, anon;
grant execute on function public.rattacher_produit_pays(uuid, uuid[]) to authenticated, service_role;


-- §2 — Vérification ----------------------------------------------------------
do $$
begin
  if position('Votre rôle ne permet pas de modifier les produits' in
              pg_get_functiondef('public.rattacher_produit_pays(uuid, uuid[])'::regprocedure)) = 0 then
    raise exception 'rattacher_produit_pays ne porte pas le contrôle de rôle.';
  end if;
  if has_function_privilege('anon', 'public.rattacher_produit_pays(uuid, uuid[])', 'execute') then
    raise exception 'rattacher_produit_pays est ouverte à anon.';
  end if;
  raise notice 'rattacher_produit_pays : fermée à qui n''écrit pas les produits.';
end $$;
