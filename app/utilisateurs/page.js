'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' 
import { usePermissions } from '../context/PermissionsContext' 

export default function UtilisateursPage() {
  const { user, tenantId, loading: authLoading } = useAuth() 
  const { hasPermission, loading: permsLoading } = usePermissions() 
  const router = useRouter()

  // 🚀 EXTRACTION SÉCURISÉE DU TENANT ID
  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;
  // Only roles with `gerer_utilisateurs` (manager, admin, super_admin) can create / edit / delete.
  // CEO has `menu_utilisateurs` only: read-only list.
  const peutGerer = hasPermission('gerer_utilisateurs')

  const [ongletActif, setOngletActif] = useState('agents') // 'agents', 'livreurs', 'creation'
  
  const [agents, setAgents] = useState([])
  const [livreurs, setLivreurs] = useState([])
  const [listeZones, setListeZones] = useState([])

  const [message, setMessage] = useState({ texte: '', type: '' })

  // États pour la création
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [roleUtilisateur, setRoleUtilisateur] = useState('agent')
  const [zoneLivreur, setZoneLivreur] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  // États pour la modale de modification
  const [modalOuverte, setModalOuverte] = useState(false)
  const [typeEdition, setTypeEdition] = useState('') 
  const [idEdition, setIdEdition] = useState(null)
  const [editNom, setEditNom] = useState('')
  const [editTelephone, setEditTelephone] = useState('')
  const [editZone, setEditZone] = useState('')

  // REDIRECTION SÉCURISÉE VIA LA MATRICE DE PERMISSIONS
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_utilisateurs')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const chargerDonnees = useCallback(async () => {
    if (!tenantKey) return

    const [dataAgents, dataLivreurs, dataZones] = await Promise.all([
      supabase.from('agents').select('*').eq('tenant_id', tenantKey).not('user_id', 'is', null).order('nom'),
      supabase.from('livreurs').select('*').eq('tenant_id', tenantKey).not('user_id', 'is', null).order('nom'),
      supabase.from('zones').select('id, nom_zone').eq('tenant_id', tenantKey).order('nom_zone')
    ])

    setAgents(dataAgents.data || [])
    setLivreurs(dataLivreurs.data || [])
    setListeZones(dataZones.data || [])
  }, [tenantKey])

  useEffect(() => {
    if (tenantKey) {
      chargerDonnees()
    }
  }, [tenantKey, chargerDonnees])

  function afficherMessage(texte, type) {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 4000)
  }

  // --- CRÉATION ---
  async function creerUtilisateur(e) {
    e.preventDefault()
    if (!tenantKey) return
    setEnvoiEnCours(true)

    // 🚀 1. Récupération dynamique du role_id depuis la base de données
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('nom', roleUtilisateur) // 'agent' ou 'livreur'
      .single();

    if (roleError || !roleData) {
      afficherMessage(`Erreur : Le rôle "${roleUtilisateur}" n'existe pas en base de données.`, 'erreur')
      setEnvoiEnCours(false)
      return;
    }

    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/creer-utilisateur`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          email, 
          mot_de_passe: motDePasse, 
          nom, 
          telephone, 
          role: roleUtilisateur, // Gardé au cas où la fonction l'utilise
          role_id: roleData.id,  // 🚀 AJOUT DU ROLE_ID REQUIS PAR LA FONCTION
          zone: roleUtilisateur === 'livreur' && zoneLivreur ? zoneLivreur.trim() : null,
          tenant_id: tenantKey   // 🚀 CORRECTION DU TENANT ID
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      afficherMessage('Erreur : ' + resultat.error, 'erreur')
      return
    }

    afficherMessage('Utilisateur créé avec succès !', 'succes')
    setEmail('')
    setMotDePasse('')
    setNom('')
    setTelephone('')
    setZoneLivreur('')
    await chargerDonnees()
    setOngletActif(roleUtilisateur === 'livreur' ? 'livreurs' : 'agents')
  }

  // --- STATUT AGENT / LIVREUR ---
  async function basculerStatutAgent(id, statutActuel) {
    const { error } = await supabase.from('agents').update({ actif: !statutActuel }).eq('id', id).eq('tenant_id', tenantKey)
    if (error) {
      alert('Erreur lors du changement de statut : ' + error.message)
    } else {
      await chargerDonnees()
    }
  }

  async function basculerStatutLivreur(id, statutActuel) {
    const { error } = await supabase.from('livreurs').update({ actif: !statutActuel }).eq('id', id).eq('tenant_id', tenantKey)
    if (error) {
      alert('Erreur lors du changement de statut : ' + error.message)
    } else {
      await chargerDonnees()
    }
  }

  // --- SUPPRESSION ---
  // Deletes the LOGIN ACCOUNT (auth + user_roles) through the Edge Function, exactly like
  // "Comptes & Accès". The agent/livreur row is kept (inactive, user_id = null) so the
  // history of orders, deliveries and payments stays intact.
  async function supprimerCompte(userId, nom, type) {
    if (!window.confirm(`Supprimer le compte de ${nom} ? Il ne pourra plus se connecter.`)) return
    if (!userId) {
      alert("Ce profil n'est lié à aucun compte.")
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/supprimer-utilisateur`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      }
    )
    const resultat = await reponse.json()

    if (!reponse.ok || resultat.error) {
      alert('Erreur lors de la suppression : ' + (resultat.error || 'inconnue'))
    } else {
      afficherMessage(type === 'livreur' ? 'Livreur supprimé.' : 'Agent supprimé.', 'succes')
      await chargerDonnees()
    }
  }

  // --- MODIFICATION (OUVERTURE MODALE) ---
  function ouvrirModalEdition(type, utilisateur) {
    setTypeEdition(type)
    setIdEdition(utilisateur.id)
    setEditNom(utilisateur.nom || '')
    setEditTelephone(utilisateur.telephone || '')
    setEditZone(utilisateur.zone ? utilisateur.zone.trim() : '')
    setModalOuverte(true)
  }

  async function enregistrerModification(e) {
    e.preventDefault()
    const table = typeEdition === 'agent' ? 'agents' : 'livreurs'

    let payload = {}
    if (typeEdition === 'agent') {
      payload = { nom: editNom.trim() }
    } else {
      payload = {
        nom: editNom.trim(),
        telephone: editTelephone.trim(),
        zone: editZone === '' ? null : editZone.trim()
      }
    }

    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', idEdition)
      .eq('tenant_id', tenantKey) // 🚀 Utilisation de tenantKey corrigé
      .select()

    if (error) {
      alert('Erreur Supabase : ' + error.message)
    } else if (!data || data.length === 0) {
      alert("Aucune modification n'a été enregistrée.")
    } else {
      afficherMessage('Modifications enregistrées avec succès !', 'succes')
      setModalOuverte(false)
      await chargerDonnees()
    }
  }

  if (authLoading || permsLoading || !hasPermission('menu_utilisateurs')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-16 px-6 pb-10">
      
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

        {/* Système d'onglets */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={() => setOngletActif('agents')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'agents' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            Agents ({agents.length})
          </button>
          <button
            onClick={() => setOngletActif('livreurs')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'livreurs' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            Livreurs ({livreurs.length})
          </button>
          {peutGerer && <button
            onClick={() => setOngletActif('creation')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'creation' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            + Créer un utilisateur
          </button>}
        </div>
      </header>

      {/* Message d'alerte global */}
      {message.texte && (
        <div className={`p-4 rounded-xl text-sm font-semibold border ${message.type === 'succes' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
          {message.texte}
        </div>
      )}

      {/* --- ONGLET AGENTS --- */}
      {ongletActif === 'agents' && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
          <h2 className="text-xl font-bold text-[#1B2632] mb-4 pb-3 border-b border-[#C9C1B1]/40">
            Liste des Agents du Centre d'Appel
          </h2>
          {agents.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-8 text-center">Aucun agent enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-4 py-3">Nom</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {agents.map((a) => (
                    <tr key={a.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                      <td className="px-4 py-4 font-semibold text-[#1B2632]">{a.nom}</td>
                      <td className="px-4 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${a.actif ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {a.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right space-x-2">
                        {peutGerer ? (<>
                          <button onClick={() => ouvrirModalEdition('agent', a)} className="px-3 py-1.5 bg-[#EEE9DF] hover:bg-[#C9C1B1] text-[#1B2632] rounded-lg text-xs font-bold cursor-pointer transition-colors">Modifier</button>
                          <button onClick={() => basculerStatutAgent(a.id, a.actif)} className="px-3 py-1.5 border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] cursor-pointer hover:bg-gray-50 transition-colors">
                            {a.actif ? 'Désactiver' : 'Activer'}
                          </button>
                          <button onClick={() => supprimerCompte(a.user_id, a.nom, 'agent')} className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold cursor-pointer transition-colors">Supprimer</button>
                        </>) : <span className="text-xs text-[#1B2632]/40">Lecture seule</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- ONGLET LIVREURS --- */}
      {ongletActif === 'livreurs' && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-6">
          <h2 className="text-xl font-bold text-[#1B2632] mb-4 pb-3 border-b border-[#C9C1B1]/40">
            Liste des Livreurs & Zones d'Activité
          </h2>
          {livreurs.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-8 text-center">Aucun livreur enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-4 py-3">Nom</th>
                    <th className="px-4 py-3">Téléphone</th>
                    <th className="px-4 py-3">Zone assignée</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {livreurs.map((l) => (
                    <tr key={l.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                      <td className="px-4 py-4 font-semibold text-[#1B2632]">{l.nom}</td>
                      <td className="px-4 py-4 font-mono text-xs text-[#A35139]">{l.telephone || '-'}</td>
                      <td className="px-4 py-4">
                        <span className="font-semibold text-xs bg-[#EEE9DF] px-2.5 py-1 rounded-md">
                          {l.zone ? l.zone.trim() : 'Volant (Toutes les zones)'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${l.actif ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {l.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right space-x-2 whitespace-nowrap">
                        {peutGerer ? (<>
                          <button onClick={() => ouvrirModalEdition('livreur', l)} className="px-3 py-1.5 bg-[#EEE9DF] hover:bg-[#C9C1B1] text-[#1B2632] rounded-lg text-xs font-bold cursor-pointer transition-colors">Modifier</button>
                          <button onClick={() => basculerStatutLivreur(l.id, l.actif)} className="px-3 py-1.5 border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] cursor-pointer hover:bg-gray-50 transition-colors">
                            {l.actif ? 'Désactiver' : 'Activer'}
                          </button>
                          <button onClick={() => supprimerCompte(l.user_id, l.nom, 'livreur')} className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold cursor-pointer transition-colors">Supprimer</button>
                        </>) : <span className="text-xs text-[#1B2632]/40">Lecture seule</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- ONGLET CRÉATION --- */}
      {peutGerer && ongletActif === 'creation' && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-8">
          <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
            <h2 className="text-xl font-bold text-[#1B2632]">Créer un nouvel utilisateur</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">Ajoutez un agent, un livreur au système.</p>
          </div>

          <form onSubmit={creerUtilisateur} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Email</label>
                <input
                  type="email"
                  placeholder="nom@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Mot de passe</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Nom complet</label>
                <input
                  type="text"
                  placeholder="Nom et Prénom"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Téléphone (Optionnel)</label>
                <input
                  type="text"
                  placeholder="+242..."
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Rôle</label>
                <select
                  value={roleUtilisateur}
                  onChange={(e) => setRoleUtilisateur(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                >
                  <option value="agent">Agent</option>
                  <option value="livreur">Livreur</option>
                </select>
              </div>

              {roleUtilisateur === 'livreur' && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">Zone d'activité initiale</label>
                  <select
                    value={zoneLivreur}
                    onChange={(e) => setZoneLivreur(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                  >
                    <option value="">-- Volant (Toutes les zones) --</option>
                    {listeZones.map((z) => (
                      <option key={z.id} value={z.nom_zone}>{z.nom_zone}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={envoiEnCours}
                className="px-6 py-3 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-xl text-sm font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {envoiEnCours ? 'Création en cours...' : 'Créer l\'utilisateur'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODALE DE MODIFICATION --- */}
      {modalOuverte && (
        <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#C9C1B1] w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/30">
              <h3 className="text-lg font-bold text-[#1B2632]">
                Modifier {typeEdition === 'agent' ? "l'agent" : 'le livreur'}
              </h3>
              <button onClick={() => setModalOuverte(false)} className="text-[#1B2632]/50 hover:text-[#1B2632] font-bold text-lg cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={enregistrerModification} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">Nom complet</label>
                <input
                  type="text"
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>

              {typeEdition === 'livreur' && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">Téléphone</label>
                  <input
                    type="text"
                    value={editTelephone}
                    onChange={(e) => setEditTelephone(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  />
                </div>
              )}

              {typeEdition === 'livreur' && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">Zone d'activité</label>
                  <select
                    value={editZone}
                    onChange={(e) => setEditZone(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                  >
                    <option value="">-- Volant (Toutes les zones) --</option>
                    {listeZones.map((z) => (
                      <option key={z.id} value={z.nom_zone}>{z.nom_zone}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-[#C9C1B1]/40">
                <button
                  type="button"
                  onClick={() => setModalOuverte(false)}
                  className="px-5 py-2.5 border border-[#C9C1B1] rounded-xl text-xs font-bold text-[#1B2632] hover:bg-gray-100 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-xl text-xs font-bold cursor-pointer shadow-md"
                >
                  Enregistrer les modifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}