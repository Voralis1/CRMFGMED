'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useEntrepot } from '../context/EntrepotContext'
import { usePermissions } from '../context/PermissionsContext'
// Le délai de première prise en charge enregistrée (02/11) : responsables seulement.
import { SectionDelai } from '../components/DelaiPriseEnCharge'
// La période « Personnalisé » : le calendrier français des autres pages (23/11).
import PlageDates from '../components/PlageDates'
import { useLangue } from '../context/LangueContext'

const PERIODES = [
  // label = une clé de texte (25/11, lib/langues).
  { id: 'aujourdhui', label: 'perf.p.aujourdhui' },
  { id: 'hier', label: 'perf.p.hier' },
  { id: '7jours', label: 'perf.p.7' },
  { id: '30jours', label: 'perf.p.30' },
  { id: 'personnalise', label: 'perf.p.perso' },
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
  // L'entrepôt regardé (en haut, 11/11) : les appels et livraisons de ses commandes.
  const { entrepotId } = useEntrepot()
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions()
  // Les textes suivent la langue choisie (25/11).
  const { t } = useLangue()
  const router = useRouter()

  const [ongletActif, setOngletActif] = useState('agents')
  const [chargement, setChargement] = useState(true)

  const [periode, setPeriode] = useState('7jours')
  const [dateDebutPerso, setDateDebutPerso] = useState('')
  const [dateFinPerso, setDateFinPerso] = useState('')

  const [statsAgents, setStatsAgents] = useState([])
  // Les bornes de la période, posées au chargement (la section du délai les lit).
  const [bornes, setBornes] = useState({ debut: null, fin: null })
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
    setBornes({ debut, fin })

    // Les statuts marqués "declenche_assignation" sont, par construction, ceux qui
    // signifient "commande confirmée" pour ce tenant — quel que soit leur nom
    // affiché ou leur code exact. On réutilise ce flag plutôt que de deviner
    // une chaîne comme 'confirmed', ce qui évite le problème de normalisation
    // signalé sur les autres pages (confirme / confirmee / Confirmée...).
    const [resAgents, resAppels, resLivreurs, resLivraisons, resStatuts] = await Promise.all([
      supabase.from('agents').select('id, nom, actif').eq('tenant_id', tenantId),
      (entrepotId
        ? supabase.from('appels').select('agent_id, statut, created_at, commandes!inner(entrepot_id)').eq('commandes.entrepot_id', entrepotId)
        : supabase.from('appels').select('agent_id, statut, created_at')).eq('tenant_id', tenantId).gte('created_at', debut).lte('created_at', fin),
      supabase.from('livreurs').select('id, nom, telephone, zone, actif').eq('tenant_id', tenantId),
      (entrepotId
        ? supabase.from('livraisons').select('livreur_id, statut, created_at, commandes!inner(entrepot_id)').eq('commandes.entrepot_id', entrepotId)
        : supabase.from('livraisons').select('livreur_id, statut, created_at')).eq('tenant_id', tenantId).gte('created_at', debut).lte('created_at', fin),
      supabase.from('statuts').select('nom, declenche_assignation').eq('tenant_id', tenantId).eq('declenche_assignation', true),
    ])

    const agents = resAgents.data || []
    const appels = resAppels.data || []
    const livreurs = resLivreurs.data || []
    const livraisons = resLivraisons.data || []
    // Un appel garde le NOM du statut (« Confirmed »), jamais son code
    // (`confirmed`) : c'est ce que confirmer-appel écrit. Comparer aux codes ne
    // trouvait jamais rien — 0 confirmation pour tout le monde depuis la
    // première confirmation enregistrée (15/10), corrigé le 28/10.
    const nomsConfirmes = (resStatuts.data || []).map((s) => s.nom)

    const agentsMap = agents.map((agent) => {
      const appelsAgent = appels.filter((a) => String(a.agent_id) === String(agent.id))
      const total = appelsAgent.length
      // Aucun statut qui envoie au livreur dans Paramètres : 0, sans deviner un mot.
      const confirmations = appelsAgent.filter((a) => nomsConfirmes.includes(a.statut)).length
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
    setAvertissementLivraison(nomsConfirmes.length === 0)
    setChargement(false)
  }, [tenantId, periode, dateDebutPerso, dateFinPerso, entrepotId])

  useEffect(() => {
    if (tenantId) {
      chargerPerformances()
    }
  }, [tenantId, chargerPerformances])

  if (authLoading || permsLoading || !hasPermission('menu_performances')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">{t('perf.verif')}</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10 pt-4 sm:pt-2 px-4 sm:px-6">

      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          {/* En-tête compact (23/11). */}
          <h1 className="text-2xl font-bold text-[#1B2632]">{t('perf.titre')}</h1>

          <button
            onClick={chargerPerformances}
            disabled={chargement}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-sm font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 transition-colors shadow-sm cursor-pointer disabled:opacity-50 w-fit"
          >
            {chargement ? t('perf.actualisation') : `↻ ${t('perf.rafraichir')}`}
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
                {t(p.label)}
              </button>
            ))}
          </div>

          {periode === 'personnalise' && (
            <div className="w-full sm:w-[250px]">
              <style>{`.cm-input { width:100%; border:1px solid #C9C1B1; border-radius:12px; padding:8px 12px; font-size:13px; outline:none; background:#fff; color:#1B2632; }`}</style>
              <PlageDates etiquette="performances" du={dateDebutPerso} au={dateFinPerso} placeholder={t('perf.choisirPeriode')}
                onChange={(du, au) => { setDateDebutPerso(du); setDateFinPerso(au) }} />
            </div>
          )}
        </div>

        {/* Agents / Livreurs : des onglets (23/11), comme sur les autres pages. */}
        <div className="flex gap-1.5 bg-[#F4F0E6] p-1 rounded-xl border border-[#C9C1B1]/60 w-fit" role="tablist">
          {[['agents', t('perf.agents')], ['livreurs', t('perf.livreurs')]].map(([cle, nom]) => (
            <button key={cle} role="tab" aria-selected={ongletActif === cle} onClick={() => setOngletActif(cle)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                ongletActif === cle ? 'bg-[#1B2632] text-white shadow-sm' : 'text-[#1B2632]/70 hover:text-[#1B2632]'}`}>
              {nom}
            </button>
          ))}
        </div>
      </header>

      {avertissementLivraison && ongletActif === 'agents' && (
        <div className="p-4 bg-[#FFB162]/15 border border-[#FFB162]/40 rounded-xl text-sm font-medium text-[#8a5a1f]">
          {t('perf.avertissement')}
        </div>
      )}


      {chargement ? (
        <p className="text-[#1B2632]/60 py-6">{t('perf.calcul')}</p>
      ) : ongletActif === 'agents' ? (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
            <h2 className="text-lg font-bold text-[#1B2632]">{t('perf.centreAppel')}</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">{t('perf.agentsAide')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">{t('perf.nomAgent')}</th>
                  <th className="p-4 text-center">{t('perf.statut')}</th>
                  <th className="p-4 text-right">{t('perf.appels')}</th>
                  <th className="p-4 text-right">{t('perf.confirmations')}</th>
                  <th className="p-4 text-right w-[160px]">{t('perf.tauxConfirmation')}</th>
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
                    <td className="p-4 text-right font-bold text-[#2E7D53] text-lg">{agent.confirmations}</td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-[#1B2632]">{agent.taux}%</span>
                      <BarreTaux valeur={agent.taux} couleur="#2C3B4D" />
                    </td>
                  </tr>
                ))}
                {statsAgents.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-4 text-center text-[#1B2632]/60">{t('perf.aucunAgent')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
            <h2 className="text-lg font-bold text-[#1B2632]">{t('perf.logistique')}</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">{t('perf.livreursAide')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">{t('perf.nomZone')}</th>
                  <th className="p-4 text-center">{t('perf.statut')}</th>
                  <th className="p-4 text-right">{t('perf.livraisonsAssignees')}</th>
                  <th className="p-4 text-right">{t('perf.colisLivres')}</th>
                  <th className="p-4 text-right w-[160px]">{t('perf.tauxLivraison')}</th>
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
                          <p className="text-xs text-[#1B2632]/60 mt-0.5">{livreur.zone || t('perf.zoneNonDefinie')}</p>
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
                    <td colSpan="5" className="p-4 text-center text-[#1B2632]/60">{t('perf.aucunLivreur')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Le délai de prise en charge APRÈS le tableau des agents (23/11) : on
          ouvre la page d'abord pour les appels et les confirmations. */}
      {ongletActif === 'agents' && (
        <SectionDelai tenantId={tenantId} debut={bornes.debut} fin={bornes.fin} roleNom={roleNom} />
      )}

    </div>
  )
}