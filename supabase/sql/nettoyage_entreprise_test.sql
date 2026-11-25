-- =============================================================================
-- NETTOYAGE DE L'ENTREPRISE DE TEST — 04/11/2026
-- *** SUPPRIME DES DONNÉES. AUCUN RETOUR ARRIÈRE POSSIBLE. ***
-- Entreprise de test SEULEMENT : 17144700-… « FGMED (Données Existantes) ».
-- =============================================================================
--
-- CE QUE ÇA FAIT (sa demande, 03–04/11 : repartir propre pour tester le stock).
-- Appelle la fonction de nettoyage QUI EXISTE DÉJÀ en prod,
-- vider_donnees_operationnelles(entreprise) — un programme enregistré dans la
-- base — et l'entoure de sécurités :
--   §1 REFUSE toute autre entreprise : l'id ET le nom doivent être ceux de
--      l'entreprise de test (sinon : rien n'est supprimé). La fonction, elle,
--      accepte n'importe quelle entreprise — avec l'id de Fgmed Angola elle
--      effacerait les vraies commandes de la boutique de Tarik.
--   §2 affiche ce qui va être supprimé (lu le 04/11 : 108 commandes, 118 appels,
--      94 imports bruts, 20 livraisons, 16 paiements, 5 relevés + 8 lignes,
--      6 expéditions + 6 lignes, 19 mouvements de stock) ;
--   §3 appelle la fonction : elle supprime ces données (dans le bon ordre) et
--      remet À ZÉRO chaque ligne de stock et le total de chaque produit
--      (lu le 04/11 : test 18 865, product a 108, Potencia masculina 12,
--      test1 1, product c −1 → tout à 0) ;
--   §4 VÉRIFIE : plus aucune commande / livraison / paiement / relevé /
--      expédition / mouvement dans l'entreprise de test, chaque ligne de stock
--      à 0, les produits et l'entrepôt toujours là, Fgmed Angola intacte.
--      Une seule anomalie → TOUT est annulé.
--
-- CE QUI RESTE : produits, entrepôt, pays, zones, statuts, sources, comptes,
-- agents, livreurs. L'HISTORIQUE des statuts et des affectations reste aussi,
-- exprès (la base refuse de l'effacer) : ses lignes ne pointent plus vers
-- aucune commande (lu le 04/11 : 47 + 12).
--
-- Rejouable : relancé, il ne trouve plus rien à supprimer et passe.
-- Remplace commandes_test_2_suppression.sql (jamais lancé, ne supprimait que
-- les commandes).
-- =============================================================================

begin;

do $$
declare
  c_tenant constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  c_nom    constant text := 'FGMED (Données Existantes)';
  v_nom    text;
  r        record;
  n        bigint;
  v_fgmed_avant bigint;
  v_produits_avant bigint;
  v_entrepots_avant bigint;
  v_histo_avant bigint;
begin
  -- §1 La bonne entreprise, et seulement elle ------------------------------------
  select nom_entreprise into v_nom from public.tenants where id = c_tenant;
  if v_nom is null then
    raise exception 'nettoyage_entreprise_test.sql : l''entreprise de test (17144700…) n''existe pas. Rien n''est supprimé.';
  end if;
  if v_nom <> c_nom then
    raise exception 'nettoyage_entreprise_test.sql : l''entreprise 17144700… s''appelle « % », pas « % ». Rien n''est supprimé.', v_nom, c_nom;
  end if;

  -- §2 Ce qui va partir -------------------------------------------------------------
  raise notice 'Entreprise nettoyée : « % » (17144700…)', v_nom;
  raise notice 'À supprimer : % commandes, % appels, % imports bruts, % livraisons, % paiements, % relevés (% lignes), % expéditions (% lignes), % mouvements de stock.',
    (select count(*) from public.commandes            where tenant_id = c_tenant),
    (select count(*) from public.appels               where tenant_id = c_tenant),
    (select count(*) from public.imports_bruts        where tenant_id = c_tenant),
    (select count(*) from public.livraisons           where tenant_id = c_tenant),
    (select count(*) from public.paiements            where tenant_id = c_tenant),
    (select count(*) from public.reglements           where tenant_id = c_tenant),
    (select count(*) from public.reglements_commandes where tenant_id = c_tenant),
    (select count(*) from public.expeditions          where tenant_id = c_tenant),
    (select count(*) from public.expeditions_produits where tenant_id = c_tenant),
    (select count(*) from public.mouvements_stock     where tenant_id = c_tenant);
  for r in select p.product, e.nom as entrepot, s.quantite_disponible
             from public.stocks s
             join public.produits p on p.id = s.produit_id
             left join public.entrepots e on e.id = s.entrepot_id
            where s.tenant_id = c_tenant and s.quantite_disponible <> 0
            order by p.product loop
    raise notice 'Stock remis à 0 : % (%) — était %', r.product, coalesce(r.entrepot, '?'), r.quantite_disponible;
  end loop;

  -- de quoi vérifier après
  select count(*) into v_fgmed_avant     from public.commandes where tenant_id <> c_tenant;
  select count(*) into v_produits_avant  from public.produits  where tenant_id = c_tenant;
  select count(*) into v_entrepots_avant from public.entrepots where tenant_id = c_tenant;
  select (select count(*) from public.historique_statuts where tenant_id = c_tenant)
       + (select count(*) from public.historique_affectations where tenant_id = c_tenant)
    into v_histo_avant;

  -- §3 La fonction qui existe déjà -----------------------------------------------------
  for r in select * from public.vider_donnees_operationnelles(c_tenant) loop
    raise notice '  % : %', r.etape, r.lignes;
  end loop;

  -- §4 Vérification --------------------------------------------------------------------
  select (select count(*) from public.commandes            where tenant_id = c_tenant)
       + (select count(*) from public.livraisons           where tenant_id = c_tenant)
       + (select count(*) from public.paiements            where tenant_id = c_tenant)
       + (select count(*) from public.reglements           where tenant_id = c_tenant)
       + (select count(*) from public.reglements_commandes where tenant_id = c_tenant)
       + (select count(*) from public.expeditions          where tenant_id = c_tenant)
       + (select count(*) from public.expeditions_produits where tenant_id = c_tenant)
       + (select count(*) from public.mouvements_stock     where tenant_id = c_tenant)
       + (select count(*) from public.appels               where tenant_id = c_tenant)
    into n;
  if n <> 0 then
    raise exception 'nettoyage_entreprise_test.sql : % ligne(s) restent dans l''entreprise de test. Tout est annulé.', n;
  end if;
  if exists (select 1 from public.stocks where tenant_id = c_tenant
              and (quantite_disponible <> 0 or quantite_reservee <> 0 or quantite_defectueuse <> 0)) then
    raise exception 'nettoyage_entreprise_test.sql : une ligne de stock n''est pas à 0. Tout est annulé.';
  end if;
  if exists (select 1 from public.produits where tenant_id = c_tenant
              and (coalesce(current_quantity, 0) <> 0 or coalesce(defected_quantity, 0) <> 0)) then
    raise exception 'nettoyage_entreprise_test.sql : le total d''un produit n''est pas à 0. Tout est annulé.';
  end if;
  if (select count(*) from public.produits  where tenant_id = c_tenant) <> v_produits_avant
     or (select count(*) from public.entrepots where tenant_id = c_tenant) <> v_entrepots_avant then
    raise exception 'nettoyage_entreprise_test.sql : des produits ou l''entrepôt ont disparu. Tout est annulé.';
  end if;
  if (select count(*) from public.commandes where tenant_id <> c_tenant) <> v_fgmed_avant then
    raise exception 'nettoyage_entreprise_test.sql : une AUTRE entreprise a perdu des commandes. Tout est annulé.';
  end if;
  if (select count(*) from public.historique_statuts where tenant_id = c_tenant)
     + (select count(*) from public.historique_affectations where tenant_id = c_tenant) <> v_histo_avant then
    raise exception 'nettoyage_entreprise_test.sql : l''historique a changé de taille. Tout est annulé.';
  end if;

  raise notice 'nettoyage_entreprise_test.sql : entreprise de test vidée, stock à 0 partout, % produit(s) et l''entrepôt gardés, autres entreprises intactes.', v_produits_avant;
end $$;

commit;

-- Ce qui reste (doit être vide)
select 'stock négatif' as quoi, count(*) from public.stocks where quantite_disponible < 0
union all
select 'commandes (entreprise de test)', count(*) from public.commandes where tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e';
