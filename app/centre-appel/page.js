'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext' 
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import * as XLSX from 'xlsx'

// 🚀 Fonction StatutPill
function StatutPill({ statut, listeStatutsDB }) {
  const statutConfiguré = (listeStatutsDB || []).find(s => s.nom === statut || s.id === statut)

  if (statutConfiguré && statutConfiguré.couleur) {
    return (
      <span className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1.5 w-fit" 
            style={{ backgroundColor: `${statutConfiguré.couleur}15`, color: statutConfiguré.couleur, border: `1px solid ${statutConfiguré.couleur}40` }}>
        {statutConfiguré.nom}
      </span>
    )
  }

  const configsFallback = {
    'confirmed': { bg: 'bg-[#2C3B4D]/10', text: 'text-[#2C3B4D]', label: 'Confirmée' },
    'en_attente': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'En attente' },
    'unreached': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Injoignable' },
    'reminder': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'À rappeler' },
    'cancelled': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Annulée' },
    'spam': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Spam' },
    'double': { bg: 'bg-[#C9C1B1]/50', text: 'text-[#4a4437]', label: 'Doublon' },
    'out_of_stock': { bg: 'bg-[#FFB162]/30', text: 'text-[#8a5a1f]', label: 'Rupture' },
    'not_active_yet': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Inactif' },
  }
  const conf = configsFallback[statut] || configsFallback['en_attente']
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text} whitespace-nowrap flex items-center gap-1.5 w-fit`}>
      {conf.label || statut}
    </span>
  )
}

function SelectFiltre({ label, value, onChange, options, placeholder }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#EEE9DF]/40 border border-[#C9C1B1]/60 rounded-lg px-3 py-2 text-sm font-medium text-[#1B2632] focus:outline-none focus:border-[#FFB162] cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function ChipFiltre({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[#1B2632]/5 border border-[#C9C1B1]/60 text-xs font-semibold text-[#1B2632] fade-in">
      {label}
      <button
        onClick={onClear}
        className="w-4 h-4 rounded-full hover:bg-[#A35139]/15 text-[#1B2632]/40 hover:text-[#A35139] flex items-center justify-center text-[10px] leading-none transition-colors"
      >
        ✕
      </button>
    </span>
  )
}

function detecterPaysDepuisTelephone(cmd, paysListDB) {
  if (cmd?.lead_id) {
    const parts = cmd.lead_id.replace('#', '').split('-');
    if (parts.length >= 2) {
      const codeLead = parts[1].toUpperCase();
      const paysParLead = (paysListDB || []).find(p => (p.code || '').trim().toUpperCase() === codeLead);
      if (paysParLead) {
        return { iso: codeLead, nom: paysParLead.nom, paysTrouve: paysParLead };
      }
    }
  }

  let tel = cmd?.client_telephone ? cmd.client_telephone.trim().replace(/\s+/g, '') : ''
  if (tel.startsWith('00')) tel = '+' + tel.slice(2)
  else if (!tel.startsWith('+') && tel.length > 8) tel = '+' + tel

  const phoneNumber = parsePhoneNumberFromString(tel)
  if (!phoneNumber || !phoneNumber.country) return null

  const iso = phoneNumber.country
  const indicatif = phoneNumber.countryCallingCode

  const traducteur = new Intl.DisplayNames(['fr'], { type: 'region' })
  let nom = traducteur.of(iso)
  if (iso === 'CD') nom = 'RDC'
  if (iso === 'CG') nom = 'Congo'

  let paysTrouve = (paysListDB || []).find(p => {
    const codeDB = (p.code || '').trim().toUpperCase()
    return codeDB === iso || codeDB === `+${indicatif}` || codeDB === indicatif
  })

  if (!paysTrouve) {
    paysTrouve = (paysListDB || []).find(p =>
      (p.nom || '').toLowerCase().localeCompare(nom.toLowerCase(), 'fr', { sensitivity: 'base' }) === 0
    )
  }

  return { iso, nom, paysTrouve }
}

const ROLES_VUE_GLOBALE = ['admin', 'manager', 'ceo', 'super_admin']

export default function CentreAppelAgent() {
  const { user, tenantId, loading: authLoading } = useAuth() 
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions() 
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;

  const [commandes, setCommandes] = useState([])
  const [listePays, setListePays] = useState([])
  const [listeZones, setListeZones] = useState([])
  const [listeStatutsDB, setListeStatutsDB] = useState([]) 
  const [loading, setLoading] = useState(true)
  const [ongletActif, setOngletActif] = useState('a_traiter')

  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [recherche, setRecherche] = useState('')
  const [rechercheActive, setRechercheActive] = useState('')
  
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreProduit, setFiltreProduit] = useState('')
  const [filtreVille, setFiltreVille] = useState('')
  const [filtreSource, setFiltreSource] = useState('')
  const [filtrePays, setFiltrePays] = useState('')
  
  const [panneauFiltresOuvert, setPanneauFiltresOuvert] = useState(false)
  const [optionsFiltres, setOptionsFiltres] = useState({ produits: [], villes: [], sources: [], pays: [] })

  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const ITEMS_PER_PAGE = 50

  const [agentActuel, setAgentActuel] = useState(null)
  const [agentIntrouvable, setAgentIntrouvable] = useState(false) // 🚀 État de sécurité
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('') 

  const [tempsRestant, setTempsRestant] = useState(300)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  const [formData, setFormData] = useState({
    source: '', client_nom: '', client_telephone: '', ville_zone: '',
    zone_id: '', pays_id: '', produit: '', quantite: 1, prix: 0, notes: '', date_rappel: '', prixUnitaire: 0
  })

  // REDIRECTION SÉCURISÉE
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_centre_appel')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  // TIMER APPEL
  useEffect(() => {
    let interval = null
    if (commandeSelectionnee) {
      setTempsRestant(300)
      interval = setInterval(() => {
        setTempsRestant((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [commandeSelectionnee?.id])

  const formatTemps = (secondes) => {
    const m = Math.floor(secondes / 60).toString().padStart(2, '0')
    const s = (secondes % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // RECHERCHE DYNAMIQUE
  useEffect(() => {
    const t = setTimeout(() => {
      setRechercheActive(recherche.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [recherche])

  // RACCOURCI CLAVIER
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setCommandeSelectionnee(null)
        setPanneauFiltresOuvert(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // BLOQUER SCROLL
  useEffect(() => {
    document.body.style.overflow = commandeSelectionnee ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [commandeSelectionnee])

  // CHARGEMENT DES RÉFÉRENTIELS
  useEffect(() => {
    async function chargerOptionsFiltres() {
      if (!user || !tenantKey) return

      // Les valeurs distinctes viennent de la base (vue v_options_filtres) :
      // quelques dizaines de lignes au lieu de 6000 rapatriées pour être triées ici.
      const [
        { data: options },
        { data: pays },
        { data: statuts }
      ] = await Promise.all([
        supabase.from('v_options_filtres').select('champ, valeur').eq('tenant_id', tenantKey),
        supabase.from('pays').select('id, nom').eq('tenant_id', tenantKey).order('nom'),
        supabase.from('statuts').select('*').eq('tenant_id', tenantKey).order('nom')
      ])

      const valeursDe = (champ) =>
        (options || [])
          .filter(o => o.champ === champ)
          .map(o => o.valeur)
          .sort((a, b) => a.localeCompare(b, 'fr'))

      setOptionsFiltres({
        produits: valeursDe('produit'),
        villes: valeursDe('ville'),
        sources: valeursDe('source'),
        pays: (pays || []).map(p => ({ id: p.id, nom: p.nom }))
      })

      if (statuts) setListeStatutsDB(statuts)
    }
    chargerOptionsFiltres()
  }, [user, tenantKey])

  // 🚀 SÉCURITÉ : VÉRIFICATION DU PROFIL AGENT ET CHARGEMENT DE SES LEADS
  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantKey) return

    async function verifierAgentEtCharger() {
      // Admin / manager / CEO / super_admin: global view, no agent profile needed.
      // (tenant isolation is still enforced by the query filter + RLS)
      if (ROLES_VUE_GLOBALE.includes((roleNom || '').toLowerCase())) {
        setAgentActuel(null)
        setAgentIntrouvable(false)
        await chargerCommandes(page, ongletActif, null)
        return
      }

      const { data: agentData } = await supabase
        .from('agents')
        .select('id, nom')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantKey)
        .maybeSingle()

      if (agentData) {
        setAgentActuel(agentData)
        setAgentIntrouvable(false)
        await chargerCommandes(page, ongletActif, agentData.id)
      } else {
        // L'utilisateur n'est pas reconnu comme agent dans ce tenant
        setAgentIntrouvable(true)
        setLoading(false)
      }
    }

    verifierAgentEtCharger()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ongletActif, dateDebut, dateFin, rechercheActive, filtreStatut, filtreProduit, filtreVille, filtreSource, filtrePays, authLoading, permsLoading, user, tenantKey, roleNom])

  // 🚀 CHARGEMENT STRICTEMENT CLOISONNÉ
  // agentId = null  -> global view (admin / manager / ceo / super_admin)
  async function chargerCommandes(pageActuelle, onglet, agentId) {
    if (!tenantKey || agentId === undefined) return
    const estSuperAdmin = (roleNom || '').toLowerCase() === 'super_admin'
    setLoading(true)
    const debut = (pageActuelle - 1) * ITEMS_PER_PAGE
    const fin = debut + ITEMS_PER_PAGE - 1

    const { data: paysListDB } = await supabase.from('pays').select('id, nom, code, devise').eq('tenant_id', tenantKey)
    setListePays(paysListDB || [])

    const { data: zonesListDB } = await supabase.from('zones').select('*').eq('tenant_id', tenantKey)
    setListeZones(zonesListDB || [])

    let requeteBase = supabase.from('commandes').select('*', { count: 'exact', head: true })
    let requeteData = supabase.from('commandes').select(`id, lead_id, agent_id, date_commande, created_at, updated_at, source, produit, quantite, prix, statut_confirmation, client_nom, client_telephone, ville_zone, zone_id, pays_id, notes, pays(id, nom, code, devise)`)

    // super_admin sees every tenant; everybody else only his own tenant
    if (!estSuperAdmin) {
      requeteBase = requeteBase.eq('tenant_id', tenantKey)
      requeteData = requeteData.eq('tenant_id', tenantKey)
    }

    // 🔒 An agent only sees HIS orders
    if (agentId) {
      requeteBase = requeteBase.eq('agent_id', agentId)
      requeteData = requeteData.eq('agent_id', agentId)
    }

    if (onglet === 'a_traiter') {
      requeteBase = requeteBase.is('statut_confirmation', null)
      requeteData = requeteData.is('statut_confirmation', null)
    } else {
      if (filtreStatut) {
        requeteBase = requeteBase.eq('statut_confirmation', filtreStatut)
        requeteData = requeteData.eq('statut_confirmation', filtreStatut)
      } else {
        requeteBase = requeteBase.not('statut_confirmation', 'is', null)
        requeteData = requeteData.not('statut_confirmation', 'is', null)
      }
    }

    const dateField = onglet === 'historique' ? 'updated_at' : 'created_at'

    if (dateDebut) {
      requeteBase = requeteBase.gte(dateField, dateDebut)
      requeteData = requeteData.gte(dateField, dateDebut)
    }
    if (dateFin) {
      requeteBase = requeteBase.lte(dateField, `${dateFin}T23:59:59`)
      requeteData = requeteData.lte(dateField, `${dateFin}T23:59:59`)
    }

    if (rechercheActive) {
      const r = rechercheActive.replace(/[%,()#]/g, '')
      const rTel = r.replace(/[\s.\-]/g, '')
      const conditions = [`client_nom.ilike.%${r}%`, `client_telephone.ilike.%${r}%`, `lead_id.ilike.%${r}%`]
      if (rTel && rTel !== r) conditions.push(`client_telephone.ilike.%${rTel}%`)
      const filtre = conditions.join(',')
      requeteBase = requeteBase.or(filtre)
      requeteData = requeteData.or(filtre)
    }

    // Le pays est désormais obligatoire et verrouillé en base, donc on filtre
    // dessus côté serveur : plus besoin de rapatrier 5000 lignes pour trier ici.
    if (filtrePays) { requeteBase = requeteBase.eq('pays_id', filtrePays); requeteData = requeteData.eq('pays_id', filtrePays); }
    if (filtreProduit) { requeteBase = requeteBase.eq('produit', filtreProduit); requeteData = requeteData.eq('produit', filtreProduit); }
    if (filtreVille) { requeteBase = requeteBase.eq('ville_zone', filtreVille); requeteData = requeteData.eq('ville_zone', filtreVille); }
    if (filtreSource) { requeteBase = requeteBase.eq('source', filtreSource); requeteData = requeteData.eq('source', filtreSource); }

    if (onglet === 'historique') {
      requeteData = requeteData.order('updated_at', { ascending: false }).order('id', { ascending: false })
    } else {
      requeteData = requeteData.order('created_at', { ascending: false }).order('id', { ascending: false })
    }

    requeteData = requeteData.range(debut, fin)

    const { count } = await requeteBase
    const { data } = await requeteData

    const commandesIntelligentes = (data || []).map(cmd => {
      const { appels, ...cmdSansJointure } = cmd
      const detection = detecterPaysDepuisTelephone(cmdSansJointure, paysListDB)

      // Le pays enregistré sur la commande fait foi : c'est lui qui décide de
      // l'agent et c'est sur lui que porte le filtre. La déduction à partir du
      // téléphone ne sert plus que si la commande n'a pas de pays rattaché.
      let paysFinal
      if (cmdSansJointure.pays?.nom) {
        paysFinal = cmdSansJointure.pays
      } else if (detection?.paysTrouve) {
        paysFinal = detection.paysTrouve
      } else if (detection) {
        paysFinal = { nom: detection.nom, iso: detection.iso }
      } else {
        paysFinal = { nom: 'Non spécifié' }
      }

      return { ...cmdSansJointure, pays: paysFinal }
    })

    setTotalItems(count || 0)
    setCommandes(commandesIntelligentes)
    
    setLoading(false)
  }

  async function ouvrirPanneau(commande) {
    setCommandeSelectionnee(commande)

    if (commande.statut_confirmation) {
      setStatutChoisi(commande.statut_confirmation)
    } else if (listeStatutsDB.length > 0) {
      setStatutChoisi(listeStatutsDB[0].nom)
    } else {
      setStatutChoisi('')
    }

    let paysId = commande.pays?.id || ''

    if (!paysId && commande.pays?.iso) {
      let pays = listePays.find(p => (p.code || '').toUpperCase() === commande.pays.iso)
      if (!pays) {
        const { data } = await supabase
          .from('pays')
          .insert({ nom: commande.pays.nom, code: commande.pays.iso, tenant_id: tenantKey })
          .select('id, nom, code, devise')
          .single()

        if (data) {
          pays = data
          setListePays(prev => [...prev, data])
        }
      }
      paysId = pays?.id || ''
    }

    const qte = commande.quantite || 1;
    const prixUnit = (commande.prix || 0) / qte;

    setFormData({
      source: commande.source || '',
      client_nom: commande.client_nom || '',
      client_telephone: commande.client_telephone || '',
      ville_zone: commande.ville_zone || '',
      zone_id: commande.zone_id || '',
      pays_id: paysId,
      produit: commande.produit || '',
      quantite: qte,
      prix: commande.prix || 0,
      notes: commande.notes || '',
      date_rappel: '',
      prixUnitaire: prixUnit
    })
  }

  async function validerAppel() {
    if (!statutChoisi) {
      alert("Veuillez sélectionner un résultat d'appel.");
      return;
    }

    setEnvoiEnCours(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      router.push('/')
      return
    }

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirmer-appel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          commande_id: commandeSelectionnee.id,
          statut: statutChoisi, 
          tenant_id: tenantKey, 
          ...formData
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    const indexActuel = commandes.findIndex(c => c.id === commandeSelectionnee.id)
    if (indexActuel !== -1 && indexActuel < commandes.length - 1) {
      ouvrirPanneau(commandes[indexActuel + 1])
    } else {
      setCommandeSelectionnee(null)
    }

    await chargerCommandes(page, ongletActif, agentActuel?.id)
  }

  const appliquer = (setter) => (v) => { setter(v); setPage(1) }

  function reinitialiserFiltres() {
    setDateDebut(''); setDateFin(''); setRecherche(''); setFiltreStatut('')
    setFiltreProduit(''); setFiltreVille(''); setFiltreSource(''); setFiltrePays('')
    setPage(1)
  }

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)
  const nombreFiltresActifs = [filtreStatut, filtreProduit, filtreVille, filtreSource, filtrePays].filter(Boolean).length
  const filtresActifs = dateDebut || dateFin || recherche || nombreFiltresActifs > 0

  const whatsappTexte = encodeURIComponent(`Bonjour ${formData.client_nom}, c'est le service de confirmation. Nous vous contactons concernant votre commande pour le produit ${formData.produit}. Pouvons-nous valider la livraison à ${formData.ville_zone || 'votre adresse'} ?`);
  const estUnDoublon = commandes.filter(c => c.client_telephone && formData.client_telephone && c.client_telephone.replace(/\s/g, '') === formData.client_telephone.replace(/\s/g, '')).length > 1;

  const labelStatut = (v) => {
    const s = listeStatutsDB.find(st => st.nom === v || st.id === v)
    return s ? s.nom : v
  }

  if (authLoading || permsLoading || !hasPermission('menu_centre_appel')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  // 🚀 BLOCAGE D'INTERFACE SI L'UTILISATEUR N'A PAS DE PROFIL AGENT
  if (agentIntrouvable) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A35139" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h2 className="text-xl font-bold text-[#1B2632]">Espace de travail indisponible</h2>
        <p className="text-sm text-[#1B2632]/60 max-w-md text-center">
          Votre compte n'est lié à aucun profil "Agent" actif. Veuillez demander à votre administrateur de vous créer un profil dans la section "Gestion des Utilisateurs".
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .drawer-in { animation: drawerIn 0.25s ease-out; }
        .fade-in { animation: fadeIn 0.2s ease-out; }
        .pop-in { animation: popIn 0.18s ease-out; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1 flex items-center gap-2">
              Espace Personnel <span className="text-[#1B2632]/30">•</span> {agentActuel?.nom || 'Vue globale'}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2632]">Centre d'appels</h1>
          </div>
        </div>

        <div className="flex justify-between items-start mt-2 flex-wrap gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full lg:w-auto">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setOngletActif('a_traiter'); setPage(1); setCommandeSelectionnee(null); setFiltreStatut(''); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  ongletActif === 'a_traiter' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Mes Leads à traiter
              </button>
              <button
                onClick={() => { setOngletActif('historique'); setPage(1); setCommandeSelectionnee(null); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  ongletActif === 'historique' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Mon Historique
              </button>
            </div>

            <div className="hidden sm:block h-6 w-px bg-[#C9C1B1]/50"></div>

            <div className="text-sm text-[#1B2632]/60 font-medium">
              {totalItems} commande{totalItems > 1 ? 's' : ''} affectée{totalItems > 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full lg:w-auto">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[280px] focus-within:border-[#FFB162] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Nom, téléphone, N° commande..."
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
                onClick={() => setPanneauFiltresOuvert(o => !o)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
                  panneauFiltresOuvert || nombreFiltresActifs > 0
                    ? 'bg-[#1B2632] text-white border-[#1B2632]'
                    : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Filtres
                {nombreFiltresActifs > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFB162] text-[#1B2632] text-[11px] font-bold flex items-center justify-center">
                    {nombreFiltresActifs}
                  </span>
                )}
              </button>

              {panneauFiltresOuvert && (
                <>
                  {/* Téléphone : feuille ancrée en bas, avec son propre défilement,
                      donc rien ne peut la rogner. Ordinateur : petit panneau sous le bouton. */}
                  <div
                    className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent"
                    onClick={() => setPanneauFiltresOuvert(false)}
                  />
                  <div className="fixed inset-x-3 bottom-3 max-h-[85dvh] overflow-y-auto z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[300px] sm:max-h-none sm:overflow-visible bg-white rounded-2xl border border-[#C9C1B1] shadow-xl p-5 pop-in">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-bold uppercase tracking-widest text-[#1B2632]/50">Filtres</span>
                      {nombreFiltresActifs > 0 && (
                        <button onClick={reinitialiserFiltres} className="text-xs font-semibold text-[#A35139] hover:underline">
                          Tout effacer
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-4">
                      {ongletActif === 'historique' && (
                        <SelectFiltre 
                          label="Statut" 
                          value={filtreStatut} 
                          onChange={appliquer(setFiltreStatut)} 
                          options={listeStatutsDB.map(s => ({ value: s.nom, label: s.nom }))} 
                          placeholder="Tous les statuts" 
                        />
                      )}
                      
                      <SelectFiltre label="Pays" value={filtrePays} onChange={appliquer(setFiltrePays)} options={optionsFiltres.pays.map(p => ({ value: p.id, label: p.nom }))} placeholder="Tous les pays" />
                      <SelectFiltre label="Produit" value={filtreProduit} onChange={appliquer(setFiltreProduit)} options={optionsFiltres.produits.map(p => ({ value: p, label: p }))} placeholder="Tous les produits" />
                      <SelectFiltre label="Ville" value={filtreVille} onChange={appliquer(setFiltreVille)} options={optionsFiltres.villes.map(v => ({ value: v, label: v }))} placeholder="Toutes les villes" />
                      <SelectFiltre label="Source" value={filtreSource} onChange={appliquer(setFiltreSource)} options={optionsFiltres.sources.map(s => ({ value: s, label: s }))} placeholder="Toutes les sources" />
                    </div>

                    <button onClick={() => setPanneauFiltresOuvert(false)} className="w-full mt-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                      Appliquer
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white p-1 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-auto">
              <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest shrink-0">Du</span>
                <input type="date" value={dateDebut} onChange={(e) => { setDateDebut(e.target.value); setPage(1); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer w-full min-w-0" />
              </div>
              <div className="hidden sm:block w-[1px] h-6 bg-[#C9C1B1]/40"></div>
              <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest shrink-0">Au</span>
                <input type="date" value={dateFin} onChange={(e) => { setDateFin(e.target.value); setPage(1); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer w-full min-w-0" />
              </div>
            </div>

            {filtresActifs && (
              <button onClick={reinitialiserFiltres} className="text-xs font-semibold text-[#A35139] hover:underline">
                Réinitialiser
              </button>
            )}
          </div>
        </div>

        {nombreFiltresActifs > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filtreStatut && <ChipFiltre label={`Statut : ${labelStatut(filtreStatut)}`} onClear={() => appliquer(setFiltreStatut)('')} />}
            {filtrePays && <ChipFiltre label={`Pays : ${optionsFiltres.pays.find(p => String(p.id) === String(filtrePays))?.nom || ''}`} onClear={() => appliquer(setFiltrePays)('')} />}
            {filtreProduit && <ChipFiltre label={`Produit : ${filtreProduit}`} onClear={() => appliquer(setFiltreProduit)('')} />}
            {filtreVille && <ChipFiltre label={`Ville : ${filtreVille}`} onClear={() => appliquer(setFiltreVille)('')} />}
            {filtreSource && <ChipFiltre label={`Source : ${filtreSource}`} onClear={() => appliquer(setFiltreSource)('')} />}
          </div>
        )}
      </header>

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto min-h-[400px] max-h-[calc(100vh-280px)]">
          <table className="w-full min-w-[1050px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-6 py-4">Lead ID</th>
                <th className="px-6 py-4">{ongletActif === 'historique' ? 'Date de Traitement' : 'Date d\'Arrivée'}</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Pays</th>
                <th className="px-6 py-4">Ville / Zone</th>
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Prix</th>
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {loading ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : commandes.length === 0 ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">{agentActuel ? 'Aucun lead ne vous est assigné.' : 'Aucune commande pour ce filtre.'}</td></tr>
              ) : (
                commandes.map((cmd) => {
                  const estSelectionne = commandeSelectionnee?.id === cmd.id
                  const dateAffichage = ongletActif === 'historique' ? (cmd.updated_at ? new Date(cmd.updated_at) : null) : (cmd.created_at ? new Date(cmd.created_at) : null)

                  return (
                    <tr
                      key={cmd.id}
                      onClick={() => ouvrirPanneau(cmd)}
                      className={`cursor-pointer transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/40'}`}
                    >
                      <td className="px-6 py-4 font-mono text-xs text-[#1B2632]/80 whitespace-nowrap">#{cmd.lead_id || 'N/A'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                        {dateAffichage ? dateAffichage.toLocaleDateString('fr-FR') : '-'}
                        {ongletActif === 'historique' && dateAffichage && <span className="block text-xs text-[#1B2632]/50">{dateAffichage.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-[#1B2632] whitespace-nowrap">{cmd.client_nom || 'Client inconnu'}</div>
                        <div className="font-mono text-xs text-[#A35139] font-semibold mt-1 whitespace-nowrap">{cmd.client_telephone || 'Aucun numéro'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-[#1B2632] whitespace-nowrap">{cmd.pays?.nom || '-'}</td>
                      <td className="px-6 py-4"><div className="text-sm font-medium text-[#1B2632] whitespace-nowrap">{cmd.ville_zone || '-'}</div></td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-[#1B2632] max-w-[180px] truncate" title={cmd.produit}>{cmd.produit || '-'}</div>
                        <div className="text-xs text-[#1B2632]/50 mt-0.5">Qté: {cmd.quantite || 1}</div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                        {cmd.prix !== null && cmd.prix !== undefined ? cmd.prix : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <StatutPill statut={cmd.statut_confirmation} listeStatutsDB={listeStatutsDB} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${estSelectionne ? 'bg-[#1B2632] text-white' : 'bg-[#EEE9DF] text-[#1B2632] border border-[#C9C1B1] hover:bg-[#C9C1B1]'}`}>
                          {ongletActif === 'a_traiter' ? 'Traiter' : 'Modifier'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-[#EEE9DF]/20 border-t border-[#C9C1B1]/50 px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-[#1B2632]/60">Page {page} sur {totalPages || 1}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading} className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors">Précédent</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0 || loading} className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors">Suivant</button>
          </div>
        </div>
      </div>

      {commandeSelectionnee && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/30 backdrop-blur-[2px] z-40 fade-in" onClick={() => setCommandeSelectionnee(null)} />

          <div className="fixed top-0 right-0 h-screen w-[420px] max-w-full bg-white z-50 shadow-2xl border-l border-[#C9C1B1] flex flex-col drawer-in">
            <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632] mb-1">
                  {ongletActif === 'a_traiter' ? 'Traiter la commande' : 'Modifier la commande'}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A35139]">#{commandeSelectionnee.lead_id || 'N/A'}</span>
                  {commandeSelectionnee.statut_confirmation && (
                    <StatutPill statut={commandeSelectionnee.statut_confirmation} listeStatutsDB={listeStatutsDB} />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold text-sm ${tempsRestant < 60 ? 'text-red-600 animate-pulse' : 'text-[#1B2632]/60'}`}>
                  {formatTemps(tempsRestant)}
                </span>
                <button onClick={() => setCommandeSelectionnee(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">
                  ✕
                </button>
              </div>
            </div>

            {estUnDoublon && (
              <div className="mx-6 mt-5 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-0.5">Alerte Doublon</p>
                  <p className="text-[11px] leading-tight opacity-90">Ce numéro de téléphone apparaît plusieurs fois dans la liste actuelle.</p>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
              <div className="flex flex-col gap-5">
                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Nom du client</label>
                  <input
                    type="text"
                    value={formData.client_nom}
                    onChange={(e) => setFormData({...formData, client_nom: e.target.value})}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Téléphone Principal</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={formData.client_telephone}
                      onChange={(e) => setFormData({...formData, client_telephone: e.target.value})}
                      className="flex-1 border-b border-[#C9C1B1] py-2 text-sm font-mono font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                    <a href={`tel:${formData.client_telephone}`} title="Appeler" className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg text-xs font-semibold transition-colors">Appeler</a>
                    <a href={`https://wa.me/${formData.client_telephone.replace(/[+\s]/g, '')}?text=${whatsappTexte}`} target="_blank" rel="noreferrer" title="WhatsApp" className="px-3 py-1.5 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 rounded-lg text-xs font-semibold transition-colors">WhatsApp</a>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Zone officielle</label>
                    <select
                      value={formData.zone_id}
                      onChange={(e) => {
                        const nouvelleZoneId = e.target.value;
                        const zoneSelectionnee = listeZones.find(z => String(z.id) === String(nouvelleZoneId));
                        setFormData({
                          ...formData, 
                          zone_id: nouvelleZoneId,
                          ville_zone: zoneSelectionnee ? zoneSelectionnee.nom_zone : formData.ville_zone 
                        });
                      }}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] font-bold bg-transparent focus:outline-none focus:border-[#FFB162]"
                    >
                      <option value="">Sélectionner...</option>
                      {listeZones.filter(z => !formData.pays_id || z.pays_id === formData.pays_id).map((z) => (
                        <option key={z.id} value={z.id}>{z.nom_zone}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Pays</label>
                    <select
                      value={formData.pays_id}
                      onChange={(e) => setFormData({...formData, pays_id: e.target.value, zone_id: ''})}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    >
                      <option value="">Sélectionner</option>
                      {listePays.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Produit</label>
                    <input
                      type="text"
                      value={formData.produit}
                      onChange={(e) => setFormData({...formData, produit: e.target.value})}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Quantité</label>
                    <div className="flex items-center border-b border-[#C9C1B1]">
                      <button type="button" onClick={() => {
                        const newQty = Math.max(1, formData.quantite - 1);
                        setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                      }} className="px-2 py-2 text-[#1B2632] font-bold">-</button>
                      <input
                        type="number"
                        value={formData.quantite}
                        onChange={(e) => {
                          const newQty = parseInt(e.target.value) || 1;
                          setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                        }}
                        className="w-full text-center py-2 font-bold text-sm text-[#1B2632] outline-none bg-transparent"
                      />
                      <button type="button" onClick={() => {
                        const newQty = formData.quantite + 1;
                        setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                      }} className="px-2 py-2 text-[#1B2632] font-bold">+</button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Prix total</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.prix}
                    onChange={(e) => {
                      const newPrix = parseFloat(e.target.value) || 0;
                      setFormData({...formData, prix: newPrix, prixUnitaire: newPrix / (formData.quantite || 1)});
                    }}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>
              </div>

              <div className="p-4 bg-[#EEE9DF]/30 rounded-xl border border-[#C9C1B1]/50">
                <label className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">Résultat de l'appel</label>
                
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#1B2632]/20 rounded-lg px-3 py-2.5 text-sm font-bold text-[#1B2632] bg-white shadow-sm"
                >
                  <option value="" disabled>-- Choisir --</option>
                  {listeStatutsDB.map((s) => (
                    <option key={s.id} value={s.nom}>{s.nom}</option>
                  ))}
                </select>

                {(statutChoisi.toLowerCase().includes('rappel') || statutChoisi.toLowerCase().includes('reminder')) && (
                  <div className="mt-3">
                    <label className="block text-[11px] font-bold text-[#8a5a1f] uppercase mb-1">Date et heure de rappel</label>
                    <input
                      type="datetime-local"
                      value={formData.date_rappel}
                      onChange={(e) => setFormData({...formData, date_rappel: e.target.value})}
                      className="w-full border border-[#FFB162]/50 rounded-lg px-3 py-2 text-sm text-[#8a5a1f] bg-white outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              {hasPermission('traiter_appel') ? (
              <button
                onClick={validerAppel}
                disabled={envoiEnCours}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md"
              >
                {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              ) : (
                <p className="text-center text-xs text-[#1B2632]/50 py-3">Lecture seule : vous n'avez pas le droit de traiter un appel.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}