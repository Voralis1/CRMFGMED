'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

export default function ProfilePage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { roleNom, loading: permsLoading } = usePermissions()
  const router = useRouter()
  
  const [loading, setLoading] = useState(true)
  
  // 🚀 États de sauvegarde séparés pour les deux formulaires
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  
  const [message, setMessage] = useState({ texte: '', type: '' })

  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    username: '',
    phone: '',
    email: '',
    role: '',
    bank_number: '',
    bank_name: ''
  })

  // États pour le mot de passe
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // 🚀 NOUVEAU : États pour afficher/masquer les mots de passe
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Gérer le format du tenantId (au cas où ce soit un objet)
  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    async function chargerProfil() {
      if (!user || !tenantKey) return

      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantKey)
        .maybeSingle()

      setProfile({
        first_name: agentData?.nom || agentData?.first_name || '',
        last_name: agentData?.prenom || agentData?.last_name || '',
        username: agentData?.username || user.email?.split('@')[0] || '',
        phone: agentData?.telephone || agentData?.phone || '',
        email: user.email || '',
        role: roleNom || 'Utilisateur',
        bank_number: agentData?.bank_number || '',
        bank_name: agentData?.bank_name || ''
      })

      setLoading(false)
    }

    if (user && tenantKey && !permsLoading) {
      chargerProfil()
    }
  }, [user, tenantKey, permsLoading, roleNom])


  // =====================================================================
  // 1. SAUVEGARDE DU PROFIL UNIQUEMENT
  // =====================================================================
  async function handleSaveProfile(e) {
    e.preventDefault()
    if (!user || !tenantKey) return
    
    setSavingProfile(true)
    setMessage({ texte: '', type: '' })

    const { data, error: profileError } = await supabase
      .from('agents')
      .update({
        nom: profile.first_name,
        prenom: profile.last_name,
        telephone: profile.phone,
        bank_number: profile.bank_number,
        bank_name: profile.bank_name
      })
      .eq('user_id', user.id)
      .eq('tenant_id', tenantKey)
      .select() 

    setSavingProfile(false)

    if (profileError) {
      console.error("Erreur de mise à jour:", profileError)
      setMessage({ texte: 'Erreur technique lors de la mise à jour.', type: 'erreur' })
    } else if (!data || data.length === 0) {
      console.warn("0 ligne mise à jour. Blocage RLS probable.")
      setMessage({ texte: 'Modification non autorisée (Bloquée par RLS).', type: 'erreur' })
    } else {
      setMessage({ texte: 'Profil mis à jour avec succès !', type: 'succes' })
    }
    
    setTimeout(() => setMessage({ texte: '', type: '' }), 5000)
  }


  // =====================================================================
  // 2. CHANGEMENT DU MOT DE PASSE UNIQUEMENT
  // =====================================================================
  async function handleUpdatePassword(e) {
    e.preventDefault()
    if (!user) return

    setSavingPassword(true)
    setMessage({ texte: '', type: '' })

    const pass1 = newPassword
    const pass2 = confirmPassword

    if (pass1 !== pass2) {
      setMessage({ texte: 'Les mots de passe ne correspondent pas.', type: 'erreur' })
      setSavingPassword(false)
      return
    }
    if (pass1.length < 6) {
      setMessage({ texte: 'Le mot de passe doit contenir au moins 6 caractères.', type: 'erreur' })
      setSavingPassword(false)
      return
    }

    const { error: authError } = await supabase.auth.updateUser({
      password: pass1
    })

    setSavingPassword(false)

    if (authError) {
      setMessage({ texte: 'Erreur mot de passe : ' + authError.message, type: 'erreur' })
    } else {
      setMessage({ texte: 'Mot de passe modifié avec succès !', type: 'succes' })
      setNewPassword('')
      setConfirmPassword('')
    }
    
    setTimeout(() => setMessage({ texte: '', type: '' }), 5000)
  }


  if (authLoading || permsLoading || loading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement du profil...</div>
  }

  return (
    <div className="fg-root">
      <StyleProfile />

      <header className="fg-head">
        <div>
          <p className="fg-eyebrow">Mon Compte</p>
          <h1 className="fg-title">Profile</h1>
        </div>
      </header>

      {message.texte && (
        <div className={`fg-alerte ${message.type}`}>{message.texte}</div>
      )}

      <div className="flex flex-col gap-6 max-w-[1100px] mx-auto">
        
        {/* ================================================== */}
        {/* FORMULAIRE 1 : INFORMATIONS PERSONNELLES           */}
        {/* ================================================== */}
        <div className="fg-card">
          <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
            <div className="border-b border-[#C9C1B1]/50 pb-6 mb-2">
              <h2 className="text-lg font-bold text-[#1B2632] mb-4">Informations Personnelles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div>
                  <label className="fg-label">FIRST NAME</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </span>
                    <input 
                      type="text" 
                      value={profile.first_name}
                      onChange={(e) => setProfile({...profile, first_name: e.target.value})}
                      className="fg-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">LAST NAME</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </span>
                    <input 
                      type="text" 
                      value={profile.last_name}
                      onChange={(e) => setProfile({...profile, last_name: e.target.value})}
                      className="fg-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">USERNAME</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </span>
                    <input 
                      type="text" 
                      value={profile.username}
                      disabled
                      className="fg-input disabled"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">PHONE</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    </span>
                    <input 
                      type="text" 
                      value={profile.phone}
                      onChange={(e) => setProfile({...profile, phone: e.target.value})}
                      className="fg-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">EMAIL</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    </span>
                    <input 
                      type="email" 
                      value={profile.email}
                      disabled
                      className="fg-input disabled"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">ROLE</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </span>
                    <input 
                      type="text" 
                      value={profile.role}
                      disabled
                      className="fg-input disabled uppercase font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">BANK NUMBER (RIB)</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                    </span>
                    <input 
                      type="text" 
                      placeholder="The bank RIB should contain 24 digits"
                      value={profile.bank_number}
                      onChange={(e) => setProfile({...profile, bank_number: e.target.value})}
                      className="fg-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="fg-label">BANK NAME</label>
                  <div className="fg-input-wrapper">
                    <span className="fg-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"></path></svg>
                    </span>
                    <input 
                      type="text" 
                      placeholder="Bank name"
                      value={profile.bank_name}
                      onChange={(e) => setProfile({...profile, bank_name: e.target.value})}
                      className="fg-input"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-2">
              <button 
                type="submit" 
                disabled={savingProfile}
                className="fg-btn-save cursor-pointer disabled:opacity-50"
              >
                {savingProfile ? 'Sauvegarde...' : 'Mettre à jour le profil'}
              </button>
            </div>
          </form>
        </div>

        {/* ================================================== */}
        {/* FORMULAIRE 2 : SÉCURITÉ ET MOT DE PASSE            */}
        {/* ================================================== */}
        <div className="fg-card">
          <form onSubmit={handleUpdatePassword} className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-bold text-[#1B2632] mb-1">Sécurité & Mot de passe</h2>
              <p className="text-xs text-[#1B2632]/60 mb-4">Mettez à jour vos identifiants de connexion ici.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#EEE9DF]/30 p-6 rounded-xl border border-[#C9C1B1]/50">
              
              <div>
                <label className="fg-label">NEW PASSWORD</label>
                <div className="fg-input-wrapper">
                  <span className="fg-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  </span>
                  <input 
                    type={showNewPassword ? "text" : "password"} 
                    placeholder="Min. 6 caractères"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="fg-input"
                    autoComplete="new-password"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="ml-2 text-[#9a9384] hover:text-[#1B2632] transition-colors focus:outline-none cursor-pointer"
                  >
                    {showNewPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="fg-label">CONFIRM NEW PASSWORD</label>
                <div className="fg-input-wrapper">
                  <span className="fg-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                  </span>
                  <input 
                    type={showConfirmPassword ? "text" : "password"} 
                    placeholder="Confirmer le mot de passe"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="fg-input"
                    autoComplete="new-password"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="ml-2 text-[#9a9384] hover:text-[#1B2632] transition-colors focus:outline-none cursor-pointer"
                  >
                    {showConfirmPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    )}
                  </button>
                </div>
              </div>

            </div>
            
            <div className="flex justify-end mt-2">
              <button 
                type="submit" 
                disabled={savingPassword || (!newPassword && !confirmPassword)} 
                className="px-6 py-3 bg-[#A35139] text-white rounded-xl font-bold text-sm hover:bg-[#8a422d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPassword ? 'Modification...' : 'Modifier le mot de passe'}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}

function StyleProfile() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      .fg-root{--abyssal:#1B2632;--blue:#2C3B4D;--palladian:#EEE9DF;--oatmeal:#C9C1B1;--truffle:#A35139;background:var(--palladian);min-height:100vh;padding:28px;font-family:'Inter',system-ui,sans-serif;color:var(--abyssal);padding-top:80px;}
      .fg-root *{box-sizing:border-box;}
      .fg-head{margin-bottom:30px;max-width:1100px;margin-left:auto;margin-right:auto;}
      .fg-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--truffle);margin:0 0 6px;}
      .fg-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;}
      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:32px;box-shadow:0 1px 2px rgba(27,38,50,.04);width:100%;}
      .fg-label{display:block;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--abyssal);margin-bottom:8px;}
      .fg-input-wrapper{display:flex;align-items:center;border:1px solid var(--oatmeal);border-radius:10px;background:#fff;padding:0 14px;transition:0.2s;}
      .fg-input-wrapper:focus-within{border-color:var(--abyssal);box-shadow:0 0 0 2px rgba(27,38,50,0.05);}
      .fg-icon{margin-right:10px;display:flex;align-items:center;color:#9a9384;}
      .fg-input{width:100%;border:none;outline:none;padding:12px 0;font-size:14px;font-family:'Inter';background:transparent;color:var(--abyssal);}
      .fg-input.disabled{color:#9a9384;cursor:not-allowed;}
      .fg-btn-save{background:var(--abyssal);color:#fff;border:none;padding:12px 60px;border-radius:12px;font-weight:600;font-size:15px;cursor:pointer;transition:0.2s;box-shadow:0 4px 12px rgba(27,38,50,0.15);}
      .fg-btn-save:hover{background:var(--blue);}
      .fg-alerte{padding:12px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;font-weight:500;max-width:1100px;margin-left:auto;margin-right:auto;}
      .fg-alerte.succes{background:#d4edda;color:#155724;border:1px solid #c3e6cb;}
      .fg-alerte.erreur{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;}
    `}</style>
  )
}