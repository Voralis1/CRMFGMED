'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext' 
import { usePermissions } from '../context/PermissionsContext' 
import { useMessages } from '../components/Messages'
import { messageErreur } from '../../lib/messageErreur.mjs'
import { useLangue } from '../context/LangueContext'

export default function UtilisateursPage() {
  const { user, tenantId, loading: authLoading } = useAuth() 
  const { hasPermission, loading: permsLoading } = usePermissions() 
  // Messages du CRM (24/11) au lieu des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages()
  // Les textes suivent la langue choisie (25/11).
  const { t } = useLangue()
  const router = useRouter()

  // 🚀 EXTRACTION SÉCURISÉE DU TENANT ID
  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;

  // Only roles with `gerer_utilisateurs` (manager, admin, super_admin) can create / edit / delete.
  // CEO has `menu_utilisateurs` only: read-only list.
  const peutGerer = hasPermission('gerer_utilisateurs')

  const [ongletActif, setOngletActif] = useState('agents') // 'agents', 'livreurs', 'equipe', 'creation'
  // Les rôles sans fiche métier (seller, manager, ceo, admin) n'existent que
  // dans user_roles : sans cet onglet, on les créerait sans jamais les revoir.
  const [equipe, setEquipe] = useState([])
  const ROLES_SANS_FICHE = ['seller', 'manager', 'ceo', 'admin']
  
  const [agents, setAgents] = useState([])
  const [livreurs, setLivreurs] = useState([])
  const [listeZones, setListeZones] = useState([])
  const [listePays, setListePays] = useState([])

  const [message, setMessage] = useState({ texte: '', type: '' })

  // États pour la création
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [voirMotDePasse, setVoirMotDePasse] = useState(false)
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [roleUtilisateur, setRoleUtilisateur] = useState('agent')
  const [zoneLivreur, setZoneLivreur] = useState('')
  const [paysFiche, setPaysFiche] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  // États pour la modale de modification
  const [modalOuverte, setModalOuverte] = useState(false)
  const [typeEdition, setTypeEdition] = useState('') 
  const [idEdition, setIdEdition] = useState(null)
  const [editNom, setEditNom] = useState('')
  const [editTelephone, setEditTelephone] = useState('')
  const [editZone, setEditZone] = useState('')
  const [editPays, setEditPays] = useState('')

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

    const [dataAgents, dataLivreurs, dataZones, dataPays, dataEquipe] = await Promise.all([
      supabase.from('agents').select('*').eq('tenant_id', tenantKey).not('user_id', 'is', null).order('nom'),
      supabase.from('livreurs').select('*').eq('tenant_id', tenantKey).not('user_id', 'is', null).order('nom'),
      supabase.from('zones').select('id, nom_zone, pays_id').eq('tenant_id', tenantKey).order('nom_zone'),
      supabase.from('pays').select('id, nom').eq('tenant_id', tenantKey).order('nom'),
      supabase.from('user_roles').select('user_id, email, nom, role')
        .eq('tenant_id', tenantKey).order('role')
    ])

    setAgents(dataAgents.data || [])
    setLivreurs(dataLivreurs.data || [])
    setListeZones(dataZones.data || [])
    setListePays(dataPays.data || [])
    setEquipe((dataEquipe.data || []).filter((u) => ROLES_SANS_FICHE.includes(String(u.role || '').toLowerCase())))
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

    // Le pays ne concerne que les deux rôles qui travaillent sur le terrain :
    // il décide des leads qu'un agent reçoit et des livraisons qu'un livreur
    // peut prendre. Un seller, un manager, un CEO ou un admin n'en ont pas.
    const roleAvecPays = roleUtilisateur === 'agent' || roleUtilisateur === 'livreur'
    if (roleAvecPays && !paysFiche) {
      afficherMessage(t('util.paysObligatoireRole'), 'erreur')
      return
    }

    if (roleUtilisateur === 'livreur' && !zoneLivreur) {
      afficherMessage(t('util.zoneObligatoire'), 'erreur')
      return
    }

    setEnvoiEnCours(true)

    // 🚀 1. Récupération dynamique du role_id depuis la base de données
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('nom', roleUtilisateur) // 'agent' ou 'livreur'
      .single();

    if (roleError || !roleData) {
      afficherMessage(t('util.roleInexistant', { role: roleUtilisateur }), 'erreur')
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
          zone: roleUtilisateur === 'livreur' ? zoneLivreur.trim() : null,
          pays_id: roleAvecPays ? paysFiche : null,
          tenant_id: tenantKey   // 🚀 CORRECTION DU TENANT ID
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      afficherMessage(t('util.erreur', { erreur: messageErreur(resultat.error) }), 'erreur')
      return
    }

    afficherMessage(t('util.cree'), 'succes')
    setEmail('')
    setMotDePasse('')
    setNom('')
    setTelephone('')
    setZoneLivreur('')
    setPaysFiche('')
    await chargerDonnees()
    setOngletActif(
      roleUtilisateur === 'livreur' ? 'livreurs'
      : roleUtilisateur === 'agent' ? 'agents'
      : 'equipe'
    )
  }

  // --- STATUT AGENT / LIVREUR ---
  async function basculerStatutAgent(id, statutActuel) {
    const { error } = await supabase.from('agents').update({ actif: !statutActuel }).eq('id', id).eq('tenant_id', tenantKey)
    if (error) {
      annoncer(t('util.statutImpossible', { erreur: messageErreur(error) }), 'erreur')
    } else {
      await chargerDonnees()
    }
  }

  async function basculerStatutLivreur(id, statutActuel) {
    const { error } = await supabase.from('livreurs').update({ actif: !statutActuel }).eq('id', id).eq('tenant_id', tenantKey)
    if (error) {
      annoncer(t('util.statutImpossible', { erreur: messageErreur(error) }), 'erreur')
    } else {
      await chargerDonnees()
    }
  }

  // --- SUPPRESSION ---
  // Deletes the LOGIN ACCOUNT (auth + user_roles) through the Edge Function, exactly like
  // "Comptes & Accès". The agent/livreur row is kept (inactive, user_id = null) so the
  // history of orders, deliveries and payments stays intact.
  async function supprimerCompte(userId, nom, type) {
    if (!userId) {
      annoncer(t('util.profilSansCompte'), 'erreur')
      return
    }
    if (!(await confirmer({ titre: t('util.supprimerCompte'), message: t('util.supprimerMsg', { nom }), bouton: t('util.supprimer'), danger: true }))) return

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
    const resultat = await reponse.json().catch(() => ({}))

    if (!reponse.ok || resultat.error) {
      annoncer(t('util.suppressionImpossible', { erreur: messageErreur(resultat.error) }), 'erreur')
    } else {
      afficherMessage(type === 'livreur' ? t('util.livreurSupprime') : t('util.agentSupprime'), 'succes')
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
    setEditPays(utilisateur.pays_id || '')
    setModalOuverte(true)
  }

  async function enregistrerModification(e) {
    e.preventDefault()
    const table = typeEdition === 'agent' ? 'agents' : 'livreurs'

    if (!editPays) {
      annoncer(t('util.paysObligatoire'), 'erreur')
      return
    }

    if (typeEdition === 'livreur' && !editZone) {
      annoncer(t('util.zoneObligatoire'), 'erreur')
      return
    }

    let payload = {}
    if (typeEdition === 'agent') {
      payload = { nom: editNom.trim(), pays_id: editPays }
    } else {
      payload = {
        nom: editNom.trim(),
        telephone: editTelephone.trim(),
        pays_id: editPays,
        zone: editZone.trim()
      }
    }

    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', idEdition)
      .eq('tenant_id', tenantKey) // 🚀 Utilisation de tenantKey corrigé
      .select()

    if (error) {
      annoncer(t('util.enregistrementImpossible', { erreur: messageErreur(error) }), 'erreur')
    } else if (!data || data.length === 0) {
      annoncer(t('util.rienEnregistre'), 'info')
    } else {
      afficherMessage(t('util.modifsEnregistrees'), 'succes')
      setModalOuverte(false)
      await chargerDonnees()
    }
  }

  if (authLoading || permsLoading || !hasPermission('menu_utilisateurs')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">{t('util.verif')}</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      
      {/* En-tête */}
      <header className="flex flex-col gap-4 border-b border-[#C9C1B1]/50 pb-4">
        {/* En-tête compact (20/11). */}
        <h1 className="text-2xl font-bold text-[#1B2632]">{t('util.titre')}</h1>

        {/* Système d'onglets */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setOngletActif('agents')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'agents' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            {t('util.ongletAgents', { n: agents.length })}
          </button>
          <button
            onClick={() => setOngletActif('livreurs')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'livreurs' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            {t('util.ongletLivreurs', { n: livreurs.length })}
          </button>
          <button
            onClick={() => setOngletActif('equipe')}
            className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'equipe' ? 'bg-[#1B2632] text-white shadow-md' : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            {t('util.ongletEquipe', { n: equipe.length })}
          </button>
          {/* « Créer » sur la ligne des onglets, poussé à droite (20/11) : même
              niveau, mais un bouton plein foncé — c'est une action, pas une liste. */}
          {peutGerer && (
            <button onClick={() => setOngletActif('creation')}
              className="sm:ml-auto px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm cursor-pointer transition-colors bg-[#1B2632] text-white hover:bg-[#2C3B4D]">
              {t('util.creerBouton')}
            </button>
          )}
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
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-3 sm:p-6">
          <h2 className="text-xl font-bold text-[#1B2632] mb-4 pb-3 border-b border-[#C9C1B1]/40">
            {t('util.listeAgents')}
          </h2>
          {agents.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-8 text-center">{t('util.aucunAgent')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-4 py-3">{t('util.nom')}</th>
                    <th className="px-4 py-3">{t('util.paysTraite')}</th>
                    <th className="px-4 py-3">{t('util.statut')}</th>
                    <th className="px-4 py-3 text-right">{t('util.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {agents.map((a) => (
                    <tr key={a.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                      <td className="px-4 py-4 font-semibold text-[#1B2632]">{a.nom}</td>
                      <td className="px-4 py-4">
                        {a.pays_id ? (
                          <span className="font-semibold text-xs bg-[#EEE9DF] px-2.5 py-1 rounded-md">
                            {listePays.find(p => p.id === a.pays_id)?.nom || '—'}
                          </span>
                        ) : (
                          <span className="font-semibold text-xs bg-[#A35139]/10 text-[#A35139] px-2.5 py-1 rounded-md">{t('util.nonDefini')}</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${a.actif ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {a.actif ? t('util.actif') : t('util.inactif')}
                        </span>
                      </td>
                      <td className="px-4 py-4"><div className="flex justify-end gap-2 whitespace-nowrap">
                        {peutGerer ? (<>
                        <button onClick={() => ouvrirModalEdition('agent', a)} className="px-3.5 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold cursor-pointer transition-colors">{t('util.modifier')}</button>
                        <button onClick={() => basculerStatutAgent(a.id, a.actif)} className="px-3 py-1.5 border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] cursor-pointer hover:bg-gray-50 transition-colors">
                          {a.actif ? t('util.desactiver') : t('util.activer')}
                        </button>
                        <button onClick={() => supprimerCompte(a.user_id, a.nom, 'agent')} title={t('util.supprimerCompte')} className="flex items-center gap-1.5 px-3.5 py-1.5 border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10 rounded-lg text-xs font-bold cursor-pointer transition-colors"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>{t('util.supprimer')}</button>
                        </>) : <span className="text-xs text-[#1B2632]/40">{t('util.lectureSeule')}</span>}
                      </div></td>
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
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-3 sm:p-6">
          <h2 className="text-xl font-bold text-[#1B2632] mb-4 pb-3 border-b border-[#C9C1B1]/40">
            {t('util.listeLivreurs')}
          </h2>
          {livreurs.length === 0 ? (
            <p className="text-sm text-[#1B2632]/60 py-8 text-center">{t('util.aucunLivreur')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-4 py-3">{t('util.nom')}</th>
                    <th className="px-4 py-3">{t('util.telephone')}</th>
                    <th className="px-4 py-3">{t('util.pays')}</th>
                    <th className="px-4 py-3">{t('util.zoneAssignee')}</th>
                    <th className="px-4 py-3">{t('util.statut')}</th>
                    <th className="px-4 py-3 text-right">{t('util.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {livreurs.map((l) => (
                    <tr key={l.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                      <td className="px-4 py-4 font-semibold text-[#1B2632]">{l.nom}</td>
                      <td className="px-4 py-4 font-mono text-xs text-[#A35139]">{l.telephone || '-'}</td>
                      <td className="px-4 py-4">
                        {l.pays_id ? (
                          <span className="font-semibold text-xs bg-[#EEE9DF] px-2.5 py-1 rounded-md">
                            {listePays.find(p => p.id === l.pays_id)?.nom || '—'}
                          </span>
                        ) : (
                          <span className="font-semibold text-xs bg-[#A35139]/10 text-[#A35139] px-2.5 py-1 rounded-md">{t('util.nonDefini')}</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-semibold text-xs bg-[#EEE9DF] px-2.5 py-1 rounded-md">
                          {l.zone ? l.zone.trim() : <span className="text-red-600 font-semibold">{t('util.nonDefini')}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${l.actif ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {l.actif ? t('util.actif') : t('util.inactif')}
                        </span>
                      </td>
                      <td className="px-4 py-4"><div className="flex justify-end gap-2 whitespace-nowrap">
                        {peutGerer ? (<>
                        <button onClick={() => ouvrirModalEdition('livreur', l)} className="px-3.5 py-1.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-xs font-bold cursor-pointer transition-colors">{t('util.modifier')}</button>
                        <button onClick={() => basculerStatutLivreur(l.id, l.actif)} className="px-3 py-1.5 border border-[#C9C1B1] rounded-lg text-xs font-bold text-[#1B2632] cursor-pointer hover:bg-gray-50 transition-colors">
                          {l.actif ? t('util.desactiver') : t('util.activer')}
                        </button>
                        <button onClick={() => supprimerCompte(l.user_id, l.nom, 'livreur')} title={t('util.supprimerCompte')} className="flex items-center gap-1.5 px-3.5 py-1.5 border border-[#A35139]/40 text-[#A35139] hover:bg-[#A35139]/10 rounded-lg text-xs font-bold cursor-pointer transition-colors"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>{t('util.supprimer')}</button>
                        </>) : <span className="text-xs text-[#1B2632]/40">{t('util.lectureSeule')}</span>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- ONGLET CRÉATION --- */}
      {/* --- ONGLET EQUIPE : les rôles qui n'ont pas de fiche métier --- */}
      {ongletActif === 'equipe' && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-3 sm:p-6">
          <h2 className="text-xl font-bold text-[#1B2632] mb-4 pb-3 border-b border-[#C9C1B1]/40">
            {t('util.equipeTitre')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-[#1B2632]/60 border-b border-[#C9C1B1]/40">
                <tr>
                  <th className="px-4 py-3">{t('util.nom')}</th>
                  <th className="px-4 py-3">{t('util.email')}</th>
                  <th className="px-4 py-3">{t('util.role')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {equipe.length === 0 ? (
                  <tr><td colSpan="3" className="px-4 py-8 text-center text-[#1B2632]/50">{t('util.personne')}</td></tr>
                ) : equipe.map((u) => (
                  <tr key={u.user_id} className="hover:bg-[#EEE9DF]/20">
                    <td className="px-4 py-3 font-semibold text-[#1B2632]">{u.nom || <span className="font-normal italic text-[#1B2632]/40">{t('util.sansNom')}</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#1B2632]/70">{u.email || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-bold uppercase tracking-wide bg-[#EEE9DF] text-[#1B2632] px-2.5 py-1 rounded-full">
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {peutGerer && ongletActif === 'creation' && (
        <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden p-8">
          <div className="mb-6 border-b border-[#C9C1B1]/50 pb-4">
            <h2 className="text-xl font-bold text-[#1B2632]">{t('util.creerTitre')}</h2>
            <p className="text-sm text-[#1B2632]/60 mt-1">{t('util.creerAide')}</p>
          </div>

          <form onSubmit={creerUtilisateur} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.email')}</label>
                <input
                  type="email"
                  placeholder={t('util.exEmail')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.mdp')}</label>
                {/* 8 caractères au moins (20/11) : la règle de Supabase Auth depuis le
                    17/11. À 6, le serveur refusait après coup. L'œil évite une faute
                    de frappe sur un mot de passe qu'on ne voit pas. */}
                <div className="relative">
                  <input
                    type={voirMotDePasse ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={motDePasse}
                    onChange={(e) => setMotDePasse(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 pr-12 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setVoirMotDePasse((v) => !v)}
                    title={voirMotDePasse ? t('util.masquerMdp') : t('util.afficherMdp')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B2632]/50 hover:text-[#1B2632] cursor-pointer">
                    {voirMotDePasse ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
                <p className={`text-[11px] mt-1.5 ${motDePasse && motDePasse.length < 8 ? 'text-[#A35139] font-semibold' : 'text-[#1B2632]/45'}`}>
                  {t('util.mdpMin')}{motDePasse ? t('util.tapes', { n: motDePasse.length }) : ''}
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.nomComplet')}</label>
                <input
                  type="text"
                  placeholder={t('util.nomPrenom')}
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.telOptionnel')}</label>
                <input
                  type="text"
                  placeholder="+242..."
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.role')}</label>
                <select
                  value={roleUtilisateur}
                  onChange={(e) => setRoleUtilisateur(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                >
                  <option value="agent">{t('util.roleAgent')}</option>
                  <option value="livreur">{t('util.livreur')}</option>
                  <option value="seller">{t('util.roleSeller')}</option>
                  <option value="manager">{t('util.manager')}</option>
                  <option value="ceo">{t('util.roleCeo')}</option>
                  <option value="admin">{t('util.admin')}</option>
                </select>
              </div>

              {(roleUtilisateur === 'agent' || roleUtilisateur === 'livreur') && (
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.pays')} <span className="text-[#A35139]">*</span></label>
                <select
                  value={paysFiche}
                  onChange={(e) => { setPaysFiche(e.target.value); setZoneLivreur('') }}
                  required
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                >
                  <option value="">{t('util.choisirPays')}</option>
                  {listePays.map((p) => (
                    <option key={p.id} value={p.id}>{p.nom}</option>
                  ))}
                </select>
                <p className="text-[11px] text-[#1B2632]/60 mt-1.5">
                  {roleUtilisateur === 'agent'
                    ? t('util.agentPaysAide')
                    : t('util.livreurPaysAide')}
                </p>
              </div>
              )}

              {roleUtilisateur === 'livreur' && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-2">{t('util.zoneObl')}</label>
                  <select
                    required
                    value={zoneLivreur}
                    onChange={(e) => setZoneLivreur(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-3 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                  >
                    <option value="">{t('util.choisirZone')}</option>
                    {listeZones.filter((z) => !paysFiche || z.pays_id === paysFiche).map((z) => (
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
                {envoiEnCours ? t('util.creation') : t('util.creer')}
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
                {typeEdition === 'agent' ? t('util.modifierAgent') : t('util.modifierLivreur')}
              </h3>
              <button onClick={() => setModalOuverte(false)} className="text-[#1B2632]/50 hover:text-[#1B2632] font-bold text-lg cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={enregistrerModification} className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">{t('util.nomComplet')}</label>
                <input
                  type="text"
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">{t('util.pays')} <span className="text-[#A35139]">*</span></label>
                <select
                  value={editPays}
                  onChange={(e) => { setEditPays(e.target.value); setEditZone('') }}
                  required
                  className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                >
                  <option value="">{t('util.choisirPays')}</option>
                  {listePays.map((p) => (
                    <option key={p.id} value={p.id}>{p.nom}</option>
                  ))}
                </select>
              </div>

              {typeEdition === 'livreur' && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">{t('util.telephone')}</label>
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
                  <label className="block text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide mb-1">{t('util.zoneObl')}</label>
                  <select
                    required
                    value={editZone}
                    onChange={(e) => setEditZone(e.target.value)}
                    className="w-full bg-[#EEE9DF]/30 border border-[#C9C1B1]/60 rounded-xl px-4 py-2.5 text-sm font-medium text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
                  >
                    <option value="">{t('util.choisirZone')}</option>
                    {listeZones.filter((z) => !editPays || z.pays_id === editPays).map((z) => (
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
                  {t('util.annuler')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-xl text-xs font-bold cursor-pointer shadow-md"
                >
                  {t('util.enregistrerModifs')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}