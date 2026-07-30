'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'

export default function UtilisateursPage() {
  const [autorise, setAutorise] = useState(null)
  const [agents, setAgents] = useState([])
  const [livreurs, setLivreurs] = useState([])
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [role, setRole] = useState('agent')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const router = useRouter()

  async function chargerListes() {
    const { data: dataAgents } = await supabase.from('agents').select('id, nom, actif').order('nom')
    const { data: dataLivreurs } = await supabase.from('livreurs').select('id, nom, telephone, actif').order('nom')
    setAgents(dataAgents || [])
    setLivreurs(dataLivreurs || [])
  }

  useEffect(() => {
    async function initialiser() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (roleData?.role !== 'admin') {
        setAutorise(false)
        return
      }

      setAutorise(true)
      await chargerListes()
    }
    initialiser()
  }, [router])

  async function creerUtilisateur(e) {
    e.preventDefault()
    setEnvoiEnCours(true)

    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      'https://meeboyokamgwwbhxfclf.supabase.co/functions/v1/creer-utilisateur',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, mot_de_passe: motDePasse, nom, telephone, role }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    alert('Utilisateur créé avec succès')
    setEmail('')
    setMotDePasse('')
    setNom('')
    setTelephone('')
    await chargerListes()
  }

  if (autorise === null) {
    return <div className="p-8 text-[#1B2632] font-medium">Chargement...</div>
  }

  if (autorise === false) {
    return <div className="p-8 text-[#1B2632] font-medium">Accès réservé aux administrateurs.</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
      
      {/* En-tête */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Administration
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">
            Gestion des utilisateurs
          </h1>
        </div>
      </header>

      {/* Formulaire de création */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
        <h2 className="text-lg font-bold text-[#1B2632] mb-4">Créer un nouvel utilisateur</h2>

        <form onSubmit={creerUtilisateur} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#1B2632] mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1B2632] mb-2">Mot de passe</label>
              <input
                type="password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1B2632] mb-2">Nom</label>
              <input
                type="text"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1B2632] mb-2">Téléphone (si livreur)</label>
              <input
                type="text"
                value={telephone}
                onChange={(e) => setTelephone(e.target.value)}
                className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[#1B2632] mb-2">Rôle</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full border border-[#C9C1B1] rounded-xl px-4 py-3 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162]"
              >
                <option value="agent">Agent</option>
                <option value="livreur">Livreur</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={envoiEnCours}
              className="px-6 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-xl text-sm font-bold shadow-sm transition disabled:opacity-50"
            >
              {envoiEnCours ? 'Création...' : 'Créer l\'utilisateur'}
            </button>
          </div>
        </form>
      </div>

      {/* Listes des agents et livreurs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
          <h2 className="text-lg font-bold text-[#1B2632] mb-4">Agents ({agents.length})</h2>
          {agents.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-2">Aucun agent.</p>
          ) : (
            <ul className="text-sm divide-y divide-[#C9C1B1]/30">
              {agents.map((a) => (
                <li key={a.id} className="py-3 flex justify-between items-center text-[#1B2632]">
                  <span className="font-medium">{a.nom}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${a.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {a.actif ? 'Actif' : 'Inactif'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
          <h2 className="text-lg font-bold text-[#1B2632] mb-4">Livreurs ({livreurs.length})</h2>
          {livreurs.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-2">Aucun livreur.</p>
          ) : (
            <ul className="text-sm divide-y divide-[#C9C1B1]/30">
              {livreurs.map((l) => (
                <li key={l.id} className="py-3 flex justify-between items-center text-[#1B2632]">
                  <div>
                    <span className="font-medium block">{l.nom}</span>
                    <span className="font-mono text-xs text-[#1B2632]/60">{l.telephone || 'Pas de téléphone'}</span>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${l.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {l.actif ? 'Actif' : 'Inactif'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

    </div>
  )
}