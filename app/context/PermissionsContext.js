'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from './AuthContext' // ← ajustez le chemin

const PermissionsContext = createContext({
  permissions: [],
  roleNom: null,
  loading: true,
  hasPermission: () => false,
})

export function PermissionsProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [permissions, setPermissions] = useState([])
  const [roleNom, setRoleNom] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setPermissions([])
      setRoleNom(null)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchAccess() {
      setLoading(true)
      try {
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role_id, role')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!userRole || cancelled) {
          if (!cancelled) { setPermissions([]); setRoleNom(null) }
          return
        }

        if (!cancelled) setRoleNom(userRole.role)

        const { data: rolePerms } = await supabase
          .from('role_permissions')
          .select('permission_code')
          .eq('role_id', userRole.role_id)

        if (!cancelled) setPermissions(rolePerms?.map(p => p.permission_code) ?? [])
      } catch (e) {
        console.error('Erreur chargement permissions :', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAccess()
    return () => { cancelled = true }
  }, [user?.id, authLoading])  // ← SE RELANCE À CHAQUE LOGIN/LOGOUT 🎉

  const hasPermission = (permCode) => permissions.includes(permCode)

  return (
    <PermissionsContext.Provider value={{ permissions, roleNom, loading, hasPermission }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export const usePermissions = () => useContext(PermissionsContext)