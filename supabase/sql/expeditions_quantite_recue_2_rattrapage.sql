-- =============================================================================
-- FICHIER 2 — MODIFIE DES DONNÉES EXISTANTES (mouvement, stock, produit)
-- Aligne les lignes d'expéditions REÇUES dont la quantité a été changée
-- avant expeditions_quantite_recue.sql — 30/10/2026
-- =============================================================================
--
-- Pour chaque ligne reçue dont la quantité ne correspond plus à son mouvement
-- d'entrée : la MÊME fonction que le trigger (corriger_quantite_recue) — le
-- mouvement réécrit à la quantité de la ligne, l'entrepôt, le produit et son
-- total ajustés de la différence, quantite_recue posée. Même garde-fou : une
-- ligne qui mettrait un stock en négatif est REFUSÉE et nommée ; les autres
-- passent.
--
-- Lu le 30/10 : UNE ligne — EXP-000031, « test1 » (entreprise de test) :
-- déclaré 140, mouvement 150, entrepôt Angola 150 → 140 partout.
--
-- Refuse de tourner sans le fichier 1. Rejouable : une ligne alignée ne
-- l'est pas deux fois.
-- =============================================================================
do $$
declare
  r     record;
  v_ok  integer := 0;
  v_ko  integer := 0;
begin
  if to_regprocedure('public.corriger_quantite_recue(uuid, integer)') is null then
    raise exception 'Lancez d''abord expeditions_quantite_recue.sql. Rien n''a été modifié.';
  end if;
  for r in
    select ep.id, e.reference, coalesce(ep.produit_nom, '?') as produit, ep.quantite, m.quantite as mouvement
      from public.expeditions e
      join public.expeditions_produits ep on ep.expedition_id = e.id
      join public.mouvements_stock m on m.type_mouvement = 'entree' and m.produit_id = ep.produit_id
           and m.entrepot_id = e.entrepot_reception_id
           and m.notes = 'Expédition ' || coalesce(e.reference, '?') || ' confirmée'
     where e.entrepot_reception_id is not null and ep.quantite <> m.quantite
  loop
    begin
      perform public.corriger_quantite_recue(r.id, r.quantite);
      update public.expeditions_produits set quantite_recue = quantite where id = r.id;
      v_ok := v_ok + 1;
      raise notice '% « % » : % → % (mouvement, entrepôt, produit).', r.reference, r.produit, r.mouvement, r.quantite;
    exception when others then
      v_ko := v_ko + 1;
      raise notice '% « % » : REFUSÉ — %', r.reference, r.produit, sqlerrm;
    end;
  end loop;
  raise notice 'Rattrapage : % ligne(s) alignée(s), % refusée(s).', v_ok, v_ko;
end $$;
