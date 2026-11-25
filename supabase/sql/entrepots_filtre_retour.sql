-- =============================================================================
-- RETOUR ARRIÈRE de entrepots_filtre.sql — 11/11/2026
-- Retire les 3 fonctions du filtre par entrepôt (la version à 3 arguments de
-- stats_dashboard ne bouge pas). NE MODIFIE AUCUNE DONNÉE. Rejouable.
-- =============================================================================
begin;
drop function if exists public.entrepots_du_compte(uuid);
drop function if exists public.produits_de_l_entrepot(uuid, uuid);
drop function if exists public.stats_dashboard(uuid, timestamp with time zone, timestamp with time zone, uuid);
do $$ begin
  if (select count(*) from pg_proc where proname = 'stats_dashboard') <> 1 then
    raise exception 'entrepots_filtre_retour.sql : le tableau de bord d''origine manque. Rien n''est retiré.';
  end if;
  raise notice 'entrepots_filtre_retour.sql : filtre par entrepôt retiré.';
end $$;
commit;
