'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

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
  product: '', code: '', code_variante: '', seller: '', type: 'Standard',
  price: '', current_quantity: '', quantite_totale: '', defected_quantity: '',
  upsell_produit_id: '', crosssell_produit_id: '',
  description: '', product_page: '', statut: 'actif',
}

// Un up-sell désigne un produit du catalogue. Quand il est renseigné, on
// montre lequel : « ✓ » tout seul obligeait à ouvrir la fiche pour savoir.
// `texte` est l'ancienne saisie libre, encore affichée tant que l'écran
// Paramètres peut l'écrire — mais en gris, pour qu'on voie que ce n'est pas
// un vrai lien.
function CelluleVente({ lie, texte }) {
  if (lie) {
    return (
      <span className="inline-flex items-center gap-1.5 max-w-[150px]">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-green-500 text-white shrink-0">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
        <span className="text-xs font-medium text-[#1B2632] truncate" title={lie}>{lie}</span>
      </span>
    )
  }
  if (texte) {
    return <span className="text-xs text-[#1B2632]/50 italic max-w-[150px] truncate inline-block" title={`Ancienne saisie libre : ${texte}`}>{texte}</span>
  }
  return <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 text-[11px] font-medium whitespace-nowrap">Non utilisé</span>
}

function QuantiteCellule({ total, parPays }) {
  return (
    <div>
      <span className="inline-block px-2.5 py-1 rounded-full bg-[#EDE7FB] text-[#5B3FA8] text-xs font-semibold whitespace-nowrap">
        Total : {total ?? 0}
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

export default function ProduitsPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId
  const peutGerer = hasPermission('gerer_produits')

  const [produits, setProduits] = useState([])
  const [stocksParProduit, setStocksParProduit] = useState({})
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState({ texte: '', type: '' })

  const [recherche, setRecherche] = useState('')
  const [filtreType, setFiltreType] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreUpsell, setFiltreUpsell] = useState('')
  const [panneauFiltres, setPanneauFiltres] = useState(false)
  const [analyseOuverte, setAnalyseOuverte] = useState(false)

  const [entrepots, setEntrepots] = useState([])
  const [entrepotsDuProduit, setEntrepotsDuProduit] = useState([])
  const [stocks, setStocks] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [ficheOuverte, setFicheOuverte] = useState(null)
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)
  const [formulaire, setFormulaire] = useState(VIDE)
  const [idEnEdition, setIdEnEdition] = useState(null)

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
      setErreur(error.message)
      setProduits([])
      setChargement(false)
      return
    }
    setProduits(data || [])

    // Détail par pays : stocks -> entrepôt -> pays. Facultatif, et on ne
    // bloque pas l'écran si ces tables ne répondent pas.
    const { data: stocks } = await supabase
      .from('stocks')
      .select('id, produit_id, entrepot_id, quantite_disponible, quantite_defectueuse, entrepots(nom, pays(nom))')
      .eq('tenant_id', tenantKey)

    setStocks(stocks || [])

    const { data: entrepotsDB } = await supabase
      .from('entrepots').select('id, nom, pays_id').eq('tenant_id', tenantKey).order('nom')
    setEntrepots(entrepotsDB || [])

    const regroupe = {}
    for (const s of stocks || []) {
      const nomPays = s.entrepots?.pays?.nom
      if (!nomPays || !s.produit_id) continue
      regroupe[s.produit_id] = regroupe[s.produit_id] || {}
      regroupe[s.produit_id][nomPays] = (regroupe[s.produit_id][nomPays] || 0) + (s.quantite_disponible || 0)
    }
    setStocksParProduit(regroupe)

    setChargement(false)
  }, [tenantKey])

  useEffect(() => { if (tenantKey && !permsLoading) charger() }, [tenantKey, permsLoading, charger])

  function parPays(produitId) {
    const d = stocksParProduit[produitId]
    if (!d) return []
    return Object.entries(d).map(([nom, quantite]) => ({ nom, quantite }))
  }

  // Le filtrage se fait sur la liste déjà chargée : un catalogue tient en
  // quelques dizaines de lignes, inutile d'aller-retour sur le serveur.
  const affiches = useMemo(() => {
    const r = recherche.trim().toLowerCase()
    return produits.filter((p) => {
      if (r && !`${p.product || ''} ${p.code || ''} ${p.seller || ''}`.toLowerCase().includes(r)) return false
      if (filtreType && (p.type || 'Standard') !== filtreType) return false
      if (filtreStatut && (p.statut || 'actif') !== filtreStatut) return false
      if (filtreUpsell === 'oui' && !p.upsell) return false
      if (filtreUpsell === 'non' && p.upsell) return false
      return true
    })
  }, [produits, recherche, filtreType, filtreStatut, filtreUpsell])

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
    return produits.find((p) => p.id === id)?.product || 'Produit supprimé'
  }, [produits])

  // L'historique ne stocke pas le « avant / après ». On le reconstitue en
  // partant du stock d'aujourd'hui et en remontant mouvement par mouvement :
  // le chiffre du haut colle donc toujours au stock réel, ce qu'un compteur
  // calculé depuis le début ne garantirait pas si un mouvement manquait.
  const SENS = { entree: 1, retour_ok: 1, ajustement: 1, sortie: -1, retour_defaut: -1 }

  async function ouvrirFiche(p) {
    setFicheOuverte(p)
    setMouvements([])

    const { data, error } = await supabase
      .from('mouvements_stock')
      .select('id, entrepot_id, type_mouvement, quantite, notes, created_at, entrepots(nom)')
      .eq('tenant_id', tenantKey)
      .eq('produit_id', p.id)
      .order('created_at', { ascending: false })

    if (error) { annonce('Historique illisible : ' + error.message, 'erreur'); return }

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

  function ouvrirCreation() {
    setFormulaire(VIDE)
    setEntrepotsDuProduit([])
    setIdEnEdition(null)
    setModaleOuverte(true)
  }

  function ouvrirEdition(p) {
    setFormulaire({
      product: p.product || '', code: p.code || '', code_variante: p.code_variante || '',
      seller: p.seller || '', type: p.type || 'Standard', price: p.price ?? '',
      current_quantity: p.current_quantity ?? '', quantite_totale: p.quantite_totale ?? '',
      defected_quantity: p.defected_quantity ?? '',
      upsell_produit_id: p.upsell_produit_id || '', crosssell_produit_id: p.crosssell_produit_id || '',
      description: p.description || '',
      product_page: p.product_page || '', statut: p.statut || 'actif',
    })
    setEntrepotsDuProduit(stocks.filter((st) => st.produit_id === p.id).map((st) => st.entrepot_id))
    setIdEnEdition(p.id)
    setModaleOuverte(true)
  }

  function annonce(texte, type) {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 6000)
  }

  async function enregistrer(e) {
    e.preventDefault()
    if (!tenantKey) return
    if (!formulaire.product.trim()) return annonce('Le nom du produit est obligatoire.', 'erreur')
    if (formulaire.price === '' || Number.isNaN(Number(formulaire.price))) {
      return annonce('Le prix est obligatoire.', 'erreur')
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
      seller: formulaire.seller.trim() || null,
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
      return annonce('Enregistrement refusé : ' + error.message, 'erreur')
    }
    if (!data || data.length === 0) {
      setEnregistrement(false)
      return annonce("Aucune modification enregistrée : votre rôle ne permet pas de gérer les produits.", 'erreur')
    }

    // Les entrepôts cochés deviennent des lignes de stock à zéro. On n'ajoute
    // que ce qui manque et on ne retire que ce qui est encore vide : supprimer
    // une ligne qui contient de la marchandise effacerait un inventaire.
    const produitId = data[0].id
    const dejaLa = stocks.filter((st) => st.produit_id === produitId)
    const aCreer = entrepotsDuProduit.filter((eid) => !dejaLa.some((st) => st.entrepot_id === eid))
    const aRetirer = dejaLa.filter((st) => !entrepotsDuProduit.includes(st.entrepot_id))

    if (aCreer.length > 0) {
      const { error: errStock } = await supabase.from('stocks').insert(
        aCreer.map((eid) => ({
          tenant_id: tenantKey, produit_id: produitId, entrepot_id: eid,
          quantite_disponible: 0, quantite_defectueuse: 0,
        })),
      )
      if (errStock) {
        setEnregistrement(false)
        return annonce('Produit enregistré, mais les entrepôts ont été refusés : ' + errStock.message, 'erreur')
      }
    }

    const vides = aRetirer.filter((st) => !(st.quantite_disponible > 0) && !(st.quantite_defectueuse > 0))
    const pleins = aRetirer.filter((st) => st.quantite_disponible > 0 || st.quantite_defectueuse > 0)

    if (vides.length > 0) {
      await supabase.from('stocks').delete().in('id', vides.map((st) => st.id))
    }

    setEnregistrement(false)

    if (pleins.length > 0) {
      annonce(
        `Produit enregistré. ${pleins.length} entrepôt${pleins.length > 1 ? 's ont' : ' a'} été conservé${pleins.length > 1 ? 's' : ''} : il y reste de la marchandise. Videz le stock avant de les retirer.`,
        'erreur',
      )
      setModaleOuverte(false)
      charger()
      return
    }

    annonce(idEnEdition ? 'Produit modifié.' : 'Produit ajouté.', 'succes')
    setModaleOuverte(false)
    charger()
  }

  async function supprimer(p) {
    if (!window.confirm(`Supprimer « ${p.product} » ?\n\nLes commandes passées gardent son nom, mais il disparaîtra du catalogue. Le désactiver est souvent préférable.`)) return
    const { error } = await supabase.from('produits').delete().eq('id', p.id).eq('tenant_id', tenantKey)
    if (error) return annonce('Suppression refusée : ' + error.message, 'erreur')
    annonce('Produit supprimé.', 'succes')
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
    const csv = lignes
      .map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
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
    const csv = [entetes, ...lignes]
      .map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `produits_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading || permsLoading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .pop-in { animation: popIn 0.18s ease-out; }
        .pr-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; background:#fff; }
        .pr-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        .pr-label { display:block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:rgba(27,38,50,.7); margin-bottom:6px; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">Catalogue</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2632]">Produits</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[320px] focus-within:border-[#FFB162] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Nom, code, vendeur..."
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
              Filtres
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
                    <span className="text-xs font-bold uppercase tracking-widest text-[#1B2632]/50">Filtres</span>
                    {nombreFiltres > 0 && (
                      <button
                        onClick={() => { setFiltreType(''); setFiltreStatut(''); setFiltreUpsell('') }}
                        className="text-xs font-semibold text-[#A35139] hover:underline"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="pr-label">Type</label>
                      <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)} className="pr-input">
                        <option value="">Tous les types</option>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="pr-label">Statut</label>
                      <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="pr-input">
                        <option value="">Tous</option>
                        <option value="actif">Actif</option>
                        <option value="inactif">Inactif</option>
                      </select>
                    </div>
                    <div>
                      <label className="pr-label">Up-sell</label>
                      <select value={filtreUpsell} onChange={(e) => setFiltreUpsell(e.target.value)} className="pr-input">
                        <option value="">Peu importe</option>
                        <option value="oui">Utilisé</option>
                        <option value="non">Non utilisé</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={() => setPanneauFiltres(false)} className="w-full mt-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                    Appliquer
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setAnalyseOuverte((o) => !o)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
              analyseOuverte ? 'bg-[#A35139] text-white border-[#A35139]' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
            {analyseOuverte ? "Masquer l'analyse" : 'Analyse'}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={exporter} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm">
              Exporter CSV
            </button>
            {peutGerer && (
              <button onClick={ouvrirCreation} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm">
                <span className="text-lg leading-none">+</span> Nouveau produit
              </button>
            )}
          </div>
        </div>
      </header>

      {message.texte && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'succes'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.texte}
        </div>
      )}

      {erreur && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-50 text-red-800 border border-red-200">
          <p className="font-bold mb-1">Lecture impossible</p>
          <p className="font-mono text-xs">{erreur}</p>
          <p className="mt-2 text-xs opacity-80">
            Si le message parle d'une colonne absente, le fichier
            <span className="font-mono"> produits_catalogue.sql </span>
            n'a pas encore été lancé.
          </p>
        </div>
      )}

      {analyseOuverte && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm p-6 pop-in">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
            <Chiffre label="Produits" valeur={analyse.total} detail={`${analyse.actifs} actifs`} />
            <Chiffre label="En stock" valeur={analyse.enStock} />
            <Chiffre label="Passé au total" valeur={analyse.cumul} />
            <Chiffre label="Défectueux" valeur={analyse.defectueux} detail={`${analyse.tauxDefaut.toFixed(1)} % du total`} alerte={analyse.tauxDefaut > 5} />
            <Chiffre label="Valeur du stock" valeur={analyse.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} />
            <Chiffre label="En rupture" valeur={analyse.ruptures.length} alerte={analyse.ruptures.length > 0} />
          </div>

          {analyse.ruptures.length > 0 && (
            <div className="mt-5 pt-5 border-t border-[#C9C1B1]/50">
              <p className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-2">
                Actifs mais sans stock — ils peuvent être vendus au téléphone
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
            Ces chiffres portent sur les {analyse.total} produit{analyse.total > 1 ? 's' : ''} affiché{analyse.total > 1 ? 's' : ''},
            donc sur la recherche et les filtres en cours.
          </p>
        </div>
      )}

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto">
          <table className="w-full min-w-[1150px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">Nom</th>
                <th className="px-5 py-4">Type</th>
                <th className="px-5 py-4">En stock</th>
                <th className="px-5 py-4">Total</th>
                <th className="px-5 py-4">Défectueux</th>
                <th className="px-5 py-4">Up-sell</th>
                <th className="px-5 py-4">Cross-sell</th>
                <th className="px-5 py-4">Statut</th>
                <th className="px-5 py-4">Ajouté le</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="11" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : affiches.length === 0 ? (
                <tr>
                  <td colSpan="11" className="px-6 py-12 text-center text-[#1B2632]/60">
                    {produits.length === 0
                      ? 'Aucun produit dans le catalogue.'
                      : 'Aucun produit ne correspond à cette recherche.'}
                  </td>
                </tr>
              ) : (
                affiches.map((p) => {
                  const actif = (p.statut || 'actif') === 'actif'
                  return (
                    <tr key={p.id} className="hover:bg-[#EEE9DF]/40 transition-colors">
                      <td className="px-5 py-4 font-mono text-xs text-[#A35139] font-semibold whitespace-nowrap">
                        {p.code || p.id.slice(0, 8)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-[#1B2632] max-w-[220px] truncate" title={p.product}>{p.product}</div>
                        {p.seller && <div className="text-xs text-[#1B2632]/50 mt-0.5">{p.seller}</div>}
                        {p.price !== null && p.price !== undefined && (
                          <div className="text-xs font-mono font-semibold text-[#1B2632]/70 mt-0.5">{p.price}</div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 rounded-md bg-[#EEE9DF] text-[#1B2632]/70 text-xs font-medium whitespace-nowrap">
                          {p.type || 'Standard'}
                        </span>
                      </td>
                      <td className="px-5 py-4"><QuantiteCellule total={p.current_quantity} parPays={parPays(p.id)} /></td>
                      <td className="px-5 py-4">
                        <span className="inline-block px-2.5 py-1 rounded-full bg-[#EDE7FB] text-[#5B3FA8] text-xs font-semibold whitespace-nowrap">
                          Total : {p.quantite_totale ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                          (p.defected_quantity || 0) > 0 ? 'bg-red-50 text-red-700' : 'bg-[#EDE7FB] text-[#5B3FA8]'
                        }`}>
                          Total : {p.defected_quantity ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-4"><CelluleVente lie={nomLie(p.upsell_produit_id)} texte={p.upsell} /></td>
                      <td className="px-5 py-4"><CelluleVente lie={nomLie(p.crosssell_produit_id)} texte={p.crosssell} /></td>
                      <td className="px-5 py-4">
                        {/* Lecture seule : le statut se change dans la fiche,
                            avec le reste. Un clic de trop dans une liste
                            retirait un produit de la vente sans confirmation. */}
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white inline-block ${actif ? 'bg-green-500' : 'bg-[#1B2632]/30'}`}>
                          {actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#1B2632]/70 whitespace-nowrap">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '-'}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => ouvrirFiche(p)} title="Détails et historique du stock"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          </button>
                          {peutGerer && (
                            <>
                              <button
                                onClick={() => ouvrirEdition(p)} title="Modifier"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                              </button>
                              <button
                                onClick={() => supprimer(p)} title="Supprimer"
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

      {ficheOuverte && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setFicheOuverte(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1000px] my-8 pop-in">

              <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-t-2xl">
                <div>
                  <p className="text-xs font-mono text-[#A35139] uppercase tracking-widest mb-1">
                    {ficheOuverte.code || ficheOuverte.id.slice(0, 8)}
                  </p>
                  <h2 className="text-xl font-bold text-[#1B2632]">{ficheOuverte.product}</h2>
                  {ficheOuverte.description && (
                    <p className="text-sm text-[#1B2632]/60 mt-1 max-w-[560px]">{ficheOuverte.description}</p>
                  )}
                </div>
                <button onClick={() => setFicheOuverte(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
              </div>

              <div className="p-6 flex flex-col gap-6">

                <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
                  <Chiffre label="En stock" valeur={ficheOuverte.current_quantity ?? 0} />
                  <Chiffre label="Passé au total" valeur={ficheOuverte.quantite_totale ?? 0} />
                  <Chiffre label="Défectueux" valeur={ficheOuverte.defected_quantity ?? 0} alerte={(ficheOuverte.defected_quantity || 0) > 0} />
                  <Chiffre label="Prix" valeur={ficheOuverte.price ?? '—'} />
                  <Chiffre label="Type" valeur={ficheOuverte.type || 'Standard'} />
                </div>

                <div className="flex flex-wrap gap-6 text-sm border-t border-[#C9C1B1]/50 pt-5">
                  <Info label="Statut" valeur={(ficheOuverte.statut || 'actif') === 'actif' ? 'Actif' : 'Inactif'} />
                  <Info label="Code variante" valeur={ficheOuverte.code_variante} />
                  <Info label="Vendeur" valeur={ficheOuverte.seller} />
                  <Info label="Up-sell" valeur={nomLie(ficheOuverte.upsell_produit_id) || ficheOuverte.upsell} />
                  <Info label="Cross-sell" valeur={nomLie(ficheOuverte.crosssell_produit_id) || ficheOuverte.crosssell} />
                  <Info label="Ajouté le" valeur={ficheOuverte.created_at ? new Date(ficheOuverte.created_at).toLocaleDateString('fr-FR') : null} />
                  {ficheOuverte.product_page && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-1">Vérification</p>
                      <a href={ficheOuverte.product_page} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium text-[#A35139] hover:underline">Ouvrir le lien</a>
                    </div>
                  )}
                </div>

                <div className="border-t border-[#C9C1B1]/50 pt-5">
                  <p className="pr-label mb-3">Stock par entrepôt</p>
                  {stocks.filter((st) => st.produit_id === ficheOuverte.id).length === 0 ? (
                    <p className="text-sm text-[#1B2632]/50">Ce produit n&apos;est rattaché à aucun entrepôt.</p>
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
                    <p className="pr-label mb-0">Historique du stock</p>
                    {mouvements.length > 0 && (
                      <button onClick={exporterHistorique}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                        Exporter CSV
                      </button>
                    )}
                  </div>

                  {mouvements.length === 0 ? (
                    <p className="text-sm text-[#1B2632]/50">
                      Aucun mouvement enregistré. Ils se déclarent dans Paramètres → Mouvements de stock.
                    </p>
                  ) : (
                    <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                          <tr className="bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                            <th className="px-4 py-3">Entrepôt</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3 text-right">Avant</th>
                            <th className="px-4 py-3 text-right">Mouvement</th>
                            <th className="px-4 py-3 text-right">Après</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Raison</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {mouvements.map((m) => (
                            <tr key={m.id} className="hover:bg-[#EEE9DF]/30">
                              <td className="px-4 py-3 font-medium text-[#1B2632] whitespace-nowrap">{m.entrepots?.nom || '—'}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-md bg-[#EEE9DF] text-[#1B2632]/70 text-xs font-medium whitespace-nowrap">
                                  {LIBELLE_MOUVEMENT[m.type_mouvement] || m.type_mouvement}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-[#1B2632]/60">{m.stock_avant}</td>
                              <td className={`px-4 py-3 text-right font-mono font-bold ${m.sens > 0 ? 'text-green-700' : m.sens < 0 ? 'text-red-600' : 'text-[#1B2632]'}`}>
                                {m.sens > 0 ? '+' : m.sens < 0 ? '−' : ''}{m.quantite}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold text-[#1B2632]">{m.stock_apres}</td>
                              <td className="px-4 py-3 text-[#1B2632]/70 whitespace-nowrap">
                                {m.created_at ? new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                              </td>
                              <td className="px-4 py-3 text-[#1B2632]/70 max-w-[200px]">{m.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-[11px] text-[#1B2632]/50 mt-2">
                    « Avant » et « Après » sont reconstitués en remontant depuis le stock actuel : la ligne du haut
                    correspond donc toujours au stock réel d&apos;aujourd&apos;hui.
                  </p>
                </div>

              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl">
                <button onClick={() => setFicheOuverte(null)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Fermer
                </button>
                {peutGerer && (
                  <button onClick={() => { const p = ficheOuverte; setFicheOuverte(null); ouvrirEdition(p) }}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                    Modifier
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
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <form
              onSubmit={enregistrer}
              className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[720px] my-8 pop-in"
            >
              <div className="flex justify-between items-center px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-t-2xl">
                <h2 className="text-lg font-bold text-[#1B2632]">
                  {idEnEdition ? 'Modifier le produit' : 'Nouveau produit'}
                </h2>
                <button type="button" onClick={() => setModaleOuverte(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
              </div>

              <div className="p-6 flex flex-col gap-6">

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <label className="pr-label">Nom *</label>
                    <input className="pr-input" value={formulaire.product} required
                      onChange={(e) => setFormulaire({ ...formulaire, product: e.target.value })} />
                  </div>
                  <div>
                    <label className="pr-label">Description</label>
                    <input className="pr-input" value={formulaire.description}
                      onChange={(e) => setFormulaire({ ...formulaire, description: e.target.value })} />
                  </div>

                  <div>
                    <label className="pr-label">Code (SKU)</label>
                    <input className="pr-input font-mono" placeholder="Ajouter un code" value={formulaire.code}
                      onChange={(e) => setFormulaire({ ...formulaire, code: e.target.value })} />
                  </div>
                  <div>
                    <label className="pr-label">Code variante</label>
                    <input className="pr-input font-mono" value={formulaire.code_variante}
                      onChange={(e) => setFormulaire({ ...formulaire, code_variante: e.target.value })} />
                  </div>

                  <div>
                    <label className="pr-label">Lien de vérification *</label>
                    <input className="pr-input" type="url" required placeholder="https://..."
                      value={formulaire.product_page}
                      onChange={(e) => setFormulaire({ ...formulaire, product_page: e.target.value })} />
                  </div>
                  <div>
                    <label className="pr-label">Vendeur</label>
                    <input className="pr-input" value={formulaire.seller}
                      onChange={(e) => setFormulaire({ ...formulaire, seller: e.target.value })} />
                  </div>
                </div>

                <div className="border-t border-[#C9C1B1]/50 pt-5">
                  <p className="pr-label mb-3">Entrepôts *</p>
                  {entrepots.length === 0 ? (
                    <p className="text-sm text-[#A35139]">
                      Aucun entrepôt configuré. À créer dans Paramètres → Entrepôts.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {entrepots.map((en) => {
                        const coche = entrepotsDuProduit.includes(en.id)
                        const ligne = stocks.find((st) => st.produit_id === idEnEdition && st.entrepot_id === en.id)
                        const occupe = ligne && (ligne.quantite_disponible > 0 || ligne.quantite_defectueuse > 0)
                        return (
                          <button
                            key={en.id} type="button"
                            onClick={() => setEntrepotsDuProduit((prec) =>
                              prec.includes(en.id) ? prec.filter((x) => x !== en.id) : [...prec, en.id])}
                            className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              coche
                                ? 'bg-[#1B2632] text-white border-[#1B2632]'
                                : 'bg-white text-[#1B2632] border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                            }`}
                          >
                            {en.nom}
                            {occupe && (
                              <span className={`ml-2 text-[11px] ${coche ? 'text-white/70' : 'text-[#1B2632]/50'}`}>
                                {ligne.quantite_disponible} en stock
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-[#1B2632]/50 mt-2">
                    Un entrepôt décoché n&apos;est retiré que s&apos;il est vide : on n&apos;efface pas un inventaire d&apos;un clic.
                  </p>
                </div>

                <div className="border-t border-[#C9C1B1]/50 pt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="pr-label">Type</label>
                    <select className="pr-input" value={formulaire.type}
                      onChange={(e) => setFormulaire({ ...formulaire, type: e.target.value })}>
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="pr-label">Prix *</label>
                    <input type="number" step="0.01" className="pr-input" required value={formulaire.price}
                      onChange={(e) => setFormulaire({ ...formulaire, price: e.target.value })} />
                  </div>
                  <div>
                    <label className="pr-label">Statut</label>
                    <select className="pr-input" value={formulaire.statut}
                      onChange={(e) => setFormulaire({ ...formulaire, statut: e.target.value })}>
                      <option value="actif">Actif</option>
                      <option value="inactif">Inactif</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="pr-label">Quantité en stock</label>
                    <input type="number" className="pr-input" value={formulaire.current_quantity}
                      onChange={(e) => setFormulaire({ ...formulaire, current_quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="pr-label">Quantité totale</label>
                    <input type="number" className="pr-input" value={formulaire.quantite_totale}
                      onChange={(e) => setFormulaire({ ...formulaire, quantite_totale: e.target.value })} />
                    <p className="text-[11px] text-[#1B2632]/50 mt-1">Laissée vide, elle vaut stock + défectueux.</p>
                  </div>
                  <div>
                    <label className="pr-label">Quantité défectueuse</label>
                    <input type="number" className="pr-input" value={formulaire.defected_quantity}
                      onChange={(e) => setFormulaire({ ...formulaire, defected_quantity: e.target.value })} />
                  </div>
                </div>

                <div className="border-t border-[#C9C1B1]/50 pt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="pr-label">Up-sell</label>
                    {/* Un produit du catalogue, pas un mot : « coffret » ne disait
                        pas lequel, et un renommage laissait un texte orphelin. */}
                    <select className="pr-input" value={formulaire.upsell_produit_id}
                      onChange={(e) => setFormulaire({ ...formulaire, upsell_produit_id: e.target.value })}>
                      <option value="">Non utilisé</option>
                      {produits.filter((x) => x.id !== idEnEdition && (x.statut || 'actif') === 'actif')
                        .map((x) => <option key={x.id} value={x.id}>{x.product}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="pr-label">Cross-sell</label>
                    <select className="pr-input" value={formulaire.crosssell_produit_id}
                      onChange={(e) => setFormulaire({ ...formulaire, crosssell_produit_id: e.target.value })}>
                      <option value="">Non utilisé</option>
                      {produits.filter((x) => x.id !== idEnEdition && (x.statut || 'actif') === 'actif')
                        .map((x) => <option key={x.id} value={x.id}>{x.product}</option>)}
                    </select>
                  </div>
                </div>

              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl">
                <button type="button" onClick={() => setModaleOuverte(false)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors disabled:opacity-50">
                  {enregistrement ? 'Enregistrement...' : idEnEdition ? 'Enregistrer' : 'Ajouter le produit'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
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