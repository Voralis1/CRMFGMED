-- =====================================================================
-- ROUVRIR LES CINQ FONCTIONS DE SIGNATURE — écrit le 23/10/2026
-- NE PAS LANCER tant que la signature n'est pas remise dans le produit.
-- =====================================================================
--
-- L'inverse exact de signature_fonctions_fermer.sql : remet les droits tels
-- qu'ils étaient en production le 23/10, avant la fermeture (lus dans
-- pg_proc.proacl) :
--   · reveler_secret_source, regenerer_secret_source, definir_secret_source,
--     regler_signature_source → authenticated + service_role
--     (chacune vérifie elle-même que l'appelant gère la source) ;
--   · noter_echec_signature → service_role seulement (import-commande).
-- anon : jamais.
--
-- Rallumer la signature demande AUSSI de remettre le code. La vérification
-- HMAC d'import-commande est dans git à 8b4f5fe (retirée par 5b71ffd).
-- L'écran de signature et l'appel à noter_echec_signature n'ont JAMAIS été
-- commités (ajoutés et retirés le 20/10 entre deux commits) : à réécrire,
-- test_secret_signature_source.mjs décrit ce qu'ils faisaient.
-- Ce fichier ne rouvre que les portes de la base. Rejouable.
-- =====================================================================

grant execute on function public.reveler_secret_source(uuid, text)   to authenticated, service_role;
grant execute on function public.regenerer_secret_source(uuid)       to authenticated, service_role;
grant execute on function public.definir_secret_source(uuid, text)   to authenticated, service_role;
grant execute on function public.regler_signature_source(uuid, text) to authenticated, service_role;
grant execute on function public.noter_echec_signature(uuid)         to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.reveler_secret_source(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.regenerer_secret_source(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.definir_secret_source(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.regler_signature_source(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.noter_echec_signature(uuid)', 'EXECUTE') then
    raise exception 'anon peut exécuter une fonction de signature : il ne doit jamais le pouvoir.';
  end if;
  if has_function_privilege('authenticated', 'public.noter_echec_signature(uuid)', 'EXECUTE') then
    raise exception 'authenticated peut appeler noter_echec_signature : réservé au service role.';
  end if;
  if not has_function_privilege('authenticated', 'public.reveler_secret_source(uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.noter_echec_signature(uuid)', 'EXECUTE') then
    raise exception 'Réouverture incomplète.';
  end if;
  raise notice 'Fonctions de signature rouvertes (authenticated + service_role ; noter_echec_signature : service_role).';
end $$;
