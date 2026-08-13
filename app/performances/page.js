'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

const PERIODES = [
  { id: 'aujourdhui', label: "Aujourd'hui" },
  { id: 'hier', label: 'Hier' },
  { id: '7jours', label: '7 jours' },
  { id: '30jours', label: '30 jours' },
  { id: 'personnalise', label: 'Personnalisé' },
]

// Calcule les bornes ISO d'une période nommée
function bornesPeriode(periode, dateDebutPerso, dateFinPerso) {
  const maintenant = new Date()
  const finJour = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  const debutJour = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

  if (periode === 'aujourdhui') {
    return { debut: debutJour(maintenant).toISOString(), fin: finJour(maintenant).toISOString() }
  }
  if (periode === 'hier') {
    const hier = new Date(maintenant); hier.setDate(hier.getDate() - 1)
    return { debut: debutJour(hier).toISOString(), fin: finJour(hier).toISOString() }
  }
  if (periode === '7jours') {
    const debut = new Date(maintenant); debut.setDate(debut.getDate() - 6)
    return { debut: debutJour(debut).toISOString(), fin: finJour(maintenant).toISOString() }
  }
  if (periode === '30jours') {
    const debut = new Date(maintenant); debut.setDate(debut.getDate() - 29)
    return { debut: debutJour(debut).toISOString(), fin: finJour(maintenant).toISOString() }
  }
  if (periode === 'personnalise' && dateDebutPerso && dateFinPerso) {
    return { debut: debutJour(new Date(dateDebutPerso)).toISOString(), fin: finJour(new Date(dateFinPerso)).toISOString() }
  }
  // Fallback : 7 derniers jours
  const debut = new Date(maintenant); debut.setDate(debut.getDate() - 6)
  return { debut: debutJour(debut).toISOString(), fin: finJour(maintenant).toISOString() }
}

function BarreTaux({ valeur, couleur }) {
  return (
    <div className="w-full h-1.5 bg-[#EEE9DF] rounded-full overflow-hidden mt-1.5">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, valeur)}%`, backgroundColor: couleur }} />
    </div>
  )
}

export default function PerformancesPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const [ongletActif, setOngletActif] = useState('agents')
  const [chargement, setChargement] = useState(true)

  const [periode, setPeriode] = useState('7jours')
  const [dateDebutPerso, setDateDebutPerso] = useState('')
  const [dateFinPerso, setDateFinPerso] = useState('')

  const [statsAgents, setStatsAgents] = useState([])
  const [statsLivreurs, setStatsLivreurs] = useState([])
  const [avertissementLivraison, setAvertissementLivraison] = useState(false)

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
    if (periode === 'personnalise' && (!dateDebutPerso || !dateFinPerso)) return
    setChargement(true)

    const { debut, fin } = bornesPeriode(periode, dateDebutPerso, dateFinPerso)

    // Les statuts marqués "declenche_assignation" sont, par construction, ceux qui
    // signifient "commande confirmée" pour ce tenant — quel que soit leur nom
    // affiché ou leur code exact. On réutilise ce flag plutôt que de deviner
    // une chaîne comme 'confirmed', ce qui évite le problème de normalisation
    // signalé sur les autres pages (confirme / confirmee / Confirmée...).
    const [resAgents, resAppels, resLivreurs, resLivraisons, resStatuts] = await Promise.all([
      supabase.from('agents').select('id, nom, actif').eq('tenant_id', tenantId),
      supabase.from('appels').select('agent_id, statut, created_at').eq('tenant_id', tenantId).gte('created_at', debut).lte('created_at', fin),
      supabase.from('livreurs').select('id, nom, telephone, zone, actif').eq('tenant_id', tenantId),
      supabase.from('livraisons').select('livreur_id, statut, created_at').eq('tenant_id', tenantId).gte('created_at', debut).lte('created_at', fin),
      supabase.from('statuts').select('code, declenche_assignation').eq('tenant_id', tenantId).eq('declenche_assignation', true),
    ])

    const agents = resAgents.data || []
    const appels = resAppels.data || []
    const livreurs = resLivreurs.data || []
    const livraisons = resLivraisons.data || []
    const codesConfirmes = (resStatuts.data || []).map((s) => s.code)

    const agentsMap = agents.map((agent) => {
      const appelsAgent = appels.filter((a) => String(a.agent_id) === String(agent.id))
      const total = appelsAgent.length
      const confirmations = codesConfirmes.length > 0
        ? appelsAgent.filter((a) => codesConfirmes.includes(a.statut)).length
        : appelsAgent.filter((a) => a.statut === 'confirmed').length // repli si rien n'est encore configuré
      const taux = total > 0 ? Math.round((confirmations / total) * 100) : 0
      return { ...agent, total, confirmations, taux }
    }).sort((a, b) => b.confirmations - a.confirmations)

    // Reconnaissance souple du statut "livré" tant que le type 'livraison'
    // n'est pas encore normalisé dans la table statuts (voir avertissement affiché).
    const estLivre = (statut) => {
      if (!statut) return false
      const s = statut
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      return s.includes('livr') && !s.includes('non') && !s.includes('echec') && !s.includes('retour')
    }

    const livreursMap = livreurs.map((livreur) => {
      const livraisonsLivreur = livraisons.filter((l) => String(l.livreur_id) === String(livreur.id))
      const total = livraisonsLivreur.length
      const colisLivres = livraisonsLivreur.filter((l) => estLivre(l.statut)).length
      const taux = total > 0 ? Math.round((colisLivres / total) * 100) : 0
      return { ...livreur, total, colisLivres, taux }
    }).sort((a, b) => b.colisLivres - a.colisLivres)

    setStatsAgents(agentsMap)
    setStatsLivreurs(livreursMap)
    setAvertissementLivraison(codesConfirmes.length === 0)
    setChargement(false)
  }, [tenantId, periode, dateDebutPerso, dateFinPerso])

  useEffect(() => {
    if (tenantId) {
      chargerPerformances()
    }
  }, [tenantId, chargerPerformances])

  if (authLoading || permsLoading || !hasPermission('menu_performances')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-16 px-6">

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Administration
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">
              Suivi des performances
            </h1>
          </div>

          <button
            onClick={chargerPerformances}
            disabled={chargement}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-sm font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm cursor-pointer disabled:opacity-50 w-fit"
          >
            {chargement ? 'Actualisation...' : '↻ Rafraîchir'}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {PERIODES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriode(p.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  periode === p.id
                    ? 'bg-[#1B2632] text-white shadow-sm'
                    : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {periode === 'personnalise' && (
            <div className="flex items-center gap-2 bg-white border border-[#C9C1B1] rounded-xl px-3 py-2 shadow-sm">
              <input type="date" value={dateDebutPerso} onChange={(e) => setDateDebutPerso(e.target.value)} className="text-xs font-medium text-[#1B2632] outline-none bg-transparent" />
              <span className="text-[#1B2632]/40 text-xs">→</span>
              <input type="date" value={dateFinPerso} onChange={(e) => setDateFinPerso(e.target.value)} className="text-xs font-medium text-[#1B2632] outline-none bg-transparent" />
            </div>
          )}
        </div>

        <div className="flex gap-4 mt-1">
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

      {avertissementLivraison && ongletActif === 'agents' && (
        <div className="p-4 bg-[#FFB162]/15 border border-[#FFB162]/40 rounded-xl text-sm font-medium text-[#8a5a1f]">
          Aucun statut n'est marqué "déclenche l'assignation" dans Paramètres → Statuts configurables — le taux de confirmation utilise donc temporairement le code générique <code className="font-mono">confirmed</code>. Configurez ce flag pour un calcul fiable sur vos vrais statuts.
        </div>
      )}

      {chargement ? (
        <p className="text-[#1B2632]/60 py-6">Calcul des statistiques en cours...</p>
      ) : ongletActif === 'agents' ? (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
            <h2 className="text-lg font-bold text-[#1B2632]">Centre d'appel (Agents)</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">Volume traité et taux de confirmation sur la période sélectionnée</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">Nom de l'agent</th>
                  <th className="p-4 text-center">Statut</th>
                  <th className="p-4 text-right">Appels traités</th>
                  <th className="p-4 text-right">Confirmations</th>
                  <th className="p-4 text-right w-[160px]">Taux de confirmation</th>
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
                    <td className="p-4 text-right font-medium text-[#1B2632]">{agent.total}</td>
                    <td className="p-4 text-right font-bold text-[#A35139] text-lg">{agent.confirmations}</td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-[#1B2632]">{agent.taux}%</span>
                      <BarreTaux valeur={agent.taux} couleur="#2C3B4D" />
                    </td>
                  </tr>
                ))}
                {statsAgents.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-4 text-center text-[#1B2632]/60">Aucun agent trouvé sur cette période.</td>
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
            <p className="text-sm text-[#1B2632]/60 mt-1">Volume traité et taux de livraison sur la période sélectionnée</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">Nom & Zone</th>
                  <th className="p-4 text-center">Statut</th>
                  <th className="p-4 text-right">Livraisons assignées</th>
                  <th className="p-4 text-right">Colis livrés</th>
                  <th className="p-4 text-right w-[160px]">Taux de livraison</th>
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
                    <td className="p-4 text-right font-medium text-[#1B2632]">{livreur.total}</td>
                    <td className="p-4 text-right font-bold text-[#1B2632] text-lg">{livreur.colisLivres}</td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-[#1B2632]">{livreur.taux}%</span>
                      <BarreTaux valeur={livreur.taux} couleur="#FFB162" />
                    </td>
                  </tr>
                ))}
                {statsLivreurs.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-4 text-center text-[#1B2632]/60">Aucun livreur trouvé sur cette période.</td>
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