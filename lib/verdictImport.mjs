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
// par nom — les DEUX sans accents, sans casse, sans espaces autour ni en
// trop (un code collé depuis un tableur traîne souvent un espace).
//
// Un produit trouvé par son NOM plutôt que par son code entre quand même,
// avec un avertissement qui donne le code : c'est ainsi que les vendeurs
// apprennent à écrire le code, que l'orthographe ne peut pas trahir.
import { sansAccents } from '../supabase/functions/_shared/pays.ts'

const pluriel = (n) => `${n} ligne${n > 1 ? 's' : ''}`

// Le produit du catalogue que désigne ce texte : { produit, par } ou { cas }.
// par = 'code' | 'nom'.
export function produitDuCatalogue(texte, catalogue) {
  const t = String(texte ?? '').trim()
  if (!t) return { cas: 'vide' }
  const cle = sansAccents(t)
  // L'index unique compare lower(btrim(code)) : « Café » et « Cafe » peuvent
  // coexister, et sans accents ils se confondent. Deux réponses : aucune.
  const parCode = catalogue.filter((p) => p.code && String(p.code).trim() !== '' && sansAccents(p.code) === cle)
  if (parCode.length === 1) return { produit: parCode[0], par: 'code' }
  if (parCode.length > 1) return { cas: 'ambigu' }
  const memes = catalogue.filter((p) => sansAccents(p.product) === cle)
  if (memes.length === 1) return { produit: memes[0], par: 'nom' }
  if (memes.length > 1) return { cas: 'ambigu' }
  // fusionnerProduits (page Commandes) réunit « A|B » en « A + B ».
  if (t.includes(' + ')) return { cas: 'plusieurs' }
  return { cas: 'inconnu' }
}

// produits    : [{ produit, lignes }] — le produit tel que l'import l'écrira
//               ('' quand la cellule est vide), et son nombre de lignes
// catalogue   : [{ id, code, product }] — ce que la RLS rend : toute
//               l'entreprise pour un responsable, SES produits pour un vendeur
// duVendeur   : true quand c'est le catalogue d'un vendeur (26/10). Le refus
//               est le même — ce n'est pas son produit —, mais le message
//               doit être vrai : « pas dans votre catalogue », pas « absent du
//               catalogue », qui l'enverrait chercher un produit qui existe
//               chez un autre vendeur.
// paysId      : le pays choisi (celui de l'entrepôt, pour un responsable)
// nomEntrepot : le nom affiché (un entrepôt porte le nom de son pays)
// enStock(paysId, ids) → Promise<uuid[]> — rpc('produits_en_stock') ; peut lever
// Rend [{ produit, lignes, ok, cas, message, avisNom }], dans l'ordre reçu :
//   ok = false → la ligne est refusée (catalogue) ;
//   cas = 'rupture' → la ligne entre, avec un avertissement ;
//   cas = 'stock_non_verifie' → la lecture du stock a échoué : la ligne
//     entre quand même (le stock ne refuse jamais), et l'écran le dit ;
//   avisNom (indépendant de cas) → trouvé par le nom, pas par le code :
//     avertissement, jamais un refus.
export async function verdictProduits({ produits, catalogue, paysId, nomEntrepot, enStock, duVendeur = false }) {
  const trouves = produits.map((p) => ({ ...p, r: produitDuCatalogue(p.produit, catalogue) }))
  const ids = [...new Set(trouves.filter((t) => t.r.produit).map((t) => t.r.produit.id))]
  let disponibles = null
  try {
    disponibles = new Set(ids.length ? (await enStock(paysId, ids)) || [] : [])
  } catch {
    disponibles = null
  }

  const avis = (produit, r) => r.par !== 'nom' ? null
    : (r.produit.code && String(r.produit.code).trim()
      ? `« ${produit} » : reconnu par son nom. Utilisez le code ${String(r.produit.code).trim()} pour éviter les erreurs d'orthographe.`
      : `« ${produit} » : reconnu par son nom. Ce produit n'a pas de code : ajoutez-en un dans Produits.`)

  return trouves.map(({ produit, lignes, r }) => {
    const nom = `« ${produit} » (${pluriel(lignes)})`
    if (!r.produit) {
      const message = {
        vide: `${pluriel(lignes)} sans produit — indiquez le code du produit, puis réimportez.`,
        ambigu: duVendeur
          ? `${nom} : plusieurs produits de votre catalogue portent ce nom — écrivez son code, puis réimportez.`
          : `${nom} : plusieurs produits du catalogue portent ce nom — écrivez son code, puis réimportez.`,
        plusieurs: `${nom} : plusieurs produits sur une ligne — une ligne par produit, puis réimportez.`,
        inconnu: duVendeur
          ? `${nom} : ce produit n'est pas dans votre catalogue — vérifiez le code ; si c'est un nouveau produit, créez-le dans Produits, puis réimportez.`
          : `${nom} : absent du catalogue — ajoutez le produit, puis réimportez.`,
      }[r.cas]
      return { produit, lignes, ok: false, cas: r.cas, message }
    }
    const avisNom = avis(produit, r)
    if (disponibles === null) {
      return { produit, lignes, ok: true, cas: 'stock_non_verifie', message: null, avisNom }
    }
    if (!disponibles.has(r.produit.id)) {
      return { produit, lignes, ok: true, cas: 'rupture',
        message: `${nom} : rupture de stock dans l'entrepôt ${nomEntrepot}.`, avisNom }
    }
    return { produit, lignes, ok: true, cas: 'ok', message: null, avisNom }
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
