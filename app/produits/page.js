'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useEntrepot } from '../context/EntrepotContext'
import { usePermissions } from '../context/PermissionsContext'
import VignetteProduit from '../components/VignetteProduit'
import { useMessages } from '../components/Messages'
import { messageErreur } from '../../lib/messageErreur.mjs'
import { useLangue } from '../context/LangueContext'
// Export CSV : chaque cellule entre guillemets, jamais une formule (16/11).
import { contenuCSV } from '../../lib/celluleCSV.mjs'
// Lien de vérification : http(s) seulement (16/11).
import { estLienWeb } from '../../lib/lienWeb.mjs'
import { reduireImage, envoyerImage, retirerImage, urlImage } from '../../lib/imageProduit'

// Le catalogue de Paramètres reste en place le temps que cet écran fasse ses
// preuves. Les deux lisent la même table : ce qui est créé ici apparaît là-bas,
// et l'inverse. Rien n'est dupliqué.

const TYPES = ['Standard', 'Pack', 'Échantillon', 'Promo']

// Les codes enregistrés par l'écran Paramètres, en français lisible.
const LIBELLE_MOUVEMENT = {
  entree: 'Entrée',
  sortie: 'Sortie',
  retour_ok: 'Retour client',
  retour_defaut: 'Retour défectueux',
  ajustement: 'Ajustement',
}
const VIDE = {
  product: '', code: '', code_variante: '', vendeur_id: '', type: 'Standard',
  price: '', current_quantity: '', quantite_totale: '', defected_quantity: '',
  upsell_produit_id: '', crosssell_produit_id: '',
  description: '', product_page: '', statut: 'actif',
}


function QuantiteCellule({ total, parPays }) {
  return (
    <div>
      {/* Un nombre, rouge à zéro (19/11) — avant : « Total : 0 » en pastille
          violette dans trois colonnes. */}
      <span className={`text-base font-bold whitespace-nowrap ${(total ?? 0) > 0 ? 'text-[#1B2632]' : 'text-[#A35139]'}`}>
        {total ?? 0}
      </span>
      {/* Le détail n'apparaît que si des entrepôts ont un pays. Sans entrepôt,
          la ligne resterait vide et ferait croire à un stock à zéro. */}
      {parPays.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {parPays.map((p) => (
            <span key={p.nom} className="inline-flex items-center gap-1 text-xs text-[#1B2632]/70">
              <span className="text-[#1B2632]/40">{p.nom}</span>
              <span className="font-semibold text-[#1B2632]">{p.quantite}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Le filtre par vendeur (29/10) : responsables et ceo. La valeur « Sans
// vendeur » n'est jamais un id (ce sont des uuid).
const ROLES_FILTRE_VENDEUR = ['admin', 'manager', 'ceo', 'super_admin']
const SANS_VENDEUR = 'aucun'
const pourNomDeFichier = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function ProduitsPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  // L'entrepôt regardé (en haut, 11/11) : les produits qui y ont une ligne de
  // stock (produits_de_l_entrepot — le vendeur ne lit pas les stocks).
  const { entrepotId } = useEntrepot()
  const [produitsEntrepot, setProduitsEntrepot] = useState(null)   // Set des id, ou null = tous
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions()
  // Messages du CRM (24/11) : annonces en bas à droite + fenêtres de confirmation.
  const { annoncer, confirmer } = useMessages()
  // Les textes suivent la langue choisie (25/11).
  const { t, locale } = useLangue()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId
  const peutGerer = hasPermission('gerer_produits')

  // Le vendeur ne voit pas les entrepôts, et ne voit donc pas le stock : où la
  // marchandise est posée est l'organisation interne de FGMED. La base le
  // refuse déjà (rls_parametres.sql) ; l'écran doit s'accorder avec elle,
  // sinon il affiche des cases vides et « 0 en stock », ce qui est un mensonge
  // plus trompeur qu'une absence.
  //
  // Ce qu'il garde : créer et corriger un produit. Le stock arrive par
  // l'expédition qu'un responsable confirme.
  const estSeller = String(roleNom || '').toLowerCase() === 'seller'

  const [produits, setProduits] = useState([])
  // La devise de l'entreprise quand elle n'en a qu'une (19/11) : « 49 999 AOA ».
  // Un produit n'a pas de pays : avec plusieurs devises, le prix reste nu.
  const [deviseUnique, setDeviseUnique] = useState('')
  // Les vendeurs de l'entreprise, pour le responsable qui choisit à qui est
  // un produit (comme « Nouvelle source » dans Mon API). Le vendeur n'en a
  // pas besoin : ce qu'il crée est à lui, la base l'écrit
  // (produits_proprietaire.sql).
  const [vendeurs, setVendeurs] = useState([])
  const [stocksParProduit, setStocksParProduit] = useState({})
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')

  const [recherche, setRecherche] = useState('')
  const [filtreType, setFiltreType] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreUpsell, setFiltreUpsell] = useState('')
  // Filtre par vendeur : une VUE, pas un droit — il resserre la liste déjà
  // lue, il ne change aucune lecture. Un simple état : un rechargement
  // l'efface, exprès. Jamais montré au vendeur (sa liste est déjà la sienne,
  // par la base).
  const [filtreVendeur, setFiltreVendeur] = useState('')
  const [panneauFiltres, setPanneauFiltres] = useState(false)
  const [analyseOuverte, setAnalyseOuverte] = useState(false)

  const [entrepots, setEntrepots] = useState([])
  const [entrepotsChoisis, setEntrepotsChoisis] = useState([])
  // Le pendant pour le vendeur : des pays, pas des entrepôts.
  const [paysLivrables, setPaysLivrables] = useState([])
  const [paysChoisis, setPaysChoisis] = useState([])
  const [stocks, setStocks] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [ficheOuverte, setFicheOuverte] = useState(null)
  // Les SKU de boutique (11/11, T20, sku_ecran.sql) : ceux du produit ouvert,
  // les boutiques de l'entreprise, et les SKU reçus sans correspondance.
  const [skusProduit, setSkusProduit] = useState([])
  const [sources, setSources] = useState([])
  const [skusInconnus, setSkusInconnus] = useState([])
  // Les SKU proposés par un vendeur, en attente d'un manager / admin (11/11,
  // option C, sku_propositions.sql) : le vendeur PROPOSE, le responsable APPROUVE.
  const [propositions, setPropositions] = useState([])
  const [panneauPropositions, setPanneauPropositions] = useState(false)
  const [panneauSku, setPanneauSku] = useState(false)
  const [nouveauSku, setNouveauSku] = useState({ sku: '', pack: '1', source: '' })
  const [choixInconnu, setChoixInconnu] = useState({})   // { cle: { produit, pack } }
  // Les SKU tapés DANS le formulaire du produit (création ou modification) :
  // ajoutés après l'enregistrement du produit (11/11).
  const [skusFormulaire, setSkusFormulaire] = useState([])   // [{ sku, pack }]
  const [sourceFormulaire, setSourceFormulaire] = useState('')
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)
  const [formulaire, setFormulaire] = useState(VIDE)
  const [idEnEdition, setIdEnEdition] = useState(null)
  // L'image (26/10). Choisie dans le formulaire, elle reste dans le navigateur
  // — réduite, avec son aperçu — jusqu'à « Enregistrer » : le produit doit
  // exister avant l'envoi (la policy du bucket lit son id dans le chemin).
  // Un formulaire abandonné n'a donc rien envoyé.
  const [imageChoisie, setImageChoisie] = useState(null)   // { blob, ext, apercu }
  const [imageRetiree, setImageRetiree] = useState(false)
  const [imageActuelle, setImageActuelle] = useState(null) // chemin en base, en modification
  const [erreurImage, setErreurImage] = useState('')

  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) router.replace('/')
      else if (!hasPermission('menu_produits')) router.replace('/dashboard')
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const charger = useCallback(async () => {
    if (!tenantKey) return
    setChargement(true)
    setErreur('')

    const { data, error } = await supabase
      .from('produits')
      .select('*')
      .eq('tenant_id', tenantKey)
      .order('created_at', { ascending: false })

    if (error) {
      // Le message de la base, pas une supposition : si une colonne manque
      // parce que le SQL n'a pas été lancé, il le dit noir sur blanc.
      setErreur(messageErreur(error))
      setProduits([])
      setChargement(false)
      return
    }
    setProduits(data || [])

    // Le vendeur ne lit ni `entrepots` ni `stocks`. Il choisit un PAYS, comme
    // à l'import, et la base traduit en entrepôts (rattacher_produit_pays).
    if (estSeller) {
      setStocks([])
      setEntrepots([])
      setStocksParProduit({})

      const { data: paysDB } = await supabase
        .from('v_pays_livrables').select('pays_id, nom').eq('tenant_id', tenantKey).order('nom')
      setPaysLivrables(paysDB || [])

      // Ses boutiques, ses SKU inconnus, ses propositions (sku_propositions.sql).
      const { data: sesSources } = await supabase
        .from('sources_import').select('id, nom, vendeur_id').eq('tenant_id', tenantKey)
      setSources(sesSources || [])
      const { data: sesInconnus } = await supabase.rpc('skus_inconnus_du_vendeur', { p_tenant: tenantKey })
      setSkusInconnus(sesInconnus || [])
      const { data: sesPropositions } = await supabase.from('propositions_sku')
        .select('id, source_id, sku, produit_id, multiplicateur, propose_par, propose_le').order('propose_le')
      setPropositions(sesPropositions || [])

      setChargement(false)
      return
    }

    // Détail par pays : stocks -> entrepôt -> pays. Facultatif, et on ne
    // bloque pas l'écran si ces tables ne répondent pas.
    const { data: stocks } = await supabase
      .from('stocks')
      .select('id, produit_id, entrepot_id, quantite_disponible, quantite_defectueuse, entrepots(nom, pays(nom))')
      .eq('tenant_id', tenantKey)

    setStocks(stocks || [])

    const { data: entrepotsDB } = await supabase
      .from('entrepots').select('id, nom, pays_id, pays(nom)').eq('tenant_id', tenantKey).order('nom')
    setEntrepots(entrepotsDB || [])

    const { data: vendeursDB } = await supabase
      .from('user_roles').select('user_id, nom, email')
      .eq('tenant_id', tenantKey).eq('role', 'seller')
    setVendeurs(vendeursDB || [])

    // Les boutiques (sources) et les SKU qui attendent — responsables seulement :
    // la base refuse les autres (sku_ecran.sql). Une erreur (SQL pas lancé) ne
    // bloque pas l'écran.
    const { data: sourcesDB } = await supabase
      .from('sources_import').select('id, nom, vendeur_id').eq('tenant_id', tenantKey)
    setSources(sourcesDB || [])
    const { data: inconnusDB } = await supabase.rpc('skus_inconnus', { p_tenant: tenantKey })
    setSkusInconnus(inconnusDB || [])
    const { data: propositionsDB } = await supabase.from('propositions_sku')
      .select('id, source_id, sku, produit_id, multiplicateur, propose_par, propose_le')
      .eq('tenant_id', tenantKey).order('propose_le')
    setPropositions(propositionsDB || [])

    const regroupe = {}
    for (const s of stocks || []) {
      const nomPays = s.entrepots?.pays?.nom
      if (!nomPays || !s.produit_id) continue
      regroupe[s.produit_id] = regroupe[s.produit_id] || {}
      regroupe[s.produit_id][nomPays] = (regroupe[s.produit_id][nomPays] || 0) + (s.quantite_disponible || 0)
    }
    setStocksParProduit(regroupe)

    setChargement(false)
  }, [tenantKey, estSeller])

  useEffect(() => { if (tenantKey && !permsLoading) charger() }, [tenantKey, permsLoading, charger])
  useEffect(() => {
    if (!tenantKey) return
    supabase.from('pays').select('devise').eq('tenant_id', tenantKey).then(({ data }) => {
      const devises = [...new Set((data || []).map((l) => l.devise).filter(Boolean))]
      setDeviseUnique(devises.length === 1 ? devises[0] : '')
    })
  }, [tenantKey])
  const prixLisible = (v) => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString(locale)}${deviseUnique ? ` ${deviseUnique}` : ''}`)

  function parPays(produitId) {
    const d = stocksParProduit[produitId]
    if (!d) return []
    return Object.entries(d).map(([nom, quantite]) => ({ nom, quantite }))
  }

  // Le propriétaire, par son compte. L'ancien texte libre `seller` n'est plus
  // lu : il ne correspondait même pas au compte qu'il nommait.
  const nomVendeur = useCallback((id) => {
    if (!id) return null
    const v = vendeurs.find((x) => x.user_id === id)
    return v ? (v.nom || v.email) : t('prod.compteIntrouvable')
  }, [vendeurs])

  // Le filtrage se fait sur la liste déjà chargée : un catalogue tient en
  // quelques dizaines de lignes, inutile d'aller-retour sur le serveur.
  // Tous les filtres SAUF le vendeur : le « sur N » du filtre vendeur.
  useEffect(() => {
    let annule = false
    if (!entrepotId || !tenantKey) { setProduitsEntrepot(null); return }
    supabase.rpc('produits_de_l_entrepot', { p_tenant: tenantKey, p_entrepot: entrepotId })
      // setof uuid : un tableau de valeurs (ou d'objets selon la version de l'API)
      .then(({ data, error }) => { if (!annule) setProduitsEntrepot(error ? null : new Set((data || []).map((x) => (x && typeof x === 'object' ? Object.values(x)[0] : x)))) })
    return () => { annule = true }
  }, [entrepotId, tenantKey])

  const affichesTousVendeurs = useMemo(() => {
    const r = recherche.trim().toLowerCase()
    return produits.filter((p) => {
      if (produitsEntrepot && !produitsEntrepot.has(p.id)) return false
      if (r && !`${p.product || ''} ${p.code || ''} ${nomVendeur(p.vendeur_id) || ''}`.toLowerCase().includes(r)) return false
      if (filtreType && (p.type || 'Standard') !== filtreType) return false
      if (filtreStatut && (p.statut || 'actif') !== filtreStatut) return false
      if (filtreUpsell === 'oui' && !p.upsell) return false
      if (filtreUpsell === 'non' && p.upsell) return false
      return true
    })
  }, [produits, recherche, filtreType, filtreStatut, filtreUpsell, nomVendeur, produitsEntrepot])

  const peutFiltrerVendeur = !estSeller && ROLES_FILTRE_VENDEUR.includes(String(roleNom || '').toLowerCase())
  // Pour un vendeur, filtreVendeur reste vide : affiches = affichesTousVendeurs,
  // exactement la liste d'avant.
  const affiches = useMemo(() => {
    if (!filtreVendeur) return affichesTousVendeurs
    if (filtreVendeur === SANS_VENDEUR) return affichesTousVendeurs.filter((p) => !p.vendeur_id)
    return affichesTousVendeurs.filter((p) => p.vendeur_id === filtreVendeur)
  }, [affichesTousVendeurs, filtreVendeur])
  const nomFiltreVendeur = filtreVendeur === SANS_VENDEUR ? t('prod.sansVendeur') : (filtreVendeur ? nomVendeur(filtreVendeur) : '')

  const analyse = useMemo(() => {
    const total = affiches.length
    const actifs = affiches.filter((p) => (p.statut || 'actif') === 'actif').length
    const enStock = affiches.reduce((s, p) => s + (p.current_quantity || 0), 0)
    const defectueux = affiches.reduce((s, p) => s + (p.defected_quantity || 0), 0)
    const cumul = affiches.reduce((s, p) => s + (p.quantite_totale || 0), 0)
    const valeur = affiches.reduce((s, p) => s + (p.current_quantity || 0) * Number(p.price || 0), 0)
    const ruptures = affiches.filter((p) => (p.statut || 'actif') === 'actif' && !(p.current_quantity > 0))
    return {
      total, actifs, enStock, defectueux, cumul, valeur, ruptures,
      // Part des défectueux sur tout ce qui est passé, pas sur le reste en
      // stock : sur le reste, le taux grimpe à mesure qu'on vend.
      tauxDefaut: cumul > 0 ? (defectueux / cumul) * 100 : 0,
    }
  }, [affiches])

  const nombreFiltres = [filtreType, filtreStatut, filtreUpsell].filter(Boolean).length

  // Un up-sell est maintenant un produit, pas un mot. On affiche son nom.
  const nomLie = useCallback((id) => {
    if (!id) return null
    return produits.find((p) => p.id === id)?.product || t('prod.produitSupprime')
  }, [produits])

  // L'historique ne stocke pas le « avant / après ». On le reconstitue en
  // partant du stock d'aujourd'hui et en remontant mouvement par mouvement :
  // le chiffre du haut colle donc toujours au stock réel, ce qu'un compteur
  // calculé depuis le début ne garantirait pas si un mouvement manquait.
  const SENS = { entree: 1, retour_ok: 1, ajustement: 1, sortie: -1, retour_defaut: -1 }

  async function chargerSkusProduit(produitId) {
    const { data } = await supabase.rpc('skus_du_produit', { p_produit: produitId })
    setSkusProduit(data || [])
  }

  // Ajouter un SKU : la base le relie au produit ET relie tout de suite les
  // leads qui l'attendaient (ajouter_correspondance_sku). Rend leur nombre.
  async function ajouterSku(source, sku, produit, pack) {
    if (!source || !sku.trim() || !produit) return annonce(t('prod.skuChampsObligatoires'), 'erreur')
    const n = parseInt(pack, 10)
    if (!(n >= 1 && n <= 100)) return annonce(t('prod.packInvalide'), 'erreur')
    if (estSeller) {
      const { error: eProp } = await supabase.rpc('proposer_sku', {
        p_source: source, p_sku: sku.trim(), p_produit: produit, p_multiplicateur: n,
      })
      if (eProp) return annonce(t('prod.propositionRefusee', { erreur: messageErreur(eProp) }), 'erreur')
      annonce(`SKU « ${sku.trim()} » proposé : un manager ou un admin doit l\u2019approuver.`, 'succes')
      setNouveauSku({ sku: '', pack: '1', source: '' })
      charger()
      return
    }
    const { data, error } = await supabase.rpc('ajouter_correspondance_sku', {
      p_source: source, p_sku: sku.trim(), p_produit: produit, p_multiplicateur: n,
    })
    if (error) return annonce(t('prod.skuRefuseErr', { erreur: messageErreur(error) }), 'erreur')
    const relies = data?.[0]?.commandes_reliees ?? 0
    annonce(relies ? t('prod.skuAjouteRelies', { sku: sku.trim(), n: relies }) : t('prod.skuAjoute', { sku: sku.trim() }), 'succes')
    setNouveauSku({ sku: '', pack: '1', source: '' })
    if (ficheOuverte?.id === produit) await chargerSkusProduit(produit)
    charger()
  }

  // Les SKU tapés dans le formulaire du produit, après son enregistrement : un
  // responsable les ajoute (les leads qui attendent sont reliés), un vendeur les
  // PROPOSE. Rend le texte à ajouter au message.
  async function traiterSkusFormulaire(produitId, vendeurProduit) {
    const lignes = skusFormulaire.filter((x) => x.sku.trim())
    // Rend { texte, erreur } (25/11) : avant, l'appelant cherchait « refusé »
    // dans le texte français pour colorer l'annonce — faux une fois traduit.
    if (lignes.length === 0) return { texte: '', erreur: false }
    const boutiques = sources.filter((x) => x.vendeur_id && x.vendeur_id === vendeurProduit)
    const source = sourceFormulaire || (boutiques.length === 1 ? boutiques[0].id : '')
    if (!source) return { texte: ' ' + t('prod.skuNonAjoutes'), erreur: true }
    const refus = []
    let relies = 0
    for (const x of lignes) {
      const args = { p_source: source, p_sku: x.sku.trim(), p_produit: produitId, p_multiplicateur: parseInt(x.pack, 10) || 1 }
      const { data: r, error: eSku } = await supabase.rpc(estSeller ? 'proposer_sku' : 'ajouter_correspondance_sku', args)
      if (eSku) refus.push(`${x.sku.trim()} (${messageErreur(eSku)})`)
      else if (!estSeller) relies += r?.[0]?.commandes_reliees ?? 0
    }
    const faits = lignes.length - refus.length
    const texte = (faits > 0
      ? ' ' + (estSeller ? t('prod.skuProposes', { n: faits }) : relies ? t('prod.skuAjoutesRelies', { n: faits, r: relies }) : t('prod.skuAjoutes', { n: faits }))
      : '') + (refus.length ? ' ' + t('prod.skuRefuses', { liste: refus.join(' ; ') }) : '')
    return { texte, erreur: refus.length > 0 }
  }

  async function approuverSku(x) {
    const { data, error } = await supabase.rpc('approuver_sku', { p_proposition: x.id })
    if (error) return annonce(t('prod.refuseErr', { erreur: messageErreur(error) }), 'erreur')
    annonce(data ? t('prod.skuApprouveRelies', { sku: x.sku, n: data }) : t('prod.skuApprouve', { sku: x.sku }), 'succes')
    if (ficheOuverte) await chargerSkusProduit(ficheOuverte.id)
    charger()
  }

  async function refuserSku(x) {
    if (!(await confirmer(estSeller
      ? { titre: t('prod.retirerProposition'), message: `Retirer votre proposition « ${x.sku} » ?`, bouton: t('prod.retirer'), danger: true }
      : { titre: t('prod.refuserSku'), message: `Refuser le SKU « ${x.sku} » ?`, bouton: t('prod.refuser'), danger: true }))) return
    const { error } = await supabase.rpc('refuser_sku', { p_proposition: x.id })
    if (error) return annonce(t('prod.refuseErr', { erreur: messageErreur(error) }), 'erreur')
    annonce(estSeller ? t('prod.propositionRetiree') : `SKU « ${x.sku} » refusé.`, 'succes')
    charger()
  }

  async function retirerSku(m) {
    if (!(await confirmer({ titre: t('prod.retirerSku'), message: `Retirer le SKU « ${m.sku} » ?`, bouton: t('prod.retirer'), danger: true }))) return
    const { error } = await supabase.rpc('retirer_correspondance_sku', { p_correspondance: m.id })
    if (error) return annonce(t('prod.refuseErr', { erreur: messageErreur(error) }), 'erreur')
    annonce(`SKU « ${m.sku} » retiré.`, 'succes')
    if (ficheOuverte) await chargerSkusProduit(ficheOuverte.id)
  }

  async function ouvrirFiche(p) {
    setFicheOuverte(p)
    setMouvements([])
    setSkusProduit([])
    chargerSkusProduit(p.id)

    // Pas d'historique pour un vendeur : la fiche ne l'affiche pas, et la
    // base refuserait la lecture.
    if (estSeller) return

    const { data, error } = await supabase
      .from('mouvements_stock')
      .select('id, entrepot_id, type_mouvement, quantite, notes, created_at, entrepots(nom)')
      .eq('tenant_id', tenantKey)
      .eq('produit_id', p.id)
      .order('created_at', { ascending: false })

    if (error) { annonce(t('prod.historiqueIllisible', { erreur: messageErreur(error) }), 'erreur'); return }

    // Stock actuel par entrepôt, point de départ de la remontée.
    const courant = {}
    for (const st of stocks) {
      if (st.produit_id === p.id) courant[st.entrepot_id] = st.quantite_disponible || 0
    }

    const avecSolde = (data || []).map((m) => {
      const apres = courant[m.entrepot_id] ?? 0
      const sens = SENS[m.type_mouvement] ?? 0
      const avant = apres - sens * (m.quantite || 0)
      courant[m.entrepot_id] = avant
      return { ...m, stock_avant: avant, stock_apres: apres, sens }
    })
    setMouvements(avecSolde)
  }

  function oublierImage() {
    setImageChoisie((avant) => { if (avant?.apercu) URL.revokeObjectURL(avant.apercu); return null })
    setImageRetiree(false)
    setErreurImage('')
  }

  async function choisirImage(fichier) {
    setErreurImage('')
    if (!fichier) return
    try {
      const reduite = await reduireImage(fichier)
      setImageChoisie((avant) => {
        if (avant?.apercu) URL.revokeObjectURL(avant.apercu)
        return { ...reduite, apercu: URL.createObjectURL(reduite.blob) }
      })
      setImageRetiree(false)
    } catch (e) {
      setErreurImage(e.message)
    }
  }

  function ouvrirCreation() {
    oublierImage()
    setImageActuelle(null)
    setFormulaire(VIDE)
    setEntrepotsChoisis([])
    setPaysChoisis([])
    setIdEnEdition(null)
    setSkusFormulaire([])
    setSourceFormulaire('')
    setModaleOuverte(true)
  }

  async function ouvrirEdition(p) {
    oublierImage()
    setSkusFormulaire([])
    setSourceFormulaire('')
    setImageActuelle(p.image_chemin || null)
    setFormulaire({
      product: p.product || '', code: p.code || '', code_variante: p.code_variante || '',
      vendeur_id: p.vendeur_id || '', type: p.type || 'Standard', price: p.price ?? '',
      current_quantity: p.current_quantity ?? '', quantite_totale: p.quantite_totale ?? '',
      defected_quantity: p.defected_quantity ?? '',
      upsell_produit_id: p.upsell_produit_id || '', crosssell_produit_id: p.crosssell_produit_id || '',
      description: p.description || '',
      product_page: p.product_page || '', statut: p.statut || 'actif',
    })
    setEntrepotsChoisis(stocks.filter((st) => st.produit_id === p.id).map((st) => st.entrepot_id))

    // Le vendeur ne peut pas déduire ses pays depuis `stocks`, qu'il ne lit
    // pas : c'est la base qui les lui donne, sans nommer un seul entrepôt.
    // Sans ça, il rouvrirait un produit déjà rattaché avec un champ vide, et
    // l'enregistrer le détacherait de tout.
    if (estSeller) {
      const { data } = await supabase.rpc('pays_du_produit', { p_produit: p.id })
      setPaysChoisis(Array.isArray(data) ? data.filter(Boolean) : [])
    }

    setIdEnEdition(p.id)
    setModaleOuverte(true)
  }

  // Le bandeau de la page est remplacé par les annonces du CRM (24/11).
  function annonce(texte, type) {
    annoncer(texte, type === 'succes' ? 'succes' : type === 'erreur' ? 'erreur' : 'info')
  }

  // Après l'enregistrement du produit, dans le même clic. Ordre : envoyer la
  // nouvelle → l'écrire sur le produit → retirer l'ancienne. Un retrait raté
  // laisse un orphelin (v_images_produits_orphelines), jamais un produit qui
  // pointe vers un fichier disparu. Rend un message d'erreur, ou null.
  async function traiterImage(produit) {
    const ancienne = produit.image_chemin || null
    if (imageChoisie) {
      let chemin
      try {
        chemin = await envoyerImage(tenantKey, produit.id, imageChoisie)
      } catch (err) {
        return `L\u2019image n\u2019a pas été enregistrée (${messageErreur(err)}). Réessayez avec « Modifier ».`
      }
      const { error } = await supabase.from('produits')
        .update({ image_chemin: chemin }).eq('id', produit.id).eq('tenant_id', tenantKey)
      if (error) {
        await retirerImage(chemin)
        return `L\u2019image n\u2019a pas été enregistrée (${messageErreur(error)}).`
      }
      if (ancienne) await retirerImage(ancienne)
      oublierImage()
      return null
    }
    if (imageRetiree && ancienne) {
      const { error } = await supabase.from('produits')
        .update({ image_chemin: null }).eq('id', produit.id).eq('tenant_id', tenantKey)
      if (error) return `L\u2019image n\u2019a pas été retirée (${messageErreur(error)}).`
      await retirerImage(ancienne)
      oublierImage()
    }
    return null
  }

  async function enregistrer(e) {
    e.preventDefault()
    if (!tenantKey) return
    if (!formulaire.product.trim()) return annonce(t('prod.nomObligatoire'), 'erreur')
    // Le code est ce que le vendeur écrit dans la colonne Product de son
    // fichier d'import : sans lui, seul le nom peut correspondre, et un nom
    // casse sur un accent ou un espace. Obligatoire à la création ; un
    // produit ancien sans code reste modifiable.
    if (!idEnEdition && !formulaire.code.trim()) return annonce(t('prod.codeObligatoire'), 'erreur')
    // Le responsable dit à quel vendeur est le produit. Un produit sans
    // vendeur n'est visible d'aucun vendeur : c'est le cas hérité, pas un
    // choix qu'on propose. (La base l'accepte encore d'un responsable — rien
    // ne lui a été retiré —, c'est l'écran qui l'impose, à la création ; un
    // ancien produit sans vendeur reste modifiable tel quel.)
    if (!idEnEdition && !estSeller && !formulaire.vendeur_id) return annonce(t('prod.choisirVendeurProduit'), 'erreur')
    if (formulaire.price === '' || Number.isNaN(Number(formulaire.price))) {
      return annonce(t('prod.prixObligatoire'), 'erreur')
    }
    // Une adresse web, rien d'autre : ni faute de frappe (« httpps:// »), ni
    // « javascript: » (revue de sécurité 13/11, point 4).
    if (formulaire.product_page.trim() && !estLienWeb(formulaire.product_page)) {
      return annonce(t('prod.lienFormat'), 'erreur')
    }

    const enStock = parseInt(formulaire.current_quantity, 10) || 0
    const defect = parseInt(formulaire.defected_quantity, 10) || 0
    let total = parseInt(formulaire.quantite_totale, 10) || 0
    // Le total ne peut pas être plus petit que ce qu'on a sous la main :
    // saisi à zéro ou oublié, on le déduit au lieu d'enregistrer un chiffre faux.
    if (total < enStock + defect) total = enStock + defect

    const donnees = {
      product: formulaire.product.trim(),
      code: formulaire.code.trim() || null,
      code_variante: formulaire.code_variante.trim() || null,
      // Le vendeur n'envoie pas de propriétaire : la base écrit le sien.
      ...(estSeller ? {} : { vendeur_id: formulaire.vendeur_id || null }),
      type: formulaire.type || 'Standard',
      price: Number(formulaire.price),
      current_quantity: enStock,
      defected_quantity: defect,
      quantite_totale: total,
      upsell_produit_id: formulaire.upsell_produit_id || null,
      crosssell_produit_id: formulaire.crosssell_produit_id || null,
      description: formulaire.description.trim() || null,
      product_page: formulaire.product_page.trim() || null,
      statut: formulaire.statut === 'inactif' ? 'inactif' : 'actif',
    }

    setEnregistrement(true)
    const requete = idEnEdition
      ? supabase.from('produits').update(donnees).eq('id', idEnEdition).eq('tenant_id', tenantKey).select()
      : supabase.from('produits').insert([{ ...donnees, tenant_id: tenantKey }]).select()

    const { data, error } = await requete

    if (error) {
      setEnregistrement(false)
      // idx_produits_code_unique : un code par VENDEUR depuis le 10/11 (T14 —
      // produits_par_vendeur.sql ; casse et espaces ignorés). Deux vendeurs
      // peuvent avoir chacun leur « produit » au même code.
      if (error.code === '23505' && String(error.message).includes('idx_produits_code_unique')) {
        return annonce(t('prod.codeExiste'), 'erreur')
      }
      return annonce(t('prod.enregistrementRefuse', { erreur: messageErreur(error) }), 'erreur')
    }
    if (!data || data.length === 0) {
      setEnregistrement(false)
      return annonce(t('prod.roleInterdit'), 'erreur')
    }

    // L'image, maintenant que le produit existe. Un échec ne défait pas le
    // produit (il est complet sans image) : il est dit, à la fin.
    const avisImage = await traiterImage(data[0])
    const fin = (texte) => (avisImage ? `${texte} ${avisImage}` : texte)

    // Le vendeur a choisi des PAYS. La base les traduit en entrepôts et écrit
    // les lignes de stock à sa place : lui n'a le droit ni de lire les
    // entrepôts, ni d'écrire dans `stocks`.
    if (estSeller) {
      const { data: bilan, error: errPays } = await supabase.rpc('rattacher_produit_pays', {
        p_produit: data[0].id,
        p_pays: paysChoisis,
      })
      setEnregistrement(false)

      if (errPays) {
        return annonce(t('prod.paysRefuses', { erreur: messageErreur(errPays) }), 'erreur')
      }

      // La base dit ce qu'elle a vraiment fait. Un pays décoché dont
      // l'entrepôt contient encore de la marchandise n'est pas retiré, et le
      // taire ferait croire à un détachement qui n'a pas eu lieu.
      const r = Array.isArray(bilan) ? bilan[0] : bilan
      const { texte: avisSkuVendeur, erreur: erreurSkuVendeur } = await traiterSkusFormulaire(data[0].id, user?.id)
      if (r?.gardes_pleins > 0) {
        annonce(fin(
          t('prod.enregistreGardes', { n: r.gardes_pleins })),
          'erreur',
        )
      } else {
        annonce(fin((idEnEdition ? t('prod.modifie') : t('prod.ajoute')) + avisSkuVendeur),
          avisImage || erreurSkuVendeur ? 'erreur' : 'succes')
      }

      setModaleOuverte(false)
      charger()
      return
    }

    // Les entrepôts choisis deviennent des lignes de stock à zéro. On ne
    // retire que celles encore vides : supprimer une ligne qui contient de
    // la marchandise effacerait un inventaire d'un clic.
    const produitId = data[0].id
    const dejaLa = stocks.filter((st) => st.produit_id === produitId)
    const aCreer = entrepotsChoisis.filter((eid) => !dejaLa.some((st) => st.entrepot_id === eid))
    const aRetirer = dejaLa.filter((st) => !entrepotsChoisis.includes(st.entrepot_id))

    if (aCreer.length > 0) {
      const { error: errStock } = await supabase.from('stocks').insert(
        aCreer.map((eid) => ({
          tenant_id: tenantKey, produit_id: produitId, entrepot_id: eid,
          quantite_disponible: 0, quantite_defectueuse: 0,
        })),
      )
      if (errStock) {
        setEnregistrement(false)
        return annonce(t('prod.entrepotsRefuses', { erreur: messageErreur(errStock) }), 'erreur')
      }
    }

    // « Vide » = EXACTEMENT 0 (11/11, T22 : une ligne négative comptait comme vide
    // et disparaissait sans trace — la base refuse aussi, stock_portes.sql).
    const vides = aRetirer.filter((st) => Number(st.quantite_disponible || 0) === 0 && Number(st.quantite_defectueuse || 0) === 0)
    const pleins = aRetirer.filter((st) => !vides.includes(st))

    if (vides.length > 0) {
      await supabase.from('stocks').delete().in('id', vides.map((st) => st.id))
    }

    const { texte: avisSku, erreur: erreurSku } = await traiterSkusFormulaire(produitId, data[0].vendeur_id)

    setEnregistrement(false)

    if (pleins.length > 0) {
      annonce(fin(
        t('prod.enregistreStock', { n: pleins.length })),
        'erreur',
      )
      setModaleOuverte(false)
      charger()
      return
    }

    annonce(fin((idEnEdition ? t('prod.modifie') : t('prod.ajoute')) + avisSku), avisImage || erreurSku ? 'erreur' : 'succes')
    setModaleOuverte(false)
    charger()
  }

  async function supprimer(p) {
    if (!(await confirmer({ titre: t('prod.supprimerProduit'), message: `Supprimer « ${p.product} » ?\n\nSes commandes, ses mouvements de stock et ses lignes d\u2019expédition gardent son nom. Ses lignes de stock disparaissent avec lui.`, bouton: t('prod.supprimer'), danger: true }))) return
    // L'image d'abord : la base ne sait pas supprimer un fichier, et une fois
    // le produit parti, plus personne n'a le droit de toucher au sien.
    if (p.image_chemin) {
      const err = await retirerImage(p.image_chemin)
      if (err) return annonce(t('prod.supprAnnulee', { erreur: err }), 'erreur')
    }
    const { error } = await supabase.from('produits').delete().eq('id', p.id).eq('tenant_id', tenantKey)
    if (error) {
      // Le fichier est déjà parti : le produit ne doit plus le désigner.
      if (p.image_chemin) await supabase.from('produits').update({ image_chemin: null }).eq('id', p.id).eq('tenant_id', tenantKey)
      charger()
      return annonce(t('prod.suppressionRefusee', { erreur: messageErreur(error) }), 'erreur')
    }
    annonce(t('prod.produitSupprimeMsg'), 'succes')
    charger()
  }

  function exporterHistorique() {
    const entetes = ['Entrepôt', 'Produit', 'Type', 'Avant', 'Mouvement', 'Après', 'Date', 'Raison']
    const lignes = mouvements.map((m) => [
      m.entrepots?.nom || '', ficheOuverte?.product || '',
      LIBELLE_MOUVEMENT[m.type_mouvement] || m.type_mouvement,
      m.stock_avant, (m.sens > 0 ? '+' : m.sens < 0 ? '-' : '') + m.quantite, m.stock_apres,
      m.created_at ? new Date(m.created_at).toLocaleString('fr-FR') : '', m.notes || '',
    ])
    telecharger(
      [entetes, ...lignes],
      `historique_${(ficheOuverte?.code || ficheOuverte?.product || 'produit').replace(/[^a-zA-Z0-9-]/g, '_')}.csv`,
    )
  }

  function telecharger(lignes, nomFichier) {
    const csv = contenuCSV(lignes)
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = nomFichier
    a.click()
    URL.revokeObjectURL(url)
  }

  function exporter() {
    const entetes = ['ID', 'Nom', 'Type', 'Code', 'En stock', 'Total', 'Défectueux', 'Prix', 'Up-sell', 'Cross-sell', 'Statut', 'Date']
    const lignes = affiches.map((p) => [
      p.id, p.product, p.type || 'Standard', p.code || '',
      p.current_quantity ?? 0, p.quantite_totale ?? 0, p.defected_quantity ?? 0,
      p.price ?? '', p.upsell || '', p.crosssell || '', p.statut || 'actif',
      p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '',
    ])
    const csv = contenuCSV([entetes, ...lignes])
    // Filtré par vendeur, le nom du fichier le dit : un export d'un vendeur
    // ne doit pas passer pour le catalogue entier.
    const suffixe = filtreVendeur ? `_vendeur-${pourNomDeFichier(nomFiltreVendeur)}` : ''
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `produits_${new Date().toISOString().slice(0, 10)}${suffixe}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading || permsLoading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">{t('commun.chargement2')}</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .pop-in { animation: popIn 0.18s ease-out; }
        .pr-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; background:#fff; }
        .pr-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        .pr-label { display:block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:rgba(27,38,50,.7); margin-bottom:6px; }
        .ch-input { width:100%; border:none; outline:none; background:transparent; font-size:15px; color:#1B2632; padding:4px 0 6px; }
        .ch-input::placeholder { color:rgba(27,38,50,.3); }
        select.ch-input { cursor:pointer; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        {/* En-tête compact (19/11) : le titre et le nombre affiché. */}
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-[#1B2632]">{t('prod.titre')}</h1>
          <span className="text-sm font-semibold text-[#1B2632]/50">{affiches.length}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[320px] focus-within:border-[#FFB162] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder={t('prod.recherche')}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="outline-none bg-transparent text-sm text-[#1B2632] font-medium w-full placeholder:text-[#1B2632]/30"
            />
            {recherche && (
              <button onClick={() => setRecherche('')} className="text-[#1B2632]/40 hover:text-[#A35139] text-xs">✕</button>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setPanneauFiltres((o) => !o)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
                panneauFiltres || nombreFiltres > 0
                  ? 'bg-[#1B2632] text-white border-[#1B2632]'
                  : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              {t('prod.filtres')}
              {nombreFiltres > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFB162] text-[#1B2632] text-[11px] font-bold flex items-center justify-center">
                  {nombreFiltres}
                </span>
              )}
            </button>

            {panneauFiltres && (
              <>
                <div className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" onClick={() => setPanneauFiltres(false)} />
                <div className="fixed inset-x-3 bottom-3 max-h-[85dvh] overflow-y-auto z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[280px] sm:max-h-none bg-white rounded-2xl border border-[#C9C1B1] shadow-xl p-5 pop-in">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-[#1B2632]/50">{t('prod.filtres')}</span>
                    {nombreFiltres > 0 && (
                      <button
                        onClick={() => { setFiltreType(''); setFiltreStatut(''); setFiltreUpsell('') }}
                        className="text-xs font-semibold text-[#A35139] hover:underline"
                      >
                        {t('prod.toutEffacer')}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="pr-label">{t('prod.type')}</label>
                      <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)} className="pr-input">
                        <option value="">{t('prod.tousTypes')}</option>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="pr-label">{t('prod.statut')}</label>
                      <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="pr-input">
                        <option value="">{t('prod.tous')}</option>
                        <option value="actif">{t('prod.actif')}</option>
                        <option value="inactif">{t('prod.inactif')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="pr-label">{'Up-sell'}</label>
                      <select value={filtreUpsell} onChange={(e) => setFiltreUpsell(e.target.value)} className="pr-input">
                        <option value="">{t('prod.peuImporte')}</option>
                        <option value="oui">{t('prod.utilise')}</option>
                        <option value="non">{t('prod.nonUtilise')}</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={() => setPanneauFiltres(false)} className="w-full mt-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                    {t('prod.appliquer')}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Au-dessus de la liste, jamais dans le panneau Filtres : il change ce
              qu'on croit être « le catalogue », il doit se voir. */}
          {peutFiltrerVendeur && (
            <select
              data-filtre-vendeur
              value={filtreVendeur}
              onChange={(e) => setFiltreVendeur(e.target.value)}
              title={t('prod.filtreVendeurAide')}
              className={`px-3 py-2.5 rounded-xl text-sm font-semibold shadow-sm border outline-none cursor-pointer max-w-full sm:max-w-[220px] ${
                filtreVendeur ? 'bg-[#1B2632] text-white border-[#1B2632]' : 'bg-white text-[#1B2632] border-[#C9C1B1]'
              }`}
            >
              <option value="">{t('prod.tousVendeurs')}</option>
              <option value={SANS_VENDEUR}>{t('prod.sansVendeur')}</option>
              {vendeurs.map((v) => <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>)}
            </select>
          )}

          <button
            onClick={() => setAnalyseOuverte((o) => !o)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
              analyseOuverte ? 'bg-[#A35139] text-white border-[#A35139]' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
            {analyseOuverte ? t('prod.masquerAnalyse') : t('prod.analyse')}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {!estSeller && propositions.length > 0 && (
              <button onClick={() => setPanneauPropositions(true)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                {propositions.length} SKU à valider
              </button>
            )}
            {skusInconnus.length > 0 && (
              <button onClick={() => setPanneauSku(true)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-[#FFB162]/20 text-[#8a5a1f] border border-[#FFB162] hover:bg-[#FFB162]/30 transition-colors">
                {skusInconnus.length} SKU inconnu{skusInconnus.length > 1 ? 's' : ''}
              </button>
            )}
            <button onClick={exporter} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm">
              {t('prod.exporterCsv')}
            </button>
            {peutGerer && (
              <button onClick={ouvrirCreation} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm">
                <span className="text-lg leading-none">+</span> {t('prod.nouveau')}
              </button>
            )}
          </div>
        </div>
        {filtreVendeur && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[#1B2632]/70">
              <b className="text-[#1B2632]">{nomFiltreVendeur}</b> : {affiches.length} produit{affiches.length > 1 ? 's' : ''} sur {affichesTousVendeurs.length}
            </span>
            <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[#1B2632] text-white text-xs font-semibold">
              Vendeur : {nomFiltreVendeur}
              <button onClick={() => setFiltreVendeur('')} aria-label={t('prod.retirerFiltreVendeur')} className="w-5 h-5 rounded-full hover:bg-white/20">✕</button>
            </span>
          </div>
        )}
      </header>

      {erreur && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-50 text-red-800 border border-red-200">
          <p className="font-bold mb-1">{t('prod.lectureImpossible')}</p>
          <p className="font-mono text-xs">{erreur}</p>
          <p className="mt-2 text-xs opacity-80">
            {t('prod.lectureAide')}
          </p>
        </div>
      )}

      {analyseOuverte && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm p-6 pop-in">
          {filtreVendeur && (
            <p data-analyse-titre className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-4">
              Analyse — {nomFiltreVendeur} seulement
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
            <Chiffre label={t('prod.titre')} valeur={analyse.total} detail={`${analyse.actifs} actifs`} />
            <Chiffre label={t('prod.enStock')} valeur={analyse.enStock} />
            <Chiffre label={t('prod.passeTotal')} valeur={analyse.cumul} />
            <Chiffre label={t('prod.defectueux')} valeur={analyse.defectueux} detail={`${analyse.tauxDefaut.toFixed(1)} % du total`} alerte={analyse.tauxDefaut > 5} />
            <Chiffre label={t('prod.valeurStock')} valeur={`${analyse.valeur.toLocaleString(locale, { maximumFractionDigits: 0 })}${deviseUnique ? ` ${deviseUnique}` : ''}`} />
            <Chiffre label={t('prod.enRupture')} valeur={analyse.ruptures.length} alerte={analyse.ruptures.length > 0} />
          </div>

          {analyse.ruptures.length > 0 && (
            <div className="mt-5 pt-5 border-t border-[#C9C1B1]/50">
              <p className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-2">
                {t('prod.actifsSansStock')}
              </p>
              <div className="flex flex-wrap gap-2">
                {analyse.ruptures.map((p) => (
                  <span key={p.id} className="px-2.5 py-1 rounded-lg bg-red-50 text-red-800 text-xs font-medium border border-red-200">
                    {p.product}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[#1B2632]/50 mt-4">
            {t('prod.analyseAide', { n: analyse.total })}
          </p>
        </div>
      )}

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                {/* Type, Up-sell, Cross-sell : dans la fiche (19/11) — dans la liste
                    ils disaient « Standard » et « Non utilisé » sur chaque ligne. */}
                <th className="px-5 py-4">{t('prod.code')}</th>
                <th className="px-5 py-4">{t('prod.nom')}</th>
                <th className="px-5 py-4 text-right">{t('prod.prix')}</th>
                <th className="px-5 py-4">{t('prod.enStock')}</th>
                <th className="px-5 py-4 text-right">{t('prod.total')}</th>
                <th className="px-5 py-4 text-right">{t('prod.defectueux')}</th>
                <th className="px-5 py-4">{t('prod.statut')}</th>
                <th className="px-5 py-4">{t('prod.ajouteLe')}</th>
                <th className="px-5 py-4 text-right sticky right-0 bg-[#F4F0E6]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">{t('commun.chargement2')}</td></tr>
              ) : affiches.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">
                    {produits.length === 0
                      ? (estSeller ? t('prod.aucunVous') : t('prod.aucunCatalogue'))
                      : filtreVendeur && affichesTousVendeurs.length > 0
                        ? t('prod.aucunPourVendeur', { nom: nomFiltreVendeur, n: affichesTousVendeurs.length })
                        : t('prod.aucunRecherche')}
                  </td>
                </tr>
              ) : (
                affiches.map((p) => {
                  const actif = (p.statut || 'actif') === 'actif'
                  return (
                    // La ligne entière ouvre la fiche (19/11) ; les boutons gardent leur clic.
                    <tr key={p.id} onClick={() => ouvrirFiche(p)} className="bg-white hover:bg-[#F3EFE7] transition-colors cursor-pointer">
                      <td className="px-5 py-4 font-mono text-xs text-[#A35139] font-semibold whitespace-nowrap">
                        {/* Pas un bout d'id à la place : il ressemblerait à un code que
                            l'import ne reconnaîtrait pas. */}
                        {p.code || <span className="font-sans font-normal text-[#1B2632]/40">{t('prod.sansCode')}</span>}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                        <VignetteProduit chemin={p.image_chemin} alt={p.product} />
                        <div className="min-w-0">
                        <div className="font-bold text-[#1B2632] max-w-[220px] truncate" title={p.product}>{p.product}</div>
                        {!estSeller && (
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">
                            {nomVendeur(p.vendeur_id) || <span className="italic">{t('prod.sansVendeurMin')}</span>}
                          </div>
                        )}
                        </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-bold text-[#1B2632] whitespace-nowrap">{prixLisible(p.price)}</td>
                      <td className="px-5 py-4"><QuantiteCellule total={p.current_quantity} parPays={parPays(p.id)} /></td>
                      <td className="px-5 py-4 text-right text-sm font-semibold text-[#1B2632]">{p.quantite_totale ?? 0}</td>
                      <td className={`px-5 py-4 text-right text-sm font-semibold ${(p.defected_quantity || 0) > 0 ? 'text-[#A35139]' : 'text-[#1B2632]/60'}`}>
                        {p.defected_quantity ?? 0}
                      </td>
                      <td className="px-5 py-4">
                        {/* Lecture seule : le statut se change dans la fiche,
                            avec le reste. Un clic de trop dans une liste
                            retirait un produit de la vente sans confirmation. */}
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold text-[#1B2632] inline-flex items-center gap-1.5 border ${actif ? 'bg-[#2E7D53]/15 border-[#2E7D53]/40' : 'bg-[#C9C1B1]/25 border-[#C9C1B1]'}`}>
                          <span className={`w-2 h-2 rounded-full ${actif ? 'bg-[#2E7D53]' : 'bg-[#1B2632]/30'}`} />
                          {actif ? t('prod.actif') : t('prod.inactif')}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#1B2632]/70 whitespace-nowrap">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString(locale) : '-'}
                      </td>
                      <td className="px-5 py-4 sticky right-0 bg-inherit" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => ouvrirFiche(p)} title={t('prod.detailsHistorique')}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          </button>
                          {peutGerer && (
                            <>
                              <button
                                onClick={() => ouvrirEdition(p)} title={t('prod.modifier')}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                              </button>
                              <button
                                onClick={() => supprimer(p)} title={t('prod.supprimer')}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-[#EEE9DF]/20 border-t border-[#C9C1B1]/50 px-6 py-3">
          <span className="text-sm text-[#1B2632]/60">
            {affiches.length} produit{affiches.length > 1 ? 's' : ''}
            {affiches.length !== produits.length && ` sur ${produits.length}`}
          </span>
        </div>
      </div>

      {panneauSku && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setPanneauSku(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center pointer-events-none">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[900px] my-8 p-6 pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[#1B2632]">{t('prod.skuInconnus')}</h2>
                <button onClick={() => setPanneauSku(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139]">✕</button>
              </div>
              <p className="text-sm text-[#1B2632]/60 mb-4">
                {t('prod.skuInconnusAide')}
              </p>
              {skusInconnus.length === 0 ? (
                <p className="text-sm text-[#1B2632]/50">{t('prod.aucunSkuInconnu')}</p>
              ) : (
                <div className="flex flex-col divide-y divide-[#C9C1B1]/40">
                  {skusInconnus.map((x) => {
                    const cle = `${x.source_id}|${x.sku}`
                    const c = choixInconnu[cle] || { produit: '', pack: String(packDuTitre(x.titre) || 1) }
                    const produitsVendeur = produits.filter((p) => p.vendeur_id && p.vendeur_id === (estSeller ? user?.id : x.vendeur_id))
                    return (
                      <div key={cle} className="py-3 grid grid-cols-1 md:grid-cols-[1.2fr_1fr_80px_auto] gap-2 items-center">
                        <div>
                          <p className="font-mono text-sm text-[#A35139]">{x.sku}</p>
                          <p className="text-xs text-[#1B2632]/60 truncate">{x.titre || '—'}</p>
                          <p className="text-[11px] text-[#1B2632]/40">{x.source_nom} · {x.nb_commandes} lead{x.nb_commandes > 1 ? 's' : ''} en attente</p>
                          {packDuTitre(x.titre) != null && Number(c.pack) !== packDuTitre(x.titre) && (
                            <p className="text-[11px] text-[#A35139] font-bold">⚠ le titre dit {packDuTitre(x.titre)}, le pack est {c.pack || '—'}</p>
                          )}
                        </div>
                        <select className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-sm" value={c.produit}
                          onChange={(e) => setChoixInconnu({ ...choixInconnu, [cle]: { ...c, produit: e.target.value } })}>
                          <option value="">{t('prod.produitChoix')}</option>
                          {produitsVendeur.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.product}</option>)}
                        </select>
                        <input type="number" min="1" max="100" className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-sm" title={t('prod.unitesPack')}
                          value={c.pack} onChange={(e) => setChoixInconnu({ ...choixInconnu, [cle]: { ...c, pack: e.target.value } })} />
                        {(peutGerer || estSeller) && (
                          <button onClick={() => ajouterSku(x.source_id, x.sku, c.produit, c.pack)}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D]">{estSeller ? 'Proposer' : 'Relier'}</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {panneauPropositions && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setPanneauPropositions(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center pointer-events-none">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[900px] my-8 p-6 pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[#1B2632]">{t('prod.skuProposesTitre')}</h2>
                <button onClick={() => setPanneauPropositions(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139]">✕</button>
              </div>
              <p className="text-sm text-[#1B2632]/60 mb-4">
                {t('prod.propositionsAide')}
              </p>
              {propositions.length === 0 ? (
                <p className="text-sm text-[#1B2632]/50">{t('prod.aucuneProposition')}</p>
              ) : (
                <div className="flex flex-col divide-y divide-[#C9C1B1]/40">
                  {propositions.map((x) => {
                    const pr = produits.find((p) => p.id === x.produit_id)
                    // le titre de la boutique : celui des commandes qui attendent ce SKU
                    const titre = skusInconnus.find((u) => u.source_id === x.source_id && String(u.sku).toLowerCase() === String(x.sku).toLowerCase())?.titre
                    return (
                      <div key={x.id} className="py-3 grid grid-cols-1 md:grid-cols-[1.2fr_1.2fr_70px_auto] gap-2 items-center">
                        <div>
                          <p className="font-mono text-sm text-[#A35139]">{x.sku}</p>
                          <p className="text-[11px] text-[#1B2632]/40">{sources.find((s2) => s2.id === x.source_id)?.nom || '—'} · {nomVendeur(x.propose_par) || '—'} · {new Date(x.propose_le).toLocaleDateString('fr-FR')}</p>
                          <VerifPack titre={titre} pack={x.multiplicateur} />
                        </div>
                        <p className="text-sm text-[#1B2632]">{pr ? `${pr.code ? pr.code + ' — ' : ''}${pr.product}` : '—'}</p>
                        <p className="text-sm font-mono text-center">× {x.multiplicateur}</p>
                        {peutGerer && (
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => refuserSku(x)} className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10">{t('prod.refuser')}</button>
                            <button onClick={() => approuverSku(x)} className="px-4 py-2 rounded-lg text-sm font-bold bg-green-600 text-white hover:bg-green-700">{t('prod.approuver')}</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {ficheOuverte && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setFicheOuverte(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1000px] my-8 pop-in">

              <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-t-2xl">
                <div className="flex items-start gap-4">
                <VignetteProduit chemin={ficheOuverte.image_chemin} taille={88} vide="rien" alt={ficheOuverte.product} />
                <div>
                  <p className="text-xs font-mono text-[#A35139] uppercase tracking-widest mb-1">
                    {ficheOuverte.code || ficheOuverte.id.slice(0, 8)}
                  </p>
                  <h2 className="text-xl font-bold text-[#1B2632]">{ficheOuverte.product}</h2>
                  {ficheOuverte.description && (
                    <p className="text-sm text-[#1B2632]/60 mt-1 max-w-[560px]">{ficheOuverte.description}</p>
                  )}
                </div>
                </div>
                <button onClick={() => setFicheOuverte(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
              </div>

              <div className="p-6 flex flex-col gap-6">

                <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
                  <Chiffre label={t('prod.enStock')} valeur={ficheOuverte.current_quantity ?? 0} />
                  <Chiffre label={t('prod.passeTotal')} valeur={ficheOuverte.quantite_totale ?? 0} />
                  <Chiffre label={t('prod.defectueux')} valeur={ficheOuverte.defected_quantity ?? 0} alerte={(ficheOuverte.defected_quantity || 0) > 0} />
                  <Chiffre label={t('prod.prix')} valeur={prixLisible(ficheOuverte.price)} />
                  <Chiffre label={t('prod.type')} valeur={ficheOuverte.type || 'Standard'} />
                </div>

                <div className="flex flex-wrap gap-6 text-sm border-t border-[#C9C1B1]/50 pt-5">
                  <Info label={t('prod.statut')} valeur={(ficheOuverte.statut || 'actif') === 'actif' ? t('prod.actif') : t('prod.inactif')} />
                  <Info label={t('prod.codeVariante')} valeur={ficheOuverte.code_variante} />
                  {!estSeller && <Info label={t('prod.vendeur')} valeur={nomVendeur(ficheOuverte.vendeur_id) || t('prod.sansVendeur')} />}
                  <Info label="Up-sell" valeur={nomLie(ficheOuverte.upsell_produit_id) || ficheOuverte.upsell} />
                  <Info label="Cross-sell" valeur={nomLie(ficheOuverte.crosssell_produit_id) || ficheOuverte.crosssell} />
                  <Info label={t('prod.ajouteLe')} valeur={ficheOuverte.created_at ? new Date(ficheOuverte.created_at).toLocaleDateString(locale) : null} />
                  {ficheOuverte.product_page && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-1">{t('prod.verification')}</p>
                      {estLienWeb(ficheOuverte.product_page) ? (
                        <a href={ficheOuverte.product_page.trim()} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-[#A35139] hover:underline">{t('prod.ouvrirLien')}</a>
                      ) : (
                        // Lien enregistré avant le 16/11 sans être vérifié : on le montre
                        // en texte, jamais en lien cliquable, pour qu'il soit corrigé.
                        <p className="text-sm font-medium text-[#A35139]" title={ficheOuverte.product_page}>
                          {t('prod.lienInvalide')}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Les SKU de boutique de ce produit (11/11, T20) — le vendeur les voit
                    aussi, et PROPOSE les siens (sku_propositions.sql). */}
                {(
                  <div className="border-t border-[#C9C1B1]/50 pt-5">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-2">{t('prod.skuBoutique')}</p>
                    {skusProduit.length === 0 ? (
                      <p className="text-sm text-[#1B2632]/50 mb-2">{t('prod.aucunSkuProduit')}</p>
                    ) : (
                      <table className="w-full text-sm mb-3">
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {skusProduit.map((m) => (
                            <tr key={m.id}>
                              <td className="py-2 font-mono text-[#A35139]">{m.sku}</td>
                              <td className="py-2 text-center font-mono">× {m.multiplicateur}</td>
                              <td className="py-2 text-[#1B2632]/60">{sources.find((x) => x.id === m.source_id)?.nom || '—'}</td>
                              <td className="py-2 text-xs text-[#1B2632]/40 truncate max-w-[260px]">{m.titre_vu || ''}</td>
                              {peutGerer && !estSeller && (
                                <td className="py-2 text-right">
                                  <button onClick={() => retirerSku(m)} title={t('prod.retirer')} className="w-7 h-7 rounded-full text-[#A35139] hover:bg-[#A35139]/10">×</button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {propositions.filter((x) => x.produit_id === ficheOuverte.id).length > 0 && (
                      <div className="mb-3 flex flex-col gap-1">
                        {propositions.filter((x) => x.produit_id === ficheOuverte.id).map((x) => (
                          <div key={x.id} className="flex items-center gap-3 text-sm px-3 py-2 rounded-lg bg-[#FFB162]/10 border border-[#FFB162]/40">
                            <span className="font-mono text-[#A35139]">{x.sku}</span>
                            <span className="font-mono">× {x.multiplicateur}</span>
                            <span className="text-xs text-[#8a5a1f]">{t('prod.enAttenteValidation')}</span>
                            <span className="ml-auto flex gap-2">
                              {!estSeller && peutGerer && (
                                <button onClick={() => approuverSku(x)} className="px-3 py-1 rounded-lg text-xs font-bold bg-green-600 text-white">{t('prod.approuver')}</button>
                              )}
                              {(estSeller || peutGerer) && (
                                <button onClick={() => refuserSku(x)} className="px-3 py-1 rounded-lg text-xs font-semibold border border-[#A35139]/40 text-[#A35139]">{estSeller ? t('prod.retirer') : t('prod.refuser')}</button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {peutGerer && (() => {
                      const boutiques = sources.filter((x) => x.vendeur_id && x.vendeur_id === ficheOuverte.vendeur_id)
                      if (!ficheOuverte.vendeur_id) return <p className="text-xs text-[#1B2632]/50">{t('prod.skuSansVendeur')}</p>
                      if (boutiques.length === 0) return <p className="text-xs text-[#1B2632]/50">{t('prod.vendeurSansBoutique')}</p>
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_1fr_auto] gap-2">
                          <input className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-sm" placeholder={t('prod.skuExemple')}
                            value={nouveauSku.sku} onChange={(e) => setNouveauSku({ ...nouveauSku, sku: e.target.value })} />
                          <input type="number" min="1" max="100" className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-sm" title={t('prod.unitesPack')}
                            value={nouveauSku.pack} onChange={(e) => setNouveauSku({ ...nouveauSku, pack: e.target.value })} />
                          <select className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-sm"
                            value={nouveauSku.source || (boutiques.length === 1 ? boutiques[0].id : '')}
                            onChange={(e) => setNouveauSku({ ...nouveauSku, source: e.target.value })}>
                            {boutiques.length > 1 && <option value="">{t('prod.boutiqueChoix')}</option>}
                            {boutiques.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                          </select>
                          <button onClick={() => ajouterSku(nouveauSku.source || (boutiques.length === 1 ? boutiques[0].id : ''), nouveauSku.sku, ficheOuverte.id, nouveauSku.pack)}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D]">{estSeller ? 'Proposer' : 'Ajouter'}</button>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Stock par entrepôt et historique : masqués au vendeur. Une
                    section vide lui ferait croire que le produit n'est nulle
                    part, alors qu'il n'a simplement pas à le savoir. */}
                {!estSeller && (
                <>
                <div className="border-t border-[#C9C1B1]/50 pt-5">
                  <p className="pr-label mb-3">{t('prod.stockParEntrepot')}</p>
                  {stocks.filter((st) => st.produit_id === ficheOuverte.id).length === 0 ? (
                    <p className="text-sm text-[#1B2632]/50">{t('prod.aucunEntrepotProduit')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {stocks.filter((st) => st.produit_id === ficheOuverte.id).map((st) => (
                        <span key={st.id} className="px-3.5 py-2 rounded-lg bg-[#EEE9DF] text-sm">
                          <span className="font-semibold text-[#1B2632]">{st.entrepots?.nom || '—'}</span>
                          <span className="text-[#1B2632]/60"> · {st.quantite_disponible ?? 0} en stock</span>
                          {(st.quantite_defectueuse || 0) > 0 && (
                            <span className="text-red-600"> · {st.quantite_defectueuse} déf.</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#C9C1B1]/50 pt-5">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="pr-label mb-0">{t('prod.historiqueStock')}</p>
                    {mouvements.length > 0 && (
                      <button onClick={exporterHistorique}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                        {t('prod.exporterCsv')}
                      </button>
                    )}
                  </div>

                  {mouvements.length === 0 ? (
                    <p className="text-sm text-[#1B2632]/50">
                      {t('prod.aucunMouvement')}
                    </p>
                  ) : (
                    <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                          <tr className="bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                            <th className="px-4 py-3">{t('prod.entrepot')}</th>
                            <th className="px-4 py-3">{t('prod.type')}</th>
                            <th className="px-4 py-3 text-right">{t('prod.avant')}</th>
                            <th className="px-4 py-3 text-right">{t('prod.mouvement')}</th>
                            <th className="px-4 py-3 text-right">{t('prod.apres')}</th>
                            <th className="px-4 py-3">{t('prod.date')}</th>
                            <th className="px-4 py-3">{t('prod.raison')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {mouvements.map((m) => (
                            <tr key={m.id} className="hover:bg-[#EEE9DF]/30">
                              <td className="px-4 py-3 font-medium text-[#1B2632] whitespace-nowrap">{m.entrepots?.nom || '—'}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-md bg-[#EEE9DF] text-[#1B2632]/70 text-xs font-medium whitespace-nowrap">
                                  {LIBELLE_MOUVEMENT[m.type_mouvement] ? t('mouv.' + m.type_mouvement) : m.type_mouvement}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-[#1B2632]/60">{m.stock_avant}</td>
                              <td className={`px-4 py-3 text-right font-mono font-bold ${m.sens > 0 ? 'text-green-700' : m.sens < 0 ? 'text-red-600' : 'text-[#1B2632]'}`}>
                                {m.sens > 0 ? '+' : m.sens < 0 ? '−' : ''}{m.quantite}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold text-[#1B2632]">{m.stock_apres}</td>
                              <td className="px-4 py-3 text-[#1B2632]/70 whitespace-nowrap">
                                {m.created_at ? new Date(m.created_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                              </td>
                              <td className="px-4 py-3 text-[#1B2632]/70 max-w-[200px]">{m.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-[11px] text-[#1B2632]/50 mt-2">
                    {t('prod.avantApresAide')}
                  </p>
                </div>
                </>
                )}

              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl">
                <button onClick={() => setFicheOuverte(null)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  {t('prod.fermer')}
                </button>
                {peutGerer && (
                  <button onClick={() => { const p = ficheOuverte; setFicheOuverte(null); ouvrirEdition(p) }}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                    {t('prod.modifier')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {modaleOuverte && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setModaleOuverte(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-2 sm:p-4 flex items-start justify-center">
            <form
              onSubmit={enregistrer}
              className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1000px] my-2 sm:my-8 pop-in"
            >
              <div className="flex items-center gap-3 px-5 sm:px-8 pt-6 sm:pt-7 pb-5 sm:pb-6">
                <button
                  type="button" onClick={() => setModaleOuverte(false)} title={t('prod.retour')}
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">
                  {idEnEdition ? t('prod.modifierProduit') : t('prod.nouveau')}
                </h2>
              </div>

              {/* items-start (19/11) : chaque champ garde sa hauteur. Étirés à la
                  hauteur du voisin, le lien (à côté de l'image) et le code
                  variante (à côté du code et de son aide) devenaient de grandes
                  boîtes vides. */}
              <div className="px-5 sm:px-8 pb-6 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 items-start">

                <Champ label={t('prod.nom')} requis>
                  <input className="ch-input" value={formulaire.product} required
                    onChange={(e) => setFormulaire({ ...formulaire, product: e.target.value })} />
                </Champ>

                <Champ label={t('prod.description')}>
                  <input className="ch-input" value={formulaire.description}
                    onChange={(e) => setFormulaire({ ...formulaire, description: e.target.value })} />
                </Champ>

                <Champ label={t('prod.code')} requis={!idEnEdition}
                  aide="Ce que le vendeur écrit dans la colonne Product de son fichier d'import : la référence (SKU) qu'il utilise déjà dans sa boutique.">
                  <input className="ch-input font-mono" placeholder={t('prod.exCode')} value={formulaire.code}
                    required={!idEnEdition}
                    onChange={(e) => setFormulaire({ ...formulaire, code: e.target.value })} />
                </Champ>

                <Champ label={t('prod.codeVariante')}>
                  <input className="ch-input font-mono" value={formulaire.code_variante}
                    onChange={(e) => setFormulaire({ ...formulaire, code_variante: e.target.value })} />
                </Champ>

                <Champ label={t('prod.lienVerification')} requis>
                  <input className="ch-input" type="url" required placeholder="https://..."
                    value={formulaire.product_page}
                    onChange={(e) => setFormulaire({ ...formulaire, product_page: e.target.value })} />
                </Champ>

                {/* L'image (26/10). Choisie ici, réduite par le navigateur (800 px,
                    WebP), envoyée seulement à « Enregistrer » — une fois le produit
                    créé. Le bucket refuse au-delà de 2 Mo. */}
                <Champ label={t('prod.image')} aide="JPG, PNG ou WebP. Réduite automatiquement avant l'envoi.">
                  {(() => {
                    const apercu = imageChoisie?.apercu || (!imageRetiree && urlImage(imageActuelle)) || null
                    return (
                      <div className="flex items-center gap-4 py-2">
                        <label className="w-[88px] h-[88px] shrink-0 rounded-lg border-2 border-dashed border-[#C9C1B1] hover:border-[#FFB162] bg-[#faf9f7] flex items-center justify-center cursor-pointer overflow-hidden transition-colors">
                          {apercu
                            ? <img src={apercu} alt="" className="w-full h-full object-cover" />
                            : <span className="text-xs text-[#1B2632]/40 text-center px-2">{t('prod.choisirImage')}</span>}
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                            onChange={(e) => { choisirImage(e.target.files?.[0]); e.target.value = '' }} />
                        </label>
                        <div className="flex flex-col gap-1.5 text-xs">
                          {imageChoisie && <span className="text-[#1B2632]/60">{t('prod.nouvelleImage')}</span>}
                          {/* Une nouvelle image choisie s'annule (on revient à l'actuelle) ;
                              sinon, l'image actuelle se retire à l'enregistrement. */}
                          {imageChoisie ? (
                            <button type="button" className="text-left text-[#A35139] hover:underline" onClick={oublierImage}>
                              {t('prod.annulerChoix')}
                            </button>
                          ) : imageActuelle && !imageRetiree && (
                            <button type="button" className="text-left text-[#A35139] hover:underline" onClick={() => setImageRetiree(true)}>
                              {t('prod.retirerImage')}
                            </button>
                          )}
                          {imageRetiree && <span className="text-[#1B2632]/60">{t('prod.imageRetiree')}</span>}
                          {erreurImage && <span className="text-[#A35139]">{erreurImage}</span>}
                        </div>
                      </div>
                    )
                  })()}
                </Champ>

                {estSeller ? (
                  /* Le vendeur choisit des PAYS, comme à l'import. La base crée
                     ensuite une ligne de stock à zéro dans chaque entrepôt du
                     pays : le dépôt sait où poser la marchandise, et le nom
                     des entrepôts ne sort jamais d'ici. */
                  <Champ label={t('prod.pays')} requis>
                    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                      {paysChoisis.map((pid) => {
                        const p = paysLivrables.find((x) => x.pays_id === pid)
                        return (
                          <span key={pid} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded bg-[#EEE9DF] border border-[#C9C1B1] text-sm text-[#1B2632]">
                            {p ? p.nom : t('prod.paysRetire')}
                            <button
                              type="button" title={t('prod.retirer')}
                              onClick={() => setPaysChoisis((prec) => prec.filter((x) => x !== pid))}
                              className="text-[#1B2632]/40 hover:text-[#A35139] transition-colors leading-none text-base"
                            >
                              ✕
                            </button>
                          </span>
                        )
                      })}

                      <select
                        className="ch-input flex-1 min-w-[150px]"
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return
                          setPaysChoisis((prec) => [...prec, e.target.value])
                        }}
                      >
                        <option value="">
                          {paysChoisis.length === 0 ? t('prod.choisirPays') : t('prod.ajouterChoix')}
                        </option>
                        {paysLivrables
                          .filter((p) => !paysChoisis.includes(p.pays_id))
                          .map((p) => (
                            <option key={p.pays_id} value={p.pays_id}>{p.nom}</option>
                          ))}
                      </select>
                    </div>

                    <p className="text-[11px] text-[#1B2632]/50 mt-1">
                      {paysLivrables.length === 0
                        ? t('prod.aucunPaysLivrable')
                        : t('prod.depotInterne')}
                    </p>
                  </Champ>
                ) : (
                <Champ label={t('prod.entrepots')} requis>
                  <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                    {entrepotsChoisis.map((eid) => {
                      const en = entrepots.find((x) => x.id === eid)
                      const ligne = stocks.find((st) => st.produit_id === idEnEdition && st.entrepot_id === eid)
                      const occupe = ligne && (ligne.quantite_disponible > 0 || ligne.quantite_defectueuse > 0)
                      return (
                        <span key={eid} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded bg-[#EEE9DF] border border-[#C9C1B1] text-sm text-[#1B2632]">
                          {en ? en.nom : t('prod.entrepotSupprime')}
                          {occupe && <span className="text-[11px] text-[#1B2632]/50">{ligne.quantite_disponible}</span>}
                          <button
                            type="button" title={t('prod.retirer')}
                            onClick={() => setEntrepotsChoisis((prec) => prec.filter((x) => x !== eid))}
                            className="text-[#1B2632]/40 hover:text-[#A35139] transition-colors leading-none text-base"
                          >
                            ✕
                          </button>
                        </span>
                      )
                    })}

                    <select
                      className="ch-input flex-1 min-w-[150px]"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return
                        setEntrepotsChoisis((prec) => [...prec, e.target.value])
                      }}
                    >
                      <option value="">
                        {entrepotsChoisis.length === 0 ? t('prod.choisirEntrepot') : t('prod.ajouterChoix')}
                      </option>
                      {entrepots
                        .filter((en) => !entrepotsChoisis.includes(en.id))
                        .map((en) => (
                          <option key={en.id} value={en.id}>
                            {en.nom}{en.pays?.nom ? ` — ${en.pays.nom}` : ''}
                          </option>
                        ))}
                    </select>
                  </div>

                  {entrepots.length === 0 && (
                    <p className="text-[11px] text-[#A35139] mt-1">
                      {t('prod.aucunEntrepot')}
                    </p>
                  )}
                </Champ>
                )}

                {/* Le prix. L'enregistrement le refuse s'il est vide — et la
                    case avait disparu du formulaire lors de la refonte : plus
                    aucun produit ne pouvait être créé, le message disant
                    « Le prix est obligatoire » sans qu'il y ait où l'écrire. */}
                <Champ label={t('prod.prix')} requis>
                  <input className="ch-input font-mono" type="number" step="0.01" min="0" required
                    placeholder="0.00" value={formulaire.price}
                    onChange={(e) => setFormulaire({ ...formulaire, price: e.target.value })} />
                </Champ>

                {/* Le vendeur ne choisit pas : ce qu'il crée est à lui. */}
                {!estSeller && (
                  <Champ label={t('prod.vendeur')} requis={!idEnEdition}
                    aide="Le vendeur à qui est ce produit : lui seul le verra parmi les vendeurs.">
                    <select className="ch-input" required={!idEnEdition} value={formulaire.vendeur_id}
                      onChange={(e) => setFormulaire({ ...formulaire, vendeur_id: e.target.value })}>
                      <option value="">{idEnEdition ? t('prod.sansVendeurAncien') : t('prod.choisirVendeur')}</option>
                      {vendeurs.map((v) => <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>)}
                    </select>
                    {vendeurs.length === 0 && (
                      <p className="text-[11px] text-[#A35139] mt-1">
                        {t('prod.aucunVendeur')}
                      </p>
                    )}
                  </Champ>
                )}

                {/* SKU de boutique dès la création (11/11) : facultatif. */}
                {peutGerer && (() => {
                  const vendeurDuProduit = estSeller ? user?.id : formulaire.vendeur_id
                  const boutiques = sources.filter((x) => x.vendeur_id && x.vendeur_id === vendeurDuProduit)
                  return (
                    <Champ label={t('prod.skuBoutique')} aide={estSeller
                      ? t('prod.skuAideVendeur')
                      : t('prod.skuAideResp')}>
                      {!vendeurDuProduit ? (
                        <p className="text-xs text-[#1B2632]/50">{t('prod.choisirVendeurDabord')}</p>
                      ) : boutiques.length === 0 ? (
                        <p className="text-xs text-[#1B2632]/50">{t('prod.vendeurSansBoutique2')}</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {boutiques.length > 1 && (
                            <select className="ch-input" value={sourceFormulaire} onChange={(e) => setSourceFormulaire(e.target.value)}>
                              <option value="">{t('prod.boutiqueChoix')}</option>
                              {boutiques.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                            </select>
                          )}
                          {skusFormulaire.map((x, i) => (
                            <div key={i} className="grid grid-cols-[1fr_80px_auto] gap-2">
                              <input className="ch-input" placeholder={t('prod.exSku')} value={x.sku}
                                onChange={(e) => setSkusFormulaire(skusFormulaire.map((y, j) => (j === i ? { ...y, sku: e.target.value } : y)))} />
                              <input type="number" min="1" max="100" className="ch-input" title={t('prod.unitesPack')} value={x.pack}
                                onChange={(e) => setSkusFormulaire(skusFormulaire.map((y, j) => (j === i ? { ...y, pack: e.target.value } : y)))} />
                              <button type="button" onClick={() => setSkusFormulaire(skusFormulaire.filter((_, j) => j !== i))}
                                className="w-9 rounded-lg text-[#A35139] hover:bg-[#A35139]/10">×</button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setSkusFormulaire([...skusFormulaire, { sku: '', pack: '1' }])}
                            className="self-start text-sm font-semibold text-[#A35139] hover:underline">{t('prod.ajouterSku')}</button>
                        </div>
                      )}
                    </Champ>
                  )
                })()}
              </div>

              {/* Le pied reste collé en bas de l'écran pendant qu'on remplit
                  (19/11) : « Enregistrer » était coupé sous le formulaire. */}
              <div className="sticky bottom-0 z-10 px-5 sm:px-8 py-4 flex justify-end gap-3 bg-white border-t border-[#C9C1B1]/60 rounded-b-2xl">
                <button type="button" onClick={() => setModaleOuverte(false)}
                  className="px-6 py-3 rounded-xl text-sm font-semibold border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors">
                  {t('prod.annuler')}
                </button>
                <button type="submit" disabled={enregistrement}
                  className="flex-1 sm:flex-none px-12 py-3 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors disabled:opacity-50 shadow-sm">
                  {enregistrement ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}

// Le libellé posé sur le trait du cadre, comme dans ShipLead. Un <fieldset>
// et sa <legend> font ça nativement : le navigateur ouvre le trait à la bonne
// largeur tout seul, sans calcul ni position absolue à ajuster.
// Le nombre d'unités écrit dans le titre de la boutique (« … – 3 unidades » → 3),
// pour vérifier le pack d'un SKU (11/11). null = le titre ne le dit pas.
function packDuTitre(titre) {
  const m = String(titre || '').match(/(\d+)\s*(unidades?|units?|unités?|pi[eè]ces?|pcs)(?![a-z])/i)
  return m ? parseInt(m[1], 10) : null
}

// Le titre reçu de la boutique et ce qu'il dit du pack, face au pack proposé.
function VerifPack({ titre, pack }) {
  const { t } = useLangue()
  if (!titre) return <p className="text-[11px] text-[#8a5a1f]">{t('prod.pasCommandeSku')}</p>
  const n = packDuTitre(titre)
  return (
    <div className="text-[11px] leading-snug">
      <p className="text-[#1B2632]/60">Titre de la boutique : « {titre} »</p>
      {n == null ? (
        <p className="text-[#8a5a1f]">{t('prod.titreSansUnites')}</p>
      ) : Number(pack) === n ? (
        <p className="text-green-700 font-semibold">✓ le titre dit {n} — pack {pack}</p>
      ) : (
        <p className="text-[#A35139] font-bold">⚠ le titre dit {n}, le pack est {pack || '—'}</p>
      )}
    </div>
  )
}

function Champ({ label, requis, aide, children }) {
  return (
    <fieldset className="border border-[#C9C1B1] rounded-lg px-3.5 pb-2.5 pt-1 focus-within:border-[#1B2632] transition-colors">
      <legend className="px-1.5 text-xs font-medium text-[#1B2632]/70">
        {label}{requis && <span className="text-[#A35139]"> *</span>}
      </legend>
      {children}
      {aide && <p className="text-[11px] text-[#1B2632]/40 mt-1">{aide}</p>}
    </fieldset>
  )
}

function Info({ label, valeur }) {
  if (!valeur) return null
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-1">{label}</p>
      <p className="text-sm font-medium text-[#1B2632]">{valeur}</p>
    </div>
  )
}

function Chiffre({ label, valeur, detail, alerte }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${alerte ? 'text-[#A35139]' : 'text-[#1B2632]'}`}>{valeur}</p>
      {detail && <p className="text-xs text-[#1B2632]/50 mt-0.5">{detail}</p>}
    </div>
  )
}