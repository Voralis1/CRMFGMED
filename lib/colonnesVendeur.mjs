// Ce que le navigateur d'un VENDEUR reçoit d'une commande (02/11, bloc 4).
//
// Toutes les colonnes de `commandes` (lues en production le 02/11), SAUF :
//   · agent_id    — qui a traité son lead ;
//   · remonte_par — qui l'a remonté.
// Le vendeur ne voit ni l'agent ni le livreur : masquer une colonne ne suffit
// pas, elle ne doit pas arriver dans son navigateur (même règle que pour le
// livreur, 30/10). Pas d'embed `agents(...)` non plus.
//
// Une colonne ajoutée plus tard à `commandes` n'arrive PAS chez le vendeur tant
// qu'elle n'est pas ajoutée ici : c'est voulu (on ajoute ce qu'il doit voir,
// on ne retire pas ce qu'il ne doit pas voir).
export const COLONNES_COMMANDE_VENDEUR = [
  'id', 'lead_id', 'source', 'client_nom', 'client_telephone', 'produit', 'pays_id', 'zone_id',
  'statut_confirmation', 'statut_livraison', 'statut_paiement', 'is_doublon', 'created_at', 'updated_at',
  'date_commande', 'ville_zone', 'source_url', 'commentaire_1', 'whatsapp_tracking', 'source_sheet',
  'whatsapp_followup', 'notes', 'commentaire_2', 'quantite', 'date_rappel', 'prix', 'tenant_id',
  'vendeur_id', 'tracking_number', 'source_id', 'adresse', 'entrepot_id', 'articles', 'stock_ajuste',
  'stock_note', 'remonte_le', 'entree_file', 'nb_tentatives', 'derniere_tentative_statut',
  'derniere_tentative_le', 'derniere_action_le', 'produit_id',
].join(', ')
