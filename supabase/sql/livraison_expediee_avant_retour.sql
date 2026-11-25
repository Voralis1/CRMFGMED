-- =============================================================================
-- RETOUR ARRIÈRE de livraison_expediee_avant.sql — 05/11/2026
-- « Livrée » redevient possible directement depuis « À préparer » (le stock
-- sort alors à « livrée », sans contrôle — la règle d'avant).
-- NE MODIFIE AUCUNE DONNÉE. Rejouable.
-- =============================================================================

begin;

drop trigger if exists trg_aa_livraison_expediee_avant on public.livraisons;
drop function if exists public.livraison_expediee_avant();
drop function if exists public.livraison_saut_livre(text, text);

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_aa_livraison_expediee_avant')
     or to_regprocedure('public.livraison_saut_livre(text, text)') is not null then
    raise exception 'livraison_expediee_avant_retour.sql : la règle est encore là. Rien n''est retiré.';
  end if;
  raise notice 'livraison_expediee_avant_retour.sql : « Livrée » directe de nouveau possible.';
end $$;

commit;
