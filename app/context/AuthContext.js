'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchUserData(sessionUser) {
      if (!sessionUser) {
        setUser(null)
        setTenantId(null)
        setLoading(false)
        return
      }

      setUser(sessionUser)

      // 🚀 On ne récupère PLUS que le tenant_id. 
      // Le rôle et les permissions sont désormais gérés par le PermissionsContext !
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('tenant_id')
        .eq('user_id', sessionUser.id)
        .maybeSingle()

      if (roleData) {
        setTenantId(roleData.tenant_id)
      }

      // N.B. : L'appel RPC "get_mes_permissions" a été supprimé car obsolète.

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

  // Même raison que dans PermissionsContext : un objet recréé à chaque rendu
  // fait re-rendre tous les consommateurs pour rien.
  const valeur = useMemo(() => ({ user, tenantId, loading }), [user, tenantId, loading])

  return (
    <AuthContext.Provider value={valeur}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)