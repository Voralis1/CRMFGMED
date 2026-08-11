'use client'

import { createContext, useContext, useEffect, useState } from 'react'
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

  return (
    // On retire `role` et `permissions` du Provider
    <AuthContext.Provider value={{ user, tenantId, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)