// supabase/functions/_shared/erreurs.ts (16/11) — sans base : ce qu'une Edge
// Function montre quand ça échoue (revue de sécurité 13/11, point 5).
// Nos messages SQL passent tels quels (même avec 42501 / 23514 / P0002…),
// ceux de Postgres sont traduits, le reste devient « Erreur interne (réf. …) ».
// node supabase/tests/test_erreurs_fonctions.mjs
import { messageConnu, messagePublic } from '../functions/_shared/erreurs.ts'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${JSON.stringify(attendu)}`)) }
const pg = (code, message) => ({ code, message, details: null, hint: null })
class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
class AuthApiError extends Error { constructor(message, status, code) { super(message); this.name = 'AuthApiError'; this.status = status; this.code = code; this.__isAuthError = true } }

// nos messages : intacts, quel que soit le code
check('P0001 (raise simple)', messageConnu(pg('P0001', 'Stock insuffisant pour ce produit.')), 'Stock insuffisant pour ce produit.')
check('42501 de nos gardes', messageConnu(pg('42501', 'Seul un responsable peut marquer payé.')), 'Seul un responsable peut marquer payé.')
check('23514 de nos gardes', messageConnu(pg('23514', 'Livré seulement après Expédiée.')), 'Livré seulement après Expédiée.')
check('P0002', messageConnu(pg('P0002', 'Commande introuvable.')), 'Commande introuvable.')
check('notre message avec guillemets', messageConnu(pg('P0001', 'Le préfixe "AB" est figé : des commandes de cette source le portent déjà')), 'Le préfixe "AB" est figé : des commandes de cette source le portent déjà')
check('HttpError de nos fonctions', messageConnu(new HttpError(403, 'Permission refusée')), 'Permission refusée')

// Postgres : traduit
check('doublon 23505', messageConnu(pg('23505', 'duplicate key value violates unique constraint "commandes_tenant_lead_id_key"')), 'Cet élément existe déjà.')
check('FK 23503', messageConnu(pg('23503', 'insert or update on table "livraisons" violates foreign key constraint "livraisons_commande_id_fkey"')), 'Lien introuvable ou encore utilisé ailleurs.')
check('FK delete 23001', messageConnu(pg('23001', 'update or delete on table "pays" violates RESTRICT setting of foreign key constraint "x" on table "y"')), 'Lien introuvable ou encore utilisé ailleurs.')
check('not null', messageConnu(pg('23502', 'null value in column "tenant_id" of relation "commandes" violates not-null constraint')), 'Un champ obligatoire est vide.')
check('check Postgres', messageConnu(pg('23514', 'new row for relation "stocks" violates check constraint "stocks_quantite_check"')), 'Valeur refusée par la base.')
check('permission Postgres 42501', messageConnu(pg('42501', 'permission denied for table paiements')), 'Action non autorisée.')
check('RLS', messageConnu(pg('42501', 'new row violates row-level security policy for table "commandes"')), 'Action non autorisée.')
check('uuid invalide', messageConnu(pg('22P02', 'invalid input syntax for type uuid: "abc"')), 'Valeur au mauvais format.')
check('trop long', messageConnu(pg('22001', 'value too long for type character varying(50)')), 'Texte trop long.')
check('timeout', messageConnu(pg('57014', 'canceling statement due to statement timeout')), 'La base a mis trop de temps à répondre. Réessayez.')

// technique : référence
check('colonne absente', messageConnu(pg('42703', 'column commandes.foo does not exist')), null)
check('fonction absente PGRST202', messageConnu(pg('PGRST202', 'Could not find the function public.x(a) in the schema cache')), null)
check('PGRST116', messageConnu(pg('PGRST116', 'JSON object requested, multiple (or no) rows returned')), null)
check('TypeError', messageConnu(new TypeError("Cannot read properties of undefined (reading 'id')")), null)
check('Error sans code', messageConnu(new Error('fetch failed')), null)
check('objet sans code', messageConnu({ message: 'something' }), null)
check('vide', messageConnu({ code: 'P0001', message: '' }), null)
check('null', messageConnu(null), null)

// Auth
check('email existe', messageConnu(new AuthApiError('A user with this email address has already been registered', 422, 'email_exists')), 'Un compte existe déjà avec cet e-mail.')
check('mot de passe faible', messageConnu(new AuthApiError('Password should be at least 8 characters.', 422, 'weak_password')), 'Mot de passe trop faible (8 caractères minimum).')
check('Auth inconnu → référence', messageConnu(new AuthApiError('Database error saving new user', 500, 'unexpected_failure')), null)

// messagePublic : référence + log
const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.map(String).join(' '))
const m = messagePublic(pg('42703', 'column commandes.foo does not exist'), 'test')
console.error = orig
const ref = (m.match(/réf\. ([0-9A-F]{8})\)$/) || [])[1]
check('référence de 8 caractères', !!ref, true)
check('le log porte la même référence et le détail', logs.length === 1 && logs[0].includes(ref) && logs[0].includes('test'), true)
check('le message brut n’est pas à l’écran', m.includes('commandes.foo'), false)
check('message connu : pas de log', (() => { let n = 0; console.error = () => n++; messagePublic(pg('P0001', 'Stock insuffisant.')); console.error = orig; return n })(), 0)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
