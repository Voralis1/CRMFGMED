-- =============================================================================
-- RETOUR ARRIÈRE de vendeur_sans_equipe.sql — 02/11/2026
-- =============================================================================
-- Remet les deux vues EXACTEMENT comme lues en production le 02/11 (sans la
-- condition « pas un vendeur ») et efface leur marque. Aucune donnée touchée.
-- ⚠ Le vendeur relit alors livreur_id / agent_id par ces vues. Rejouable.
-- =============================================================================

create or replace view public.v_caisses_livreur with (security_invoker = on) as
 SELECT p.tenant_id,
    l.id AS livreur_id,
    COALESCE(l.nom, 'Inconnu'::text) AS livreur_nom,
    COALESCE(pa.devise, 'N/A'::text) AS devise,
    sum(p.montant) AS total,
    count(*)::integer AS nb_paiements
   FROM paiements p
     LEFT JOIN livreurs l ON l.id = p.livreur_id
     LEFT JOIN commandes c ON c.id = p.commande_id
     LEFT JOIN pays pa ON pa.id = c.pays_id
  WHERE p.statut = 'encaisse'::text
  GROUP BY p.tenant_id, l.id, (COALESCE(l.nom, 'Inconnu'::text)), (COALESCE(pa.devise, 'N/A'::text));
comment on view public.v_caisses_livreur is null;

create or replace view public.v_commandes_a_assigner with (security_invoker = on) as
 SELECT id,
    lead_id,
    source,
    client_nom,
    client_telephone,
    produit,
    pays_id,
    zone_id,
    statut_confirmation,
    statut_livraison,
    statut_paiement,
    is_doublon,
    created_at,
    updated_at,
    date_commande,
    ville_zone,
    source_url,
    commentaire_1,
    whatsapp_tracking,
    source_sheet,
    whatsapp_followup,
    notes,
    commentaire_2,
    quantite,
    date_rappel,
    prix,
    tenant_id,
    agent_id
   FROM commandes c
  WHERE (EXISTS ( SELECT 1
           FROM statuts s
          WHERE s.tenant_id = c.tenant_id AND (s.nom = c.statut_confirmation OR s.code = c.statut_confirmation) AND (s.pays_id IS NULL OR s.pays_id = c.pays_id) AND s.declenche_assignation = true)) AND NOT (EXISTS ( SELECT 1
           FROM livraisons v
          WHERE v.commande_id = c.id));
comment on view public.v_commandes_a_assigner is null;
