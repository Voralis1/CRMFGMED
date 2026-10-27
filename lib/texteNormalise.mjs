// texte_normalise() de la base, en JavaScript — pour que l'écran Assignation
// livreur ne suggère que le livreur que la base choisirait.
//
// Copie EXACTE de public.texte_normalise (zone_commande.sql) :
//   lower(regexp_replace(btrim(unaccent_simple(t)), '\s+', ' ', 'g')), vide → null
// et unaccent_simple est un translate() sur une liste FIXE de lettres — pas la
// décomposition Unicode complète. On recopie la liste, pas une approximation :
// « ø » ou « ł » restent tels quels des deux côtés.
// Vérifié contre la vraie fonction Postgres : supabase/sql/tests/test_texte_normalise.mjs.

const DE = 'àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ'
const VERS = 'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'

export function texteNormalise(texte) {
  if (texte === null || texte === undefined) return null
  let t = ''
  for (const c of String(texte)) {
    const i = DE.indexOf(c)
    t += i === -1 ? c : VERS[i]
  }
  // btrim et \s de Postgres : espace, tabulation, retours à la ligne.
  t = t.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '').replace(/[ \t\n\r\f\v]+/g, ' ').toLowerCase()
  return t === '' ? null : t
}
