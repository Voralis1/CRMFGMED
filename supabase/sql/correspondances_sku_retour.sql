-- =============================================================================
-- RETOUR ARRIÈRE de correspondances_sku.sql — 03/11/2026
-- =============================================================================
-- Retire le trigger trg_zz_produit_sku, les fonctions, la table
-- correspondances_sku et la colonne commandes.multiplicateur_sku.
-- REFUSE tant qu'une commande porte encore un multiplicateur_sku : lancez
-- d'abord correspondances_sku_2_retour.sql (sinon on perdrait la trace de
-- quelles quantités ont été multipliées). Rejouable.
-- =============================================================================
begin;

do $$
declare n integer;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'commandes' and column_name = 'multiplicateur_sku') then
    execute 'select count(*) from public.commandes where multiplicateur_sku is not null' into n;
    if n > 0 then
      raise exception 'correspondances_sku_retour.sql : % commande(s) portent encore un multiplicateur_sku. Lancez correspondances_sku_2_retour.sql d''abord. Rien n''est retiré.', n;
    end if;
  end if;
end $$;

drop trigger if exists trg_zz_produit_sku on public.commandes;
drop function if exists public.commande_produit_sku();
drop function if exists public.correspondance_de_commande(uuid, jsonb);
drop table if exists public.correspondances_sku;
drop function if exists public.correspondances_sku_garde();
alter table public.commandes drop column if exists multiplicateur_sku;

commit;

select (select count(*) from pg_trigger where tgname = 'trg_zz_produit_sku')            as trigger_restant,
       to_regclass('public.correspondances_sku')                                         as table_restante,
       (select count(*) from information_schema.columns where table_name = 'commandes'
          and column_name = 'multiplicateur_sku')                                        as colonne_restante;
