'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte

export default function TopBar({ toggleMenu }) {
  const [utilisateur, setUtilisateur] = useState({ nom: 'Chargement...' }) // Plus besoin de stocker le rôle
  const pathname = usePathname()
  
  // 🚀 On récupère le VRAI nom du rôle depuis notre système global
  const { roleNom } = usePermissions()

  useEffect(() => {
    async function chargerProfil() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      // On a supprimé la requête obsolète vers user_roles.
      // On garde uniquement la requête pour récupérer le nom de l'agent.
      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      const nomBDD = agentData?.nom || agentData?.name || session.user.email.split('@')[0]
      
      setUtilisateur({ nom: nomBDD })
    }
    
    if (pathname !== '/') chargerProfil()
  }, [pathname])

  if (pathname === '/') return null

  return (
    <header className="h-20 bg-white border-b border-[#C9C1B1]/50 flex items-center justify-between px-6 shrink-0 z-10 shadow-sm w-full">
      
      {/* GAUCHE : Bouton Hamburger + Message de bienvenue */}
      <div className="flex items-center gap-4">
        <button 
          onClick={toggleMenu}
          className="p-2.5 bg-[#EEE9DF]/40 text-[#1B2632] rounded-xl hover:bg-[#C9C1B1]/40 transition-colors border border-[#C9C1B1]/30 cursor-pointer"
          title="Afficher / Masquer le menu"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="hidden sm:block">
          <p className="text-xs text-[#1B2632]/50 font-medium">Welcome back,</p>
          <p className="text-[15px] font-bold text-[#1B2632] capitalize">
            {utilisateur.nom}
          </p>
        </div>
      </div>

      {/* DROITE : Pays + Profil */}
      <div className="flex items-center gap-6">
        
        {/* Pays */}
        <div className="hidden md:flex items-center gap-2.5 border-r border-[#C9C1B1]/40 pr-5 cursor-pointer hover:opacity-70 transition-opacity">
          <img src="https://flagcdn.com/w20/ma.png" alt="Maroc" className="w-5 object-contain rounded-sm shadow-sm" />
          <span className="text-sm font-semibold text-[#1B2632]">Maroc <span className="text-xs text-[#1B2632]/50 font-bold">(MAD)</span></span>
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-[#1B2632]/50">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Profil */}
        <div className="flex items-center gap-3 cursor-pointer pl-1">
          <div className="w-9 h-9 rounded-full bg-[#1B2632] flex items-center justify-center text-white font-bold text-sm shadow-sm">
            {utilisateur.nom !== 'Chargement...' ? utilisateur.nom.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-sm font-bold text-[#1B2632] capitalize leading-tight">
              {utilisateur.nom}
            </span>
            {/* 🚀 L'affichage du rôle est maintenant dynamique et 100% juste */}
            <span className="text-[10px] font-bold text-[#1B2632]/50 uppercase tracking-wider mt-0.5">
              {roleNom}
            </span>
          </div>
        </div>

      </div>
    </header>
  )
}