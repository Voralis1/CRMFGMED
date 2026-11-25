-- =============================================================================
-- RETOUR ARRIÈRE de reglement_sur_encaisse.sql — 03/11/2026
-- =============================================================================
-- Remet v_commandes_a_regler EXACTEMENT comme lue en prod le 03/11 (livrée
-- selon la copie sur la commande, vendeur non vide, dans aucun relevé — sans
-- condition sur l'argent, au prix), avec ses droits du 03/11
-- (authenticated + service_role : tous ; anon : rien). Ne touche aucune donnée.
-- La vue est supprimée puis recréée (une colonne ne s'enlève pas d'une vue
-- par « create or replace »). Rien d'autre ne dépend d'elle (lu le 03/11).
-- ⚠ Remettre aussi l'ancienne page n'est pas nécessaire : la page lit le prix
-- quand montant_encaisse n'existe pas. Rejouable.
-- =============================================================================
begin;

drop view if exists public.v_commandes_a_regler;
create view public.v_commandes_a_regler
with (security_invoker = on) as
 SELECT c.id AS commande_id,
    c.tenant_id,
    c.vendeur_id,
    c.lead_id,
    c.client_nom,
    c.produit,
    COALESCE(c.quantite, 1) AS quantite,
    COALESCE(c.prix, 0::numeric) AS prix,
    c.statut_livraison,
    c.updated_at,
    c.created_at,
    p.devise
   FROM commandes c
     LEFT JOIN pays p ON p.id = c.pays_id
  WHERE c.statut_livraison = 'livre'::text AND c.vendeur_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM reglements_commandes rc
          WHERE rc.commande_id = c.id));

revoke all on public.v_commandes_a_regler from public, anon;
grant all on public.v_commandes_a_regler to authenticated, service_role;

commit;

select relacl::text as droits, reloptions::text as options from pg_class where oid = 'public.v_commandes_a_regler'::regclass;
