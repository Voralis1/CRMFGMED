-- =============================================================================
-- CORRESPONDANCES SKU — FICHIER 2 SUR 2 : RATTRAPAGE — 03/11/2026
-- *** MODIFIE DES COMMANDES EXISTANTES *** (produit_id, quantite, multiplicateur_sku)
-- =============================================================================
--
-- Les commandes de sources arrivées AVANT correspondances_sku.sql (lu le 03/11 :
-- les 45 de « Ma boutique », 9 packs de 2 unités en quantité 1) :
--   · une seule ligne d'article, son SKU a une correspondance pour sa source ;
--   · pas encore liées (produit_id NULL) ;
--   · jamais multipliées (multiplicateur_sku NULL) ;
--   · rien encore sorti du stock (stock_ajuste NULL) — une commande déjà
--     décomptée n'est pas touchée (son mouvement de stock ne suivrait pas).
-- → produit_id = le produit de la correspondance, quantité × multiplicateur,
--   multiplicateur_sku = le multiplicateur. Le PRIX ne change pas (total du pack).
--   Le TEXTE de la commande ne change pas. updated_at ne change pas.
-- Rejouable : une commande liée ou multipliée n'est plus candidate — jamais
-- multipliée deux fois. Refuse sans le fichier 1.
-- Affiche chaque commande changée (n° de suivi, SKU, produit, quantité avant → après).
--
-- RETOUR ARRIÈRE : correspondances_sku_2_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.correspondances_sku') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_zz_produit_sku') then
    raise exception 'correspondances_sku_2_rattrapage.sql : lancez correspondances_sku.sql d''abord. Rien n''a été modifié.';
  end if;
end $$;

drop table if exists pg_temp._rattrapage_sku;
create temp table _rattrapage_sku as
select c.id, c.tracking_number, c.lead_id, c.articles -> 0 ->> 'code' as sku,
       p.product as produit, m.multiplicateur, c.quantite as quantite_avant,
       coalesce(c.quantite, 1) * m.multiplicateur as quantite_apres, m.produit_id
  from public.commandes c
  cross join lateral public.correspondance_de_commande(c.source_id, c.articles) m
  join public.produits p on p.id = m.produit_id
 where c.produit_id is null
   and c.multiplicateur_sku is null
   and c.stock_ajuste is null;

select set_config('crm.produit_rattrapage', 'oui', true);
update public.commandes c
   set produit_id         = r.produit_id,
       quantite           = r.quantite_apres,
       multiplicateur_sku = r.multiplicateur
  from pg_temp._rattrapage_sku r
 where c.id = r.id;
select set_config('crm.produit_rattrapage', '', true);

do $$
declare n integer; d integer;
begin
  select count(*), count(*) filter (where multiplicateur > 1) into n, d from pg_temp._rattrapage_sku;
  -- la preuve : chacune est liée, multipliée une fois
  if exists (select 1 from pg_temp._rattrapage_sku r join public.commandes c on c.id = r.id
              where c.produit_id is distinct from r.produit_id or c.quantite is distinct from r.quantite_apres
                 or c.multiplicateur_sku is distinct from r.multiplicateur) then
    raise exception 'correspondances_sku_2_rattrapage.sql : une commande n''a pas reçu ce qui était prévu. Rien n''a été modifié.';
  end if;
  raise notice 'correspondances_sku_2_rattrapage.sql : % commande(s) liée(s), dont % quantité(s) corrigée(s) (pack). Rejouer : 0.', n, d;
end $$;

commit;

select tracking_number, lead_id, sku, produit, multiplicateur, quantite_avant, quantite_apres
  from pg_temp._rattrapage_sku order by multiplicateur desc, produit, tracking_number;
