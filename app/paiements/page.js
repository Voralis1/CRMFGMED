'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

export default function PaiementsPage() {
  const [paiements, setPaiements] = useState([])
  const [caissesParLivreur, setCaissesParLivreur] = useState([])
  const [chargement, setChargement] = useState(true)
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null)
  const [nomUtilisateur, setNomUtilisateur] = useState('Chargement...')
  const [roleUtilisateur, setRoleUtilisateur] = useState('')
  const router = useRouter()

  async function chargerPaiements() {
    const { data, error } = await supabase
      .from('paiements')
      .select('id, montant, statut, livreurs(nom), commandes(client_nom)')
      .eq('statut', 'en_attente')
      .order('created_at', { ascending: false })

    if (error) {
      alert('Erreur paiements: ' + error.message)
    } else {
      setPaiements(data || [])
    }
  }

  async function chargerCaisses() {
    const { data, error } = await supabase
      .from('paiements')
      .select('montant, livreurs(id, nom)')
      .eq('statut', 'encaisse')

    if (error) {
      alert('Erreur caisses: ' + error.message)
      return
    }

    const regroupement = {}
    for (const p of (data || [])) {
      const nomLivreur = p.livreurs?.nom || 'Inconnu'
      const idLivreur = p.livreurs?.id
      if (!regroupement[idLivreur]) {
        regroupement[idLivreur] = { id: idLivreur, nom: nomLivreur, total: 0 }
      }
      regroupement[idLivreur].total += Number(p.montant)
    }
    setCaissesParLivreur(Object.values(regroupement))
  }

  async function chargerTout() {
    setChargement(true)
    await chargerPaiements()
    await chargerCaisses()
    setChargement(false)
  }

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

      setRoleUtilisateur(roleData?.role || '')

      const { data: userData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (userData) {
        const nomBDD = userData.nom || userData.name || userData.full_name
        setNomUtilisateur(nomBDD || session.user.email)
      } else {
        setNomUtilisateur(session.user.email)
      }

      await chargerTout()
    }
    initialiser()
  }, [router])

  async function encaisser(paiementId) {
    setEnvoiEnCoursId(paiementId)
    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/encaisser-paiement',
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

  async function remettreEnCaisse(livreurId) {
    setEnvoiEnCoursId(livreurId)
    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/remettre-caisse',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ livreur_id: livreurId }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCoursId(null)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    alert(`Remise validée : ${resultat.total_remis} encaissés pour ${resultat.nombre_paiements} paiement(s)`)
    await chargerTout()
  }

  if (chargement) {
    return <div className="p-8 text-gray-600 font-medium">Chargement des paiements...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
      
      {/* En-tête de la page */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Centre Financier
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
                    <td className="p-3 font-bold text-[#1B2632]">{p.montant}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => encaisser(p.id)}
                        disabled={envoiEnCoursId === p.id}
                        className="px-4 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50"
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

        {/* Section 2 : Caisse par livreur (Affichée UNIQUEMENT pour l'admin) */}
        {roleUtilisateur === 'admin' && (
          <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
            <h2 className="text-lg font-bold text-[#1B2632] mb-4">
              Caisse par livreur (à remettre)
            </h2>

            {caissesParLivreur.length === 0 ? (
              <p className="text-sm text-[#1B2632]/60 py-4">Aucun montant en attente de remise.</p>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                    <th className="p-3">Livreur</th>
                    <th className="p-3">Total encaissé</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {caissesParLivreur.map((c) => (
                    <tr key={c.id} className="hover:bg-[#EEE9DF]/20 transition">
                      <td className="p-3 font-medium text-[#1B2632]">{c.nom}</td>
                      <td className="p-3 font-bold text-[#1B2632]">{c.total}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => remettreEnCaisse(c.id)}
                          disabled={envoiEnCoursId === c.id}
                          className="px-4 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold shadow-sm transition disabled:opacity-50"
                        >
                          {envoiEnCoursId === c.id ? '...' : 'Confirmer remise'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>

    </div>
  )
}