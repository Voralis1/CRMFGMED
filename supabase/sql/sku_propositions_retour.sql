-- =============================================================================
-- RETOUR ARRIÈRE de sku_propositions.sql — 11/11/2026
-- Retire les propositions de SKU (les propositions EN ATTENTE sont perdues ; les
-- SKU déjà approuvés restent dans correspondances_sku). Rejouable.
-- =============================================================================
begin;
drop function if exists public.proposer_sku(uuid, text, uuid, integer);
drop function if exists public.approuver_sku(uuid);
drop function if exists public.refuser_sku(uuid);
drop function if exists public.skus_du_produit(uuid);
drop function if exists public.skus_inconnus_du_vendeur(uuid);
drop table if exists public.propositions_sku;
do $$ begin
  raise notice 'sku_propositions_retour.sql : propositions de SKU retirées (les SKU approuvés restent).';
end $$;
commit;
