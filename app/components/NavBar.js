'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte

// 🚀 On remplace "roles: [...]" par "permission: 'code'"
const TOUS_LES_LIENS = [
  { href: '/dashboard', label: 'Dashboard', permission: 'menu_dashboard' },
  { href: '/performances', label: 'Performances', permission: 'menu_performances' },
  { href: '/commandes', label: 'Commandes' , permission: 'menu_commandes' }, 
  { href: '/centre-appel', label: 'Centre d\'appel', permission: 'menu_centre_appel' },
  { href: '/assignation-livreur', label: 'Assignation livreur', permission: 'menu_assignation_livreur' },
  { href: '/livraisons', label: 'Livraisons', permission: 'menu_livraisons' },
  { href: '/paiements', label: 'Paiements', permission: 'menu_paiements' },
  { href: '/utilisateurs', label: 'Utilisateurs', permission: 'menu_utilisateurs' },
  { href: '/parametres', label: 'Paramètres', permission: 'menu_parametres' },
  { href: '/profile', label: 'Profil' }, 
  // Pas de permission = accessible à tous ceux connectés
]

const LIENS_SUPER_ADMIN = [
  { href: '/super-admin/tenants', label: 'Entreprises (Tenants)', permission: 'menu_tenants' },
  { href: '/super-admin/comptes', label: 'Comptes & Accès', permission: 'menu_comptes_acces' },
  { href: '/super-admin/roles', label: 'Gestion des Rôles', permission: 'menu_gestion_roles' },
]

export default function NavBar({ isOpen, toggleMenu }) {
  const pathname = usePathname()
  const router = useRouter()
  
  // 🚀 On récupère notre fonction magique
  const { hasPermission, loading } = usePermissions()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (pathname === '/') return null

  // 🚀 FILTRAGE DYNAMIQUE : On ne garde que les liens dont l'utilisateur a la permission
  const liensVisibles = TOUS_LES_LIENS.filter((lien) => 
    !lien.permission || hasPermission(lien.permission)
  )
  
  const liensSuperAdminVisibles = LIENS_SUPER_ADMIN.filter((lien) => 
    hasPermission(lien.permission)
  )

  return (
    <>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #1B2632; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #2C3B4D; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3A4D63; }
      `}</style>
      <nav 
        className={`flex flex-col h-full bg-[#1B2632] text-[#EEE9DF] flex-shrink-0 shadow-xl transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="w-64 flex flex-col h-full">
          
          {/* En-tête : Bouton Menu + Logo */}
          <div className="flex items-center justify-between px-5 h-20 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={toggleMenu}
                className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Masquer le menu"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

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

          {/* Liens de navigation */}
          <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-2 custom-scrollbar">
            
            <p className="px-4 text-xs font-semibold text-[#C9C1B1]/50 uppercase tracking-wider mb-2">
              Menu Principal
            </p>
            
            {/* 🚀 Si les permissions sont en cours de chargement, on évite les sauts d'affichage */}
            {loading ? (
              <div className="px-4 text-sm text-gray-500">Chargement des accès...</div>
            ) : (
              liensVisibles.map((lien) => {
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
              })
            )}

            {/* 🚀 Section Super Administration : N'apparaît que si on a au moins une des permissions Super Admin */}
            {!loading && liensSuperAdminVisibles.length > 0 && (
              <>
                <div className="h-px bg-white/10 my-2 mx-4"></div>
                {liensSuperAdminVisibles.map((lien) => {
                  const isActive = pathname.includes(lien.href)
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
              </>
            )}

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