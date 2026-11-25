// lib/affichageStatut.mjs — ce que la colonne Statut de Commandes (et, plus
// tard, la vue de l'agent) montre d'un statut. Sans base.
//   node supabase/tests/test_affichage_statut.mjs
import { estPending, estStatutOuvert, statutPrincipal, sousStatutOuvert, nomsParGroupe } from '../../lib/affichageStatut.mjs'
import * as lib from '../../lib/affichageStatut.mjs'

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }

const STATUTS = [
  { nom: 'Pending', ferme_le_lead: false },
  { nom: 'Unreached', ferme_le_lead: false },
  { nom: 'Reminder', ferme_le_lead: false, necessite_rappel: true },
  { nom: 'Confirmed', ferme_le_lead: true, declenche_assignation: true },
  { nom: 'Cancelled', ferme_le_lead: true },
  { nom: 'Double', ferme_le_lead: true },
  { nom: 'Test', ferme_le_lead: true },
  { nom: 'Spam', ferme_le_lead: true },
  // un statut ajouté plus tard dans Paramètres, ouvert
  { nom: 'Messagerie', ferme_le_lead: false },
]

// --- statut principal
for (const s of ['Pending', 'Unreached', 'Reminder', 'Messagerie'])
  check(`${s} → badge « En attente » (Pending)`, statutPrincipal(s, STATUTS) === 'Pending')
for (const s of ['Confirmed', 'Cancelled', 'Double', 'Test', 'Spam'])
  check(`${s} → badge inchangé`, statutPrincipal(s, STATUTS) === s)
check('NULL (ancien lead) → En attente', statutPrincipal(null, STATUTS) === 'Pending')
check('Pending sans ligne dans statuts → toujours En attente', statutPrincipal('Pending', []) === 'Pending')
check('statut inconnu de la liste → affiché tel quel (jamais déguisé en attente)', statutPrincipal('Bizarre', STATUTS) === 'Bizarre')
check('lu sur le drapeau, pas le mot : « Unreached » rendu fermant → inchangé',
  statutPrincipal('Unreached', [{ nom: 'Unreached', ferme_le_lead: true }]) === 'Unreached')

// --- « tentative » n'est plus défini ici (29/10) : une seule définition, en SQL
check('estTentative et resumeTentatives ne sont plus exportés (le compte vit en base)', !('estTentative' in lib) && !('resumeTentatives' in lib))
check('estPending / estStatutOuvert cohérents', estPending('') && estStatutOuvert('Reminder', STATUTS) && !estStatutOuvert('Spam', STATUTS))

// --- le découpage de « En attente » (deuxième ligne du badge ET filtre Pending status)
check('Pending, NULL → pending', sousStatutOuvert('Pending', STATUTS) === 'pending' && sousStatutOuvert(null, STATUTS) === 'pending')
check('Unreached, statut ouvert ajouté → non_joint', sousStatutOuvert('Unreached', STATUTS) === 'non_joint' && sousStatutOuvert('Messagerie', STATUTS) === 'non_joint')
check('Reminder (necessite_rappel) → rappel', sousStatutOuvert('Reminder', STATUTS) === 'rappel')
check('statuts qui ferment, inconnu → null', ['Confirmed', 'Cancelled', 'Double', 'Test', 'Spam', 'Bizarre'].every((s) => sousStatutOuvert(s, STATUTS) === null))
check('lu sur le drapeau : « Unreached » rendu rappel → rappel', sousStatutOuvert('Unreached', [{ nom: 'Unreached', ferme_le_lead: false, necessite_rappel: true }]) === 'rappel')
const g = nomsParGroupe([...STATUTS, { nom: 'Unreached', ferme_le_lead: false, pays_id: 'x' }])
check('groupes : pending / non_joint / rappel / fermants, chaque nom une fois',
  JSON.stringify(g.pending) === '["Pending"]' && JSON.stringify(g.non_joint) === '["Unreached","Messagerie"]'
  && JSON.stringify(g.rappel) === '["Reminder"]' && g.fermants.length === 5, JSON.stringify(g))
check('ouverts = pending + non_joint + rappel (le filtre « En attente »)', g.ouverts.length === 4 && g.ouverts.every((n) => statutPrincipal(n, STATUTS) === 'Pending'))
check('chaque statut ouvert tombe dans exactement un groupe', STATUTS.filter((s) => !s.ferme_le_lead)
  .every((s) => ['pending', 'non_joint', 'rappel'].filter((k) => g[k].includes(s.nom)).length === 1))

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko ? 1 : 0)
