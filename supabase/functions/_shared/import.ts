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
//
// Les noms ajoutés pour les boutiques (address_1, total_price, customer_note…)
// sont en FIN de liste : un payload plat qui répondait déjà à un nom plus haut
// répond exactement comme avant.
const ALIAS: Record<string, string[]> = {
  lead_id:          ['lead_id', 'leadid', 'id', 'numero_commande', 'order_id', 'reference', 'ref'],
  client_nom:       ['client_nom', 'nom', 'name', 'customer_name', 'full_name', 'nom_client', 'client'],
  client_telephone: ['client_telephone', 'telephone', 'tel', 'phone', 'phone_number', 'numero', 'gsm', 'mobile'],
  pays:             ['pays', 'country', 'pays_nom', 'pays_code', 'country_code'],
  // Deuxième chance pour le pays : Shopify envoie "Senegal" ET "SN".
  pays_code:        ['pays_code', 'country_code'],
  ville_zone:       ['ville_zone', 'ville', 'city', 'zone', 'region'],
  adresse:          ['adresse', 'address', 'addresse', 'rue', 'address_1', 'address1'],
  produit:          ['produit', 'product', 'article', 'item', 'offre'],
  // Le code produit — voir resoudreArticles() pour l'ordre de résolution.
  code:             ['code', 'sku', 'code_produit', 'product_code'],
  quantite:         ['quantite', 'quantity', 'qty', 'qte', 'nombre'],
  prix:             ['prix', 'price', 'montant', 'total', 'amount', 'cod', 'total_price'],
  vendeur:          ['vendeur', 'seller', 'vendeur_email', 'seller_email', 'vendor'],
  notes:            ['notes', 'note', 'remarque', 'remarques', 'commentaire', 'customer_note'],
  commentaire_1:    ['commentaire_1', 'commentaire1', 'comment', 'comment_1'],
  commentaire_2:    ['commentaire_2', 'commentaire2', 'comment_2'],
  source_url:       ['source_url', 'url', 'page', 'landing', 'lien'],
  source_sheet:     ['source_sheet', 'feuille', 'sheet'],
}

// Les champs qui décrivent l'ACHETEUR. Dans une commande imbriquée ils vivent
// dans billing / shipping / customer ; les autres décrivent la COMMANDE et
// vivent à la racine.
const CHAMPS_CONTACT = new Set(['client_nom', 'client_telephone', 'pays', 'pays_code', 'ville_zone', 'adresse'])

// WooCommerce n'a pas de « nom complet » : prénom + nom.
const ALIAS_PRENOM = ['first_name', 'firstname', 'prenom']
const ALIAS_NOM_FAMILLE = ['last_name', 'lastname', 'nom_de_famille', 'surname']

// La liste des articles d'une commande, et ce qu'on lit dans chaque article.
const CLES_ARTICLES = ['articles', 'line_items', 'items', 'order_items', 'products', 'produits',
                       'lignes', 'cart_items', 'cart']
const ALIAS_ARTICLE: Record<string, string[]> = {
  produit:  ['produit', 'product', 'product_name', 'title', 'name', 'article', 'item', 'nom'],
  quantite: ['quantite', 'quantity', 'qty', 'qte', 'nombre'],
  prix:     ['prix', 'price', 'unit_price', 'prix_unitaire'],
  // Tous sont essayés, dans cet ordre : un code qui ne répond pas laisse sa
  // chance au suivant (Shopify : sku vide, product_id rempli).
  code:     ['code', 'sku', 'code_produit', 'product_code', 'reference', 'ref', 'product_id', 'variant_id'],
}

export type Brut = Record<string, unknown>

// Un article tel que la source l'a écrit, avant de le chercher au catalogue.
export interface ArticleLu {
  produit?: string
  quantite: number
  prix: number | null
  codes: string[]
}

// Un article tel qu'il est rangé dans commandes.articles.
export interface Article {
  produit: string
  quantite: number
  // Le prix UNITAIRE tel que la source l'a écrit, null si elle ne l'a pas
  // écrit. Il n'est jamais calculé : le prix de la commande est `prix`.
  prix: number | null
  code: string | null
}

// Le lead tel qu'on sait le lire, quelles qu'aient été les colonnes d'origine.
export interface LeadNormalise {
  lead_id?: string
  client_nom?: string
  client_telephone?: string
  pays?: string
  pays_code?: string
  pays_id?: string
  ville_zone?: string
  adresse?: string
  produit?: string
  code?: string
  quantite?: number
  prix?: number
  vendeur?: string
  notes?: string
  commentaire_1?: string
  commentaire_2?: string
  source_url?: string
  source_sheet?: string
  articles?: ArticleLu[]
}

// ------------------------------------------------------------------
// Aplatir n'importe quel payload imbriqué
// ------------------------------------------------------------------
//
// Chaque webhook de boutique est imbriqué ({ billing: { phone } }) ; la table
// ALIAS, elle, connaît des noms plats. Plutôt qu'un lecteur par boutique, on
// aplatit une fois et chaque valeur devient trouvable de deux façons :
//
//   billing.first_name    → chemin 'billing_first_name'   et feuille 'first_name'
//   line_items[0].name    → chemin 'line_items_0_name'    et feuille 'name'
//
// Le chemin sert au mapping de la source (« customer.mobile »). La feuille
// fait marcher ALIAS sur du JSON imbriqué sans inventer de nouveaux noms.
//
// QUAND DEUX FEUILLES PORTENT LE MÊME NOM (billing.phone et shipping.phone) :
//
//   1. Un champ de l'ACHETEUR (nom, téléphone, pays, ville, adresse) se lit
//      d'abord dans les blocs acheteur : billing > shipping > customer, puis
//      le moins profond. C'est billing que le client a rempli pour être joint.
//   2. Un champ de la COMMANDE (lead_id, prix, quantité…) se lit hors des blocs
//      acheteur, du moins profond au plus profond : `id` à la racine est la
//      commande, `customer.id` est le client — le prendre pour lead_id ferait
//      de chaque nouvelle commande d'un client fidèle un « doublon ».
//   3. Un champ de l'acheteur absent des blocs acheteur suit la règle 2.
//   4. Une feuille DANS UNE LISTE (line_items[0].vendor) décrit un article, pas
//      la commande : ALIAS ne la lit jamais. Les articles sont lus à part
//      (lireArticle), et le mapping peut toujours la viser par son chemin.
//   5. Même nom, même profondeur, même bloc : la DERNIÈRE gagne. C'est la
//      règle de l'index plat d'avant (« Téléphone » puis « telephone ») — un
//      payload plat lit donc exactement les mêmes valeurs qu'hier.
//
// NE PAS « SIMPLIFIER » EN « LE MOINS PROFOND GAGNE PARTOUT ». C'était la
// première idée, et elle casse sur Shopify : `name` à la racine vaut "#1001"
// (le numéro de commande) — il serait devenu le nom du client, sur chaque
// commande, sans aucune erreur nulle part. `billing_address.name` est le bon.
// De même `customer.id` serait devenu lead_id, et chaque commande suivante du
// même client un « doublon » perdu. Les règles 1 et 2 existent pour ces deux
// cas ; test_import_generique.mjs (§2 et §6) échoue si on les retire.

const estObjet = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

// { "data": { … } }, { "payload": { "order": { … } } } : une enveloppe à clé
// unique qui contient un objet est ouverte, autant de fois qu'il faut.
// `prefixe` garde les clés retirées pour qu'un mapping écrit avec
// ("data.customer.mobile") marche aussi bien que sans ("customer.mobile").
// Un bloc acheteur seul ({ "customer": { … } }) n'est PAS une enveloppe : ouvert,
// son `id` deviendrait le lead_id, et chaque commande suivante de ce client un
// « doublon ».
export function deballer(corps: unknown): { racine: unknown; prefixe: string } {
  let racine = corps
  const retire: string[] = []
  while (estObjet(racine)) {
    const cles = Object.keys(racine)
    if (cles.length !== 1 || !estObjet(racine[cles[0]])) break
    if (rangContact(cleNormalisee(cles[0])) < 9) break
    retire.push(cleNormalisee(cles[0]))
    racine = racine[cles[0]]
  }
  return { racine, prefixe: retire.join('_') }
}

function rangContact(segment: string): number {
  if (segment.startsWith('billing')) return 0
  if (segment.startsWith('shipping')) return 1
  if (segment.startsWith('customer')) return 2
  return 9
}

interface Feuille {
  valeur: unknown
  profondeur: number // 1 = à la racine
  rang: number       // 0 billing, 1 shipping, 2 customer, 9 hors bloc acheteur
  dansListe: boolean
}

interface Liste {
  valeur: unknown[]
  profondeur: number
  nom: string
  dansListe: boolean
}

interface Index {
  racine: unknown
  prefixe: string
  chemins: Map<string, unknown>
  feuilles: Map<string, Feuille[]>
  listes: Map<string, Liste>
}

function indexer(brut: unknown): Index {
  const { racine, prefixe } = deballer(brut)
  const chemins = new Map<string, unknown>()
  const feuilles = new Map<string, Feuille[]>()
  const listes = new Map<string, Liste>()

  const visiter = (v: unknown, chemin: string[], rang: number, dansListe: boolean) => {
    const cle = chemin.join('_')
    if (Array.isArray(v)) {
      listes.set(cle, { valeur: v, profondeur: chemin.length, nom: chemin[chemin.length - 1], dansListe })
      v.forEach((x, i) => visiter(x, [...chemin, String(i)], rang, true))
      return
    }
    if (estObjet(v)) {
      for (const [k, x] of Object.entries(v)) {
        const seg = cleNormalisee(k)
        // Le bloc acheteur est décidé par le premier ancêtre qui en est un.
        const rangEnfant = rang !== 9 || !(estObjet(x) || Array.isArray(x)) ? rang : rangContact(seg)
        visiter(x, [...chemin, seg], rangEnfant, dansListe)
      }
      return
    }
    if (chemin.length === 0) return
    chemins.set(cle, v)
    const nom = chemin[chemin.length - 1]
    if (/^\d+$/.test(nom)) return // tags[0] : une valeur de liste n'a pas de nom
    const f: Feuille = { valeur: v, profondeur: chemin.length, rang, dansListe }
    const liste = feuilles.get(nom) ?? []
    const i = liste.findIndex((x) =>
      x.profondeur === f.profondeur && x.rang === f.rang && x.dansListe === f.dansListe)
    if (i >= 0) liste[i] = f // règle 5 : la dernière gagne
    else liste.push(f)
    feuilles.set(nom, liste)
  }

  visiter(racine, [], 9, false)
  return { racine, prefixe, chemins, feuilles, listes }
}

const utile = (v: unknown): string | undefined =>
  (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).trim() !== ''
    ? String(v).trim()
    : undefined

// Règle 1 : dans les blocs acheteur, billing > shipping > customer.
function chercherBlocs(idx: Index, alias: string[]): string | undefined {
  for (const a of alias) {
    const blocs = (idx.feuilles.get(a) ?? []).filter((f) => !f.dansListe && f.rang < 9)
      .sort((x, y) => x.rang - y.rang || x.profondeur - y.profondeur)
    for (const f of blocs) { const v = utile(f.valeur); if (v !== undefined) return v }
  }
  return undefined
}

// Règles 2 et 4 : hors blocs acheteur et hors listes, profondeur par
// profondeur. À plat il n'y a que la profondeur 1 : on parcourt ALIAS dans
// l'ordre, exactement comme avant.
function chercherHorsBlocs(idx: Index, alias: string[]): string | undefined {
  const candidats = (a: string) => (idx.feuilles.get(a) ?? []).filter((f) => !f.dansListe && f.rang === 9)
  const profondeurs = [...new Set(alias.flatMap((a) => candidats(a).map((f) => f.profondeur)))]
    .sort((x, y) => x - y)
  for (const d of profondeurs) {
    for (const a of alias) {
      for (const f of candidats(a)) {
        if (f.profondeur !== d) continue
        const v = utile(f.valeur); if (v !== undefined) return v
      }
    }
  }
  return undefined
}

// Règles 1 à 4. Le nom du client a un cas de plus : WooCommerce n'envoie que
// prénom + nom. Ils passent AVANT la règle 2, sinon un `name` de racine (le
// numéro de commande chez Shopify) deviendrait le client ; et prénom + nom à
// la racine ne servent que si aucun nom n'a répondu — un payload plat qui
// répondait déjà ne change pas.
function chercher(idx: Index, alias: string[], champ: string | null): string | undefined {
  const contact = champ !== null && CHAMPS_CONTACT.has(champ)
  if (contact) {
    const v = chercherBlocs(idx, alias); if (v !== undefined) return v
    if (champ === 'client_nom') { const n = nomCompose(idx, [0, 1, 2]); if (n) return n }
  }
  const v = chercherHorsBlocs(idx, alias); if (v !== undefined) return v
  if (champ === 'client_nom') return nomCompose(idx, [9])
  return undefined
}

// Prénom + nom pris dans le MÊME bloc : jamais le prénom de billing collé au
// nom de shipping.
function nomCompose(idx: Index, rangs: number[]): string | undefined {
  const dans = (alias: string[], rang: number) => {
    for (const a of alias) {
      for (const f of (idx.feuilles.get(a) ?? []).filter((x) => !x.dansListe && x.rang === rang)
        .sort((x, y) => x.profondeur - y.profondeur)) {
        const v = utile(f.valeur); if (v !== undefined) return v
      }
    }
    return undefined
  }
  for (const r of rangs) {
    const t = [dans(ALIAS_PRENOM, r), dans(ALIAS_NOM_FAMILLE, r)].filter(Boolean).join(' ')
    if (t) return t
  }
  return undefined
}

// Le chemin d'un mapping, ramené à la forme de l'index.
function cheminMapping(idx: Index, chemin: string): string {
  const cle = cleNormalisee(chemin)
  return idx.prefixe && cle.startsWith(idx.prefixe + '_') ? cle.slice(idx.prefixe.length + 1) : cle
}

function enNombre(t: string | undefined): number | undefined {
  if (t === undefined) return undefined
  // "1 250,50 DH" → 1250.50. Les tableurs produisent de tout.
  const n = parseFloat(t.replace(/[^\d.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

function lireArticle(item: unknown): ArticleLu | null {
  if (!estObjet(item)) return null
  const idx = indexer(item)
  const produit = chercher(idx, ALIAS_ARTICLE.produit, null)
  const codes: string[] = []
  for (const a of ALIAS_ARTICLE.code) {
    const v = chercher(idx, [a], null)
    if (v !== undefined && !codes.includes(v)) codes.push(v)
  }
  if (produit === undefined && codes.length === 0) return null
  const q = enNombre(chercher(idx, ALIAS_ARTICLE.quantite, null))
  const p = enNombre(chercher(idx, ALIAS_ARTICLE.prix, null))
  return {
    produit,
    quantite: Math.max(1, Math.round(q ?? 1)),
    prix: p ?? null,
    codes,
  }
}

// La liste des articles : celle que le mapping désigne, sinon la moins
// profonde dont le nom est connu (line_items, items…) et qui contient des
// objets. Une liste dans une liste n'est jamais prise.
function trouverArticles(idx: Index, mapping: Record<string, string>): unknown[] | undefined {
  if (mapping.articles) {
    const l = idx.listes.get(cheminMapping(idx, mapping.articles))
    if (l) return l.valeur
  }
  let meilleure: Liste | undefined
  for (const l of idx.listes.values()) {
    if (l.dansListe || !CLES_ARTICLES.includes(l.nom) || !l.valeur.some(estObjet)) continue
    if (!meilleure || l.profondeur < meilleure.profondeur ||
        (l.profondeur === meilleure.profondeur &&
         CLES_ARTICLES.indexOf(l.nom) < CLES_ARTICLES.indexOf(meilleure.nom))) meilleure = l
  }
  return meilleure?.valeur
}

// "Crème A" — ou "Crème A ×2 + Sérum B ×1" quand la commande en a plusieurs.
// C'est ce texte que les écrans et la recherche lisent dans commandes.produit.
export function produitJoint(articles: { produit?: string; quantite: number }[]): string | undefined {
  const noms = articles.filter((a) => a.produit)
  if (noms.length === 0) return undefined
  if (articles.length === 1) return noms[0].produit
  return noms.map((a) => `${a.produit} ×${a.quantite}`).join(' + ')
}

export function normaliser(brut: Brut, mapping: Record<string, string> = {}): LeadNormalise {
  const idx = indexer(brut ?? {})

  const lire = (champ: string): string | undefined => {
    // Un mapping explicite (configuré sur la source) passe avant TOUT : c'est
    // ce qui permet de brancher une application étrange sans redéployer. Il
    // accepte un nom de colonne ("Numéro WhatsApp client") ou un chemin
    // ("customer.mobile", "line_items[0].sku").
    const force = mapping[champ]
    if (force) {
      const cle = cheminMapping(idx, force)
      const v = utile(idx.chemins.get(cle)) ?? chercher(idx, [cle], CHAMPS_CONTACT.has(champ) ? champ : null)
      if (v !== undefined) return v
    }
    return chercher(idx, ALIAS[champ] ?? [], champ)
  }

  const lead: LeadNormalise = {}
  for (const champ of ['lead_id', 'client_nom', 'client_telephone', 'pays', 'pays_code', 'ville_zone',
                       'adresse', 'produit', 'code', 'vendeur', 'notes', 'commentaire_1',
                       'commentaire_2', 'source_url', 'source_sheet']) {
    const v = lire(champ)
    if (v !== undefined) (lead as Record<string, unknown>)[champ] = v
  }
  const q = enNombre(lire('quantite')); if (q !== undefined) lead.quantite = q
  const p = enNombre(lire('prix'));     if (p !== undefined) lead.prix = p

  // --- les articles ---------------------------------------------------------
  // Une liste d'articles (WooCommerce, Shopify…) donne le produit et la
  // quantité ; sauf si le mapping désigne le produit lui-même, qui gagne.
  const produitForce = Boolean(mapping.produit || mapping.quantite || mapping.code)
  const liste = produitForce ? undefined : trouverArticles(idx, mapping)
  const lus = (liste ?? []).map(lireArticle).filter((a): a is ArticleLu => a !== null)
  if (lus.length > 0) {
    lead.articles = lus
    lead.produit = produitJoint(lus.map((a) => ({ produit: a.produit ?? a.codes[0], quantite: a.quantite })))
    lead.quantite = lus.reduce((s, a) => s + a.quantite, 0)
  } else if (lead.produit !== undefined || lead.code !== undefined) {
    // Payload plat : un seul article. Son prix unitaire reste null — la source
    // a écrit le prix de la commande, pas celui d'un article.
    lead.articles = [{
      produit: lead.produit,
      quantite: Math.max(1, Math.round(lead.quantite ?? 1)),
      prix: null,
      codes: lead.code ? [lead.code] : [],
    }]
  }

  // `pays_id` ne peut venir que d'un appel machine, jamais d'un tableur.
  const paysId = estObjet(idx.racine) ? idx.racine['pays_id'] : undefined
  if (typeof paysId === 'string' && paysId.trim() !== '') lead.pays_id = paysId.trim()

  return lead
}

// ------------------------------------------------------------------
// Retrouver le produit au catalogue
// ------------------------------------------------------------------

export interface ProduitCatalogue {
  id: string
  product: string
  code: string | null
}

// "Crème  Éclat " → "creme eclat".
export function sansAccents(t: string): string {
  return String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}

// ORDRE DE RÉSOLUTION, pour chaque article :
//
//   1. par CODE, si le payload en porte un (code, sku, product_id…). Chaque
//      code est essayé dans l'ordre d'ALIAS_ARTICLE.code. Le code est unique
//      par entreprise (idx_produits_code_unique) : un code ne trouve qu'un
//      produit ou aucun. C'est la voie sûre — accents, espaces et homonymes
//      n'y existent pas. Pour Shopify, le vendeur met l'ID produit Shopify
//      dans le champ code du produit.
//   2. par NOM sans accents ni espaces superflus, comme aujourd'hui.
//      Deux produits du catalogue au même nom : AUCUN n'est pris.
//   3. rien ne répond : l'article garde le texte de la source, `inconnus` le
//      signale (il est écrit sur imports_bruts.motif), et on ne devine pas.
//
// Un article trouvé prend le nom EXACT du catalogue : c'est ce nom que la
// fonction de stock compare à la livraison.
export function resoudreArticles(
  lus: ArticleLu[],
  catalogue: ProduitCatalogue[],
): { articles: Article[]; inconnus: string[] } {
  const parCode = new Map<string, ProduitCatalogue>()
  const parNom = new Map<string, ProduitCatalogue[]>()
  for (const p of catalogue) {
    const c = String(p.code ?? '').trim().toLowerCase()
    if (c) parCode.set(c, p)
    const n = sansAccents(p.product)
    parNom.set(n, [...(parNom.get(n) ?? []), p])
  }

  const articles: Article[] = []
  const inconnus: string[] = []
  for (const a of lus) {
    let trouve: ProduitCatalogue | undefined
    let code: string | null = null
    for (const c of a.codes) {
      const p = parCode.get(c.trim().toLowerCase())
      if (p) { trouve = p; code = p.code; break }
    }
    if (!trouve && a.produit) {
      const memes = parNom.get(sansAccents(a.produit)) ?? []
      if (memes.length === 1) { trouve = memes[0]; code = memes[0].code ?? null }
    }
    if (!trouve) {
      code = a.codes[0] ?? null
      inconnus.push(a.produit ?? a.codes[0] ?? '?')
    }
    articles.push({
      produit: trouve?.product ?? a.produit ?? a.codes[0] ?? '',
      quantite: a.quantite,
      prix: a.prix,
      code,
    })
  }
  return { articles, inconnus }
}

// La clé qui décide « déjà vu ou pas ».
//
// Si la source fournit un identifiant, c'est lui — PRÉFIXÉ par la source
// quand le lead arrive par une source : "SHOP1-727". Deux boutiques d'une même
// entreprise numérotent chacune depuis 1 ; sans préfixe, la commande 727 de la
// seconde était prise pour un doublon de la première et perdue sans bruit.
// L'unicité est `unique (tenant_id, lead_id)` (lead_id_par_entreprise.sql) ;
// on ne met pas source_id dedans parce qu'il est NULL pour la saisie et
// l'Excel, et que deux NULL ne se heurtent pas. Un identifiant qui porte déjà
// le préfixe (la boutique renvoie le nôtre) n'est pas préfixé deux fois.
//
// Sans identifiant, on en fabrique un
// STABLE à partir du téléphone, du produit et du jour. Avant, on tirait un
// identifiant au hasard : un simple ré-essai (timeout réseau, retry d'une
// boutique) créait donc un doublon à coup sûr.
//
// Contrepartie assumée : le même client, le même produit, le même jour est
// traité comme un doublon. En COD c'est presque toujours un double envoi du
// formulaire ; et un doublon qu'on fusionne coûte moins cher qu'un client
// appelé deux fois. Cette clé-là n'est PAS préfixée : le même client qui
// commande le même produit le même jour sur deux boutiques reste un doublon.
export async function cleExterne(
  tenantId: string,
  lead: LeadNormalise,
  prefixe: string | null = null,
): Promise<string> {
  if (lead.lead_id) {
    if (!prefixe || lead.lead_id.toUpperCase().startsWith(prefixe.toUpperCase() + '-')) return lead.lead_id
    return `${prefixe}-${lead.lead_id}`
  }
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
  // `?source=` de l'URL : une étiquette libre pour savoir d'où vient le lead
  // (« boutique-dakar », « landing-ramadan »). Rangée dans source_sheet si la
  // ligne n'en porte pas déjà une — c'est la colonne que l'écran Commandes
  // affiche à côté de l'origine.
  etiquette?: string | null
  // sources_import.prefixe_lead — null pour la saisie et l'import Excel.
  prefixeLead?: string | null
}

// Chargé une fois par lot : 200 lignes ne doivent pas déclencher 400 requêtes.
interface Cache {
  pays?: { id: string; nom: string | null; code: string | null }[]
  sellers?: { user_id: string; email: string | null; nom: string | null }[]
  produits?: ProduitCatalogue[]
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
  if (!cache.produits) {
    const { data } = await sb.from('produits').select('id, product, code').eq('tenant_id', tenantId)
    cache.produits = data ?? []
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
  const cle = await cleExterne(ctx.tenantId, lead, ctx.prefixeLead ?? null)

  // Le lead est écrit AVANT d'être jugé. S'il est refusé, il reste consultable
  // et rejouable : en COD, un lead perdu est une commande perdue.
  const { data: journal } = await sb.from('imports_bruts').insert({
    tenant_id: ctx.tenantId,
    source_id: ctx.sourceId,
    payload: brut as Record<string, unknown>,
    statut: 'recu',
    cle_externe: cle,
  }).select('id').single()

  // `note` : ce qu'il faut savoir d'un lead importé quand même (un produit
  // que le catalogue ne connaît pas). Elle va sur le journal, pas à l'appelant.
  const conclure = async (r: ResultatLigne, commandeId?: string, note?: string): Promise<ResultatLigne> => {
    if (journal?.id) {
      await sb.from('imports_bruts').update({
        statut: r.statut, motif: r.motif ?? note ?? null, commande_id: commandeId ?? null,
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
    // Sans accents : Shopify écrit "Senegal", le CRM "Sénégal". Puis le code
    // ISO2 si la source l'envoie aussi (country_code).
    const cherche = [lead.pays, lead.pays_code].filter(Boolean).map((t) => sansAccents(t as string))
    const trouve = cherche.map((c) => liste.find((p) =>
      sansAccents(String(p.nom ?? '')) === c || sansAccents(String(p.code ?? '')) === c
    )).find(Boolean)
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

  // --- quels produits ? -----------------------------------------------------
  // Par code, puis par nom sans accents, sinon rien — voir resoudreArticles().
  const { articles, inconnus } = resoudreArticles(lead.articles ?? [], cache.produits ?? [])
  const note = inconnus.length > 0 ? `Produit non reconnu : ${inconnus.join(', ')}` : undefined

  const { data: commande, error } = await sb.from('commandes').insert({
    lead_id: cle,
    client_nom: lead.client_nom ?? null,
    client_telephone: lead.client_telephone,
    produit: produitJoint(articles) ?? lead.produit ?? null,
    // Les lignes lues UNE fois, ici, par le code qui connaît la forme du
    // payload : rien ne devra relire le JSON de WooCommerce ou de Shopify.
    articles: articles.length > 0 ? articles : null,
    adresse: lead.adresse ?? null,
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
    source_sheet: lead.source_sheet ?? ctx.etiquette ?? null,
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
    note,
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
  prefixe_lead: string | null
  signature_entete: string | null
  signature_algo: string | null
  signature_encodage: string | null
  signature_prefixe: string | null
  signature_secret: string | null
}

// Le jeton en clair n'existe nulle part en base : on compare les empreintes.
// `actif` est dans la requête — couper une source doit la couper tout de suite.
export async function sourceDepuisJeton(sb: SupabaseClient, jeton: string): Promise<Source | null> {
  if (!jeton || jeton.length < 16) return null
  const empreinte = await sha256Hex(jeton)
  const { data } = await sb.from('sources_import')
    .select('id, tenant_id, vendeur_id, nom, type, mapping, prefixe_lead, ' +
      'signature_entete, signature_algo, signature_encodage, signature_prefixe, signature_secret')
    .eq('token_hash', empreinte).eq('actif', true).maybeSingle()
  if (!data) return null

  // Une entreprise suspendue n'accepte plus rien, même avec un jeton valide.
  const { data: t } = await sb.from('tenants').select('statut').eq('id', data.tenant_id).maybeSingle()
  if (!t || t.statut !== 'actif') return null

  return data as Source
}

// ------------------------------------------------------------------
// Le jeton : UN jeton, trois façons de le présenter
// ------------------------------------------------------------------
//
//   1. en-tête   x-import-token: fgm_…            Zapier, Make, un serveur
//   2. en-tête   Authorization: Bearer fgm_…      outils qui ne savent que ça
//   3. URL       ?token=fgm_…                     WooCommerce, formulaires,
//                ?key=fgm_…&secret=…              tout ce qui ne donne qu'une URL
//
// L'URL est la porte principale : c'est la seule chose que TOUTE application
// sait donner. La signature (plus bas) est une défense en plus, pas la porte.
//
// `?key=&secret=` est la forme d'URL de ShipLead, pour qu'un vendeur qui en
// vient colle ce qu'il connaît. Notre jeton est UNE valeur : `key` la porte ;
// `secret` est accepté et ignoré, il ne prouverait rien de plus.
//
// `Bearer` n'est pris pour un jeton de source que s'il commence par `fgm_`
// (le format tiré par la base) : un JWT Supabase (eyJ…) reste un utilisateur
// connecté, comme avant.
//
// UN JETON DANS UNE URL FINIT DANS DES JOURNAUX — ceux de la boutique, d'un
// proxy, de la plateforme. Ce code ne journalise JAMAIS l'URL complète : ne pas
// ajouter de console.log(req.url) ni renvoyer l'URL dans une erreur. Un jeton
// qui a fuité se remplace en un clic (« Nouveau jeton » sur la source) et
// l'ancien meurt aussitôt.
export function jetonDepuisRequete(req: Request): string | null {
  const entete = req.headers.get('x-import-token')?.trim()
  if (entete) return entete
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(fgm_\S+)$/i)?.[1]
  if (bearer) return bearer
  const url = new URL(req.url)
  return url.searchParams.get('token')?.trim() || url.searchParams.get('key')?.trim() || null
}

// ------------------------------------------------------------------
// La signature : décidée par la configuration de la source, pas par le nom
// d'une boutique
// ------------------------------------------------------------------
//
//   WooCommerce   x-wc-webhook-signature   HMAC-SHA256   base64
//   Shopify       x-shopify-hmac-sha256    HMAC-SHA256   base64
//   GitHub        x-hub-signature-256      HMAC-SHA256   hex, préfixe 'sha256='
//
// Même calcul, autre en-tête, autre encodage : quatre colonnes de
// sources_import (en-tête, algorithme, encodage, préfixe) + le secret, un seul
// chemin de code.
//
// Le HMAC se calcule sur les OCTETS BRUTS du corps, lus AVANT JSON.parse :
// parser puis ré-écrire change les octets (espaces, ordre, échappements) et la
// signature ne se vérifie plus.
//
// LE SECRET N'EST PAS UN JETON. Le jeton est haché parce qu'on ne fait que le
// comparer. Le secret de signature doit SERVIR à calculer le HMAC : il ne peut
// pas être haché, il est rangé lisible dans sources_import.signature_secret.
// Qui le lit, c'est la RLS de sources_import qui le décide (super_admin, les
// responsables de l'entreprise, le vendeur de la source).

const ALGOS: Record<string, string> = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' }

function decoderSignature(texte: string, encodage: string): Uint8Array | null {
  const t = texte.trim()
  if (encodage === 'hex') {
    if (!/^[0-9a-f]+$/i.test(t) || t.length % 2 !== 0) return null
    return new Uint8Array(t.match(/../g)!.map((h) => parseInt(h, 16)))
  }
  try {
    const bin = atob(t)
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

// Temps constant : la comparaison lit tous les octets, qu'ils diffèrent au
// premier ou au dernier. Seule la longueur peut répondre plus vite, et elle
// est publique (celle de l'algorithme).
function egalTempsConstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// null  : la source n'a pas de secret, rien à vérifier — on ne refuse pas.
// true  : signature juste.
// false : signature absente, mal formée ou fausse — ou configuration
//         incomplète : un secret posé sans en-tête refuse plutôt que d'ouvrir.
export async function verifierSignature(
  corps: Uint8Array,
  entetes: Headers,
  cfg: Pick<Source, 'signature_entete' | 'signature_algo' | 'signature_encodage' |
                    'signature_prefixe' | 'signature_secret'>,
): Promise<boolean | null> {
  if (!cfg.signature_secret) return null
  const hash = ALGOS[String(cfg.signature_algo ?? 'sha256').toLowerCase()]
  if (!hash || !cfg.signature_entete) return false

  let recue: string | undefined
  try { recue = entetes.get(cfg.signature_entete)?.trim() } catch { return false }
  if (!recue) return false
  const prefixe = cfg.signature_prefixe ?? ''
  if (prefixe) {
    if (!recue.toLowerCase().startsWith(prefixe.toLowerCase())) return false
    recue = recue.slice(prefixe.length)
  }
  const attendue = decoderSignature(recue, String(cfg.signature_encodage ?? 'base64').toLowerCase())
  if (!attendue) return false

  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(cfg.signature_secret), { name: 'HMAC', hash }, false, ['sign'],
  )
  const calculee = new Uint8Array(await crypto.subtle.sign('HMAC', cle, corps as BufferSource))
  return egalTempsConstant(calculee, attendue)
}

// WooCommerce, quand on enregistre un webhook, envoie `webhook_id=12` en
// formulaire (pas du JSON) et désactive le webhook s'il n'obtient pas un 2xx.
// Ce ping n'écrit rien : on lui répond 200.
export function estPingWebhook(texte: string): boolean {
  return /^webhook_id=\d+$/.test(texte.trim())
}
