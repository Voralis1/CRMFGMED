'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  useEffect(() => {
    async function chargerProfil() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      // Récupérer le rôle
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle()

      // Récupérer les infos de l'agent si existant
      const { data: agentData } = await supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      setProfile({
        first_name: agentData?.nom || agentData?.first_name || '',
        last_name: agentData?.prenom || agentData?.last_name || '',
        username: agentData?.username || session.user.email?.split('@')[0] || '',
        phone: agentData?.telephone || agentData?.phone || '',
        email: session.user.email || '',
        role: roleData?.role || 'Utilisateur',
        bank_number: agentData?.bank_number || '',
        bank_name: agentData?.bank_name || ''
      })

      setLoading(false)
    }

    chargerProfil()
  }, [router])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) return

    const { error } = await supabase
      .from('agents')
      .update({
        nom: profile.first_name,
        telephone: profile.phone,
        bank_number: profile.bank_number,
        bank_name: profile.bank_name
      })
      .eq('user_id', session.user.id)

    setSaving(false)
    if (error) {
      setMessage({ texte: 'Erreur lors de la mise à jour du profil.', type: 'erreur' })
    } else {
      setMessage({ texte: 'Profil mis à jour avec succès !', type: 'succes' })
    }
    setTimeout(() => setMessage({ texte: '', type: '' }), 4000)
  }

  if (loading) {
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

      <div className="fg-card">
        <form onSubmit={handleSave} className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div>
              <label className="fg-label">FIRST NAME</label>
              <div className="fg-input-wrapper">
                <span className="fg-icon">👤</span>
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
                <span className="fg-icon">👤</span>
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
                <span className="fg-icon">👤</span>
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
                <span className="fg-icon">📞</span>
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
                <span className="fg-icon">✉️</span>
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
                <span className="fg-icon">🔒</span>
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
                <span className="fg-icon">💳</span>
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
                <span className="fg-icon">🏦</span>
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

          <div className="flex justify-center mt-6">
            <button 
              type="submit" 
              disabled={saving}
              className="fg-btn-save"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StyleProfile() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
      .fg-root{--abyssal:#1B2632;--blue:#2C3B4D;--palladian:#EEE9DF;--oatmeal:#C9C1B1;--truffle:#A35139;background:var(--palladian);min-height:100vh;padding:28px;font-family:'Inter',system-ui,sans-serif;color:var(--abyssal);}
      .fg-root *{box-sizing:border-box;}
      .fg-head{margin-bottom:30px;}
      .fg-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--truffle);margin:0 0 6px;}
      .fg-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.01em;margin:0;}
      .fg-card{background:#fff;border:1px solid var(--oatmeal);border-radius:16px;padding:32px;box-shadow:0 1px 2px rgba(27,38,50,.04);max-width:1100px;margin:0 auto;}
      .fg-label{display:block;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--abyssal);margin-bottom:8px;}
      .fg-input-wrapper{display:flex;align-items:center;border:1px solid var(--oatmeal);border-radius:10px;background:#fff;padding:0 14px;transition:0.2s;}
      .fg-input-wrapper:focus-within{border-color:var(--abyssal);box-shadow:0 0 0 2px rgba(27,38,50,0.05);}
      .fg-icon{margin-right:10px;font-size:14px;color:#9a9384;}
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