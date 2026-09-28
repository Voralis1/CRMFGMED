'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import NavBar from './NavBar'
import { supabase } from '../../lib/supabaseClient'
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte global

const LARGEUR_BUREAU = 768   // tailwind `md`

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
    // On a phone the menu starts closed, otherwise it covers the whole screen.
    setIsSidebarOpen(window.innerWidth >= LARGEUR_BUREAU)
  }, [])

  // On phone, opening a page closes the menu (it sits on top of the content)
  useEffect(() => {
    if (window.innerWidth < LARGEUR_BUREAU) setIsSidebarOpen(false)
  }, [pathname])

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
    return <div className="h-[100dvh] w-full bg-[#EEE9DF]"></div>
  }

  // On cache ce Layout UNIQUEMENT sur la page de connexion '/'
  if (pathname === '/') {
    return <main className="min-h-[100dvh] w-full bg-[#EEE9DF]">{children}</main>
  }

  return (
    <div className="flex h-[100dvh] bg-[#EEE9DF] text-[#1B2632] overflow-hidden relative">

      {/* Bouton flottant : uniquement sur grand écran, quand le menu est replié */}
      {!isSidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="hidden md:flex absolute top-5 left-6 z-30 p-3 bg-white text-[#1B2632] rounded-2xl hover:bg-[#EEE9DF] transition-all border border-[#C9C1B1]/40 shadow-md cursor-pointer items-center justify-center"
          title="Ouvrir le menu"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Voile sombre derrière le menu sur téléphone */}
      {isSidebarOpen && (
        <div
          onClick={toggleSidebar}
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          aria-hidden="true"
        />
      )}

      {/* Barre latérale Principale */}
      <NavBar isOpen={isSidebarOpen} toggleMenu={toggleSidebar} />

      {/* Zone principale */}
      <div className="flex flex-col flex-1 min-w-0 h-[100dvh] overflow-hidden">

        {/* En-tête : menu (téléphone) à gauche, profil à droite */}
        <header className="h-16 sm:h-20 px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0 bg-transparent">
          <button
            onClick={toggleSidebar}
            className="md:hidden p-2.5 bg-white text-[#1B2632] rounded-xl border border-[#C9C1B1]/40 shadow-sm cursor-pointer flex items-center justify-center shrink-0"
            title="Ouvrir le menu"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3 bg-white px-3 sm:px-4 py-2 rounded-2xl border border-[#C9C1B1]/40 shadow-sm min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-full bg-[#1B2632] flex items-center justify-center text-white font-bold text-sm shadow-sm">
              {utilisateur.nom ? utilisateur.nom.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="flex flex-col justify-center min-w-0">
              <span className="text-sm font-bold text-[#1B2632] capitalize leading-tight truncate max-w-[120px] sm:max-w-none">
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
        {/* px-0 sur téléphone : chaque page gère sa propre marge intérieure */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-0 sm:px-6 pb-6">
          {children}
        </main>
      </div>

    </div>
  )
}