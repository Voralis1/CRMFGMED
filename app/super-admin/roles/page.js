'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext' // 👈 Import de l'auth de base
import { usePermissions } from '../../context/PermissionsContext' // 🚀 Import des permissions dynamiques

export default function SuperAdminRoles() {
  const { user, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  
  // États pour les modales
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  // États pour la gestion des données
  const [selectedRole, setSelectedRole] = useState(null)
  const [rolePerms, setRolePerms] = useState([]) 
  const [newRoleData, setNewRoleData] = useState({ nom: '', description: '' })

  // 🚀 REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_gestion_roles')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const chargerDonnees = async () => {
    setLoading(true)
    const { data: rolesData } = await supabase.from('roles').select('*').order('nom')
    if (rolesData) setRoles(rolesData)

    const { data: permsData } = await supabase.from('permissions').select('*')
    if (permsData) setPermissions(permsData)
    setLoading(false)
  }

  useEffect(() => {
    if (user && hasPermission('menu_gestion_roles')) {
      chargerDonnees()
    }
  }, [user, hasPermission])

  // --- CRÉER UN NOUVEAU RÔLE ---
  const handleCreateRole = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })

    try {
      // Insertion dans la table 'roles'
      const { error } = await supabase.from('roles').insert([
        { 
          nom: newRoleData.nom.toUpperCase(), 
          description: newRoleData.description 
        }
      ])
      
      if (error) throw error

      setMessage({ text: 'Nouveau rôle créé avec succès !', type: 'success' })
      setNewRoleData({ nom: '', description: '' })
      await chargerDonnees()
      
      setTimeout(() => { setIsCreateModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    } catch (error) {
      console.error("Erreur création rôle :", JSON.stringify(error, null, 2))
      setMessage({ text: "Erreur lors de la création.", type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  // --- OUVRIR LA MODALE D'ÉDITION DES PERMISSIONS ---
  const handleOpenEdit = async (role) => {
    setSelectedRole(role)
    setRolePerms([]) 
    setIsEditModalOpen(true)
    setMessage({ text: '', type: '' })

    const { data } = await supabase
      .from('role_permissions')
      .select('permission_code')
      .eq('role_id', role.id) 

    if (data) {
      setRolePerms(data.map(p => p.permission_code))
    }
  }

  // --- GÉRER LES CHECKBOXES ---
  const togglePermission = (permCode) => {
    if (rolePerms.includes(permCode)) {
      setRolePerms(rolePerms.filter(code => code !== permCode))
    } else {
      setRolePerms([...rolePerms, permCode])
    }
  }

  // --- SAUVEGARDER LES PERMISSIONS DU RÔLE ---
  const handleUpdateRolePermissions = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })

    try {
      await supabase.from('role_permissions').delete().eq('role_id', selectedRole.id)
      
      if (rolePerms.length > 0) {
        const permsToInsert = rolePerms.map(permCode => ({
          role_id: selectedRole.id,
          permission_code: permCode
        }))
        const { error: permError } = await supabase.from('role_permissions').insert(permsToInsert)
        if (permError) throw permError
      }

      setMessage({ text: 'Permissions mises à jour !', type: 'success' })
      setTimeout(() => { setIsEditModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    } catch (error) {
      console.error("Erreur mise à jour perms :", JSON.stringify(error, null, 2))
      setMessage({ text: "Erreur lors de la mise à jour.", type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  // 🚀 Écran de chargement et de vérification sécurisée
  if (authLoading || permsLoading || !hasPermission('menu_gestion_roles')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="space-y-6 pt-16 px-6 pb-10 max-w-[1400px] mx-auto">
      {/* En-tête */}
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-[#C9C1B1]/40">
        <div>
          <h2 className="text-2xl font-bold text-[#1B2632]">Gestion des Rôles & Permissions</h2>
          <p className="text-sm text-gray-500 mt-1">Gérez vos rôles et leurs droits d'accès.</p>
        </div>
        <button 
          onClick={() => { setIsCreateModalOpen(true); setMessage({ text: '', type: '' }) }} 
          className="bg-[#1B2632] hover:bg-[#2C3E50] text-white px-5 py-2.5 rounded-xl font-medium cursor-pointer transition-colors"
        >
          + Nouveau Rôle
        </button>
      </div>

      {/* Liste des Rôles */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#C9C1B1]/40 p-6">
        {loading ? <div className="text-center py-10">Chargement...</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((role) => (
              <div key={role.id} className="p-5 border border-gray-100 rounded-xl hover:shadow-md transition-shadow bg-gray-50/50 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#1B2632] uppercase">{role.nom}</h3>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{role.description || 'Aucune description'}</p>
                </div>
                <button 
                  onClick={() => handleOpenEdit(role)} 
                  className="mt-6 bg-[#1B2632]/10 hover:bg-[#1B2632] hover:text-white text-[#1B2632] px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                >
                  Gérer les permissions
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODALE : Création d'un Nouveau Rôle */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-[#1B2632]">Ajouter un Rôle</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-red-500 text-2xl leading-none cursor-pointer">&times;</button>
            </div>

            <form onSubmit={handleCreateRole} className="space-y-4">
              {message.text && <div className={`p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{message.text}</div>}

              <div>
                <label className="block text-sm font-semibold mb-1">Nom du rôle <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required 
                  placeholder="ex: MANAGER" 
                  value={newRoleData.nom} 
                  onChange={(e) => setNewRoleData({ ...newRoleData, nom: e.target.value })} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1B2632] outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-1">Description (Optionnel)</label>
                <textarea 
                  placeholder="Ce rôle permet de..." 
                  value={newRoleData.description} 
                  onChange={(e) => setNewRoleData({ ...newRoleData, description: e.target.value })} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1B2632] outline-none min-h-[100px]"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 font-semibold rounded-xl transition-colors cursor-pointer">Annuler</button>
                <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1B2632] text-white font-semibold rounded-xl transition-colors cursor-pointer">
                  {submitting ? 'Création...' : 'Créer le rôle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE : Gérer les Permissions du Rôle */}
      {isEditModalOpen && selectedRole && (
        <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
              <h3 className="text-xl font-bold text-[#1B2632]">
                Permissions : <span className="text-[#C9C1B1]">{selectedRole.nom.toUpperCase()}</span>
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-red-500 text-2xl leading-none cursor-pointer">&times;</button>
            </div>

            <form onSubmit={handleUpdateRolePermissions} className="flex flex-col flex-1 overflow-hidden">
              {message.text && <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{message.text}</div>}

              <div className="flex-1 overflow-y-auto pr-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
                  {permissions.map((perm) => (
                    <label key={perm.code} className="flex items-start gap-3 p-3 border border-gray-100 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={rolePerms.includes(perm.code)}
                        onChange={() => togglePermission(perm.code)}
                        className="mt-1 w-4 h-4 text-[#1B2632] rounded border-gray-300 focus:ring-[#1B2632]"
                      />
                      <div>
                        <div className="text-sm font-bold text-[#1B2632]">{perm.nom}</div>
                        <div className="text-xs font-mono text-gray-400 mt-0.5">{perm.code}</div>
                        {perm.description && <div className="text-xs text-gray-500 mt-1">{perm.description}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-6 mt-2 border-t border-gray-100">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 font-semibold rounded-xl transition-colors cursor-pointer">Annuler</button>
                <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1B2632] hover:bg-[#2C3E50] text-white font-semibold rounded-xl transition-colors cursor-pointer">
                  {submitting ? 'Enregistrement...' : 'Enregistrer les permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}