'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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

  // useCallback / useMemo ne sont PAS de l'optimisation ici, ils sont nécessaires.
  // Sans eux, `hasPermission` et l'objet du Provider sont recréés à chaque rendu.
  // Or plusieurs pages écrivent `hasPermission` dans les dépendances d'un
  // useEffect : celui-ci se croyait donc relancé à chaque rendu. Sur le tableau
  // de bord, l'effet chargeait les données, ce qui provoquait un rendu, qui
  // relançait l'effet... une boucle infinie de requêtes, jusqu'à ce que le
  // navigateur tue l'onglet ("This page couldn't load" sur téléphone).
  const hasPermission = useCallback(
    (permCode) => permissions.includes(permCode),
    [permissions],
  )

  const valeur = useMemo(
    () => ({ permissions, roleNom, loading, hasPermission }),
    [permissions, roleNom, loading, hasPermission],
  )

  return (
    <PermissionsContext.Provider value={valeur}>
      {children}
    </PermissionsContext.Provider>
  )
}

export const usePermissions = () => useContext(PermissionsContext)