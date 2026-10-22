// Le verdict PRODUIT de l'import CSV, et la rupture de stock affichée sur
// les commandes (22/10). L'API (import-commande) n'est pas concernée.
//
// UN SEUL REFUS : le produit n'est pas au catalogue — on ne sait pas quoi
// expédier, la ligne n'entre pas. Même famille : la cellule vide, deux
// produits sur une ligne, deux produits du catalogue au même nom. Dans les
// quatre cas, personne ne peut dire quel article part.
//
// LE STOCK NE REFUSE JAMAIS. Produit au catalogue sans stock (pas de ligne,
// ou une quantité ≤ 0) dans l'entrepôt de la commande : la ligne entre, et
// l'aperçu le dit dans la couleur d'avertissement. Le blocage, s'il y en a
// un, se fait à la confirmation, sur le stock de ce moment-là — pas sur une
// photo prise à l'import.
//
// UNE fonction pour le vendeur et le responsable, donc un seul verdict. Le
// stock est lu par la porte produits_en_stock (SECURITY DEFINER,
// entrepot_commande.sql §8) : pour un pays et une liste de produits, ceux
// qui ont une quantité disponible > 0 dans l'entrepôt de ce pays. Un
// booléen par produit, aucune quantité, aucun nom d'entrepôt.
//
// Même lecture du produit que la base (produit_de_commande) : par code, puis
// par nom sans accents ni espaces en trop.
import { sansAccents } from '../supabase/functions/_shared/pays.ts'

const pluriel = (n) => `${n} ligne${n > 1 ? 's' : ''}`

// Le produit du catalogue que désigne ce texte : { produit } ou { cas }.
export function produitDuCatalogue(texte, catalogue) {
  const t = String(texte ?? '').trim()
  if (!t) return { cas: 'vide' }
  const parCode = catalogue.find((p) => p.code && String(p.code).trim().toLowerCase() === t.toLowerCase())
  if (parCode) return { produit: parCode }
  const memes = catalogue.filter((p) => sansAccents(p.product) === sansAccents(t))
  if (memes.length === 1) return { produit: memes[0] }
  if (memes.length > 1) return { cas: 'ambigu' }
  // fusionnerProduits (page Commandes) réunit « A|B » en « A + B ».
  if (t.includes(' + ')) return { cas: 'plusieurs' }
  return { cas: 'inconnu' }
}

// produits    : [{ produit, lignes }] — le produit tel que l'import l'écrira
//               ('' quand la cellule est vide), et son nombre de lignes
// catalogue   : [{ id, code, product }] — les produits de l'entreprise
// paysId      : le pays choisi (celui de l'entrepôt, pour un responsable)
// nomEntrepot : le nom affiché (un entrepôt porte le nom de son pays)
// enStock(paysId, ids) → Promise<uuid[]> — rpc('produits_en_stock') ; peut lever
// Rend [{ produit, lignes, ok, cas, message }], dans l'ordre reçu :
//   ok = false → la ligne est refusée (catalogue) ;
//   cas = 'rupture' → la ligne entre, avec un avertissement ;
//   cas = 'stock_non_verifie' → la lecture du stock a échoué : la ligne
//     entre quand même (le stock ne refuse jamais), et l'écran le dit.
export async function verdictProduits({ produits, catalogue, paysId, nomEntrepot, enStock }) {
  const trouves = produits.map((p) => ({ ...p, r: produitDuCatalogue(p.produit, catalogue) }))
  const ids = [...new Set(trouves.filter((t) => t.r.produit).map((t) => t.r.produit.id))]
  let disponibles = null
  try {
    disponibles = new Set(ids.length ? (await enStock(paysId, ids)) || [] : [])
  } catch {
    disponibles = null
  }

  return trouves.map(({ produit, lignes, r }) => {
    const nom = `« ${produit} » (${pluriel(lignes)})`
    if (!r.produit) {
      const message = {
        vide: `${pluriel(lignes)} sans produit — indiquez le code du produit, puis réimportez.`,
        ambigu: `${nom} : plusieurs produits du catalogue portent ce nom — écrivez son code, puis réimportez.`,
        plusieurs: `${nom} : plusieurs produits sur une ligne — une ligne par produit, puis réimportez.`,
        inconnu: `${nom} : absent du catalogue — ajoutez le produit, puis réimportez.`,
      }[r.cas]
      return { produit, lignes, ok: false, cas: r.cas, message }
    }
    if (disponibles === null) {
      return { produit, lignes, ok: true, cas: 'stock_non_verifie', message: null }
    }
    if (!disponibles.has(r.produit.id)) {
      return { produit, lignes, ok: true, cas: 'rupture',
        message: `${nom} : rupture de stock dans l'entrepôt ${nomEntrepot}.` }
    }
    return { produit, lignes, ok: true, cas: 'ok', message: null }
  })
}

// La rupture de stock des commandes affichées, lue MAINTENANT (pas un
// drapeau écrit à l'import : le stock bouge entre l'import et l'appel).
// commandes : [{ id, produit, pays_id }] — seulement celles à surveiller
// Rend un Set des id de commandes en rupture. Un appel par pays.
export async function commandesEnRupture({ commandes, catalogue, enStock }) {
  const parPays = new Map()
  for (const c of commandes) {
    const r = produitDuCatalogue(c.produit, catalogue)
    if (!r.produit || !c.pays_id) continue   // produit inconnu : la note de la base le dit
    if (!parPays.has(c.pays_id)) parPays.set(c.pays_id, [])
    parPays.get(c.pays_id).push({ id: c.id, produit: r.produit.id })
  }
  const rupture = new Set()
  for (const [pays, lignes] of parPays) {
    const dispo = new Set((await enStock(pays, [...new Set(lignes.map((l) => l.produit))])) || [])
    for (const l of lignes) if (!dispo.has(l.produit)) rupture.add(l.id)
  }
  return rupture
}
