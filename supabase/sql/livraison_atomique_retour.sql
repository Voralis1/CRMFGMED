-- =============================================================================
-- RETOUR ARRIÈRE de livraison_atomique.sql — 04/11/2026
-- =============================================================================
-- ⚠ D'ABORD remettre l'ancienne confirmer-livraison (la nouvelle appelle
-- enregistrer_livraison et échouerait sans elle) :
--     git show 5308950:supabase/functions/confirmer-livraison/index.ts > /tmp/confirmer-livraison-ancienne.ts
--     (copier ce contenu dans supabase/functions/confirmer-livraison/index.ts)
--     npx supabase functions deploy confirmer-livraison
-- PUIS lancer ce fichier : il retire la fonction. Ne touche aucune donnée.
-- Rouvre le trou : livraison « livrée » sans paiement si le paiement échoue.
-- Rejouable.
-- =============================================================================
drop function if exists public.enregistrer_livraison(uuid, text, text, numeric);

select to_regprocedure('public.enregistrer_livraison(uuid, text, text, numeric)') as fonction_restante;
