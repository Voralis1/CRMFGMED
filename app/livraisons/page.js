'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' // 👈 Conservé pour le tenantId et user
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte des permissions

const STATUTS_LIVRAISON = [
  { value: 'livre', label: 'Livré' },
  { value: 'injoignable', label: 'Injoignable' },
  { value: 'retour', label: 'Retour' },
]

export default function LivraisonsPage() {
  const { user, tenantId, loading: authLoading } = useAuth() // 👈 On garde l'authentification de base
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions() // 🚀 Récupération des droits dynamiques
  const router = useRouter()

  const [livraisons, setLivraisons] = useState([])
  const [listeZones, setListeZones] = useState([])
  const [chargement, setChargement] = useState(true)
  const [ongletActif, setOngletActif] = useState('en_attente')
  
  const [nomLivreur, setNomLivreur] = useState('Chargement...')

  const [livraisonSelectionnee, setLivraisonSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('livre')
  const [motifTexte, setMotifTexte] = useState('')
  const [montant, setMontant] = useState('')
  const [fraisRetourSaisi, setFraisRetourSaisi] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  // 🚀 REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_livraisons')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  // Chargement des informations du livreur et des zones de l'entreprise
  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantId) return

    async function initialiserLivreurEtZones() {
      const { data: livreurData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (livreurData) {
        const nomBDD = livreurData.nom || livreurData.name || livreurData.full_name
        setNomLivreur(nomBDD || user.email)
      } else {
        setNomLivreur(user.email)
      }

      const { data: zonesData } = await supabase
        .from('zones')
        .select('id, nom_zone, frais_livraison, frais_retour')
        .eq('tenant_id', tenantId)
        .order('nom_zone')
        
      setListeZones(zonesData || [])
    }
    
    initialiserLivreurEtZones()
  }, [user, authLoading, permsLoading, tenantId])

  const chargerLivraisons = useCallback(async (onglet) => {
    if (!tenantId || permsLoading) return
    setChargement(true)

    // A livreur only sees the deliveries assigned to HIM (manager/admin see the whole tenant)
    let monLivreurId = null
    if ((roleNom || '').toLowerCase() === 'livreur') {
      const { data: moi } = await supabase
        .from('livreurs')
        .select('id')
        .eq('user_id', user?.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (!moi) {
        setLivraisons([])
        setChargement(false)
        return
      }
      monLivreurId = moi.id
    }

    let requete = supabase
      .from('livraisons')
      .select(`
        id, 
        statut, 
        created_at, 
        motif_retour,
        commandes(
          id, 
          lead_id,
          client_nom, 
          client_telephone, 
          produit, 
          ville_zone, 
          prix, 
          zone_id,
          tenant_id,
          zones(nom_zone, frais_livraison, frais_retour)
        )
      `)
       .eq('tenant_id', tenantId) // 👈 Isolation multi-tenant stricte

    if (monLivreurId) {
      requete = requete.eq('livreur_id', monLivreurId)
    }

    if (onglet === 'en_attente') {
      requete = requete.eq('statut', 'en_attente')
    } else {
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
  }, [tenantId, roleNom, permsLoading, user?.id])

  useEffect(() => {
    if (tenantId) {
      chargerLivraisons(ongletActif)
    }
  }, [ongletActif, tenantId, chargerLivraisons])

  function ouvrirFormulaire(liv) {
    setLivraisonSelectionnee(liv)
    setStatutChoisi('livre')
    setMotifTexte('')
    setMontant(liv.commandes?.prix !== null && liv.commandes?.prix !== undefined ? liv.commandes.prix : '')
    
    const zoneAssociee = liv.commandes?.zones || 
      listeZones.find(z => z.nom_zone.toLowerCase() === (liv.commandes?.ville_zone || '').toLowerCase())
    setFraisRetourSaisi(zoneAssociee?.frais_retour ?? 0)
  }

  async function envoyerConfirmation() {
    setEnvoiEnCours(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace('/')
      return
    }

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirmer-livraison`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          livraison_id: livraisonSelectionnee.id,
          statut: statutChoisi,
          motif_retour: statutChoisi === 'retour' ? motifTexte.trim() : null,
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

  const zoneAssociee = livraisonSelectionnee?.commandes?.zones || 
    listeZones.find(z => z.nom_zone.toLowerCase() === (livraisonSelectionnee?.commandes?.ville_zone || '').toLowerCase())

  // 🚀 Écran de chargement sécurisé
  if (authLoading || permsLoading || !hasPermission('menu_livraisons')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-16 px-6 pb-10">

      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .drawer-in { animation: drawerIn 0.25s ease-out; }
        .fade-in { animation: fadeIn 0.2s ease-out; }
      `}</style>

      {/* En-tête */}
      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1 flex items-center gap-2">
              Centre Logistique • {nomLivreur}
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Gestion des Livraisons</h1>
          </div>
        </div>

        <div className="flex justify-between items-center mt-2 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => { setOngletActif('en_attente'); setLivraisonSelectionnee(null); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
                  ongletActif === 'en_attente' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Livraisons à effectuer
              </button>
              <button
                onClick={() => { setOngletActif('historique'); setLivraisonSelectionnee(null); }}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
                  ongletActif === 'historique' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Historique
              </button>
            </div>

            <div className="h-6 w-px bg-[#C9C1B1]/50"></div>

            <div className="text-sm text-[#1B2632]/60 font-medium">
              {livraisons.length} livraison{livraisons.length > 1 ? 's' : ''} trouvée{livraisons.length > 1 ? 's' : ''} dans cette vue
            </div>
          </div>
        </div>
      </header>

      {/* Tableau principal */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto min-h-[400px] max-h-[calc(100vh-280px)]">
          <table className="w-full min-w-[1200px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-6 py-4">Lead ID</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Ville / Zone</th>
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Prix</th>
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : livraisons.length === 0 ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">Aucune livraison dans cet onglet.</td></tr>
              ) : (
                livraisons.map((liv) => {
                  const estSelectionne = livraisonSelectionnee?.id === liv.id
                  const dateFormatee = liv.created_at ? new Date(liv.created_at).toLocaleDateString('fr-FR') : '-'
                  return (
                    <tr
                      key={liv.id}
                      onClick={() => ongletActif === 'en_attente' && ouvrirFormulaire(liv)}
                      className={`cursor-pointer transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/40'}`}
                    >
                      <td className="px-6 py-4 font-mono text-xs text-[#1B2632] max-w-[130px] break-words leading-tight">
                        {liv.commandes?.lead_id ? `#${liv.commandes.lead_id}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-[#1B2632]/70 whitespace-nowrap">
                        {dateFormatee}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-[#1B2632]">{liv.commandes?.client_nom || 'Client inconnu'}</span>
                          <span className="font-mono text-xs text-[#A35139]">{liv.commandes?.client_telephone || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-[#1B2632] whitespace-nowrap">{liv.commandes?.ville_zone || '-'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-[#1B2632]">{liv.commandes?.produit || '-'}</td>
                      <td className="px-6 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                        {liv.commandes?.prix !== null && liv.commandes?.prix !== undefined ? liv.commandes.prix : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase w-fit ${
                            liv.statut === 'en_attente' ? 'bg-[#FFB162]/20 text-[#8a5a1f]' :
                            liv.statut === 'livre' ? 'bg-[#2C3B4D]/10 text-[#2C3B4D]' : 'bg-[#A35139]/10 text-[#A35139]'
                          }`}>
                            {liv.statut}
                          </span>
                          {liv.statut === 'retour' && liv.motif_retour && (
                            <span className="text-xs text-[#A35139] font-medium">
                              Motif : {liv.motif_retour}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {ongletActif === 'en_attente' ? (
                          <button className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${estSelectionne ? 'bg-[#1B2632] text-white' : 'bg-[#EEE9DF] text-[#1B2632] border border-[#C9C1B1] hover:bg-[#C9C1B1]'}`}>
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

      {/* Panneau latéral (Drawer) */}
      {livraisonSelectionnee && ongletActif === 'en_attente' && (
        <>
          <div
            className="fixed inset-0 bg-[#1B2632]/30 backdrop-blur-[2px] z-40 fade-in"
            onClick={() => setLivraisonSelectionnee(null)}
          />

          <div className="fixed top-0 right-0 h-screen w-[420px] max-w-full bg-white z-50 shadow-2xl border-l border-[#C9C1B1] flex flex-col drawer-in">

            <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632] mb-1">Traiter la livraison</h2>
                <div className="font-mono text-xs text-[#A35139]">
                  {livraisonSelectionnee.commandes?.client_telephone || 'Aucun numéro'}
                </div>
              </div>
              <button onClick={() => setLivraisonSelectionnee(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center cursor-pointer">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">

              <div className="p-4 bg-[#EEE9DF]/30 rounded-xl border border-[#C9C1B1]/50 flex flex-col gap-3">
                <p className="text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-0">Détails de la commande</p>
                <p className="text-xs text-[#1B2632]/70">Lead ID : <span className="font-mono font-bold text-[#1B2632]">{livraisonSelectionnee.commandes?.lead_id ? `#${livraisonSelectionnee.commandes.lead_id}` : '-'}</span></p>
                <p className="text-xs text-[#1B2632]/70">Client : <span className="font-bold text-[#1B2632]">{livraisonSelectionnee.commandes?.client_nom}</span></p>
                <p className="text-xs text-[#1B2632]/70">Produit : <span className="font-bold text-[#1B2632]">{livraisonSelectionnee.commandes?.produit}</span></p>
                <p className="text-xs text-[#1B2632]/70">Prix prévu : <span className="font-mono font-bold text-[#1B2632]">{livraisonSelectionnee.commandes?.prix ?? '-'}</span></p>

                <div className="mt-2 pt-3 border-t border-[#C9C1B1]/40 flex flex-col gap-2">
                  <p className="text-[11px] font-bold text-[#1B2632]/70 uppercase">Informations Tarifaires</p>
                  
                  {zoneAssociee ? (
                    <div className="p-3 bg-white border border-[#C9C1B1]/60 rounded-xl text-xs text-[#1B2632] flex flex-col gap-1.5 shadow-sm">
                      <div className="flex justify-between">
                        <span className="text-[#1B2632]/60">Zone :</span>
                        <span className="font-bold text-[#1B2632]">{zoneAssociee.nom_zone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#1B2632]/60">Frais de livraison :</span>
                        <span className="font-bold font-mono text-[#A35139]">{zoneAssociee.frais_livraison}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#1B2632]/60">Frais de retour de base :</span>
                        <span className="font-bold font-mono text-[#1B2632]">{zoneAssociee.frais_retour ?? 0}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">
                      Aucune zone tarifaire trouvée pour la ville : {livraisonSelectionnee.commandes?.ville_zone || 'Non spécifiée'}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Statut de livraison</label>
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent cursor-pointer"
                >
                  {STATUTS_LIVRAISON.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {statutChoisi === 'retour' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Motif du retour (Texte)</label>
                    <input
                      type="text"
                      value={motifTexte}
                      onChange={(e) => setMotifTexte(e.target.value)}
                      placeholder="Ex : Client absent, Ne répond pas..."
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Frais de retour (Modifiable)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={fraisRetourSaisi}
                      onChange={(e) => setFraisRetourSaisi(e.target.value)}
                      placeholder="0"
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                  </div>
                </>
              )}

              {statutChoisi === 'livre' && (
                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Montant à encaisser</label>
                  <input
                    type="number"
                    step="0.01"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    placeholder="0"
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>
              )}

            </div>

            <div className="px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              {hasPermission('gerer_livraison') ? (
                <button
                  onClick={envoyerConfirmation}
                  disabled={envoiEnCours}
                  className="w-full py-3.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md"
                >
                  {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              ) : (
                <p className="text-center text-xs text-[#1B2632]/50 py-3">Lecture seule : vous n'avez pas le droit de modifier une livraison.</p>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  )
}