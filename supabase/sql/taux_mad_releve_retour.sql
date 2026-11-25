-- =============================================================================
-- RETOUR ARRIÈRE de taux_mad_releve.sql — 11/11/2026
-- Retire la porte fixer_taux_mad. GARDE la colonne taux_mad et ses valeurs (un
-- relevé payé ne change pas) ; l'écran d'avant ne la lit pas. Rejouable.
-- =============================================================================
begin;
drop function if exists public.fixer_taux_mad(uuid, numeric);
do $$ begin
  raise notice 'taux_mad_releve_retour.sql : fixer_taux_mad retirée (colonne taux_mad gardée).';
end $$;
commit;
