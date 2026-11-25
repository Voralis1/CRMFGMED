-- =============================================================================
-- RETOUR ARRIÈRE des correspondances SKU SUR LES COMMANDES — 03/11/2026
-- *** MODIFIE DES COMMANDES *** — défait ce que les correspondances ont écrit :
-- celles du rattrapage (fichier 2) ET celles liées par le trigger depuis.
-- =============================================================================
-- Pour chaque commande avec multiplicateur_sku :
--   · quantité ÷ multiplicateur (si elle tombe juste ; sinon la commande est
--     NOMMÉE et laissée telle quelle : quelqu'un a changé la quantité depuis) ;
--   · produit_id = la règle du texte (produit_de_commande), comme avant ;
--   · multiplicateur_sku = NULL.
-- Une commande déjà décomptée du stock (stock_ajuste) n'est PAS touchée et est
-- nommée : défaire sa quantité désaccorderait son mouvement de stock.
-- Rejouable. Les correspondances elles-mêmes restent (correspondances_sku_retour.sql
-- les retire, après celui-ci).
-- =============================================================================
begin;

drop table if exists pg_temp._retour_sku;
create temp table _retour_sku as
select c.id, c.tracking_number, c.quantite, c.multiplicateur_sku, c.stock_ajuste,
       (c.stock_ajuste is null and coalesce(c.quantite, 0) % c.multiplicateur_sku = 0) as defaire,
       (select x.produit_id from public.produit_de_commande(c.tenant_id, c.produit) x) as produit_texte
  from public.commandes c
 where c.multiplicateur_sku is not null;

select set_config('crm.produit_rattrapage', 'oui', true);
update public.commandes c
   set quantite           = c.quantite / r.multiplicateur_sku,
       produit_id         = r.produit_texte,
       multiplicateur_sku = null
  from pg_temp._retour_sku r
 where c.id = r.id and r.defaire;
select set_config('crm.produit_rattrapage', '', true);

commit;

select tracking_number, multiplicateur_sku, quantite as quantite_avant_retour,
       case when defaire then 'défaite' when stock_ajuste is not null then 'LAISSÉE : déjà décomptée du stock'
            else 'LAISSÉE : quantité changée depuis (ne tombe pas juste)' end as resultat
  from pg_temp._retour_sku order by defaire, tracking_number;
