// LE filtre produit (29/10), Commandes et Centre d'appel : par PRODUIT, plus
// par texte. Avant, la liste était le texte des commandes (« product c »,
// « product-c »… : un produit par orthographe) et le filtre une égalité de
// texte. Maintenant :
//   · les options = le catalogue que la personne VOIT (RLS : un vendeur, ses
//     produits), plus « Produit non reconnu » ;
//   · une commande est rangée par commandes.produit_id, posé par la base
//     (commandes_produit_id.sql, la règle du stock : code puis nom) ;
//   · « Produit non reconnu » attrape TOUT le reste (sa décision) : pas de
//     produit reconnu, OU un produit hors du catalogue visible (le produit
//     d'un autre vendeur). Aucune commande n'est inatteignable par le filtre.
// Le texte de la commande, lui, n'est jamais réécrit : il s'affiche tel
// qu'il est arrivé.

export const NON_RECONNU = 'non_reconnu'

// Les options du filtre, par nom.
export function optionsProduit(catalogue) {
  return [...(catalogue || [])]
    .sort((a, b) => String(a.product || '').localeCompare(String(b.product || ''), 'fr'))
    .map((p) => ({ value: p.id, label: p.product || p.code || '—' }))
}

export function nomProduitFiltre(valeur, catalogue) {
  if (!valeur) return ''
  if (valeur === NON_RECONNU) return 'Produit non reconnu'
  return (catalogue || []).find((p) => p.id === valeur)?.product || 'Produit'
}

// Applique le filtre à une requête PostgREST sur commandes.
export function filtrerParProduit(q, valeur, catalogue) {
  if (!valeur) return q
  if (valeur !== NON_RECONNU) return q.eq('produit_id', valeur)
  const ids = (catalogue || []).map((p) => p.id).filter(Boolean)
  // Aucun produit visible : toutes les commandes sont « non reconnues ».
  if (ids.length === 0) return q
  return q.or(`produit_id.is.null,produit_id.not.in.(${ids.join(',')})`)
}
