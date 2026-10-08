// Les règles d'entrée d'un lead, UNE SEULE FOIS.
//
// Deux portes mènent ici et ne doivent jamais diverger :
//   import-commande  — HTTP : boutique, landing page, Zapier, formulaire
//   sync-sheets      — cron : les feuilles Google qu'on va lire nous-mêmes
//
// `sync-sheets` appelle ces fonctions DIRECTEMENT, il ne repasse pas par HTTP :
// même serveur, ré-authentifier et refaire un aller-retour réseau ne coûterait
// que du temps.

// `import type` et non `import` : le client n'est utilisé que comme type.
// Deno comme Node savent alors retirer complètement cette ligne, ce qui rend
// ce fichier testable hors Deno — sans quoi l'URL esm.sh bloquerait le test.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ------------------------------------------------------------------
// Outils
// ------------------------------------------------------------------

export async function sha256Hex(texte: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// "Téléphone ", "PHONE", "phone_number" désignent la même colonne. Un tableur
// rempli par un vendeur ne respecte aucune convention : on ramène donc chaque
// en-tête à une forme unique avant de chercher ce qu'elle veut dire.
function cleNormalisee(cle: string): string {
  return String(cle)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Les noms acceptés pour chaque champ. Le premier qui répond gagne.
const ALIAS: Record<string, string[]> = {
  lead_id:          ['lead_id', 'leadid', 'id', 'numero_commande', 'order_id', 'reference', 'ref'],
  client_nom:       ['client_nom', 'nom', 'name', 'customer_name', 'full_name', 'nom_client', 'client'],
  client_telephone: ['client_telephone', 'telephone', 'tel', 'phone', 'phone_number', 'numero', 'gsm', 'mobile'],
  pays:             ['pays', 'country', 'pays_nom', 'pays_code', 'country_code'],
  ville_zone:       ['ville_zone', 'ville', 'city', 'zone', 'region'],
  adresse:          ['adresse', 'address', 'addresse', 'rue'],
  produit:          ['produit', 'product', 'article', 'item', 'offre'],
  quantite:         ['quantite', 'quantity', 'qty', 'qte', 'nombre'],
  prix:             ['prix', 'price', 'montant', 'total', 'amount', 'cod'],
  vendeur:          ['vendeur', 'seller', 'vendeur_email', 'seller_email', 'vendor'],
  notes:            ['notes', 'note', 'remarque', 'remarques', 'commentaire'],
  commentaire_1:    ['commentaire_1', 'commentaire1', 'comment', 'comment_1'],
  commentaire_2:    ['commentaire_2', 'commentaire2', 'comment_2'],
  source_url:       ['source_url', 'url', 'page', 'landing', 'lien'],
  source_sheet:     ['source_sheet', 'feuille', 'sheet'],
}

export type Brut = Record<string, unknown>

// Le lead tel qu'on sait le lire, quelles qu'aient été les colonnes d'origine.
export interface LeadNormalise {
  lead_id?: string
  client_nom?: string
  client_telephone?: string
  pays?: string
  pays_id?: string
  ville_zone?: string
  adresse?: string
  produit?: string
  quantite?: number
  prix?: number
  vendeur?: string
  notes?: string
  commentaire_1?: string
  commentaire_2?: string
  source_url?: string
  source_sheet?: string
}

export function normaliser(brut: Brut, mapping: Record<string, string> = {}): LeadNormalise {
  // Index insensible à la casse et à la ponctuation des en-têtes reçues.
  const index = new Map<string, unknown>()
  for (const [k, v] of Object.entries(brut ?? {})) index.set(cleNormalisee(k), v)

  const lire = (champ: string): string | undefined => {
    // Un mapping explicite (configuré sur la source) passe avant les alias :
    // c'est le seul moyen de gérer une colonne nommée "Numéro WhatsApp client".
    const force = mapping[champ]
    if (force) {
      const v = index.get(cleNormalisee(force))
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
    for (const a of ALIAS[champ] ?? []) {
      const v = index.get(a)
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
    return undefined
  }

  const nombre = (champ: string): number | undefined => {
    const t = lire(champ)
    if (t === undefined) return undefined
    // "1 250,50 DH" → 1250.50. Les tableurs produisent de tout.
    const n = parseFloat(t.replace(/[^\d.,-]/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }

  const lead: LeadNormalise = {}
  for (const champ of ['lead_id', 'client_nom', 'client_telephone', 'pays', 'ville_zone',
                       'adresse', 'produit', 'vendeur', 'notes', 'commentaire_1',
                       'commentaire_2', 'source_url', 'source_sheet']) {
    const v = lire(champ)
    if (v !== undefined) (lead as Record<string, unknown>)[champ] = v
  }
  const q = nombre('quantite'); if (q !== undefined) lead.quantite = q
  const p = nombre('prix');     if (p !== undefined) lead.prix = p

  // `pays_id` ne peut venir que d'un appel machine, jamais d'un tableur.
  const paysId = brut?.['pays_id']
  if (typeof paysId === 'string' && paysId.trim() !== '') lead.pays_id = paysId.trim()

  return lead
}

// La clé qui décide « déjà vu ou pas ».
//
// Si la source fournit un identifiant, c'est lui. Sinon on en fabrique un
// STABLE à partir du téléphone, du produit et du jour. Avant, on tirait un
// identifiant au hasard : un simple ré-essai (timeout réseau, retry d'une
// boutique) créait donc un doublon à coup sûr.
//
// Contrepartie assumée : le même client, le même produit, le même jour est
// traité comme un doublon. En COD c'est presque toujours un double envoi du
// formulaire ; et un doublon qu'on fusionne coûte moins cher qu'un client
// appelé deux fois.
export async function cleExterne(tenantId: string, lead: LeadNormalise): Promise<string> {
  if (lead.lead_id) return lead.lead_id
  const jour = new Date().toISOString().slice(0, 10)
  const empreinte = await sha256Hex(
    [tenantId, lead.client_telephone ?? '', (lead.produit ?? '').toLowerCase(), jour].join('|'),
  )
  return `AUTO-${empreinte.slice(0, 12).toUpperCase()}`
}

// ------------------------------------------------------------------
// Le contexte d'un import
// ------------------------------------------------------------------

export interface ContexteImport {
  tenantId: string
  sourceId: string | null
  // Le vendeur attaché à la source. Une colonne « vendeur » dans la ligne peut
  // le remplacer, mais seulement par un vendeur de la MÊME entreprise.
  vendeurParDefaut: string | null
  origine: string
  mapping?: Record<string, string>
}

// Chargé une fois par lot : 200 lignes ne doivent pas déclencher 400 requêtes.
interface Cache {
  pays?: { id: string; nom: string | null; code: string | null }[]
  sellers?: { user_id: string; email: string | null; nom: string | null }[]
}

export interface ResultatLigne {
  statut: 'importe' | 'doublon' | 'rejete'
  lead_id?: string
  agent_trouve?: boolean
  motif?: string
}

async function chargerCache(sb: SupabaseClient, tenantId: string, cache: Cache) {
  if (!cache.pays) {
    const { data } = await sb.from('pays').select('id, nom, code').eq('tenant_id', tenantId)
    cache.pays = data ?? []
  }
  if (!cache.sellers) {
    const { data } = await sb.from('user_roles').select('user_id, email, nom')
      .eq('tenant_id', tenantId).eq('role', 'seller')
    cache.sellers = data ?? []
  }
}

// ------------------------------------------------------------------
// Importer UNE ligne
// ------------------------------------------------------------------

export async function importerLigne(
  sb: SupabaseClient,
  ctx: ContexteImport,
  brut: Brut,
  cache: Cache = {},
): Promise<ResultatLigne> {
  await chargerCache(sb, ctx.tenantId, cache)
  const lead = normaliser(brut, ctx.mapping ?? {})
  const cle = await cleExterne(ctx.tenantId, lead)

  // Le lead est écrit AVANT d'être jugé. S'il est refusé, il reste consultable
  // et rejouable : en COD, un lead perdu est une commande perdue.
  const { data: journal } = await sb.from('imports_bruts').insert({
    tenant_id: ctx.tenantId,
    source_id: ctx.sourceId,
    payload: brut as Record<string, unknown>,
    statut: 'recu',
    cle_externe: cle,
  }).select('id').single()

  const conclure = async (r: ResultatLigne, commandeId?: string): Promise<ResultatLigne> => {
    if (journal?.id) {
      await sb.from('imports_bruts').update({
        statut: r.statut, motif: r.motif ?? null, commande_id: commandeId ?? null,
      }).eq('id', journal.id)
    }
    return r
  }

  if (!lead.client_telephone) {
    return conclure({ statut: 'rejete', motif: 'Téléphone manquant' })
  }

  // --- le pays décide quel agent reçoit le lead : il doit être juste --------
  let paysId = lead.pays_id
  const liste = cache.pays ?? []
  if (paysId) {
    if (!liste.some((p) => p.id === paysId)) {
      return conclure({ statut: 'rejete', motif: 'Ce pays n\'appartient pas à cette entreprise' })
    }
  } else if (lead.pays) {
    const cherche = lead.pays.toLowerCase().trim()
    const trouve = liste.find((p) =>
      String(p.nom ?? '').trim().toLowerCase() === cherche ||
      String(p.code ?? '').trim().toLowerCase() === cherche
    )
    if (!trouve) {
      return conclure({
        statut: 'rejete',
        motif: `Pays "${lead.pays}" introuvable. Disponibles : ${liste.map((p) => p.nom).join(', ')}`,
      })
    }
    paysId = trouve.id
  } else if (liste.length === 1) {
    paysId = liste[0].id
  } else {
    return conclure({ statut: 'rejete', motif: 'Pays requis : l\'entreprise en a plusieurs' })
  }

  // --- à quel vendeur appartient ce lead ------------------------------------
  let vendeurId: string | null = ctx.vendeurParDefaut
  if (lead.vendeur) {
    const cherche = lead.vendeur.toLowerCase().trim()
    // Uniquement parmi les sellers de CETTE entreprise : une source ne peut
    // pas offrir un lead au compte de quelqu'un d'autre.
    const trouve = (cache.sellers ?? []).find((v) =>
      String(v.email ?? '').trim().toLowerCase() === cherche ||
      String(v.nom ?? '').trim().toLowerCase() === cherche
    )
    if (!trouve) {
      return conclure({ statut: 'rejete', motif: `Vendeur "${lead.vendeur}" introuvable dans cette entreprise` })
    }
    vendeurId = trouve.user_id
  }

  // --- déjà vu ? -------------------------------------------------------------
  const { data: existant } = await sb.from('commandes')
    .select('id').eq('lead_id', cle).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (existant) {
    return conclure({ statut: 'doublon', lead_id: cle }, existant.id)
  }

  const { data: commande, error } = await sb.from('commandes').insert({
    lead_id: cle,
    client_nom: lead.client_nom ?? null,
    client_telephone: lead.client_telephone,
    produit: lead.produit ?? null,
    pays_id: paysId,
    ville_zone: lead.ville_zone ?? null,
    source_url: lead.source_url ?? null,
    // null = « à traiter » : c'est sur null que filtre le centre d'appel.
    statut_confirmation: null,
    notes: lead.notes ?? null,
    commentaire_1: lead.commentaire_1 ?? null,
    commentaire_2: lead.commentaire_2 ?? null,
    quantite: Math.max(1, Math.round(lead.quantite ?? 1)),
    prix: Math.max(0, lead.prix ?? 0),
    source_sheet: lead.source_sheet ?? null,
    source: ctx.origine,
    source_id: ctx.sourceId,
    vendeur_id: vendeurId,
    tenant_id: ctx.tenantId,
  }).select('id, lead_id, agent_id').single()

  if (error) return conclure({ statut: 'rejete', motif: error.message })

  await sb.from('appels').insert({
    commande_id: commande.id, statut: 'en_attente', tenant_id: ctx.tenantId,
  })

  return conclure(
    { statut: 'importe', lead_id: commande.lead_id, agent_trouve: commande.agent_id !== null },
    commande.id,
  )
}

// ------------------------------------------------------------------
// Importer un LOT
// ------------------------------------------------------------------

export interface ResultatLot {
  total: number
  importes: number
  doublons: number
  rejetes: number
  resultats: ResultatLigne[]
}

export const MAX_LOT = 200

export async function importerLot(
  sb: SupabaseClient,
  ctx: ContexteImport,
  lignes: Brut[],
): Promise<ResultatLot> {
  // Le cache est partagé par tout le lot : pays et vendeurs chargés une fois.
  const cache: Cache = {}
  const resultats: ResultatLigne[] = []

  // Séquentiel, volontairement. En parallèle, deux lignes portant la même clé
  // passeraient toutes les deux le test « déjà vu ? » avant que l'une ait fini
  // d'insérer — et on créerait le doublon qu'on cherche à éviter.
  for (const ligne of lignes) {
    try {
      resultats.push(await importerLigne(sb, ctx, ligne, cache))
    } catch (e) {
      // Une ligne qui explose ne doit pas emporter les 199 autres.
      resultats.push({ statut: 'rejete', motif: (e as Error)?.message || 'Erreur inattendue' })
    }
  }

  return {
    total: resultats.length,
    importes: resultats.filter((r) => r.statut === 'importe').length,
    doublons: resultats.filter((r) => r.statut === 'doublon').length,
    rejetes: resultats.filter((r) => r.statut === 'rejete').length,
    resultats,
  }
}

// ------------------------------------------------------------------
// Retrouver une source à partir de son jeton
// ------------------------------------------------------------------

export interface Source {
  id: string
  tenant_id: string
  vendeur_id: string | null
  nom: string
  type: string
  mapping: Record<string, string> | null
}

// Le jeton en clair n'existe nulle part en base : on compare les empreintes.
// `actif` est dans la requête — couper une source doit la couper tout de suite.
export async function sourceDepuisJeton(sb: SupabaseClient, jeton: string): Promise<Source | null> {
  if (!jeton || jeton.length < 16) return null
  const empreinte = await sha256Hex(jeton)
  const { data } = await sb.from('sources_import')
    .select('id, tenant_id, vendeur_id, nom, type, mapping')
    .eq('token_hash', empreinte).eq('actif', true).maybeSingle()
  if (!data) return null

  // Une entreprise suspendue n'accepte plus rien, même avec un jeton valide.
  const { data: t } = await sb.from('tenants').select('statut').eq('id', data.tenant_id).maybeSingle()
  if (!t || t.statut !== 'actif') return null

  return data as Source
}