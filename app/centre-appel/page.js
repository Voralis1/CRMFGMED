'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext' 
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import * as XLSX from 'xlsx'

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
  const conf = configs[statut] || configs['en_attente']
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text} whitespace-nowrap flex items-center gap-1.5 w-fit`}>
      {conf.label}
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

export default function CentreAppelAgent() {
  const { user, tenantId, loading: authLoading } = useAuth() 
  const { hasPermission, loading: permsLoading } = usePermissions() 
  const router = useRouter()

  const [commandes, setCommandes] = useState([])
  const [listePays, setListePays] = useState([])
  const [listeZones, setListeZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [ongletActif, setOngletActif] = useState('a_traiter')

  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [recherche, setRecherche] = useState('')
  const [rechercheActive, setRechercheActive] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')

  const [filtreProduit, setFiltreProduit] = useState('')
  const [filtreAgent, setFiltreAgent] = useState('')
  const [filtreVille, setFiltreVille] = useState('')
  const [filtreSource, setFiltreSource] = useState('')
  const [filtrePays, setFiltrePays] = useState('')
  const [panneauFiltresOuvert, setPanneauFiltresOuvert] = useState(false)
  const [optionsFiltres, setOptionsFiltres] = useState({ produits: [], villes: [], sources: [], agents: [], pays: [] })

  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const ITEMS_PER_PAGE = 50

  const [agentActuel, setAgentActuel] = useState(null)
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('confirmed')

  const [historiqueLead, setHistoriqueLead] = useState([])
  const [loadingHistorique, setLoadingHistorique] = useState(false)
  const [tempsRestant, setTempsRestant] = useState(300)

  const [formData, setFormData] = useState({
    source: '', client_nom: '', client_telephone: '', ville_zone: '',
    zone_id: '', pays_id: '', produit: '', quantite: 1, prix: 0, notes: '', date_rappel: ''
  })

  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  // REDIRECTION SÉCURISÉE VIA LA MATRICE
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_centre_appel')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

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
      if (e.key === 'Escape') {
        setCommandeSelectionnee(null)
        setPanneauFiltresOuvert(false)
      }
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
        .select(`id, statut, notes, date_rappel, created_at, agents ( nom, name, full_name )`)
        .eq('commande_id', commandeSelectionnee.id)
        .order('created_at', { ascending: false })

      setHistoriqueLead(data || [])
      setLoadingHistorique(false)
    }
    chargerHistorique()
  }, [commandeSelectionnee?.id])

  useEffect(() => {
    async function chargerOptionsFiltres() {
      if (!user || !tenantId) return

      const [{ data: produits }, { data: villes }, { data: sources }, { data: agents }, { data: pays }] = await Promise.all([
        supabase.from('commandes').select('produit').eq('tenant_id', tenantId).not('produit', 'is', null).limit(2000),
        supabase.from('commandes').select('ville_zone').eq('tenant_id', tenantId).not('ville_zone', 'is', null).limit(2000),
        supabase.from('commandes').select('source').eq('tenant_id', tenantId).not('source', 'is', null).limit(2000),
        supabase.from('agents').select('id, nom, name, full_name').eq('tenant_id', tenantId),
        supabase.from('pays').select('id, nom').eq('tenant_id', tenantId).order('nom')
      ])

      const uniques = (rows, key) =>
        [...new Set((rows || []).map(r => (r[key] || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'fr'))

      setOptionsFiltres({
        produits: uniques(produits, 'produit'),
        villes: uniques(villes, 'ville_zone'),
        sources: uniques(sources, 'source'),
        agents: (agents || []).map(a => ({
          id: a.id,
          nom: a.nom || a.name || a.full_name || 'Agent'
        })),
        pays: (pays || []).map(p => ({ id: p.id, nom: p.nom }))
      })
    }
    chargerOptionsFiltres()
  }, [user, tenantId])

  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantId) return

    async function verifierAgentEtCharger() {
      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (agentData) {
        setAgentActuel(agentData)
      }

      await chargerCommandes(page, ongletActif)
    }

    verifierAgentEtCharger()
  }, [page, ongletActif, dateDebut, dateFin, rechercheActive, filtreStatut, filtreProduit, filtreAgent, filtreVille, filtreSource, filtrePays, authLoading, permsLoading, user, tenantId])

  async function chargerCommandes(pageActuelle, onglet) {
    if (!tenantId) return
    setLoading(true)
    const debut = (pageActuelle - 1) * ITEMS_PER_PAGE
    const fin = debut + ITEMS_PER_PAGE - 1

    const { data: paysListDB } = await supabase.from('pays').select('id, nom, code, devise').eq('tenant_id', tenantId)
    setListePays(paysListDB || [])

    const { data: zonesListDB } = await supabase.from('zones').select('*').eq('tenant_id', tenantId)
    setListeZones(zonesListDB || [])

    const jointureAppels = filtreAgent ? ', appels!inner(agent_id)' : ''

    let requeteBase = supabase.from('commandes').select(`*${jointureAppels}`, { count: 'exact', head: true }).eq('tenant_id', tenantId)
    let requeteData = supabase.from('commandes').select(`id, lead_id, date_commande, created_at, updated_at, source, produit, quantite, prix, statut_confirmation, client_nom, client_telephone, ville_zone, zone_id, pays_id, notes, pays(id, nom, code, devise)${jointureAppels}`).eq('tenant_id', tenantId)

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

    if (filtreProduit) { requeteBase = requeteBase.eq('produit', filtreProduit); requeteData = requeteData.eq('produit', filtreProduit); }
    if (filtreVille) { requeteBase = requeteBase.eq('ville_zone', filtreVille); requeteData = requeteData.eq('ville_zone', filtreVille); }
    if (filtreSource) { requeteBase = requeteBase.eq('source', filtreSource); requeteData = requeteData.eq('source', filtreSource); }
    if (filtreAgent) { requeteBase = requeteBase.eq('appels.agent_id', filtreAgent); requeteData = requeteData.eq('appels.agent_id', filtreAgent); }

    if (onglet === 'historique') {
      requeteData = requeteData.order('updated_at', { ascending: false }).order('id', { ascending: false })
    } else {
      requeteData = requeteData.order('created_at', { ascending: false }).order('id', { ascending: false })
    }

    if (!filtrePays) {
      requeteData = requeteData.range(debut, fin)
    } else {
      requeteData = requeteData.limit(5000)
    }

    const { count } = await requeteBase
    const { data } = await requeteData

    const commandesIntelligentes = (data || []).map(cmd => {
      const { appels, ...cmdSansJointure } = cmd
      const detection = detecterPaysDepuisTelephone(cmdSansJointure, paysListDB)

      let paysFinal
      if (detection?.paysTrouve) {
        paysFinal = detection.paysTrouve
      } else if (detection) {
        paysFinal = { nom: detection.nom, iso: detection.iso }
      } else {
        paysFinal = cmdSansJointure.pays?.nom ? cmdSansJointure.pays : { nom: 'Non spécifié' }
      }

      return { ...cmdSansJointure, pays: paysFinal }
    })

    if (filtrePays) {
      const paysSelectionne = paysListDB.find(p => String(p.id) === String(filtrePays))
      const resFiltre = commandesIntelligentes.filter(cmd => {
        if (!paysSelectionne) return false
        return (
          String(cmd.pays_id) === String(filtrePays) ||
          cmd.pays?.id === paysSelectionne.id ||
          cmd.pays?.nom === paysSelectionne.nom ||
          cmd.pays?.iso === paysSelectionne.code ||
          cmd.pays?.code === paysSelectionne.code
        )
      })

      setTotalItems(resFiltre.length)
      setCommandes(resFiltre.slice(debut, debut + ITEMS_PER_PAGE))
    } else {
      setTotalItems(count || 0)
      setCommandes(commandesIntelligentes)
    }
    
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
          .insert({ nom: commande.pays.nom, code: commande.pays.iso, tenant_id: tenantId })
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
      zone_id: commande.zone_id || '',
      pays_id: paysId,
      produit: commande.produit || '',
      quantite: commande.quantite || 1,
      prix: commande.prix || 0,
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
          tenant_id: tenantId, // 🚀 CORRECTION : Ajout du tenant_id pour éviter l'erreur not-null constraint
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

    await chargerCommandes(page, ongletActif)
  }

  const appliquer = (setter) => (v) => { setter(v); setPage(1) }

  function reinitialiserFiltres() {
    setDateDebut(''); setDateFin(''); setRecherche(''); setFiltreStatut('')
    setFiltreProduit(''); setFiltreAgent(''); setFiltreVille(''); setFiltreSource(''); setFiltrePays('')
    setPage(1)
  }

  function exporterCSV() {
    if (commandes.length === 0) {
      alert("Aucune commande à exporter dans cette vue.")
      return
    }

    const entetes = ["Lead ID", "Date", "Client", "Telephone", "Pays", "Ville", "Produit", "Quantite", "Prix", "Statut"]
    const lignes = commandes.map(c => [
      c.lead_id || "",
      c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR') : "",
      `"${(c.client_nom || "").replace(/"/g, '""')}"`,
      `"${(c.client_telephone || "").replace(/"/g, '""')}"`,
      `"${(c.pays?.nom || "").replace(/"/g, '""')}"`,
      `"${(c.ville_zone || "").replace(/"/g, '""')}"`,
      `"${(c.produit || "").replace(/"/g, '""')}"`,
      c.quantite || 1,
      c.prix || 0,
      c.statut_confirmation || "en_attente"
    ])

    const contenuCSV = [entetes.join(","), ...lignes.map(l => l.join(","))].join("\n")
    const blob = new Blob([contenuCSV], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const lien = document.createElement("a")
    lien.setAttribute("href", url)
    lien.setAttribute("download", `commandes_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(lien)
    lien.click()
    document.body.removeChild(lien)
  }

  async function importerFichier(event) {
    const fichier = event.target.files[0]
    if (!fichier || !tenantId) return

    const lecteur = new FileReader()
    lecteur.onload = async function (e) {
      try {
        const data = new Uint8Array(e.target.result)
        const classeur = XLSX.read(data, { type: 'array' })
        const nomFeuille = classeur.SheetNames[0]
        const feuille = classeur.Sheets[nomFeuille]
        const lignes = XLSX.utils.sheet_to_json(feuille, { defval: "" })

        if (lignes.length === 0) {
          alert("Le fichier est vide ou mal formaté.")
          return
        }

        let nouvellesCommandes = lignes.map(ligne => {
          const ligneNormalisee = {}
          for (let cle in ligne) {
            ligneNormalisee[cle.toLowerCase().trim()] = ligne[cle]
          }

          return {
            client_nom: ligneNormalisee['client_nom'] || ligneNormalisee['nom'] || ligneNormalisee['client'] || 'Inconnu',
            client_telephone: String(ligneNormalisee['client_telephone'] || ligneNormalisee['telephone'] || ligneNormalisee['tel'] || ''),
            ville_zone: ligneNormalisee['ville_zone'] || ligneNormalisee['ville'] || ligneNormalisee['zone'] || '',
            produit: ligneNormalisee['produit'] || 'Produit standard',
            quantite: parseInt(ligneNormalisee['quantite']) || 1,
            prix: parseFloat(ligneNormalisee['prix']) || 0,
            source: 'csv', 
            notes: ligneNormalisee['notes'] || ligneNormalisee['note'] || '',
            lead_id: `LEAD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            tenant_id: tenantId
          }
        }).filter(cmd => cmd.client_telephone !== '')

        if (nouvellesCommandes.length === 0) {
          alert("Aucune donnée valide trouvée dans le fichier.")
          return
        }

        const { error } = await supabase.from('commandes').insert(nouvellesCommandes)
        if (error) {
          alert("Erreur lors de l'import : " + error.message)
        } else {
          alert(`Import réussi : ${nouvellesCommandes.length} commandes ajoutées.`)
          window.location.reload()
        }
      } catch (erreur) {
        alert("Erreur lors de la lecture du fichier.")
      }
    }
    lecteur.readAsArrayBuffer(fichier)
    event.target.value = null
  }

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)
  const nombreFiltresActifs = [filtreStatut, filtreProduit, filtreAgent, filtreVille, filtreSource, filtrePays].filter(Boolean).length
  const filtresActifs = dateDebut || dateFin || recherche || nombreFiltresActifs > 0

  const whatsappTexte = encodeURIComponent(`Bonjour ${formData.client_nom}, c'est le service de confirmation. Nous vous contactons concernant votre commande pour le produit ${formData.produit}. Pouvons-nous valider la livraison à ${formData.ville_zone || 'votre adresse'} ?`);
  const estUnDoublon = commandes.filter(c => c.client_telephone && formData.client_telephone && c.client_telephone.replace(/\s/g, '') === formData.client_telephone.replace(/\s/g, '')).length > 1;

  const labelStatut = (v) => STATUTS_APPEL.find(s => s.value === v)?.label || v
  const nomAgent = (id) => optionsFiltres.agents.find(a => a.id === id)?.nom || 'Agent'

  // ÉCRAN D'ATTENTE OU DE BLOCAGE
  if (authLoading || permsLoading || !hasPermission('menu_centre_appel')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-16 px-6 pb-10">
      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .drawer-in { animation: drawerIn 0.25s ease-out; }
        .fade-in { animation: fadeIn 0.2s ease-out; }
        .pop-in { animation: popIn 0.18s ease-out; }
        .timeline-line::before {
          content: ''; position: absolute; left: 11px; top: 24px; bottom: -8px; width: 2px; background: #C9C1B1; opacity: 0.3;
        }
        .timeline-item:last-child .timeline-line::before { display: none; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1 flex items-center gap-2">
              Espace Agent <span className="text-[#1B2632]/30">•</span> {agentActuel?.nom || agentActuel?.name || 'Connecté'}
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Centre de confirmation</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* BOUTON EXPORT SÉCURISÉ */}
            {hasPermission('exporter_csv') && (
              <button
                onClick={exporterCSV}
                title="Exporter la vue actuelle en CSV"
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-xs font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exporter CSV
              </button>
            )}

            {/* BOUTON IMPORT SÉCURISÉ */}
            {hasPermission('importer_csv') && (
              <label
                title="Importer des commandes depuis un fichier CSV ou Excel"
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-xs font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Importer CSV/Excel
                <input
                  type="file"
                  accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={importerFichier}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center mt-2 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => { setOngletActif('a_traiter'); setPage(1); setCommandeSelectionnee(null); setFiltreStatut(''); setFiltreAgent(''); }}
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
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-[280px] focus-within:border-[#FFB162] transition-colors">
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
                  <div className="fixed inset-0 z-20" onClick={() => setPanneauFiltresOuvert(false)} />
                  <div className="absolute right-0 top-full mt-2 w-[300px] bg-white rounded-2xl border border-[#C9C1B1] shadow-xl z-30 p-5 pop-in">
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
                        <SelectFiltre label="Statut" value={filtreStatut} onChange={appliquer(setFiltreStatut)} options={STATUTS_APPEL} placeholder="Tous les statuts" />
                      )}
                      {ongletActif === 'historique' && (
                        <SelectFiltre label="Agent" value={filtreAgent} onChange={appliquer(setFiltreAgent)} options={optionsFiltres.agents.map(a => ({ value: a.id, label: a.nom }))} placeholder="Tous les agents" />
                      )}
                      <SelectFiltre label="Pays" value={filtrePays} onChange={appliquer(setFiltrePays)} options={optionsFiltres.pays.map(p => ({ value: p.id, label: p.nom }))} placeholder="Tous les pays" />
                      <SelectFiltre label="Produit" value={filtreProduit} onChange={appliquer(setFiltreProduit)} options={optionsFiltres.produits.map(p => ({ value: p, label: p }))} placeholder="Tous les produits" />
                      <SelectFiltre label="Ville" value={filtreVille} onChange={appliquer(setFiltreVille)} options={optionsFiltres.villes.map(v => ({ value: v, label: v }))} placeholder="Toutes les villes" />
                      <SelectFiltre label="Source" value={filtreSource} onChange={appliquer(setFiltreSource)} options={optionsFiltres.sources.map(s => ({ value: s, label: s }))} placeholder="Toutes les sources" />
                    </div>

                    <button onClick={() => setPanneauFiltresOuvert(false)} className="w-full mt-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                      Appliquer
                    </button>
                  </div>
                </>
              )}
            </div>

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
              <button onClick={reinitialiserFiltres} className="text-xs font-semibold text-[#A35139] hover:underline">
                Réinitialiser
              </button>
            )}
          </div>
        </div>

        {nombreFiltresActifs > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filtreStatut && <ChipFiltre label={`Statut : ${labelStatut(filtreStatut)}`} onClear={() => appliquer(setFiltreStatut)('')} />}
            {filtreAgent && <ChipFiltre label={`Agent : ${nomAgent(filtreAgent)}`} onClear={() => appliquer(setFiltreAgent)('')} />}
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
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">Aucune commande trouvée.</td></tr>
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
                    <StatutPill statut={commandeSelectionnee.statut_confirmation} />
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Zone officielle</label>
                    <select
                      value={formData.zone_id}
                      onChange={(e) => setFormData({...formData, zone_id: e.target.value})}
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
                      <button type="button" onClick={() => setFormData({...formData, quantite: Math.max(1, formData.quantite - 1)})} className="px-2 py-2 text-[#1B2632] font-bold">-</button>
                      <input
                        type="number"
                        value={formData.quantite}
                        onChange={(e) => setFormData({...formData, quantite: parseInt(e.target.value) || 1})}
                        className="w-full text-center py-2 font-bold text-sm text-[#1B2632] outline-none bg-transparent"
                      />
                      <button type="button" onClick={() => setFormData({...formData, quantite: formData.quantite + 1})} className="px-2 py-2 text-[#1B2632] font-bold">+</button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Prix total</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.prix}
                    onChange={(e) => setFormData({...formData, prix: parseFloat(e.target.value) || 0})}
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
                      className="w-full border border-[#FFB162]/50 rounded-lg px-3 py-2 text-sm text-[#8a5a1f] bg-white outline-none"
                    />
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
            </div>
          </div>
        </>
      )}
    </div>
  )
}