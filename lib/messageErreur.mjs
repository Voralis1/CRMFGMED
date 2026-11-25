// Le message d'erreur montré à l'écran (24/11/2026, « messages dans le CRM »).
//
// Avant : les pages affichaient error.message tel quel — « duplicate key value
// violates unique constraint "paiements_commande_id_key" », « new row violates
// row-level security policy for table "livraisons" », « JWT expired ».
// Personne ne comprend, et ça montre l'intérieur de la base.
//
// La règle est celle des Edge Functions (16/11, _shared/erreurs.ts), réutilisée
// telle quelle — une seule copie :
//   - NOS messages (les `raise exception` français des fichiers SQL, les refus
//     de nos fonctions) passent tels quels ;
//   - un message de Postgres / PostgREST connu est dit en français simple ;
//   - le reste devient « Une erreur est survenue (réf. XXXXXXXX) », et l'erreur
//     complète part dans la console du navigateur avec la même référence.
// En plus, côté navigateur : session expirée et réseau coupé.
// Testé sous Node : supabase/tests/test_message_erreur.mjs.

import { messageConnu, reference } from '../supabase/functions/_shared/erreurs.ts'
import { traduire } from './langues/index.mjs'

const SESSION_EXPIREE = /JWT expired|invalid JWT|JWT.*(malformed|invalid)|refresh token|session (missing|not found)/i
const RESEAU = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

// `err` : une erreur de supabase-js (objet { message, code… }), une Error, ou
// un texte déjà écrit pour l'écran (refus d'une de nos fonctions). `repli` :
// la phrase à dire quand l'erreur n'est pas connue (« Fichier illisible. »…).
export function messageErreur(err, repli = '') {
  if (err == null || err === '') return repli || `${traduire('err.inconnue')}.`
  // Un texte : déjà un message pour l'écran (nos Edge Functions le rendent
  // public depuis le 16/11, nos refus SQL sont en français).
  if (typeof err === 'string') return err
  const message = String(err?.message ?? '')
  if (SESSION_EXPIREE.test(message)) return traduire('err.session')
  if (RESEAU.test(message)) return traduire('err.reseau')
  const connu = messageConnu(err)
  // Une phrase fixe de Postgres traduite (lib/langues : la clé est la phrase) ;
  // nos messages SQL restent dans leur langue (français) pour l'instant.
  if (connu !== null) return traduire(connu)
  const ref = reference()
  console.error(`[réf. ${ref}]`, err)
  return `${repli ? repli.replace(/\.?\s*$/, '') : traduire('err.inconnue')} (réf. ${ref}).`
}
