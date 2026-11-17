// Les statuts : ce que l'écran AFFICHE, pas ce qui est enregistré.
//
// Tous les statuts s'affichent EN ANGLAIS (sa décision 17/11 : les statuts
// seulement, le reste de l'écran reste en français ; exports compris). Un seul
// fichier pour toutes les familles — appel, livraison, paiement, expédition,
// relevé — au lieu d'une table par page. Les valeurs ENREGISTRÉES ne changent
// pas : seul l'affichage passe par ici.
//
// Les statuts d'appel : la valeur en base et dans tout le code est le NOM
// anglais « Pending », « Double »… (écrit dans
// commandes.statut_confirmation ; `pending` est le code de la ligne de
// `statuts`). Ne pas renommer la valeur : elle est comparée dans les
// fonctions Edge, l'import, les triggers et les statistiques. Du 28/10 au
// 17/11 ils s'affichaient en français (En attente, Non joint…).
//
// La clé est le NOM (statuts.nom = commandes.statut_confirmation) : c'est ce
// que tous les écrans lisent. Un nom absent de la table (Test, Spam, un
// statut ajouté plus tard dans Paramètres) s'affiche tel quel.
//
// Toute comparaison, tout filtre, toute requête garde la valeur brute ; on
// ne passe par libelleStatut() qu'au moment d'écrire à l'écran ou dans un
// export.
export const LIBELLES_STATUTS = Object.freeze({
  Pending: 'Pending',
  Confirmed: 'Confirmed',
  Cancelled: 'Cancelled',
  Unreached: 'Unreached',
  Reminder: 'Reminder',
  Double: 'Duplicate',
  // Deux noms enregistrés EN FRANÇAIS en base : les règles de stock SQL les
  // écrivent tels quels. Affichés en anglais, jamais renommés en base.
  'Rupture de stock': 'Out of stock',
  'Produit non reconnu': 'Unknown product',
})

export function libelleStatut(nom) {
  if (nom == null || nom === '') return ''
  return Object.prototype.hasOwnProperty.call(LIBELLES_STATUTS, nom) ? LIBELLES_STATUTS[nom] : nom
}

// Livraison (livraisons.statut / commandes.statut_livraison, contrainte
// livraisons_statut_valide).
export const LIBELLES_LIVRAISON = Object.freeze({
  a_preparer: 'To prepare',
  expedie: 'Shipped',
  livre: 'Delivered',
  retour: 'Returned',
  annule: 'Cancelled',
})

// Paiement de la commande (commandes.statut_paiement).
export const LIBELLES_PAIEMENT = Object.freeze({
  paye: 'Paid',
  non_paye: 'Unpaid',
})

// Expédition de stock (expeditions.statut).
export const LIBELLES_EXPEDITION = Object.freeze({
  en_attente: 'Pending',
  confirmee: 'Confirmed',
  en_transit: 'In transit',
  receptionnee: 'Received',
  refusee: 'Rejected',
})

// Relevé de paiement du vendeur (reglements.statut).
export const LIBELLES_RELEVE = Object.freeze({
  en_attente: 'Pending',
  paye: 'Paid',
  annule: 'Cancelled',
})

// Une valeur d'une de ces familles → son libellé, la valeur telle quelle si
// elle est inconnue (un statut ajouté plus tard se voit au lieu de disparaître).
export function libelleDe(table, valeur) {
  if (valeur == null || valeur === '') return ''
  return Object.prototype.hasOwnProperty.call(table, valeur) ? table[valeur] : valeur
}
