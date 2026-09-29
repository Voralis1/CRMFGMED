'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

const TAILLE_PAGE = 50

export default function AssignationLivreurPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;

  const [commandes, setCommandes] = useState([])
  const [livreurs, setLivreurs] = useState([])
  const [totalCommandes, setTotalCommandes] = useState(0)
  const [pageActuelle, setPageActuelle] = useState(0)
  const [chargement, setChargement] = useState(true)
  const [livreurChoisiParCommande, setLivreurChoisiParCommande] = useState({})
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null)

  // 🚀 Plus de filtre manuel : on affiche TOUJOURS uniquement les commandes
  // dont le statut est marqué "declenche_assignation" dans Paramètres → Statuts.
  // C'est cette case à cocher, au moment de créer/modifier un statut, qui décide
  // seule si les commandes apparaissent ici — pas un choix fait sur cette page.
  // Onglet "a_assigner" : commandes confirmées sans aucun livreur (le plus souvent
  // parce qu'aucun livreur du pays / de la zone n'était disponible).
  // Onglet "assignees"  : livraisons en attente, pour changer le livreur au besoin.
  const [ongletActif, setOngletActif] = useState('a_assigner')

  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_assignation_livreur')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  async function chargerLivreurs() {
    if (!tenantKey) return

    const { data, error } = await supabase
      .from('livreurs')
      .select('id, nom, zone, pays_id')
      .eq('tenant_id', tenantKey)
      .eq('actif', true)
      .order('nom')

    if (!error) setLivreurs(data || [])
  }

  async function chargerCommandes(page, onglet) {
    if (!tenantKey) return
    setChargement(true)

    const debut = page * TAILLE_PAGE
    const fin = debut + TAILLE_PAGE - 1

    if (onglet === 'a_assigner') {
      // La vue ne renvoie que les commandes confirmées sans livraison : c'est la
      // base qui fait le calcul, la page ne télécharge plus la table `livraisons`.
      const { data, error, count } = await supabase
        .from('v_commandes_a_assigner')
        .select('*, pays(nom)', { count: 'exact' })
        .eq('tenant_id', tenantKey)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(debut, fin)

      if (error) alert('Erreur: ' + error.message)
      else {
        setCommandes((data || []).map((c) => ({ ...c, livreur_actuel: null })))
        setTotalCommandes(count || 0)
      }
    } else {
      // Livraisons encore en attente : on peut encore changer le livreur
      const { data, error, count } = await supabase
        .from('livraisons')
        .select('id, livreur_id, livreurs(nom), commandes(*, pays(nom))', { count: 'exact' })
        .eq('tenant_id', tenantKey)
        .eq('statut', 'en_attente')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(debut, fin)

      if (error) alert('Erreur: ' + error.message)
      else {
        setCommandes(
          (data || [])
            .filter((v) => v.commandes)
            .map((v) => ({ ...v.commandes, livreur_actuel: v.livreurs?.nom || null, livreur_id: v.livreur_id }))
        )
        setTotalCommandes(count || 0)
      }
    }

    setChargement(false)
  }

  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantKey) return
    chargerLivreurs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, permsLoading, tenantKey])

  useEffect(() => {
    if (!tenantKey) return
    chargerCommandes(pageActuelle, ongletActif)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageActuelle, ongletActif, tenantKey])

  function choisirLivreur(commandeId, livreurId) {
    setLivreurChoisiParCommande((prec) => ({ ...prec, [commandeId]: livreurId }))
  }

  async function assigner(commandeId) {
    const livreurId = livreurChoisiParCommande[commandeId]
    if (!livreurId) {
      alert('Choisis un livreur avant d\'assigner')
      return
    }

    setEnvoiEnCoursId(commandeId)

    const { data: { session } } = await supabase.auth.getSession()

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/assigner-livreur`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          commande_id: commandeId,
          livreur_id: livreurId,
          tenant_id: tenantKey
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCoursId(null)

    if (resultat.error) {
      alert('Erreur : ' + resultat.error)
      return
    }

    await chargerCommandes(pageActuelle, ongletActif)
  }

  const totalPages = Math.max(1, Math.ceil(totalCommandes / TAILLE_PAGE))

  if (authLoading || permsLoading || !hasPermission('menu_assignation_livreur')) {
    return <div className="p-8 text-[#1B2632] font-medium">Vérification des accès...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4 pt-4 sm:pt-16">
        <div className="flex justify-between items-end flex-wrap gap-4 px-6 md:px-0">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
              Centre Logistique
            </p>
            <h1 className="text-3xl font-bold text-[#1B2632]">
              Assignation livreur
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-6 md:px-0">
          <button
            onClick={() => { setOngletActif('a_assigner'); setPageActuelle(0) }}
            className={`px-4 sm:px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'a_assigner'
                ? 'bg-[#1B2632] text-white shadow-md'
                : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            À assigner
          </button>
          <button
            onClick={() => { setOngletActif('assignees'); setPageActuelle(0) }}
            className={`px-4 sm:px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'assignees'
                ? 'bg-[#1B2632] text-white shadow-md'
                : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            Assignées (en attente)
          </button>
        </div>

        <p className="px-6 md:px-0 text-sm text-[#1B2632]/60">
          {ongletActif === 'a_assigner'
            ? "Commandes confirmées qu'aucun livreur n'a pu prendre automatiquement : à assigner à la main."
            : 'Livraisons pas encore effectuées. Le livreur peut encore être changé.'}
        </p>
      </header>

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col mx-6 md:mx-0">
        {chargement ? (
          <p className="text-sm text-[#1B2632]/60 p-6">Chargement...</p>
        ) : commandes.length === 0 ? (
          <p className="text-sm text-[#1B2632]/60 p-6">
            {ongletActif === 'a_assigner'
              ? 'Aucune commande en attente : tout a trouvé un livreur automatiquement.'
              : 'Aucune livraison en cours.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto min-h-[400px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    <th className="px-6 py-4">Lead ID</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Client</th>
                    <th className="px-6 py-4">Pays</th>
                    <th className="px-6 py-4">Ville / Zone</th>
                    <th className="px-6 py-4">Produit</th>
                    <th className="px-6 py-4">Prix</th>
                    <th className="px-6 py-4">Livreur</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {commandes.map((cmd) => {
                    // Hard rule: same country. The automatic routing already tried the
                    // livreurs of the order's zone; when it found nobody (or the manager
                    // wants to override), any livreur of the country can be chosen —
                    // those of the matching zone come first.
                    const memeZone = (l) =>
                      !!cmd.ville_zone && !!l.zone &&
                      cmd.ville_zone.toLowerCase().includes(l.zone.trim().toLowerCase());
                    const livreursFiltres = livreurs
                      .filter((l) => l.pays_id === cmd.pays_id)
                      .sort((a, b) => Number(memeZone(b)) - Number(memeZone(a)));

                    return (
                      <tr key={cmd.id} className="hover:bg-[#EEE9DF]/20 transition-colors">

                        <td className="px-6 py-4 font-mono text-sm text-[#1B2632]/80">
                          #{cmd.lead_id || 'N/A'}
                        </td>

                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString('fr-FR') : (cmd.created_at ? new Date(cmd.created_at).toLocaleDateString('fr-FR') : '-')}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-bold text-[#1B2632]">
                            {cmd.client_nom || 'Client inconnu'}
                          </div>
                          <div className="font-mono text-xs text-[#A35139] font-semibold mt-1">
                            {cmd.client_telephone || 'Aucun numéro'}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]">
                          {cmd.pays?.nom || '-'}
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.ville_zone || '-'}</div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.produit || '-'}</div>
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">Qté: {cmd.quantite || 1}</div>
                        </td>

                        <td className="px-6 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                          {cmd.prix !== null && cmd.prix !== undefined ? cmd.prix : '-'}
                        </td>

                        <td className="px-6 py-4">
                          {cmd.livreur_actuel && (
                            <div className="text-xs font-semibold text-[#1B2632] mb-1.5">
                              Actuel : <span className="bg-[#EEE9DF] px-2 py-0.5 rounded-md">{cmd.livreur_actuel}</span>
                            </div>
                          )}
                          <select
                            value={livreurChoisiParCommande[cmd.id] || ''}
                            onChange={(e) => choisirLivreur(cmd.id, e.target.value)}
                            className="border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] min-w-[180px] shadow-sm cursor-pointer"
                          >
                            <option value="">{cmd.livreur_actuel ? '-- changer --' : '-- choisir --'}</option>
                            {livreursFiltres.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nom} — {l.zone ? l.zone.trim() : 'sans zone'}{memeZone(l) ? ' ✓' : ''}
                              </option>
                            ))}
                          </select>
                          {livreursFiltres.length === 0 && (
                            <span className="text-[11px] font-semibold text-[#A35139] block mt-1.5">Aucun livreur dans ce pays</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => assigner(cmd.id)}
                            disabled={envoiEnCoursId === cmd.id || livreursFiltres.length === 0 || !hasPermission('assigner_livreur')}
                            title={!hasPermission('assigner_livreur') ? "Vous n'avez pas le droit d'assigner un livreur" : undefined}
                            className="px-4 py-2 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {envoiEnCoursId === cmd.id ? '...' : (cmd.livreur_actuel ? 'Changer' : 'Assigner')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[#C9C1B1]/40 bg-[#EEE9DF]/20">
              <span className="text-sm text-[#1B2632]/70 font-medium">
                Page {pageActuelle + 1} sur {totalPages}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPageActuelle((p) => Math.max(0, p - 1))}
                  disabled={pageActuelle === 0}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPageActuelle((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={pageActuelle >= totalPages - 1}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  Suivant
                </button>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}