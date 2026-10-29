'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext' 
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import VignetteProduit from '../components/VignetteProduit'
import ResultatLot, { resumerLot } from '../components/ResultatLot'
import { produitDuCatalogue } from '../../lib/verdictImport.mjs'
import { rappelRefuse, RAPPEL_MAX_JOURS } from '../../supabase/functions/_shared/appel.ts'
import { bornesChamp, depuisChampLocal, libelleRappel, versChampLocal } from '../../lib/heureRappel.mjs'
import { libelleStatut } from '../../lib/libellesStatuts.mjs'

// 🚀 Fonction StatutPill
function StatutPill({ statut, listeStatutsDB }) {
  const statutConfiguré = (listeStatutsDB || []).find(s => s.nom === statut || s.id === statut)

  if (statutConfiguré && statutConfiguré.couleur) {
    return (
      <span className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1.5 w-fit" 
            style={{ backgroundColor: `${statutConfiguré.couleur}15`, color: statutConfiguré.couleur, border: `1px solid ${statutConfiguré.couleur}40` }}>
        {libelleStatut(statutConfiguré.nom)}
      </span>
    )
  }

  const configsFallback = {
    'confirmed': { bg: 'bg-[#2C3B4D]/10', text: 'text-[#2C3B4D]', label: 'Confirmée' },
    'en_attente': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'En attente' },
    'unreached': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Non joint' },
    'reminder': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'Rappel' },
    'cancelled': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Annulée' },
    'spam': { bg: 'bg-[#A35139]/10', text: 'text-[#A35139]', label: 'Spam' },
    'double': { bg: 'bg-[#C9C1B1]/50', text: 'text-[#4a4437]', label: 'Doublon' },
    'out_of_stock': { bg: 'bg-[#FFB162]/30', text: 'text-[#8a5a1f]', label: 'Rupture' },
    'not_active_yet': { bg: 'bg-[#C9C1B1]/30', text: 'text-[#5c5648]', label: 'Inactif' },
  }
  const conf = configsFallback[statut] || configsFallback['en_attente']
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${conf.bg} ${conf.text} whitespace-nowrap flex items-center gap-1.5 w-fit`}>
      {conf.label || libelleStatut(statut)}
    </span>
  )
}

function SelectFiltre({ label, value, onChange, options, placeholder }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#EEE9DF]/40 border border-[#C9C1B1]/60 rounded-lg px-3 py-2 text-sm font-medium text-[#1B2632] focus:outline-none focus:border-[#FFB162] cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function ChipFiltre({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-[#1B2632]/5 border border-[#C9C1B1]/60 text-xs font-semibold text-[#1B2632] fade-in">
      {label}
      <button
        onClick={onClear}
        className="w-4 h-4 rounded-full hover:bg-[#A35139]/15 text-[#1B2632]/40 hover:text-[#A35139] flex items-center justify-center text-[10px] leading-none transition-colors"
      >
        ✕
      </button>
    </span>
  )
}

function detecterPaysDepuisTelephone(cmd, paysListDB) {
  if (cmd?.lead_id) {
    const parts = cmd.lead_id.replace('#', '').split('-');
    if (parts.length >= 2) {
      const codeLead = parts[1].toUpperCase();
      const paysParLead = (paysListDB || []).find(p => (p.code || '').trim().toUpperCase() === codeLead);
      if (paysParLead) {
        return { iso: codeLead, nom: paysParLead.nom, paysTrouve: paysParLead };
      }
    }
  }

  let tel = cmd?.client_telephone ? cmd.client_telephone.trim().replace(/\s+/g, '') : ''
  if (tel.startsWith('00')) tel = '+' + tel.slice(2)
  else if (!tel.startsWith('+') && tel.length > 8) tel = '+' + tel

  const phoneNumber = parsePhoneNumberFromString(tel)
  if (!phoneNumber || !phoneNumber.country) return null

  const iso = phoneNumber.country
  const indicatif = phoneNumber.countryCallingCode

  const traducteur = new Intl.DisplayNames(['fr'], { type: 'region' })
  let nom = traducteur.of(iso)
  if (iso === 'CD') nom = 'RDC'
  if (iso === 'CG') nom = 'Congo'

  let paysTrouve = (paysListDB || []).find(p => {
    const codeDB = (p.code || '').trim().toUpperCase()
    return codeDB === iso || codeDB === `+${indicatif}` || codeDB === indicatif
  })

  if (!paysTrouve) {
    paysTrouve = (paysListDB || []).find(p =>
      (p.nom || '').toLowerCase().localeCompare(nom.toLowerCase(), 'fr', { sensitivity: 'base' }) === 0
    )
  }

  return { iso, nom, paysTrouve }
}

// Le texte de MESSAGE_ADRESSE_MANQUANTE (supabase/functions/_shared/appel.ts).
// Le serveur refuse avec le sien de toute façon ; celui-ci ne sert qu'à le
// dire avant l'envoi.
const MESSAGE_ADRESSE = 'Ajoutez l\'adresse avant de confirmer. Un repère suffit (« près du marché, maison bleue ») : écrivez ce que le client a dit.'

const ROLES_VUE_GLOBALE = ['admin', 'manager', 'ceo', 'super_admin']

// Les livraisons encore en cours (les seules qu'on voit dans « Mes leads » :
// livré, retour et annulé quittent la liste).
const LIVRAISON_LIBELLES = { a_preparer: 'à préparer', expedie: 'expédiée' }
const LIVRAISON_EN_COURS = 'statut_livraison.is.null,statut_livraison.not.in.(livre,retour,annule)'

// Un lead que personne n'a touché (27/10, statut_pending.sql). Le TEXTE est
// posé par la base : il ne dépend pas de la ligne « Pending » de `statuts`.
// Tant que le rattrapage n'est pas passé, des leads anciens sont encore à
// NULL : on lit les deux.
const PENDING = 'Pending'
const estPending = (statut) => !statut || statut === PENDING
const FILTRE_PENDING = `statut_confirmation.is.null,statut_confirmation.eq.${PENDING}`

// Les guillemets sont obligatoires : un nom contenant une virgule ou un
// espace casserait la liste `in.()` de PostgREST.
const listeNoms = (noms) => noms.map((n) => `"${String(n).replace(/"/g, '')}"`).join(',')
// Changer l'agent d'un lead, c'est arbitrer la charge de travail : le CEO lit,
// il n'arbitre pas.
const ROLES_ASSIGNATION_AGENT = ['admin', 'manager', 'super_admin']
// La valeur « Sans agent » du filtre : jamais un id d'agent (ce sont des uuid).
const AUCUN_AGENT = 'aucun'

export default function CentreAppelAgent() {
  const { user, tenantId, loading: authLoading } = useAuth() 
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions() 
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId;

  const [commandes, setCommandes] = useState([])
  const [listePays, setListePays] = useState([])
  const [listeZones, setListeZones] = useState([])
  const [listeStatutsDB, setListeStatutsDB] = useState([]) 
  const [loading, setLoading] = useState(true)

  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [recherche, setRecherche] = useState('')
  const [rechercheActive, setRechercheActive] = useState('')
  
  const [filtreProduit, setFiltreProduit] = useState('')
  const [filtreVille, setFiltreVille] = useState('')
  const [filtreSource, setFiltreSource] = useState('')
  const [filtrePays, setFiltrePays] = useState('')
  // Filtre par agent (29/10), responsables seulement : '' = tous, AUCUN_AGENT =
  // les leads que personne ne tient, sinon l'id d'un agent. Une VUE, pas un
  // droit : il resserre ce qui s'affiche, pas ce que la personne peut lire.
  // Un simple état : il ne survit pas à un rechargement, exprès — un filtre
  // oublié ne doit pas faire croire le lendemain que la file est vide.
  const [filtreAgent, setFiltreAgent] = useState('')
  
  const [panneauFiltresOuvert, setPanneauFiltresOuvert] = useState(false)
  // Mode « qui appelle quoi » : réservé aux responsables. Il remplace la colonne
  // Statut par l'agent chargé du lead, et permet de le changer tant que l'appel
  // n'a pas eu lieu. Volontairement une vue de cette page, pas un menu de plus :
  // c'est ici qu'on regarde la file d'attente.
  const [modeAgents, setModeAgents] = useState(false)
  const [listeAgents, setListeAgents] = useState([])
  const [agentChoisi, setAgentChoisi] = useState({})
  const [agentEnCours, setAgentEnCours] = useState(null)
  // Sélection multiple (29/10) : admin, manager, super_admin. Ce qui est
  // coché est sur l'écran — jamais « toute la base ». Changer de page, de
  // filtre ou de recherche vide la sélection.
  const [selection, setSelection] = useState({})
  const [agentLot, setAgentLot] = useState('')
  const [lotEnCours, setLotEnCours] = useState(false)
  // Le compte rendu du dernier lot, et la raison de chaque refus sur sa ligne.
  const [resultatLot, setResultatLot] = useState(null)
  const [refusParId, setRefusParId] = useState({})
  const [optionsFiltres, setOptionsFiltres] = useState({ produits: [], villes: [], sources: [], pays: [] })
  // Le catalogue, pour l'image du produit dans le panneau d'appel (26/10) :
  // l'agent décrit le produit au client (« c'est bien le flacon bleu ? »).
  // La RLS de `produits` donne tous les produits de l'entreprise à l'agent.
  const [catalogue, setCatalogue] = useState([])

  const [page, setPage] = useState(1)
  // Le bas a SA pagination (27/10). Avant, les deux groupes étaient une seule
  // liste paginée : avec 82 leads en haut, le bas commençait en page 2 et un
  // responsable ne le voyait jamais. `page` pagine le haut, `pageBas` le bas ;
  // l'un ne déplace pas l'autre.
  const [pageBas, setPageBas] = useState(1)
  // Un filtre, une recherche : les deux groupes repartent page 1.
  const allerPage1 = () => { setPage(1); setPageBas(1) }
  // Combien à traiter, combien en suivi (le séparateur et l'en-tête).
  const [comptes, setComptes] = useState(null)
  const ITEMS_PER_PAGE = 50

  const [agentActuel, setAgentActuel] = useState(null)
  const [agentIntrouvable, setAgentIntrouvable] = useState(false) // 🚀 État de sécurité
  const [commandeSelectionnee, setCommandeSelectionnee] = useState(null)
  const [statutChoisi, setStatutChoisi] = useState('') 

  // Le temps MONTE, il ne descend pas. Un compte à rebours de 5 minutes
  // pressait l'agent sans rien mesurer ; ce qu'on veut savoir, c'est combien
  // l'appel a réellement duré — et ça se garde sur l'appel.
  const [tempsEcoule, setTempsEcoule] = useState(0)
  // Les appels déjà passés sur cette commande : combien, et comment ils se
  // sont terminés. Un client rappelé quatre fois ne se traite pas comme un
  // premier contact.
  const [appelsPrecedents, setAppelsPrecedents] = useState([])
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  // Le refus du serveur, affiché dans le panneau : une alerte se ferme sans
  // être lue, et l'agent ne sait plus pourquoi il est bloqué.
  const [erreurEnvoi, setErreurEnvoi] = useState('')
  // Une lecture de la liste ratée le DIT (28/10) : sans ça, une colonne
  // manquante ou un droit refusé s'affichait « Aucun lead ne vous est
  // assigné », et un écran cassé passait pour une file vide.
  const [erreurChargement, setErreurChargement] = useState('')

  const [formData, setFormData] = useState({
    source: '', client_nom: '', client_telephone: '', ville_zone: '', adresse: '',
    zone_id: '', pays_id: '', produit: '', quantite: 1, prix: 0, notes: '', date_rappel: '', prixUnitaire: 0
  })

  // REDIRECTION SÉCURISÉE
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) {
        router.replace('/')
      } else if (!hasPermission('menu_centre_appel')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  // TIMER APPEL
  useEffect(() => {
    let interval = null
    if (commandeSelectionnee) {
      setTempsEcoule(0)
      interval = setInterval(() => setTempsEcoule((prec) => prec + 1), 1000)
    }
    return () => clearInterval(interval)
  }, [commandeSelectionnee?.id])

  const formatTemps = (secondes) => {
    const m = Math.floor(secondes / 60).toString().padStart(2, '0')
    const s = (secondes % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // RECHERCHE DYNAMIQUE
  useEffect(() => {
    const t = setTimeout(() => {
      setRechercheActive(recherche.trim())
      allerPage1()
    }, 400)
    return () => clearTimeout(t)
  }, [recherche])

  // RACCOURCI CLAVIER
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setCommandeSelectionnee(null)
        setPanneauFiltresOuvert(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // BLOQUER SCROLL
  useEffect(() => {
    document.body.style.overflow = commandeSelectionnee ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [commandeSelectionnee])

  // CHARGEMENT DES RÉFÉRENTIELS
  useEffect(() => {
    async function chargerOptionsFiltres() {
      if (!user || !tenantKey) return

      // Les valeurs distinctes viennent de la base (vue v_options_filtres) :
      // quelques dizaines de lignes au lieu de 6000 rapatriées pour être triées ici.
      const [
        { data: options },
        { data: pays },
        { data: statuts },
        { data: produits }
      ] = await Promise.all([
        supabase.from('v_options_filtres').select('champ, valeur').eq('tenant_id', tenantKey),
        supabase.from('pays').select('id, nom').eq('tenant_id', tenantKey).order('nom'),
        supabase.from('statuts').select('*').eq('tenant_id', tenantKey).order('nom'),
        // image_chemin explicitement : sans lui, la vignette n'a rien à afficher.
        supabase.from('produits').select('id, code, product, image_chemin').eq('tenant_id', tenantKey)
      ])

      const valeursDe = (champ) =>
        (options || [])
          .filter(o => o.champ === champ)
          .map(o => o.valeur)
          .sort((a, b) => a.localeCompare(b, 'fr'))

      setOptionsFiltres({
        produits: valeursDe('produit'),
        villes: valeursDe('ville'),
        sources: valeursDe('source'),
        pays: (pays || []).map(p => ({ id: p.id, nom: p.nom }))
      })

      if (statuts) setListeStatutsDB(statuts)
      setCatalogue(produits || [])
    }
    chargerOptionsFiltres()
  }, [user, tenantKey])

  // 🚀 SÉCURITÉ : VÉRIFICATION DU PROFIL AGENT ET CHARGEMENT DE SES LEADS
  useEffect(() => {
    if (authLoading || permsLoading || !user || !tenantKey) return

    async function verifierAgentEtCharger() {
      // Admin / manager / CEO / super_admin: global view, no agent profile needed.
      // (tenant isolation is still enforced by the query filter + RLS)
      if (ROLES_VUE_GLOBALE.includes((roleNom || '').toLowerCase())) {
        setAgentActuel(null)
        setAgentIntrouvable(false)
        await chargerCommandes(page, null)
        return
      }

      const { data: agentData } = await supabase
        .from('agents')
        .select('id, nom')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantKey)
        .maybeSingle()

      if (agentData) {
        setAgentActuel(agentData)
        setAgentIntrouvable(false)
        await chargerCommandes(page, agentData.id)
      } else {
        // L'utilisateur n'est pas reconnu comme agent dans ce tenant
        setAgentIntrouvable(true)
        setLoading(false)
      }
    }

    verifierAgentEtCharger()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // `listeStatutsDB` est dans les dépendances : la file « À traiter » se
  // construit à partir des statuts qui ne ferment pas le dossier. Sans elle,
  // le premier chargement part avec une liste vide — donc sans les leads à
  // rappeler — et rien ne le relancerait quand les statuts arrivent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageBas, dateDebut, dateFin, rechercheActive, filtreProduit, filtreVille, filtreSource, filtrePays, filtreAgent, authLoading, permsLoading, user, tenantKey, roleNom, listeStatutsDB])

  const peutChangerAgent = ROLES_ASSIGNATION_AGENT.includes((roleNom || '').toLowerCase())
  // La sélection, c'est ce qui est à l'écran : une autre page, un autre filtre
  // la vide. Les raisons de refus du lot précédent s'effacent avec.
  useEffect(() => {
    setSelection({}); setRefusParId({})
  }, [page, pageBas, dateDebut, dateFin, rechercheActive, filtreProduit, filtreVille, filtreSource, filtrePays, filtreAgent])
  // Le CEO filtre par agent (il lit tout) mais n'en change aucun.
  const peutFiltrerAgent = ROLES_VUE_GLOBALE.includes((roleNom || '').toLowerCase())
  // La requête des commandes ne ramène que `agent_id` ; le nom vient de la liste
  // déjà chargée, ce qui évite une jointure sur chaque page.
  const nomAgent = (id) => {
    if (!id) return null
    if (listeAgents.length === 0) return '…' // liste pas encore chargée
    return listeAgents.find((a) => a.id === id)?.nom || 'Agent supprimé'
  }
  // LA VUE DE L'AGENT (28/10). On mesure s'il appelle vraiment : rien sur son
  // écran ne doit lui dire qu'un lead a déjà été essayé.
  //   · un lead qu'il a mis « Non joint » sort de sa liste (groupeBas) ;
  //   · remonté par un responsable, il revient « En attente » : c'est ce que
  //     montre `statutVu`. La base garde « Non joint » (Remonter n'efface pas
  //     le statut), et le responsable voit le vrai statut ;
  //   · pas de date (la création trahit un vieux lead), pas de « Remonté le »,
  //     pas d'appels précédents, pas de « Appel n° 3 » ;
  //   · trié parmi les nouveaux par l'heure de sa remontée (entree_file).
  // La base ferme `appels` à l'agent (appels_responsables.sql) : la console
  // du navigateur ne les lui rend pas non plus.
  const vueAgent = !!agentActuel
  const statutVu = (cmd) => (vueAgent && cmd.remonte_le ? PENDING : cmd.statut_confirmation)
  const nbColonnes = (modeAgents ? 10 : 9) - (vueAgent ? 1 : 0) + (peutChangerAgent ? 1 : 0)

  // TOUS les agents de l'entreprise, inactifs compris : le filtre doit
  // pouvoir montrer les leads d'un agent parti. Changer d'agent ne propose
  // que les agents actifs qui ont un compte (agentsAssignables).
  useEffect(() => {
    if (!tenantKey || !peutFiltrerAgent) return
    let annule = false
    supabase
      .from('agents')
      .select('id, nom, pays_id, actif, user_id')
      .eq('tenant_id', tenantKey)
      .order('nom')
      .then(({ data }) => { if (!annule) setListeAgents(data || []) })
    return () => { annule = true }
  }, [tenantKey, peutFiltrerAgent])
  const agentsAssignables = listeAgents.filter((a) => a.actif && a.user_id)
  const libelleAgent = (a) => (a.actif && a.user_id ? a.nom : `${a.nom} (inactif)`)

  // Une ligne seule passe par la même porte qu'un lot (affecter_agent_lot) :
  // mêmes règles, même historique, avec qui l'a fait.
  async function changerAgent(commandeId, agentId) {
    if (!agentId) return
    setAgentEnCours(commandeId)
    const { data, error } = await supabase.rpc('affecter_agent_lot', { p_tenant: tenantKey, p_ids: [commandeId], p_agent: agentId })
    setAgentEnCours(null)

    if (error) { alert('Erreur : ' + error.message); return }
    const r = (data || [])[0]
    if (r?.resultat === 'refuse') { alert(r.motif); return }

    setCommandes((prec) => prec.map((c) => (c.id === commandeId ? { ...c, agent_id: agentId } : c)))
    setAgentChoisi((prec) => ({ ...prec, [commandeId]: '' }))
  }

  // UN appel pour tout le lot : si la connexion tombe, rien n'est appliqué
  // (la base n'a rien reçu) ou tout le lot a eu sa réponse — jamais un lot à
  // moitié écrit sans le savoir. Chaque ligne est appliquée ou refusée seule,
  // avec sa raison ; les refusées restent cochées.
  async function affecterLot() {
    const lignes = commandes.filter((c) => selection[c.id])
    const agent = listeAgents.find((a) => a.id === agentLot)
    if (!lignes.length || !agent) return
    if (!confirm(`Affecter ${lignes.length} lead${lignes.length > 1 ? 's' : ''} de cette page à ${agent.nom} ?`)) return

    setLotEnCours(true)
    const { data, error } = await supabase.rpc('affecter_agent_lot', { p_tenant: tenantKey, p_ids: lignes.map((c) => c.id), p_agent: agentLot })
    setLotEnCours(false)
    const action = `Affectation à ${agent.nom}`
    if (error) {
      setResultatLot({ action, erreur: error.message })
      return
    }
    const resume = resumerLot(action, data, lignes)
    setResultatLot(resume)
    setRefusParId(Object.fromEntries(resume.refus.map((r) => [r.id, r.motif])))
    setSelection(Object.fromEntries(resume.refus.map((r) => [r.id, true])))
    setAgentLot('')
    await chargerCommandes(page, null)
  }

  // Les statuts rangés par ce qu'ils FONT (drapeaux de Paramètres), jamais par
  // des noms écrits ici : un statut ajouté plus tard trouve sa place seul.
  //   · rappels : ouverts, necessite_rappel — Reminder. EN BAS jusqu'à son
  //     heure (commandes.date_rappel), EN HAUT dès qu'elle est passée. Un
  //     rappel sans heure (d'avant le 27/10) est en haut : il ne coule pas.
  //   · bas     : ouverts, ni Pending ni rappel — Unreached.
  //   · suivis  : ferment ET envoient au livreur — Confirmed.
  //   · les statuts qui ferment SANS envoyer au livreur (Cancelled, Spam,
  //     Double, Test) font QUITTER la liste ; ils se retrouvent dans Commandes.
  const sansPending = listeStatutsDB.filter((s) => s.code !== 'pending' && s.nom !== PENDING)
  const statutsRappel = sansPending.filter((s) => !s.ferme_le_lead && s.necessite_rappel)
  const statutsBas = sansPending.filter((s) => !s.ferme_le_lead && !s.necessite_rappel)
  const statutsSuivis = sansPending.filter((s) => s.ferme_le_lead && s.declenche_assignation)

  // Les filtres de l'écran, posés sur une requête neuve. La liste, ses
  // comptes ET le bouton « Remonter » passent par ici : le bouton remonte
  // exactement ce que la liste montre.
  // `avecFiltreAgent = false` : la même requête sans le filtre d'agent — le
  // total « sur N » de l'en-tête.
  function appliquerFiltres(q, agentId, dateField, avecFiltreAgent = true) {
    // Le cloisonnement vaut POUR TOUT LE MONDE, super_admin compris.
    //
    // Avant, le super_admin était exempté de ce filtre : le centre d'appel lui
    // montrait les commandes de toutes les entreprises mélangées, sans rien
    // pour dire laquelle était laquelle. Deux clients différents dans la même
    // file d'appel, c'est une fuite entre entreprises, et c'est intenable à
    // l'écran.
    //
    // Ce n'est pas une perte d'accès : `tenantId` renvoie déjà l'entreprise
    // que le super_admin a CHOISIE (`tenantChoisi`, AuthContext). Il voit donc
    // tout, une entreprise à la fois, et change d'entreprise par le sélecteur.
    q = q.eq('tenant_id', tenantKey)

    // 🔒 An agent only sees HIS orders
    if (agentId) q = q.eq('agent_id', agentId)
    // Le filtre d'un responsable (jamais posé pour un agent : agentId le remplace).
    else if (avecFiltreAgent && filtreAgent === AUCUN_AGENT) q = q.is('agent_id', null)
    else if (avecFiltreAgent && filtreAgent) q = q.eq('agent_id', filtreAgent)

    if (dateDebut) q = q.gte(dateField, dateDebut)
    if (dateFin) q = q.lte(dateField, `${dateFin}T23:59:59`)

    if (rechercheActive) {
      const r = rechercheActive.replace(/[%,()#]/g, '')
      const rTel = r.replace(/[\s.\-]/g, '')
      const conditions = [`client_nom.ilike.%${r}%`, `client_telephone.ilike.%${r}%`, `lead_id.ilike.%${r}%`]
      if (rTel && rTel !== r) conditions.push(`client_telephone.ilike.%${rTel}%`)
      q = q.or(conditions.join(','))
    }

    // Le pays est désormais obligatoire et verrouillé en base, donc on filtre
    // dessus côté serveur : plus besoin de rapatrier 5000 lignes pour trier ici.
    if (filtrePays) q = q.eq('pays_id', filtrePays)
    if (filtreProduit) q = q.eq('produit', filtreProduit)
    if (filtreVille) q = q.eq('ville_zone', filtreVille)
    if (filtreSource) q = q.eq('source', filtreSource)
    return q
  }

  // « Mes leads », en haut : Pending, ce qu'un manager a remonté (quel que
  // soit son statut — un Unreached remonté reste Unreached), et les rappels
  // dont l'heure est passée. `maintenant` est figé au chargement : un rappel
  // qui arrive à échéance pendant que l'écran est ouvert remonte au
  // rechargement suivant (voir le minuteur plus bas).
  const nomsRappel = listeNoms(statutsRappel.map((s) => s.nom))
  const groupeHaut = (q, agentId, maintenant, avecFiltreAgent) => appliquerFiltres(q, agentId, 'created_at', avecFiltreAgent)
    .or([
      'statut_confirmation.is.null', `statut_confirmation.eq.${PENDING}`, 'remonte_le.not.is.null',
      ...(statutsRappel.length ? [`and(statut_confirmation.in.(${nomsRappel}),or(date_rappel.is.null,date_rappel.lte."${maintenant}"))`] : []),
    ].join(','))
    .or(LIVRAISON_EN_COURS)
  // « Mes leads », en bas : Unreached, Confirmed non livré, et les rappels pas
  // encore dus — non remontés. Pas verrouillés : on les ouvre et on les
  // traite comme avant.
  // L'AGENT n'y voit pas les Unreached : un lead qu'il n'a pas joint sort de
  // sa liste jusqu'à ce qu'un responsable le remonte. Ses rappels et ses
  // confirmées pas encore livrées restent.
  const nomsBasPour = (agentId) => [...(agentId ? [] : statutsBas), ...statutsSuivis].map((s) => s.nom)
  const groupeBas = (q, agentId, maintenant, avecFiltreAgent) => {
    const nomsBas = nomsBasPour(agentId)
    return appliquerFiltres(q, agentId, 'created_at', avecFiltreAgent)
    .or([
      ...(nomsBas.length ? [`statut_confirmation.in.(${listeNoms(nomsBas)})`] : []),
      ...(statutsRappel.length ? [`and(statut_confirmation.in.(${nomsRappel}),date_rappel.gt."${maintenant}")`] : []),
      // aucun statut connu : une condition qui ne retient rien plutôt qu'un or() vide
      'id.is.null',
    ].join(','))
    .is('remonte_le', null)
    .or(LIVRAISON_EN_COURS)
  }
  // Ce que le bouton remonte : les « Unreached » (statuts du bas, ouverts)
  // que les filtres retiennent, pas encore remontés.
  const groupeARemonter = (q) => appliquerFiltres(q, null, 'created_at')
    .in('statut_confirmation', statutsBas.map((s) => s.nom))
    .is('remonte_le', null)
    .or(LIVRAISON_EN_COURS)

  const [remonteeEnCours, setRemonteeEnCours] = useState(false)

  // Le temps qui passe : « dans 2 h » se met à jour chaque minute, et un
  // rappel du bas dont l'heure arrive remonte dans la file sans que l'agent
  // recharge la page. Jamais pendant qu'un lead est ouvert dans le panneau.
  const [maintenantAffiche, setMaintenantAffiche] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setMaintenantAffiche(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (loading || commandeSelectionnee) return
    const vueGlobale = ROLES_VUE_GLOBALE.includes((roleNom || '').toLowerCase())
    if (!agentActuel && !vueGlobale) return
    const echu = commandes.some((c) => c.groupe === 'traite' && c.date_rappel
      && new Date(c.date_rappel).getTime() <= maintenantAffiche)
    if (echu) chargerCommandes(page, agentActuel ? agentActuel.id : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenantAffiche])

  // Le bouton « Remonter » (manager, admin) : TOUS les Unreached que les
  // filtres retiennent, pas seulement les 50 de l'écran — et la confirmation
  // dit combien, pour qu'un « 340 » fasse réfléchir. La base revérifie tout
  // (remonter_leads : rôle, entreprise, statut) et rend le nombre réel.
  async function remonterLeads() {
    if (statutsBas.length === 0) return
    const { count, error: erreurCompte } = await groupeARemonter(supabase.from('commandes').select('id', { count: 'exact', head: true }))
    if (erreurCompte) { alert('Erreur : ' + erreurCompte.message); return }
    if (!count) { alert('Aucun lead en attente de rappel ne correspond aux filtres.'); return }
    if (!confirm(`Remonter ${count} lead${count > 1 ? 's' : ''} en attente de rappel${filtreAgent ? ` (filtre agent : ${nomFiltreAgent})` : ''} ?\n\nIls passent en tête de la file de leur agent. Leur statut ne change pas.`)) return

    setRemonteeEnCours(true)
    try {
      // D'abord TOUS les ids (par paquets de 1000, la limite de lecture),
      // ensuite seulement on remonte : remonter en lisant ferait glisser les
      // paquets suivants.
      const ids = []
      for (let i = 0; ; i += 1000) {
        const { data, error } = await groupeARemonter(supabase.from('commandes').select('id')).order('id').range(i, i + 999)
        if (error) throw error
        ids.push(...(data || []).map((x) => x.id))
        if (!data || data.length < 1000) break
      }
      let remontes = 0
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await supabase.rpc('remonter_leads', { p_tenant: tenantKey, p_ids: ids.slice(i, i + 500) })
        if (error) throw error
        remontes += data || 0
      }
      alert(`${remontes} lead${remontes > 1 ? 's' : ''} remonté${remontes > 1 ? 's' : ''}.`)
    } catch (e) {
      alert('Erreur : ' + (e?.message || e))
    }
    setRemonteeEnCours(false)
    allerPage1()
    await chargerCommandes(1, null)
  }

  // 🚀 CHARGEMENT STRICTEMENT CLOISONNÉ
  // agentId = null  -> global view (admin / manager / ceo / super_admin)
  async function chargerCommandes(pageActuelle, agentId) {
    if (!tenantKey || agentId === undefined) return
    setLoading(true)

    const { data: paysListDB } = await supabase.from('pays').select('id, nom, code, devise').eq('tenant_id', tenantKey)
    setListePays(paysListDB || [])

    const { data: zonesListDB } = await supabase.from('zones').select('*').eq('tenant_id', tenantKey)
    setListeZones(zonesListDB || [])

    const COLONNES = `id, lead_id, agent_id, date_commande, created_at, updated_at, source, produit, quantite, prix, statut_confirmation, statut_livraison, remonte_le, date_rappel, client_nom, client_telephone, ville_zone, adresse, zone_id, pays_id, notes, pays(id, nom, code, devise)`

    // UNE liste, deux groupes, chacun sa pagination.
    //
    //   1. EN HAUT, la file de l'agent : ce qu'un manager a remonté (le plus
    //      anciennement remonté d'abord), puis Pending et les rappels, par
    //      arrivée.
    //   2. EN BAS : Unreached et Confirmed pas encore livré, par dernière mise
    //      à jour. Pas verrouillés : « pas dans ma file maintenant », jamais
    //      « je ne peux pas y toucher ».
    //
    // Un lead QUITTE la liste quand son statut ferme le lead SANS l'envoyer
    // au livreur (Cancelled, Spam, Double, Test, et tout statut de ce genre
    // ajouté plus tard), ou quand sa livraison est finie (livrée, retournée,
    // annulée — un retour est définitif : confirmer-livraison refuse de
    // rouvrir une livraison close). On le retrouve dans Commandes.
    const maintenant = new Date().toISOString()
    setErreurChargement('')
    // Filtre d'agent posé : on compte AUSSI sans lui, pour écrire « 3 sur 47 ».
    // Un manager qui a oublié le filtre ne lit pas une liste vide comme « plus
    // rien à faire ».
    const filtreAgentPose = !agentId && !!filtreAgent
    const compter = (groupe, avecFiltreAgent) => groupe(supabase.from('commandes').select('id', { count: 'exact', head: true }), agentId, maintenant, avecFiltreAgent)
    const [{ count: nA, error: eA }, { count: nB, error: eB }, totA, totB] = await Promise.all([
      compter(groupeHaut, true),
      compter(groupeBas, true),
      filtreAgentPose ? compter(groupeHaut, false) : { count: null },
      filtreAgentPose ? compter(groupeBas, false) : { count: null },
    ])
    const eT = totA.error || totB.error
    if (eA || eB || eT) {
      setErreurChargement((eA || eB || eT).message)
      setCommandes([]); setComptes(null); setLoading(false)
      return
    }
    const nbHaut = nA || 0
    const nbBas = nB || 0

    // DEUX paginations indépendantes (27/10) : chaque groupe lit sa page, et
    // le séparateur du bas est sur CHAQUE page, juste après le haut. Une
    // page demandée au-delà de la dernière (le groupe a rétréci) est
    // ramenée à la dernière.
    const pagesHaut = Math.max(1, Math.ceil(nbHaut / ITEMS_PER_PAGE))
    const pagesBas = Math.max(1, Math.ceil(nbBas / ITEMS_PER_PAGE))
    const pH = Math.min(pageActuelle, pagesHaut)
    const pB = Math.min(pageBas, pagesBas)
    const lectures = []
    // Une lecture ratée lève : elle est dite à l'écran, jamais lue comme vide.
    const lignes = (groupe) => ({ data: d, error }) => {
      if (error) throw error
      return (d || []).map((c) => ({ ...c, groupe }))
    }
    if (nbHaut > 0) {
      let q = groupeHaut(supabase.from('commandes').select(COLONNES), agentId, maintenant)
      // L'agent : un lead remonté est trié comme un nouveau, à l'heure de sa
      // remontée (entree_file = remonte_le, sinon created_at). Les
      // responsables : les remontés d'abord, le plus anciennement remonté en
      // tête.
      q = agentId
        ? q.order('entree_file', { ascending: false })
        : q.order('remonte_le', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
      lectures.push(q.order('id', { ascending: false })
        .range((pH - 1) * ITEMS_PER_PAGE, pH * ITEMS_PER_PAGE - 1)
        .then(lignes('a_traiter')))
    }
    if (nbBas > 0) {
      // Les rappels d'abord, le plus proche en premier (ce qui va bientôt
      // remonter) ; puis le reste par dernière mise à jour. Seuls les
      // rappels portent une heure : confirmer-appel l'efface sur tout autre
      // statut.
      lectures.push(groupeBas(supabase.from('commandes').select(COLONNES), agentId, maintenant)
        .order('date_rappel', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false }).order('id', { ascending: false })
        .range((pB - 1) * ITEMS_PER_PAGE, pB * ITEMS_PER_PAGE - 1)
        .then(lignes('traite')))
    }
    let data
    try {
      data = (await Promise.all(lectures)).flat()
    } catch (e) {
      setErreurChargement(e?.message || String(e))
      setCommandes([]); setComptes(null); setLoading(false)
      return
    }
    setComptes({
      aTraiter: nbHaut, traites: nbBas, pageHaut: pH, pagesHaut, pageBas: pB, pagesBas,
      // null sans filtre d'agent : rien à comparer.
      totalATraiter: filtreAgentPose ? (totA.count || 0) : null,
      totalTraites: filtreAgentPose ? (totB.count || 0) : null,
    })

    const commandesIntelligentes = (data || []).map(cmd => {
      const { appels, ...cmdSansJointure } = cmd
      const detection = detecterPaysDepuisTelephone(cmdSansJointure, paysListDB)

      // Le pays enregistré sur la commande fait foi : c'est lui qui décide de
      // l'agent et c'est sur lui que porte le filtre. La déduction à partir du
      // téléphone ne sert plus que si la commande n'a pas de pays rattaché.
      let paysFinal
      if (cmdSansJointure.pays?.nom) {
        paysFinal = cmdSansJointure.pays
      } else if (detection?.paysTrouve) {
        paysFinal = detection.paysTrouve
      } else if (detection) {
        paysFinal = { nom: detection.nom, iso: detection.iso }
      } else {
        paysFinal = { nom: 'Non spécifié' }
      }

      return { ...cmdSansJointure, pays: paysFinal }
    })

    setCommandes(commandesIntelligentes)
    
    setLoading(false)
  }

  async function ouvrirPanneau(commande) {
    setCommandeSelectionnee(commande)
    setErreurEnvoi('')
    setAppelsPrecedents([])

    // Les appels déjà passés sur CETTE commande, pour un responsable. Jamais
    // pour l'agent (vue de l'agent, plus haut) — et la base les lui refuse
    // de toute façon. Ils arrivent après l'ouverture : le panneau doit
    // s'afficher tout de suite, on a le client en ligne.
    if (!vueAgent) {
      supabase
        .from('appels')
        .select('id, statut, notes, duree_secondes, created_at')
        .eq('commande_id', commande.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => setAppelsPrecedents(data || []))
    }

    // « Pending » est l'état de départ, pas un résultat d'appel : jamais
    // présélectionné, jamais proposé. Un lead remonté se présente à l'agent
    // comme un nouveau (statutVu).
    if (!estPending(statutVu(commande))) {
      setStatutChoisi(commande.statut_confirmation)
    } else if (sansPending.length > 0) {
      setStatutChoisi(sansPending[0].nom)
    } else {
      setStatutChoisi('')
    }

    let paysId = commande.pays?.id || ''

    if (!paysId && commande.pays?.iso) {
      let pays = listePays.find(p => (p.code || '').toUpperCase() === commande.pays.iso)
      if (!pays) {
        const { data } = await supabase
          .from('pays')
          .insert({ nom: commande.pays.nom, code: commande.pays.iso, tenant_id: tenantKey })
          .select('id, nom, code, devise')
          .single()

        if (data) {
          pays = data
          setListePays(prev => [...prev, data])
        }
      }
      paysId = pays?.id || ''
    }

    const qte = commande.quantite || 1;
    const prixUnit = (commande.prix || 0) / qte;

    setFormData({
      source: commande.source || '',
      client_nom: commande.client_nom || '',
      client_telephone: commande.client_telephone || '',
      ville_zone: commande.ville_zone || '',
      adresse: commande.adresse || '',
      zone_id: commande.zone_id || '',
      pays_id: paysId,
      produit: commande.produit || '',
      quantite: qte,
      prix: commande.prix || 0,
      // La note part VIDE à chaque appel : elle est enregistrée dans `appels`,
      // pas sur la commande. La pré-remplir avec la note du lead recopierait
      // la même phrase sur chaque appel, et on ne saurait plus qui a dit quoi.
      notes: '',
      // Le rappel en cours, s'il est encore à venir : l'agent le garde ou le
      // déplace. Dans le fuseau de SON navigateur (lib/heureRappel.mjs).
      date_rappel: commande.date_rappel && new Date(commande.date_rappel) > new Date() ? versChampLocal(commande.date_rappel) : '',
      prixUnitaire: prixUnit
    })
  }

  async function validerAppel() {
    if (!statutChoisi) {
      alert("Veuillez sélectionner un résultat d'appel.");
      return;
    }
    // Même règle que confirmer-appel, dite avant l'envoi. Le serveur reste
    // celui qui décide ; ici on évite seulement l'aller-retour.
    if (adresseExigee) {
      setErreurEnvoi(MESSAGE_ADRESSE)
      return
    }
    // L'heure du rappel : l'heure locale du champ devient un instant UTC ici,
    // jamais envoyée brute. Même règle que confirmer-appel (_shared/appel.ts).
    const dateRappelIso = depuisChampLocal(formData.date_rappel)
    const refusRappel = rappelRefuse(statutsDeLaCommande, statutChoisi, formData.pays_id || null, dateRappelIso)
    if (refusRappel) {
      setErreurEnvoi(refusRappel)
      return
    }
    setErreurEnvoi('')

    setEnvoiEnCours(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      router.push('/')
      return
    }

    const reponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirmer-appel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          commande_id: commandeSelectionnee.id,
          statut: statutChoisi,
          tenant_id: tenantKey,
          // Mesurée, pas saisie : l'agent a autre chose à faire que de
          // chronométrer son propre appel.
          duree_secondes: tempsEcoule,
          ...formData,
          date_rappel: rappelDemande ? dateRappelIso : null,
        }),
      }
    )

    const resultat = await reponse.json()
    setEnvoiEnCours(false)

    if (resultat.error) {
      setErreurEnvoi(resultat.error)
      return
    }

    // On ferme, on n'enchaîne pas. Sauter au lead suivant ouvrait un dossier
    // que personne n'avait demandé : l'agent se retrouvait en train de lire
    // les coordonnées d'un client qu'il n'appelle pas encore, et le temps
    // mesuré pour cet appel commençait pendant qu'il soufflait.
    setCommandeSelectionnee(null)

    // agentActuel est null pour un responsable : `?.id` donnait undefined, et
    // chargerCommandes ne rechargeait rien après son enregistrement.
    await chargerCommandes(page, agentActuel ? agentActuel.id : null)
  }

  const appliquer = (setter) => (v) => { setter(v); allerPage1() }

  function reinitialiserFiltres() {
    setDateDebut(''); setDateFin(''); setRecherche('')
    setFiltreProduit(''); setFiltreVille(''); setFiltreSource(''); setFiltrePays(''); setFiltreAgent('')
    allerPage1()
  }

  // Un statut appartient soit à tous les pays (pays_id vide), soit à un seul.
  // L'agent ne doit voir que ceux qui valent pour le pays de SA commande : sinon
  // il enregistre un statut d'un autre pays, et la base refuse d'y accrocher
  // l'assignation automatique du livreur (le statut ne correspond pas au pays).
  const statutsDeLaCommande = sansPending.filter(
    (s) => !s.pays_id || !commandeSelectionnee?.pays_id || s.pays_id === commandeSelectionnee.pays_id
  )

  // Le statut choisi envoie-t-il la commande au livreur ? C'est le drapeau
  // `declenche_assignation` qui le dit, pas le mot « Confirmed ».
  const statutEnvoieAuLivreur = statutsDeLaCommande.some(
    (s) => s.nom === statutChoisi && s.declenche_assignation
  )
  const adresseExigee = statutEnvoieAuLivreur && !String(formData.adresse || '').trim()
  // Le statut choisi demande-t-il un rappel ? Le drapeau `necessite_rappel`,
  // pas le mot « Reminder ».
  const rappelDemande = statutsDeLaCommande.some((s) => s.nom === statutChoisi && s.necessite_rappel)
  const bornesRappel = bornesChamp(RAPPEL_MAX_JOURS)

  const nombreFiltresActifs = [filtreProduit, filtreVille, filtreSource, filtrePays].filter(Boolean).length
  const filtresActifs = dateDebut || dateFin || recherche || filtreAgent || nombreFiltresActifs > 0
  const nomFiltreAgent = filtreAgent === AUCUN_AGENT ? 'Sans agent'
    : (listeAgents.find((a) => a.id === filtreAgent)?.nom || 'Agent')
  // Cochable : TOUS les leads de la page (29/10, sa décision ; avant :
  // Pending seulement). Ce que la case de l'en-tête coche, chaque ligne peut
  // le cocher seule. L'historique garde l'auteur de chaque action, et
  // Performances compte les appels par l'agent qui a appelé : changer l'agent
  // ne déplace rien (affecter_agent_lot, historique_affectations.sql §5).
  const cochable = () => peutChangerAgent
  const lignesCochables = commandes.filter(cochable)
  const lignesCochees = commandes.filter((c) => selection[c.id])
  const toutCoche = lignesCochables.length > 0 && lignesCochables.every((c) => selection[c.id])
  const basculerTout = () => setSelection(toutCoche ? {} : Object.fromEntries(lignesCochables.map((c) => [c.id, true])))
  const basculer = (id) => setSelection((prec) => {
    const s = { ...prec }
    if (s[id]) delete s[id]; else s[id] = true
    return s
  })
  // Seuls les agents qui peuvent prendre TOUS les leads cochés (leur pays).
  const agentsPourLot = agentsAssignables.filter((a) => !a.pays_id || lignesCochees.every((c) => c.pays_id === a.pays_id))
  // « 3 sur 47 » quand le filtre d'agent est posé.
  const surTotal = (total) => (total === null || total === undefined ? '' : ` sur ${total}`)

  const whatsappTexte = encodeURIComponent(`Bonjour ${formData.client_nom}, c'est le service de confirmation. Nous vous contactons concernant votre commande pour le produit ${formData.produit}. Pouvons-nous valider la livraison à ${formData.ville_zone || 'votre adresse'} ?`);
  const estUnDoublon = commandes.filter(c => c.client_telephone && formData.client_telephone && c.client_telephone.replace(/\s/g, '') === formData.client_telephone.replace(/\s/g, '')).length > 1;

  if (authLoading || permsLoading || !hasPermission('menu_centre_appel')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès en cours...</div>
  }

  // 🚀 BLOCAGE D'INTERFACE SI L'UTILISATEUR N'A PAS DE PROFIL AGENT
  if (agentIntrouvable) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A35139" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h2 className="text-xl font-bold text-[#1B2632]">Espace de travail indisponible</h2>
        <p className="text-sm text-[#1B2632]/60 max-w-md text-center">
          Votre compte n'est lié à aucun profil "Agent" actif. Veuillez demander à votre administrateur de vous créer un profil dans la section "Gestion des Utilisateurs".
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .drawer-in { animation: drawerIn 0.25s ease-out; }
        .fade-in { animation: fadeIn 0.2s ease-out; }
        .pop-in { animation: popIn 0.18s ease-out; }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1 flex items-center gap-2">
              Espace Personnel <span className="text-[#1B2632]/30">•</span> {agentActuel?.nom || 'Vue globale'}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2632]">Centre d'appels</h1>
          </div>
        </div>

        <div className="flex justify-between items-start mt-2 flex-wrap gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full lg:w-auto">
            {/* Ce qui reste à faire se lit d'un coup d'œil, même quand le
                séparateur est loin en bas de la page. Une seule liste (28/10) :
                les leads clôturés se lisent dans Commandes. */}
            <div className="text-sm text-[#1B2632]/60 font-medium">
              {comptes && (
                <>
                  {comptes.totalATraiter !== null && <span className="font-semibold text-[#1B2632]">{nomFiltreAgent} : </span>}
                  <span className={comptes.aTraiter > 0 ? 'font-bold text-[#A35139]' : ''}>{comptes.aTraiter}{surTotal(comptes.totalATraiter)} à traiter</span>
                  {' · '}
                  <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-[#1B2632]"
                    onClick={() => document.getElementById('separateur-suivi')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {comptes.traites}{surTotal(comptes.totalTraites)} en suivi
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full lg:w-auto">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[280px] focus-within:border-[#FFB162] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Nom, téléphone, N° commande..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                className="outline-none bg-transparent text-sm text-[#1B2632] font-medium w-full placeholder:text-[#1B2632]/30"
              />
              {recherche && (
                <button onClick={() => setRecherche('')} className="text-[#1B2632]/40 hover:text-[#A35139] text-xs">✕</button>
              )}
            </div>

            {/* Le filtre d'agent : au-dessus de la liste, jamais dans le panneau
                Filtres — il change ce qu'on croit « restant », il doit se voir. */}
            {peutFiltrerAgent && (
              <select
                value={filtreAgent}
                onChange={(e) => appliquer(setFiltreAgent)(e.target.value)}
                title="Ne montrer que les leads d'un agent. Ne change rien à ce que vous pouvez voir."
                className={`px-3 py-2.5 rounded-xl text-sm font-semibold shadow-sm border outline-none cursor-pointer max-w-full sm:max-w-[220px] ${
                  filtreAgent ? 'bg-[#1B2632] text-white border-[#1B2632]' : 'bg-white text-[#1B2632] border-[#C9C1B1]'
                }`}
              >
                <option value="">Tous les agents</option>
                <option value={AUCUN_AGENT}>Sans agent</option>
                {listeAgents.map((a) => <option key={a.id} value={a.id}>{libelleAgent(a)}</option>)}
              </select>
            )}

            {peutChangerAgent && statutsBas.length > 0 && (
              <button
                onClick={remonterLeads}
                disabled={remonteeEnCours}
                title="Remonter en tête de file tous les leads en attente de rappel que les filtres retiennent"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border bg-white text-[#1B2632] border-[#C9C1B1] hover:bg-[#EEE9DF]/50 disabled:opacity-50 transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                  <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
                </svg>
                {remonteeEnCours ? 'Remontée…' : 'Remonter'}
              </button>
            )}

            {peutChangerAgent && (
              <button
                onClick={() => setModeAgents(o => !o)}
                title="Afficher l'agent affecté à chaque lead et le changer"
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
                  modeAgents
                    ? 'bg-[#A35139] text-white border-[#A35139]'
                    : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {modeAgents ? 'Masquer les agents' : 'Agents'}
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setPanneauFiltresOuvert(o => !o)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm border transition-all ${
                  panneauFiltresOuvert || nombreFiltresActifs > 0
                    ? 'bg-[#1B2632] text-white border-[#1B2632]'
                    : 'bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50'
                }`}
              >
                Filtres
                {nombreFiltresActifs > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFB162] text-[#1B2632] text-[11px] font-bold flex items-center justify-center">
                    {nombreFiltresActifs}
                  </span>
                )}
              </button>

              {panneauFiltresOuvert && (
                <>
                  {/* Téléphone : feuille ancrée en bas, avec son propre défilement,
                      donc rien ne peut la rogner. Ordinateur : petit panneau sous le bouton. */}
                  <div
                    className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent"
                    onClick={() => setPanneauFiltresOuvert(false)}
                  />
                  <div className="fixed inset-x-3 bottom-3 max-h-[85dvh] overflow-y-auto z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[300px] sm:max-h-none sm:overflow-visible bg-white rounded-2xl border border-[#C9C1B1] shadow-xl p-5 pop-in">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-bold uppercase tracking-widest text-[#1B2632]/50">Filtres</span>
                      {nombreFiltresActifs > 0 && (
                        <button onClick={reinitialiserFiltres} className="text-xs font-semibold text-[#A35139] hover:underline">
                          Tout effacer
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-4">
                      <SelectFiltre label="Pays" value={filtrePays} onChange={appliquer(setFiltrePays)} options={optionsFiltres.pays.map(p => ({ value: p.id, label: p.nom }))} placeholder="Tous les pays" />
                      <SelectFiltre label="Produit" value={filtreProduit} onChange={appliquer(setFiltreProduit)} options={optionsFiltres.produits.map(p => ({ value: p, label: p }))} placeholder="Tous les produits" />
                      <SelectFiltre label="Ville" value={filtreVille} onChange={appliquer(setFiltreVille)} options={optionsFiltres.villes.map(v => ({ value: v, label: v }))} placeholder="Toutes les villes" />
                      <SelectFiltre label="Source" value={filtreSource} onChange={appliquer(setFiltreSource)} options={optionsFiltres.sources.map(s => ({ value: s, label: s }))} placeholder="Toutes les sources" />
                    </div>

                    <button onClick={() => setPanneauFiltresOuvert(false)} className="w-full mt-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors">
                      Appliquer
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 bg-white p-1 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-auto">
              <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest shrink-0">Du</span>
                <input type="date" value={dateDebut} onChange={(e) => { setDateDebut(e.target.value); allerPage1(); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer w-full min-w-0" />
              </div>
              <div className="hidden sm:block w-[1px] h-6 bg-[#C9C1B1]/40"></div>
              <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span className="text-[11px] font-bold text-[#1B2632]/40 uppercase tracking-widest shrink-0">Au</span>
                <input type="date" value={dateFin} onChange={(e) => { setDateFin(e.target.value); allerPage1(); }} className="outline-none bg-transparent text-sm text-[#1B2632] font-medium cursor-pointer w-full min-w-0" />
              </div>
            </div>

            {filtresActifs && (
              <button onClick={reinitialiserFiltres} className="text-xs font-semibold text-[#A35139] hover:underline">
                Réinitialiser
              </button>
            )}
          </div>
        </div>

        {(nombreFiltresActifs > 0 || filtreAgent) && (
          <div className="flex flex-wrap items-center gap-2">
            {filtreAgent && <ChipFiltre label={`Agent : ${nomFiltreAgent}`} onClear={() => appliquer(setFiltreAgent)('')} />}
            {filtrePays && <ChipFiltre label={`Pays : ${optionsFiltres.pays.find(p => String(p.id) === String(filtrePays))?.nom || ''}`} onClear={() => appliquer(setFiltrePays)('')} />}
            {filtreProduit && <ChipFiltre label={`Produit : ${filtreProduit}`} onClear={() => appliquer(setFiltreProduit)('')} />}
            {filtreVille && <ChipFiltre label={`Ville : ${filtreVille}`} onClear={() => appliquer(setFiltreVille)('')} />}
            {filtreSource && <ChipFiltre label={`Source : ${filtreSource}`} onClear={() => appliquer(setFiltreSource)('')} />}
          </div>
        )}
      </header>

      <ResultatLot resultat={resultatLot} onFermer={() => setResultatLot(null)} />

      {peutChangerAgent && lignesCochees.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-[#1B2632] text-white rounded-2xl px-4 py-3 shadow-sm">
          <span className="text-sm font-semibold">
            {lignesCochees.length} lead{lignesCochees.length > 1 ? 's' : ''} coché{lignesCochees.length > 1 ? 's' : ''}
            <span className="font-normal text-white/60"> — sur cette page seulement</span>
          </span>
          <select
            value={agentLot}
            onChange={(e) => setAgentLot(e.target.value)}
            className="text-sm rounded-lg px-3 py-2 bg-white text-[#1B2632] outline-none max-w-full sm:max-w-[220px]"
          >
            <option value="">Affecter à…</option>
            {agentsPourLot.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
          </select>
          {agentsPourLot.length === 0 && (
            <span className="text-xs text-[#FFB162]">Aucun agent ne couvre tous les pays cochés.</span>
          )}
          <button
            onClick={affecterLot}
            disabled={!agentLot || lotEnCours}
            className="text-sm font-bold px-4 py-2 rounded-lg bg-[#FFB162] text-[#1B2632] disabled:opacity-50"
          >
            {lotEnCours ? 'Affectation…' : 'Affecter'}
          </button>
          <button onClick={() => { setSelection({}); setRefusParId({}) }} className="text-xs font-semibold text-white/70 hover:text-white underline">
            Tout décocher
          </button>
        </div>
      )}

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {peutChangerAgent && !loading && commandes.length > 0 && (
          <p className="px-6 pt-3 pb-1 text-xs text-[#1B2632]/50">
            La case de l'en-tête coche les {lignesCochables.length} leads de cette page, pas toute la base.
          </p>
        )}
        <div className="overflow-auto min-h-[400px] max-h-[calc(100vh-280px)]">
          <table className="w-full min-w-[1050px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                {peutChangerAgent && (
                  <th className="pl-4 pr-1 py-4 w-[1%]">
                    {/* Coche ce qui est AFFICHÉ, jamais la base entière : le titre le dit. */}
                    <input type="checkbox" checked={toutCoche} onChange={basculerTout} disabled={lignesCochables.length === 0}
                      title={`Cocher les ${lignesCochables.length} leads de cette page (pas toute la base)`}
                      aria-label="Cocher les leads de cette page" className="w-4 h-4 cursor-pointer accent-[#1B2632]" />
                  </th>
                )}
                <th className="px-6 py-4">Lead ID</th>
                {!vueAgent && <th className="px-6 py-4">Date</th>}
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Pays</th>
                <th className="px-6 py-4">Ville / Zone</th>
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Prix</th>
                {modeAgents && <th className="px-6 py-4">Agent affecté</th>}
                <th className="px-6 py-4">Statut</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {loading ? (
                <tr><td colSpan={nbColonnes} className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : erreurChargement ? (
                <tr><td colSpan={nbColonnes} className="px-6 py-12 text-center text-sm font-medium text-[#A35139]">Impossible de charger les leads : {erreurChargement}</td></tr>
              ) : commandes.length === 0 ? (
                <tr><td colSpan={nbColonnes} className="px-6 py-12 text-center text-[#1B2632]/60">{agentActuel ? 'Aucun lead ne vous est assigné.'
                  : comptes?.totalATraiter != null
                    ? `Aucun lead pour « ${nomFiltreAgent} ». Tous agents confondus : ${comptes.totalATraiter} à traiter, ${comptes.totalTraites} en suivi.`
                    : 'Aucune commande pour ce filtre.'}</td></tr>
              ) : (
                commandes.map((cmd, i) => {
                  const estSelectionne = commandeSelectionnee?.id === cmd.id
                  // Un lead traité se date par son traitement (c'est l'ordre de
                  // son groupe), un lead à traiter par son arrivée.
                  const traite = cmd.groupe !== 'a_traiter'
                  const dateAffichage = traite ? (cmd.updated_at ? new Date(cmd.updated_at) : null) : (cmd.created_at ? new Date(cmd.created_at) : null)
                  // Le séparateur : avant le premier lead du bas, sur chaque page.
                  const separateur = comptes && cmd.groupe === 'traite' && commandes[i - 1]?.groupe !== 'traite'
                  // Le pager de chaque groupe, après sa dernière ligne, s'il a plusieurs pages.
                  const finDeGroupe = comptes && cmd.groupe !== commandes[i + 1]?.groupe
                  const pager = finDeGroupe && (cmd.groupe === 'a_traiter'
                    ? comptes.pagesHaut > 1 && { libelle: 'À traiter', page: comptes.pageHaut, pages: comptes.pagesHaut, total: comptes.aTraiter, aller: setPage }
                    : comptes.pagesBas > 1 && { libelle: 'En suivi', page: comptes.pageBas, pages: comptes.pagesBas, total: comptes.traites, aller: setPageBas })

                  return (
                    <Fragment key={cmd.id}>
                    {separateur && (
                      <tr id="separateur-suivi" className="bg-[#F4F0E6] scroll-mt-14">
                        <td colSpan={nbColonnes} className="px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-[#1B2632]/60 border-y border-[#C9C1B1]/60">
                          {comptes.aTraiter === 0 ? 'Rien à traiter' : `${comptes.aTraiter} à traiter au-dessus`}
                          <span className="text-[#1B2632]/30 mx-2">•</span>
                          {comptes.traites} en suivi : {vueAgent ? 'rappels à venir, confirmées pas encore livrées' : 'non joints, rappels à venir, confirmées pas encore livrées'}
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => ouvrirPanneau(cmd)}
                      className={`cursor-pointer transition-colors ${estSelectionne ? 'bg-[#FFB162]/10' : 'hover:bg-[#EEE9DF]/40'}`}
                    >
                      {peutChangerAgent && (
                        // La ligne ouvre le panneau d'appel : la case ne doit pas.
                        <td className="pl-4 pr-1 py-4" onClick={(e) => e.stopPropagation()}>
                          {cochable(cmd) && (
                            <input type="checkbox" checked={!!selection[cmd.id]} onChange={() => basculer(cmd.id)}
                              aria-label={`Cocher ${cmd.lead_id || 'ce lead'}`} className="w-4 h-4 cursor-pointer accent-[#1B2632]" />
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4 font-mono text-xs text-[#1B2632]/80 whitespace-nowrap">
                        #{cmd.lead_id || 'N/A'}
                        {refusParId[cmd.id] && (
                          <div className="font-sans text-[11px] font-semibold text-[#A35139] mt-1 max-w-[220px] whitespace-normal">Refusé : {refusParId[cmd.id]}</div>
                        )}
                      </td>
                      {!vueAgent && (
                        <td className="px-6 py-4 text-sm font-medium text-[#1B2632]/80 whitespace-nowrap">
                          {cmd.groupe === 'traite' && <span className="block text-[10px] uppercase tracking-wider text-[#1B2632]/40">traité le</span>}
                          {dateAffichage ? dateAffichage.toLocaleDateString('fr-FR') : '-'}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <div className="font-bold text-[#1B2632] whitespace-nowrap">{cmd.client_nom || 'Client inconnu'}</div>
                        <div className="font-mono text-xs text-[#A35139] font-semibold mt-1 whitespace-nowrap">{cmd.client_telephone || 'Aucun numéro'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-[#1B2632] whitespace-nowrap">{cmd.pays?.nom || '-'}</td>
                      <td className="px-6 py-4"><div className="text-sm font-medium text-[#1B2632] whitespace-nowrap">{cmd.ville_zone || '-'}</div></td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-[#1B2632] max-w-[180px] truncate" title={cmd.produit}>{cmd.produit || '-'}</div>
                        <div className="text-xs text-[#1B2632]/50 mt-0.5">Qté: {cmd.quantite || 1}</div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-sm text-[#1B2632] whitespace-nowrap">
                        {cmd.prix !== null && cmd.prix !== undefined ? cmd.prix : '-'}
                      </td>
                      {modeAgents && (
                        // La ligne entière ouvre le panneau de traitement : sans
                        // stopPropagation, choisir un agent déclencherait l'appel.
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                          <div className="text-sm font-semibold text-[#1B2632] whitespace-nowrap mb-1">
                            {nomAgent(cmd.agent_id) || <span className="text-[#A35139]">Non affecté</span>}
                          </div>

                          {/* Tout lead change d'agent, traité compris (29/10) : la même
                              règle que le lot. */}
                          {(
                            <div className="flex items-center gap-1.5">
                              <select
                                value={agentChoisi[cmd.id] || ''}
                                onChange={(e) => setAgentChoisi((prec) => ({ ...prec, [cmd.id]: e.target.value }))}
                                className="text-xs border border-[#C9C1B1] rounded-lg px-2 py-1.5 bg-white text-[#1B2632] outline-none focus:border-[#FFB162] max-w-[140px]"
                              >
                                <option value="">Changer…</option>
                                {/* Un agent ne peut traiter que les leads de son pays :
                                    la même règle qu'en base, mais visible ici. */}
                                {agentsAssignables
                                  .filter((a) => !cmd.pays_id || !a.pays_id || a.pays_id === cmd.pays_id)
                                  .filter((a) => a.id !== cmd.agent_id)
                                  .map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                              </select>

                              {agentChoisi[cmd.id] && (
                                <button
                                  onClick={() => changerAgent(cmd.id, agentChoisi[cmd.id])}
                                  disabled={agentEnCours === cmd.id}
                                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                  {agentEnCours === cmd.id ? '…' : 'OK'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <StatutPill statut={statutVu(cmd)} listeStatutsDB={listeStatutsDB} />
                        {cmd.date_rappel && statutsRappel.some((st) => st.nom === cmd.statut_confirmation) && (() => {
                          const r = libelleRappel(cmd.date_rappel, maintenantAffiche)
                          return r && (
                            <div className={`text-[11px] mt-1 whitespace-nowrap ${r.du ? 'font-bold text-[#A35139]' : 'text-[#8a5a1f]'}`}>
                              {r.texte} · {r.relatif}
                            </div>
                          )
                        })()}
                        {cmd.remonte_le && !vueAgent && (
                          <div className="text-[11px] font-bold text-[#A35139] mt-1 whitespace-nowrap">
                            ↑ Remonté le {new Date(cmd.remonte_le).toLocaleDateString('fr-FR')}
                          </div>
                        )}
                        {/* Le suivi : où en est la livraison de ce qu'il a confirmé. */}
                        {cmd.groupe === 'traite' && statutsSuivis.some((st) => st.nom === cmd.statut_confirmation) && (
                          <div className="text-[11px] text-[#1B2632]/50 mt-1 whitespace-nowrap">
                            Livraison : {LIVRAISON_LIBELLES[cmd.statut_livraison] || 'pas encore assignée'}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${estSelectionne ? 'bg-[#1B2632] text-white' : 'bg-[#EEE9DF] text-[#1B2632] border border-[#C9C1B1] hover:bg-[#C9C1B1]'}`}>
                          {statutsSuivis.some((st) => st.nom === cmd.statut_confirmation) ? 'Modifier' : 'Traiter'}
                        </button>
                      </td>
                    </tr>
                    {pager && (
                      <tr className="bg-[#EEE9DF]/30">
                        <td colSpan={nbColonnes} className="px-6 py-2.5">
                          <div className="flex items-center justify-between gap-3 text-xs text-[#1B2632]/60">
                            <span>
                              <b className="text-[#1B2632]/80">{pager.libelle}</b> : {(pager.page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(pager.page * ITEMS_PER_PAGE, pager.total)} sur {pager.total}
                            </span>
                            <span className="flex gap-2">
                              <button onClick={() => pager.aller(pager.page - 1)} disabled={pager.page <= 1 || loading}
                                className="px-3 py-1.5 rounded-lg font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50">Précédent</button>
                              <button onClick={() => pager.aller(pager.page + 1)} disabled={pager.page >= pager.pages || loading}
                                className="px-3 py-1.5 rounded-lg font-medium border border-[#C9C1B1] bg-white text-[#1B2632] disabled:opacity-50 hover:bg-[#EEE9DF]/50">Suivant</button>
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

      {commandeSelectionnee && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/30 backdrop-blur-[2px] z-40 fade-in" onClick={() => setCommandeSelectionnee(null)} />

          <div className="fixed top-0 right-0 h-screen w-[420px] max-w-full bg-white z-50 shadow-2xl border-l border-[#C9C1B1] flex flex-col drawer-in">
            <div className="flex justify-between items-start px-6 py-5 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              <div>
                <h2 className="text-lg font-bold text-[#1B2632] mb-1">
                  {statutsSuivis.some((st) => st.nom === commandeSelectionnee.statut_confirmation) ? 'Modifier la commande' : 'Traiter la commande'}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A35139]">#{commandeSelectionnee.lead_id || 'N/A'}</span>
                  {statutVu(commandeSelectionnee) && (
                    <StatutPill statut={statutVu(commandeSelectionnee)} listeStatutsDB={listeStatutsDB} />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="block font-mono font-bold text-sm text-[#1B2632]/70">
                    {formatTemps(tempsEcoule)}
                  </span>
                  {/* Le numéro d'appel dit combien de fois on a déjà essayé : pas
                      pour l'agent. */}
                  {!vueAgent && (
                    <span className="block text-[10px] uppercase tracking-wider text-[#1B2632]/40">
                      Appel n° {appelsPrecedents.length + 1}
                    </span>
                  )}
                </div>
                <button onClick={() => setCommandeSelectionnee(null)} className="w-8 h-8 rounded-lg text-[#1B2632]/40 hover:text-[#A35139] hover:bg-[#A35139]/10 transition-colors text-lg flex items-center justify-center">
                  ✕
                </button>
              </div>
            </div>

            {estUnDoublon && (
              <div className="mx-6 mt-5 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-0.5">Alerte Doublon</p>
                  <p className="text-[11px] leading-tight opacity-90">Ce numéro de téléphone apparaît plusieurs fois dans la liste actuelle.</p>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
              <div className="flex flex-col gap-5">
                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Nom du client</label>
                  <input
                    type="text"
                    value={formData.client_nom}
                    onChange={(e) => setFormData({...formData, client_nom: e.target.value})}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Téléphone Principal</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={formData.client_telephone}
                      onChange={(e) => setFormData({...formData, client_telephone: e.target.value})}
                      className="flex-1 border-b border-[#C9C1B1] py-2 text-sm font-mono font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    />
                    <a href={`tel:${formData.client_telephone}`} title="Appeler" className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg text-xs font-semibold transition-colors">Appeler</a>
                    <a href={`https://wa.me/${formData.client_telephone.replace(/[+\s]/g, '')}?text=${whatsappTexte}`} target="_blank" rel="noreferrer" title="WhatsApp" className="px-3 py-1.5 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 rounded-lg text-xs font-semibold transition-colors">WhatsApp</a>
                  </div>
                  {/* Ce que le vendeur a déposé avec le lead : surtout les numéros
                      en trop. En lecture seule — c'est l'agent qui appelle, il doit
                      les voir, mais il n'a pas à réécrire ce que le vendeur a donné. */}
                  {commandeSelectionnee?.notes && (
                    <p className="mt-2 text-[11px] text-[#1B2632]/60 italic">{commandeSelectionnee.notes}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Zone officielle</label>
                    <select
                      value={formData.zone_id}
                      onChange={(e) => {
                        const nouvelleZoneId = e.target.value;
                        const zoneSelectionnee = listeZones.find(z => String(z.id) === String(nouvelleZoneId));
                        setFormData({
                          ...formData, 
                          zone_id: nouvelleZoneId,
                          ville_zone: zoneSelectionnee ? zoneSelectionnee.nom_zone : formData.ville_zone 
                        });
                      }}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] font-bold bg-transparent focus:outline-none focus:border-[#FFB162]"
                    >
                      <option value="">Sélectionner...</option>
                      {listeZones.filter(z => !formData.pays_id || z.pays_id === formData.pays_id).map((z) => (
                        <option key={z.id} value={z.id}>{z.nom_zone}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Pays</label>
                    <select
                      value={formData.pays_id}
                      onChange={(e) => setFormData({...formData, pays_id: e.target.value, zone_id: ''})}
                      className="w-full border-b border-[#C9C1B1] py-2 text-sm text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                    >
                      <option value="">Sélectionner</option>
                      {listePays.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* L'adresse s'écrit ICI, pendant l'appel : le vendeur ne connaît
                    que le pays et la ville. C'est ce que le livreur lira devant
                    la porte. Un repère vaut une adresse. */}
                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">
                    Adresse de livraison {statutEnvoieAuLivreur && <span className="text-[#A35139]">*</span>}
                  </label>
                  <textarea
                    value={formData.adresse}
                    onChange={(e) => { setFormData({ ...formData, adresse: e.target.value }); setErreurEnvoi('') }}
                    placeholder="Rue, quartier ou repère : « près du marché, maison bleue »"
                    rows={2}
                    className={`w-full border-b py-2 text-sm text-[#1B2632] bg-transparent focus:outline-none focus:border-[#FFB162] resize-none ${adresseExigee ? 'border-[#A35139]' : 'border-[#C9C1B1]'}`}
                  />
                  {adresseExigee && (
                    <p className="mt-1 text-[11px] font-medium text-[#A35139]">{MESSAGE_ADRESSE}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Produit</label>
                    <div className="flex items-center gap-3">
                      {/* Le texte du champ, retrouvé comme la base (code, puis nom) :
                          s'il est corrigé pendant l'appel, l'image suit. Non reconnu → rien. */}
                      <VignetteProduit
                        chemin={produitDuCatalogue(formData.produit, catalogue).produit?.image_chemin}
                        taille={48} vide="rien" alt={formData.produit || ''} />
                      <input
                        type="text"
                        value={formData.produit}
                        onChange={(e) => setFormData({...formData, produit: e.target.value})}
                        className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Quantité</label>
                    <div className="flex items-center border-b border-[#C9C1B1]">
                      <button type="button" onClick={() => {
                        const newQty = Math.max(1, formData.quantite - 1);
                        setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                      }} className="px-2 py-2 text-[#1B2632] font-bold">-</button>
                      <input
                        type="number"
                        value={formData.quantite}
                        onChange={(e) => {
                          const newQty = parseInt(e.target.value) || 1;
                          setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                        }}
                        className="w-full text-center py-2 font-bold text-sm text-[#1B2632] outline-none bg-transparent"
                      />
                      <button type="button" onClick={() => {
                        const newQty = formData.quantite + 1;
                        setFormData({...formData, quantite: newQty, prix: newQty * formData.prixUnitaire});
                      }} className="px-2 py-2 text-[#1B2632] font-bold">+</button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Prix total</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.prix}
                    onChange={(e) => {
                      const newPrix = parseFloat(e.target.value) || 0;
                      setFormData({...formData, prix: newPrix, prixUnitaire: newPrix / (formData.quantite || 1)});
                    }}
                    className="w-full border-b border-[#C9C1B1] py-2 text-sm font-bold text-[#1B2632] focus:outline-none focus:border-[#FFB162] bg-transparent"
                  />
                </div>
              </div>

              {/* Les appels déjà passés. Ce qui compte avant de composer le
                  numéro : combien de fois on a déjà essayé, et ce que le
                  client avait dit. */}
              {appelsPrecedents.length > 0 && (
                <div className="p-4 rounded-xl border border-[#C9C1B1]/50 bg-white">
                  <p className="text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2.5">
                    {appelsPrecedents.length} appel{appelsPrecedents.length > 1 ? 's' : ''} déjà passé{appelsPrecedents.length > 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-col gap-2">
                    {appelsPrecedents.map((a) => (
                      <div key={a.id} className="text-xs border-l-2 border-[#C9C1B1] pl-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[#1B2632]">{libelleStatut(a.statut) || '—'}</span>
                          <span className="text-[#1B2632]/45">
                            {a.created_at ? new Date(a.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                          </span>
                          {a.duree_secondes != null && (
                            <span className="font-mono text-[#1B2632]/55">{formatTemps(a.duree_secondes)}</span>
                          )}
                        </div>
                        {a.notes && <p className="text-[#1B2632]/65 italic mt-0.5">{a.notes}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 bg-[#EEE9DF]/30 rounded-xl border border-[#C9C1B1]/50">
                <label className="block text-xs font-bold text-[#1B2632] uppercase tracking-wider mb-2">Résultat de l'appel</label>
                
                <select
                  value={statutChoisi}
                  onChange={(e) => setStatutChoisi(e.target.value)}
                  className="w-full border border-[#1B2632]/20 rounded-lg px-3 py-2.5 text-sm font-bold text-[#1B2632] bg-white shadow-sm"
                >
                  <option value="" disabled>-- Choisir --</option>
                  {statutsDeLaCommande.map((s) => (
                    <option key={s.id} value={s.nom}>{libelleStatut(s.nom)}</option>
                  ))}
                </select>

                {rappelDemande && (
                  <div className="mt-3">
                    <label className="block text-[11px] font-bold text-[#8a5a1f] uppercase mb-1">
                      Date et heure de rappel <span className="text-[#A35139]">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      required
                      min={bornesRappel.min}
                      max={bornesRappel.max}
                      value={formData.date_rappel}
                      onChange={(e) => { setFormData({...formData, date_rappel: e.target.value}); setErreurEnvoi('') }}
                      className="w-full border border-[#FFB162]/50 rounded-lg px-3 py-2 text-sm text-[#8a5a1f] bg-white outline-none"
                    />
                    <p className="mt-1 text-[11px] text-[#8a5a1f]/80">
                      À votre heure. Le lead reste en bas de la liste jusque-là, puis remonte seul dans la file.
                    </p>
                  </div>
                )}

                {/* La note de l'appel. Elle part dans `appels`, avec l'agent, le
                    statut et l'heure : on garde ce qui a été dit à ce moment-là,
                    au lieu d'écraser une note unique sur la commande. */}
                <div className="mt-3">
                  <label className="block text-[11px] font-bold text-[#1B2632]/50 uppercase mb-1">Note de l&apos;appel</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Ce que le client a dit..."
                    className="w-full border border-[#1B2632]/20 rounded-lg px-3 py-2 text-sm text-[#1B2632] bg-white outline-none focus:border-[#FFB162] min-h-[64px]"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20">
              {erreurEnvoi && (
                <p className="mb-3 text-xs font-medium text-[#A35139] bg-[#A35139]/5 border border-[#A35139]/30 rounded-lg px-3 py-2">{erreurEnvoi}</p>
              )}
              {hasPermission('traiter_appel') ? (
              <button
                onClick={validerAppel}
                disabled={envoiEnCours}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md"
              >
                {envoiEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              ) : (
                <p className="text-center text-xs text-[#1B2632]/50 py-3">Lecture seule : vous n'avez pas le droit de traiter un appel.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}