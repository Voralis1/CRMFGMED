-- =============================================================================
-- RETOUR ARRIÈRE de stock_portes.sql — 11/11/2026
-- Rouvre les portes : Sortie non contrôlée, mouvements modifiables, stock tapé
-- à la main, entrepôt supprimable avec son historique (la situation d'avant).
-- NE MODIFIE AUCUNE DONNÉE. Rejouable.
-- =============================================================================
begin;

drop trigger if exists trg_aa_mouvement_stock_garde on public.mouvements_stock;
drop trigger if exists trg_aa_stock_ligne_garde on public.stocks;
drop trigger if exists trg_aa_entrepot_suppression_garde on public.entrepots;
drop function if exists public.mouvement_stock_garde();
drop function if exists public.stock_ligne_garde();
drop function if exists public.entrepot_suppression_garde();
drop function if exists public.verifier_sortie_stock(uuid, uuid, uuid, numeric);
drop function if exists public.ecriture_directe_navigateur();

do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_aa_mouvement_stock_garde', 'trg_aa_stock_ligne_garde', 'trg_aa_entrepot_suppression_garde')) then
    raise exception 'stock_portes_retour.sql : une garde est encore là. Rien n''est retiré.';
  end if;
  raise notice 'stock_portes_retour.sql : les portes du stock sont rouvertes (comme avant le 11/11).';
end $$;

commit;
