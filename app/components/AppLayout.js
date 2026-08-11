'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import NavBar from './NavBar'
import { supabase } from '../../lib/supabaseClient'
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte global

export default function AppLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [utilisateur, setUtilisateur] = useState({ nom: '' }) // Plus besoin de stocker le rôle ici
  
  // 🚀 Ajout de l'état isMounted pour éviter l'erreur "Hydration Mismatch"
  const [isMounted, setIsMounted] = useState(false)
  
  const pathname = usePathname()
  
  // 🚀 On récupère le VRAI nom du rôle depuis notre système de permissions !
  const { roleNom } = usePermissions()

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen)

  // Indique à React que le composant est bien chargé côté client
  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    async function chargerProfil() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      // On a supprimé la requête obsolète vers user_roles.
      // On garde uniquement la requête pour récupérer le prénom/nom de l'utilisateur.
      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      const nomBDD = agentData?.nom || agentData?.name || session.user.email.split('@')[0]
      
      setUtilisateur({ nom: nomBDD })
    }
    
    // On charge le profil partout sauf sur la page de connexion
    if (pathname !== '/') chargerProfil()
  }, [pathname])

  // Sécurité contre l'erreur d'hydration
  if (!isMounted) {
    return <div className="h-screen w-screen bg-[#EEE9DF]"></div>
  }

  // On cache ce Layout UNIQUEMENT sur la page de connexion '/'
  if (pathname === '/') {
    return <main className="h-screen w-screen bg-[#EEE9DF]">{children}</main>
  }

  return (
    <div className="flex h-screen bg-[#EEE9DF] text-[#1B2632] overflow-hidden relative">
      
      {/* Bouton flottant visible uniquement lorsque la NavBar est fermée */}
      {!isSidebarOpen && (
        <button 
          onClick={toggleSidebar}
          className="absolute top-5 left-6 z-30 p-3 bg-white text-[#1B2632] rounded-2xl hover:bg-[#EEE9DF] transition-all border border-[#C9C1B1]/40 shadow-md cursor-pointer flex items-center justify-center"
          title="Ouvrir le menu"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Barre latérale Principale */}
      <NavBar isOpen={isSidebarOpen} toggleMenu={toggleSidebar} />

      {/* Zone principale */}
      <div className="flex flex-col flex-1 h-screen overflow-hidden">
        
        {/* En-tête épuré (Profil utilisateur seul à droite) */}
        <header className="h-20 px-6 flex items-center justify-end shrink-0 bg-transparent">
          <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-[#C9C1B1]/40 shadow-sm">
            <div className="w-9 h-9 rounded-full bg-[#1B2632] flex items-center justify-center text-white font-bold text-sm shadow-sm">
              {utilisateur.nom ? utilisateur.nom.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="flex flex-col justify-center">
              <span className="text-sm font-bold text-[#1B2632] capitalize leading-tight">
                {utilisateur.nom || 'Chargement...'}
              </span>
              {/* 🚀 Affichage dynamique et fiable du rôle ici */}
              <span className="text-[10px] font-bold text-[#1B2632]/50 uppercase tracking-wider mt-0.5">
                {roleNom} 
              </span>
            </div>
          </div>
        </header>

        {/* Contenu de la page */}
        <main className="flex-1 overflow-y-auto px-6 pb-6">
          {children}
        </main>
      </div>

    </div>
  )
}