-- =============================================================================
-- RETOUR ARRIÈRE de sku_ecran.sql — 11/11/2026
-- Retire les 3 portes. Les correspondances déjà ajoutées RESTENT (des données :
-- elles relient des commandes). Rejouable.
-- =============================================================================
begin;
drop function if exists public.ajouter_correspondance_sku(uuid, text, uuid, integer);
drop function if exists public.retirer_correspondance_sku(uuid);
drop function if exists public.skus_inconnus(uuid);
do $$ begin
  raise notice 'sku_ecran_retour.sql : portes retirées (les SKU déjà ajoutés restent).';
end $$;
commit;
