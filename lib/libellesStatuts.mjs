// Les statuts d'appel : ce que l'écran AFFICHE, pas ce qui est enregistré.
//
// Le statut s'affiche « En attente » à l'écran, mais sa valeur en base et
// dans tout le code reste « Pending » (le NOM, écrit dans
// commandes.statut_confirmation ; `pending` est le code de la ligne de
// `statuts`). Ne pas renommer la valeur : elle est comparée dans les
// fonctions Edge, l'import, les triggers et les statistiques. Même chose
// pour les cinq autres ci-dessous.
//
// La clé est le NOM (statuts.nom = commandes.statut_confirmation) : c'est ce
// que tous les écrans lisent. Un nom absent de la table (Test, Spam, un
// statut ajouté plus tard dans Paramètres) s'affiche tel quel.
//
// Toute comparaison, tout filtre, toute requête garde la valeur brute ; on
// ne passe par libelleStatut() qu'au moment d'écrire à l'écran ou dans un
// export.
export const LIBELLES_STATUTS = Object.freeze({
  Pending: 'En attente',
  Confirmed: 'Confirmée',
  Cancelled: 'Annulée',
  Unreached: 'Non joint',
  Reminder: 'Rappel',
  Double: 'Doublon',
})

export function libelleStatut(nom) {
  if (nom == null || nom === '') return ''
  return Object.prototype.hasOwnProperty.call(LIBELLES_STATUTS, nom) ? LIBELLES_STATUTS[nom] : nom
}
