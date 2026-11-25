-- =============================================================================
-- RETOUR ARRIÈRE de choisir_fermes.sql — 02/11/2026
-- =============================================================================
-- Remet les droits lus en production le 02/11 :
--   choisir_agent / choisir_livreur → postgres, service_role, authenticated.
-- ⚠ Rouvre le trou (tout compte connecté, toute entreprise). Rejouable.
-- =============================================================================
grant execute on function public.choisir_agent(uuid, uuid)               to authenticated, service_role;
grant execute on function public.choisir_livreur(uuid, uuid, text, uuid) to authenticated, service_role;

select p.oid::regprocedure as fonction, p.proacl as droits
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('choisir_agent', 'choisir_livreur');
