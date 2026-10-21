// Le pays d'un lead, UNE SEULE FOIS — pour import-commande (Deno) ET pour
// l'import de fichier de l'écran Commandes (navigateur). Sans dépendance ni
// import, pour que les deux puissent le charger tel quel (Next compile le
// TypeScript importé par la page) : deux copies de cette règle finiraient par
// diverger.
//
// ORDRE :
//   1. le pays écrit dans le lead (pays_id d'un appel machine, ou nom / code
//      ISO2 sans accents ni casse) — et un pays écrit mais inconnu est un
//      refus, pas un repli : la source a dit quelque chose, on ne le remplace
//      pas en silence ;
//   2. le pays par défaut : celui de la SOURCE pour l'API
//      (sources_import.pays_defaut), celui choisi à l'écran pour un fichier ;
//   3. sinon, refus « pays manquant ».
//
// Jamais d'adresse : le pays ne se lit pas dans un texte libre (« Rua Angola
// 12, Pointe-Noire » est au Congo). Jamais « le seul pays de l'entreprise » :
// ce défaut-là casse le jour où on en ajoute un.

// "Crème  Éclat " → "creme eclat".
export function sansAccents(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}

export const MOTIF_PAYS_MANQUANT =
  'Pays manquant : envoyez le champ pays, ou fixez le pays par défaut de la source sur « Mon API »'

export interface PaysLigne {
  id: string
  nom: string | null
  code: string | null
}

export type PaysResolu =
  | { pays_id: string; motif?: undefined }
  | { pays_id?: undefined; motif: string }

// liste  : les pays de l'entreprise [{ id, nom, code }]
// paysId : un pays_id déjà donné (appel machine)
// textes : ce que le lead écrit — [pays, pays_code]
// defaut : le pays par défaut (source ou écran), ou null
// manquant : le motif quand rien ne répond (l'écran a le sien)
// → { pays_id } ou { motif }
export function resoudrePays({ liste, paysId = null, textes = [], defaut = null, manquant = MOTIF_PAYS_MANQUANT }: {
  liste: PaysLigne[] | null | undefined
  paysId?: string | null
  textes?: (string | null | undefined)[]
  defaut?: string | null
  manquant?: string
}): PaysResolu {
  const pays = liste ?? []
  if (paysId) {
    return pays.some((p) => p.id === paysId)
      ? { pays_id: paysId }
      : { motif: 'Ce pays n\'appartient pas à cette entreprise' }
  }

  const ecrits = textes.filter((t) => String(t ?? '').trim() !== '')
  if (ecrits.length > 0) {
    // Sans accents : Shopify écrit "Senegal", le CRM "Sénégal". Puis le code
    // ISO2 si la source l'envoie aussi (country_code).
    const cherche = ecrits.map((t) => sansAccents(t))
    const trouve = cherche.map((c) => pays.find((p) =>
      sansAccents(p.nom) === c || sansAccents(p.code) === c
    )).find(Boolean)
    if (!trouve) {
      return { motif: `Pays "${ecrits[0]}" introuvable. Disponibles : ${pays.map((p) => p.nom).join(', ')}` }
    }
    return { pays_id: trouve.id }
  }

  // Un défaut qui n'est plus un pays de l'entreprise ne vaut rien.
  if (defaut && pays.some((p) => p.id === defaut)) return { pays_id: defaut }
  return { motif: manquant }
}

// L'aperçu d'un fichier, AVANT tout import : chaque valeur distincte de la
// colonne Country, combien de lignes la portent, et le pays qu'elle désigne
// — ou aucun. Un pays mal écrit se voit ici une fois, au lieu de faire
// refuser trois cents lignes après coup. Même règle que resoudrePays : les
// pays de l'entreprise seulement, nom ou code, sans accents ni casse.
export interface ValeurPays {
  valeur: string
  lignes: number
  pays_id: string | null
  pays_nom: string | null
}

export function analyserColonnePays(
  valeurs: unknown[], liste: PaysLigne[] | null | undefined,
): { valeurs: ValeurPays[]; inconnues: ValeurPays[]; vides: number } {
  const parValeur = new Map<string, ValeurPays>()
  let vides = 0
  for (const v of valeurs) {
    const texte = String(v ?? '').trim()
    if (texte === '') { vides++; continue }
    let e = parValeur.get(texte)
    if (!e) {
      const r = resoudrePays({ liste, textes: [texte] })
      const p = r.pays_id ? (liste ?? []).find((x) => x.id === r.pays_id) : undefined
      e = { valeur: texte, lignes: 0, pays_id: r.pays_id ?? null, pays_nom: p?.nom ?? null }
      parValeur.set(texte, e)
    }
    e.lignes++
  }
  const toutes = [...parValeur.values()].sort((a, b) => b.lignes - a.lignes)
  return { valeurs: toutes, inconnues: toutes.filter((x) => !x.pays_id), vides }
}
