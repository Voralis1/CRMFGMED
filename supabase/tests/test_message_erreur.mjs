// lib/messageErreur.mjs (24/11) — sans base : ce qu'une PAGE montre quand ça
// échoue. Même règle que les Edge Functions (_shared/erreurs.ts) + session
// expirée et réseau coupé ; jamais le texte brut de Postgres.
// node supabase/tests/test_message_erreur.mjs
import { messageErreur } from '../../lib/messageErreur.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = attendu instanceof RegExp ? attendu.test(recu) : recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${attendu}`)) }
const pg = (code, message) => ({ code, message, details: null, hint: null })
// postgrest-js récent : PostgrestError est une classe (Error) avec un code.
class PostgrestError extends Error { constructor(o) { super(o.message); this.name = 'PostgrestError'; this.code = o.code; this.details = null; this.hint = null } }
class FunctionsHttpError extends Error { constructor() { super('Edge Function returned a non-2xx status code'); this.name = 'FunctionsHttpError' } }
const console_error = console.error; console.error = () => {} // les références vont en console : silence pendant le test

// nos messages : intacts
check('raise français (objet)', messageErreur(pg('P0001', 'Stock insuffisant pour ce produit.')), 'Stock insuffisant pour ce produit.')
check('raise français (classe)', messageErreur(new PostgrestError(pg('42501', 'Votre rôle ne permet pas d\'établir un relevé.'))), 'Votre rôle ne permet pas d\'établir un relevé.')
check('texte déjà écrit (refus de fonction)', messageErreur('Adresse obligatoire pour confirmer.'), 'Adresse obligatoire pour confirmer.')
check('entreprise suspendue', messageErreur(pg('42501', 'Entreprise suspendue')), 'Entreprise suspendue')

// Postgres : traduit, jamais brut
check('doublon', messageErreur(pg('23505', 'duplicate key value violates unique constraint "paiements_commande_id_key"')), 'Cet élément existe déjà.')
check('RLS', messageErreur(new PostgrestError(pg('42501', 'new row violates row-level security policy for table "livraisons"'))), 'Action non autorisée.')
check('colonne inconnue → réf.', messageErreur(pg('42703', 'column commandes.xyz does not exist')), /^Une erreur est survenue \(réf\. [0-9A-F]{8}\)\.$/)

// navigateur
check('JWT expiré', messageErreur(pg('PGRST301', 'JWT expired')), 'Votre session a expiré. Reconnectez-vous.')
check('réseau (fetch)', messageErreur({ message: 'TypeError: Failed to fetch', code: '' }), 'Pas de connexion internet. Vérifiez le réseau puis réessayez.')
check('réseau (Safari)', messageErreur(new TypeError('Load failed')), 'Pas de connexion internet. Vérifiez le réseau puis réessayez.')
check('Edge Function non-2xx → réf.', messageErreur(new FunctionsHttpError()), /^Une erreur est survenue \(réf\. [0-9A-F]{8}\)\.$/)
check('TypeError JS → réf.', messageErreur(new TypeError("Cannot read properties of undefined (reading 'id')")), /\(réf\. [0-9A-F]{8}\)\.$/)

// repli
check('repli + réf.', messageErreur(new Error('xlsx: bad zip'), 'Fichier illisible.'), /^Fichier illisible \(réf\. [0-9A-F]{8}\)\.$/)
check('rien → repli', messageErreur(null, 'Suppression refusée.'), 'Suppression refusée.')
check('rien, sans repli', messageErreur(undefined), 'Une erreur est survenue.')
check('jamais un nom de table', /livraisons|paiements_commande|row-level/.test([
  messageErreur(pg('23505', 'duplicate key value violates unique constraint "paiements_commande_id_key"')),
  messageErreur(pg('42501', 'new row violates row-level security policy for table "livraisons"')),
].join(' ')), false)

console.error = console_error
console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
