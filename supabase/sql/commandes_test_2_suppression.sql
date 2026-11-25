-- =====================================================================
-- ATTENTION — CE FICHIER SUPPRIME DES COMMANDES. IRRÉVERSIBLE.
-- COMMANDES DE LA SOCIÉTÉ DE TEST 17144700 — FICHIER 2 SUR 2
-- À LANCER SEULEMENT APRÈS AVOIR LU LE RÉSULTAT DE commandes_test_1_liste.sql.
-- =====================================================================
--
-- Supprime toutes les commandes de 17144700. Leurs appels, livraisons,
-- paiements et lignes de relevé partent avec elles (ON DELETE CASCADE) ;
-- imports_bruts reste (commande_id → null).
--
-- Garde-fou : refuse de tourner si l'entreprise visée n'est pas la société
-- de test (son catalogue doit tenir en au plus un produit, « test »). Une
-- erreur de copier-coller sur l'id ne peut donc pas viser 9183429e (12
-- produits).
--
-- L'id est écrit UNE fois. Rejouable : au second passage, 0 commande.
-- =====================================================================

do $$
declare
  v_tenant    constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_produits  integer;
  v_autres    integer;
  v_supprimes integer;
begin
  select count(*), count(*) filter (where lower(btrim(product)) <> 'test')
    into v_produits, v_autres
    from public.produits where tenant_id = v_tenant;
  if v_produits > 1 or v_autres > 0 then
    raise exception 'Refusé : % n''est pas la société de test (% produits au catalogue).', v_tenant, v_produits;
  end if;

  delete from public.commandes where tenant_id = v_tenant;
  get diagnostics v_supprimes = row_count;
  raise notice '% commandes supprimées pour %.', v_supprimes, v_tenant;
end $$;

-- Vérification : doit répondre 0.
select count(*) as commandes_restantes
  from public.commandes
 where tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e';
