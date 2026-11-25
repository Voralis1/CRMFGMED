// lib/libellesStatuts.mjs (17/11) — sans base : tous les statuts s'affichent
// en anglais, les valeurs enregistrées ne changent pas.
// node supabase/tests/test_libelles_statuts.mjs
import { libelleStatut, libelleDe, LIBELLES_LIVRAISON, LIBELLES_PAIEMENT, LIBELLES_EXPEDITION, LIBELLES_RELEVE } from '../../lib/libellesStatuts.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${JSON.stringify(attendu)}`)) }

// appel
for (const [v, l] of [['Pending', 'Pending'], ['Confirmed', 'Confirmed'], ['Cancelled', 'Cancelled'], ['Unreached', 'Unreached'], ['Reminder', 'Reminder'], ['Double', 'Duplicate'],
  ['Rupture de stock', 'Out of stock'], ['Produit non reconnu', 'Unknown product'], ['Spam', 'Spam'], ['Test', 'Test'], ['Statut maison', 'Statut maison']]) check(`appel ${v}`, libelleStatut(v), l)
check('appel vide', libelleStatut(''), '')
check('appel null', libelleStatut(null), '')
check('toString ne passe pas pour un statut', libelleStatut('toString'), 'toString')

// livraison, paiement, expédition, relevé
check('livraison a_preparer', libelleDe(LIBELLES_LIVRAISON, 'a_preparer'), 'To prepare')
check('livraison expedie', libelleDe(LIBELLES_LIVRAISON, 'expedie'), 'Shipped')
check('livraison livre', libelleDe(LIBELLES_LIVRAISON, 'livre'), 'Delivered')
check('livraison retour', libelleDe(LIBELLES_LIVRAISON, 'retour'), 'Returned')
check('livraison annule', libelleDe(LIBELLES_LIVRAISON, 'annule'), 'Cancelled')
check('paiement paye', libelleDe(LIBELLES_PAIEMENT, 'paye'), 'Paid')
check('paiement non_paye', libelleDe(LIBELLES_PAIEMENT, 'non_paye'), 'Unpaid')
check('expédition en_transit', libelleDe(LIBELLES_EXPEDITION, 'en_transit'), 'In transit')
check('expédition receptionnee', libelleDe(LIBELLES_EXPEDITION, 'receptionnee'), 'Received')
check('expédition refusee', libelleDe(LIBELLES_EXPEDITION, 'refusee'), 'Rejected')
check('relevé paye', libelleDe(LIBELLES_RELEVE, 'paye'), 'Paid')
check('valeur inconnue telle quelle', libelleDe(LIBELLES_LIVRAISON, 'perdu'), 'perdu')
check('valeur vide', libelleDe(LIBELLES_PAIEMENT, null), '')

// aucun libellé français ne reste
const tous = [LIBELLES_LIVRAISON, LIBELLES_PAIEMENT, LIBELLES_EXPEDITION, LIBELLES_RELEVE].flatMap(Object.values)
  .concat(['Pending', 'Confirmed', 'Cancelled', 'Unreached', 'Reminder', 'Double', 'Rupture de stock', 'Produit non reconnu'].map(libelleStatut))
check('aucun accent français', tous.some((l) => /[éèàêç]/i.test(l)), false)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
