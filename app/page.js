'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [chargement, setChargement] = useState(false)
  const router = useRouter()

  async function handleLogin(e) {
    e.preventDefault()
    setChargement(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert('Erreur de connexion : ' + error.message)
      setChargement(false)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle()

    const role = roleData?.role

    // 🚀 Redirection intelligente incluant le Super Admin
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
          <div>
            <label className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nom@fgmed.com"
              className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] transition"
              required
            />
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