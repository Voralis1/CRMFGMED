-- =============================================================================
-- RETOUR ARRIÈRE de garde_definitions.sql — 02/11/2026
-- =============================================================================
-- Efface les marques « fichier: … » des sept fonctions et de la vue
-- v_historique_statuts. Aucun corps de fonction, aucune vue n'est touché.
-- Après ce retour, les fichiers anciens réécrivent de
-- nouveau ces fonctions s'ils sont relancés (comme avant le 02/11).
-- N'efface qu'un commentaire qui commence par « fichier: » (rien d'autre).
-- Rejouable.
-- =============================================================================

begin;

do $$
declare
  f   text;
  v_n integer := 0;
begin
  foreach f in array array[
    'public.produits_en_stock(uuid, uuid[])',
    'public.fn_ajuster_stock_livraison()',
    'public.statut_pending_commande()',
    'public.stats_dashboard(uuid, timestamptz, timestamptz)',
    'public.auto_affecter_livreur()',
    'public.choisir_livreur(uuid, uuid, text, uuid)',
    'public.ecrire_historique_statut()'
  ] loop
    if to_regprocedure(f) is not null
       and obj_description(to_regprocedure(f), 'pg_proc') like 'fichier: %' then
      execute format('comment on function %s is null', f);
      v_n := v_n + 1;
    end if;
  end loop;
  if obj_description(to_regclass('public.v_historique_statuts'), 'pg_class') like 'fichier: %' then
    comment on view public.v_historique_statuts is null;
    v_n := v_n + 1;
  end if;
  raise notice 'Retour fait : % marque(s) effacée(s). Aucune fonction modifiée.', v_n;
end $$;

commit;
