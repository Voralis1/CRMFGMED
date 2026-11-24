'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'

// Erreurs de connexion en français clair (24/11). Supabase renvoie un texte
// anglais technique ; on le reconnaît, sinon un message générique — jamais
// le texte brut.
function messageConnexion(error) {
  const m = String(error?.message || '')
  if (/invalid login credentials|invalid.*(email|password)/i.test(m)) return 'E-mail ou mot de passe incorrect.'
  if (/email not confirmed/i.test(m)) return "Ce compte n'est pas encore activé. Contactez l'administrateur."
  if (/too many|rate limit/i.test(m) || error?.status === 429) return 'Trop de tentatives. Attendez quelques minutes puis réessayez.'
  if (/failed to fetch|network|load failed/i.test(m) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'Pas de connexion internet. Vérifiez votre réseau puis réessayez.'
  }
  return 'Connexion impossible pour le moment. Réessayez dans un instant.'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [chargement, setChargement] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  // Erreur affichée dans la carte (24/11) : avant, une fenêtre du navigateur
  // avec le texte brut de Supabase (« Invalid login credentials »).
  const [erreur, setErreur] = useState('')
  const [voirMdp, setVoirMdp] = useState(false)
  const router = useRouter()

  function redirectByRole(role) {
    if (role === 'super_admin' || role === 'SUPER_ADMIN') {
      router.push('/super-admin/tenants')
    } else if (role === 'admin') {
      router.push('/dashboard')
    } else if (role === 'agent') {
      router.push('/centre-appel')
    } else if (role === 'livreur') {
      router.push('/livraisons')
    } else {
      router.push('/dashboard')
    }
  }

  // 🔒 Guard : si une session existe déjà au chargement de la page,
  // on redirige directement au lieu d'afficher le formulaire de login.
  useEffect(() => {
    async function checkExistingSession() {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .maybeSingle()

        redirectByRole(roleData?.role)
      } else {
        setCheckingSession(false)
      }
    }

    checkExistingSession()
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setErreur('')
    setChargement(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setErreur(messageConnexion(error))
      setChargement(false)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle()

    // Entreprise suspendue (entreprise_suspendue.sql) : la base refuse toute
    // requête du navigateur. On ferme la session et on le dit, au lieu
    // d'envoyer la personne sur un tableau de bord vide.
    if (roleError && /suspendue/i.test(roleError.message || '')) {
      await supabase.auth.signOut()
      setErreur("Votre entreprise est suspendue. Contactez l'administrateur.")
      setChargement(false)
      return
    }

    redirectByRole(roleData?.role)
  }

  // Tant qu'on vérifie la session existante, on n'affiche rien (évite le flash du formulaire)
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#EEE9DF] flex items-center justify-center">
        <p className="text-sm text-[#1B2632]/60">Chargement...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#EEE9DF] flex flex-col items-center justify-center p-6 font-sans text-[#1B2632]">

      {/* Logo et Marque */}
      <div className="mb-8 flex flex-col items-center">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-sm bg-[#FFB162] inline-block"></span>
            <span className="w-1.5 h-1.5 rounded-sm bg-[#FFB162] inline-block"></span>
            <span className="w-1.5 h-1.5 rounded-sm bg-[#FFB162] inline-block"></span>
            <span className="w-1.5 h-1.5 rounded-sm bg-[#FFB162] inline-block"></span>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFB162] inline-block"></span>
        </div>
        <h1 className="text-xl font-bold tracking-wider text-[#1B2632]">
          CRM FGMED
        </h1>
      </div>

      {/* Carte de connexion */}
      <div className="w-full max-w-md bg-white border border-[#C9C1B1] rounded-3xl shadow-sm p-8 md:p-10">

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-[#1B2632] mb-1">Connexion</h2>
          <p className="text-sm text-[#1B2632]/60">Accédez à votre espace de travail</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          {erreur && (
            <div role="alert" className="px-4 py-3 rounded-xl text-sm font-medium border bg-[#A35139]/10 border-[#A35139]/30 text-[#A35139]">
              {erreur}
            </div>
          )}
          <div>
            <label htmlFor="email" className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErreur('') }}
              placeholder="nom@fgmed.com"
              className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] transition"
              required
            />
          </div>

          <div>
            <label htmlFor="mot-de-passe" className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">
              Mot de passe
            </label>
            <div className="relative">
              <input
                id="mot-de-passe"
                name="password"
                type={voirMdp ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErreur('') }}
                placeholder="••••••••"
                className="w-full border border-[#C9C1B1] rounded-xl pl-4 pr-11 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] transition"
                required
              />
              <button type="button" onClick={() => setVoirMdp((v) => !v)} title={voirMdp ? 'Masquer' : 'Afficher'}
                aria-label={voirMdp ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B2632]/45 hover:text-[#1B2632] cursor-pointer">
                {voirMdp ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={chargement}
            className="w-full mt-2 py-3.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-xl text-sm font-bold shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            {chargement ? 'Connexion en cours...' : 'Se connecter'}
          </button>
        </form>

      </div>

      {/* Pied de page */}
      <footer className="mt-8 text-xs text-[#1B2632]/40 font-medium">
        Centre Logistique & Opérationnel FGMED
      </footer>

    </div>
  )
}