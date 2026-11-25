-- =============================================================================
-- RETOUR ARRIÈRE de produit_meme_vendeur.sql — 13/11/2026
-- Retire les 3 verrous. Les liens calculés par T14 et la garde des SKU restent. Rejouable.
-- =============================================================================
begin;
drop trigger if exists trg_zz_produit_vendeur_garde on public.commandes;
drop trigger if exists trg_zz_produit_vendeur_change on public.produits;
drop trigger if exists tr_sources_vendeur_sku on public.sources_import;
drop function if exists public.commande_produit_meme_vendeur();
drop function if exists public.produit_vendeur_change();
drop function if exists public.source_vendeur_change();
do $$ begin
  raise notice 'produit_meme_vendeur_retour.sql : les 3 verrous retirés.';
end $$;
commit;
