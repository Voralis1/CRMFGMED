// Recherche texte dans un filtre « or » de PostgREST (17/11/2026, revue de
// sécurité du 13/11, point 6).
//
// `.or('col.ilike.%x%,…')` est une chaîne que PostgREST relit : un " ouvre une
// valeur entre guillemets, un \ échappe, , ( ) séparent. Avant : Centre d'appel
// retirait , ( ) % # mais pas " ni \ → une recherche « Ali" » cassait le filtre
// (erreur, liste vide). Maintenant la valeur est mise ENTRE GUILLEMETS, " et \
// échappés par \ : tout caractère tapé est cherché tel quel, virgule et
// parenthèses comprises (« Ali (Rabat) »).
//
// % et * restent retirés : ce sont les jokers de ilike pour PostgREST, pas du
// texte que l'agent cherche.

export function motifContient(texte) {
  const t = String(texte ?? '').replace(/[%*]/g, '').trim()
  if (!t) return ''
  return '"%' + t.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '%"'
}

// « col1.ilike."%x%",col2.ilike."%x%" » — '' si rien à chercher.
export function orContient(colonnes, texte) {
  const motif = motifContient(texte)
  if (!motif) return ''
  return colonnes.map((c) => `${c}.ilike.${motif}`).join(',')
}
