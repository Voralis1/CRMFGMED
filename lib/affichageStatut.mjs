// Ce qu'un écran MONTRE d'un statut d'appel, quand ce n'est pas le statut
// brut. Aucune règle ici ne touche la base : la valeur enregistrée reste
// celle de commandes.statut_confirmation, et les responsables la voient
// telle quelle là où c'est leur outil (Centre d'appel).
//
// Statut « ouvert » = « En attente », « Non joint », « Rappel », et tout
// statut ajouté plus tard dans Paramètres avec « ferme le lead » décoché.
// Lu sur le DRAPEAU ferme_le_lead, jamais sur le mot.
//
// CE QUI N'EST PLUS ICI (29/10) : « qu'est-ce qu'une tentative » et le
// compte des tentatives. Une seule définition, en SQL (est_tentative,
// commandes_statut_lot.sql), tenue sur la commande (nb_tentatives,
// derniere_tentative_statut, derniere_tentative_le). Les écrans lisent ces
// colonnes ; ne pas réécrire le compte ici.

const PENDING = 'Pending'

// Pending est reconnu par son texte (posé par la base, statut_pending.sql),
// même si la ligne de `statuts` manque.
export const estPending = (nom) => !nom || nom === PENDING

export function estStatutOuvert(nom, statuts) {
  if (estPending(nom)) return true
  const s = (statuts || []).find((x) => x.nom === nom)
  return !!s && !s.ferme_le_lead
}

// Le statut à afficher en badge principal : un statut ouvert se lit
// « En attente » (la valeur Pending, que libelleStatut traduit) ; un statut
// qui conclut (Confirmed, Cancelled, Double, Test, Spam…) se lit tel quel.
export const statutPrincipal = (nom, statuts) => (estStatutOuvert(nom, statuts) ? PENDING : nom)

// LE découpage de « En attente » en trois, partagé par la deuxième ligne du
// badge et par le filtre « Pending status » de Commandes :
//   'pending'   : en attente seulement (personne n'y a touché, ou renvoyé) ;
//   'rappel'    : un statut ouvert qui demande un rappel (necessite_rappel) ;
//   'non_joint' : tout autre statut ouvert (Non joint, et ceux ajoutés plus tard).
// null : le statut ferme le lead.
export function sousStatutOuvert(nom, statuts) {
  if (estPending(nom)) return 'pending'
  const s = (statuts || []).find((x) => x.nom === nom)
  if (!s || s.ferme_le_lead) return null
  return s.necessite_rappel ? 'rappel' : 'non_joint'
}

// Les noms de statuts de chaque groupe, pour filtrer en base. Chaque nom une
// seule fois (un statut peut exister pour plusieurs pays).
export function nomsParGroupe(statuts) {
  const g = { pending: [PENDING], non_joint: [], rappel: [], fermants: [] }
  for (const s of statuts || []) {
    if (!s?.nom || estPending(s.nom)) continue
    const cle = s.ferme_le_lead ? 'fermants' : (s.necessite_rappel ? 'rappel' : 'non_joint')
    if (!g[cle].includes(s.nom)) g[cle].push(s.nom)
  }
  g.ouverts = [...g.pending, ...g.non_joint, ...g.rappel]
  return g
}
