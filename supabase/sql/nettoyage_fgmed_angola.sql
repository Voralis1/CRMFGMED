-- =============================================================================
-- NETTOYAGE DE FGMED ANGOLA — 05/11/2026
-- *** SUPPRIME DES DONNÉES DE LA VRAIE ENTREPRISE. AUCUN RETOUR ARRIÈRE POSSIBLE. ***
-- Fgmed Angola SEULEMENT : 9183429e-… « Fgmed Angola ».
-- =============================================================================
--
-- SA DÉCISION (05/11) : effacer les leads et les appels de Fgmed Angola — les
-- 34 leads de la bêta (import CSV des 14–15/10) et les leads de la boutique de
-- Tarik (source « Ma boutique », depuis le 02/11). Lu le 05/11 : 155 commandes,
-- TOUTES « Pending » (personne ne les a traitées), 121 appels, 121 imports
-- bruts — et AUCUNE livraison, AUCUN paiement, AUCUN relevé, AUCUNE expédition,
-- AUCUN mouvement de stock. Les 12 produits restent, le stock reste à 0.
--
-- Même fonction que pour l'entreprise de test (vider_donnees_operationnelles,
-- qui existe déjà), avec ses sécurités :
--   §1 REFUSE toute autre entreprise (id ET nom « Fgmed Angola ») ;
--   §1 bis VERROU DE LA VRAIE ENTREPRISE : REFUSE si Fgmed Angola a la moindre
--      livraison, paiement, relevé, expédition ou mouvement de stock — du vrai
--      travail, de l'argent. Le jour où l'activité réelle commence, ce fichier
--      ne peut plus rien effacer, même lancé par erreur ;
--   §2 affiche ce qui va partir ; §3 appelle la fonction ; §4 vérifie (plus
--      rien dans Fgmed Angola, produits gardés, stock à 0, l'entreprise de test
--      intacte, historique gardé) — une anomalie → TOUT est annulé.
--
-- La boutique de Tarik reste ALLUMÉE tant qu'il ne la coupe pas (Mon API →
-- « Couper ») : de nouveaux leads arriveront après le nettoyage.
-- L'HISTORIQUE des statuts reste, exprès (la base refuse de l'effacer).
-- Rejouable : relancé, il ne trouve rien à supprimer (ou les nouveaux leads
-- arrivés depuis) et passe.
-- Fait aussi la tâche T16 (les 34 leads bêta).
-- =============================================================================

begin;

do $$
declare
  c_tenant constant uuid := '9183429e-c75c-4ed2-a869-f8bfa011bbc2';
  c_nom    constant text := 'Fgmed Angola';
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
    raise exception 'nettoyage_fgmed_angola.sql : Fgmed Angola (9183429e…) n''existe pas. Rien n''est supprimé.';
  end if;
  if v_nom <> c_nom then
    raise exception 'nettoyage_fgmed_angola.sql : l''entreprise 9183429e… s''appelle « % », pas « % ». Rien n''est supprimé.', v_nom, c_nom;
  end if;

  -- §1 bis Le verrou de la vraie entreprise : aucun travail réel, aucun argent --
  select (select count(*) from public.livraisons       where tenant_id = c_tenant)
       + (select count(*) from public.paiements        where tenant_id = c_tenant)
       + (select count(*) from public.reglements       where tenant_id = c_tenant)
       + (select count(*) from public.expeditions      where tenant_id = c_tenant)
       + (select count(*) from public.mouvements_stock where tenant_id = c_tenant)
    into n;
  if n > 0 then
    raise exception 'nettoyage_fgmed_angola.sql : Fgmed Angola a déjà du VRAI travail (livraisons %, paiements %, relevés %, expéditions %, mouvements de stock %). Rien n''est supprimé : ce fichier ne sert que tant qu''aucune livraison ni aucun argent n''existe.',
      (select count(*) from public.livraisons       where tenant_id = c_tenant),
      (select count(*) from public.paiements        where tenant_id = c_tenant),
      (select count(*) from public.reglements       where tenant_id = c_tenant),
      (select count(*) from public.expeditions      where tenant_id = c_tenant),
      (select count(*) from public.mouvements_stock where tenant_id = c_tenant);
  end if;

  -- §2 Ce qui va partir -------------------------------------------------------------
  raise notice 'Entreprise nettoyée : « % » (9183429e…)', v_nom;
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
    raise exception 'nettoyage_fgmed_angola.sql : % ligne(s) restent dans Fgmed Angola. Tout est annulé.', n;
  end if;
  if exists (select 1 from public.stocks where tenant_id = c_tenant
              and (quantite_disponible <> 0 or quantite_reservee <> 0 or quantite_defectueuse <> 0)) then
    raise exception 'nettoyage_fgmed_angola.sql : une ligne de stock n''est pas à 0. Tout est annulé.';
  end if;
  if exists (select 1 from public.produits where tenant_id = c_tenant
              and (coalesce(current_quantity, 0) <> 0 or coalesce(defected_quantity, 0) <> 0)) then
    raise exception 'nettoyage_fgmed_angola.sql : le total d''un produit n''est pas à 0. Tout est annulé.';
  end if;
  if (select count(*) from public.produits  where tenant_id = c_tenant) <> v_produits_avant
     or (select count(*) from public.entrepots where tenant_id = c_tenant) <> v_entrepots_avant then
    raise exception 'nettoyage_fgmed_angola.sql : des produits ou l''entrepôt ont disparu. Tout est annulé.';
  end if;
  if (select count(*) from public.commandes where tenant_id <> c_tenant) <> v_fgmed_avant then
    raise exception 'nettoyage_fgmed_angola.sql : une AUTRE entreprise a perdu des commandes. Tout est annulé.';
  end if;
  if (select count(*) from public.historique_statuts where tenant_id = c_tenant)
     + (select count(*) from public.historique_affectations where tenant_id = c_tenant) <> v_histo_avant then
    raise exception 'nettoyage_fgmed_angola.sql : l''historique a changé de taille. Tout est annulé.';
  end if;

  raise notice 'nettoyage_fgmed_angola.sql : Fgmed Angola vidée (leads, appels, imports), % produit(s) et l''entrepôt gardés, stock à 0, autres entreprises intactes.', v_produits_avant;
end $$;

commit;

-- Ce qui reste (doit être vide)
select 'stock négatif' as quoi, count(*) from public.stocks where quantite_disponible < 0
union all
select 'commandes (Fgmed Angola)', count(*) from public.commandes where tenant_id = '9183429e-c75c-4ed2-a869-f8bfa011bbc2';
