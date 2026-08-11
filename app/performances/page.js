'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' // 👈 Conservé pour le tenantId et user
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte des permissions

export default function PerformancesPage() {
  const { user, tenantId, loading: authLoading } = useAuth() // 👈 On garde l'auth de base
  const { hasPermission, loading: permsLoading } = usePermissions() // 🚀 Récupération des droits dynamiques
  const router = useRouter()

  const [ongletActif, setOngletActif] = useState('agents')
  const [chargement, setChargement] = useState(true)
  
  const [statsAgents, setStatsAgents] = useState([])
  const [statsLivreurs, setStatsLivreurs] = useState([])

  // 🚀 REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_performances')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const chargerPerformances = useCallback(async () => {
    if (!tenantId) return
    setChargement(true)

    const [resAgents, resAppels, resLivreurs, resLivraisons] = await Promise.all([
      supabase.from('agents').select('id, nom, actif').eq('tenant_id', tenantId), // 👈 Isolation multi-tenant
      supabase.from('appels').select('agent_id, statut').eq('tenant_id', tenantId).eq('statut', 'confirmed'), // 👈 Isolation multi-tenant
      supabase.from('livreurs').select('id, nom, telephone, zone, actif').eq('tenant_id', tenantId), // 👈 Isolation multi-tenant
      supabase.from('livraisons').select('livreur_id, statut').eq('tenant_id', tenantId).in('statut', ['livre', 'livrée']) // 👈 Isolation multi-tenant
    ])

    const agents = resAgents.data || []
    const appels = resAppels.data || []
    const livreurs = resLivreurs.data || []
    const livraisons = resLivraisons.data || []

    const agentsMap = agents.map(agent => {
      const confirmations = appels.filter(a => String(a.agent_id) === String(agent.id)).length
      return { ...agent, confirmations }
    }).sort((a, b) => b.confirmations - a.confirmations)

    const livreursMap = livreurs.map(livreur => {
      const colisLivres = livraisons.filter(l => String(l.livreur_id) === String(livreur.id)).length
      return { ...livreur, colisLivres }
    }).sort((a, b) => b.colisLivres - a.colisLivres)

    setStatsAgents(agentsMap)
    setStatsLivreurs(livreursMap)
    setChargement(false)
  }, [tenantId])

  useEffect(() => {
    if (tenantId) {
      chargerPerformances()
    }
  }, [tenantId, chargerPerformances])

  // 🚀 Écran de chargement et de vérification sécurisée
  if (authLoading || permsLoading || !hasPermission('menu_performances')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-16 px-6">
      
      {/* En-tête et Onglets */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Administration
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">
            Suivi des performances
          </h1>
        </div>

        <div className="flex gap-4 mt-2">
          <button 
            onClick={() => setOngletActif('agents')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'agents' 
                ? 'bg-[#1B2632] text-white shadow-md' 
                : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            Centre d'appel (Agents)
          </button>
          <button 
            onClick={() => setOngletActif('livreurs')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'livreurs' 
                ? 'bg-[#1B2632] text-white shadow-md' 
                : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            Centre logistique (Livreurs)
          </button>
        </div>
      </header>

      {chargement ? (
        <p className="text-[#1B2632]/60 py-6">Calcul des statistiques en cours...</p>
      ) : ongletActif === 'agents' ? (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
            <h2 className="text-lg font-bold text-[#1B2632]">Centre d'appel (Agents)</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">Classement par nombre de confirmations</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">Nom de l'agent</th>
                  <th className="p-4 text-center">Statut</th>
                  <th className="p-4 text-right">Confirmations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {statsAgents.map((agent, index) => (
                  <tr key={agent.id} className="hover:bg-[#EEE9DF]/20 transition">
                    <td className="p-4 font-medium text-[#1B2632] flex items-center gap-3">
                      <span className="w-6 h-6 rounded bg-[#1B2632] text-white flex items-center justify-center text-xs font-bold">
                        {index + 1}
                      </span>
                      {agent.nom}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${agent.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {agent.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-[#A35139] text-lg">
                      {agent.confirmations}
                    </td>
                  </tr>
                ))}
                {statsAgents.length === 0 && (
                  <tr>
                    <td colSpan="3" className="p-4 text-center text-[#1B2632]/60">Aucun agent trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
            <h2 className="text-lg font-bold text-[#1B2632]">Centre logistique (Livreurs)</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">Classement par nombre de colis livrés</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">Nom & Zone</th>
                  <th className="p-4 text-center">Statut</th>
                  <th className="p-4 text-right">Colis Livrés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {statsLivreurs.map((livreur, index) => (
                  <tr key={livreur.id} className="hover:bg-[#EEE9DF]/20 transition">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded bg-[#1B2632] text-white flex items-center justify-center text-xs font-bold">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium text-[#1B2632]">{livreur.nom}</p>
                          <p className="text-xs text-[#1B2632]/60 mt-0.5">{livreur.zone || 'Zone non définie (Volant)'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${livreur.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {livreur.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-[#1B2632] text-lg">
                      {livreur.colisLivres}
                    </td>
                  </tr>
                ))}
                {statsLivreurs.length === 0 && (
                  <tr>
                    <td colSpan="3" className="p-4 text-center text-[#1B2632]/60">Aucun livreur trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}