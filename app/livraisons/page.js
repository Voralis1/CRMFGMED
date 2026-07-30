'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

const STATUTS_LIVRAISON = [
  { value: 'livre', label: 'Livré' },
  { value: 'injoignable', label: 'Injoignable' },
  { value: 'retour', label: 'Retour' },
]

export default function LivraisonsPage() {
  const [livraisons, setLivraisons] = useState([])
  const [motifsRetour, setMotifsRetour] = useState([])
  const [chargement, setChargement] = useState(true)
  const [ongletActif, setOngletActif] = useState('en_attente') // 'en_attente' ou 'historique'
  
  // Profil livreur
  const [nomLivreur, setNomLivreur] = useState('Chargement...')

  const [livraisonSelectionnee, setLivraisonSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('livre')
  const [motifChoisi, setMotifChoisi] = useState('')
  const [montant, setMontant] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const router = useRouter()

  // 1. Initialisation de la session et du profil livreur
  useEffect(() => {
    async function initialiser() {
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

      if (roleData?.role === 'agent') {
        router.push('/centre-appel')
        return
      }

      const { data: livreurData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (livreurData) {
        const nomBDD = livreurData.nom || livreurData.name || livreurData.full_name
        setNomLivreur(nomBDD || session.user.email)
      } else {
        setNomLivreur(session.user.email)
      }

      await chargerMotifsRetour()
    }
    initialiser()
  }, [router])

  // 2. Charger les livraisons depuis la table 'livraisons' en joignant 'commandes'
  const chargerLivraisons = useCallback(async (onglet) => {
    setChargement(true)

    let requete = supabase
      .from('livraisons')
      .select('id, statut, created_at, commandes(id, client_nom, client_telephone, produit, ville_zone)')

    if (onglet === 'en_attente') {
      // Uniquement les livraisons en cours / en attente à effectuer
      requete = requete.eq('statut', 'en_attente')
    } else {
      // Uniquement les livraisons terminées pour l'historique
      requete = requete.in('statut', ['livre', 'injoignable', 'retour'])
    }

    const { data, error } = await requete.order('created_at', { ascending: false })

    if (error) {
      alert('Erreur: ' + error.message)
      setLivraisons([])
    } else {
      setLivraisons(data || [])
    }
    setChargement(false)
  }, [])

  useEffect(() => {
    chargerLivraisons(ongletActif)
  }, [ongletActif, chargerLivraisons])

  async function chargerMotifsRetour() {
    const { data } = await supabase.from('motifs_retour').select('id, libelle')
    setMotifsRetour(data || [])
  }

  function ouvrirFormulaire(liv) {
    setLivraisonSelectionnee(liv)
    setStatutChoisi('livre')
    setMotifChoisi('')
    setMontant('')
  }

  // 3. Appel de l'Edge Function 'confirmer-livraison'
  async function envoyerConfirmation() {
    setEnvoiEnCours(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/')
      return
    }

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/confirmer-livraison',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          livraison_id: livraisonSelectionnee.id,
          statut: statutChoisi,
          motif_retour_id: statutChoisi === 'retour' ? motifChoisi : null,
          montant_a_encaisser: statutChoisi === 'livre' ? Number(montant) || 0 : 0,
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    setLivraisonSelectionnee(null)
    await chargerLivraisons(ongletActif)
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
      
      {/* En-tête */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Centre Logistique
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Gestion des Livraisons</h1>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-4">
            <button
              onClick={() => { setOngletActif('en_attente'); setLivraisonSelectionnee(null); }}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
                ongletActif === 'en_attente'
                  ? 'bg-[#1B2632] text-white shadow-md'
                  : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              Livraisons à effectuer
            </button>
            <button
              onClick={() => { setOngletActif('historique'); setLivraisonSelectionnee(null); }}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
                ongletActif === 'historique'
                  ? 'bg-[#1B2632] text-white shadow-md'
                  : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              Historique
            </button>
          </div>
          <div className="text-sm text-[#1B2632]/60 font-medium">
            {livraisons.length} livraison{livraisons.length > 1 ? 's' : ''} trouvée{livraisons.length > 1 ? 's' : ''}
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <div className="flex gap-6 items-start">
        
        {/* Tableau */}
        <div className="flex-1 bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                  <th className="px-6 py-4">Client</th>
                  <th className="px-6 py-4">Téléphone</th>
                  <th className="px-6 py-4">Ville / Zone</th>
                  <th className="px-6 py-4">Produit</th>
                  <th className="px-6 py-4">Statut</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {chargement ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td>
                  </tr>
                ) : livraisons.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-[#1B2632]/60">Aucune livraison dans cet onglet.</td>
                  </tr>
                ) : (
                  livraisons.map((liv) => {
                    const estSelectionne = livraisonSelectionnee?.id === liv.id
                    return (
                      <tr key={liv.id} className={`transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/20'}`}>
                        <td className="px-6 py-4 font-medium text-[#1B2632]">{liv.commandes?.client_nom || 'Client inconnu'}</td>
                        <td className="px-6 py-4 font-mono text-xs text-[#1B2632]/60">{liv.commandes?.client_telephone || '-'}</td>
                        <td className="px-6 py-4 text-[#1B2632]/70">{liv.commandes?.ville_zone || '-'}</td>
                        <td className="px-6 py-4 text-[#1B2632]/70">{liv.commandes?.produit || '-'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                            liv.statut === 'en_attente' ? 'bg-amber-100 text-amber-800' :
                            liv.statut === 'livre' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {liv.statut}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {ongletActif === 'en_attente' ? (
                            <button
                              onClick={() => ouvrirFormulaire(liv)}
                              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                                estSelectionne ? 'bg-[#1B2632] text-white' : 'bg-[#EEE9DF] text-[#1B2632] hover:bg-[#C9C1B1]'
                              }`}
                            >
                              Traiter
                            </button>
                          ) : (
                            <span className="text-xs text-[#1B2632]/60 font-semibold uppercase">{liv.statut}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panneau latéral */}
        {livraisonSelectionnee && ongletActif === 'en_attente' && (
          <div className="w-[360px] flex-shrink-0 bg-white border border-[#C9C1B1] rounded-2xl shadow-lg p-6 sticky top-6">
            <div className="flex justify-between items-start mb-6 border-b border-[#C9C1B1]/50 pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632]">Traiter la livraison</h2>
                <div className="font-mono text-xl text-[#A35139] mt-2 font-semibold">
                  {livraisonSelectionnee.commandes?.client_telephone || 'Aucun numéro'}
                </div>
              </div>
              <button onClick={() => setLivraisonSelectionnee(null)} className="text-[#1B2632]/40 hover:text-[#A35139] cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col gap-5">
              <div className="bg-[#EEE9DF]/30 p-3 rounded-lg border border-[#C9C1B1]/30 text-sm">
                <p className="text-xs text-[#1B2632]/60 mb-1">Client : <span className="font-semibold text-[#1B2632]">{livraisonSelectionnee.commandes?.client_nom}</span></p>
                <p className="text-xs text-[#1B2632]/60">Produit : <span className="font-semibold text-[#1B2632]">{livraisonSelectionnee.commandes?.produit}</span></p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1B2632] mb-2">Statut de livraison</label>
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
                >
                  {STATUTS_LIVRAISON.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {statutChoisi === 'retour' && (
                <div>
                  <label className="block text-sm font-medium text-[#1B2632] mb-2">Motif du retour</label>
                  <select
                    value={motifChoisi}
                    onChange={(e) => setMotifChoisi(e.target.value)}
                    className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
                  >
                    <option value="">-- Choisir un motif --</option>
                    {motifsRetour.map((m) => (
                      <option key={m.id} value={m.id}>{m.libelle}</option>
                    ))}
                  </select>
                </div>
              )}

              {statutChoisi === 'livre' && (
                <div>
                  <label className="block text-sm font-medium text-[#1B2632] mb-2">Montant à encaisser</label>
                  <input
                    type="number"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    placeholder="0"
                    className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] outline-none focus:border-[#FFB162]"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setLivraisonSelectionnee(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF]/50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={envoyerConfirmation}
                disabled={envoiEnCours}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 cursor-pointer"
              >
                {envoiEnCours ? 'Envoi...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  )
}