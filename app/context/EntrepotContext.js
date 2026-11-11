'use client'

// L'entrepôt regardé (11/11, sa demande) : un choix en haut, à côté du nom du
// compte, qui filtre tous les écrans. Vide = tous les entrepôts.
//
// La liste vient de la base (entrepots_du_compte, entrepots_filtre.sql) : les
// entrepôts de l'entreprise regardée, jamais ceux d'une autre ; pour un vendeur,
// seulement ceux où sont SES produits. Le choix est gardé par entreprise
// (localStorage) : changer d'entreprise (super admin) ne garde pas un entrepôt
// qui n'est pas le sien.
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from './AuthContext'

const EntrepotContext = createContext({ entrepots: [], entrepotId: null, entrepot: null, setEntrepotId: () => {} })

const cle = (tenant) => `crm.entrepot.${tenant}`

export function EntrepotProvider({ children }) {
  const { user, tenantId } = useAuth()
  const [entrepots, setEntrepots] = useState([])
  const [entrepotId, setEntrepotIdEtat] = useState(null)

  useEffect(() => {
    let annule = false
    async function charger() {
      if (!user || !tenantId) { setEntrepots([]); setEntrepotIdEtat(null); return }
      const { data, error } = await supabase.rpc('entrepots_du_compte', { p_tenant: tenantId })
      if (annule) return
      // SQL pas encore lancé, ou une erreur : pas de menu, pas de filtre.
      const liste = error ? [] : (data || [])
      setEntrepots(liste)
      let garde = null
      try { garde = localStorage.getItem(cle(tenantId)) } catch { garde = null }
      setEntrepotIdEtat(garde && liste.some((e) => e.id === garde) ? garde : null)
    }
    charger()
    return () => { annule = true }
  }, [user, tenantId])

  const setEntrepotId = useCallback((id) => {
    setEntrepotIdEtat(id || null)
    try {
      if (id) localStorage.setItem(cle(tenantId), id)
      else localStorage.removeItem(cle(tenantId))
    } catch { /* stockage indisponible : le choix reste pour cette visite */ }
  }, [tenantId])

  const valeur = useMemo(() => ({
    entrepots,
    entrepotId,
    entrepot: entrepots.find((e) => e.id === entrepotId) || null,
    setEntrepotId,
  }), [entrepots, entrepotId, setEntrepotId])

  return <EntrepotContext.Provider value={valeur}>{children}</EntrepotContext.Provider>
}

export const useEntrepot = () => useContext(EntrepotContext)
