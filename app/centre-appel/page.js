'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { parsePhoneNumberFromString } from 'libphonenumber-js' // Import de l'outil de détection

// Liste des statuts possibles pour le centre d'appel (avec Doublon)
const STATUTS_APPEL = [
  { value: 'confirmed', label: 'Confirmée' },
  { value: 'unreached', label: 'Injoignable' },
  { value: 'reminder', label: 'À rappeler' },
  { value: 'cancelled', label: 'Annulée' },
  { value: 'spam', label: 'Spam' },
  { value: 'double', label: 'Doublon' },
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
    'not_active_yet': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Inactif' },
  }
  const conf = configs[statut] || configs['en_attente']
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text} whitespace-nowrap`}>
      {conf.label}
    </span>
  )
}

export default function CentreAppelAgent() {
  const [commandes, setCommandes] = useState([])
  const [loading, setLoading] = useState(true)
  const [ongletActif, setOngletActif] = useState('a_traiter')
  
  // États pour les filtres de dates
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')

  // États de la pagination
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const ITEMS_PER_PAGE = 50

  const [nomAgent, setNomAgent] = useState('Chargement...')
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('confirmed')
  
  // Nouvel état pour gérer les données modifiables du formulaire
  const [formData, setFormData] = useState({
    client_telephone: '',
    adresse: '',
    quantite: 1,
    prix: 0,
    notes: '',
    tentatives_appel: 0,
    date_rappel: ''
  })

  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const router = useRouter()

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

      const roleUtilisateur = roleData?.role

      if (roleUtilisateur !== 'admin' && roleUtilisateur !== 'agent') {
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
        const nomBDD = agentData.nom || agentData.name || agentData.full_name
        setNomAgent(nomBDD || session.user.email)
      } else {
        setNomAgent(session.user.email)
      }

      await chargerCommandes(page, ongletActif)
    }

    verifierAccesEtCharger()
  }, [page, ongletActif, dateDebut, dateFin, router])

  async function chargerCommandes(pageActuelle, onglet) {
    setLoading(true)
    const debut = (pageActuelle - 1) * ITEMS_PER_PAGE
    const fin = debut + ITEMS_PER_PAGE - 1

    const { data: paysList } = await supabase
      .from('pays')
      .select('id, nom, code, devise')

    let requeteBase = supabase.from('commandes').select('*', { count: 'exact', head: true })
    // AJOUT DE "updated_at" DANS LA SÉLECTION POUR LE TRI DE L'HISTORIQUE
    let requeteData = supabase.from('commandes').select('id, lead_id, date_commande, created_at, updated_at, produit, quantite, statut_confirmation, client_nom, client_telephone, ville_zone, pays(id, nom, code, devise)')

    if (onglet === 'a_traiter') {
      requeteBase = requeteBase.is('statut_confirmation', null)
      requeteData = requeteData.is('statut_confirmation', null)
    } else {
      requeteBase = requeteBase.not('statut_confirmation', 'is', null)
      requeteData = requeteData.not('statut_confirmation', 'is', null)
    }

    // Le filtre de date s'applique sur la création ou le traitement selon l'onglet
    const dateField = onglet === 'historique' ? 'updated_at' : 'created_at'

    if (dateDebut) {
      requeteBase = requeteBase.gte(dateField, dateDebut)
      requeteData = requeteData.gte(dateField, dateDebut)
    }
    if (dateFin) {
      requeteBase = requeteBase.lte(dateField, `${dateFin}T23:59:59`)
      requeteData = requeteData.lte(dateField, `${dateFin}T23:59:59`)
    }

    // TRI DYNAMIQUE SELON L'ONGLET ACTIF
    if (onglet === 'historique') {
      // Pour l'historique : les derniers traités (mis à jour) en premier
      requeteData = requeteData
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
    } else {
      // Pour les nouveaux leads : les plus récents (ou plus anciens selon la stratégie, ici récents)
      requeteData = requeteData
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    }

    requeteData = requeteData.range(debut, fin)

    const { count } = await requeteBase
    const { data } = await requeteData

    // DÉTECTION INTELLIGENTE DES PAYS AVEC libphonenumber-js
    const commandesIntelligentes = (data || []).map(cmd => {
      let tel = cmd.client_telephone ? cmd.client_telephone.trim().replace(/\s+/g, '') : ''
      
      // S'assurer que le numéro commence par un + pour l'analyseur
      if (tel.startsWith('00')) {
        tel = '+' + tel.slice(2)
      } else if (!tel.startsWith('+') && tel.length > 8) {
        tel = '+' + tel
      }

      let paysNomParDefaut = null

      const phoneNumber = parsePhoneNumberFromString(tel)
      
      if (phoneNumber && phoneNumber.country) {
        // Intl.DisplayNames traduit le code ISO 2 lettres du pays (ex: SN) en français (Sénégal)
        const traducteurPays = new Intl.DisplayNames(['fr'], { type: 'region' })
        paysNomParDefaut = traducteurPays.of(phoneNumber.country) 
        
        // Ajustements manuels pour correspondre aux appellations courantes en base de données
        if (phoneNumber.country === 'CD') paysNomParDefaut = 'RDC'
        if (phoneNumber.country === 'CG') paysNomParDefaut = 'Congo'
      }

      let paysTrouve = null
      if (paysNomParDefaut && paysList) {
        // Recherche insensible à la casse et aux accents
        paysTrouve = paysList.find(p => 
          p.nom.toLowerCase().localeCompare(paysNomParDefaut.toLowerCase(), 'fr', { sensitivity: 'base' }) === 0
          || p.nom.toLowerCase().includes(paysNomParDefaut.toLowerCase())
        )
      }

      const paysFinal = paysTrouve || (paysNomParDefaut ? { nom: paysNomParDefaut } : (cmd.pays?.nom ? cmd.pays : { nom: 'Non spécifié' }))

      return {
        ...cmd,
        pays: paysFinal
      }
    })

    setTotalItems(count || 0)
    setCommandes(commandesIntelligentes)
    setLoading(false)
  }

  function ouvrirPanneau(commande) {
    setCommandeSelectionnee(commande)
    setStatutChoisi(commande.statut_confirmation || 'confirmed')
    
    // Initialiser les données du formulaire avec celles de la commande
    setFormData({
      client_telephone: commande.client_telephone || '',
      adresse: commande.ville_zone || '',
      quantite: commande.quantite || 1,
      prix: commande.prix || 0,
      notes: commande.notes || '',
      tentatives_appel: commande.tentatives_appel || 0,
      date_rappel: commande.date_rappel || ''
    })
  }

  async function validerAppel() {
    setEnvoiEnCours(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      router.push('/')
      return
    }

    // Envoi des données complètes à la fonction backend
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
          ...formData // Inclusion de toutes les données éditées par l'agent
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    // Passer directement au lead suivant
    const indexActuel = commandes.findIndex(c => c.id === commandeSelectionnee.id)
    if (indexActuel !== -1 && indexActuel < commandes.length - 1) {
      ouvrirPanneau(commandes[indexActuel + 1])
    } else {
      setCommandeSelectionnee(null)
    }
    
    await chargerCommandes(page, ongletActif)
  }

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE)

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
      
      {/* En-tête et Onglets */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Espace Agent
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Centre de confirmation</h1>
          </div>
          <div className="text-sm text-[#1B2632]/60 font-medium bg-white px-4 py-2 border border-[#C9C1B1] rounded-xl shadow-sm">
            {totalItems} commande{totalItems > 1 ? 's' : ''} trouvée{totalItems > 1 ? 's' : ''}
          </div>
        </div>

        <div className="flex justify-between items-center mt-2 flex-wrap gap-4">
          <div className="flex gap-4">
            <button 
              onClick={() => { setOngletActif('a_traiter'); setPage(1); setCommandeSelectionnee(null); }}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                ongletActif === 'a_traiter' 
                  ? 'bg-[#1B2632] text-white shadow-md' 
                  : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              Nouveaux leads
            </button>
            <button 
              onClick={() => { setOngletActif('historique'); setPage(1); setCommandeSelectionnee(null); }}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                ongletActif === 'historique' 
                  ? 'bg-[#1B2632] text-white shadow-md' 
                  : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              Historique
            </button>
          </div>

          {/* Filtre de dates */}
          <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-[#C9C1B1] shadow-sm">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest">Du</span>
              <input 
                type="date" 
                value={dateDebut} 
                onChange={(e) => { setDateDebut(e.target.value); setPage(1); }} 
                className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer" 
              />
            </div>
            <div className="w-[1px] h-6 bg-[#C9C1B1]/40"></div>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest">Au</span>
              <input 
                type="date" 
                value={dateFin} 
                onChange={(e) => { setDateFin(e.target.value); setPage(1); }} 
                className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer" 
              />
            </div>
          </div>
        </div>
      </header>

      {/* Zone principale */}
      <div className="flex gap-6 items-start relative">
        
        {/* Colonne de gauche : Tableau */}
        <div className="flex-1 bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                  <th className="px-6 py-4">Lead ID</th>
                  <th className="px-6 py-4">{ongletActif === 'historique' ? 'Date de Traitement' : 'Date'}</th>
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
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">
                      Chargement...
                    </td>
                  </tr>
                ) : commandes.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">
                      Aucune commande trouvée.
                    </td>
                  </tr>
                ) : (
                  commandes.map((cmd) => {
                    const estSelectionne = commandeSelectionnee?.id === cmd.id
                    
                    // On choisit la date à afficher en fonction de l'onglet
                    const dateAffichage = ongletActif === 'historique' 
                      ? (cmd.updated_at ? new Date(cmd.updated_at) : null)
                      : (cmd.date_commande ? new Date(cmd.date_commande) : (cmd.created_at ? new Date(cmd.created_at) : null))

                    return (
                      <tr key={cmd.id} className={`transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/20'}`}>
                        
                        {/* 1. Lead ID */}
                        <td className="px-6 py-4 font-mono text-sm text-[#1B2632]/80">
                          #{cmd.lead_id || 'N/A'}
                        </td>

                        {/* 2. Date */}
                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {dateAffichage ? dateAffichage.toLocaleDateString('fr-FR') : '-'}
                          {ongletActif === 'historique' && dateAffichage && (
                            <span className="block text-xs text-[#1B2632]/50">{dateAffichage.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'})}</span>
                          )}
                        </td>

                        {/* 3. Client */}
                        <td className="px-6 py-4">
                          <div className="font-bold text-[#1B2632]">
                            {cmd.client_nom || 'Client inconnu'}
                          </div>
                          <div className="font-mono text-xs text-[#A35139] font-semibold mt-1">
                            {cmd.client_telephone || 'Aucun numéro'}
                          </div>
                        </td>

                        {/* 4. Pays */}
                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]">
                          {cmd.pays?.nom || '-'}
                        </td>

                        {/* 5. Ville / Zone */}
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.ville_zone || '-'}</div>
                        </td>

                        {/* 6. Produit */}
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.produit || '-'}</div>
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">Qté: {cmd.quantite || 1}</div>
                        </td>

                        {/* 7. Statut */}
                        <td className="px-6 py-4">
                          <StatutPill statut={cmd.statut_confirmation} />
                        </td>

                        {/* 8. Actions */}
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => ouvrirPanneau(cmd)}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                              estSelectionne 
                                ? 'bg-[#1B2632] text-white' 
                                : 'bg-[#EEE9DF] text-[#1B2632] border border-[#C9C1B1] hover:bg-[#C9C1B1]'
                            }`}
                          >
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

          {/* Pagination */}
          <div className="bg-[#EEE9DF]/20 border-t border-[#C9C1B1]/50 px-6 py-4 flex items-center justify-between">
            <span className="text-sm text-[#1B2632]/60">
              Page {page} sur {totalPages || 1}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || totalPages === 0 || loading}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors"
              >
                Suivant
              </button>
            </div>
          </div>
        </div>

        {/* Colonne de droite : Panneau Latéral Enrichi */}
        {commandeSelectionnee && (
          <div className="w-[400px] flex-shrink-0 bg-white border border-[#C9C1B1] rounded-2xl shadow-lg p-6 sticky top-6 max-h-[calc(100vh-100px)] overflow-y-auto">
            <div className="flex justify-between items-start mb-6 border-b border-[#C9C1B1]/50 pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632]">
                  {ongletActif === 'a_traiter' ? 'Traiter le Lead' : 'Modifier l\'appel'}
                </h2>
                <div className="flex items-center gap-3 mt-2">
                  <div className="font-mono text-xl text-[#A35139] font-semibold">
                    {formData.client_telephone || 'Aucun numéro'}
                  </div>
                </div>
                {/* Actions rapides Appeler / WhatsApp */}
                <div className="flex gap-2 mt-3">
                  <a href={`tel:${formData.client_telephone}`} className="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 transition-colors text-xs font-bold rounded-lg flex items-center gap-1">
                    📞 Appeler
                  </a>
                  <a href={`https://wa.me/${formData.client_telephone.replace('+', '')}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 bg-[#25D366] text-white hover:bg-[#1DA851] transition-colors text-xs font-bold rounded-lg flex items-center gap-1">
                    💬 WhatsApp
                  </a>
                </div>
              </div>
              <button onClick={() => setCommandeSelectionnee(null)} className="text-[#1B2632]/40 hover:text-[#A35139] transition-colors text-xl">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-5">
              
              {/* Infos modifiables : Téléphone et Adresse */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase mb-1">Téléphone</label>
                  <input 
                    type="text" 
                    value={formData.client_telephone}
                    onChange={(e) => setFormData({...formData, client_telephone: e.target.value})}
                    className="w-full border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase mb-1">Adresse / Ville</label>
                  <input 
                    type="text" 
                    value={formData.adresse}
                    onChange={(e) => setFormData({...formData, adresse: e.target.value})}
                    className="w-full border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162]"
                  />
                </div>
              </div>

              {/* Infos modifiables : Quantité et Prix (Upsell) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase mb-1">Quantité</label>
                  <div className="flex items-center border border-[#C9C1B1] rounded-xl overflow-hidden">
                    <button type="button" onClick={() => setFormData({...formData, quantite: Math.max(1, formData.quantite - 1)})} className="px-3 py-2 bg-[#EEE9DF]/50 hover:bg-[#C9C1B1]/50 text-[#1B2632] font-bold">-</button>
                    <input 
                      type="number" 
                      value={formData.quantite}
                      onChange={(e) => setFormData({...formData, quantite: parseInt(e.target.value) || 1})}
                      className="w-full text-center py-2 text-sm text-[#1B2632] outline-none"
                    />
                    <button type="button" onClick={() => setFormData({...formData, quantite: formData.quantite + 1})} className="px-3 py-2 bg-[#EEE9DF]/50 hover:bg-[#C9C1B1]/50 text-[#1B2632] font-bold">+</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase mb-1">Prix total</label>
                  <input 
                    type="number" 
                    value={formData.prix}
                    onChange={(e) => setFormData({...formData, prix: parseFloat(e.target.value) || 0})}
                    className="w-full border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162]"
                  />
                </div>
              </div>

              {/* Statut de l'appel */}
              <div className="mt-2 border-t border-[#C9C1B1]/50 pt-4">
                <label className="block text-sm font-bold text-[#1B2632] mb-2">
                  Résultat de l'appel
                </label>
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#1B2632] rounded-xl px-4 py-3 text-sm font-semibold text-[#1B2632] focus:outline-none focus:ring-2 focus:ring-[#FFB162] bg-[#EEE9DF]/20 transition-all shadow-sm"
                >
                  {STATUTS_APPEL.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Date de rappel conditionnelle */}
              {statutChoisi === 'reminder' && (
                <div className="p-3 bg-[#FFB162]/10 rounded-xl border border-[#FFB162]/30">
                  <label className="block text-xs font-bold text-[#8a5a1f] uppercase mb-1">Date et heure de rappel</label>
                  <input 
                    type="datetime-local" 
                    value={formData.date_rappel}
                    onChange={(e) => setFormData({...formData, date_rappel: e.target.value})}
                    className="w-full border border-[#FFB162]/50 rounded-lg px-3 py-2 text-sm text-[#8a5a1f] bg-white outline-none"
                  />
                </div>
              )}

              {/* Tentatives d'appels et Notes */}
              <div className="grid grid-cols-1 gap-4 mt-2">
                <div className="flex items-center justify-between bg-[#EEE9DF]/30 p-3 rounded-xl border border-[#C9C1B1]/50">
                  <span className="text-xs font-bold text-[#1B2632]/70 uppercase">Tentatives d'appel</span>
                  <div className="flex items-center bg-white border border-[#C9C1B1] rounded-lg overflow-hidden">
                    <button type="button" onClick={() => setFormData({...formData, tentatives_appel: Math.max(0, formData.tentatives_appel - 1)})} className="px-2 py-1 bg-[#EEE9DF]/50 hover:bg-[#C9C1B1]/50">-</button>
                    <span className="px-3 text-sm font-bold">{formData.tentatives_appel}</span>
                    <button type="button" onClick={() => setFormData({...formData, tentatives_appel: formData.tentatives_appel + 1})} className="px-2 py-1 bg-[#EEE9DF]/50 hover:bg-[#C9C1B1]/50">+</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase mb-1">Notes datées</label>
                  <textarea 
                    rows="3"
                    placeholder="Ex: 03/08 15h00 - Client demande à voir le produit d'abord..."
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="w-full border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] resize-none"
                  />
                </div>
              </div>

            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-[#C9C1B1]/50">
              <button
                onClick={() => setCommandeSelectionnee(null)}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={validerAppel}
                disabled={envoiEnCours}
                className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md flex items-center justify-center gap-2"
              >
                {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
            
            <p className="text-[10px] text-center text-[#1B2632]/40 mt-3 font-medium uppercase tracking-wider">
              Passe automatiquement au lead suivant
            </p>
          </div>
        )}
      </div>
    </div>
  )
}