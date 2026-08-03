'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

const TOUS_LES_LIENS = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin'] },
  { href: '/performances', label: 'Performances', roles: ['admin'] },
  { href: '/centre-appel', label: 'Centre d\'appel', roles: ['admin', 'agent'] },
  { href: '/assignation-livreur', label: 'Assignation livreur', roles: ['admin'] },
  { href: '/livraisons', label: 'Livraisons', roles: ['admin', 'livreur'] },
  { href: '/paiements', label: 'Paiements', roles: ['admin', 'livreur'] },
  { href: '/utilisateurs', label: 'Utilisateurs', roles: ['admin'] },
  { href: '/parametres', label: 'Paramètres', roles: ['admin'] },
  // Ajout du lien Profil (accessible par la plupart des rôles)
  { href: '/profile', label: 'Profil', roles: ['admin', 'agent', 'livreur', 'superviseur', 'commercial', 'comptable', 'chef_equipe', 'support'] },
]

export default function NavBar({ isOpen, toggleMenu }) {
  const [role, setRole] = useState(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    async function chargerRole() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle()
      setRole(data?.role || null)
    }
    chargerRole()
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (pathname === '/') return null

  const liensVisibles = TOUS_LES_LIENS.filter((lien) => role && lien.roles.includes(role))

  return (
    <>
      <style>{`
        /* Scrollbar élégante aux couleurs du thème de la NavBar */
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1B2632;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #2C3B4D;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3A4D63;
        }
      `}</style>
      <nav 
        className={`flex flex-col h-full bg-[#1B2632] text-[#EEE9DF] flex-shrink-0 shadow-xl transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="w-64 flex flex-col h-full">
          
          {/* En-tête : Bouton Menu + Logo côte à côte */}
          <div className="flex items-center justify-between px-5 h-20 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              
              {/* Bouton Hamburger intégré dans la NavBar */}
              <button 
                onClick={toggleMenu}
                className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Masquer le menu"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Logo conservé intact */}
              <div className="flex items-center gap-2">
                <svg width="20" height="10" viewBox="0 0 20 8">
                  <line x1="0" y1="4" x2="14" y2="4" stroke="#FFB162" strokeWidth="2" strokeDasharray="2 2" />
                  <circle cx="18" cy="4" r="2.5" fill="#FFB162" />
                </svg>
                <span className="font-display font-bold text-base tracking-wide text-white">
                  CRM FGMED
                </span>
              </div>

            </div>
          </div>

          {/* Liens de navigation avec la scrollbar personnalisée */}
          <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-2 custom-scrollbar">
            <p className="px-4 text-xs font-semibold text-[#C9C1B1]/50 uppercase tracking-wider mb-2">
              Menu Principal
            </p>
            
            {liensVisibles.map((lien) => {
              const isActive = pathname === lien.href
              return (
                <Link
                  key={lien.href}
                  href={lien.href}
                  className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-[#2C3B4D] text-white shadow-sm'
                      : 'text-[#EEE9DF]/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {lien.label}
                </Link>
              )
            })}
          </div>

          {/* Déconnexion */}
          <div className="p-4 border-t border-white/10 shrink-0">
            <button 
              onClick={handleLogout} 
              className="w-full flex items-center justify-start px-4 py-3 text-sm font-medium text-[#A35139] hover:bg-[#A35139]/10 rounded-xl transition-colors cursor-pointer"
            >
              Se déconnecter
            </button>
          </div>

        </div>
      </nav>
    </>
  )
}