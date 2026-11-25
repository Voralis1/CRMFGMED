-- =============================================================================
-- RETOUR ARRIÈRE de expeditions_pays_destination.sql
-- =============================================================================
-- Retire le trigger et sa fonction. Le pays rattrapé (EXP-000031 le 30/10)
-- reste : c'est le pays de l'entrepôt où l'expédition a été reçue, il est
-- juste. Exécutable deux fois, et même si le fichier n'a jamais tourné.
-- =============================================================================
drop trigger if exists trg_zz_expedition_pays_destination on public.expeditions;
drop function if exists public.expedition_pays_destination();
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_zz_expedition_pays_destination') then
    raise exception 'Retour incomplet : le trigger est encore là.';
  end if;
  raise notice 'Retour fait : trigger retiré. Le pays déjà rempli reste.';
end $$;
