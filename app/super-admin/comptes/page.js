'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'

// Même minimum que Supabase Auth, Utilisateurs et Profil (23/11).
const MIN_MOT_DE_PASSE = 8

// « livreur » → « Livreur », « super_admin » → « Super admin » (23/11).
const libelleRole = (nom) => String(nom || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || '—'

function Oeil({ voir, onClick }) {
  return (
    <button type="button" onClick={onClick} title={voir ? 'Masquer' : 'Afficher'}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B2632]/45 hover:text-[#1B2632] cursor-pointer">
      {voir ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  )
}

function AideMotDePasse({ valeur, vide }) {
  const n = (valeur || '').length
  const court = n > 0 && n < MIN_MOT_DE_PASSE
  return (
    <p className={`text-[11px] mt-1 ${court ? 'text-[#A35139] font-semibold' : 'text-[#1B2632]/45'}`}>
      {n === 0 && vide ? vide : `${MIN_MOT_DE_PASSE} caractères minimum${n ? ` · ${n} tapé${n > 1 ? 's' : ''}` : ''}`}
    </p>
  )
}

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
    email: '', mot_de_passe: '', tenant_id: '', role_id: '', nom: '', pays_id: '', zone: ''
  })
  // Pays et zones de l'entreprise choisie dans le formulaire : un agent reçoit
  // les leads de son pays, un livreur ne livre que dans sa zone. La base refuse
  // un agent sans pays et un livreur sans zone.
  const [paysTenant, setPaysTenant] = useState([])
  const [zonesTenant, setZonesTenant] = useState([])
  
  const [selectedUser, setSelectedUser] = useState(null)
  // Trouver un compte (23/11) : recherche nom / e-mail + filtres entreprise et
  // rôle, sur la liste déjà chargée — rien de plus n'est demandé à la base.
  const [recherche, setRecherche] = useState('')
  const [filtreEntreprise, setFiltreEntreprise] = useState('')
  const [filtreRole, setFiltreRole] = useState('')
  const [voirMdp, setVoirMdp] = useState(false)
  const [voirMdpEdit, setVoirMdpEdit] = useState(false)
  
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
  
  useEffect(() => {
    let annule = false
    async function chargerPaysZones() {
      if (!formData.tenant_id) {
        setPaysTenant([]); setZonesTenant([]); return
      }
      const [{ data: pays }, { data: zones }] = await Promise.all([
        supabase.from('pays').select('id, nom').eq('tenant_id', formData.tenant_id).order('nom'),
        supabase.from('zones').select('id, nom_zone, pays_id').eq('tenant_id', formData.tenant_id).order('nom_zone'),
      ])
      if (annule) return
      setPaysTenant(pays || [])
      setZonesTenant(zones || [])
    }
    chargerPaysZones()
    return () => { annule = true }
  }, [formData.tenant_id])

  // Changer d'entreprise ou de rôle invalide le pays et la zone déjà choisis :
  // ils appartiennent à l'entreprise précédente.
  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((f) => ({
      ...f,
      [name]: value,
      ...(name === 'tenant_id' ? { pays_id: '', zone: '' } : {}),
      ...(name === 'pays_id' ? { zone: '' } : {}),
    }))
  }

  const roleChoisi = String(roles.find((r) => r.id === formData.role_id)?.nom || '').toLowerCase()
  const besoinPays = roleChoisi === 'agent' || roleChoisi === 'livreur'
  const besoinZone = roleChoisi === 'livreur'
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
      setFormData({ email: '', mot_de_passe: '', nom: '', tenant_id: '', role_id: '', pays_id: '', zone: '' })
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
    // Même règle que Supabase Auth (8 depuis le 17/11) : refusé ici, avant le serveur.
    if (selectedUser.nouveau_mdp && selectedUser.nouveau_mdp.length < MIN_MOT_DE_PASSE) {
      setMessage({ text: `Le nouveau mot de passe doit contenir au moins ${MIN_MOT_DE_PASSE} caractères.`, type: 'error' })
      return
    }
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
  const texteRecherche = recherche.trim().toLowerCase()
  const comptesAffiches = comptes.filter((c) =>
    (!texteRecherche || `${c.nom || ''} ${c.email || ''}`.toLowerCase().includes(texteRecherche))
    && (!filtreEntreprise || (filtreEntreprise === 'global' ? !c.tenant_id : c.tenant_id === filtreEntreprise))
    && (!filtreRole || c.role_id === filtreRole))
  const getTenantName = (id) => tenants.find(t => t.id === id)?.nom || tenants.find(t => t.id === id)?.nom_entreprise || 'Global'
  
  if (authLoading || permsLoading || !hasPermission('menu_comptes_acces')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }
  
  return (
    <div className="space-y-5 pt-4 sm:pt-2 px-4 sm:px-6 pb-10 max-w-[1400px] mx-auto">
      {/* En-tête compact (23/11), comme Entreprises. */}
      <div className="flex flex-wrap gap-3 justify-between items-center border-b border-[#C9C1B1]/50 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-[#1B2632]">Comptes &amp; Accès</h1>
          <span className="text-sm font-semibold text-[#1B2632]/50">{comptes.length}</span>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-[#1B2632] hover:bg-[#2C3B4D] text-white px-5 py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-colors">
          + Nouveau compte
        </button>
      </div>

      {/* Trouver un compte (23/11). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 bg-white px-3.5 py-2.5 rounded-xl border border-[#C9C1B1] w-full sm:w-[300px] focus-within:border-[#1B2632]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/35 shrink-0"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input id="recherche-compte" type="text" value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom ou e-mail…" className="w-full outline-none bg-transparent text-sm text-[#1B2632]" />
          {recherche && <button type="button" onClick={() => setRecherche('')} className="text-xs text-[#1B2632]/40 hover:text-[#A35139]">✕</button>}
        </div>
        <select id="filtre-entreprise" value={filtreEntreprise} onChange={(e) => setFiltreEntreprise(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-[#C9C1B1] bg-white text-sm text-[#1B2632] outline-none cursor-pointer">
          <option value="">Toutes les entreprises</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.nom || t.nom_entreprise}</option>)}
          <option value="global">Global (sans entreprise)</option>
        </select>
        <select id="filtre-role" value={filtreRole} onChange={(e) => setFiltreRole(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-[#C9C1B1] bg-white text-sm text-[#1B2632] outline-none cursor-pointer">
          <option value="">Tous les rôles</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{libelleRole(r.nom)}</option>)}
        </select>
        {(recherche || filtreEntreprise || filtreRole) && (
          <span className="text-xs text-[#1B2632]/55">{comptesAffiches.length} sur {comptes.length}</span>
        )}
      </div>
  
      <div className="bg-white rounded-2xl shadow-sm border border-[#C9C1B1]/40 p-3 sm:p-6">
        {loading ? <div className="text-center py-10">Chargement...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase">
                  <th className="py-3 px-4">Utilisateur / Nom & Email</th>
                  <th className="py-3 px-4">Rôle</th>
                  <th className="py-3 px-4">Entreprise</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {comptesAffiches.length === 0 && (
                  <tr><td colSpan="4" className="py-8 text-center text-sm text-[#1B2632]/50">Aucun compte ne correspond.</td></tr>
                )}
                {comptesAffiches.map((c, index) => (
                  <tr key={c.id || c.user_id || index} className="hover:bg-gray-50/50">
                    <td className="py-4 px-4">
                      <div className="font-bold text-[#1B2632]">{c.nom || 'Sans nom'}</div>
                      <div className="font-medium text-xs text-gray-600 mt-0.5">{c.email || 'Email non renseigné'}</div>
                    </td>
                    <td className="py-4 px-4"><span className="px-2.5 py-1 bg-[#EEE9DF] text-[#1B2632] font-semibold rounded-lg text-xs whitespace-nowrap">{libelleRole(getRoleName(c.role_id))}</span></td>
                    <td className="py-4 px-4 font-medium text-[#1B2632]">{getTenantName(c.tenant_id)}</td>
                    <td className="py-4 px-4">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                      <button onClick={() => handleOpenEdit(c)} className="text-xs font-bold px-3.5 py-1.5 rounded-lg bg-[#1B2632] text-white hover:bg-[#2C3B4D] cursor-pointer transition-colors">
                        Modifier
                      </button>
                      <button onClick={() => handleDeleteUser(c.user_id)} title="Supprimer le compte"
                        className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10 cursor-pointer transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        Supprimer
                      </button>
                      </div>
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
              <div>
                <div className="relative">
                  <input type={voirMdp ? 'text' : 'password'} name="mot_de_passe" required minLength={MIN_MOT_DE_PASSE} autoComplete="new-password"
                    placeholder="Mot de passe" value={formData.mot_de_passe} onChange={handleChange}
                    className="w-full px-4 py-2.5 pr-11 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]" />
                  <Oeil voir={voirMdp} onClick={() => setVoirMdp((v) => !v)} />
                </div>
                <AideMotDePasse valeur={formData.mot_de_passe} />
              </div>
              <select name="tenant_id" required value={formData.tenant_id} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                <option value="">Sélectionner une entreprise</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.nom || t.nom_entreprise}</option>)}
              </select>
              <select name="role_id" required value={formData.role_id} onChange={handleChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                <option value="">Sélectionner un rôle</option>
                {roles.map(r => <option key={r.id} value={r.id}>{libelleRole(r.nom)}</option>)}
              </select>

              {besoinPays && (
                <select
                  name="pays_id"
                  required
                  value={formData.pays_id}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]"
                >
                  <option value="">
                    {formData.tenant_id ? 'Sélectionner un pays' : "Choisir d'abord l'entreprise"}
                  </option>
                  {paysTenant.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
              )}

              {besoinZone && (
                <select
                  name="zone"
                  required
                  value={formData.zone}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]"
                >
                  <option value="">
                    {formData.pays_id ? 'Sélectionner une zone' : "Choisir d'abord le pays"}
                  </option>
                  {zonesTenant
                    .filter(z => !formData.pays_id || z.pays_id === formData.pays_id)
                    .map(z => <option key={z.id} value={z.nom_zone}>{z.nom_zone}</option>)}
                </select>
              )}

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
              {/* L'identifiant (23/11) : retiré de la liste, gardé ici avec « Copier ». */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#1B2632]/50 shrink-0">ID</span>
                <code className="font-mono text-[#1B2632]/70 truncate">{selectedUser.user_id}</code>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(selectedUser.user_id).catch(() => {}) }}
                  className="ml-auto shrink-0 px-2 py-1 rounded-md border border-[#C9C1B1] text-[#1B2632] hover:bg-[#EEE9DF] cursor-pointer">
                  Copier
                </button>
              </div>
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
                <div className="relative">
                  <input
                    type={voirMdpEdit ? 'text' : 'password'}
                    name="nouveau_mdp"
                    autoComplete="new-password"
                    placeholder="Laisser vide pour ne pas changer"
                    value={selectedUser.nouveau_mdp || ''}
                    onChange={handleEditChange}
                    className="w-full px-4 py-2.5 pr-11 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]"
                  />
                  <Oeil voir={voirMdpEdit} onClick={() => setVoirMdpEdit((v) => !v)} />
                </div>
                <AideMotDePasse valeur={selectedUser.nouveau_mdp} vide="Vide = le mot de passe ne change pas." />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Rôle Principal</label>
                <select name="role_id" value={selectedUser.role_id} onChange={handleEditChange} className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2632]">
                  {roles.map(r => <option key={r.id} value={r.id}>{libelleRole(r.nom)}</option>)}
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