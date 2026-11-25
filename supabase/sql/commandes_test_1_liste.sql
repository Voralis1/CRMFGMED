-- =====================================================================
-- Commandes de la société de test 17144700 — FICHIER 1 SUR 2 : LA LISTE
-- 22/10/2026 — LECTURE SEULE. Ce fichier ne modifie rien.
-- =====================================================================
--
-- 17144700 est la société de test : tout son catalogue tient en un
-- produit, « test », et ses commandes viennent des essais API / Postman.
-- On supprime TOUTES ses commandes. 9183429e (commandes réelles) n'est
-- pas touchée : chaque requête filtre sur l'id complet ci-dessous.
--
-- Lu en production le 22/10 (avant suppression) :
--   78 commandes — 57 « Produit de test », 6 clearzal, 6 test,
--   2 colontea, 2 Colontea, puis 1 chacune : x, produit de test,
--   « Produit de test ×2 + Autre produit ×1 », « <nom exact du
--   catalogue> », « < exact du catalogue> ».
--   Supprimées avec elles (ON DELETE CASCADE) : 73 appels, 5 livraisons,
--   4 paiements, 0 ligne de relevé.
--   Gardées : 72 lignes de imports_bruts (leur commande_id passe à null,
--   le journal des arrivées reste) ; 3 mouvements de stock (le stock du
--   produit « test » n'est pas recalculé).
--
-- Lisez les deux résultats, puis lancez le fichier 2.
-- =====================================================================

-- 1. Par produit
select produit, count(*) as commandes
  from public.commandes
 where tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e'
 group by produit
 order by count(*) desc, produit;

-- 2. Ce qui part avec elles, et ce qui reste
select
  (select count(*) from public.commandes c
    where c.tenant_id = t.id)                                        as commandes,
  (select count(*) from public.appels a join public.commandes c on c.id = a.commande_id
    where c.tenant_id = t.id)                                        as appels_supprimes,
  (select count(*) from public.livraisons l join public.commandes c on c.id = l.commande_id
    where c.tenant_id = t.id)                                        as livraisons_supprimees,
  (select count(*) from public.paiements p join public.commandes c on c.id = p.commande_id
    where c.tenant_id = t.id)                                        as paiements_supprimes,
  (select count(*) from public.reglements_commandes r join public.commandes c on c.id = r.commande_id
    where c.tenant_id = t.id)                                        as lignes_releve_supprimees,
  (select count(*) from public.imports_bruts i join public.commandes c on c.id = i.commande_id
    where c.tenant_id = t.id)                                        as imports_bruts_gardes,
  (select count(*) from public.produits p where p.tenant_id = t.id)  as produits_au_catalogue
  from (select '17144700-2b95-43fa-9849-9e7a8f35104e'::uuid as id) t;
