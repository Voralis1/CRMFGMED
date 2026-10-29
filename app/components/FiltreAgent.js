'use client'

// LE filtre par agent (29/10), partagé par le Centre d'appel et Commandes :
// même liste, mêmes règles.
//   · « Tous les agents » (défaut), « Sans agent », puis TOUS les agents de
//     l'entreprise — inactifs compris, marqués « (inactif) » : leurs leads
//     doivent rester trouvables ;
//   · une VUE, pas un droit : il resserre ce qui s'affiche, rien d'autre ;
//   · un simple état dans la page : un rechargement l'efface, exprès ;
//   · responsables seulement (admin, manager, ceo, super_admin) — c'est la
//     page qui décide de l'afficher ; un vendeur et un agent ne le voient pas.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

// La valeur « Sans agent » : jamais un id d'agent (ce sont des uuid).
export const AUCUN_AGENT = 'aucun'
export const ROLES_FILTRE_AGENT = ['admin', 'manager', 'ceo', 'super_admin']

export const libelleAgent = (a) => (a.actif && a.user_id ? a.nom : `${a.nom} (inactif)`)

export function nomFiltreAgent(valeur, agents) {
  if (!valeur) return ''
  if (valeur === AUCUN_AGENT) return 'Sans agent'
  return (agents || []).find((a) => a.id === valeur)?.nom || 'Agent'
}

// Tous les agents de l'entreprise (id, nom, pays_id, actif, user_id).
export function useAgentsEntreprise(tenantKey, actif) {
  const [agents, setAgents] = useState([])
  useEffect(() => {
    if (!tenantKey || !actif) return
    let annule = false
    supabase
      .from('agents')
      .select('id, nom, pays_id, actif, user_id')
      .eq('tenant_id', tenantKey)
      .order('nom')
      .then(({ data }) => { if (!annule) setAgents(data || []) })
    return () => { annule = true }
  }, [tenantKey, actif])
  return agents
}

// Applique le filtre à une requête PostgREST sur commandes.
export function filtrerParAgent(q, valeur) {
  if (valeur === AUCUN_AGENT) return q.is('agent_id', null)
  if (valeur) return q.eq('agent_id', valeur)
  return q
}

export default function SelectAgent({ agents, value, onChange, className, title }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title || "Ne montrer que les leads d'un agent. Ne change rien à ce que vous pouvez voir."}
      className={className}
      data-filtre-agent
    >
      <option value="">Tous les agents</option>
      <option value={AUCUN_AGENT}>Sans agent</option>
      {(agents || []).map((a) => <option key={a.id} value={a.id}>{libelleAgent(a)}</option>)}
    </select>
  )
}
