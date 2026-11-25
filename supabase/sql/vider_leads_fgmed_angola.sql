-- =============================================================================
-- FGMED ANGOLA : EFFACER LES LEADS — ET SEULEMENT LES LEADS — 10/11/2026
-- *** SUPPRIME DES DONNÉES DE LA VRAIE ENTREPRISE. AUCUN RETOUR ARRIÈRE POSSIBLE. ***
-- Fgmed Angola SEULEMENT : 9183429e-… « Fgmed Angola ».
-- =============================================================================
--
-- SA DEMANDE (10/11) : « supprimer chaque lead de l'entreprise Angola, sans
-- supprimer les expéditions, les produits ni le stock ».
-- LU EN PROD LE 10/11 : 45 commandes (toutes en attente / rupture, AUCUNE
-- sortie de stock), 45 appels, 45 imports bruts, 0 livraison, 0 paiement,
-- 0 relevé ; 2 expéditions, 12 produits, 13 mouvements « entree » (EXP-000038).
--
-- CE QUI PART : les commandes de Fgmed Angola ; avec elles (ON DELETE CASCADE)
-- leurs appels ; et les imports bruts de l'entreprise (la copie reçue de chaque
-- lead de la boutique — comme le nettoyage du 05/11).
-- CE QUI RESTE, VÉRIFIÉ À LA FIN : expéditions et leurs lignes, produits, lignes
-- de stock (mêmes quantités), mouvements de stock, correspondances SKU, sources,
-- tarifs, comptes. L'HISTORIQUE des statuts et des affectations reste (la base
-- refuse de l'effacer) : son lien vers la commande devient vide (ON DELETE SET
-- NULL), comme pour l'entreprise de test.
--
-- VERROU (la vraie entreprise) : REFUSE si Fgmed Angola a la moindre livraison,
-- le moindre paiement ou relevé, ou une commande dont le stock est déjà sorti —
-- du vrai travail, de l'argent. Ce jour-là, ce fichier n'efface plus rien.
-- Une anomalie à la vérification → TOUT est annulé (rien n'est effacé).
--
-- La boutique de Tarik reste ALLUMÉE : ses nouveaux leads arriveront après.
-- Rejouable : relancé, il efface les leads arrivés depuis (ou rien).
-- =============================================================================

begin;

do $$
declare
  c_tenant constant uuid := '9183429e-c75c-4ed2-a869-f8bfa011bbc2';
  c_nom    constant text := 'Fgmed Angola';
  v_nom    text;
  n_cmd bigint; n_app bigint; n_imp bigint; n_verrou bigint;
  v_exp bigint; v_lig bigint; v_prod bigint; v_mvt bigint; v_stock numeric; v_sku bigint; v_histo bigint; v_autres bigint;
begin
  -- §1 La bonne entreprise, et seulement elle
  select nom_entreprise into v_nom from public.tenants where id = c_tenant;
  if v_nom is null then
    raise exception 'vider_leads_fgmed_angola.sql : Fgmed Angola (9183429e…) n''existe pas. Rien n''est supprimé.';
  end if;
  if v_nom <> c_nom then
    raise exception 'vider_leads_fgmed_angola.sql : l''entreprise 9183429e… s''appelle « % », pas « % ». Rien n''est supprimé.', v_nom, c_nom;
  end if;

  -- §2 Le verrou : aucun travail réel, aucun argent
  select (select count(*) from public.livraisons where tenant_id = c_tenant)
       + (select count(*) from public.paiements  where tenant_id = c_tenant)
       + (select count(*) from public.reglements where tenant_id = c_tenant)
       + (select count(*) from public.commandes  where tenant_id = c_tenant and stock_ajuste is not null)
    into n_verrou;
  if n_verrou > 0 then
    raise exception 'vider_leads_fgmed_angola.sql : Fgmed Angola a déjà des livraisons, paiements, relevés ou du stock sorti (%) — du vrai travail. Rien n''est supprimé.', n_verrou;
  end if;

  -- §3 Ce qui doit rester : compté AVANT
  select count(*) into v_exp  from public.expeditions where tenant_id = c_tenant;
  select count(*) into v_lig  from public.expeditions_produits ep join public.expeditions e on e.id = ep.expedition_id where e.tenant_id = c_tenant;
  select count(*) into v_prod from public.produits where tenant_id = c_tenant;
  select count(*) into v_mvt  from public.mouvements_stock where tenant_id = c_tenant;
  select coalesce(sum(quantite_disponible), 0) into v_stock from public.stocks where tenant_id = c_tenant;
  v_sku := 0;
  if to_regclass('public.correspondances_sku') is not null then
    execute 'select count(*) from public.correspondances_sku where tenant_id = $1' into v_sku using c_tenant;
  end if;
  select count(*) into v_histo from public.historique_statuts where tenant_id = c_tenant;
  select count(*) into v_autres from public.commandes where tenant_id <> c_tenant;

  select count(*) into n_cmd from public.commandes where tenant_id = c_tenant;
  select count(*) into n_app from public.appels where tenant_id = c_tenant;
  select count(*) into n_imp from public.imports_bruts where tenant_id = c_tenant;
  raise notice 'vider_leads_fgmed_angola.sql : va effacer % lead(s), % appel(s), % import(s) brut(s). Reste : % expédition(s), % produit(s), stock total %, % mouvement(s).',
    n_cmd, n_app, n_imp, v_exp, v_prod, v_stock, v_mvt;

  -- §4 L'effacement (éditeur SQL : les gardes de l'historique laissent passer le lien vidé)
  delete from public.imports_bruts where tenant_id = c_tenant;
  delete from public.commandes where tenant_id = c_tenant;

  -- §5 Vérification — une anomalie annule TOUT
  if exists (select 1 from public.commandes where tenant_id = c_tenant)
     or exists (select 1 from public.appels where tenant_id = c_tenant) then
    raise exception 'vider_leads_fgmed_angola.sql : des leads ou des appels restent. Tout est annulé.';
  end if;
  if (select count(*) from public.expeditions where tenant_id = c_tenant) <> v_exp
     or (select count(*) from public.expeditions_produits ep join public.expeditions e on e.id = ep.expedition_id where e.tenant_id = c_tenant) <> v_lig
     or (select count(*) from public.produits where tenant_id = c_tenant) <> v_prod
     or (select count(*) from public.mouvements_stock where tenant_id = c_tenant) <> v_mvt
     or (select coalesce(sum(quantite_disponible), 0) from public.stocks where tenant_id = c_tenant) <> v_stock then
    raise exception 'vider_leads_fgmed_angola.sql : une expédition, un produit, le stock ou une correspondance SKU a changé. Tout est annulé.';
  end if;
  if to_regclass('public.correspondances_sku') is not null then
    execute 'select count(*) from public.correspondances_sku where tenant_id = $1' into n_verrou using c_tenant;
    if n_verrou <> v_sku then
      raise exception 'vider_leads_fgmed_angola.sql : une correspondance SKU a changé. Tout est annulé.';
    end if;
  end if;
  if (select count(*) from public.historique_statuts where tenant_id = c_tenant) <> v_histo then
    raise exception 'vider_leads_fgmed_angola.sql : l''historique a changé. Tout est annulé.';
  end if;
  if (select count(*) from public.commandes where tenant_id <> c_tenant) <> v_autres then
    raise exception 'vider_leads_fgmed_angola.sql : des commandes d''une AUTRE entreprise ont bougé. Tout est annulé.';
  end if;
  raise notice 'vider_leads_fgmed_angola.sql : % lead(s) effacé(s). Expéditions, produits, stock (total %), mouvements et SKU intacts ; historique gardé.', n_cmd, v_stock;
end $$;

commit;
