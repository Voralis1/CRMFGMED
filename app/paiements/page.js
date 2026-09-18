'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' // 👈 Conservé pour tenantId et user
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte des permissions

export default function PaiementsPage() {
  const { user, tenantId, loading: authLoading } = useAuth() // 👈 On garde l'auth de base
  const { hasPermission, loading: permsLoading } = usePermissions() // 🚀 Récupération des droits dynamiques
  const router = useRouter()

  const [paiements, setPaiements] = useState([])
  const [caissesParLivreur, setCaissesParLivreur] = useState([])
  const [chargement, setChargement] = useState(true)
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null)
  const [nomUtilisateur, setNomUtilisateur] = useState('Chargement...')

  // 🚀 REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_paiements')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const chargerPaiements = useCallback(async () => {
    if (!tenantId) return

    // 🚀 On embarque la devise du pays de la commande (via pays_id) pour ne jamais afficher un montant nu
    const { data, error } = await supabase
      .from('paiements')
      .select('id, montant, statut, livreurs(nom), commandes(client_nom, pays(devise))')
      .eq('tenant_id', tenantId) // 👈 Isolation multi-tenant stricte
      .eq('statut', 'en_attente')
      .order('created_at', { ascending: false })

    if (error) {
      alert('Erreur paiements: ' + error.message)
    } else {
      setPaiements(data || [])
    }
  }, [tenantId])

  const chargerCaisses = useCallback(async () => {
    if (!tenantId) return

    // 🚀 On embarque la devise pour pouvoir regrouper séparément par devise
    const { data, error } = await supabase
      .from('paiements')
      .select('montant, livreurs(id, nom), commandes(pays(devise))')
      .eq('tenant_id', tenantId) // 👈 Isolation multi-tenant stricte
      .eq('statut', 'encaisse')

    if (error) {
      alert('Erreur caisses: ' + error.message)
      return
    }

    // 🚀 Regroupement par LIVREUR + DEVISE — on ne mélange jamais deux devises
    // dans un même total (ex: un livreur qui aurait des paiements en AOA et en MAD
    // doit voir deux lignes séparées, pas un total combiné sans signification).
    const regroupement = {}
    for (const p of (data || [])) {
      const nomLivreur = p.livreurs?.nom || 'Inconnu'
      const idLivreur = p.livreurs?.id
      const devise = p.commandes?.pays?.devise || 'N/A'
      const cle = `${idLivreur}__${devise}`

      if (!regroupement[cle]) {
        regroupement[cle] = { id: idLivreur, nom: nomLivreur, devise, total: 0 }
      }
      regroupement[cle].total += Number(p.montant)
    }
    setCaissesParLivreur(Object.values(regroupement))
  }, [tenantId])

  const chargerTout = useCallback(async () => {
    setChargement(true)
    await Promise.all([chargerPaiements(), chargerCaisses()])
    setChargement(false)
  }, [chargerPaiements, chargerCaisses])

  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantId) return

    async function initialiserUtilisateur() {
      const { data: userData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (userData) {
        const nomBDD = userData.nom || userData.name || userData.full_name
        setNomUtilisateur(nomBDD || user.email)
      } else {
        setNomUtilisateur(user.email)
      }

      await chargerTout()
    }
    
    initialiserUtilisateur()
  }, [user, authLoading, permsLoading, tenantId, chargerTout])

  async function encaisser(paiementId) {
    setEnvoiEnCoursId(paiementId)
    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/encaisser-paiement`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ paiement_id: paiementId }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCoursId(null)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    await chargerTout()
  }

  // 🚀 On passe désormais la devise, pour que la remise de caisse ne remette
  // que les paiements de CETTE devise pour CE livreur (pas tout mélangé).
  async function remettreEnCaisse(livreurId, devise) {
    const cleBouton = `${livreurId}__${devise}`
    setEnvoiEnCoursId(cleBouton)
    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/remettre-caisse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ livreur_id: livreurId, devise }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCoursId(null)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    alert(`Remise validée : ${resultat.total_remis} ${devise} encaissés pour ${resultat.nombre_paiements} paiement(s)`)
    await chargerTout()
  }

  // 🚀 Écran de chargement et de vérification sécurisée
  if (authLoading || permsLoading || !hasPermission('menu_paiements')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  // 🚀 Vérification dynamique des droits financiers (remplace l'ancienne variable role)
  const peutVoirCashflow = hasPermission('gerer_utilisateurs') || hasPermission('voir_cashflow')

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-16 px-6">
      
      {/* En-tête de la page */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Centre Financier • {nomUtilisateur}
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">Gestion des Paiements</h1>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-8">
        
        {/* Section 1 : Paiements à encaisser */}
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
          <h2 className="text-lg font-bold text-[#1B2632] mb-4">
            Paiements à encaisser ({paiements.length})
          </h2>

          {paiements.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-4">Aucun paiement en attente.</p>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-3">Client</th>
                  <th className="p-3">Livreur</th>
                  <th className="p-3">Montant</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {paiements.map((p) => (
                  <tr key={p.id} className="hover:bg-[#EEE9DF]/20 transition">
                    <td className="p-3 font-medium text-[#1B2632]">{p.commandes?.client_nom || 'Client inconnu'}</td>
                    <td className="p-3 text-[#1B2632]/70">{p.livreurs?.nom || 'Inconnu'}</td>
                    <td className="p-3 font-bold text-[#1B2632]">{p.montant} {p.commandes?.pays?.devise || ''}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => encaisser(p.id)}
                        disabled={envoiEnCoursId === p.id}
                        className="px-4 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
                      >
                        {envoiEnCoursId === p.id ? '...' : 'Marquer encaissé'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 2 : Caisse par livreur (Affichée UNIQUEMENT pour les profils ayant les droits financiers) */}
        {peutVoirCashflow && (
          <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
            <h2 className="text-lg font-bold text-[#1B2632] mb-4">
              Caisse par livreur (à remettre)
            </h2>
            <p className="text-xs text-[#1B2632]/50 -mt-2 mb-4">
              Un livreur peut apparaître sur plusieurs lignes s'il détient du cash dans plusieurs devises.
            </p>

            {caissesParLivreur.length === 0 ? (
              <p className="text-sm text-[#1B2632]/60 py-4">Aucun montant en attente de remise.</p>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                    <th className="p-3">Livreur</th>
                    <th className="p-3">Devise</th>
                    <th className="p-3">Total encaissé</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {caissesParLivreur.map((c) => {
                    const cleBouton = `${c.id}__${c.devise}`
                    return (
                      <tr key={cleBouton} className="hover:bg-[#EEE9DF]/20 transition">
                        <td className="p-3 font-medium text-[#1B2632]">{c.nom}</td>
                        <td className="p-3"><span className="fg-badge dark">{c.devise}</span></td>
                        <td className="p-3 font-bold text-[#1B2632]">{c.total} {c.devise}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => remettreEnCaisse(c.id, c.devise)}
                            disabled={envoiEnCoursId === cleBouton}
                            className="px-4 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
                          >
                            {envoiEnCoursId === cleBouton ? '...' : 'Confirmer remise'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  )
}