-- =============================================================================
-- RETOUR ARRIÈRE de correspondances_sku_3_packs.sql — 09/11/2026
-- Retire les 6 correspondances de packs ajoutées le 09/11. Refuse tant qu'une
-- commande est reliée PAR l'une d'elles (multiplicateur > 1 sur ces SKU) :
-- lancez d'abord correspondances_sku_2_retour.sql. Rejouable.
-- =============================================================================
begin;

do $$
declare n integer;
begin
  select count(*) into n from public.commandes c
   where c.source_id = '59768ff7-30a8-4c05-9ab2-c4d9c70e1978'
     and c.multiplicateur_sku is not null
     and lower(btrim(c.articles -> 0 ->> 'code')) in ('clearzal-ao-2', 'clearzal-ao-3', 'sp4-ao-3', 'livertea-ao-3', 'bonegel-ao-2', 'warming-ao-3');
  if n > 0 then
    raise exception 'correspondances_sku_3_packs_retour.sql : % commande(s) reliée(s) par ces packs — lancez d''abord correspondances_sku_2_retour.sql. Rien n''est retiré.', n;
  end if;
  delete from public.correspondances_sku
   where source_id = '59768ff7-30a8-4c05-9ab2-c4d9c70e1978'
     and lower(btrim(sku)) in ('clearzal-ao-2', 'clearzal-ao-3', 'sp4-ao-3', 'livertea-ao-3', 'bonegel-ao-2', 'warming-ao-3');
  get diagnostics n = row_count;
  raise notice 'correspondances_sku_3_packs_retour.sql : % correspondance(s) retirée(s).', n;
end $$;

commit;
