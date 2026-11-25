-- =============================================================================
-- RETOUR ARRIÈRE de paiement_unique_commande.sql — 03/11/2026
-- =============================================================================
-- Retire l'index unique paiements_commande_unique. Ne touche aucune donnée.
-- ⚠ Rouvre le trou : deux « Livré » simultanés peuvent de nouveau créer deux
-- paiements pour une commande. Rejouable.
-- =============================================================================
drop index if exists public.paiements_commande_unique;

select indexname, indexdef from pg_indexes where tablename = 'paiements' order by indexname;
