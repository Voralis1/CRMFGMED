'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' 
import { useLangue } from '../context/LangueContext'

export default function SuperAdminLayout({ children }) {
  const { user, role, loading: authLoading } = useAuth() 
  const { t } = useLangue()
  const router = useRouter()
  const pathname = usePathname()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [verifying, setVerifying] = useState(true)

  useEffect(() => {
    async function checkSuperAdmin() {
      if (authLoading) return
      
      if (!user) {
        router.push('/')
        return
      }

      // Si le rôle est déjà dans le contexte, on l'utilise directement
      let userRole = role

      // Sinon, on va le chercher dans la base de données par sécurité
      if (!userRole) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle()
        
        userRole = roleData?.role
      }

      // 🔍 Vérification insensible à la casse ('super_admin' ou 'SUPER_ADMIN')
      const estSuper = userRole && userRole.toLowerCase() === 'super_admin'

      if (!estSuper) {
        // Redirection vers le dashboard normal si ce n'est pas un super admin
        router.push('/dashboard')
      } else {
        setIsSuperAdmin(true)
      }
      
      setVerifying(false)
    }

    checkSuperAdmin()
  }, [user, role, authLoading, router])

  if (authLoading || verifying) {
    return <div className="p-20 text-center text-sm font-medium text-[#1B2632]">{t('cadre.verificationSuperAdmin')}</div>
  }

  if (!isSuperAdmin) return null

  return (
    // 🚀 L-MODIFICATION HNA: 7iydna <aside> kaml w khlina ghir l-contenu
    <div className="flex flex-1 min-h-full">
      {/* Sans marge propre (24/11) : AppLayout en met déjà une. Les deux
          ensemble laissaient un grand vide en haut des 3 pages Super admin. */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  )
}