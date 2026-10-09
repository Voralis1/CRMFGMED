'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import { PAYS_MONDE, drapeau, paysParNom } from '../../lib/paysMonde'

// Le seller déclare, le responsable tranche. L'écran ne fait que refléter
// cette règle — c'est la base qui la tient : le trigger remet toute création
// d'un seller en attente, à son nom, même envoyée hors de l'application.

const MODES = ['Maritime', 'Aérien', 'Express', 'Routier']

const STATUTS = {
  en_attente:   { label: 'En attente',    classe: 'border-[#FFB162] text-[#8a5a1f] bg-[#FFB162]/10' },
  confirmee:    { label: 'Confirmée',     classe: 'border-green-500 text-green-700 bg-green-50' },
  en_transit:   { label: 'En transit',    classe: 'border-[#2C3B4D] text-[#2C3B4D] bg-[#2C3B4D]/5' },
  receptionnee: { label: 'Réceptionnée',  classe: 'border-emerald-600 text-emerald-700 bg-emerald-50' },
  refusee:      { label: 'Refusée',       classe: 'border-red-400 text-red-700 bg-red-50' },
}

const VIDE = {
  poids_kg: '', mode_transport: 'Maritime', details: '',
  transporteur: '', transporteur_telephone: '',
  pays: '', pays_code: '', entrepot_destination_id: '', pays_destination_id: '',
  date_expedition: '', date_reception: '',
}

function Statut({ valeur }) {
  const s = STATUTS[valeur] || { label: valeur || '—', classe: 'border-[#C9C1B1] text-[#1B2632]/60 bg-white' }
  return (
    <span className={`inline-block px-4 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap ${s.classe}`}>
      {s.label}
    </span>
  )
}

function dateCourte(v) {
  if (!v) return '—'
  const d = new Date(v)
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

// `datetime-local` veut "YYYY-MM-DDTHH:mm" et rien d'autre.
function pourInput(v) {
  if (!v) return ''
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ExpeditionsPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId
  const peutCreer = hasPermission('creer_expedition')
  const peutConfirmer = hasPermission('confirmer_expedition')

  const [expeditions, setExpeditions] = useState([])
  const [vendeurs, setVendeurs] = useState([])
  // Un vendeur ne voit pas les entrepôts : Casablanca, Rabat et leur nombre
  // sont l'organisation interne de FGMED. Il choisit un PAYS de destination,
  // et c'est un responsable qui dira plus tard dans quel dépôt la
  // marchandise atterrit.
  const estSeller = String(roleNom || '').toLowerCase() === 'seller'
  const [entrepots, setEntrepots] = useState([])
  const [paysLivrables, setPaysLivrables] = useState([])
  const [catalogue, setCatalogue] = useState([])
  // Les produits transportés, pendant la saisie. Ils ne partent en base
  // qu'une fois l'expédition créée : avant, il n'y a pas d'identifiant
  // auquel les rattacher.
  const [lignes, setLignes] = useState([])
  const [selecteurProduit, setSelecteurProduit] = useState(false)
  const [selecteurPays, setSelecteurPays] = useState(false)
  const [recherchePays, setRecherchePays] = useState('')
  const [rechercheProduit, setRechercheProduit] = useState('')
  const [nbProduits, setNbProduits] = useState({})
  const [receptionEnCours, setReceptionEnCours] = useState(null)
  const [dateReception, setDateReception] = useState('')
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState({ texte: '', type: '' })

  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreMode, setFiltreMode] = useState('')
  const [filtrePays, setFiltrePays] = useState('')
  const [panneauFiltres, setPanneauFiltres] = useState(false)
  const [analyseOuverte, setAnalyseOuverte] = useState(false)

  const [modale, setModale] = useState(false)
  const [formulaire, setFormulaire] = useState(VIDE)
  const [idEnEdition, setIdEnEdition] = useState(null)
  const [enregistrement, setEnregistrement] = useState(false)
  const [refusEnCours, setRefusEnCours] = useState(null)
  const [motifRefus, setMotifRefus] = useState('')
  const [detailOuvert, setDetailOuvert] = useState(null)

  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) router.replace('/')
      else if (!hasPermission('menu_expeditions')) router.replace('/dashboard')
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const charger = useCallback(async () => {
    if (!tenantKey) return
    setChargement(true)
    setErreur('')

    const { data, error } = await supabase
      .from('expeditions')
      .select('*')
      .eq('tenant_id', tenantKey)
      .order('created_at', { ascending: false })

    if (error) {
      setErreur(error.message)
      setExpeditions([])
      setChargement(false)
      return
    }
    setExpeditions(data || [])

    // Pour nommer le vendeur. La RLS fait le tri : un responsable reçoit
    // l'équipe, un seller ne reçoit que sa propre ligne.
    const { data: gens } = await supabase
      .from('user_roles')
      .select('user_id, email, nom')
      .eq('tenant_id', tenantKey)
    setVendeurs(gens || [])

    // L'entrepôt qui reçoit, avec son pays pour le distinguer : deux dépôts
    // peuvent s'appeler « Central ».
    if (estSeller) {
      // La vue ne rend que des noms de pays, jamais d'entrepôt : ce qu'on ne
      // charge pas ne peut pas fuiter dans la réponse réseau.
      const { data: paysDB } = await supabase
        .from('v_pays_livrables').select('pays_id, nom').eq('tenant_id', tenantKey).order('nom')
      setPaysLivrables(paysDB || [])
      setEntrepots([])
    } else {
      const { data: entrepotsDB } = await supabase
        .from('entrepots').select('id, nom, pays(nom)').eq('tenant_id', tenantKey).order('nom')
      setEntrepots(entrepotsDB || [])
    }

    // Seuls les produits encore en vente sont proposés : en expédier un retiré
    // du catalogue est presque toujours une erreur de saisie.
    const { data: prodDB } = await supabase
      .from('produits').select('id, product, code, statut')
      .eq('tenant_id', tenantKey).order('product')
    setCatalogue((prodDB || []).filter((p) => (p.statut || 'actif') === 'actif'))

    // Combien de produits par expédition, pour la liste. La RLS ne renvoie
    // que les lignes des expéditions déjà visibles, le compte est donc juste.
    const { data: toutesLignes } = await supabase
      .from('expeditions_produits').select('expedition_id, quantite')
      .eq('tenant_id', tenantKey)
    const compte = {}
    for (const l of toutesLignes || []) {
      compte[l.expedition_id] = compte[l.expedition_id] || { articles: 0, pieces: 0 }
      compte[l.expedition_id].articles += 1
      compte[l.expedition_id].pieces += l.quantite || 0
    }
    setNbProduits(compte)

    setChargement(false)
  }, [tenantKey])

  useEffect(() => { if (tenantKey && !permsLoading) charger() }, [tenantKey, permsLoading, charger])

  const nomVendeur = useCallback((id) => {
    if (!id) return '—'
    const v = vendeurs.find((x) => x.user_id === id)
    if (!v) return id === user?.id ? 'Moi' : '—'
    return v.nom || v.email || '—'
  }, [vendeurs, user])

  const affichees = useMemo(() => {
    const r = recherche.trim().toLowerCase()
    return expeditions.filter((e) => {
      if (r && !`${e.reference || ''} ${e.transporteur || ''} ${e.pays || ''} ${e.details || ''}`.toLowerCase().includes(r)) return false
      if (filtreStatut && e.statut !== filtreStatut) return false
      if (filtreMode && e.mode_transport !== filtreMode) return false
      if (filtrePays && e.pays !== filtrePays) return false
      return true
    })
  }, [expeditions, recherche, filtreStatut, filtreMode, filtrePays])

  // Les pays de départ déjà saisis, pour le filtre et pour la saisie assistée.
  // Le pays de DÉPART, saisi librement. La destination, elle, est un entrepôt.
  const listePaysSaisis = useMemo(
    () => [...new Set(expeditions.map((e) => e.pays).filter(Boolean))].sort(),
    [expeditions],
  )

  const analyse = useMemo(() => {
    const parStatut = {}
    for (const e of affichees) parStatut[e.statut] = (parStatut[e.statut] || 0) + 1
    const poids = affichees.reduce((s, e) => s + Number(e.poids_kg || 0), 0)
    // Le délai ne se calcule que sur ce qui est arrivé : une expédition encore
    // en mer fausserait la moyenne vers le bas.
    const arrivees = affichees.filter((e) => e.date_expedition && e.date_reception)
    const delai = arrivees.length
      ? arrivees.reduce((s, e) => s + (new Date(e.date_reception) - new Date(e.date_expedition)), 0)
        / arrivees.length / 86400000
      : null
    return {
      total: affichees.length,
      enAttente: parStatut.en_attente || 0,
      confirmees: parStatut.confirmee || 0,
      enTransit: parStatut.en_transit || 0,
      recues: parStatut.receptionnee || 0,
      refusees: parStatut.refusee || 0,
      poids, delai, parStatut,
    }
  }, [affichees])

  const nombreFiltres = [filtreStatut, filtreMode, filtrePays].filter(Boolean).length

  function annonce(texte, type) {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 6000)
  }

  function ouvrirCreation() {
    setFormulaire(VIDE)
    setLignes([])
    setIdEnEdition(null)
    setModale(true)
  }

  async function ouvrirEdition(e) {
    setFormulaire({
      poids_kg: e.poids_kg ?? '',
      mode_transport: e.mode_transport || 'Maritime',
      details: e.details || '',
      transporteur: e.transporteur || '',
      transporteur_telephone: e.transporteur_telephone || '',
      pays: e.pays || '',
      pays_code: e.pays_code || paysParNom(e.pays)?.code || '',
      entrepot_destination_id: e.entrepot_destination_id || '',
      pays_destination_id: e.pays_destination_id || '',
      date_expedition: pourInput(e.date_expedition),
      date_reception: pourInput(e.date_reception),
    })
    const { data } = await supabase
      .from('expeditions_produits')
      .select('produit_id, quantite')
      .eq('expedition_id', e.id)
    setLignes((data || []).map((l) => ({ produit_id: l.produit_id, quantite: l.quantite })))
    setIdEnEdition(e.id)
    setModale(true)
  }

  function ajouterProduit(p) {
    setLignes((prec) => {
      // Déjà dans la liste : on incrémente plutôt que d'ajouter une
      // deuxième ligne — la base refuse le doublon de toute façon.
      if (prec.some((l) => l.produit_id === p.id)) {
        return prec.map((l) => (l.produit_id === p.id ? { ...l, quantite: l.quantite + 1 } : l))
      }
      return [...prec, { produit_id: p.id, quantite: 1 }]
    })
    setSelecteurProduit(false)
    setRechercheProduit('')
  }

  function nomProduit(id) {
    const p = catalogue.find((x) => x.id === id)
    return p ? p.product : 'Produit retiré du catalogue'
  }

  async function enregistrer(ev) {
    ev.preventDefault()
    if (!tenantKey) return
    if (!formulaire.pays.trim()) return annonce('Le pays de provenance est obligatoire.', 'erreur')

    const donnees = {
      poids_kg: formulaire.poids_kg === '' ? null : Number(formulaire.poids_kg),
      mode_transport: formulaire.mode_transport || null,
      details: formulaire.details.trim() || null,
      transporteur: formulaire.transporteur.trim() || null,
      transporteur_telephone: formulaire.transporteur_telephone.trim() || null,
      pays: formulaire.pays.trim(),
      pays_code: formulaire.pays_code || null,
      entrepot_destination_id: estSeller ? null : (formulaire.entrepot_destination_id || null),
      // Le vendeur n'a choisi qu'un pays : on n'invente pas d'entrepôt pour
      // lui. Le responsable le renseignera à la confirmation.
      pays_destination_id: estSeller ? (formulaire.pays_destination_id || null) : null,
      date_expedition: formulaire.date_expedition || null,
    }
    // La date de réception appartient au responsable : c'est lui qui constate
    // l'arrivée. L'envoyer depuis le formulaire d'un vendeur l'écraserait avec
    // une valeur vide à chaque correction.
    if (peutConfirmer) donnees.date_reception = formulaire.date_reception || null

    setEnregistrement(true)
    const requete = idEnEdition
      ? supabase.from('expeditions').update(donnees).eq('id', idEnEdition).eq('tenant_id', tenantKey).select()
      : supabase.from('expeditions').insert([{ ...donnees, tenant_id: tenantKey, vendeur_id: user?.id }]).select()

    const { data, error } = await requete

    if (error) {
      setEnregistrement(false)
      return annonce('Enregistrement refusé : ' + error.message, 'erreur')
    }
    if (!data || data.length === 0) {
      setEnregistrement(false)
      return annonce("Aucune modification enregistrée : cette expédition ne vous appartient plus.", 'erreur')
    }

    // Les produits transportés. On remplace la liste entière plutôt que de
    // calculer les différences : sur une poignée de lignes c'est plus sûr,
    // et un écart de calcul ici laisserait un produit fantôme dans une
    // expédition confirmée.
    const expeditionId = data[0].id
    const { error: erreurPurge } = await supabase
      .from('expeditions_produits').delete().eq('expedition_id', expeditionId)

    if (erreurPurge) {
      setEnregistrement(false)
      return annonce("Expédition enregistrée, mais ses produits n'ont pas pu être mis à jour : " + erreurPurge.message, 'erreur')
    }

    if (lignes.length > 0) {
      const { error: erreurLignes } = await supabase.from('expeditions_produits').insert(
        lignes.map((l) => ({
          tenant_id: tenantKey,
          expedition_id: expeditionId,
          produit_id: l.produit_id,
          quantite: Math.max(1, parseInt(l.quantite, 10) || 1),
        })),
      )
      if (erreurLignes) {
        setEnregistrement(false)
        return annonce("Expédition enregistrée, mais ses produits ont été refusés : " + erreurLignes.message, 'erreur')
      }
    }

    setEnregistrement(false)

    annonce(
      idEnEdition
        ? 'Expédition modifiée.'
        : peutConfirmer
          ? 'Expédition créée.'
          : 'Expédition déclarée. Elle attend la confirmation d\'un responsable.',
      'succes',
    )
    setModale(false)
    charger()
  }

  async function changerStatut(e, statut, motif = null) {
    const maj = { statut }
    if (motif !== null) maj.motif_refus = motif

    const { data, error } = await supabase
      .from('expeditions').update(maj)
      .eq('id', e.id).eq('tenant_id', tenantKey).select()

    if (error) return annonce('Refusé par la base : ' + error.message, 'erreur')
    if (!data || data.length === 0) {
      return annonce("Votre rôle ne permet pas de confirmer une expédition.", 'erreur')
    }
    annonce(`Expédition ${STATUTS[statut]?.label.toLowerCase() || statut}.`, 'succes')
    setRefusEnCours(null)
    setMotifRefus('')
    charger()
  }

  // La réception enregistre deux choses d'un coup : le statut et la date. Les
  // séparer laisserait une expédition « réceptionnée » sans date d'arrivée,
  // et le délai moyen deviendrait faux.
  async function marquerReceptionnee(e, date) {
    const { data, error } = await supabase
      .from('expeditions')
      .update({ statut: 'receptionnee', date_reception: date || null })
      .eq('id', e.id).eq('tenant_id', tenantKey).select()

    if (error) return annonce('Refusé par la base : ' + error.message, 'erreur')
    if (!data || data.length === 0) {
      return annonce("Votre rôle ne permet pas de marquer une réception.", 'erreur')
    }
    annonce('Réception enregistrée.', 'succes')
    setReceptionEnCours(null)
    charger()
  }

  async function supprimer(e) {
    if (!window.confirm(`Supprimer l'expédition ${e.reference} ?`)) return
    const { error } = await supabase.from('expeditions').delete().eq('id', e.id).eq('tenant_id', tenantKey)
    if (error) return annonce('Suppression refusée : ' + error.message, 'erreur')
    annonce('Expédition supprimée.', 'succes')
    charger()
  }

  // Où va la marchandise, dit avec les mots de celui qui regarde : le nom de
  // l'entrepôt pour un responsable, le seul nom du pays pour un vendeur.
  function destinationNom(e) {
    if (estSeller) {
      return paysLivrables.find((p) => p.pays_id === e.pays_destination_id)?.nom || ''
    }
    return entrepots.find((x) => x.id === e.entrepot_destination_id)?.nom || ''
  }

  function exporter() {
    const entetes = ['Référence', 'Poids (Kg)', 'Mode', 'Détails', 'Produits', 'Transporteur', 'Téléphone', 'Depuis', 'Vers', 'Date expédition', 'Date réception', 'Statut', 'Déclarée par', 'Motif du refus']
    const lignesCsv = affichees.map((e) => [
      e.reference, e.poids_kg ?? '', e.mode_transport || '', e.details || '',
      nbProduits[e.id] ? `${nbProduits[e.id].articles} produits / ${nbProduits[e.id].pieces} pieces` : '',
      e.transporteur || '', e.transporteur_telephone || '', e.pays || '',
      destinationNom(e),
      e.date_expedition ? dateCourte(e.date_expedition) : '',
      e.date_reception ? dateCourte(e.date_reception) : '',
      STATUTS[e.statut]?.label || e.statut, nomVendeur(e.vendeur_id), e.motif_refus || '',
    ])
    const csv = [entetes, ...lignes]
      .map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `expeditions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading || permsLoading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes popIn { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in { animation: popIn .18s ease-out; }
        .ex-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:10px 12px; font-size:14px; outline:none; background:#fff; }
        .ex-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        .ex-label { display:block; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:rgba(27,38,50,.7); margin-bottom:6px; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">Logistique</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2632]">Expéditions</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[340px] focus-within:border-[#FFB162] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Référence, transporteur, pays..."
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="outline-none bg-transparent text-sm text-[#1B2632] font-medium w-full placeholder:text-[#1B2632]/30"
            />
            {recherche && <button onClick={() => setRecherche('')} className="text-[#1B2632]/40 hover:text-[#A35139] text-xs">✕</button>}
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
                        onClick={() => { setFiltreStatut(''); setFiltreMode(''); setFiltrePays('') }}
                        className="text-xs font-semibold text-[#A35139] hover:underline"
                      >
                        Tout effacer
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="ex-label">Statut</label>
                      <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="ex-input">
                        <option value="">Tous les statuts</option>
                        {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="ex-label">Mode de transport</label>
                      <select value={filtreMode} onChange={(e) => setFiltreMode(e.target.value)} className="ex-input">
                        <option value="">Tous les modes</option>
                        {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="ex-label">Pays</label>
                      <select value={filtrePays} onChange={(e) => setFiltrePays(e.target.value)} className="ex-input">
                        <option value="">Tous les pays</option>
                        {listePaysSaisis.map((p) => <option key={p} value={p}>{p}</option>)}
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
            {peutCreer && (
              <button onClick={ouvrirCreation} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm">
                <span className="text-lg leading-none">+</span> Nouvelle expédition
              </button>
            )}
          </div>
        </div>

        {/* Le seller doit savoir, avant de saisir, que ça ne vaut rien sans
            validation — sinon il croit l'expédition enregistrée et partie. */}
        {peutCreer && !peutConfirmer && (
          <p className="text-xs text-[#1B2632]/60 bg-[#FFB162]/10 border border-[#FFB162]/40 rounded-xl px-4 py-2.5">
            Vos expéditions sont enregistrées <strong>en attente</strong> : un admin ou un manager doit les confirmer.
            Tant que personne n'a tranché, vous pouvez encore les corriger.
          </p>
        )}
      </header>

      {message.texte && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'succes' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.texte}
        </div>
      )}

      {erreur && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-50 text-red-800 border border-red-200">
          <p className="font-bold mb-1">Lecture impossible</p>
          <p className="font-mono text-xs">{erreur}</p>
          <p className="mt-2 text-xs opacity-80">
            Si le message dit que la table n&apos;existe pas, le fichier
            <span className="font-mono"> expeditions.sql </span>n&apos;a pas encore été lancé.
          </p>
        </div>
      )}

      {peutConfirmer && analyse.enAttente > 0 && (
        <div className="px-4 py-3 rounded-xl bg-[#FFB162]/15 border border-[#FFB162]/50 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-semibold text-[#8a5a1f]">
            {analyse.enAttente} expédition{analyse.enAttente > 1 ? 's' : ''} attend{analyse.enAttente > 1 ? 'ent' : ''} votre confirmation
          </span>
          <button
            onClick={() => setFiltreStatut('en_attente')}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors"
          >
            Les afficher
          </button>
        </div>
      )}

      {analyseOuverte && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm p-6 pop-in">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-5">
            <Chiffre label="Expéditions" valeur={analyse.total} />
            <Chiffre label="En attente" valeur={analyse.enAttente} alerte={analyse.enAttente > 0} />
            <Chiffre label="Confirmées" valeur={analyse.confirmees} />
            <Chiffre label="En transit" valeur={analyse.enTransit} />
            <Chiffre label="Réceptionnées" valeur={analyse.recues} />
            <Chiffre label="Refusées" valeur={analyse.refusees} alerte={analyse.refusees > 0} />
            <Chiffre label="Poids total" valeur={`${analyse.poids.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`} />
          </div>
          {analyse.delai !== null && (
            <p className="text-sm text-[#1B2632]/70 mt-5 pt-5 border-t border-[#C9C1B1]/50">
              Délai moyen entre expédition et réception : <strong>{analyse.delai.toFixed(1)} jours</strong>
              <span className="text-xs text-[#1B2632]/50"> — calculé seulement sur les expéditions arrivées.</span>
            </p>
          )}
          <p className="text-[11px] text-[#1B2632]/50 mt-3">
            Ces chiffres portent sur les {analyse.total} expédition{analyse.total > 1 ? 's' : ''} affichée{analyse.total > 1 ? 's' : ''}.
          </p>
        </div>
      )}

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto">
          <table className="w-full min-w-[1200px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">Poids (Kg)</th>
                <th className="px-5 py-4">Transport</th>
                <th className="px-5 py-4">Détails</th>
                <th className="px-5 py-4">Transporteur</th>
                <th className="px-5 py-4">Pays</th>
                <th className="px-5 py-4">Date expédition</th>
                <th className="px-5 py-4">Date réception</th>
                <th className="px-5 py-4">Statut</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="10" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : affichees.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-6 py-12 text-center text-[#1B2632]/60">
                    {expeditions.length === 0 ? 'Aucune expédition.' : 'Aucune expédition ne correspond à cette recherche.'}
                  </td>
                </tr>
              ) : (
                affichees.map((e) => {
                  const enAttente = e.statut === 'en_attente'
                  return (
                    <tr key={e.id} className="hover:bg-[#EEE9DF]/40 transition-colors align-top">
                      <td className="px-5 py-4 font-mono text-xs text-[#A35139] font-semibold whitespace-nowrap">
                        {e.reference}
                        <div className="text-[11px] text-[#1B2632]/40 font-sans mt-1">{nomVendeur(e.vendeur_id)}</div>
                      </td>
                      <td className="px-5 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                        {e.poids_kg ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 rounded-md bg-[#EEE9DF] text-[#1B2632]/70 text-xs font-medium whitespace-nowrap">
                          {e.mode_transport || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {e.details ? (
                          <button
                            onClick={() => setDetailOuvert(detailOuvert === e.id ? null : e.id)}
                            className="text-sm text-[#1B2632] text-left max-w-[200px] hover:text-[#A35139] transition-colors"
                          >
                            <span className={detailOuvert === e.id ? '' : 'line-clamp-2'}>{e.details}</span>
                          </button>
                        ) : <span className="text-[#1B2632]/30">—</span>}
                        {nbProduits[e.id] && (
                          <div className="text-xs text-[#1B2632]/60 mt-1 whitespace-nowrap">
                            {nbProduits[e.id].articles} produit{nbProduits[e.id].articles > 1 ? 's' : ''}
                            <span className="text-[#1B2632]/40"> · {nbProduits[e.id].pieces} pièce{nbProduits[e.id].pieces > 1 ? 's' : ''}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-[#1B2632]">{e.transporteur || '—'}</div>
                        {e.transporteur_telephone && (
                          <div className="text-xs font-mono text-[#A35139] mt-0.5">{e.transporteur_telephone}</div>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-[#1B2632] flex items-center gap-1.5">
                          {e.pays_code && <span className="text-base leading-none">{drapeau(e.pays_code)}</span>}
                          {e.pays || '—'}
                        </div>
                        {destinationNom(e) && (
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">
                            → {destinationNom(e)}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#1B2632]/80 whitespace-nowrap">{dateCourte(e.date_expedition)}</td>
                      <td className="px-5 py-4 text-sm text-[#1B2632]/80 whitespace-nowrap">{dateCourte(e.date_reception)}</td>
                      <td className="px-5 py-4">
                        <Statut valeur={e.statut} />
                        {e.statut === 'refusee' && e.motif_refus && (
                          <div className="text-[11px] text-red-700 mt-1.5 max-w-[160px]">{e.motif_refus}</div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {peutConfirmer && enAttente && (
                            <>
                              <button
                                onClick={() => changerStatut(e, 'confirmee')}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-500 text-white hover:bg-green-600 transition-colors whitespace-nowrap"
                              >
                                Confirmer
                              </button>
                              <button
                                onClick={() => { setRefusEnCours(e); setMotifRefus('') }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-red-700 border border-red-300 hover:bg-red-50 transition-colors whitespace-nowrap"
                              >
                                Refuser
                              </button>
                            </>
                          )}
                          {peutConfirmer && e.statut === 'confirmee' && (
                            <button
                              onClick={() => changerStatut(e, 'en_transit')}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2C3B4D] text-white hover:bg-[#1B2632] transition-colors whitespace-nowrap"
                            >
                              En transit
                            </button>
                          )}
                          {peutConfirmer && e.statut === 'en_transit' && (
                            <button
                              onClick={() => {
                                setReceptionEnCours(e)
                                // Par défaut aujourd'hui : on constate une arrivée
                                // le jour où elle a lieu, pas trois semaines après.
                                setDateReception(pourInput(new Date()))
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                            >
                              Réceptionnée
                            </button>
                          )}

                          {/* Le seller ne corrige que tant que personne n'a tranché :
                              la base refuse le reste, autant ne pas l'afficher. */}
                          {(peutConfirmer || enAttente) && peutCreer && (
                            <button
                              onClick={() => ouvrirEdition(e)} title="Modifier"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>
                          )}
                          {(peutConfirmer || enAttente) && peutCreer && (
                            <button
                              onClick={() => supprimer(e)} title="Supprimer"
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#1B2632]/50 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                            </button>
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
            {affichees.length} expédition{affichees.length > 1 ? 's' : ''}
            {affichees.length !== expeditions.length && ` sur ${expeditions.length}`}
          </span>
        </div>
      </div>

      {receptionEnCours && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setReceptionEnCours(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[420px] p-6 pop-in">
              <h2 className="text-lg font-bold text-[#1B2632] mb-1">Réception de {receptionEnCours.reference}</h2>
              <p className="text-sm text-[#1B2632]/60 mb-4">Quand la marchandise est-elle arrivée ?</p>
              <input
                type="datetime-local" className="ex-input"
                value={dateReception}
                onChange={(ev) => setDateReception(ev.target.value)}
              />
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setReceptionEnCours(null)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Annuler
                </button>
                <button
                  onClick={() => marquerReceptionnee(receptionEnCours, dateReception)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  Enregistrer la réception
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {selecteurPays && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/50 z-[60]" onClick={() => setSelecteurPays(false)} />
          <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[460px] pop-in flex flex-col max-h-[70vh]">
              <div className="px-5 py-4 border-b border-[#C9C1B1]/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-[#1B2632]">Pays d&apos;achat</h3>
                  <button type="button" onClick={() => setSelecteurPays(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
                </div>
                <input
                  autoFocus className="ex-input" placeholder="Taper les premières lettres..."
                  value={recherchePays}
                  onChange={(ev) => setRecherchePays(ev.target.value)}
                />
              </div>
              <div className="overflow-y-auto">
                {(() => {
                  const r = recherchePays.trim().toLowerCase()
                  // Les pays déjà utilisés remontent en tête : sur un flux
                  // d'import, ce sont presque toujours les mêmes trois.
                  const deja = new Set(expeditions.map((e) => e.pays_code).filter(Boolean))
                  const trouves = PAYS_MONDE
                    .filter((pa) => !r || pa.nom.toLowerCase().includes(r) || pa.code.toLowerCase() === r)
                    .sort((a, b) => (deja.has(b.code) ? 1 : 0) - (deja.has(a.code) ? 1 : 0))
                  if (trouves.length === 0) {
                    return <p className="px-5 py-8 text-sm text-center text-[#1B2632]/60">Aucun pays ne correspond.</p>
                  }
                  return trouves.map((pa) => (
                    <button
                      key={pa.code} type="button"
                      onClick={() => {
                        setFormulaire((f) => ({ ...f, pays: pa.nom, pays_code: pa.code }))
                        setSelecteurPays(false)
                      }}
                      className="w-full text-left px-5 py-2.5 border-b border-[#C9C1B1]/30 hover:bg-[#EEE9DF]/50 transition-colors flex items-center gap-3"
                    >
                      <span className="text-xl leading-none">{drapeau(pa.code)}</span>
                      <span className="text-sm font-medium text-[#1B2632]">{pa.nom}</span>
                      {deja.has(pa.code) && (
                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEE9DF] text-[#1B2632]/50">déjà utilisé</span>
                      )}
                    </button>
                  ))
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {selecteurProduit && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/50 z-[60]" onClick={() => setSelecteurProduit(false)} />
          <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[520px] pop-in flex flex-col max-h-[70vh]">
              <div className="px-5 py-4 border-b border-[#C9C1B1]/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-[#1B2632]">Choisir un produit</h3>
                  <button type="button" onClick={() => setSelecteurProduit(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
                </div>
                <input
                  autoFocus
                  className="ex-input"
                  placeholder="Nom ou code..."
                  value={rechercheProduit}
                  onChange={(ev) => setRechercheProduit(ev.target.value)}
                />
              </div>

              <div className="overflow-y-auto">
                {catalogue.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-center text-[#1B2632]/60">
                    Aucun produit actif dans le catalogue. À créer dans le menu Produits.
                  </p>
                ) : (
                  (() => {
                    const r = rechercheProduit.trim().toLowerCase()
                    const trouves = catalogue.filter((p) =>
                      !r || `${p.product || ''} ${p.code || ''}`.toLowerCase().includes(r))
                    if (trouves.length === 0) {
                      return <p className="px-5 py-8 text-sm text-center text-[#1B2632]/60">Aucun produit ne correspond.</p>
                    }
                    return trouves.map((p) => {
                      const deja = lignes.find((l) => l.produit_id === p.id)
                      return (
                        <button
                          key={p.id} type="button" onClick={() => ajouterProduit(p)}
                          className="w-full text-left px-5 py-3 border-b border-[#C9C1B1]/30 hover:bg-[#EEE9DF]/50 transition-colors flex items-center justify-between gap-3"
                        >
                          <span>
                            <span className="block text-sm font-semibold text-[#1B2632]">{p.product}</span>
                            {p.code && <span className="block text-xs font-mono text-[#A35139]">{p.code}</span>}
                          </span>
                          {deja && (
                            <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-[#EDE7FB] text-[#5B3FA8] whitespace-nowrap">
                              déjà × {deja.quantite}
                            </span>
                          )}
                        </button>
                      )
                    })
                  })()
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {refusEnCours && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setRefusEnCours(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[460px] p-6 pop-in">
              <h2 className="text-lg font-bold text-[#1B2632] mb-1">Refuser {refusEnCours.reference}</h2>
              <p className="text-sm text-[#1B2632]/60 mb-4">
                Le motif reste attaché à l&apos;expédition : le vendeur saura quoi corriger.
              </p>
              <textarea
                value={motifRefus}
                onChange={(ev) => setMotifRefus(ev.target.value)}
                rows={3}
                placeholder="Poids incohérent, transporteur manquant..."
                className="ex-input resize-none"
              />
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setRefusEnCours(null)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Annuler
                </button>
                <button
                  onClick={() => changerStatut(refusEnCours, 'refusee', motifRefus.trim() || null)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Refuser
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {modale && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setModale(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <form onSubmit={enregistrer} className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[680px] my-8 pop-in">
              <div className="flex justify-between items-center px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-t-2xl">
                <h2 className="text-lg font-bold text-[#1B2632]">
                  {idEnEdition ? "Modifier l'expédition" : 'Nouvelle expédition'}
                </h2>
                <button type="button" onClick={() => setModale(false)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">✕</button>
              </div>

              <div className="p-6 flex flex-col gap-5">

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <Bloc titre="Informations du colis">
                    <div>
                      <label className="ex-label">Depuis (pays d&apos;achat) *</label>
                      <button
                        type="button"
                        onClick={() => { setSelecteurPays(true); setRecherchePays('') }}
                        className="ex-input text-left flex items-center justify-between gap-2"
                      >
                        {formulaire.pays ? (
                          <span className="flex items-center gap-2">
                            <span className="text-lg leading-none">{drapeau(formulaire.pays_code)}</span>
                            <span>{formulaire.pays}</span>
                          </span>
                        ) : (
                          <span className="text-[#1B2632]/40">Choisir un pays...</span>
                        )}
                        <span className="text-[#1B2632]/30 text-xs">▾</span>
                      </button>
                    </div>

                    <div>
                      <label className="ex-label">Poids *</label>
                      <div className="flex items-center gap-2">
                        <input type="number" step="0.01" className="ex-input" required
                          value={formulaire.poids_kg}
                          onChange={(ev) => setFormulaire({ ...formulaire, poids_kg: ev.target.value })} />
                        <span className="px-3 py-2.5 rounded-lg bg-[#EEE9DF] text-sm font-semibold text-[#1B2632]/70">Kg</span>
                      </div>
                    </div>
                    <div>
                      <label className="ex-label">Date d&apos;expédition *</label>
                      <input type="datetime-local" className="ex-input" required
                        value={formulaire.date_expedition}
                        onChange={(ev) => setFormulaire({ ...formulaire, date_expedition: ev.target.value })} />
                    </div>
                    <div>
                      <label className="ex-label">Mode de transport *</label>
                      <select className="ex-input" required value={formulaire.mode_transport}
                        onChange={(ev) => setFormulaire({ ...formulaire, mode_transport: ev.target.value })}>
                        {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </Bloc>

                  <div className="flex flex-col gap-5">
                    <Bloc titre={estSeller ? 'Destination' : 'Entrepôt'}>
                      <div>
                        <label className="ex-label">{estSeller ? 'Vers (pays) *' : 'Vers (entrepôt) *'}</label>
                        {estSeller ? (
                          <select className="ex-input" required value={formulaire.pays_destination_id}
                            onChange={(ev) => setFormulaire({ ...formulaire, pays_destination_id: ev.target.value })}>
                            <option value="">Choisir...</option>
                            {paysLivrables.map((p) => <option key={p.pays_id} value={p.pays_id}>{p.nom}</option>)}
                          </select>
                        ) : (
                          <select className="ex-input" required value={formulaire.entrepot_destination_id}
                            onChange={(ev) => setFormulaire({ ...formulaire, entrepot_destination_id: ev.target.value })}>
                            <option value="">Choisir...</option>
                            {entrepots.map((en) => <option key={en.id} value={en.id}>{en.nom}{en.pays?.nom ? ` — ${en.pays.nom}` : ''}</option>)}
                          </select>
                        )}
                        {!estSeller && entrepots.length === 0 && (
                          <p className="text-[11px] text-[#A35139] mt-1">
                            Aucun entrepôt. À créer dans Paramètres → Entrepôts.
                          </p>
                        )}
                        {estSeller && paysLivrables.length === 0 && (
                          <p className="text-[11px] text-[#A35139] mt-1">
                            Aucun pays de destination. Prévenez un responsable.
                          </p>
                        )}
                      </div>
                      {/* La date de réception n'est plus ici pour un vendeur :
                          c'est le responsable qui constate l'arrivée, le jour où
                          elle arrive. La demander à la déclaration revenait à
                          faire deviner une date. */}
                      {peutConfirmer && (
                        <div>
                          <label className="ex-label">Date de réception</label>
                          <input type="datetime-local" className="ex-input"
                            value={formulaire.date_reception}
                            onChange={(ev) => setFormulaire({ ...formulaire, date_reception: ev.target.value })} />
                          <p className="text-[11px] text-[#1B2632]/50 mt-1">À renseigner quand la marchandise arrive.</p>
                        </div>
                      )}
                    </Bloc>

                    <Bloc titre="Transporteur">
                      <div>
                        <label className="ex-label">Nom du transporteur *</label>
                        <input className="ex-input" required placeholder="DHL, Maersk..."
                          value={formulaire.transporteur}
                          onChange={(ev) => setFormulaire({ ...formulaire, transporteur: ev.target.value })} />
                      </div>
                      <div>
                        <label className="ex-label">Téléphone du transporteur *</label>
                        <input className="ex-input" required placeholder="+212 ..."
                          value={formulaire.transporteur_telephone}
                          onChange={(ev) => setFormulaire({ ...formulaire, transporteur_telephone: ev.target.value })} />
                      </div>
                    </Bloc>
                  </div>
                </div>

                <Bloc titre="Produits" action={
                  <button type="button" onClick={() => setSelecteurProduit(true)}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors whitespace-nowrap">
                    Choisir un produit
                  </button>
                }>
                  {lignes.length === 0 ? (
                    <p className="text-sm text-[#1B2632]/50 py-3">
                      Aucun produit. Une expédition sans contenu dit qu&apos;un colis arrive, sans dire ce qu&apos;il y a dedans.
                    </p>
                  ) : (
                    <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                            <th className="px-4 py-2.5">Produit</th>
                            <th className="px-4 py-2.5 w-[130px]">Quantité</th>
                            <th className="px-4 py-2.5 w-[60px] text-right"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {lignes.map((l) => (
                            <tr key={l.produit_id}>
                              <td className="px-4 py-2.5 font-medium text-[#1B2632]">{nomProduit(l.produit_id)}</td>
                              <td className="px-4 py-2">
                                <input
                                  type="number" min="1"
                                  className="ex-input py-1.5"
                                  value={l.quantite}
                                  onChange={(ev) => setLignes((prec) => prec.map((x) =>
                                    x.produit_id === l.produit_id
                                      ? { ...x, quantite: ev.target.value === '' ? '' : Math.max(1, parseInt(ev.target.value, 10) || 1) }
                                      : x))}
                                />
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button type="button" title="Retirer"
                                  onClick={() => setLignes((prec) => prec.filter((x) => x.produit_id !== l.produit_id))}
                                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-[#1B2632]/40 hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Bloc>

                <div>
                  <label className="ex-label">Détails</label>
                  <textarea rows={2} className="ex-input resize-none"
                    placeholder="Nombre de colis, numéro de conteneur..."
                    value={formulaire.details}
                    onChange={(ev) => setFormulaire({ ...formulaire, details: ev.target.value })} />
                </div>

                {!peutConfirmer && (
                  <p className="text-xs text-[#1B2632]/60 bg-[#FFB162]/10 border border-[#FFB162]/40 rounded-xl px-4 py-2.5">
                    Cette expédition sera enregistrée <strong>en attente</strong> de confirmation.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl">
                <button type="button" onClick={() => setModale(false)} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors disabled:opacity-50">
                  {enregistrement ? 'Enregistrement...' : idEnEdition ? 'Enregistrer' : "Déclarer l'expédition"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}

// Les quatre encadrés du formulaire. Reprendre la même boîte partout évite
// qu'un champ obligatoire se retrouve isolé en bas, là où on ne le voit pas.
function Bloc({ titre, action, children }) {
  return (
    <div className="border border-[#C9C1B1] rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-[#1B2632]">{titre}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

function Chiffre({ label, valeur, alerte }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#1B2632]/40 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${alerte ? 'text-[#A35139]' : 'text-[#1B2632]'}`}>{valeur}</p>
    </div>
  )
}