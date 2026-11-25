-- =====================================================================
-- ATTENTION — CE FICHIER MODIFIE DES COMMANDES EXISTANTES.
-- RATTRAPAGE DE L'ENTREPÔT DES COMMANDES — FICHIER 2 SUR 2 — 22/10/2026
-- À LANCER SEULEMENT APRÈS entrepot_commande.sql, ET QUAND ON LE DÉCIDE.
-- =====================================================================
--
-- Chaque commande PAS ENCORE PARTIE reçoit l'entrepôt de son pays, et la
-- note de stock de la règle du 22/10 (produit inconnu compris). Les
-- commandes déjà parties ne sont pas touchées.
--
-- Prévu (lu en production le 22/10, avant tout changement) :
--   · 82 commandes modifiées, toutes « produit_inconnu » : 57 « Produit de
--     test », 12 kneehuile, 5 clearzal, 2 colontea, 6 isolées — chacune
--     reçoit l'entrepôt de son pays, sans note ;
--   · 25 déjà justes, non modifiées ;
--   · 4 parties, non touchées (3 sans entrepôt : lignes « deja_expediee »).
-- Les chiffres ont pu bouger depuis (nouvelles commandes) : le résultat
-- ci-dessous fait foi.
--
-- Rejouable : au second passage, plus rien ne change ; seules les lignes
-- « deja_expediee » restent dans le résultat.
--
-- Refuse de tourner si le fichier 1 n'est pas passé (la règle du 21/10
-- laisserait sans entrepôt les produits rangés ailleurs).
-- =====================================================================

do $$
begin
  if to_regprocedure('public.entrepot_du_pays(uuid,uuid)') is null then
    raise exception 'Lancez d''abord entrepot_commande.sql (fichier 1) : la règle du 22/10 n''est pas en place.';
  end if;
end $$;

-- Le résultat : une ligne par (cas, produit) pour les commandes MODIFIÉES,
-- plus les parties sans entrepôt. Les « produit_inconnu » sont à
-- rapprocher du catalogue.
select * from public.remplir_entrepots_commandes();
