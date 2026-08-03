'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

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

    // 1. Charger la liste de tous les pays configurés en base
    const { data: paysList } = await supabase
      .from('pays')
      .select('id, nom, code, devise')

    let requeteBase = supabase.from('commandes').select('*', { count: 'exact', head: true })
    let requeteData = supabase.from('commandes').select('id, lead_id, date_commande, created_at, produit, quantite, statut_confirmation, client_nom, client_telephone, ville_zone, pays(id, nom, code, devise)')

    // 2. Appliquer les filtres d'onglets
    if (onglet === 'a_traiter') {
      requeteBase = requeteBase.is('statut_confirmation', null)
      requeteData = requeteData.is('statut_confirmation', null)
    } else {
      requeteBase = requeteBase.not('statut_confirmation', 'is', null)
      requeteData = requeteData.not('statut_confirmation', 'is', null)
    }

    // 3. Appliquer les filtres de date
    if (dateDebut) {
      requeteBase = requeteBase.gte('created_at', dateDebut)
      requeteData = requeteData.gte('created_at', dateDebut)
    }
    if (dateFin) {
      requeteBase = requeteBase.lte('created_at', `${dateFin}T23:59:59`)
      requeteData = requeteData.lte('created_at', `${dateFin}T23:59:59`)
    }

    // 4. Appliquer le tri et la pagination
    requeteData = requeteData
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(debut, fin)

    const { count } = await requeteBase
    const { data } = await requeteData

    // 5. Détection ultra-stricte et exacte par indicatif téléphonique (Regex avec ^)
    const commandesIntelligentes = (data || []).map(cmd => {
      let tel = cmd.client_telephone ? cmd.client_telephone.trim().replace(/\s+/g, '') : ''
      if (tel.startsWith('00')) {
        tel = '+' + tel.slice(2)
      }

      let paysNomParDefaut = null

      if (/^(\+?223)/.test(tel)) {
        paysNomParDefaut = 'Mali'
      } else if (/^(\+?221)/.test(tel)) {
        paysNomParDefaut = 'Sénégal'
      } else if (/^(\+?224)/.test(tel)) {
        paysNomParDefaut = 'Guinée'
      } else if (/^(\+?226)/.test(tel)) {
        paysNomParDefaut = 'Burkina Faso'
      } else if (/^(\+?241)/.test(tel)) {
        paysNomParDefaut = 'Gabon'
      } else if (/^(\+?242|\+?243)/.test(tel)) {
        paysNomParDefaut = 'Congo'
      } else if (/^(\+?237)/.test(tel)) {
        paysNomParDefaut = 'Cameroun'
      } else if (/^(\+?244)/.test(tel)) {
        paysNomParDefaut = 'Angola'
      }

      let paysTrouve = null
      if (paysNomParDefaut && paysList) {
        paysTrouve = paysList.find(p => p.nom.toLowerCase().includes(paysNomParDefaut.toLowerCase()))
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
          statut: statutChoisi
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    setCommandeSelectionnee(null)
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
      <div className="flex gap-6 items-start">
        
        {/* Colonne de gauche : Tableau */}
        <div className="flex-1 bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                  <th className="px-6 py-4">Lead ID</th>
                  <th className="px-6 py-4">Date</th>
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
                    return (
                      <tr key={cmd.id} className={`transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/20'}`}>
                        
                        {/* 1. Lead ID */}
                        <td className="px-6 py-4 font-mono text-sm text-[#1B2632]/80">
                          #{cmd.lead_id || 'N/A'}
                        </td>

                        {/* 2. Date */}
                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString('fr-FR') : (cmd.created_at ? new Date(cmd.created_at).toLocaleDateString('fr-FR') : '-')}
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

        {/* Colonne de droite : Panneau Latéral */}
        {commandeSelectionnee && (
          <div className="w-[360px] flex-shrink-0 bg-white border border-[#C9C1B1] rounded-2xl shadow-lg p-6 sticky top-6">
            <div className="flex justify-between items-start mb-6 border-b border-[#C9C1B1]/50 pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632]">
                  {ongletActif === 'a_traiter' ? 'Nouvel Appel' : 'Modifier l\'appel'}
                </h2>
                <div className="font-mono text-xl text-[#A35139] mt-2 font-semibold">
                  {commandeSelectionnee.client_telephone || 'Aucun numéro'}
                </div>
              </div>
              <button onClick={() => setCommandeSelectionnee(null)} className="text-[#1B2632]/40 hover:text-[#A35139] transition-colors">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-5">
              <div>
                <label className="block text-sm font-medium text-[#1B2632] mb-2">
                  Résultat de l'appel
                </label>
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] focus:ring-1 focus:ring-[#FFB162] bg-white transition-all shadow-sm"
                >
                  {STATUTS_APPEL.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {statutChoisi === 'confirmed' && (
                <div className="p-3 bg-[#2C3B4D]/5 rounded-lg border border-[#2C3B4D]/20 mt-2">
                  <p className="text-xs text-[#2C3B4D] font-medium text-center">
                    ✓ Cette commande passera directement chez le livreur.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setCommandeSelectionnee(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={validerAppel}
                disabled={envoiEnCours}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md"
              >
                {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}