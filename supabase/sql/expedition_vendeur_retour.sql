-- =============================================================================
-- RETOUR ARRIÈRE de expedition_vendeur.sql — 11/11/2026
-- Retire les 2 contrôles (vendeur d'une expédition, produits de ce vendeur).
-- NE MODIFIE AUCUNE DONNÉE. Rejouable.
-- =============================================================================
begin;

drop trigger if exists trg_zy_expedition_vendeur on public.expeditions;
drop trigger if exists trg_zz_expedition_ligne_vendeur on public.expeditions_produits;
drop function if exists public.expedition_vendeur_garde();
drop function if exists public.expedition_ligne_vendeur_garde();

do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_zy_expedition_vendeur', 'trg_zz_expedition_ligne_vendeur')) then
    raise exception 'expedition_vendeur_retour.sql : un contrôle est encore là. Rien n''est retiré.';
  end if;
  raise notice 'expedition_vendeur_retour.sql : contrôles retirés.';
end $$;

commit;
