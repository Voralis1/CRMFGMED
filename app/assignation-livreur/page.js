'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { texteNormalise } from '../../lib/texteNormalise.mjs'
import { useAuth } from '../context/AuthContext'
import { useEntrepot } from '../context/EntrepotContext'
import { usePermissions } from '../context/PermissionsContext'
import ResultatLot, { resumerLot } from '../components/ResultatLot'
import { useMessages } from '../components/Messages'
import { messageErreur } from '../../lib/messageErreur.mjs'
import { useLangue } from '../context/LangueContext'
// Le drapeau du pays dans la colonne Lieu (19/11).
import { drapeau } from '../../lib/paysMonde'

const TAILLE_PAGE = 50

export default function AssignationLivreurPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  // L'entrepôt regardé (en haut, 11/11). La vue « à assigner » n'a pas de colonne
  // entrepôt (vue sensible, §6.21 : pas touchée) : on filtre par SON pays — un
  // entrepôt par pays, Paramètres l'impose. Les livraisons : par l'entrepôt.
  const { entrepotId, entrepot } = useEntrepot()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()
  // Messages du CRM (24/11) au lieu des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages()
  // Les textes suivent la langue choisie (25/11).
  const { t, locale } = useLangue()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;

  const [commandes, setCommandes] = useState([])
  const [livreurs, setLivreurs] = useState([])
  // Les zones de l'entreprise : le ✓ d'un livreur se décide sur la zone de la
  // commande, comme dans la base (livreur_pour_commande).
  const [zones, setZones] = useState([])
  const [totalCommandes, setTotalCommandes] = useState(0)
  const [pageActuelle, setPageActuelle] = useState(0)
  const [comptes, setComptes] = useState({ a_assigner: null, assignees: null })
  const [chargement, setChargement] = useState(true)
  const [livreurChoisiParCommande, setLivreurChoisiParCommande] = useState({})
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null)
  // Sélection multiple (29/10), pour qui a `assigner_livreur` : ce qui est
  // coché est sur l'écran, jamais toute la base. Changer d'onglet ou de page
  // vide la sélection.
  const [selection, setSelection] = useState({})
  const [livreurLot, setLivreurLot] = useState('')
  const [lotEnCours, setLotEnCours] = useState(false)
  const [resultatLot, setResultatLot] = useState(null)
  const [refusParId, setRefusParId] = useState({})

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

    const [{ data, error }, { data: zonesData }] = await Promise.all([
      supabase
        .from('livreurs')
        .select('id, nom, zone, pays_id, user_id')
        .eq('tenant_id', tenantKey)
        .eq('actif', true)
        .order('nom'),
      supabase.from('zones').select('id, nom_zone, pays_id').eq('tenant_id', tenantKey),
    ])

    if (!error) setLivreurs(data || [])
    setZones(zonesData || [])
  }

  // Combien attendent dans chaque onglet (19/11) : deux comptes seuls (head),
  // avec les mêmes filtres que les listes, relus à chaque rechargement.
  async function chargerComptes() {
    let reqA = supabase.from('v_commandes_a_assigner').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantKey)
    if (entrepot?.pays_id) reqA = reqA.eq('pays_id', entrepot.pays_id)
    let reqB = supabase.from('livraisons')
      .select(`id${entrepotId ? ', commandes!inner(entrepot_id)' : ''}`, { count: 'exact', head: true })
      .eq('tenant_id', tenantKey).eq('statut', 'a_preparer')
    if (entrepotId) reqB = reqB.eq('commandes.entrepot_id', entrepotId)
    const [a, b] = await Promise.all([reqA, reqB])
    setComptes({ a_assigner: a.error ? null : (a.count ?? 0), assignees: b.error ? null : (b.count ?? 0) })
  }

  async function chargerCommandes(page, onglet) {
    if (!tenantKey) return
    setChargement(true)
    chargerComptes()

    const debut = page * TAILLE_PAGE
    const fin = debut + TAILLE_PAGE - 1

    if (onglet === 'a_assigner') {
      // La vue ne renvoie que les commandes confirmées sans livraison : c'est la
      // base qui fait le calcul, la page ne télécharge plus la table `livraisons`.
      let req = supabase
        .from('v_commandes_a_assigner')
        .select('*, pays(nom, code, devise)', { count: 'exact' })
        .eq('tenant_id', tenantKey)
      if (entrepot?.pays_id) req = req.eq('pays_id', entrepot.pays_id)
      const { data, error, count } = await req
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(debut, fin)

      if (error) annoncer(t('commun.chargementImpossible', { erreur: messageErreur(error) }), 'erreur')
      else {
        setCommandes((data || []).map((c) => ({ ...c, livreur_actuel: null })))
        setTotalCommandes(count || 0)
      }
    } else {
      // Livraisons pas encore parties : on peut encore changer le livreur.
      // Une fois « Expédiée », la marchandise est chez lui — changer de nom
      // sur l'écran ne la déplacerait pas.
      let req = supabase
        .from('livraisons')
        .select(`id, livreur_id, livreurs(nom), ${entrepotId ? 'commandes!inner' : 'commandes'}(*, pays(nom, code, devise))`, { count: 'exact' })
        .eq('tenant_id', tenantKey)
        .eq('statut', 'a_preparer')
      if (entrepotId) req = req.eq('commandes.entrepot_id', entrepotId)
      const { data, error, count } = await req
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(debut, fin)

      if (error) annoncer(t('commun.chargementImpossible', { erreur: messageErreur(error) }), 'erreur')
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
    setSelection({}); setRefusParId({})
  }, [pageActuelle, ongletActif, entrepotId])

  useEffect(() => {
    if (!tenantKey) return
    chargerCommandes(pageActuelle, ongletActif)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageActuelle, ongletActif, tenantKey, entrepotId])

  function choisirLivreur(commandeId, livreurId) {
    setLivreurChoisiParCommande((prec) => ({ ...prec, [commandeId]: livreurId }))
  }

  // Une commande seule passe par la même porte qu'un lot
  // (affecter_livreur_lot) : mêmes règles, même historique, avec qui l'a fait.
  // L'ancienne fonction assigner-livreur (clé service) ne savait pas qui
  // agissait.
  async function assigner(commandeId) {
    const livreurId = livreurChoisiParCommande[commandeId]
    if (!livreurId) {
      annoncer(t('assign.choisirAvant'), 'erreur')
      return
    }

    setEnvoiEnCoursId(commandeId)
    const { data, error } = await supabase.rpc('affecter_livreur_lot', { p_tenant: tenantKey, p_ids: [commandeId], p_livreur: livreurId })
    setEnvoiEnCoursId(null)

    if (error) { annoncer(messageErreur(error), 'erreur'); return }
    const r = (data || [])[0]
    if (r?.resultat === 'refuse') { annoncer(r.motif, 'erreur'); return }

    await chargerCommandes(pageActuelle, ongletActif)
  }

  // UN appel pour tout le lot : une connexion qui tombe ne laisse jamais un
  // lot à moitié écrit sans le savoir. Chaque commande est appliquée ou
  // refusée seule, avec sa raison ; les refusées restent cochées.
  async function assignerLot() {
    const lignes = commandes.filter((c) => selection[c.id])
    const livreur = livreurs.find((l) => l.id === livreurLot)
    if (!lignes.length || !livreur) return
    if (!(await confirmer({ titre: t('assign.confirmTitre'), message: t('assign.confirmMessage', { n: lignes.length, nom: livreur.nom }), bouton: t('assign.assigner') }))) return

    setLotEnCours(true)
    const { data, error } = await supabase.rpc('affecter_livreur_lot', { p_tenant: tenantKey, p_ids: lignes.map((c) => c.id), p_livreur: livreurLot })
    setLotEnCours(false)
    const action = t('assign.action', { nom: livreur.nom })
    if (error) {
      setResultatLot({ action, erreur: messageErreur(error) })
      return
    }
    const resume = resumerLot(action, data, lignes)
    setResultatLot(resume)
    setRefusParId(Object.fromEntries(resume.refus.map((r) => [r.id, r.motif])))
    setSelection(Object.fromEntries(resume.refus.map((r) => [r.id, true])))
    setLivreurLot('')
    await chargerCommandes(pageActuelle, ongletActif)
  }

  const totalPages = Math.max(1, Math.ceil(totalCommandes / TAILLE_PAGE))

  // Plusieurs commandes d'un coup (cases + barre du lot) : le droit d'assigner
  // PLUS « actions_masse » (30/10, sa décision ; la base refuse pareil). Le
  // menu d'une seule ligne ne demande que le droit d'assigner.
  const peutAgirEnMasse = hasPermission('assigner_livreur') && hasPermission('actions_masse')
  const lignesCochees = commandes.filter((c) => selection[c.id])
  const toutCoche = commandes.length > 0 && commandes.every((c) => selection[c.id])
  const basculerTout = () => setSelection(toutCoche ? {} : Object.fromEntries(commandes.map((c) => [c.id, true])))
  const basculer = (id) => setSelection((prec) => {
    const s = { ...prec }
    if (s[id]) delete s[id]; else s[id] = true
    return s
  })
  // Un livreur livre dans SON pays : seuls ceux du pays de toutes les commandes cochées.
  const livreursPourLot = livreurs.filter((l) => lignesCochees.every((c) => c.pays_id === l.pays_id))

  if (authLoading || permsLoading || !hasPermission('menu_assignation_livreur')) {
    return <div className="p-8 text-[#1B2632] font-medium">{t('commun.verificationAcces')}</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">

      {/* En-tête compact (19/11), comme les autres pages. */}
      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4 pt-4 sm:pt-2">
        <div className="flex justify-between items-end flex-wrap gap-4 px-6 md:px-0">
          <h1 className="text-2xl font-bold text-[#1B2632]">{t('assign.titre')}</h1>
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
            {t('assign.ongletAAssigner')}
            {/* En rouge quand quelque chose attend un livreur (19/11). */}
            {comptes.a_assigner !== null && (
              <span className={`ml-2 inline-flex min-w-[22px] justify-center px-1.5 rounded-full text-xs font-bold ${
                comptes.a_assigner > 0 ? 'bg-[#A35139] text-white' : (ongletActif === 'a_assigner' ? 'bg-white/20' : 'bg-[#EEE9DF] text-[#1B2632]/60')}`}>
                {comptes.a_assigner}
              </span>
            )}
          </button>
          <button
            onClick={() => { setOngletActif('assignees'); setPageActuelle(0) }}
            className={`px-4 sm:px-6 py-2.5 rounded-xl font-semibold text-sm transition-all cursor-pointer ${
              ongletActif === 'assignees'
                ? 'bg-[#1B2632] text-white shadow-md'
                : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
            }`}
          >
            {t('assign.ongletAssignees')}
            {comptes.assignees !== null && (
              <span className={`ml-2 inline-flex min-w-[22px] justify-center px-1.5 rounded-full text-xs font-bold ${
                ongletActif === 'assignees' ? 'bg-white/20' : 'bg-[#EEE9DF] text-[#1B2632]/60'}`}>
                {comptes.assignees}
              </span>
            )}
          </button>
        </div>

        <p className="px-6 md:px-0 text-sm text-[#1B2632]/60">
          {ongletActif === 'a_assigner'
            ? t('assign.aideAAssigner')
            : t('assign.aideAssignees')}
        </p>
      </header>

      {resultatLot && (
        <div className="mx-6 md:mx-0">
          <ResultatLot resultat={resultatLot} onFermer={() => setResultatLot(null)} />
        </div>
      )}

      {peutAgirEnMasse && lignesCochees.length > 0 && (
        <div className="mx-6 md:mx-0 flex flex-wrap items-center gap-3 bg-[#1B2632] text-white rounded-2xl px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold">
            {t('commun.cochees', { n: lignesCochees.length })}
            <span className="font-normal text-white/60">{t('commun.surCettePage')}</span>
          </span>
          <select
            value={livreurLot}
            onChange={(e) => setLivreurLot(e.target.value)}
            className="text-sm rounded-lg px-3 py-2 bg-white text-[#1B2632] outline-none max-w-full sm:max-w-[240px]"
          >
            <option value="">{t('assign.assignerA')}</option>
            {livreursPourLot.map((l) => <option key={l.id} value={l.id}>{l.nom} — {l.zone ? l.zone.trim() : t('commun.sansZone')}</option>)}
          </select>
          {livreursPourLot.length === 0 && (
            <span className="text-xs text-[#FFB162]">{t('assign.aucunLivreurPays')}</span>
          )}
          <button
            onClick={assignerLot}
            disabled={!livreurLot || lotEnCours}
            className="text-sm font-bold px-4 py-2 rounded-lg bg-[#FFB162] text-[#1B2632] disabled:opacity-50"
          >
            {lotEnCours ? t('assign.enCours') : t('assign.assigner')}
          </button>
          <button onClick={() => { setSelection({}); setRefusParId({}) }} className="text-xs font-semibold text-white/70 hover:text-white underline">
            {t('commun.toutDecocher')}
          </button>
        </div>
      )}

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col mx-6 md:mx-0">
        {chargement ? (
          <p className="text-sm text-[#1B2632]/60 p-6">{t('commun.chargement')}</p>
        ) : commandes.length === 0 ? (
          <p className="text-sm text-[#1B2632]/60 p-6">
            {ongletActif === 'a_assigner'
              ? t('assign.videAAssigner')
              : t('assign.videAssignees')}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto min-h-[400px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEE9DF]/30 border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                    {peutAgirEnMasse && (
                      <th className="pl-4 pr-1 py-4 w-[1%]">
                        {/* Coche ce qui est AFFICHÉ, jamais la base entière : le titre le dit. */}
                        <input type="checkbox" checked={toutCoche} onChange={basculerTout}
                          title={t('commun.cocherPage', { n: commandes.length })}
                          aria-label={t('commun.cocherPageCourt')} className="w-4 h-4 cursor-pointer accent-[#1B2632]" />
                      </th>
                    )}
                    <th className="px-6 py-4">{t('commun.leadId')}</th>
                    <th className="px-6 py-4">{t('commun.date')}</th>
                    <th className="px-6 py-4">{t('commun.client')}</th>
                    <th className="px-6 py-4">{t('commun.lieu')}</th>
                    <th className="px-6 py-4">{t('commun.produit')}</th>
                    <th className="px-6 py-4">{t('commun.prix')}</th>
                    <th className="px-6 py-4">{t('commun.livreur')}</th>
                    <th className="px-6 py-4 text-right">{t('commun.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9C1B1]/30">
                  {commandes.map((cmd) => {
                    // Règle dure : même pays. Le ✓ (et la première place) va au livreur que
                    // la BASE choisirait (livreur_pour_commande, 27/10) — jamais à un autre :
                    //   · la commande a une zone (de son pays) : le livreur de CETTE zone ;
                    //   · sinon : le livreur dont la zone EST la ville, aux accents, à la
                    //     casse et aux espaces près (texteNormalise = texte_normalise).
                    // Plus de « contient » : « Ben » ne vaut pas « Benguela ». Le choix à la
                    // main reste libre parmi tous les livreurs du pays.
                    const zoneCmd = cmd.zone_id ? zones.find((z) => z.id === cmd.zone_id && z.pays_id === cmd.pays_id) : null
                    const cible = zoneCmd ? texteNormalise(zoneCmd.nom_zone) : texteNormalise(cmd.ville_zone)
                    const memeZone = (l) => !!l.user_id && cible !== null && texteNormalise(l.zone) === cible;
                    const livreursFiltres = livreurs
                      .filter((l) => l.pays_id === cmd.pays_id)
                      .sort((a, b) => Number(memeZone(b)) - Number(memeZone(a)));

                    return (
                      <tr key={cmd.id} className="hover:bg-[#EEE9DF]/20 transition-colors">

                        {peutAgirEnMasse && (
                          <td className="pl-4 pr-1 py-4">
                            <input type="checkbox" checked={!!selection[cmd.id]} onChange={() => basculer(cmd.id)}
                              aria-label={t('commun.cocher', { lead: cmd.lead_id || t('commun.cetteCommande') })} className="w-4 h-4 cursor-pointer accent-[#1B2632]" />
                          </td>
                        )}

                        <td className="px-6 py-4 font-mono text-sm text-[#1B2632]/80 whitespace-nowrap">
                          #{cmd.lead_id || 'N/A'}
                          {refusParId[cmd.id] && (
                            <div><span title={refusParId[cmd.id]} className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md font-sans text-[10px] font-bold uppercase tracking-wide text-[#A35139] bg-[#A35139]/10 border border-[#A35139]/30 cursor-help">{t('commun.refuse')}</span></div>
                          )}
                        </td>

                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {cmd.date_commande ? new Date(cmd.date_commande).toLocaleDateString(locale) : (cmd.created_at ? new Date(cmd.created_at).toLocaleDateString(locale) : '-')}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-bold text-[#1B2632]">
                            {cmd.client_nom || t('commun.clientInconnu')}
                          </div>
                          <div className="font-mono text-xs text-[#1B2632]/75 font-semibold mt-1 whitespace-nowrap">
                            {cmd.client_telephone || t('commun.aucunNumero')}
                          </div>
                        </td>

                        {/* Le lieu (19/11) : drapeau, ville · pays, sans répéter un pays saisi comme ville. */}
                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632] whitespace-nowrap">
                          {cmd.pays?.code && <span className="mr-1.5">{drapeau(cmd.pays.code)}</span>}
                          {[cmd.ville_zone, cmd.pays?.nom].filter((v, i, t) => v && t.indexOf(v) === i).join(' · ') || '-'}
                        </td>

                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-[#1B2632]">{cmd.produit || '-'}</div>
                          <div className="text-xs text-[#1B2632]/50 mt-0.5">{t('commun.qte', { n: cmd.quantite || 1 })}</div>
                        </td>

                        <td className="px-6 py-4 font-bold text-sm text-[#1B2632] whitespace-nowrap">
                          {cmd.prix !== null && cmd.prix !== undefined
                            ? <>{Number(cmd.prix).toLocaleString(locale)}{cmd.pays?.devise && <span className="text-xs font-semibold text-[#1B2632]/50"> {cmd.pays.devise}</span>}</>
                            : '-'}
                        </td>

                        <td className="px-6 py-4">
                          {cmd.livreur_actuel && (
                            <div className="text-xs font-semibold text-[#1B2632] mb-1.5">
                              {t('assign.actuel')} <span className="bg-[#EEE9DF] px-2 py-0.5 rounded-md">{cmd.livreur_actuel}</span>
                            </div>
                          )}
                          <select
                            value={livreurChoisiParCommande[cmd.id] || ''}
                            onChange={(e) => choisirLivreur(cmd.id, e.target.value)}
                            className="border border-[#C9C1B1] rounded-xl px-3 py-2 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] min-w-[180px] shadow-sm cursor-pointer"
                          >
                            <option value="">{t('assign.choisirLivreur')}</option>
                            {livreursFiltres.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nom} — {l.zone ? l.zone.trim() : t('commun.sansZone')}{memeZone(l) ? ' ✓' : ''}
                              </option>
                            ))}
                          </select>
                          {livreursFiltres.length === 0 && (
                            <span className="text-[11px] font-semibold text-[#A35139] block mt-1.5">{t('assign.aucunLivreurDansPays')}</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => assigner(cmd.id)}
                            disabled={envoiEnCoursId === cmd.id || livreursFiltres.length === 0 || !hasPermission('assigner_livreur') || !livreurChoisiParCommande[cmd.id]}
                            title={!hasPermission('assigner_livreur') ? t('assign.pasLeDroit') : (!livreurChoisiParCommande[cmd.id] ? t('assign.choisirDabord') : undefined)}
                            className="px-4 py-2 bg-[#1B2632] hover:bg-[#2C3B4D] text-white rounded-lg text-sm font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {envoiEnCoursId === cmd.id ? '...' : (cmd.livreur_actuel ? t('assign.changer') : t('assign.assigner'))}
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
                {t('commun.pageSur', { page: pageActuelle + 1, total: totalPages })}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPageActuelle((p) => Math.max(0, p - 1))}
                  disabled={pageActuelle === 0}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  {t('commun.precedent')}
                </button>
                <button
                  onClick={() => setPageActuelle((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={pageActuelle >= totalPages - 1}
                  className="px-4 py-2 bg-white text-[#1B2632] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-[#C9C1B1] shadow-sm cursor-pointer"
                >
                  {t('commun.suivant')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}