'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'
import { useMessages } from '../../components/Messages'
import { messageErreur } from '../../../lib/messageErreur.mjs'
import { useLangue } from '../../context/LangueContext'

// Les permissions rangées par module (23/11) : la base les classe déjà en
// 9 modules ; « general » et « Général » sont le même.
const ORDRE_MODULES = ['Général', "Centre d'appel", 'Logistique', 'Stock', 'Finance', 'Vendeur externe', 'Administration', 'Super Admin']
const nomModule = (m) => (!m || /^g[ée]n[ée]ral$/i.test(m) ? 'Général' : m)

// « manager » → « Manager », « super_admin » → « Super admin ».
const libelleRole = (nom) => String(nom || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())

export default function SuperAdminRoles() {
  const { user, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()
  // Messages du CRM (24/11) au lieu des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages()
  // Les textes suivent la langue choisie (25/11).
  const { t } = useLangue()
  // Nom et description d'une permission (25/11) : en anglais par son code
  // (lib/langues/en.mjs, perm.<code>) ; en français, le texte de la base.
  const parCle = (cle, repli) => { const v = t(cle); return v === cle ? repli : v }
  const nomPerm = (p) => parCle('perm.' + p.code, p.nom)
  const descPerm = (p) => parCle('permd.' + p.code, p.description || '')

  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  const [selectedRole, setSelectedRole] = useState(null)
  const [rolePerms, setRolePerms] = useState([]) 
  const [newRoleData, setNewRoleData] = useState({ nom: '', description: '' })

  // État pour désactiver le bouton t('rol.supprimer') du rôle en cours de suppression
  const [suppressionEnCours, setSuppressionEnCours] = useState(null) // id du rôle, ou null
  // Sur chaque carte (23/11) : combien de permissions, combien de comptes.
  const [nbPerms, setNbPerms] = useState({})
  const [nbComptes, setNbComptes] = useState({})
  const [recherchePerm, setRecherchePerm] = useState('')

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

    const [{ data: liens }, { data: comptesRoles }] = await Promise.all([
      supabase.from('role_permissions').select('role_id'),
      supabase.from('user_roles').select('role_id'),
    ])
    const compter = (lignes) => (lignes || []).reduce((acc, l) => { if (l.role_id) acc[l.role_id] = (acc[l.role_id] || 0) + 1; return acc }, {})
    setNbPerms(compter(liens))
    setNbComptes(compter(comptesRoles))
    setLoading(false)
  }

  useEffect(() => {
    if (user && hasPermission('menu_gestion_roles')) {
      chargerDonnees()
    }
  }, [user, hasPermission])

  const handleCreateRole = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })

    try {
      const { error } = await supabase.from('roles').insert([
        { 
          nom: newRoleData.nom.toUpperCase(), 
          description: newRoleData.description 
        }
      ])
      
      if (error) throw error

      setMessage({ text: t('rol.cree'), type: 'success' })
      setNewRoleData({ nom: '', description: '' })
      await chargerDonnees()
      
      setTimeout(() => { setIsCreateModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    } catch (error) {
      console.error("Erreur création rôle :", JSON.stringify(error, null, 2))
      setMessage({ text: t('rol.erreurCreation'), type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

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

  const togglePermission = (permCode) => {
    if (rolePerms.includes(permCode)) {
      setRolePerms(rolePerms.filter(code => code !== permCode))
    } else {
      setRolePerms([...rolePerms, permCode])
    }
  }

  const handleUpdateRolePermissions = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setMessage({ text: '', type: '' })

    // UN appel = une transaction (roles_permissions_garde.sql, 03/11). Avant, la page
    // supprimait toutes les lignes du rôle PUIS insérait la liste : un insert raté
    // laissait le rôle sans aucune permission (super_admin compris, qui perdait
    // menu_gestion_roles et ne pouvait plus rouvrir cet écran).
    // La base refuse une liste vide, un code inconnu, et un super_admin incomplet ;
    // son message s'affiche tel quel.
    const { error } = await supabase.rpc('remplacer_permissions_role', {
      p_role: selectedRole.id,
      p_codes: rolePerms,
    })
    if (error) {
      console.error("Erreur mise à jour perms :", JSON.stringify(error, null, 2))
      setMessage({ text: messageErreur(error, t('rol.erreurMaj')), type: 'error' })
    } else {
      setMessage({ text: t('rol.majOk'), type: 'success' })
      setNbPerms((n) => ({ ...n, [selectedRole.id]: rolePerms.length }))
      setTimeout(() => { setIsEditModalOpen(false); setMessage({ text: '', type: '' }) }, 1500)
    }
    setSubmitting(false)
  }

  // --- SUPPRIMER UN RÔLE ---
  // UNE requête : ses permissions partent avec lui (cascade) ou rien ne part.
  // La base refuse un rôle système (le code les lit par leur nom) et un rôle qu'un
  // compte porte encore — sans ce refus, user_roles.role_id passait à NULL et ces
  // comptes perdaient toutes leurs permissions sans un mot (ON DELETE SET NULL).
  const handleDeleteRole = async (role) => {
    const confirmation = await confirmer({
      titre: t('rol.supprimerTitre'),
      message: t('rol.supprimerMsg', { nom: libelleRole(role.nom) }),
      bouton: t('rol.supprimer'), danger: true,
    })
    if (!confirmation) return

    setSuppressionEnCours(role.id)
    const { error } = await supabase.from('roles').delete().eq('id', role.id)
    if (error) {
      console.error("Erreur suppression rôle :", JSON.stringify(error, null, 2))
      annoncer(messageErreur(error, t('rol.erreurSuppression')), 'erreur')
    } else {
      setRoles(roles.filter((r) => r.id !== role.id))
      annoncer(t('rol.supprime'), 'succes')
    }
    setSuppressionEnCours(null)
  }

  // Le rôle super_admin détient toutes les permissions : la base l'impose
  // (une nouvelle permission lui est donnée, aucune ne peut lui être retirée).
  const estSuperAdminRole = selectedRole?.nom === 'super_admin'

  if (authLoading || permsLoading || !hasPermission('menu_gestion_roles')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">{t('rol.verif')}</div>
  }

  return (
    <div className="space-y-5 pt-4 sm:pt-2 px-4 sm:px-6 pb-10 max-w-[1400px] mx-auto">
      {/* En-tête compact (23/11), comme Entreprises et Comptes. */}
      <div className="flex flex-wrap gap-3 justify-between items-center border-b border-[#C9C1B1]/50 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-[#1B2632]">{t('rol.titre')}</h1>
          <span className="text-sm font-semibold text-[#1B2632]/50">{roles.length}</span>
        </div>
        <button 
          onClick={() => { setIsCreateModalOpen(true); setMessage({ text: '', type: '' }) }} 
          className="bg-[#1B2632] hover:bg-[#2C3B4D] text-white px-5 py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-colors"
        >
          {t('rol.nouveau')}
        </button>
      </div>

      {/* Liste des Rôles */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#C9C1B1]/40 p-3 sm:p-6">
        {loading ? <div className="text-center py-10">{t('rol.chargement')}</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((role) => (
              <div key={role.id} className="p-4 sm:p-5 border border-[#C9C1B1]/60 rounded-xl hover:shadow-md transition-shadow bg-white flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-bold text-[#1B2632] break-words">{libelleRole(role.nom)}</h3>
                    {role.is_system && (
                      <span className="shrink-0 text-[11px] font-semibold text-[#1B2632]/45 bg-[#EEE9DF] px-2 py-0.5 rounded-md"
                        title={t('rol.systemeAide')}>
                        {t('rol.systeme')}
                      </span>
                    )}
                  </div>
                  {/* Ce que le rôle fait et qui le porte (23/11), au lieu de « Aucune description ». */}
                  <p className="text-sm text-[#1B2632]/65 mt-2">
                    <b className="text-[#1B2632]">{nbPerms[role.id] ?? 0}</b> {t('rol.permissions', { n: nbPerms[role.id] ?? 0 })}
                    <span className="text-[#1B2632]/30"> · </span>
                    <b className="text-[#1B2632]">{nbComptes[role.id] ?? 0}</b> {t('rol.comptes', { n: nbComptes[role.id] ?? 0 })}
                  </p>
                  {role.description && <p className="text-xs text-[#1B2632]/55 mt-1.5 line-clamp-2">{role.description}</p>}
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button 
                    onClick={() => { handleOpenEdit(role); setRecherchePerm('') }} 
                    className="flex-1 bg-[#1B2632] hover:bg-[#2C3B4D] text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                  >
                    {t('rol.gerer')}
                  </button>
                  {role.is_system ? null : (
                  <button
                    onClick={() => handleDeleteRole(role)}
                    disabled={suppressionEnCours === role.id}
                    title={t('rol.supprimerAide')}
                    className="flex items-center gap-1.5 border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10 px-3 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    {suppressionEnCours === role.id ? '…' : t('rol.supprimer')}
                  </button>
                  )}
                </div>
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
              <h3 className="text-xl font-bold text-[#1B2632]">{t('rol.ajouter')}</h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-red-500 text-2xl leading-none cursor-pointer">&times;</button>
            </div>

            <form onSubmit={handleCreateRole} className="space-y-4">
              {message.text && <div className={`p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{message.text}</div>}

              <div>
                <label className="block text-sm font-semibold mb-1">{t('rol.nom')} <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required 
                  placeholder={t('rol.exNom')} 
                  value={newRoleData.nom} 
                  onChange={(e) => setNewRoleData({ ...newRoleData, nom: e.target.value })} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1B2632] outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-1">{t('rol.description')}</label>
                <textarea 
                  placeholder={t('rol.exDescription')} 
                  value={newRoleData.description} 
                  onChange={(e) => setNewRoleData({ ...newRoleData, description: e.target.value })} 
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1B2632] outline-none min-h-[100px]"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsCreateModalOpen(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 font-semibold rounded-xl transition-colors cursor-pointer">{t('rol.annuler')}</button>
                <button type="submit" disabled={submitting} className="flex-1 py-3 bg-[#1B2632] text-white font-semibold rounded-xl transition-colors cursor-pointer">
                  {submitting ? t('rol.creation') : t('rol.creer')}
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
                Permissions · {libelleRole(selectedRole.nom)}
                <span className="ml-2 text-sm font-semibold text-[#1B2632]/50">{estSuperAdminRole ? permissions.length : rolePerms.length} / {permissions.length}</span>
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-red-500 text-2xl leading-none cursor-pointer">&times;</button>
            </div>

            <form onSubmit={handleUpdateRolePermissions} className="flex flex-col flex-1 overflow-hidden">
              {message.text && <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{message.text}</div>}

              {estSuperAdminRole && (
                <div className="mb-4 p-3 rounded-lg text-sm bg-[#EEE9DF] text-[#1B2632]">
                  {t('rol.superAdminAide')}
                </div>
              )}
              {/* Rangées par module, avec une recherche (23/11) : avant, 61 cases
                  en vrac, chacune avec son code technique. */}
              <div className="flex items-center gap-2 mb-3 bg-white px-3.5 py-2 rounded-xl border border-[#C9C1B1] focus-within:border-[#1B2632]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/35 shrink-0"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input id="recherche-permission" type="text" value={recherchePerm} onChange={(e) => setRecherchePerm(e.target.value)}
                  placeholder={t('rol.chercher')} className="w-full outline-none bg-transparent text-sm text-[#1B2632]" />
                {recherchePerm && <button type="button" onClick={() => setRecherchePerm('')} className="text-xs text-[#1B2632]/40 hover:text-[#A35139]">✕</button>}
              </div>
              <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-5 pb-4">
                {(() => {
                  const rech = recherchePerm.trim().toLowerCase()
                  const visibles = permissions.filter((p) => !rech || `${p.nom} ${nomPerm(p)} ${p.code} ${p.description || ''} ${descPerm(p)} ${p.module || ''}`.toLowerCase().includes(rech))
                  const groupes = {}
                  for (const p of visibles) (groupes[nomModule(p.module)] ||= []).push(p)
                  const ordre = Object.keys(groupes).sort((a, b) => {
                    const ia = ORDRE_MODULES.indexOf(a), ib = ORDRE_MODULES.indexOf(b)
                    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
                  })
                  if (ordre.length === 0) return <p className="text-sm text-[#1B2632]/50 py-6 text-center">{t('rol.aucune')}</p>
                  return ordre.map((mod) => {
                    const liste = groupes[mod].sort((a, b) => String(nomPerm(a)).localeCompare(String(nomPerm(b))))
                    const cochees = liste.filter((p) => estSuperAdminRole || rolePerms.includes(p.code)).length
                    return (
                      <section key={mod}>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#1B2632]/60 mb-2 flex items-center gap-2">
                          {ORDRE_MODULES.includes(mod) ? t('rol.mod.' + mod.normalize('NFD').replace(/[^A-Za-z]/g, '')) : mod}
                          <span className="font-semibold normal-case tracking-normal text-[#1B2632]/40">{cochees} / {liste.length}</span>
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {liste.map((perm) => {
                            const coche = estSuperAdminRole || rolePerms.includes(perm.code)
                            return (
                              <label key={perm.code} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${coche ? 'border-[#1B2632]/30 bg-[#EEE9DF]/40' : 'border-[#C9C1B1]/50 hover:bg-[#EEE9DF]/20'}`}>
                                <input
                                  type="checkbox"
                                  checked={coche}
                                  disabled={estSuperAdminRole}
                                  onChange={() => togglePermission(perm.code)}
                                  className="mt-0.5 w-4 h-4 accent-[#1B2632] cursor-pointer"
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-[#1B2632]">{nomPerm(perm)}</div>
                                  {descPerm(perm) && <div className="text-xs text-[#1B2632]/55 mt-0.5">{descPerm(perm)}</div>}
                                  <div className="text-[10px] font-mono text-[#1B2632]/30 mt-0.5">{perm.code}</div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })
                })()}
              </div>

              <div className="flex gap-3 pt-6 mt-2 border-t border-gray-100">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 font-semibold rounded-xl transition-colors cursor-pointer">{t('rol.annuler')}</button>
                <button type="submit" disabled={submitting || estSuperAdminRole} className="flex-1 py-3 bg-[#1B2632] hover:bg-[#2C3E50] text-white font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  {submitting ? t('commun.enregistrement') : t('rol.enregistrer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}