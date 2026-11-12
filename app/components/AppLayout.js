'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import NavBar from './NavBar'
import { supabase } from '../../lib/supabaseClient'
import { usePermissions } from '../context/PermissionsContext' // 🚀 Import du contexte global
import { useAuth } from '../context/AuthContext'
import { useEntrepot } from '../context/EntrepotContext'
import { drapeau } from '../../lib/paysMonde'
import { pageAutorisee, redirectionPour, regleDePage } from '../../lib/droitsPages.mjs'

const LARGEUR_BUREAU = 768   // tailwind `md`

export default function AppLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [utilisateur, setUtilisateur] = useState({ nom: '' }) // Plus besoin de stocker le rôle ici
  const { estSuperAdmin, tenantId, tenantChoisi, setTenantChoisi, loading: authLoading, entrepriseSuspendue } = useAuth()
  const { entrepots, entrepotId, setEntrepotId } = useEntrepot()
  const [entreprises, setEntreprises] = useState([])
  
  // 🚀 Ajout de l'état isMounted pour éviter l'erreur "Hydration Mismatch"
  const [isMounted, setIsMounted] = useState(false)
  
  const pathname = usePathname()
  
  // 🚀 On récupère le VRAI nom du rôle depuis notre système de permissions !
  const { roleNom, hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  // La page n'est MONTÉE que si la personne a le droit de l'ouvrir (30/10,
  // lib/droitsPages.mjs) : vérifier d'abord, charger ensuite. Tant que les
  // droits ne sont pas connus, rien n'est monté non plus.
  const regle = regleDePage(pathname)
  const droitsConnus = !authLoading && !permsLoading
  const pageOuverte = !regle || (droitsConnus && pageAutorisee(regle, hasPermission, roleNom))
  useEffect(() => {
    if (regle && droitsConnus && !pageAutorisee(regle, hasPermission, roleNom)) {
      router.replace(redirectionPour(regle, roleNom))
    }
  }, [regle, droitsConnus, hasPermission, roleNom, router])

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

  // La liste des entreprises, pour le seul super admin. S'il n'en a choisi
  // aucune, on prend la première : sans entreprise, toutes les pages du CRM
  // restent vides et il croirait l'application cassée.
  useEffect(() => {
    if (!estSuperAdmin) return
    let annule = false

    async function chargerEntreprises() {
      // `select('*')` sans `order` : nommer une colonne qui n'existe pas fait
      // échouer toute la requête, et la table ne porte pas le même nom de
      // colonne partout (`nom` ici, `nom_entreprise` là). On trie nous-mêmes.
      const { data, error } = await supabase.from('tenants').select('*')
      if (annule) return
      if (error) {
        console.error('tenants:', error.message)
        return
      }
      const liste = (data || []).slice().sort((a, b) =>
        String(a.nom || a.nom_entreprise || '').localeCompare(String(b.nom || b.nom_entreprise || ''))
      )
      setEntreprises(liste)
      if (!tenantChoisi && !tenantId && liste.length > 0) setTenantChoisi(liste[0].id)
    }

    chargerEntreprises()
    return () => { annule = true }
  }, [estSuperAdmin, tenantChoisi, tenantId, setTenantChoisi])

  // Sécurité contre l'erreur d'hydration
  if (!isMounted) {
    return <div className="h-[100dvh] w-full bg-[#EEE9DF]"></div>
  }

  // On cache ce Layout UNIQUEMENT sur la page de connexion '/'
  if (pathname === '/') {
    return <main className="min-h-[100dvh] w-full bg-[#EEE9DF]">{children}</main>
  }

  // T11 (12/11) : entreprise suspendue — la base refuse tout ; un seul écran,
  // le message et la déconnexion, au lieu de pages vides.
  if (entrepriseSuspendue) {
    return (
      <main className="min-h-[100dvh] w-full bg-[#EEE9DF] flex items-center justify-center p-4">
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm max-w-md w-full p-8 text-center flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-[#A35139]">Entreprise suspendue</h1>
          <p className="text-sm text-[#1B2632]/70">
            L&apos;accès au CRM est fermé pour votre entreprise. Contactez FGMED pour le rouvrir.
          </p>
          <button
            onClick={async () => { await supabase.auth.signOut(); router.replace('/') }}
            className="self-center px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D]">
            Se déconnecter
          </button>
        </div>
      </main>
    )
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
          {/* Entreprise regardée — super admin uniquement. Toujours visible :
              créer un agent dans la mauvaise entreprise sans s'en apercevoir
              est pénible à rattraper. */}
          {estSuperAdmin && entreprises.length > 0 ? (
            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-2xl border border-[#C9C1B1]/40 shadow-sm min-w-0">
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-[#A35139] shrink-0">
                Entreprise
              </span>
              <select
                value={tenantId || ''}
                onChange={(e) => setTenantChoisi(e.target.value)}
                title="Choisir l'entreprise que vous regardez"
                className="max-w-[130px] sm:max-w-none bg-transparent text-sm font-bold text-[#1B2632] outline-none cursor-pointer truncate"
              >
                {entreprises.map((t) => (
                  <option key={t.id} value={t.id}>{t.nom || t.nom_entreprise || 'Entreprise'}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="hidden md:block" />
          )}

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* L'entrepôt regardé (11/11) : filtre tous les écrans. Les entrepôts de
              l'entreprise regardée seulement ; pour un vendeur, les siens. */}
          {entrepots.length > 0 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl border shadow-sm min-w-0 ${entrepotId ? 'bg-[#1B2632] border-[#1B2632] text-white' : 'bg-white border-[#C9C1B1]/40'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${entrepotId ? 'text-[#FFB162]' : 'text-[#A35139]'}`}>
                <path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/><path d="M3 21h18"/>
              </svg>
              <select
                value={entrepotId || ''}
                onChange={(e) => setEntrepotId(e.target.value)}
                title="Filtrer tous les écrans sur un entrepôt"
                className={`max-w-[120px] sm:max-w-[220px] bg-transparent text-sm font-bold outline-none cursor-pointer truncate ${entrepotId ? 'text-white' : 'text-[#1B2632]'}`}
              >
                <option value="" className="text-[#1B2632]">Tous les entrepôts</option>
                {entrepots.map((e) => (
                  <option key={e.id} value={e.id} className="text-[#1B2632]">
                    {drapeau(e.pays_code) ? `${drapeau(e.pays_code)} ` : ''}{e.nom}{e.pays_nom && e.pays_nom !== e.nom ? ` (${e.pays_nom})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

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
          </div>
        </header>

        {/* Contenu de la page */}
        {/* px-0 sur téléphone : chaque page gère sa propre marge intérieure */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-0 sm:px-6 pb-6">
          {pageOuverte
            ? children
            : <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès…</div>}
        </main>
      </div>

    </div>
  )
}