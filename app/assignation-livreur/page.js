'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

const TAILLE_PAGE = 50

export default function AssignationLivreurPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const [commandes, setCommandes] = useState([])
  const [livreurs, setLivreurs] = useState([])
  const [totalCommandes, setTotalCommandes] = useState(0)
  const [pageActuelle, setPageActuelle] = useState(0)
  const [chargement, setChargement] = useState(true)
  const [livreurChoisiParCommande, setLivreurChoisiParCommande] = useState({})
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null)

  // 🚀 REDIRECTION SÉCURISÉE (RBAC)
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_assignation_livreur')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  async function chargerLivreurs() {
    if (!tenantId) return

    const { data, error } = await supabase
      .from('livreurs')
      .select('id, nom, zone')
      .eq('tenant_id', tenantId)
      .eq('actif', true)
      .order('nom')

    if (!error) setLivreurs(data || [])
  }

  async function chargerCommandes(page) {
    if (!tenantId) return
    setChargement(true)

    const debut = page * TAILLE_PAGE
    const fin = debut + TAILLE_PAGE - 1

    const { data: idsAvecLivraison } = await supabase
      .from('livraisons')
      .select('commande_id')
      .eq('tenant_id', tenantId)

    const idsExclus = (idsAvecLivraison || []).map((l) => l.commande_id)

    let requete = supabase
      .from('commandes')
      .select('*, prix, zone_id, pays(nom)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('statut_confirmation', 'confirmed')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(debut, fin)

    if (idsExclus.length > 0) {
      requete = requete.not('id', 'in', `(${idsExclus.join(',')})`)
    }

    const { data, error, count } = await requete

    if (error) {
      alert('Erreur: ' + error.message)
    } else {
      setCommandes(data || [])
      setTotalCommandes(count || 0)
    }
    setChargement(false)
  }

  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantId) return

    async function initialiser() {
      await chargerLivreurs()
      await chargerCommandes(pageActuelle)
    }
    initialiser()
  }, [user, authLoading, permsLoading, tenantId, pageActuelle])

  function choisirLivreur(commandeId, livreurId) {
    setLivreurChoisiParCommande((prec) => ({ ...prec, [commandeId]: livreurId }))
  }

  async function assigner(commandeId) {
    const livreurId = livreurChoisiParCommande[commandeId]
    if (!livreurId) {
      alert('Choisis un livreur avant d\'assigner')
      return
    }

    setEnvoiEnCoursId(commandeId)

    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/assigner-livreur',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          commande_id: commandeId, 
          livreur_id: livreurId,
          tenant_id: tenantId // 🚀 CORRECTION : Le tenant_id est maintenant envoyé à l'Edge Function !
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCoursId(null)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    await chargerCommandes(pageActuelle)
  }

  const totalPages = Math.max(1, Math.ceil(totalCommandes / TAILLE_PAGE))

  if (authLoading || permsLoading || !hasPermission('menu_assignation_livreur')) {
    return <div className="p-8 text-[#1B2632] font-medium">Vérification des accès...</div>
  }

  if (chargement && commandes.length === 0) {
    return <div className="p-8 text-[#1B2632] font-medium">Chargement des commandes...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
      
      <header className="flex flex-col gap-1 border-b border-[#C9C1B1]/50 pb-4">
        <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
          Centre Logistique
        </p>
        <h1 className="text-3xl font-bold text-[#1B2632]">
          Assignation livreur 
        </h1>
      </header>

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {chargement ? (
          <p className="text-sm text-[#1B2632]/60 p-6">Chargement...</p>
        ) : commandes.length === 0 ? (
          <p className="text-sm text-[#1B2632]/60 p-6">Aucune commande confirmée en attente d'assignation.</p>
        ) : (
          <>
            <div className="overflow-x-auto min-h-[400px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-6 py-4">Lead ID</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Client</th>
                    <th className="px-6 py-4">Pays</th>
                    <th className="px-6 py-4">Ville / Zone</th>
                    <th className="px-6 py-4">Produit</th>
                    <th className="px-6 py-4">Prix</th>
                    <th className="px-6 py-4">Livreur</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {commandes.map((cmd) => {
                    const livreursFiltres = livreurs.filter((l) => {
                      if (!l.zone || l.zone.trim() === '') return true;
                      if (!cmd.ville_zone) return false;
                      return cmd.ville_zone.toLowerCase().includes(l.zone.toLowerCase());
                    });

                    return (
                      <tr key={cmd.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                        
                        <td className="px-6 py-4 font-mono text-sm text-[#1B2632]/80">
                          #{cmd.lead_id || 'N/A'}
                        </td>

                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString('fr-FR') : (cmd.created_at ? new Date(cmd.created_at).toLocaleDateString('fr-FR') : '-')}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-bold text-[#1B2632]">
                            {cmd.client_nom || 'Client inconnu'}
                          </div>
                          <div className="font-mono text-xs text-[#A35139] font-semibold mt-1">
                            {cmd.client_telephone || 'Aucun numéro'}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]">
                          {cmd.pays?.nom || '-'}
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.ville_zone || '-'}</div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.produit || '-'}</div>
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">Qté: {cmd.quantite || 1}</div>
                        </td>

                        <td className="px-6 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                          {cmd.prix !== null && cmd.prix !== undefined ? cmd.prix : '-'}
                        </td>

                        <td className="px-6 py-4">
                          <select
                            value={livreurChoisiParCommande[cmd.id] || ''}
                            onChange={(e) => choisirLivreur(cmd.id, e.target.value)}
                            className="border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] min-w-[180px] shadow-sm cursor-pointer"
                          >
                            <option value="">-- choisir --</option>
                            {livreursFiltres.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nom} {!l.zone ? '(Volant)' : ''}
                              </option>
                            ))}
                          </select>
                          {livreursFiltres.length === 0 && (
                            <span className="text-[11px] font-semibold text-[#A35139] block mt-1.5">Aucun livreur pour cette zone</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => assigner(cmd.id)}
                            disabled={envoiEnCoursId === cmd.id || livreursFiltres.length === 0}
                            className="px-4 py-2 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {envoiEnCoursId === cmd.id ? '...' : 'Assigner'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[#C9C1B1]/40 bg-[#EEE9DF]/20">
              <span className="text-sm text-[#1B2632]/70 font-medium">
                Page {pageActuelle + 1} sur {totalPages}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPageActuelle((p) => Math.max(0, p - 1))}
                  disabled={pageActuelle === 0}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPageActuelle((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={pageActuelle >= totalPages - 1}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  Suivant
                </button>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}