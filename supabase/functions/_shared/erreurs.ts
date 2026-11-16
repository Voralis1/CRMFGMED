// Les messages d'erreur renvoyés par les Edge Functions (16/11/2026, revue de
// sécurité du 13/11, point 5). Sans import : testé sous Node
// (supabase/tests/test_erreurs_fonctions.mjs).
//
// Avant : le message brut partait à l'écran, et par l'API d'import vers
// l'extérieur — « duplicate key value violates unique constraint
// "commandes_…_key" », « TypeError: … », noms de tables et de colonnes.
//
// La règle :
//   - NOS messages (les `raise exception` français des fichiers SQL) passent
//     tels quels : « Stock insuffisant… » doit rester lisible. On ne les
//     reconnaît PAS au code : nos gardes utilisent aussi 42501 (69 fois),
//     23514 / check_violation, 22023, P0002, 23001. On reconnaît les messages
//     de Postgres / PostgREST, qui commencent toujours par les mêmes phrases
//     anglaises (aucun des 835 `raise exception` du 16/11 ne commence ainsi).
//   - un message de Postgres est traduit en français simple ;
//   - le reste (plantage, erreur réseau, message inconnu) devient
//     « Erreur interne du serveur (réf. XXXXXXXX) » ; le message complet va
//     dans les logs Supabase avec la même référence.

// Les débuts de message de Postgres / PostgREST → la phrase montrée.
const MESSAGES_POSTGRES: Array<[RegExp, string]> = [
  [/^duplicate key value violates unique constraint/i, 'Cet élément existe déjà.'],
  // « violates RESTRICT setting of foreign key constraint » : 23001 (leçon 25).
  [/^(insert or update|update or delete) on table .* violates .*foreign key constraint/i,
    'Lien introuvable ou encore utilisé ailleurs.'],
  [/^(null value in column|.* violates not-null constraint)/i, 'Un champ obligatoire est vide.'],
  [/^new row for relation .* violates check constraint/i, 'Valeur refusée par la base.'],
  [/^(permission denied for|new row violates row-level security policy)/i, 'Action non autorisée.'],
  [/^(invalid input syntax for type|invalid input value for enum)/i, 'Valeur au mauvais format.'],
  [/^value too long for type/i, 'Texte trop long.'],
  [/^canceling statement due to statement timeout/i, 'La base a mis trop de temps à répondre. Réessayez.'],
  [/^(deadlock detected|could not serialize access)/i, 'Conflit avec une autre opération en cours. Réessayez.'],
]

// Une erreur de Postgres qu'on ne sait pas dire en français : technique.
const TECHNIQUE_POSTGRES = /^(column|relation|function|operator|type|schema|table) .* does not exist|^(could not|syntax error|cannot|there is no|more than one row|query returned|JSON object requested|Could not find|failed to|structure of query)/i

// Les erreurs de Supabase Auth (création / modification de compte) : par code.
const MESSAGES_AUTH: Record<string, string> = {
  email_exists: 'Un compte existe déjà avec cet e-mail.',
  user_already_exists: 'Un compte existe déjà avec cet e-mail.',
  weak_password: 'Mot de passe trop faible (8 caractères minimum).',
  email_address_invalid: 'Adresse e-mail invalide.',
  validation_failed: 'Adresse e-mail ou mot de passe invalide.',
  user_not_found: 'Compte introuvable.',
}

export function reference(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
}

// deno-lint-ignore no-explicit-any
function estErreurAuth(err: any): boolean {
  return !!err && (err.__isAuthError === true || /^Auth/.test(String(err.name ?? '')))
}

// Le message à montrer, ou null s'il faut une référence (erreur interne).
// deno-lint-ignore no-explicit-any
export function messageConnu(err: any): string | null {
  const message = String(err?.message ?? '').trim()
  if (!message) return null
  // HttpError de nos fonctions : message écrit par nous.
  if (err instanceof Error && typeof (err as any).status === 'number' && !estErreurAuth(err)) return message
  if (estErreurAuth(err)) return MESSAGES_AUTH[String(err.code ?? '')] ?? null
  for (const [motif, phrase] of MESSAGES_POSTGRES) if (motif.test(message)) return phrase
  if (TECHNIQUE_POSTGRES.test(message)) return null
  // Une erreur JavaScript (TypeError…) n'est jamais un message pour l'écran.
  if (err instanceof Error && !('code' in err) && err.name !== 'Error') return null
  // Une erreur de la base sans code : pas la nôtre (un raise a toujours un code).
  if (!err?.code) return null
  // Reste : un message de nos fichiers SQL.
  return message
}

// Le message public ; l'original va dans les logs avec la référence.
// deno-lint-ignore no-explicit-any
export function messagePublic(err: any, contexte = ''): string {
  const connu = messageConnu(err)
  if (connu !== null) return connu
  const ref = reference()
  console.error(`[réf. ${ref}]${contexte ? ' ' + contexte + ' :' : ''}`, err)
  return `Erreur interne du serveur (réf. ${ref})`
}
