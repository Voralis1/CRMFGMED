-- =============================================================================
-- RETOUR ARRIÈRE de vendeur_commande.sql — 04/11/2026
-- =============================================================================
-- Retire la règle « le vendeur d'une commande est un vrai vendeur ». Ne touche
-- aucune commande. Rouvre le trou : un manager peut de nouveau devenir le
-- « vendeur » d'une commande (si un écran l'envoie). Rejouable.
-- =============================================================================
drop trigger if exists trg_zx_vendeur_commande on public.commandes;
drop function if exists public.commande_vendeur_valide();

select count(*) as trigger_restant from pg_trigger where tgname = 'trg_zx_vendeur_commande';
