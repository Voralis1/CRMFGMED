'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import * as XLSX from 'xlsx'

const TAILLES_PAGE = [10, 25, 50, 100]

// Les quatre statuts que la base connaît aujourd'hui. Les neuf statuts de
// ShipLead (queued, prepared, shipped…) ne sont pas encore tranchés : tant
// qu'ils ne le sont pas, on affiche ce qui existe vraiment plutôt que des
// libellés que la base ne saurait pas enregistrer.
const STATUTS = {
  en_attente:  { label: 'En attente',  couleur: '#C98A2B' },
  livre:       { label: 'Livré',       couleur: '#2E7D53' },
  injoignable: { label: 'Injoignable', couleur: '#6B7A8C' },
  retour:      { label: 'Retour',      couleur: '#A35139' },
}

const STATUTS_SAISISSABLES = ['livre', 'injoignable', 'retour']
const STATUTS_TERMINES = ['livre', 'injoignable', 'retour']

// La recherche porte sur la commande, pas sur la livraison : c'est le numéro
// de suivi ou le téléphone du client qu'on a sous les yeux quand on cherche.
const CHAMPS_RECHERCHE = [
  { cle: 'tracking_number', nom: 'N° de suivi' },
  { cle: 'lead_id', nom: 'Lead ID' },
  { cle: 'client_telephone', nom: 'Téléphone client' },
  { cle: 'client_nom', nom: 'Nom du client' },
]

// « Toutes » en premier et par défaut : une livraison marquée « Livré » doit
// rester dans la liste avec son nouveau statut, pas en disparaître. C'est
// exactement ce que montre ShipLead — une seule liste, la colonne Statut fait
// la différence. Les deux autres vues ne sont qu'un raccourci.
const VUES = [
  { cle: 'toutes', nom: 'Toutes' },
  { cle: 'a_faire', nom: 'À effectuer' },
  { cle: 'historique', nom: 'Historique' },
]

const FILTRES_VIDES = { statut: '', zone: '', livreur: '', vendeur: '', du: '', au: '' }

const nombre = (v) =>
  Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function PillStatut({ statut }) {
  const conf = STATUTS[statut] || { label: statut || 'N/A', couleur: '#6B7A8C' }
  return (
    <span
      className="inline-flex items-center justify-center min-w-[112px] px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap bg-white"
      style={{ color: conf.couleur, border: `1px solid ${conf.couleur}66` }}
    >
      {conf.label}
    </span>
  )
}

export default function LivraisonsPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const estLivreur = String(roleNom || '').toLowerCase() === 'livreur'

  const [livraisons, setLivraisons] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [parPage, setParPage] = useState(50)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [nomAffiche, setNomAffiche] = useState('')

  // Saisi d'un côté, appliqué de l'autre : la liste ne bouge qu'au clic.
  // Sans ça chaque caractère tapé relancerait une requête sur toute la table.
  const [vue, setVue] = useState('toutes')
  const [champRecherche, setChampRecherche] = useState('tracking_number')
  const [recherche, setRecherche] = useState('')
  const [filtres, setFiltres] = useState(FILTRES_VIDES)
  const [filtresActifs, setFiltresActifs] = useState({ ...FILTRES_VIDES, champ: 'tracking_number', texte: '' })
  const [panneauOuvert, setPanneauOuvert] = useState(false)

  const [listeZones, setListeZones] = useState([])
  const [listeLivreurs, setListeLivreurs] = useState([])
  const [listeVendeurs, setListeVendeurs] = useState([])
  const [lignesOuvertes, setLignesOuvertes] = useState(() => new Set())

  // Fiche détail + formulaire de traitement
  const [detail, setDetail] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('livre')
  const [motifTexte, setMotifTexte] = useState('')
  const [montant, setMontant] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  // Ce que le livreur détient et n'a pas encore remis. La somme est faite par
  // la base (vue v_caisses_livreur) : un total calculé sur une liste paginée
  // serait faux sans que rien ne le dise.
  const [maCaisse, setMaCaisse] = useState([])

  const peutTraiter = hasPermission('gerer_livraison')

  // Les responsables voient l'organisation interne : quel livreur porte le
  // colis, et pour quel vendeur il est traité. Le vendeur, lui, confie la
  // livraison à FGMED — qui la porte ne le regarde pas (même logique que la
  // caisse, fiche de passation 8.5) — et il ne voit de toute façon que ses
  // propres commandes. Le livreur non plus : la colonne Livreur ne dirait que
  // son propre nom sur chaque ligne.
  const ROLES_RESPONSABLES = ['manager', 'admin', 'ceo', 'super_admin']
  const estResponsable = ROLES_RESPONSABLES.includes(String(roleNom || '').toLowerCase())

  // Le nom derrière `commandes.vendeur_id`. `vendeur_id` pointe sur
  // `auth.users`, que PostgREST ne sait pas joindre : on résout par la liste
  // déjà chargée, exactement comme la page Commandes.
  const nomDuVendeur = (id) => {
    if (!id) return null
    const v = listeVendeurs.find((x) => x.user_id === id)
    return v ? (v.nom || v.email || '—') : null
  }

  const nombreFiltresActifs = useMemo(
    () => Object.values(filtres).filter((v) => v !== '').length,
    [filtres],
  )

  // ------------------------------------------------------------------
  // Accès
  // ------------------------------------------------------------------
  useEffect(() => {
    if (authLoading || permsLoading) return
    if (!user) router.replace('/')
    else if (!hasPermission('menu_livraisons')) router.replace('/dashboard')
  }, [user, authLoading, permsLoading, hasPermission, router])

  // ------------------------------------------------------------------
  // Caisse, zones, livreurs, nom affiché
  // ------------------------------------------------------------------
  const chargerMaCaisse = useCallback(async () => {
    if (!tenantId || !hasPermission('voir_caisse')) return
    // La vue tourne avec les droits de l'appelant : un livreur n'y trouve que
    // sa propre ligne, un responsable celles de toute l'entreprise.
    const { data } = await supabase
      .from('v_caisses_livreur')
      .select('livreur_nom, devise, total, nb_paiements')
      .eq('tenant_id', tenantId)
    setMaCaisse(data || [])
  }, [tenantId, hasPermission])

  useEffect(() => { chargerMaCaisse() }, [chargerMaCaisse])

  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantId) return

    async function initialiser() {
      // Le nom vient de la fiche livreur, sinon de la fiche agent, sinon de
      // l'e-mail. L'ancienne version cherchait toujours dans `agents` : un
      // livreur y voyait son e-mail à la place de son nom.
      const { data: fiche } = await supabase
        .from('livreurs').select('nom').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle()
      let nom = fiche?.nom
      if (!nom) {
        const { data: ag } = await supabase
          .from('agents').select('nom').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle()
        nom = ag?.nom
      }
      setNomAffiche(nom || user.email)

      const { data: zones } = await supabase
        .from('zones').select('id, nom_zone, frais_livraison, frais_retour')
        .eq('tenant_id', tenantId).order('nom_zone')
      setListeZones(zones || [])

      if (estResponsable) {
        const { data: livs } = await supabase
          .from('livreurs').select('id, nom').eq('tenant_id', tenantId).order('nom')
        setListeLivreurs(livs || [])

        // La RLS fait le tri : un responsable reçoit l'équipe, un seller ne
        // recevrait que sa propre ligne — raison de plus pour ne demander
        // cette liste que lorsqu'elle sert.
        const { data: vends } = await supabase
          .from('user_roles').select('user_id, nom, email, role')
          .eq('tenant_id', tenantId).eq('role', 'seller')
        setListeVendeurs(vends || [])
      }
    }

    initialiser()
  }, [user, authLoading, permsLoading, tenantId, estResponsable])

  // ------------------------------------------------------------------
  // Construction de la requête — une seule fonction pour la liste et l'export
  // ------------------------------------------------------------------
  const construireRequete = useCallback(async () => {
    // Un livreur ne voit que ses propres livraisons. La base applique déjà la
    // règle (RLS) ; l'écran ne fait que demander ce qu'il a le droit de lire.
    let monLivreurId = null
    if (estLivreur) {
      const { data: moi } = await supabase
        .from('livreurs').select('id').eq('user_id', user?.id).eq('tenant_id', tenantId).maybeSingle()
      if (!moi) return null
      monLivreurId = moi.id
    }

    const texte = (filtresActifs.texte || '').trim()

    // La jointure n'est interne QUE si un filtre porte sur la commande.
    //
    // `!inner` oblige Postgres à joindre `commandes` avant de compter, et la
    // policy RLS de `commandes` est alors évaluée sur chaque ligne : sur la
    // vue « Toutes », le COUNT exact ne revenait jamais et l'écran restait sur
    // « Chargement... ». Sans filtre sur la commande, on compte `livraisons`
    // seules et la commande n'est résolue que pour les 50 lignes affichées.
    const filtreSurCommande = Boolean(texte) || Boolean(filtresActifs.zone) || Boolean(filtresActifs.vendeur)
    const jointure = filtreSurCommande ? 'commandes!inner' : 'commandes'

    // `*` et non une liste de colonnes : une seule colonne absente de la base
    // (`adresse`, `tracking_number`…) fait rejeter TOUTE la requête, et la page
    // reste vide sans qu'on sache laquelle. Avec `*`, une colonne qui n'existe
    // pas encore s'affiche simplement « — ». C'est ce que font déjà Commandes
    // et Assignation livreur.
    // On ne DEMANDE le nom du livreur que si on a le droit de le voir.
    // Masquer la colonne ne suffirait pas : la donnée arriverait quand même
    // dans la réponse réseau, lisible en deux clics.
    const embedLivreur = estResponsable ? 'livreurs(nom),' : ''

    let r = supabase
      .from('livraisons')
      .select(`
        id, statut, created_at, motif_retour, livreur_id,
        ${embedLivreur}
        ${jointure}(
          *,
          pays(nom, devise),
          zones(nom_zone, frais_livraison, frais_retour)
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)

    if (monLivreurId) r = r.eq('livreur_id', monLivreurId)

    // La vue pose le cadre, le filtre Statut affine à l'intérieur.
    if (filtresActifs.statut) r = r.eq('statut', filtresActifs.statut)
    else if (vue === 'a_faire') r = r.eq('statut', 'en_attente')
    else if (vue === 'historique') r = r.in('statut', STATUTS_TERMINES)

    if (filtresActifs.zone) r = r.eq('commandes.zone_id', filtresActifs.zone)
    if (filtresActifs.vendeur) r = r.eq('commandes.vendeur_id', filtresActifs.vendeur)
    if (filtresActifs.livreur) r = r.eq('livreur_id', filtresActifs.livreur)
    if (filtresActifs.du) r = r.gte('created_at', filtresActifs.du)
    if (filtresActifs.au) r = r.lte('created_at', `${filtresActifs.au}T23:59:59`)

    if (texte) r = r.ilike(`commandes.${filtresActifs.champ}`, `%${texte}%`)

    // ⚠️ On rend la requête DANS UN OBJET, et surtout pas toute nue.
    //
    // Un builder Supabase est « thenable » : il possède un `.then()`. Une
    // fonction `async` qui le renvoie tel quel se fait donc déballer par
    // `await` — la requête part toute seule et l'appelant reçoit
    // `{ data, error }` au lieu du builder, d'où « requete.range is not a
    // function ». L'objet qui l'enveloppe n'est pas thenable : il traverse
    // `await` intact.
    return { requete: r.order('created_at', { ascending: false }).order('id', { ascending: false }) }
  }, [tenantId, estLivreur, estResponsable, user?.id, vue, filtresActifs])

  const charger = useCallback(async () => {
    if (permsLoading) return

    // Aucun chemin ne doit laisser le tableau sur « Chargement... » : tant que
    // ce spinner tourne sans fin, personne ne sait si la requête est lente, en
    // erreur, ou jamais partie. On sort donc toujours par `finally`.
    setChargement(true)
    setErreur('')

    try {
      if (!tenantId) {
        setLivraisons([]); setTotal(0)
        setErreur("Aucune entreprise active sur ce compte : impossible de charger les livraisons.")
        return
      }

      const construite = await construireRequete()
      if (!construite) {
        setLivraisons([]); setTotal(0)
        setErreur("Aucune fiche livreur rattachée à ce compte : rien à afficher.")
        return
      }
      const { requete } = construite

      const debut = page * parPage
      const { data, error, count } = await requete.range(debut, debut + parPage - 1)

      if (error) {
        // Le texte brut de la base, pas un message maison : « column
        // commandes.adresse does not exist » dit tout de suite quoi corriger,
        // là où « Erreur de chargement » oblige à ouvrir la console.
        setErreur([error.message, error.details, error.hint].filter(Boolean).join(' — '))
        setLivraisons([]); setTotal(0)
      } else {
        setLivraisons(data || [])
        setTotal(count || 0)
      }
    } catch (e) {
      setErreur(e?.message || 'Erreur inattendue pendant le chargement.')
      setLivraisons([]); setTotal(0)
    } finally {
      setChargement(false)
    }
  }, [tenantId, permsLoading, construireRequete, page, parPage])

  useEffect(() => { charger() }, [charger])

  // Changer de vue, de filtre ou de taille de page ramène à la page 1 :
  // rester sur la page 7 d'un résultat qui n'en compte que 2 affiche du vide.
  useEffect(() => { setPage(0) }, [vue, filtresActifs, parPage])

  function appliquerFiltres() {
    setFiltresActifs({ ...filtres, champ: champRecherche, texte: recherche })
  }

  function reinitialiserFiltres() {
    setFiltres(FILTRES_VIDES)
    setRecherche('')
    setFiltresActifs({ ...FILTRES_VIDES, champ: champRecherche, texte: '' })
  }

  function basculerLigne(id) {
    setLignesOuvertes((prev) => {
      const suivant = new Set(prev)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })
  }

  // ------------------------------------------------------------------
  // Export : tout ce que les filtres retiennent, pas seulement la page
  // ------------------------------------------------------------------
  const [exportEnCours, setExportEnCours] = useState(false)

  async function exporterExcel() {
    setExportEnCours(true)
    const construite = await construireRequete()
    if (!construite) { setExportEnCours(false); return }
    const { requete } = construite

    // Plafond volontaire : au-delà, le navigateur construit un fichier de
    // plusieurs dizaines de Mo et l'onglet se fige sans rien dire.
    const { data, error } = await requete.range(0, 4999)
    setExportEnCours(false)

    if (error) { alert('Erreur export : ' + error.message); return }
    if (!data || data.length === 0) { alert('Aucune livraison à exporter avec ces filtres.'); return }

    const lignes = data.map((l) => ({
      'Lead ID': l.commandes?.lead_id || '',
      'Date': l.created_at ? new Date(l.created_at).toLocaleString('fr-FR') : '',
      'N° de suivi': l.commandes?.tracking_number || '',
      'Client': l.commandes?.client_nom || '',
      'Téléphone': l.commandes?.client_telephone || '',
      'Adresse': l.commandes?.adresse || '',
      'Ville / Zone': l.commandes?.ville_zone || '',
      'Produit': l.commandes?.produit || '',
      'Quantité': l.commandes?.quantite ?? 1,
      'Prix': l.commandes?.prix ?? 0,
      'Devise': l.commandes?.pays?.devise || '',
      'Livreur': l.livreurs?.nom || '',
      'Vendeur': estResponsable ? (nomDuVendeur(l.commandes?.vendeur_id) || '') : '',
      'Statut': STATUTS[l.statut]?.label || l.statut || '',
      'Motif de retour': l.motif_retour || '',
    }))

    const feuille = XLSX.utils.json_to_sheet(lignes)
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Livraisons')
    XLSX.writeFile(classeur, `livraisons_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ------------------------------------------------------------------
  // Traitement d'une livraison
  // ------------------------------------------------------------------
  function ouvrirDetail(liv) {
    setDetail(liv)
    setStatutChoisi('livre')
    setMotifTexte('')
    setMontant(liv.commandes?.prix ?? '')
  }

  async function envoyerConfirmation() {
    setEnvoiEnCours(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/'); return }

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirmer-livraison`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          livraison_id: detail.id,
          statut: statutChoisi,
          motif_retour: statutChoisi === 'retour' ? motifTexte.trim() : null,
          montant_a_encaisser: statutChoisi === 'livre' ? Number(montant) || 0 : 0,
        }),
      },
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)
    if (resultat.error) { alert('Erreur : ' + resultat.error); return }

    setDetail(null)
    await charger()
    // Le montant vient d'être encaissé : la caisse affichée doit suivre.
    await chargerMaCaisse()
  }

  const totalPages = Math.max(1, Math.ceil(total / parPage))
  const premier = total === 0 ? 0 : page * parPage + 1
  const dernier = Math.min(total, (page + 1) * parPage)
  const zoneDetail = detail?.commandes?.zones

  if (authLoading || permsLoading || !hasPermission('menu_livraisons')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  const nbColonnes = estResponsable ? 9 : 7

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">

      <style>{`
        .lv-label { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(27,38,50,.55); margin-bottom:6px; }
        .lv-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .lv-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        @keyframes popInLv { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in-lv { animation: popInLv .18s ease-out; }
      `}</style>

      {/* En-tête */}
      <header className="flex justify-between items-start flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Centre logistique{nomAffiche ? ` • ${nomAffiche}` : ''}
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">Livraisons</h1>
        </div>

        {/* Affichée même à zéro : un livreur qui ne voit rien croit que l'écran
            est cassé, alors qu'il n'a simplement pas encore encaissé. */}
        {hasPermission('voir_caisse') && (
          <div className="bg-[#1B2632] text-white rounded-2xl px-5 py-3.5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-1">
              {maCaisse.length === 1 ? 'Ma caisse — non remise' : 'Caisses — non remises'}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {maCaisse.length === 0 && (
                <span className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold font-mono">0,00</span>
                  <span className="text-[11px] text-white/40">· rien encaissé pour l&apos;instant</span>
                </span>
              )}
              {maCaisse.map((c, i) => (
                <span key={`${c.livreur_nom}-${c.devise}-${i}`} className="flex items-baseline gap-1.5">
                  {maCaisse.length > 1 && <span className="text-xs text-white/50">{c.livreur_nom}</span>}
                  <span className="text-xl font-bold font-mono">{nombre(c.total)}</span>
                  <span className="text-xs text-white/60">{c.devise}</span>
                  <span className="text-[11px] text-white/40">· {c.nb_paiements} encaissement{c.nb_paiements > 1 ? 's' : ''}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Barre de recherche + filtres */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm">
        <div className="p-3 flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-0">
          <select
            value={champRecherche}
            onChange={(e) => setChampRecherche(e.target.value)}
            className="px-3 py-2.5 bg-[#F4F0E6] border border-[#C9C1B1] rounded-xl sm:rounded-l-xl sm:rounded-r-none sm:border-r-0 text-sm font-semibold text-[#1B2632] outline-none cursor-pointer"
          >
            {CHAMPS_RECHERCHE.map((c) => <option key={c.cle} value={c.cle}>{c.nom}</option>)}
          </select>

          <input
            type="text"
            inputMode={champRecherche === 'client_telephone' ? 'tel' : 'text'}
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') appliquerFiltres() }}
            placeholder={CHAMPS_RECHERCHE.find((c) => c.cle === champRecherche)?.nom}
            className="flex-1 min-w-0 px-4 py-2.5 border border-[#C9C1B1] sm:border-x-0 rounded-xl sm:rounded-none text-sm text-[#1B2632] outline-none focus:border-[#FFB162] placeholder:text-[#1B2632]/30"
          />

          <div className="flex gap-2 sm:gap-0">
            <button
              onClick={appliquerFiltres}
              className="flex-1 sm:flex-none px-4 py-2.5 sm:py-0 rounded-xl sm:rounded-none bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors flex items-center justify-center gap-2 font-semibold text-sm cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <span className="sm:hidden">Rechercher</span>
            </button>

            <button
              onClick={() => setPanneauOuvert((o) => !o)}
              className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-0 rounded-xl sm:rounded-l-none sm:rounded-r-xl border transition-colors flex items-center justify-center gap-2 font-semibold text-sm cursor-pointer ${
                panneauOuvert || nombreFiltresActifs > 0
                  ? 'bg-[#1B2632] text-white border-[#1B2632]'
                  : 'bg-white text-[#1B2632] border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
              }`}
            >
              <span className="sm:hidden">Filtres</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                   style={{ transform: panneauOuvert ? 'rotate(180deg)' : 'none' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {nombreFiltresActifs > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFB162] text-[#1B2632] text-[11px] font-bold flex items-center justify-center">
                  {nombreFiltresActifs}
                </span>
              )}
            </button>
          </div>
        </div>

        {panneauOuvert && (
          <div className="border-t border-[#C9C1B1]/50 px-5 py-5">
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${estResponsable ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`}>
              <div>
                <label className="lv-label">Statut</label>
                <select className="lv-input" value={filtres.statut}
                  onChange={(e) => setFiltres({ ...filtres, statut: e.target.value })}>
                  <option value="">Tous</option>
                  {Object.entries(STATUTS).map(([cle, s]) => <option key={cle} value={cle}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="lv-label">Zone</label>
                <select className="lv-input" value={filtres.zone}
                  onChange={(e) => setFiltres({ ...filtres, zone: e.target.value })}>
                  <option value="">Toutes</option>
                  {listeZones.map((z) => <option key={z.id} value={z.id}>{z.nom_zone}</option>)}
                </select>
              </div>

              {estResponsable && (
                <div>
                  <label className="lv-label">Livreur</label>
                  <select className="lv-input" value={filtres.livreur}
                    onChange={(e) => setFiltres({ ...filtres, livreur: e.target.value })}>
                    <option value="">Tous</option>
                    {listeLivreurs.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
                  </select>
                </div>
              )}

              {estResponsable && (
                <div>
                  <label className="lv-label">Vendeur</label>
                  <select className="lv-input" value={filtres.vendeur}
                    onChange={(e) => setFiltres({ ...filtres, vendeur: e.target.value })}>
                    <option value="">Tous</option>
                    {listeVendeurs.map((v) => (
                      <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="lv-label">Période</label>
                <div className="flex flex-col sm:flex-row items-stretch gap-1.5">
                  <input type="date" className="lv-input" value={filtres.du}
                    onChange={(e) => setFiltres({ ...filtres, du: e.target.value })} />
                  <input type="date" className="lv-input" value={filtres.au}
                    onChange={(e) => setFiltres({ ...filtres, au: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3 mt-5">
              <button onClick={reinitialiserFiltres}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 2v6h6" /><path d="M3.5 13a9 9 0 1 0 2.6-5.4L3 8" /></svg>
                Réinitialiser
              </button>
              <button onClick={appliquerFiltres}
                className="flex items-center justify-center gap-2 px-8 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                Filtrer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">

        <div className="flex flex-wrap items-center gap-3 px-5 sm:px-6 py-5">
          <h2 className="text-2xl font-bold text-[#A35139]">Livraisons</h2>

          {/* La pastille affiche la tranche en cours ; le menu, lui, change le
              nombre de lignes. Un <select> ne sait montrer que le libellé de
              l'option choisie, d'où le vrai texte au-dessus et le select
              transparent par-dessus — qui garde le menu natif du téléphone. */}
          <div className="relative inline-flex items-center pl-4 pr-9 py-2 rounded-xl border border-[#C9C1B1] bg-[#F4F0E6]">
            <span className="text-sm font-semibold text-[#1B2632] whitespace-nowrap">
              {total === 0 ? '0 / 0' : `${premier} - ${dernier} / ${total}`}
            </span>
            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1B2632" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
            <select
              value={parPage}
              onChange={(e) => setParPage(Number(e.target.value))}
              title="Lignes par page"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {TAILLES_PAGE.map((t) => <option key={t} value={t}>{t} par page</option>)}
            </select>
          </div>

          {/* Les trois vues restent à portée de clic : le livreur ouvre la page
              pour faire ses livraisons, pas pour composer un filtre. */}
          <div className="flex gap-1.5 bg-[#F4F0E6] p-1 rounded-xl border border-[#C9C1B1]/60">
            {VUES.map((v) => (
              <button
                key={v.cle}
                onClick={() => { setVue(v.cle); setLignesOuvertes(new Set()) }}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  vue === v.cle ? 'bg-[#1B2632] text-white shadow-sm' : 'text-[#1B2632]/70 hover:text-[#1B2632]'
                }`}
              >
                {v.nom}
              </button>
            ))}
          </div>

          <button
            onClick={exporterExcel}
            disabled={exportEnCours || total === 0}
            className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#A35139] text-white text-sm font-bold hover:bg-[#8a422d] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
            {exportEnCours ? 'Export...' : 'Export to Excel'}
          </button>
        </div>

        {erreur && (
          <div className="mx-5 sm:mx-6 mb-4 px-4 py-3 rounded-xl bg-[#A35139]/10 border border-[#A35139]/30 text-sm text-[#A35139] font-medium">
            {erreur}
          </div>
        )}

        <div className="overflow-auto min-h-[400px] max-h-[72vh]">
          <table className="w-full min-w-[1050px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#C9D3DD] text-[11px] uppercase tracking-wider text-[#1B2632]/70 font-bold">
                <th className="px-5 py-3.5">Lead ID</th>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">N° de suivi</th>
                <th className="px-5 py-3.5">Commande</th>
                <th className="px-5 py-3.5">Zone</th>
                {estResponsable && <th className="px-5 py-3.5">Livreur</th>}
                {estResponsable && <th className="px-5 py-3.5">Vendeur</th>}
                <th className="px-5 py-3.5">Statut</th>
                <th className="px-5 py-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {chargement ? (
                <tr><td colSpan={nbColonnes} className="px-5 py-14 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : livraisons.length === 0 ? (
                <tr><td colSpan={nbColonnes} className="px-5 py-14 text-center text-[#1B2632]/60">Aucune livraison avec ces critères.</td></tr>
              ) : (
                livraisons.map((liv, i) => {
                  const c = liv.commandes || {}
                  const ouverte = lignesOuvertes.has(liv.id)
                  return (
                    <tr key={liv.id} className={i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'}>
                      <td className="px-5 py-4 align-top font-mono text-sm font-semibold text-[#1B2632] whitespace-nowrap">
                        {c.lead_id || '—'}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-[#1B2632]/75 whitespace-nowrap">
                        {liv.created_at ? new Date(liv.created_at).toLocaleDateString('fr-CA') : '—'}
                      </td>
                      <td className="px-5 py-4 align-top font-mono text-sm text-[#1B2632] whitespace-nowrap">
                        {c.tracking_number || '—'}
                      </td>

                      {/* Colonne dépliable : le détail tient sous la ligne, sans
                          ouvrir la fiche, quand on veut juste vérifier un produit. */}
                      <td className="px-5 py-4 align-top">
                        <button
                          onClick={() => basculerLigne(liv.id)}
                          className="flex items-start gap-2 text-left cursor-pointer group"
                        >
                          <span className="text-sm leading-tight">
                            <span className="font-bold text-[#A35139]">1</span>{' '}
                            <span className="text-[#1B2632]/80">produit</span>
                            <span className="block text-xs text-[#1B2632]/55">Quantité : <b className="text-[#1B2632]">{c.quantite ?? 1}</b></span>
                          </span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A35139" strokeWidth="2.5" strokeLinecap="round"
                               className="mt-0.5 shrink-0 transition-transform group-hover:opacity-70"
                               style={{ transform: ouverte ? 'rotate(180deg)' : 'none' }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>

                        {ouverte && (
                          <div className="mt-3 rounded-xl border border-[#C9C1B1]/70 bg-white px-4 py-3 text-xs flex flex-col gap-1.5 min-w-[240px]">
                            <div className="flex justify-between gap-4">
                              <span className="text-[#1B2632]/50">Produit</span>
                              <span className="font-semibold text-[#1B2632] text-right">{c.produit || '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-[#1B2632]/50">Prix</span>
                              <span className="font-mono font-bold text-[#1B2632]">{c.prix ?? '—'} {c.pays?.devise || ''}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-[#1B2632]/50">Client</span>
                              <span className="font-semibold text-[#1B2632] text-right">{c.client_nom || '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-[#1B2632]/50">Téléphone</span>
                              {c.client_telephone
                                ? <a href={`tel:${c.client_telephone}`} className="font-mono font-semibold text-[#A35139] hover:underline">{c.client_telephone}</a>
                                : <span className="text-[#1B2632]/40">—</span>}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4 align-top text-sm text-[#1B2632]/80">
                        {c.zones?.nom_zone || c.ville_zone || '—'}
                      </td>

                      {estResponsable && (
                        <td className="px-5 py-4 align-top text-sm text-[#1B2632]/80">
                          {liv.livreurs?.nom || <span className="text-[#1B2632]/35">Non assigné</span>}
                        </td>
                      )}

                      {estResponsable && (
                        <td className="px-5 py-4 align-top text-sm text-[#1B2632]/80">
                          {nomDuVendeur(c.vendeur_id) || <span className="text-[#1B2632]/35">—</span>}
                        </td>
                      )}

                      <td className="px-5 py-4 align-top">
                        <PillStatut statut={liv.statut} />
                        {liv.statut === 'retour' && liv.motif_retour && (
                          <span className="block mt-1.5 text-[11px] text-[#A35139]">Motif : {liv.motif_retour}</span>
                        )}
                      </td>

                      <td className="px-5 py-4 align-top text-center">
                        <button
                          onClick={() => ouvrirDetail(liv)}
                          title="Voir la fiche"
                          className="w-9 h-9 rounded-lg text-[#1B2632]/70 hover:text-[#A35139] hover:bg-[#EEE9DF] transition-colors inline-flex items-center justify-center cursor-pointer"
                        >
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
          <span className="text-sm text-[#1B2632]/70 font-medium">
            {total === 0 ? 'Aucune livraison' : `${premier} – ${dernier} sur ${total}`} · Page {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || chargement}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
            >
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || chargement}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer"
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      {/* Fiche détail + traitement */}
      {detail && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setDetail(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1000px] my-8 pop-in-lv">

              <div className="flex items-center gap-3 px-8 pt-7 pb-6">
                <button
                  onClick={() => setDetail(null)} title="Retour"
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">Détail de la livraison</h2>
                <div className="ml-auto"><PillStatut statut={detail.statut} /></div>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-5">

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <CarteDetail titre="Livraison">
                    <LigneDetail label="Lead ID" valeur={detail.commandes?.lead_id} mono />
                    <LigneDetail label="N° de suivi" valeur={detail.commandes?.tracking_number} mono />
                    <LigneDetail
                      label="Créée le"
                      valeur={detail.created_at ? new Date(detail.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null}
                    />
                    <LigneDetail label="Livreur" valeur={detail.livreurs?.nom} />
                    {estResponsable && <LigneDetail label="Vendeur" valeur={nomDuVendeur(detail.commandes?.vendeur_id)} />}
                    <LigneDetail label="Statut" valeur={STATUTS[detail.statut]?.label || detail.statut} />
                    <LigneDetail label="Motif de retour" valeur={detail.motif_retour} />
                  </CarteDetail>

                  <CarteDetail titre="Client">
                    <LigneDetail label="Nom" valeur={detail.commandes?.client_nom} />
                    {detail.commandes?.client_telephone ? (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-[#1B2632]/45 w-[110px] shrink-0">Téléphone</span>
                        {/* Cliquable : le livreur appelle sans recopier le
                            numéro, et ne se trompe pas d'un chiffre. */}
                        <a href={`tel:${detail.commandes.client_telephone}`}
                          className="text-sm font-mono font-semibold text-[#A35139] hover:underline">
                          {detail.commandes.client_telephone}
                        </a>
                      </div>
                    ) : <LigneDetail label="Téléphone" valeur={null} />}
                    <LigneDetail label="Adresse" valeur={detail.commandes?.adresse} />
                    <LigneDetail label="Pays" valeur={detail.commandes?.pays?.nom} />
                    <LigneDetail label="Ville / Zone" valeur={detail.commandes?.ville_zone} />
                  </CarteDetail>

                  <CarteDetail titre="Tarifs de la zone">
                    {zoneDetail ? (
                      <>
                        <LigneDetail label="Zone" valeur={zoneDetail.nom_zone} />
                        <LigneDetail label="Frais livraison" valeur={zoneDetail.frais_livraison} mono />
                        <LigneDetail label="Frais retour" valeur={zoneDetail.frais_retour ?? 0} mono />
                      </>
                    ) : (
                      <p className="text-xs text-[#8a5a1f] bg-[#FFB162]/15 border border-[#FFB162]/40 rounded-lg px-3 py-2.5 font-medium">
                        Aucune zone tarifaire pour « {detail.commandes?.ville_zone || 'non spécifiée'} ».
                      </p>
                    )}
                  </CarteDetail>
                </div>

                <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-[#F4F0E6] border-b border-[#C9C1B1]/50">
                    <h3 className="text-sm font-bold text-[#1B2632]">Produit à livrer</h3>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider text-[#1B2632]/55 font-semibold">
                        <th className="px-5 py-2.5">Produit</th>
                        <th className="px-5 py-2.5 text-right">Quantité</th>
                        <th className="px-5 py-2.5 text-right">Prix</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-[#C9C1B1]/30">
                        <td className="px-5 py-3 font-semibold text-[#1B2632]">{detail.commandes?.produit || '—'}</td>
                        <td className="px-5 py-3 text-right font-mono">{detail.commandes?.quantite ?? 1}</td>
                        <td className="px-5 py-3 text-right font-mono font-bold">
                          {detail.commandes?.prix ?? '—'}{' '}
                          <span className="text-xs font-normal text-[#1B2632]/50">{detail.commandes?.pays?.devise || ''}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Le formulaire ne s'affiche que là où il a un sens : une
                    livraison déjà close ne se re-traite pas, et un rôle en
                    lecture seule n'a rien à enregistrer. */}
                {detail.statut === 'en_attente' && (
                  <div className="border border-[#C9C1B1] rounded-xl p-5 flex flex-col gap-4">
                    <h3 className="text-sm font-bold text-[#1B2632]">Traiter la livraison</h3>

                    {peutTraiter ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="lv-label">Résultat</label>
                            <select className="lv-input" value={statutChoisi}
                              onChange={(e) => setStatutChoisi(e.target.value)}>
                              {STATUTS_SAISISSABLES.map((s) => (
                                <option key={s} value={s}>{STATUTS[s].label}</option>
                              ))}
                            </select>
                          </div>

                          {statutChoisi === 'livre' && (
                            <div>
                              <label className="lv-label">Montant encaissé</label>
                              <input type="number" step="0.01" className="lv-input" value={montant}
                                onChange={(e) => setMontant(e.target.value)} placeholder="0" />
                            </div>
                          )}

                          {statutChoisi === 'retour' && (
                            <div>
                              <label className="lv-label">Motif du retour</label>
                              <input type="text" className="lv-input" value={motifTexte}
                                onChange={(e) => setMotifTexte(e.target.value)}
                                placeholder="Ex : client absent, refus..." />
                            </div>
                          )}
                        </div>

                        <button
                          onClick={envoyerConfirmation}
                          disabled={envoiEnCours}
                          className="self-start px-8 py-3 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-[#1B2632]/55">
                        Lecture seule : vous n&apos;avez pas le droit de modifier une livraison.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function CarteDetail({ titre, children }) {
  return (
    <div className="border border-[#C9C1B1] rounded-xl p-5">
      <h3 className="text-sm font-bold text-[#1B2632] mb-3.5">{titre}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

// Une ligne vide est affichée en « — » plutôt que masquée : savoir qu'une
// adresse manque vaut mieux que ne pas voir la ligne du tout.
function LigneDetail({ label, valeur, mono }) {
  const vide = valeur === null || valeur === undefined || valeur === ''
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[#1B2632]/45 w-[110px] shrink-0">{label}</span>
      <span className={`text-sm text-[#1B2632] ${mono ? 'font-mono font-semibold' : 'font-medium'} ${vide ? 'opacity-40' : ''}`}>
        {vide ? '—' : valeur}
      </span>
    </div>
  )
}