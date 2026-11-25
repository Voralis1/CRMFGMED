-- =============================================================================
-- RETOUR ARRIÈRE de expedition_suppression_recue.sql — 10/11/2026
-- Une expédition reçue redevient supprimable (son stock reste alors en place :
-- le trou d'avant). NE MODIFIE AUCUNE DONNÉE. Rejouable.
-- =============================================================================
begin;

drop trigger if exists trg_aa_expedition_suppression_recue on public.expeditions;
drop trigger if exists trg_aa_expedition_ligne_suppression_recue on public.expeditions_produits;
drop function if exists public.expedition_suppression_garde();
drop function if exists public.expedition_ligne_suppression_garde();

do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_aa_expedition_suppression_recue', 'trg_aa_expedition_ligne_suppression_recue')) then
    raise exception 'expedition_suppression_recue_retour.sql : une garde est encore là. Rien n''est retiré.';
  end if;
  raise notice 'expedition_suppression_recue_retour.sql : une expédition reçue redevient supprimable.';
end $$;

commit;
