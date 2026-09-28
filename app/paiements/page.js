'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' // 👈 Conservé pour tenantId et user
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte des permissions

const TAILLE_PAGE = 50

export default function PaiementsPage() {
  const { user, tenantId, loading: authLoading } = useAuth() // 👈 On garde l'auth de base
  const { hasPermission, loading: permsLoading } = usePermissions() // 🚀 Récupération des droits dynamiques
  const router = useRouter()

  const [paiements, setPaiements] = useState([])
  const [totalPaiements, setTotalPaiements] = useState(0)
  const [pagePaiements, setPagePaiements] = useState(0)
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

  const chargerPaiements = useCallback(async (page = 0) => {
    if (!tenantId) return

    // 🚀 On embarque la devise du pays de la commande (via pays_id) pour ne jamais afficher un montant nu.
    // `count: 'exact'` + `.range()` : le LIMIT/OFFSET est fait par la base, pas par le navigateur.
    const debut = page * TAILLE_PAGE
    const { data, error, count } = await supabase
      .from('paiements')
      .select('id, montant, statut, livreurs(nom), commandes(client_nom, pays(devise))', { count: 'exact' })
      .eq('tenant_id', tenantId) // 👈 Isolation multi-tenant stricte
      .eq('statut', 'en_attente')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(debut, debut + TAILLE_PAGE - 1)

    if (error) {
      alert('Erreur paiements: ' + error.message)
      setPaiements([])
      setTotalPaiements(0)
    } else {
      setPaiements(data || [])
      setTotalPaiements(count || 0)
    }
  }, [tenantId])

  const chargerCaisses = useCallback(async () => {
    if (!tenantId) return

    // 🚀 La somme est faite par la base (vue v_caisses_livreur), jamais ici :
    // un total d'argent calculé sur une liste tronquée serait faux en silence.
    // Une ligne par LIVREUR et par DEVISE — deux devises ne sont jamais additionnées.
    const { data, error } = await supabase
      .from('v_caisses_livreur')
      .select('livreur_id, livreur_nom, devise, total, nb_paiements')
      .eq('tenant_id', tenantId) // 👈 Isolation multi-tenant stricte
      .order('livreur_nom')

    if (error) {
      alert('Erreur caisses: ' + error.message)
      return
    }

    setCaissesParLivreur(
      (data || []).map((c) => ({
        id: c.livreur_id,
        nom: c.livreur_nom || 'Inconnu',
        devise: c.devise || 'N/A',
        total: Number(c.total),
        nb_paiements: c.nb_paiements,
      }))
    )
  }, [tenantId])

  const chargerTout = useCallback(async () => {
    setChargement(true)
    await Promise.all([chargerPaiements(pagePaiements), chargerCaisses()])
    setChargement(false)
  }, [chargerPaiements, chargerCaisses, pagePaiements])

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
  const peutVoirCashflow = hasPermission('voir_caisse')
  const peutEncaisser = hasPermission('declarer_encaissement') || hasPermission('valider_remise')
  const peutValiderRemise = hasPermission('valider_remise')

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-4 sm:pt-16 px-4 sm:px-6">
      
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
            Paiements à encaisser ({totalPaiements})
          </h2>

          {paiements.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-4">Aucun paiement en attente.</p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[560px] text-left border-collapse text-sm">
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
                        disabled={envoiEnCoursId === p.id || !peutEncaisser}
                        className="px-4 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
                      >
                        {envoiEnCoursId === p.id ? '...' : 'Marquer encaissé'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {totalPaiements > TAILLE_PAGE && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-[#C9C1B1]/40">
              <span className="text-sm text-[#1B2632]/70 font-medium">
                Page {pagePaiements + 1} sur {Math.max(1, Math.ceil(totalPaiements / TAILLE_PAGE))}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagePaiements((p) => Math.max(0, p - 1))}
                  disabled={pagePaiements === 0 || chargement}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPagePaiements((p) =>
                    Math.min(Math.ceil(totalPaiements / TAILLE_PAGE) - 1, p + 1))}
                  disabled={pagePaiements >= Math.ceil(totalPaiements / TAILLE_PAGE) - 1 || chargement}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
                >
                  Suivant
                </button>
              </div>
            </div>
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
              <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full min-w-[560px] text-left border-collapse text-sm">
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
                            disabled={envoiEnCoursId === cleBouton || !peutValiderRemise || c.devise === 'N/A'}
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
            </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}