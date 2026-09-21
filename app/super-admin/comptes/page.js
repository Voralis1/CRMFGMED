'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'

export default function SuperAdminComptes() {
  const { user, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()
  
  const [comptes, setComptes] = useState([])
  const [tenants, setTenants] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  
  const [formData, setFormData] = useState({
    email: '', mot_de_passe: '', tenant_id: '', role_id: '', nom: ''
  })
  
  const [selectedUser, setSelectedUser] = useState(null)
  
  // Redirection sécurisée via la matrice de permissions
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_comptes_acces')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])
  
  const chargerDonnees = async () => {
    setLoading(true)

    const { data: tenantsData } = await supabase.from('tenants').select('*')
    if (tenantsData) setTenants(tenantsData)
  
    const { data: rolesData } = await supabase.from('roles').select('*')
    if (rolesData) setRoles(rolesData)
  
    const { data: userRolesData, error } = await supabase
      .from('user_roles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error("Erreur chargement des comptes :", error)
    } else if (userRolesData) {
      setComptes(userRolesData)
    }

    setLoading(false)
  }
  
  useEffect(() => {
    if (user && hasPermission('menu_comptes_acces')) {
      chargerDonnees()
    }
  }, [user, hasPermission])
  
  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value })
  const handleEditChange = (e) => setSelectedUser({ ...selectedUser, [e.target.name]: e.target.value })
  
  const handleOpenEdit = (userItem) => {
    setSelectedUser({ ...userItem, nouveau_mdp: '' })
    setIsEditModalOpen(true)
    setMessage({ text: '', type: '' })
  }

  // ------------------------------------------------------------
  // Petit utilitaire : va chercher le VRAI message d'erreur renvoyé
  // par une Edge Function, au lieu du message générique
  // "Edge Function returned a non-2xx status code" que supabase-js
  // affiche par défaut. Le détail utile est dans error.context
  // (la Response brute), presque jamais lu par erreur.
  // ------------------------------------------------------------
  async function extraireMessageErreurFonction(error, fallback) {
    if (!error) return fallback
    try {
      const corps = await error.context.json()
      return corps?.error || corps?.message || error.message || fallback
    } catch {
      return error.message || fallback
    }
  }
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })
  
    try {
      const { data, error } = await supabase.functions.invoke('creer-utilisateur', { body: formData })

      if (error) {
        const messageReel = await extraireMessageErreurFonction(error, "Erreur de création.")
        throw new Error(messageReel)
      }
      if (data?.error) throw new Error(data.error)
  
      setMessage({ text: 'Compte créé avec succès !', type: 'success' })
      setFormData({ email: '', mot_de_passe: '', nom: '', tenant_id: '', role_id: '' })
      await chargerDonnees()

      setTimeout(() => { setIsModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    } catch (error) {
      // Ce console.error affiche maintenant le VRAI message, plus la version tronquée
      console.error("Détail réel de l'erreur de création :", error.message)
      setMessage({ text: error.message || "Erreur de création.", type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }
  
  const handleUpdateUser = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })
  
    try {
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({
          role_id: selectedUser.role_id,
          tenant_id: selectedUser.tenant_id === "" ? null : selectedUser.tenant_id,
          email: selectedUser.email,
          nom: selectedUser.nom
        })
        .eq('user_id', selectedUser.user_id)
  
      if (roleError) throw roleError

      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/modifier-utilisateur`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          email: selectedUser.email,
          nom: selectedUser.nom,
          nouveau_mdp: selectedUser.nouveau_mdp || undefined
        })
      })

      const updateData = await response.json()
      if (!response.ok) throw new Error(updateData.error || updateData.message || "Erreur lors de la mise à jour.")
  
      setMessage({ text: 'Compte mis à jour avec succès !', type: 'success' })
      await chargerDonnees()
  
      setTimeout(() => { setIsEditModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    } catch (error) {
      console.error("Détails de l'erreur :", error.message)
      setMessage({ text: error.message || "Erreur lors de la mise à jour.", type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer définitivement ce compte ? Cette action est irréversible.")) {
      return
    }

    setSubmitting(true)
    setMessage({ text: '', type: '' })

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/supprimer-utilisateur`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ user_id: userId })
        }
      )

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || result.message || "Erreur lors de la suppression.")

      alert("Compte supprimé avec succès.")
      await chargerDonnees()
    } catch (error) {
      console.error("Erreur suppression :", error.message)
      alert(error.message || "Erreur lors de la suppression.")
    } finally {
      setSubmitting(false)
    }
  }
  
  const getRoleName = (id) => roles.find(r => r.id === id)?.nom || 'N/A'
  const getTenantName = (id) => tenants.find(t => t.id === id)?.nom || tenants.find(t => t.id === id)?.nom_entreprise || 'Global'
  
  if (authLoading || permsLoading || !hasPermission('menu_comptes_acces')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }
  
  return (
    <div className="space-y-6 pt-16 px-6 pb-10 max-w-[1400px] mx-auto">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-[#C9C1B1]/40">
        <div>
          <h2 className="text-2xl font-bold text-[#1B2632]">Comptes & Accès</h2>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-[#1B2632] hover:bg-[#2C3E50] text-white px-5 py-2.5 rounded-xl font-medium cursor-pointer transition-colors">
          + Nouveau Compte
        </button>
      </div>
  
      <div className="bg-white rounded-2xl shadow-sm border border-[#C9C1B1]/40 p-6">
        {loading ? <div className="text-center py-10">Chargement...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase">
                  <th className="py-3 px-4">Utilisateur / Nom & Email</th>
                  <th className="py-3 px-4">Rôle</th>
                  <th className="py-3 px-4">Entreprise</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {comptes.map((c, index) => (
                  <tr key={c.id || c.user_id || index} className="hover:bg-gray-50/50">
                    <td className="py-4 px-4">
                      <div className="font-bold text-[#1B2632]">{c.nom || 'Sans nom'}</div>
                      <div className="font-medium text-xs text-gray-600 mt-0.5">{c.email || 'Email non renseigné'}</div>
                      <div className="font-mono text-[11px] text-gray-400 mt-0.5">{c.user_id}</div>
                    </td>
                    <td className="py-4 px-4"><span className="px-3 py-1 bg-[#1B2632]/5 text-[#1B2632] font-semibold rounded-lg text-xs uppercase">{getRoleName(c.role_id)}</span></td>
                    <td className="py-4 px-4 font-medium text-[#1B2632]">{getTenantName(c.tenant_id)}</td>
                    <td className="py-4 px-4 text-right space-x-2">
                      <button onClick={() => handleOpenEdit(c)} className="bg-[#1B2632]/10 hover:bg-[#1B2632] hover:text-white text-[#1B2632] px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
                        Modifier
                      </button>
                      <button onClick={() => handleDeleteUser(c.user_id)} className="bg-[#A35139]/10 hover:bg-[#A35139] hover:text-white text-[#A35139] px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl border border-[#C9C1B1]/40">
            <h3 className="text-xl font-bold mb-4 text-[#1B2632]">Ajouter un compte</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {message.text && (
                <div className={`p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {message.text}
                </div>
              )}

              <input type="text" name="nom" required placeholder="Nom / Prénom" value={formData.nom} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" />
              <input type="email" name="email" required placeholder="Email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" />
              <input type="password" name="mot_de_passe" required placeholder="Mot de passe" value={formData.mot_de_passe} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" />
              <select name="tenant_id" required value={formData.tenant_id} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                <option value="">Sélectionner une entreprise</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.nom || t.nom_entreprise}</option>)}
              </select>
              <select name="role_id" required value={formData.role_id} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                <option value="">Sélectionner un rôle</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nom.toUpperCase()}</option>)}
              </select>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold text-[#1B2632] cursor-pointer transition-colors">Annuler</button>
                <button type="submit" disabled={submitting} className="flex-1 py-2.5 bg-[#1B2632] hover:bg-[#2C3E50] text-white rounded-xl text-sm font-semibold cursor-pointer transition-colors">
                  {submitting ? 'Création...' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
  
      {isEditModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-[#C9C1B1]/40">

            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-[#1B2632]">Modifier le profil</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-[#1B2632] text-xl font-bold cursor-pointer">×</button>
            </div>
  
            <form onSubmit={handleUpdateUser} className="space-y-4">
              {message.text && (
                <div className={`p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {message.text}
                </div>
              )}
  
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Nom / Prénom</label>
                <input 
                  type="text" 
                  name="nom" 
                  value={selectedUser.nom || ''} 
                  onChange={handleEditChange} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Email</label>
                <input 
                  type="email" 
                  name="email" 
                  required 
                  value={selectedUser.email || ''} 
                  onChange={handleEditChange} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Nouveau mot de passe (optionnel)</label>
                <input 
                  type="password" 
                  name="nouveau_mdp" 
                  placeholder="Laisser vide pour ne pas changer" 
                  value={selectedUser.nouveau_mdp || ''} 
                  onChange={handleEditChange} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Rôle Principal</label>
                <select name="role_id" value={selectedUser.role_id} onChange={handleEditChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                  {roles.map(r => <option key={r.id} value={r.id}>{r.nom.toUpperCase()}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Entreprise</label>
                <select name="tenant_id" value={selectedUser.tenant_id || ''} onChange={handleEditChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                  <option value="">Global / Aucun</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.nom || t.nom_entreprise}</option>)}
                </select>
              </div>

              <div className="pt-4 flex gap-3 border-t border-gray-100 mt-6">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-[#1B2632] text-sm font-semibold rounded-xl cursor-pointer transition-colors">Annuler</button>
                <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1B2632] hover:bg-[#2C3E50] text-white text-sm font-semibold rounded-xl cursor-pointer transition-colors">
                  {submitting ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}