'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

const STATUTS_APPEL = [
  { value: 'confirmed', label: 'Confirmée' },
  { value: 'unreached', label: 'Injoignable' },
  { value: 'reminder', label: 'À rappeler' },
  { value: 'cancelled', label: 'Annulée' },
  { value: 'spam', label: 'Spam' },
  { value: 'double', label: 'Doublon' },
  { value: 'out_of_stock', label: 'Rupture' },
  { value: 'not_active_yet', label: 'En attente d\'activation' }
]

function StatutPill({ statut }) {
  const configs = {
    'confirmed': { bg: 'bg-[#2C3B4D]/10', text: 'text-[#2C3B4D]', label: 'Confirmée', icon: '✓' },
    'en_attente': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'En attente', icon: '⏳' },
    'unreached': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Injoignable', icon: '📵' },
    'reminder': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'À rappeler', icon: '🔔' },
    'cancelled': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Annulée', icon: '✕' },
    'spam': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Spam', icon: '🗑️' },
    'double': { bg: 'bg-[#C9C1B1]/50', text: 'text-[#4a4437]', label: 'Doublon', icon: '📋' },
    'out_of_stock': { bg: 'bg-[#FFB162]/30', text: 'text-[#8a5a1f]', label: 'Rupture', icon: '📦' },
    'not_active_yet': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Inactif', icon: '🔒' },
  }
  const conf = configs[statut] || configs['en_attente']
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text} whitespace-nowrap flex items-center gap-1.5 w-fit`}>
      <span>{conf.icon}</span> {conf.label}
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

export default function CentreAppelAgent() {
  const [commandes, setCommandes] = useState([])
  const [listePays, setListePays] = useState([])
  const [loading, setLoading] = useState(true)
  const [ongletActif, setOngletActif] = useState('a_traiter')

  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [recherche, setRecherche] = useState('')
  const [rechercheActive, setRechercheActive] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('') 

  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const ITEMS_PER_PAGE = 50

  const [agentActuel, setAgentActuel] = useState(null)
  const [statsJour, setStatsJour] = useState({ total: 0, confirmed: 0, unreached: 0 })
  
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('confirmed')
  
  const [historiqueLead, setHistoriqueLead] = useState([])
  const [loadingHistorique, setLoadingHistorique] = useState(false)

  const [tempsRestant, setTempsRestant] = useState(300)

  const [formData, setFormData] = useState({
    source: '',
    client_nom: '',
    client_telephone: '',
    ville_zone: '',
    pays_id: '',
    produit: '',
    quantite: 1,
    notes: '',
    date_rappel: ''
  })

  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const router = useRouter()

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

  useEffect(() => {
    const t = setTimeout(() => {
      setRechercheActive(recherche.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [recherche])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setCommandeSelectionnee(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    document.body.style.overflow = commandeSelectionnee ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [commandeSelectionnee])

  useEffect(() => {
    async function chargerHistorique() {
      if (!commandeSelectionnee) {
        setHistoriqueLead([])
        return
      }
      setLoadingHistorique(true)
      const { data } = await supabase
        .from('appels')
        .select(`
          id, statut, notes, date_rappel, created_at,
          agents ( nom, name, full_name )
        `)
        .eq('commande_id', commandeSelectionnee.id)
        .order('created_at', { ascending: false })
      
      setHistoriqueLead(data || [])
      setLoadingHistorique(false)
    }
    chargerHistorique()
  }, [commandeSelectionnee?.id])

  useEffect(() => {
    async function verifierAccesEtCharger() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (roleData?.role !== 'admin' && roleData?.role !== 'agent') {
        alert("Accès non autorisé à l'espace agent.")
        router.push('/')
        return
      }

      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (agentData) {
        setAgentActuel(agentData)
        chargerStatsJour(agentData.id)
      }

      await chargerCommandes(page, ongletActif)
    }

    verifierAccesEtCharger()
  }, [page, ongletActif, dateDebut, dateFin, rechercheActive, filtreStatut, router])

  async function chargerStatsJour(idAgent) {
    if (!idAgent) return
    
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const { data } = await supabase
      .from('appels')
      .select('statut')
      .eq('agent_id', idAgent)
      .gte('created_at', startOfDay.toISOString())

    if (data) {
      const confirmed = data.filter(a => a.statut === 'confirmed').length
      const unreached = data.filter(a => a.statut === 'unreached').length
      setStatsJour({
        total: data.length,
        confirmed,
        unreached
      })
    }
  }

  async function chargerCommandes(pageActuelle, onglet) {
    setLoading(true)
    const debut = (pageActuelle - 1) * ITEMS_PER_PAGE
    const fin = debut + ITEMS_PER_PAGE - 1

    const { data: paysListDB } = await supabase
      .from('pays')
      .select('id, nom, code, devise')

    setListePays(paysListDB || [])

    let requeteBase = supabase.from('commandes').select('*', { count: 'exact', head: true })
    let requeteData = supabase.from('commandes').select('id, lead_id, date_commande, created_at, updated_at, source, produit, quantite, statut_confirmation, client_nom, client_telephone, ville_zone, pays_id, notes, pays(id, nom, code, devise)')

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
      const r = rechercheActive.replace(/[%,()]/g, '')
      const filtre = `client_nom.ilike.%${r}%,client_telephone.ilike.%${r}%,lead_id.ilike.%${r}%`
      requeteBase = requeteBase.or(filtre)
      requeteData = requeteData.or(filtre)
    }

    if (onglet === 'historique') {
      requeteData = requeteData.order('updated_at', { ascending: false }).order('id', { ascending: false })
    } else {
      requeteData = requeteData.order('created_at', { ascending: false }).order('id', { ascending: false })
    }

    requeteData = requeteData.range(debut, fin)

    const { count } = await requeteBase
    const { data } = await requeteData

    const commandesIntelligentes = (data || []).map(cmd => {
      const detection = detecterPaysDepuisTelephone(cmd, paysListDB)

      let paysFinal
      if (detection?.paysTrouve) {
        paysFinal = detection.paysTrouve
      } else if (detection) {
        paysFinal = { nom: detection.nom, iso: detection.iso }
      } else {
        paysFinal = cmd.pays?.nom ? cmd.pays : { nom: 'Non spécifié' }
      }

      return { ...cmd, pays: paysFinal }
    })

    setTotalItems(count || 0)
    setCommandes(commandesIntelligentes)
    setLoading(false)
  }

  async function ouvrirPanneau(commande) {
    setCommandeSelectionnee(commande)
    setStatutChoisi(commande.statut_confirmation || 'confirmed')

    let paysId = commande.pays?.id || ''

    if (!paysId && commande.pays?.iso) {
      let pays = listePays.find(p => (p.code || '').toUpperCase() === commande.pays.iso)

      if (!pays) {
        const { data } = await supabase
          .from('pays')
          .insert({ nom: commande.pays.nom, code: commande.pays.iso })
          .select('id, nom, code, devise')
          .single()

        if (data) {
          pays = data
          setListePays(prev => [...prev, data])
        }
      }
      paysId = pays?.id || ''
    }

    setFormData({
      source: commande.source || '',
      client_nom: commande.client_nom || '',
      client_telephone: commande.client_telephone || '',
      ville_zone: commande.ville_zone || '',
      pays_id: paysId,
      produit: commande.produit || '',
      quantite: commande.quantite || 1,
      notes: commande.notes || '',
      date_rappel: ''
    })
  }

  async function validerAppel() {
    setEnvoiEnCours(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      router.push('/')
      return
    }

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/confirmer-appel',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          commande_id: commandeSelectionnee.id,
          statut: statutChoisi,
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

    if (agentActuel) chargerStatsJour(agentActuel.id)

    const indexActuel = commandes.findIndex(c => c.id === commandeSelectionnee.id)
    if (indexActuel !== -1 && indexActuel < commandes.length - 1) {
      ouvrirPanneau(commandes[indexActuel + 1])
    } else {
      setCommandeSelectionnee(null)
    }

    await chargerCommandes(page, ongletActif)
  }

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)
  const filtresActifs = dateDebut || dateFin || recherche || filtreStatut

  const whatsappTexte = encodeURIComponent(`Bonjour ${formData.client_nom}, c'est le service de confirmation FGMED. Nous vous contactons concernant votre commande pour le produit ${formData.produit}. Pouvons-nous valider la livraison à ${formData.ville_zone || 'votre adresse'} ?`);

  const estUnDoublon = commandes.filter(c => c.client_telephone && formData.client_telephone && c.client_telephone.replace(/\s/g, '') === formData.client_telephone.replace(/\s/g, '')).length > 1;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-16 px-6 pb-10">

      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .drawer-in { animation: drawerIn 0.25s ease-out; }
        .fade-in { animation: fadeIn 0.2s ease-out; }
        .timeline-line::before {
          content: ''; position: absolute; left: 11px; top: 24px; bottom: -8px; width: 2px; background: #C9C1B1; opacity: 0.3;
        }
        .timeline-item:last-child .timeline-line::before { display: none; }
      `}</style>

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1 flex items-center gap-2">
              Espace Agent <span className="text-[#1B2632]/30">•</span> {agentActuel?.nom || agentActuel?.name || 'Connecté'}
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Centre de confirmation</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex bg-white border border-[#C9C1B1] rounded-xl shadow-sm overflow-hidden text-sm font-medium">
              <div className="px-4 py-2 bg-[#EEE9DF]/30 text-[#1B2632]/70 border-r border-[#C9C1B1]/50">
                Aujourd'hui : <span className="font-bold text-[#1B2632] ml-1">{statsJour.total}</span> traités
              </div>
              <div className="px-4 py-2 text-emerald-700 bg-emerald-50 border-r border-[#C9C1B1]/50 flex items-center gap-1.5">
                <span className="text-xs">✓</span> {statsJour.confirmed}
              </div>
              <div className="px-4 py-2 text-gray-600 bg-gray-50 flex items-center gap-1.5">
                <span className="text-xs">📵</span> {statsJour.unreached}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => { setOngletActif('a_traiter'); setPage(1); setCommandeSelectionnee(null); setFiltreStatut(''); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  ongletActif === 'a_traiter' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Nouveaux leads
              </button>
              <button
                onClick={() => { setOngletActif('historique'); setPage(1); setCommandeSelectionnee(null); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  ongletActif === 'historique' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Historique global
              </button>
            </div>
            
            <div className="h-6 w-px bg-[#C9C1B1]/50"></div>
            
            <div className="text-sm text-[#1B2632]/60 font-medium">
              {totalItems} commande{totalItems > 1 ? 's' : ''} dans cette vue
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-[260px] focus-within:border-[#FFB162] transition-colors">
              <span className="text-[#1B2632]/40 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Nom, téléphone, lead ID..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                className="outline-none bg-transparent text-sm text-[#1B2632] font-medium w-full placeholder:text-[#1B2632]/30"
              />
              {recherche && (
                <button onClick={() => setRecherche('')} className="text-[#1B2632]/40 hover:text-[#A35139] text-xs">✕</button>
              )}
            </div>

            {ongletActif === 'historique' && (
              <select
                value={filtreStatut}
                onChange={(e) => { setFiltreStatut(e.target.value); setPage(1); }}
                className="bg-white border border-[#C9C1B1] rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] shadow-sm focus:outline-none focus:border-[#FFB162]"
              >
                <option value="">Tous les statuts</option>
                {STATUTS_APPEL.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-[#C9C1B1] shadow-sm">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest">Du</span>
                <input type="date" value={dateDebut} onChange={(e) => { setDateDebut(e.target.value); setPage(1); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer" />
              </div>
              <div className="w-[1px] h-6 bg-[#C9C1B1]/40"></div>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest">Au</span>
                <input type="date" value={dateFin} onChange={(e) => { setDateFin(e.target.value); setPage(1); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer" />
              </div>
            </div>

            {filtresActifs && (
              <button
                onClick={() => { setDateDebut(''); setDateFin(''); setRecherche(''); setFiltreStatut(''); setPage(1); }}
                className="text-xs font-semibold text-[#A35139] hover:underline"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
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
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {loading ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : commandes.length === 0 ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">Aucune commande trouvée.</td></tr>
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
                      <td className="px-6 py-4"><StatutPill statut={cmd.statut_confirmation} /></td>
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
          <div
            className="fixed inset-0 bg-[#1B2632]/30 backdrop-blur-[2px] z-40 fade-in"
            onClick={() => setCommandeSelectionnee(null)}
          />

          <div className="fixed top-0 right-0 h-screen w-[420px] max-w-full bg-white z-50 shadow-2xl border-l border-[#C9C1B1] flex flex-col drawer-in">

            <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632] mb-1">
                  {ongletActif === 'a_traiter' ? 'Traiter la commande' : 'Modifier la commande'}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A35139]">#{commandeSelectionnee.lead_id || 'N/A'}</span>
                  {commandeSelectionnee.statut_confirmation && (
                    <StatutPill statut={commandeSelectionnee.statut_confirmation} />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold text-sm ${tempsRestant < 60 ? 'text-red-600 animate-pulse' : 'text-[#1B2632]/60'}`}>
                  ⏳ {formatTemps(tempsRestant)}
                </span>
                <button onClick={() => setCommandeSelectionnee(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">
                  ✕
                </button>
              </div>
            </div>

            {estUnDoublon && (
              <div className="mx-6 mt-5 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-0.5">Alerte Doublon</p>
                  <p className="text-[11px] leading-tight opacity-90">Ce numéro de téléphone apparaît plusieurs fois dans la liste actuelle. Vérifiez avant de valider l'expédition.</p>
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
                    <a href={`tel:${formData.client_telephone}`} title="Appeler" className="w-9 h-9 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg flex items-center justify-center transition-colors">📞</a>
                    <a href={`https://wa.me/${formData.client_telephone.replace(/[+\s]/g, '')}?text=${whatsappTexte}`} target="_blank" rel="noreferrer" title="WhatsApp avec template" className="w-9 h-9 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 rounded-lg flex items-center justify-center transition-colors">💬</a>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Ville / Zone</label>
                    <input
                      type="text"
                      value={formData.ville_zone}
                      onChange={(e) => setFormData({...formData, ville_zone: e.target.value})}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Pays</label>
                    <select
                      value={formData.pays_id}
                      onChange={(e) => setFormData({...formData, pays_id: e.target.value})}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    >
                      <option value="">Sélectionner</option>
                      {listePays.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
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
                      <button type="button" onClick={() => setFormData({...formData, quantite: Math.max(1, formData.quantite - 1)})} className="px-2 py-2 text-[#1B2632] font-bold hover:text-[#A35139]">-</button>
                      <input
                        type="number"
                        value={formData.quantite}
                        onChange={(e) => setFormData({...formData, quantite: parseInt(e.target.value) || 1})}
                        className="w-full text-center py-2 font-bold text-sm text-[#1B2632] outline-none bg-transparent"
                      />
                      <button type="button" onClick={() => setFormData({...formData, quantite: formData.quantite + 1})} className="px-2 py-2 text-[#1B2632] font-bold hover:text-[#A35139]">+</button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Source (Optionnel)</label>
                  <input
                    type="text"
                    value={formData.source}
                    onChange={(e) => setFormData({...formData, source: e.target.value})}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Notes</label>
                  <textarea
                    rows="2"
                    placeholder="Ex: Client demande à être rappelé demain matin..."
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent resize-none"
                  />
                </div>
              </div>

              <div className="p-4 bg-[#EEE9DF]/30 rounded-xl border border-[#C9C1B1]/50">
                <label className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">
                  Résultat de l'appel
                </label>
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#1B2632]/20 rounded-lg px-3 py-2.5 text-sm font-bold text-[#1B2632] focus:outline-none focus:ring-2 focus:ring-[#FFB162] bg-white shadow-sm"
                >
                  {STATUTS_APPEL.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>

                {statutChoisi === 'reminder' && (
                  <div className="mt-3">
                    <label className="block text-[11px] font-bold text-[#8a5a1f] uppercase mb-1">Date et heure de rappel</label>
                    <input
                      type="datetime-local"
                      value={formData.date_rappel}
                      onChange={(e) => setFormData({...formData, date_rappel: e.target.value})}
                      className="w-full border border-[#FFB162]/50 rounded-lg px-3 py-2 text-sm text-[#8a5a1f] bg-white outline-none focus:ring-1 focus:ring-[#FFB162]"
                    />
                  </div>
                )}
              </div>

              <div className="mt-2">
                <h3 className="text-[11px] font-bold text-[#1B2632]/50 uppercase tracking-widest mb-4 border-b border-[#C9C1B1]/30 pb-2">
                  Historique des actions
                </h3>
                
                {loadingHistorique ? (
                  <div className="text-center text-xs text-[#1B2632]/40 py-4">Chargement de l'historique...</div>
                ) : historiqueLead.length === 0 ? (
                  <div className="text-center text-xs text-[#1B2632]/40 py-4 bg-[#EEE9DF]/20 rounded-lg border border-[#C9C1B1]/30">Aucun appel précédent enregistré.</div>
                ) : (
                  <div className="flex flex-col relative pl-1">
                    {historiqueLead.map((log) => {
                      const date = new Date(log.created_at)
                      const isToday = date.toDateString() === new Date().toDateString()
                      const dateText = isToday ? "Aujourd'hui" : date.toLocaleDateString('fr-FR')
                      const timeText = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                      
                      return (
                        <div key={log.id} className="timeline-item relative pl-6 pb-5">
                          <div className="timeline-line"></div>
                          <div className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full bg-[#A35139] shadow-[0_0_0_3px_#fff]"></div>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <StatutPill statut={log.statut} />
                              <span className="text-[10px] text-[#1B2632]/50 font-medium">
                                par <span className="font-bold text-[#1B2632]/70">{log.agents?.nom || log.agents?.name || 'Inconnu'}</span>
                              </span>
                            </div>
                            <div className="text-[10px] text-[#1B2632]/40 uppercase tracking-wider font-bold mt-0.5">
                              {dateText} à {timeText}
                            </div>
                            {log.notes && (
                              <div className="mt-1.5 p-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs text-[#1B2632]/80 italic">
                                "{log.notes}"
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </div>

            <div className="px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              <button
                onClick={validerAppel}
                disabled={envoiEnCours}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md"
              >
                {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <p className="text-[10px] text-center text-[#1B2632]/40 mt-2 font-medium uppercase tracking-wider">
                Échap pour fermer · Lead suivant après enregistrement
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}