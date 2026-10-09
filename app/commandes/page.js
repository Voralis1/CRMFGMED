'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'
import * as XLSX from 'xlsx'

const TAILLE_PAGE = 50

// 🚀 Fonction StatutPill universelle pour les différents statuts
function StatutPill({ statut, listeStatutsDB, type = 'confirmation' }) {
  const statutConfiguré = (listeStatutsDB || []).find(s => s.nom === statut || s.id === statut)

  if (statutConfiguré && statutConfiguré.couleur) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap inline-flex items-center gap-1" 
            style={{ backgroundColor: `${statutConfiguré.couleur}15`, color: statutConfiguré.couleur, border: `1px solid ${statutConfiguré.couleur}40` }}>
        {statutConfiguré.nom}
      </span>
    )
  }

  const configsFallback = {
    'confirmed': { bg: 'bg-[#2C3B4D]/10', text: 'text-[#2C3B4D]', label: 'Confirmée' },
    'en_attente': { bg: 'bg-[#FFB162]/20', text: 'text-[#8a5a1f]', label: 'En attente' },
    'livre': { bg: 'bg-green-100', text: 'text-green-800', label: 'Livré' },
    'paye': { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Payé' },
    'non_paye': { bg: 'bg-red-100', text: 'text-red-800', label: 'Non payé' },
  }
  const conf = configsFallback[statut] || { bg: 'bg-gray-100', text: 'text-gray-700', label: statut || 'N/A' }
  
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${conf.bg} ${conf.text} whitespace-nowrap inline-block`}>
      {conf.label}
    </span>
  )
}

// Icônes en ligne pour les boutons d'en-tête, dans le même style que la capture
function IconExporter(props) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconImporter(props) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function IconPlus(props) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

// Les colonnes qu'on sait lire dans un fichier d'import, et sous quels noms.
// Une seule liste : elle sert à lire le fichier ET à montrer à l'écran quelle
// en-tête a été reconnue. Deux listes auraient fini par diverger, et l'aperçu
// aurait menti.
//
// `exacts` : le nom normalisé complet. `mots` : un repli, pour les en-têtes
// qu'on n'a pas prévues — « Unit Price (USD) » contient « price ».
const CHAMPS_IMPORT = [
  { cle: 'order_id',  nom: 'Order ID',     exacts: ['order_id', 'lead_id', 'leadid', 'id', 'numero_commande', 'reference'], mots: ['order_id', 'lead_id'] },
  { cle: 'produit',   nom: 'Product',      exacts: ['produit', 'product_name', 'product_id', 'product', 'produit_nom', 'article'], mots: ['produit', 'product', 'article'] },
  { cle: 'client',    nom: 'Customer',     exacts: ['client_nom', 'customer', 'customer_name', 'consumer_name', 'nom', 'client'], mots: ['customer', 'client', 'nom', 'name'] },
  { cle: 'telephone', nom: 'Phone number', exacts: ['client_telephone', 'telephone', 'tel', 'phone', 'phone_number', 'numero', 'gsm', 'mobile'], mots: ['phone', 'telephone', 'tel', 'numero'], requis: true },
  { cle: 'ville',     nom: 'City',         exacts: ['city', 'ville_zone', 'ville', 'zone'], mots: ['city', 'ville'] },
  { cle: 'adresse',   nom: 'Address',      exacts: ['address', 'adresse', 'addresse'], mots: ['address', 'adresse'] },
  { cle: 'quantite',  nom: 'Quantities',   exacts: ['quantite', 'quantities', 'quantity', 'qty', 'qte'], mots: ['quantit', 'qty', 'qte', 'nombre'] },
  { cle: 'prix',      nom: 'Unit price',   exacts: ['unit_price', 'prix_unitaire', 'prix', 'price', 'montant', 'total_price'], mots: ['price', 'prix', 'montant'] },
  { cle: 'store',     nom: 'Store',        exacts: ['store', 'store_name', 'boutique'], mots: ['store', 'boutique'] },
  { cle: 'notes',     nom: 'Notes',        exacts: ['notes', 'note', 'remarque'], mots: ['note', 'remarque'] },
]

// Accents retirés, minuscules, et tout ce qui n'est ni lettre ni chiffre
// devient « _ ». L'ancienne version ne remplaçait que les espaces et les
// tirets : une parenthèse ou un accent suffisait à ce que la colonne ne soit
// pas trouvée, et le prix arrivait à 0 sans que rien ne le dise.
function normaliserCle(cle) {
  return String(cle)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Quelle en-tête du fichier correspond à ce champ — ou null.
function enteteDe(entetes, cle) {
  const champ = CHAMPS_IMPORT.find((c) => c.cle === cle)
  if (!champ) return null
  for (const nom of champ.exacts) {
    const trouve = entetes.find((e) => normaliserCle(e) === nom)
    if (trouve) return trouve
  }
  for (const mot of champ.mots) {
    const trouve = entetes.find((e) => normaliserCle(e).includes(mot))
    if (trouve) return trouve
  }
  return null
}

function lireChamp(L, cle) {
  const champ = CHAMPS_IMPORT.find((c) => c.cle === cle)
  if (!champ) return ''
  for (const nom of champ.exacts) {
    const v = L[nom]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  for (const mot of champ.mots) {
    for (const k of Object.keys(L)) {
      if (!k.includes(mot)) continue
      const v = L[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return v
    }
  }
  return ''
}

export default function GestionCommandesPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, roleNom, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId

  // Only these roles may pick the agent by hand. A seller never sees the agent:
  // his lead is routed automatically by the database.
  const ROLES_AFFECTATION = ['admin', 'manager', 'ceo', 'super_admin']
  // Un seller ne voit que SES leads : ni ceux des autres sellers, ni ceux des
  // imports faits par le manager. La base applique la même règle (RLS), l'écran
  // ne fait que demander ce qu'il a le droit de lire.
  const estSeller = String(roleNom || '').toLowerCase() === 'seller'
  // Un responsable voit tous les leads de l'entreprise ; le filtre lui permet
  // de ne regarder qu'un seller à la fois.
  const peutFiltrerParVendeur = ROLES_AFFECTATION.includes(String(roleNom || '').toLowerCase())
  const peutChoisirAgent = ROLES_AFFECTATION.includes(String(roleNom || '').toLowerCase())

  const [commandes, setCommandes] = useState([])
  const [agents, setAgents] = useState([])
  const [listePays, setListePays] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [filtreVendeur, setFiltreVendeur] = useState('')

  // Les filtres sont saisis d'un côté et appliqués de l'autre : tant qu'on
  // n'a pas cliqué « Filtrer », la liste ne bouge pas. Sans ça, chaque
  // caractère tapé relance une requête sur toute la table.
  const CHAMPS_RECHERCHE = [
    { cle: 'tracking_number', nom: 'N° de suivi' },
    { cle: 'lead_id', nom: 'Lead ID' },
    { cle: 'client_telephone', nom: 'Téléphone client' },
    { cle: 'client_nom', nom: 'Nom du client' },
    { cle: 'ville_zone', nom: 'Ville / Zone' },
  ]
  const FILTRES_VIDES = { statut: '', produit: '', agent: '', source: '', du: '', au: '' }
  const [champRecherche, setChampRecherche] = useState('tracking_number')
  const [recherche, setRecherche] = useState('')
  const [filtres, setFiltres] = useState(FILTRES_VIDES)
  const [filtresActifs, setFiltresActifs] = useState({ ...FILTRES_VIDES, champ: 'tracking_number', texte: '' })
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const [detail, setDetail] = useState(null)
  const [lignesOuvertes, setLignesOuvertes] = useState(() => new Set())

  // Import : on choisit D'ABORD d'où part la marchandise. Tant que ce n'est
  // pas fait, rien d'autre ne s'affiche.
  //
  // Le responsable choisit un ENTREPÔT (Casablanca, Rabat...). Le vendeur,
  // lui, ne choisit qu'un PAYS : les entrepôts sont l'organisation interne de
  // FGMED, un vendeur externe n'a pas à savoir combien il y en a ni où.
  //
  // C'est son pays qui est appliqué à toutes les lignes — et le pays décide
  // quel agent recevra les leads. Une colonne « pays » mal orthographiée dans
  // le fichier était la première cause de refus ; il n'y en a plus.
  const [listeEntrepots, setListeEntrepots] = useState([])
  // Pour un vendeur : les pays où il y a VRAIMENT un entrepôt. Pas tous les
  // pays — il déposerait des commandes là où rien ne peut partir — et aucun
  // nom d'entrepôt, qui ne le regarde pas.
  const [paysLivrables, setPaysLivrables] = useState([])
  const [modaleImport, setModaleImport] = useState(false)
  const [importCibleId, setImportCibleId] = useState('')
  const [importAide, setImportAide] = useState(true)
  const [importFichier, setImportFichier] = useState(null)
  const [importEnCours, setImportEnCours] = useState(false)
  const [importResultat, setImportResultat] = useState(null)
  const [apercu, setApercu] = useState(null)

  const listeSellers = personnel.filter((p) => p.role === 'seller')
  const nomDuVendeur = (id) => {
    if (!id) return null
    const p = personnel.find((x) => x.user_id === id)
    return p ? (p.nom || p.email || '—') : null
  }
  const [listeStatutsDB, setListeStatutsDB] = useState([]) 
  const [totalCommandes, setTotalCommandes] = useState(0)
  const [pageActuelle, setPageActuelle] = useState(0)
  const [chargement, setChargement] = useState(true)

  // 🚀 État pour la modale de création manuelle
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [creationLoading, setCreationLoading] = useState(false)
  const [newCmd, setNewCmd] = useState({
    client_nom: '', client_telephone: '', pays_id: '', ville_zone: '',
    produit: '', quantite: 1, prix: 0, notes: '', agent_id: '', commentaire_1: ''
  })

  // REDIRECTION SÉCURISÉE
  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) router.replace('/')
      else if (!hasPermission('menu_commandes') && !hasPermission('menu_dashboard')) {
        router.replace('/dashboard')
      }
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  // CHARGEMENT DES RÉFÉRENTIELS
  const chargerReferentiels = useCallback(async () => {
    if (!tenantKey) return
    const [{ data: agentsData }, { data: paysData }, { data: statutsData }, { data: sellersData },
           { data: entrepotsData }, { data: paysLivrablesData }] = await Promise.all([
      supabase.from('agents').select('id, nom').eq('tenant_id', tenantKey).eq('actif', true),
      supabase.from('pays').select('id, nom, code').eq('tenant_id', tenantKey),
      supabase.from('statuts').select('*').eq('tenant_id', tenantKey),
      // sert à nommer le vendeur d'un lead et à retrouver celui nommé dans un
      // fichier importé. La RLS fait le tri : un responsable reçoit l'équipe,
      // un seller ne reçoit que sa propre ligne.
      supabase.from('user_roles').select('user_id, email, nom, role').eq('tenant_id', tenantKey),
      // Les entrepôts servent à l'import, côté responsable seulement. On ne
      // les demande même pas pour un vendeur : ce qu'on ne charge pas ne peut
      // pas fuiter dans la réponse réseau.
      estSeller
        ? Promise.resolve({ data: [] })
        : supabase.from('entrepots').select('id, nom, pays_id, pays(nom)')
            .eq('tenant_id', tenantKey).order('nom'),
      // La vue ne rend que des noms de pays, jamais d'entrepôt.
      estSeller
        ? supabase.from('v_pays_livrables').select('pays_id, nom')
            .eq('tenant_id', tenantKey).order('nom')
        : Promise.resolve({ data: [] }),
    ])
    if (agentsData) setAgents(agentsData)
    if (paysData) setListePays(paysData)
    if (statutsData) setListeStatutsDB(statutsData)
    if (sellersData) setPersonnel(sellersData)
    if (entrepotsData) setListeEntrepots(entrepotsData)
    if (paysLivrablesData) setPaysLivrables(paysLivrablesData)
  }, [tenantKey, estSeller])

  // Les produits et les sources proposés viennent de ce qui existe vraiment
  // dans la page : une liste fixe finirait par proposer des produits retirés
  // et par taire les nouveaux.
  const produitsConnus = useMemo(
    () => [...new Set(commandes.map((c) => c.produit).filter(Boolean))].sort(),
    [commandes],
  )
  const sourcesConnues = useMemo(
    () => [...new Set(commandes.map((c) => c.source).filter(Boolean))].sort(),
    [commandes],
  )
  const nombreFiltresActifs = [
    filtresActifs.statut, filtresActifs.produit, filtresActifs.agent,
    filtresActifs.source, filtresActifs.du, filtresActifs.au,
  ].filter(Boolean).length

  // Ce que le choix du haut désigne, selon qui regarde.
  const cibleImport = useMemo(() => {
    if (!importCibleId) return null
    if (estSeller) {
      const p = paysLivrables.find((x) => x.pays_id === importCibleId)
      // Le vendeur n'a pas choisi d'entrepôt : on n'en invente pas un. Le
      // responsable le renseignera s'il y en a plusieurs dans ce pays.
      return p ? { pays_id: p.pays_id, entrepot_id: null, nom: p.nom, pretE: true } : null
    }
    const e = listeEntrepots.find((x) => x.id === importCibleId)
    return e ? { pays_id: e.pays_id, entrepot_id: e.id, nom: e.nom, pretE: !!e.pays_id } : null
  }, [importCibleId, estSeller, paysLivrables, listeEntrepots])

  // Le détail d'une commande tient sous sa ligne : on vérifie un produit ou
  // un entrepôt sans quitter la liste ni ouvrir la fiche complète.
  function basculerLigne(id) {
    setLignesOuvertes((prev) => {
      const suivant = new Set(prev)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })
  }

  function appliquerFiltres() {
    setFiltresActifs({ ...filtres, champ: champRecherche, texte: recherche })
    setPageActuelle(0)
    setPanneauOuvert(false)
  }

  function reinitialiserFiltres() {
    setFiltres(FILTRES_VIDES)
    setRecherche('')
    setChampRecherche('tracking_number')
    setFiltresActifs({ ...FILTRES_VIDES, champ: 'tracking_number', texte: '' })
    setPageActuelle(0)
  }

  // CHARGEMENT DES COMMANDES (Récupère TOUTES les colonnes de la base)
  const chargerCommandes = useCallback(async (page) => {
    if (!tenantKey) return
    setChargement(true)

    const debut = page * TAILLE_PAGE
    const fin = debut + TAILLE_PAGE - 1

    let requete = supabase
      .from('commandes')
      .select('*, pays(nom, devise), agents(nom), entrepots(nom)', { count: 'exact' })
      .eq('tenant_id', tenantKey)
    // un seller ne demande que ses propres leads
    if (estSeller && user?.id) requete = requete.eq('vendeur_id', user.id)
    // un responsable peut n'en regarder qu'un à la fois
    else if (filtreVendeur === 'aucun') requete = requete.is('vendeur_id', null)
    else if (filtreVendeur) requete = requete.eq('vendeur_id', filtreVendeur)

    const f = filtresActifs
    if (f.texte) {
      // Les caractères de la syntaxe PostgREST sont retirés : un « , » ou une
      // parenthèse tapés par erreur casseraient la requête au lieu de ne rien
      // trouver.
      const t = f.texte.replace(/[%,()]/g, '').trim()
      if (t) requete = requete.ilike(f.champ, `%${t}%`)
    }
    if (f.statut === 'aucun') requete = requete.is('statut_confirmation', null)
    else if (f.statut) requete = requete.eq('statut_confirmation', f.statut)
    if (f.produit) requete = requete.eq('produit', f.produit)
    if (f.agent === 'aucun') requete = requete.is('agent_id', null)
    else if (f.agent) requete = requete.eq('agent_id', f.agent)
    if (f.source) requete = requete.eq('source', f.source)
    if (f.du) requete = requete.gte('created_at', f.du)
    // La borne haute couvre la journée entière : sans l'heure, « au 10 » exclut
    // tout ce qui est arrivé le 10.
    if (f.au) requete = requete.lte('created_at', `${f.au}T23:59:59`)

    const { data, count, error } = await requete
      .order('created_at', { ascending: false })
      .range(debut, fin)

    if (error) {
      alert("Erreur lors du chargement : " + error.message)
    } else {
      setCommandes(data || [])
      setTotalCommandes(count || 0)
    }
    setChargement(false)
  }, [tenantKey, estSeller, user?.id, filtreVendeur, filtresActifs])

  useEffect(() => {
    if (authLoading || permsLoading || !tenantKey) return
    chargerReferentiels()
    chargerCommandes(pageActuelle)
  }, [authLoading, permsLoading, tenantKey, pageActuelle, chargerReferentiels, chargerCommandes])

  // ASSIGNATION D'UN AGENT
  async function assignerAgent(commandeId, agentId) {
    const valueToSet = agentId === "" ? null : agentId;
    
    const { error } = await supabase
      .from('commandes')
      .update({ agent_id: valueToSet })
      .eq('id', commandeId)
      .eq('tenant_id', tenantKey)

    if (error) {
      alert("Erreur d'assignation : " + error.message)
    } else {
      setCommandes(prev => prev.map(cmd => cmd.id === commandeId ? { ...cmd, agent_id: valueToSet } : cmd))
    }
  }

  // CRÉATION MANUELLE
  async function handleCreateCommande(e) {
    e.preventDefault()
    setCreationLoading(true)

    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const leadIdGeneré = `MAN-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`

    const { error } = await supabase.from('commandes').insert([{
      lead_id: leadIdGeneré,
      client_nom: newCmd.client_nom,
      client_telephone: newCmd.client_telephone,
      pays_id: newCmd.pays_id || null,
      ville_zone: newCmd.ville_zone,
      produit: newCmd.produit,
      quantite: parseInt(newCmd.quantite) || 1,
      prix: parseFloat(newCmd.prix) || 0,
      notes: newCmd.notes,
      commentaire_1: newCmd.commentaire_1,
      source: 'manuel',
      agent_id: newCmd.agent_id || null,
      vendeur_id: user?.id || null,
      tenant_id: tenantKey
    }])

    setCreationLoading(false)

    if (error) {
      alert("Erreur lors de la création : " + error.message)
    } else {
      setIsCreateModalOpen(false)
      setNewCmd({ client_nom: '', client_telephone: '', pays_id: '', ville_zone: '', produit: '', quantite: 1, prix: 0, notes: '', agent_id: '', commentaire_1: '' })
      chargerCommandes(0)
      setPageActuelle(0)
    }
  }

  // EXPORT CSV COMPLET (Toutes les colonnes DB)
  function exporterCSV() {
    if (commandes.length === 0) {
      alert("Aucune commande à exporter dans cette vue.");
      return;
    }

    const entetes = [
      "Lead ID", "Source", "Source Sheet", "Client", "Téléphone", "Pays", "Ville / Zone", 
      "Produit", "Quantité", "Prix", "Statut Confirmation", "Statut Livraison", "Statut Paiement", 
      "Doublon", "Agent Assigné", "Vendeur", "Commentaire 1", "Commentaire 2", "Notes",
      "Date Rappel", "Date Création", "Date MAJ"
    ]

    const lignes = commandes.map(c => [
      c.lead_id || "",
      c.source || "",
      c.source_sheet || "",
      `"${(c.client_nom || "").replace(/"/g, '""')}"`,
      `"${(c.client_telephone || "").replace(/"/g, '""')}"`,
      `"${(c.pays?.nom || "").replace(/"/g, '""')}"`,
      `"${(c.ville_zone || "").replace(/"/g, '""')}"`,
      `"${(c.produit || "").replace(/"/g, '""')}"`,
      c.quantite || 1,
      c.prix || 0,
      c.statut_confirmation || "",
      c.statut_livraison || "",
      c.statut_paiement || "",
      c.is_doublon ? "Oui" : "Non",
      `"${(c.agents?.nom || "Non assigné").replace(/"/g, '""')}"`,
      `"${(nomDuVendeur(c.vendeur_id) || "").replace(/"/g, '""')}"`,
      `"${(c.commentaire_1 || "").replace(/"/g, '""')}"`,
      `"${(c.commentaire_2 || "").replace(/"/g, '""')}"`,
      `"${(c.notes || "").replace(/"/g, '""')}"`,
      c.date_rappel ? new Date(c.date_rappel).toLocaleString('fr-FR') : "",
      c.created_at ? new Date(c.created_at).toLocaleString('fr-FR') : "",
      c.updated_at ? new Date(c.updated_at).toLocaleString('fr-FR') : ""
    ])

    const contenuCSV = [entetes.join(","), ...lignes.map(l => l.join(","))].join("\n")
    const blob = new Blob([contenuCSV], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const lien = document.createElement("a")
    lien.setAttribute("href", url)
    lien.setAttribute("download", `toutes_les_commandes_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(lien)
    lien.click()
    document.body.removeChild(lien)
  }

  // IMPORT EXCEL / CSV
  //
  // À qui appartiennent les commandes importées : à la personne qui importe.
  // Pas de colonne « vendeur » dans le fichier — on sait déjà qui est connecté,
  // et une colonne de plus serait une colonne de plus à se tromper.
  //
  // Un responsable n'est pas un vendeur : quand c'est lui qui importe, les
  // commandes n'appartiennent à personne en particulier et seuls les
  // responsables les verront.
  function vendeurDeLImport() {
    return estSeller ? (user?.id || null) : null
  }

  function ouvrirImport() {
    const choix = estSeller
      ? paysLivrables.map((p) => p.pays_id)
      : listeEntrepots.map((e) => e.id)
    setImportCibleId(choix.length === 1 ? choix[0] : '')
    setImportFichier(null)
    setApercu(null)
    setImportResultat(null)
    setModaleImport(true)
  }

  // « 0708852502|0708852501 » : le premier numéro est celui qu'on appelle,
  // les autres sont notés pour que l'agent les ait sous les yeux s'il ne
  // répond pas. Les perdre reviendrait à perdre une chance de joindre le client.
  function separerNumeros(brut) {
    const parts = String(brut || '').split('|').map((x) => x.trim()).filter(Boolean)
    return { principal: parts[0] || '', autres: parts.slice(1) }
  }

  // « PRODUIT A|PRODUIT B » avec « 2|1 » et « 900|500 ».
  //
  // LE PRIX N'EST JAMAIS RECALCULÉ. Ce qui est écrit dans le fichier est ce
  // qui est enregistré, et c'est ce que le livreur verra. Multiplier par la
  // quantité « pour bien faire » reviendrait à décider à la place du vendeur
  // du montant qu'on encaisse chez son client.
  //
  // Une commande ne porte qu'un produit et un montant : c'est un colis, et
  // c'est une somme à encaisser. Quand le fichier met plusieurs articles sur
  // la même ligne, on les réunit en une seule commande — sinon un client qui
  // prend deux articles compterait pour deux livraisons et deux encaissements.
  // Les prix sont alors additionnés, rien de plus.
  function fusionnerProduits(nom, quantite, prix) {
    const nombre = (x) => {
      const n = parseFloat(String(x).replace(/[^\d.,-]/g, '').replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    const noms = String(nom || '').split('|').map((x) => x.trim()).filter(Boolean)
    const qtes = String(quantite || '').split('|').map((x) => parseInt(x) || 0).filter((x) => x > 0)
    const prixs = String(prix || '').split('|').map(nombre).filter((x) => x !== null)

    return {
      produit: noms.length ? noms.join(' + ') : 'Produit standard',
      quantite: qtes.length ? qtes.reduce((a, b) => a + b, 0) : 1,
      prix: Math.max(0, prixs.reduce((a, b) => a + b, 0)),
    }
  }

  // Dès que le fichier est choisi, on lit SEULEMENT sa première ligne et on
  // montre quelle en-tête a été reconnue pour quoi. C'est ce qui manquait
  // quand le prix arrivait à 0 : rien ne disait que la colonne n'avait pas
  // été trouvée.
  async function analyserFichier(fichier) {
    setImportFichier(fichier)
    setImportResultat(null)
    setApercu(null)
    if (!fichier) return
    try {
      const data = await new Promise((resolve, reject) => {
        const l = new FileReader()
        l.onload = (e) => resolve(new Uint8Array(e.target.result))
        l.onerror = () => reject(new Error('Fichier illisible'))
        l.readAsArrayBuffer(fichier)
      })
      const classeur = XLSX.read(data, { type: 'array' })
      const feuille = classeur.Sheets[classeur.SheetNames[0]]
      const lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '' })
      const entetes = (lignes[0] || []).map((x) => String(x).trim()).filter(Boolean)
      setApercu({
        nbLignes: Math.max(0, lignes.length - 1),
        entetes,
        correspondances: CHAMPS_IMPORT.map((c) => ({
          nom: c.nom, requis: !!c.requis, entete: enteteDe(entetes, c.cle),
        })),
      })
    } catch (e) {
      setApercu({ erreur: e?.message || 'Fichier illisible' })
    }
  }

  async function lancerImport() {
    if (!importFichier || !tenantKey) return
    const cible = cibleImport
    if (!cible) { alert(estSeller ? 'Choisissez le pays.' : 'Choisissez l\'entrepôt.'); return }
    // Sans pays, impossible de savoir quel agent doit recevoir les leads :
    // mieux vaut refuser tout de suite que les faire entrer orphelins.
    if (!cible.pretE) {
      setImportResultat({
        erreur: `L'entrepôt « ${cible.nom} » n'a pas de pays. Un responsable doit le renseigner dans Paramètres avant d'importer.`,
      })
      return
    }

    setImportEnCours(true)
    setImportResultat(null)

    const lire = () => new Promise((resolve, reject) => {
      const lecteur = new FileReader()
      lecteur.onload = (e) => resolve(new Uint8Array(e.target.result))
      lecteur.onerror = () => reject(new Error('Fichier illisible'))
      lecteur.readAsArrayBuffer(importFichier)
    })

    try {
      const classeur = XLSX.read(await lire(), { type: 'array' })
      const lignes = XLSX.utils.sheet_to_json(classeur.Sheets[classeur.SheetNames[0]], { defval: '' })

      if (lignes.length === 0) {
        setImportResultat({ erreur: 'Le fichier est vide.' })
        setImportEnCours(false)
        return
      }

      const refusees = []

      const candidates = lignes.map((ligne, i) => {
        const L = {}
        for (const cle in ligne) L[normaliserCle(cle)] = ligne[cle]

        const tel = separerNumeros(lireChamp(L, 'telephone'))
        if (!tel.principal) {
          refusees.push(`Ligne ${i + 2} : téléphone manquant`)
          return null
        }

        const art = fusionnerProduits(
          lireChamp(L, 'produit'), lireChamp(L, 'quantite'), lireChamp(L, 'prix'),
        )

        const idFichier = String(lireChamp(L, 'order_id')).trim()
        const suffixe = idFichier ||
          `LEAD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

        const notes = [
          lireChamp(L, 'notes'),
          tel.autres.length ? `Autres numéros : ${tel.autres.join(', ')}` : '',
        ].filter(Boolean).join(' · ')

        return {
          lead_id: suffixe,
          client_nom: lireChamp(L, 'client') || 'Inconnu',
          client_telephone: tel.principal,
          // La ville sert à trouver la zone, donc le livreur. L'adresse, elle,
          // est ce que le livreur lit devant la porte : les deux sont gardées.
          ville_zone: lireChamp(L, 'ville'),
          adresse: lireChamp(L, 'adresse'),
          produit: art.produit,
          quantite: art.quantite,
          prix: art.prix,
          source: 'csv',
          // « Store » : la boutique du vendeur d'où vient la commande.
          source_sheet: lireChamp(L, 'store') || null,
          notes,
          commentaire_1: L['commentaire_1'] || '',
          // Le pays vient de l'entrepôt choisi, pas du fichier : un seul
          // endroit où se tromper au lieu d'une colonne par ligne.
          pays_id: cible.pays_id,
          // D'où la marchandise doit sortir. Le pays en vient, mais il ne
          // suffit pas : deux entrepôts peuvent être dans le même pays.
          // Vide quand c'est un vendeur qui importe : il n'a choisi qu'un pays.
          entrepot_id: cible.entrepot_id,
          tenant_id: tenantKey,
          vendeur_id: vendeurDeLImport(),
        }
      }).filter(Boolean)

      if (candidates.length === 0) {
        setImportResultat({ erreur: 'Aucune ligne utilisable.', refusees })
        setImportEnCours(false)
        return
      }

      // Importer deux fois le même fichier ne doit rien dupliquer. On demande
      // à la base quels numéros elle connaît déjà, par paquets : une liste de
      // 2 000 numéros dans une URL serait refusée.
      //
      // Le numéro vient du vendeur, et deux vendeurs peuvent très bien avoir
      // chacun une commande « 1234 ». On compare donc le numéro ET le vendeur :
      // sinon la commande du second serait prise pour un doublon de celle du
      // premier, et jetée en silence.
      const vendeur = vendeurDeLImport()
      const deja = new Set()
      const ids = candidates.map((c) => c.lead_id)
      for (let i = 0; i < ids.length; i += 200) {
        let r = supabase.from('commandes')
          .select('lead_id').eq('tenant_id', tenantKey).in('lead_id', ids.slice(i, i + 200))
        r = vendeur ? r.eq('vendeur_id', vendeur) : r.is('vendeur_id', null)
        const { data } = await r
        for (const x of data || []) deja.add(x.lead_id)
      }

      const aInserer = candidates.filter((c) => !deja.has(c.lead_id))
      let inserees = 0
      let erreur = null

      for (let i = 0; i < aInserer.length; i += 500) {
        const { error } = await supabase.from('commandes').insert(aInserer.slice(i, i + 500))
        if (error) { erreur = error.message; break }
        inserees += aInserer.slice(i, i + 500).length
      }

      setImportResultat({
        erreur,
        total: lignes.length,
        inserees,
        doublons: candidates.length - aInserer.length,
        refusees,
      })

      if (inserees > 0) { chargerCommandes(0); setPageActuelle(0) }
    } catch (e) {
      setImportResultat({ erreur: e?.message || 'Erreur de lecture du fichier.' })
    }
    setImportEnCours(false)
  }

  const totalPages = Math.max(1, Math.ceil(totalCommandes / TAILLE_PAGE))

  if (authLoading || permsLoading) {
    return <div className="p-8 text-[#1B2632] font-medium text-center mt-20">Vérification des accès...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        .cm-label { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(27,38,50,.55); margin-bottom:6px; }
        .cm-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .cm-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        @keyframes popInCm { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in-cm { animation: popInCm .18s ease-out; }
      `}</style>
      
      {/* En-tête */}
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 border-b border-[#C9C1B1]/50 pb-4">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Commerce & Logistique
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">
            Toutes les commandes (Vue globale)
          </h1>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {peutFiltrerParVendeur && listeSellers.length > 0 && (
            <select
              value={filtreVendeur}
              onChange={(e) => { setFiltreVendeur(e.target.value); setPageActuelle(0) }}
              title="N'afficher que les leads d'un vendeur"
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-full text-sm font-bold text-[#1B2632] outline-none focus:border-[#FFB162] cursor-pointer"
            >
              <option value="">Tous les vendeurs</option>
              {listeSellers.map((v) => (
                <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>
              ))}
              <option value="aucun">Sans vendeur (imports)</option>
            </select>
          )}

          {hasPermission('exporter_csv') && (
            <button
              onClick={exporterCSV}
              title="Exporter toutes les colonnes en CSV"
              className="flex flex-1 sm:flex-none justify-center items-center gap-2 px-3 sm:px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-full text-sm font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 hover:border-[#1B2632]/30 transition-colors shadow-sm cursor-pointer"
            >
              <IconExporter />
              Exporter CSV
            </button>
          )}

          {hasPermission('importer_csv') && (
            <button
              onClick={ouvrirImport}
              title="Importer des commandes depuis un fichier CSV ou Excel"
              className="flex flex-1 sm:flex-none justify-center items-center gap-2 px-3 sm:px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-full text-sm font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 hover:border-[#1B2632]/30 transition-colors shadow-sm cursor-pointer"
            >
              <IconImporter />
              Importer CSV
            </button>
          )}
          
          {hasPermission('creer_commande') && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex w-full sm:w-auto justify-center items-center gap-2 px-4 py-2.5 bg-[#1B2632] text-white rounded-full text-sm font-bold hover:bg-[#2C3B4D] transition-colors shadow-sm cursor-pointer"
            >
              <IconPlus />
              Nouvelle commande
            </button>
          )}
        </div>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm">
        {/* Téléphone : chaque élément sur sa ligne, en pleine largeur.
            Ordinateur : une seule barre. Collés en une rangée sur un écran
            de 360 px, le champ de saisie tombait sous les 80 px. */}
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
              className="flex-1 sm:flex-none px-4 py-2.5 sm:py-0 rounded-xl sm:rounded-none bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors flex items-center justify-center gap-2 font-semibold text-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <span className="sm:hidden">Rechercher</span>
            </button>

            <button
              onClick={() => setPanneauOuvert((o) => !o)}
              className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-0 rounded-xl sm:rounded-l-none sm:rounded-r-xl border transition-colors flex items-center justify-center gap-2 font-semibold text-sm ${
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="cm-label">Statut</label>
                <select className="cm-input" value={filtres.statut}
                  onChange={(e) => setFiltres({ ...filtres, statut: e.target.value })}>
                  <option value="">Tous</option>
                  <option value="aucun">Pas encore traité</option>
                  {listeStatutsDB.map((st) => <option key={st.id} value={st.nom}>{st.nom}</option>)}
                </select>
              </div>

              <div>
                <label className="cm-label">Produit</label>
                <select className="cm-input" value={filtres.produit}
                  onChange={(e) => setFiltres({ ...filtres, produit: e.target.value })}>
                  <option value="">Tous</option>
                  {produitsConnus.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                </select>
              </div>

              <div>
                <label className="cm-label">Agent</label>
                <select className="cm-input" value={filtres.agent}
                  onChange={(e) => setFiltres({ ...filtres, agent: e.target.value })}>
                  <option value="">Tous</option>
                  <option value="aucun">Non affecté</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
                </select>
              </div>

              <div>
                <label className="cm-label">Source</label>
                <select className="cm-input" value={filtres.source}
                  onChange={(e) => setFiltres({ ...filtres, source: e.target.value })}>
                  <option value="">Toutes</option>
                  {sourcesConnues.map((so) => <option key={so} value={so}>{so}</option>)}
                </select>
              </div>

              <div>
                <label className="cm-label">Arrivée</label>
                <div className="flex flex-col sm:flex-row items-stretch gap-1.5">
                  <input type="date" className="cm-input" value={filtres.du}
                    onChange={(e) => setFiltres({ ...filtres, du: e.target.value })} />
                  <input type="date" className="cm-input" value={filtres.au}
                    onChange={(e) => setFiltres({ ...filtres, au: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3 mt-5">
              <button onClick={reinitialiserFiltres}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 2v6h6" /><path d="M3.5 13a9 9 0 1 0 2.6-5.4L3 8" /></svg>
                Réinitialiser
              </button>
              <button onClick={appliquerFiltres}
                className="flex items-center justify-center gap-2 px-8 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                Filtrer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tableau ultra-enrichi affichant le max de colonnes de la DB */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto min-h-[500px] max-h-[72vh]">
          <table className="w-full min-w-[1250px] text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#C9D3DD] text-[11px] uppercase tracking-wider text-[#1B2632]/70 font-bold">
                <th className="px-4 py-3.5">ID</th>
                {!estSeller && <th className="px-4 py-3.5">Vendeur</th>}
                <th className="px-4 py-3.5">Client</th>
                <th className="px-4 py-3.5">Détails</th>
                <th className="px-4 py-3.5">Adresse de livraison</th>
                <th className="px-4 py-3.5">Prix total</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Statut</th>
                <th className="px-4 py-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {chargement ? (
                <tr><td colSpan={estSeller ? 8 : 9} className="text-center py-12 text-[#1B2632]/50">Chargement des données...</td></tr>
              ) : commandes.length === 0 ? (
                <tr><td colSpan={estSeller ? 8 : 9} className="text-center py-12 text-[#1B2632]/50">Aucune commande trouvée.</td></tr>
              ) : (
                commandes.map((cmd, i) => {
                  const ouverte = lignesOuvertes.has(cmd.id)
                  const fond = i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'
                  return (
                  <React.Fragment key={cmd.id}>
                  <tr className={`${fond} hover:bg-[#EEE9DF]/30 transition-colors border-b border-[#C9C1B1]/25`}>

                    <td className="px-4 py-3.5 align-top">
                      <div className="font-mono font-bold text-[#1B2632] text-sm">{cmd.lead_id || '—'}</div>
                      <div className="text-[10px] text-[#5c5648] uppercase bg-[#EEE9DF] px-1.5 py-0.5 rounded w-fit mt-1">
                        {cmd.source || 'direct'}{cmd.source_sheet ? ` · ${cmd.source_sheet}` : ''}
                      </div>
                    </td>

                    {!estSeller && (
                      <td className="px-4 py-3.5 align-top text-sm text-[#1B2632]/80">
                        {nomDuVendeur(cmd.vendeur_id) || <span className="text-[#1B2632]/35">—</span>}
                      </td>
                    )}

                    <td className="px-4 py-3.5 align-top">
                      <div className="font-bold text-[#1B2632] text-sm">{cmd.client_nom || '—'}</div>
                      {cmd.client_telephone
                        ? <a href={`tel:${cmd.client_telephone}`} className="font-mono text-[#A35139] hover:underline">{cmd.client_telephone}</a>
                        : <span className="text-[#1B2632]/35">—</span>}
                      {cmd.is_doublon && <span className="block mt-1 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold w-fit">Doublon</span>}
                    </td>

                    {/* Le chevron ouvre la ligne de détail juste en dessous. */}
                    <td className="px-4 py-3.5 align-top">
                      <button onClick={() => basculerLigne(cmd.id)} className="flex items-start gap-2 text-left cursor-pointer group">
                        <span className="leading-tight">
                          <span className="font-bold text-[#A35139]">1</span>{' '}
                          <span className="text-[#1B2632]/80">produit</span>
                          <span className="block text-[11px] text-[#1B2632]/50">
                            {cmd.created_at ? new Date(cmd.created_at).toLocaleDateString('fr-CA') : '—'}
                          </span>
                        </span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A35139" strokeWidth="2.5" strokeLinecap="round"
                             className="mt-0.5 shrink-0 group-hover:opacity-70"
                             style={{ transform: ouverte ? 'rotate(180deg)' : 'none' }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </td>

                    {/* L'adresse telle qu'elle est arrivée. Le pays de l'entrepôt
                        ne vient jamais s'y substituer : il vit à part, dans la
                        ligne de détail. */}
                    <td className="px-4 py-3.5 align-top max-w-[260px]">
                      <div className="text-sm text-[#1B2632]">{cmd.adresse || <span className="text-[#1B2632]/35">—</span>}</div>
                      {cmd.ville_zone && <div className="text-[11px] text-[#1B2632]/55 mt-0.5">{cmd.ville_zone}</div>}
                    </td>

                    <td className="px-4 py-3.5 align-top whitespace-nowrap">
                      <span className="font-mono font-bold text-sm text-[#1B2632]">{cmd.prix ?? 0}</span>
                      {cmd.pays?.devise && <span className="text-[10px] text-[#1B2632]/50 ml-1 align-super">{cmd.pays.devise}</span>}
                    </td>

                    <td className="px-4 py-3.5 align-top text-sm text-[#1B2632]/75 whitespace-nowrap">
                      {cmd.created_at ? new Date(cmd.created_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <StatutPill statut={cmd.statut_confirmation} listeStatutsDB={listeStatutsDB} />
                      {cmd.date_rappel && (
                        <span className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-1 w-fit">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                          À rappeler · {new Date(cmd.date_rappel).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      )}
                      {(cmd.statut_livraison || cmd.statut_paiement) && (
                        <span className="block mt-1 text-[10px] text-[#1B2632]/55">
                          {cmd.statut_livraison ? `Livraison : ${cmd.statut_livraison}` : ''}
                          {cmd.statut_livraison && cmd.statut_paiement ? ' · ' : ''}
                          {cmd.statut_paiement ? `Paiement : ${cmd.statut_paiement}` : ''}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 align-top text-center">
                      <button onClick={() => setDetail(cmd)} title="Voir le détail"
                        className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-[#1B2632]/60 hover:text-[#A35139] hover:bg-[#EEE9DF] transition-colors cursor-pointer">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                      </button>
                    </td>
                  </tr>

                  {ouverte && (
                    <tr className="bg-[#E3EFF8] border-b border-[#C9C1B1]/25">
                      <td colSpan={estSeller ? 8 : 9} className="px-4 py-0">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-[#1B2632]/55 font-bold">
                              <th className="px-3 py-2.5 w-[22%]">Entrepôt</th>
                              <th className="px-3 py-2.5">Produit</th>
                              <th className="px-3 py-2.5 w-[14%]">Prix</th>
                              <th className="px-3 py-2.5 w-[12%]">Quantité</th>
                              <th className="px-3 py-2.5 w-[18%]">Pays</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="px-3 py-2.5 text-[#1B2632]">
                                {cmd.entrepots?.nom || <span className="text-[#1B2632]/40">Non renseigné</span>}
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-[#A35139]">{cmd.produit || '—'}</td>
                              <td className="px-3 py-2.5 font-mono text-[#1B2632]">{cmd.prix ?? 0}</td>
                              <td className="px-3 py-2.5 font-mono text-[#1B2632]">{cmd.quantite ?? 1}</td>
                              <td className="px-3 py-2.5 text-[#1B2632]">{cmd.pays?.nom || <span className="text-[#1B2632]/40">—</span>}</td>
                            </tr>
                          </tbody>
                        </table>
                        {(cmd.commentaire_1 || cmd.commentaire_2 || cmd.notes) && (
                          <div className="px-3 pb-3 -mt-1 flex flex-col gap-0.5 text-[11px]">
                            {cmd.commentaire_1 && <span className="text-amber-900 italic">{cmd.commentaire_1}</span>}
                            {cmd.commentaire_2 && <span className="text-purple-900 italic">{cmd.commentaire_2}</span>}
                            {cmd.notes && <span className="text-[#1B2632]/65 italic">{cmd.notes}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#C9C1B1]/40 bg-[#EEE9DF]/20">
          <span className="text-sm text-[#1B2632]/70 font-medium">Page {pageActuelle + 1} sur {totalPages}</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPageActuelle(p => Math.max(0, p - 1))}
              disabled={pageActuelle === 0}
              className="px-4 py-2 bg-white border border-[#C9C1B1] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 transition-all cursor-pointer"
            >
              Précédent
            </button>
            <button
              onClick={() => setPageActuelle(p => Math.min(totalPages - 1, p + 1))}
              disabled={pageActuelle >= totalPages - 1}
              className="px-4 py-2 bg-white border border-[#C9C1B1] rounded-xl text-sm font-medium hover:bg-[#EEE9DF]/50 disabled:opacity-40 transition-all cursor-pointer"
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      {/* Modale de création manuelle */}
      {isCreateModalOpen && hasPermission('creer_commande') && (
        <div className="fixed inset-0 bg-[#1B2632]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#EEE9DF] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#C9C1B1] bg-white">
              <h2 className="text-xl font-bold text-[#1B2632]">Nouvelle commande manuelle</h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-[#A35139] text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto">
              <form id="form-create-cmd" onSubmit={handleCreateCommande} className="space-y-5">
                
                <div className="bg-white p-5 rounded-xl border border-[#C9C1B1] shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-2">Informations Client</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Nom complet <span className="text-[#A35139]">*</span></label>
                      <input type="text" required value={newCmd.client_nom} onChange={(e) => setNewCmd({...newCmd, client_nom: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" placeholder="Ex: Jean Dupont" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Téléphone <span className="text-[#A35139]">*</span></label>
                      <input type="tel" required value={newCmd.client_telephone} onChange={(e) => setNewCmd({...newCmd, client_telephone: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162] font-mono" placeholder="+212 600 000 000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Pays</label>
                      <select value={newCmd.pays_id} onChange={(e) => setNewCmd({...newCmd, pays_id: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162] bg-white">
                        <option value="">-- Non spécifié --</option>
                        {listePays.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Ville / Adresse</label>
                      <input type="text" value={newCmd.ville_zone} onChange={(e) => setNewCmd({...newCmd, ville_zone: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" placeholder="Adresse de livraison..." />
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-[#C9C1B1] shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-2">Détails Commande</h3>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Produit <span className="text-[#A35139]">*</span></label>
                    <input type="text" required value={newCmd.produit} onChange={(e) => setNewCmd({...newCmd, produit: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" placeholder="Nom du produit..." />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Quantité</label>
                      <input type="number" min="1" value={newCmd.quantite} onChange={(e) => setNewCmd({...newCmd, quantite: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Prix total</label>
                      <input type="number" step="0.01" value={newCmd.prix} onChange={(e) => setNewCmd({...newCmd, prix: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" />
                    </div>
                  </div>

                  {peutChoisirAgent && (
                    <div className="border-t border-[#C9C1B1] pt-4 mt-4">
                      <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Assigner un agent immédiatement (Optionnel)</label>
                      <select value={newCmd.agent_id} onChange={(e) => setNewCmd({...newCmd, agent_id: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162] bg-[#FFB162]/10 text-[#8a5a1f] font-bold">
                        <option value="">-- Automatique --</option>
                        {agents.map(ag => <option key={ag.id} value={ag.id}>{ag.nom}</option>)}
                      </select>
                      <p className="text-[11px] text-[#1B2632]/60 mt-1.5">Laisser vide : le lead est attribué automatiquement.</p>
                    </div>
                  )}
                </div>

                <div className="bg-white p-5 rounded-xl border border-[#C9C1B1] shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#A35139] mb-2">Commentaires</h3>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Commentaire 1</label>
                    <input type="text" value={newCmd.commentaire_1} onChange={(e) => setNewCmd({...newCmd, commentaire_1: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162]" placeholder="Commentaire initial..." />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B2632] mb-1.5">Notes internes</label>
                    <textarea value={newCmd.notes} onChange={(e) => setNewCmd({...newCmd, notes: e.target.value})} className="w-full px-3 py-2 border border-[#C9C1B1] rounded-lg outline-none focus:border-[#FFB162] min-h-[60px]" placeholder="Informations complémentaires..."></textarea>
                  </div>
                </div>

              </form>
            </div>

            <div className="px-6 py-4 border-t border-[#C9C1B1] bg-white flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-[#C9C1B1] bg-[#EEE9DF]/50 hover:bg-[#C9C1B1]/50 text-[#1B2632] transition-colors cursor-pointer">Annuler</button>
              <button type="submit" form="form-create-cmd" disabled={creationLoading} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors shadow-md cursor-pointer">
                {creationLoading ? 'Création...' : 'Créer la commande'}
              </button>
            </div>

          </div>
        </div>
      )}


      {/* Import — le pays d'abord, le reste ensuite */}
      {modaleImport && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setModaleImport(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[900px] my-8 pop-in-cm">

              <div className="flex items-center gap-3 px-8 pt-7 pb-6">
                <button onClick={() => setModaleImport(false)} title="Retour"
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0 cursor-pointer">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">Importer des commandes</h2>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-5">

                {/* 1. Le pays. Tant qu'il n'est pas choisi, le reste n'a pas
                    de sens : c'est lui qui décide quel agent prendra les leads. */}
                <fieldset className="border border-dashed border-[#C9C1B1] rounded-xl px-5 pb-5 pt-1">
                  <legend className="px-2 text-xs font-bold uppercase tracking-wider text-[#1B2632]/55">
                    {estSeller ? 'Pays' : 'Entrepôt'} <span className="text-[#A35139]">*</span>
                  </legend>
                  <select className="cm-input" value={importCibleId}
                    onChange={(e) => { setImportCibleId(e.target.value); setImportResultat(null) }}>
                    <option value="">{estSeller ? 'Choisissez un pays...' : 'Choisissez un entrepôt...'}</option>
                    {estSeller
                      ? paysLivrables.map((p) => <option key={p.pays_id} value={p.pays_id}>{p.nom}</option>)
                      : listeEntrepots.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nom}{e.pays?.nom ? ` — ${e.pays.nom}` : ' — pays non renseigné'}
                          </option>
                        ))}
                  </select>
                  {!estSeller && listeEntrepots.length === 0 && (
                    <p className="text-[11px] text-[#A35139] mt-2 font-medium">
                      Aucun entrepôt. Créez-en un dans Paramètres avant d&apos;importer.
                    </p>
                  )}
                  {estSeller && paysLivrables.length === 0 && (
                    <p className="text-[11px] text-[#A35139] mt-2 font-medium">
                      Aucun pays livrable pour l&apos;instant. Prévenez un responsable :
                      aucun entrepôt n&apos;est rattaché à un pays.
                    </p>
                  )}
                </fieldset>

                {importCibleId && (
                  <>
                    <div className="flex justify-end -mb-2">
                      <button onClick={() => setImportAide((v) => !v)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-[#C9C1B1] bg-white text-[#1B2632] hover:bg-[#EEE9DF]/60 transition-colors cursor-pointer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                             style={{ transform: importAide ? 'rotate(180deg)' : 'none' }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        {importAide ? 'Masquer les colonnes attendues' : 'Voir les colonnes attendues'}
                      </button>
                    </div>

                    {importAide && (
                      <div className="flex flex-col gap-3">
                        <div className="px-4 py-3 rounded-xl bg-[#F4F0E6] border border-[#C9C1B1]/60 text-sm text-[#1B2632]">
                          <b>Order ID</b> est le numéro du vendeur, gardé tel quel : c&apos;est celui
                          qu&apos;il cite au téléphone. Deux vendeurs peuvent utiliser le même sans
                          se gêner. Sans cette colonne, un numéro est généré.
                        </div>

                        <div className="px-4 py-3 rounded-xl bg-[#F4F0E6] border border-[#C9C1B1]/60 text-sm text-[#1B2632]">
                          <b>Note</b> : pour plusieurs numéros, séparez-les par <code className="font-mono">|</code>.
                          Exemple : <code className="font-mono">0708852502|0708852501</code> — le premier est appelé,
                          les autres sont notés sur la commande.
                        </div>

                        <div className="px-4 py-3 rounded-xl bg-[#F4F0E6] border border-[#C9C1B1]/60 text-sm text-[#1B2632]">
                          <b>Note</b> : pour plusieurs produits dans une commande, séparez nom,
                          quantité et prix par <code className="font-mono">|</code>. Ils sont réunis
                          en <b>une seule commande</b> — un colis, un encaissement.
                        </div>

                        <div className="px-4 py-3 rounded-xl bg-[#F4F0E6] border border-[#C9C1B1]/60 text-sm text-[#1B2632]">
                          <b>Le prix est enregistré tel quel.</b> Il n&apos;est ni multiplié par la
                          quantité, ni recalculé : ce qui est écrit dans le fichier est ce que le
                          livreur encaissera. Plusieurs prix séparés par <code className="font-mono">|</code>
                          sont simplement additionnés.
                        </div>

                        <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-[#1B2632] text-white uppercase tracking-wider">
                                  <th className="px-3 py-2.5">Order ID</th>
                                  <th className="px-3 py-2.5">Product</th>
                                  <th className="px-3 py-2.5">Customer</th>
                                  <th className="px-3 py-2.5">Phone number</th>
                                  <th className="px-3 py-2.5">City</th>
                                  <th className="px-3 py-2.5">Address</th>
                                  <th className="px-3 py-2.5">Quantities</th>
                                  <th className="px-3 py-2.5">Unit price</th>
                                  <th className="px-3 py-2.5">Store</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="bg-white">
                                  <td className="px-3 py-3 font-mono">1234</td>
                                  <td className="px-3 py-3 font-mono">PRODUIT_A|PRODUIT_B</td>
                                  <td className="px-3 py-3">Hassan</td>
                                  <td className="px-3 py-3 font-mono">06 XX XX XX XX</td>
                                  <td className="px-3 py-3">Casablanca</td>
                                  <td className="px-3 py-3">12 rue des Écoles</td>
                                  <td className="px-3 py-3 font-mono">2|1</td>
                                  <td className="px-3 py-3 font-mono">900|500</td>
                                  <td className="px-3 py-3">Storeino</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <p className="px-4 py-2.5 text-[11px] text-[#1B2632]/55 border-t border-[#C9C1B1]/50">
                            Les en-têtes françaises sont acceptées aussi (<code className="font-mono">nom</code>,
                            <code className="font-mono"> téléphone</code>, <code className="font-mono">ville</code>,
                            <code className="font-mono"> adresse</code>, <code className="font-mono">quantité</code>,
                            <code className="font-mono"> prix</code>…). Les colonnes <b>pays</b> et
                            <b> vendeur</b> du fichier sont ignorées : le pays vient de l&apos;entrepôt
                            choisi en haut, et {estSeller
                              ? 'les commandes vous sont attribuées puisque c\u2019est vous qui importez'
                              : 'les commandes n\u2019iront à aucun vendeur, puisque vous importez en tant que responsable'}.
                          </p>
                        </div>
                      </div>
                    )}

                    <fieldset className="border border-dashed border-[#C9C1B1] rounded-xl px-5 pb-5 pt-1">
                      <legend className="px-2 text-xs font-bold uppercase tracking-wider text-[#1B2632]/55">
                        Fichier <span className="text-[#A35139]">*</span>
                      </legend>
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer">
                          Choisir un fichier
                          <input type="file" accept=".csv, .xlsx, .xls" className="hidden"
                            onChange={(e) => analyserFichier(e.target.files[0] || null)} />
                        </label>
                        <span className="text-sm text-[#1B2632]/60">
                          {importFichier ? importFichier.name : 'Aucun fichier choisi'}
                        </span>
                      </div>
                    </fieldset>

                    {apercu && !apercu.erreur && (
                      <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-[#F4F0E6] border-b border-[#C9C1B1]/50 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-[#1B2632]">Colonnes reconnues</span>
                          <span className="text-xs text-[#1B2632]/55">{apercu.nbLignes} ligne{apercu.nbLignes > 1 ? 's' : ''} dans le fichier</span>
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                          {apercu.correspondances.map((c) => (
                            <div key={c.nom} className="flex items-baseline justify-between gap-3 text-xs">
                              <span className="text-[#1B2632]/55 shrink-0">{c.nom}</span>
                              {c.entete ? (
                                <span className="font-mono font-semibold text-[#2E7D53] text-right truncate">{c.entete}</span>
                              ) : (
                                <span className={`text-right ${c.requis ? 'text-[#A35139] font-semibold' : 'text-[#1B2632]/35'}`}>
                                  {c.requis ? 'manquante — obligatoire' : 'non trouvée'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="px-4 pb-3 text-[11px] text-[#1B2632]/50">
                          En-têtes du fichier : <span className="font-mono">{apercu.entetes.join(' · ') || 'aucune'}</span>
                        </p>
                      </div>
                    )}
                    {apercu?.erreur && (
                      <div className="px-4 py-3 rounded-xl bg-[#A35139]/10 border border-[#A35139]/30 text-sm text-[#A35139] font-medium">
                        {apercu.erreur}
                      </div>
                    )}

                    {importResultat && (
                      <div className={`px-4 py-3 rounded-xl text-sm border ${
                        importResultat.erreur
                          ? 'bg-[#A35139]/10 border-[#A35139]/30 text-[#A35139]'
                          : 'bg-[#2E7D53]/10 border-[#2E7D53]/30 text-[#2E7D53]'
                      }`}>
                        {importResultat.erreur ? (
                          <span className="font-medium">{importResultat.erreur}</span>
                        ) : (
                          <span className="font-medium">
                            {importResultat.inserees} commande{importResultat.inserees > 1 ? 's' : ''} importée{importResultat.inserees > 1 ? 's' : ''}
                            {importResultat.doublons > 0 && ` · ${importResultat.doublons} déjà en base, ignorée${importResultat.doublons > 1 ? 's' : ''}`}
                            {importResultat.refusees?.length > 0 && ` · ${importResultat.refusees.length} ligne(s) refusée(s)`}
                          </span>
                        )}
                        {importResultat.refusees?.length > 0 && (
                          <ul className="mt-2 text-xs text-[#A35139] list-disc list-inside">
                            {importResultat.refusees.slice(0, 10).map((r, i) => <li key={i}>{r}</li>)}
                            {importResultat.refusees.length > 10 && <li>…et {importResultat.refusees.length - 10} autres</li>}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="flex justify-end gap-3">
                      <button onClick={() => setModaleImport(false)}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer">
                        Fermer
                      </button>
                      <button onClick={lancerImport} disabled={!importFichier || importEnCours}
                        className="px-8 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] disabled:opacity-50 transition-colors cursor-pointer">
                        {importEnCours ? 'Import en cours...' : 'Importer'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {detail && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setDetail(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1100px] my-8 pop-in-cm">

              <div className="flex items-center gap-3 px-8 pt-7 pb-6">
                <button
                  onClick={() => setDetail(null)} title="Retour"
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">Détail de la commande</h2>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-5">

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <CarteDetail titre="Commande">
                    <LigneDetail label="Lead ID" valeur={detail.lead_id} mono />
                    <LigneDetail label="N° de suivi" valeur={detail.tracking_number} mono />
                    <LigneDetail label="Source" valeur={detail.source} />
                    <LigneDetail label="Pays" valeur={detail.pays?.nom} />
                    <LigneDetail label="Ville / Zone" valeur={detail.ville_zone} />
                    <LigneDetail
                      label="Arrivée"
                      valeur={detail.created_at ? new Date(detail.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null}
                    />
                    <LigneDetail
                      label="Rappel prévu"
                      valeur={detail.date_rappel ? new Date(detail.date_rappel).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null}
                    />
                  </CarteDetail>

                  <CarteDetail titre="Client">
                    <LigneDetail label="Nom" valeur={detail.client_nom} />
                    {detail.client_telephone ? (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-[#1B2632]/45 w-[110px] shrink-0">Téléphone</span>
                        {/* Cliquable : l'agent appelle depuis le téléphone sans
                            recopier le numéro, et ne se trompe pas d'un chiffre. */}
                        <a href={`tel:${detail.client_telephone}`}
                          className="text-sm font-mono font-semibold text-[#A35139] hover:underline">
                          {detail.client_telephone}
                        </a>
                      </div>
                    ) : <LigneDetail label="Téléphone" valeur={null} />}
                    <LigneDetail label="Adresse" valeur={detail.adresse} />
                  </CarteDetail>

                  <CarteDetail titre="Traitement">
                    <LigneDetail label="Agent" valeur={detail.agents?.nom} />
                    <LigneDetail label="Vendeur" valeur={nomDuVendeur(detail.vendeur_id)} />
                    <LigneDetail label="Statut d'appel" valeur={detail.statut_confirmation} />
                    <LigneDetail label="Livraison" valeur={detail.statut_livraison} />
                    <LigneDetail label="Paiement" valeur={detail.statut_paiement} />
                    <LigneDetail
                      label="Dernière MAJ"
                      valeur={detail.updated_at ? new Date(detail.updated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null}
                    />
                  </CarteDetail>
                </div>

                <div className="border border-[#C9C1B1] rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-[#F4F0E6] border-b border-[#C9C1B1]/50">
                    <h3 className="text-sm font-bold text-[#1B2632]">Produit commandé</h3>
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
                        <td className="px-5 py-3 font-semibold text-[#1B2632]">{detail.produit || '—'}</td>
                        <td className="px-5 py-3 text-right font-mono">{detail.quantite ?? 1}</td>
                        <td className="px-5 py-3 text-right font-mono font-bold">
                          {detail.prix ?? '—'} <span className="text-xs font-normal text-[#1B2632]/50">{detail.pays?.devise || ''}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {(detail.commentaire_1 || detail.commentaire_2 || detail.notes) && (
                  <div className="border border-[#C9C1B1] rounded-xl p-5">
                    <h3 className="text-sm font-bold text-[#1B2632] mb-3">Commentaires</h3>
                    <div className="flex flex-col gap-2 text-sm">
                      {detail.commentaire_1 && <p className="text-amber-900 italic">{detail.commentaire_1}</p>}
                      {detail.commentaire_2 && <p className="text-purple-900 italic">{detail.commentaire_2}</p>}
                      {detail.notes && <p className="text-[#1B2632]/70 italic">{detail.notes}</p>}
                    </div>
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
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[#1B2632]/45 w-[110px] shrink-0">{label}</span>
      <span className={`text-sm text-[#1B2632] ${mono ? 'font-mono font-semibold' : 'font-medium'} ${!valeur ? 'opacity-40' : ''}`}>
        {valeur || '—'}
      </span>
    </div>
  )
}