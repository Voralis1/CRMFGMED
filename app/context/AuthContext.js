'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const AuthContext = createContext({})

// Un super admin n'appartient pas vraiment à une entreprise : sa ligne dans
// `user_roles` en nomme une, et tout le CRM se mettait à filtrer sur celle-là,
// alors que la base l'autorise à tout voir. Il choisit donc l'entreprise qu'il
// regarde, et ce choix remplace la sienne partout — les pages lisent toutes le
// tenant d'ici, aucune n'a besoin d'être modifiée.
const CLE_ENTREPRISE = 'fg_entreprise_super_admin'

function lireChoix() {
  try {
    return localStorage.getItem(CLE_ENTREPRISE) || null
  } catch {
    return null // navigation privée ou stockage bloqué : on s'en passe
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [tenantReel, setTenantReel] = useState(null)
  const [estSuperAdmin, setEstSuperAdmin] = useState(false)
  const [tenantChoisi, setTenantChoisiEtat] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setTenantChoisiEtat(lireChoix())
  }, [])

  function setTenantChoisi(id) {
    setTenantChoisiEtat(id)
    try {
      if (id) localStorage.setItem(CLE_ENTREPRISE, id)
      else localStorage.removeItem(CLE_ENTREPRISE)
    } catch {
      // le choix ne survivra pas au rechargement, la session reste utilisable
    }
  }

  useEffect(() => {
    async function fetchUserData(sessionUser) {
      if (!sessionUser) {
        setUser(null)
        setTenantReel(null)
        setEstSuperAdmin(false)
        setLoading(false)
        return
      }

      setUser(sessionUser)

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('tenant_id, role')
        .eq('user_id', sessionUser.id)
        .maybeSingle()

      if (roleData) {
        setTenantReel(roleData.tenant_id)
        setEstSuperAdmin(String(roleData.role || '').toLowerCase() === 'super_admin')
      }

      setLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      fetchUserData(session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchUserData(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Pour tout le monde sauf le super admin, c'est son entreprise, point.
  const tenantId = estSuperAdmin && tenantChoisi ? tenantChoisi : tenantReel

  // Mémorisé : un objet recréé à chaque rendu ferait re-rendre tous les
  // consommateurs et relancerait les effets qui en dépendent.
  const valeur = useMemo(
    () => ({ user, tenantId, loading, estSuperAdmin, tenantChoisi, setTenantChoisi }),
    [user, tenantId, loading, estSuperAdmin, tenantChoisi],
  )

  return (
    <AuthContext.Provider value={valeur}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)