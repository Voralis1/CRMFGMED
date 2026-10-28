// Ce qu'un écran MONTRE d'un statut d'appel, quand ce n'est pas le statut
// brut. Aucune règle ici ne touche la base : la valeur enregistrée reste
// celle de commandes.statut_confirmation, et les responsables la voient
// telle quelle là où c'est leur outil (Centre d'appel).
//
// Statut « ouvert » = « En attente », « Non joint », « Rappel », et tout
// statut ajouté plus tard dans Paramètres avec « ferme le lead » décoché.
// Lu sur le DRAPEAU ferme_le_lead, jamais sur le mot.

const PENDING = 'Pending'

// Pending est reconnu par son texte (posé par la base, statut_pending.sql),
// même si la ligne de `statuts` manque.
export const estPending = (nom) => !nom || nom === PENDING

export function estStatutOuvert(nom, statuts) {
  if (estPending(nom)) return true
  const s = (statuts || []).find((x) => x.nom === nom)
  return !!s && !s.ferme_le_lead
}

// Une tentative = un appel qui n'a rien conclu : le lead est passé à un
// statut ouvert autre que Pending (Non joint, Rappel…).
export const estTentative = (nom, statuts) => !estPending(nom) && estStatutOuvert(nom, statuts)

// Le statut à afficher en badge principal : un statut ouvert se lit
// « En attente » (la valeur Pending, que libelleStatut traduit) ; un statut
// qui conclut (Confirmed, Cancelled, Double, Test, Spam…) se lit tel quel.
export const statutPrincipal = (nom, statuts) => (estStatutOuvert(nom, statuts) ? PENDING : nom)

// Les tentatives d'une commande, d'après ses lignes d'historique
// ({ statut, cree_le }) : combien, la dernière date, et le dernier résultat
// (le MOT de la ligne « ☎ Non joint — 3 tentatives — 28/10 08:20 »).
// null s'il n'y en a aucune.
export function resumeTentatives(lignes, statuts) {
  let n = 0
  let derniere = null
  for (const l of lignes || []) {
    if (!estTentative(l.statut, statuts)) continue
    n += 1
    if (!derniere || new Date(l.cree_le) > new Date(derniere.cree_le)) derniere = l
  }
  return n === 0 ? null : { n, statut: derniere.statut, date: derniere.cree_le }
}
