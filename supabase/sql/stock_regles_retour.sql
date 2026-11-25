-- =============================================================================
-- RETOUR ARRIÈRE de stock_regles.sql — 05/11/2026
-- =============================================================================
-- Retire les règles (rupture / produit non reconnu à l'arrivée et à la
-- confirmation, libération automatique) et les 2 statuts.
-- REFUSE tant qu'une commande est en « Rupture de stock » ou « Produit non
-- reconnu » : un statut est un TEXTE sur la commande (leçon 13) — l'effacer
-- laisserait ces commandes dans un état que plus rien ne comprend. Renvoyez-les
-- d'abord en attente (Commandes → « Renvoyer en attente »), puis relancez.
-- Ne touche aucune commande. Rejouable.
-- Pour remettre aussi le stock à « livrée » : stock_livraison_autre_vendeur_retour_04_11.sql ENSUITE.
-- =============================================================================
begin;

do $$
declare n integer; v_liste text;
begin
  select count(*), string_agg(lead_id || ' (' || statut_confirmation || ')', ', ')
    into n, v_liste
    from public.commandes where statut_confirmation in ('Rupture de stock', 'Produit non reconnu');
  if n > 0 then
    raise exception 'stock_regles_retour.sql : % commande(s) sont encore en pause : %. Renvoyez-les en attente d''abord. Rien n''est retiré.', n, left(v_liste, 1500);
  end if;
end $$;

drop trigger if exists trg_zzz_statut_stock on public.commandes;
drop trigger if exists trg_zzz_commande_liberer_stock on public.commandes;
drop trigger if exists trg_zzz_livraison_liberer_stock on public.livraisons;
drop trigger if exists trg_zz_mouvement_liberer_ruptures on public.mouvements_stock;
drop trigger if exists trg_tenants_semer_statuts_stock on public.tenants;
drop function if exists public.commande_statut_stock();
drop function if exists public.commande_liberer_stock();
drop function if exists public.livraison_liberer_stock();
drop function if exists public.mouvement_liberer_ruptures();
drop function if exists public.tenants_semer_statuts_stock();
drop function if exists public.liberer_ruptures(uuid, uuid, uuid);
drop function if exists public.stock_disponible(uuid, uuid, uuid, uuid);
drop function if exists public.semer_statuts_stock(uuid);
delete from public.statuts where code in ('rupture', 'produit_inconnu') and pays_id is null;

commit;

select count(*) as statuts_restants from public.statuts where code in ('rupture', 'produit_inconnu');
