'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
    const [{ data: agentsData }, { data: paysData }, { data: statutsData }, { data: sellersData }] = await Promise.all([
      supabase.from('agents').select('id, nom').eq('tenant_id', tenantKey).eq('actif', true),
      supabase.from('pays').select('id, nom, code').eq('tenant_id', tenantKey),
      supabase.from('statuts').select('*').eq('tenant_id', tenantKey),
      // sert à nommer le vendeur d'un lead et à retrouver celui nommé dans un
      // fichier importé. La RLS fait le tri : un responsable reçoit l'équipe,
      // un seller ne reçoit que sa propre ligne.
      supabase.from('user_roles').select('user_id, email, nom, role').eq('tenant_id', tenantKey)
    ])
    if (agentsData) setAgents(agentsData)
    if (paysData) setListePays(paysData)
    if (statutsData) setListeStatutsDB(statutsData)
    if (sellersData) setPersonnel(sellersData)
  }, [tenantKey])

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
      .select('*, pays(nom), agents(nom)', { count: 'exact' })
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
  // Le fichier peut nommer le seller (colonne « vendeur », « seller » ou
  // « vendeur_email ») : on retrouve son compte par email ou par nom, dans cette
  // entreprise uniquement. Un seller qui importe lui-même ne peut poser que son
  // propre nom. Sans colonne et importé par un manager, le lead n'appartient à
  // aucun seller : personne d'autre que les responsables ne le verra.
  function vendeurDeLaLigne(ligne) {
    if (estSeller) return user?.id || null
    const brut = String(
      ligne['vendeur'] || ligne['seller'] || ligne['vendeur_email'] ||
      ligne['seller_email'] || ligne['email_vendeur'] || ''
    ).trim().toLowerCase()
    if (!brut) return null
    const trouve = listeSellers.find(
      (v) => (v.email || '').toLowerCase() === brut || (v.nom || '').toLowerCase() === brut
    )
    return trouve ? trouve.user_id : null
  }

  async function importerFichier(event) {
    const fichier = event.target.files[0]
    if (!fichier || !tenantKey) return

    setChargement(true)
    const lecteur = new FileReader()
    lecteur.onload = async function (e) {
      try {
        const data = new Uint8Array(e.target.result)
        const classeur = XLSX.read(data, { type: 'array' })
        const nomFeuille = classeur.SheetNames[0]
        const lignes = XLSX.utils.sheet_to_json(classeur.Sheets[nomFeuille], { defval: "" })

        if (lignes.length === 0) {
          alert("Le fichier est vide.")
          setChargement(false)
          return
        }

        const nouvellesCommandes = lignes.map(ligne => {
          const ligneNormalisee = {}
          
          // 🚀 1. Normalisation : Transforme "Lead ID", "Lead-ID" ou "ID" en "lead_id"
          for (let cle in ligne) {
            const clePropre = cle.toLowerCase().trim().replace(/[\s-]/g, '_')
            ligneNormalisee[clePropre] = ligne[cle]
          }

          const nomPaysFichier = ligneNormalisee['pays'] || ligneNormalisee['country'] || '';
          let paysIdTrouve = null;
          if (nomPaysFichier && listePays.length > 0) {
            const paysMatch = listePays.find(p => p.nom.toLowerCase() === String(nomPaysFichier).toLowerCase().trim() || (p.code && p.code.toLowerCase() === String(nomPaysFichier).toLowerCase().trim()));
            if (paysMatch) paysIdTrouve = paysMatch.id;
          }

          const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
          
          // 🚀 2. Recherche large de l'ID dans le fichier
          const leadIdFichier = ligneNormalisee['lead_id'] || 
                                ligneNormalisee['leadid'] || 
                                ligneNormalisee['id'] || 
                                ligneNormalisee['numero_commande'] || 
                                ligneNormalisee['numero'] || 
                                ligneNormalisee['reference'] || 
                                '';
          
          // 🚀 3. Règle absolue : Si l'ID est dans le fichier, on le prend. Sinon, on génère.
          const finalLeadId = leadIdFichier ? String(leadIdFichier).trim() : `LEAD-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`;

          return {
            client_nom: ligneNormalisee['client_nom'] || ligneNormalisee['nom'] || ligneNormalisee['client'] || 'Inconnu',
            client_telephone: String(ligneNormalisee['client_telephone'] || ligneNormalisee['telephone'] || ligneNormalisee['tel'] || ''),
            ville_zone: ligneNormalisee['ville_zone'] || ligneNormalisee['ville'] || ligneNormalisee['zone'] || '',
            produit: ligneNormalisee['produit'] || 'Produit standard',
            quantite: parseInt(ligneNormalisee['quantite']) || 1,
            prix: parseFloat(ligneNormalisee['prix']) || 0,
            source: 'csv', 
            notes: ligneNormalisee['notes'] || ligneNormalisee['note'] || '',
            commentaire_1: ligneNormalisee['commentaire_1'] || '',
            lead_id: finalLeadId,
            tenant_id: tenantKey,
            pays_id: paysIdTrouve,
            vendeur_id: vendeurDeLaLigne(ligneNormalisee)
          }
        }).filter(cmd => cmd.client_telephone !== '')

        if (nouvellesCommandes.length === 0) {
          alert("Aucune donnée valide trouvée.")
          setChargement(false)
          return
        }

        const { error } = await supabase.from('commandes').insert(nouvellesCommandes)
        if (error) alert("Erreur d'import : " + error.message)
        else {
          alert(`Succès : ${nouvellesCommandes.length} commandes importées.`)
          chargerCommandes(0)
          setPageActuelle(0)
        }
      } catch (erreur) {
        console.error(erreur)
        alert("Erreur de lecture du fichier.")
      }
      setChargement(false)
    }
    lecteur.readAsArrayBuffer(fichier)
    event.target.value = null
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
            <label
              title="Importer des commandes depuis un fichier CSV ou Excel"
              className="flex flex-1 sm:flex-none justify-center items-center gap-2 px-3 sm:px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-full text-sm font-bold text-[#1B2632] hover:bg-[#EEE9DF]/50 hover:border-[#1B2632]/30 transition-colors shadow-sm cursor-pointer"
            >
              <IconImporter />
              Importer CSV
              <input type="file" accept=".csv, .xlsx, .xls" onChange={importerFichier} className="hidden" />
            </label>
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
          <table className="w-full min-w-[1650px] text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#F4F0E6] shadow-[0_1px_0_#C9C1B1]">
              <tr className="border-b border-[#C9C1B1]/50 uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                <th className="px-4 py-3.5">Lead ID / Source</th>
                {!estSeller && <th className="px-4 py-3.5">Vendeur</th>}
                <th className="px-4 py-3.5">Dates (Création / MAJ / Rappel)</th>
                <th className="px-4 py-3.5">Client & Tél</th>
                <th className="px-4 py-3.5">Localisation (Pays / Ville)</th>
                <th className="px-4 py-3.5">Produit, Qté & Prix</th>
                <th className="px-4 py-3.5">Statuts (Conf. / Liv. / Paiement)</th>
                <th className="px-4 py-3.5">Commentaires & Notes</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan={estSeller ? 8 : 9} className="text-center py-12 text-[#1B2632]/50">Chargement des données...</td></tr>
              ) : commandes.length === 0 ? (
                <tr><td colSpan={estSeller ? 8 : 9} className="text-center py-12 text-[#1B2632]/50">Aucune commande trouvée.</td></tr>
              ) : (
                commandes.map((cmd) => (
                  <tr key={cmd.id} className="hover:bg-[#EEE9DF]/20 transition-colors">
                    
                    {/* LEAD ID & SOURCE */}
                    <td className="px-4 py-3 align-top font-mono">
                      <div className="text-[#A35139] font-bold">#{cmd.lead_id || 'N/A'}</div>
                      <div className="text-[10px] text-[#5c5648] uppercase bg-[#EEE9DF] px-1.5 py-0.5 rounded w-fit mt-1">
                        {cmd.source || 'direct'} {cmd.source_sheet ? `(${cmd.source_sheet})` : ''}
                      </div>
                    </td>
                    
                    {/* VENDEUR — qui a apporté ce lead */}
                    {!estSeller && (
                      <td className="px-4 py-3 align-top">
                        {nomDuVendeur(cmd.vendeur_id)
                          ? <span className="font-semibold text-[#1B2632]">{nomDuVendeur(cmd.vendeur_id)}</span>
                          : <span className="text-[#1B2632]/40">—</span>}
                      </td>
                    )}

                    {/* DATES */}
                    <td className="px-4 py-3 align-top">
                      <div className="text-[#1B2632]"><b>Créé:</b> {cmd.created_at ? new Date(cmd.created_at).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'}) : '-'}</div>
                      {cmd.updated_at && <div className="text-[#A35139]"><b>MAJ:</b> {new Date(cmd.updated_at).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</div>}
                      {cmd.date_rappel && <div className="text-amber-700"><b>Rappel:</b> {new Date(cmd.date_rappel).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</div>}
                    </td>

                    {/* CLIENT */}
                    <td className="px-4 py-3 align-top">
                      <div className="font-bold text-[#1B2632]">{cmd.client_nom}</div>
                      <div className="font-mono text-[#A35139] mt-0.5">{cmd.client_telephone}</div>
                      {cmd.is_doublon && <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">Doublon</span>}
                    </td>

                    {/* LOCALISATION */}
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-[#1B2632]">{cmd.pays?.nom || 'Pays non spécifié'}</div>
                      <div className="text-[#1B2632]/60 mt-0.5">{cmd.ville_zone || '-'}</div>
                    </td>

                    {/* PRODUIT, QTE, PRIX */}
                    <td className="px-4 py-3 align-top">
                      <div className="font-bold text-[#1B2632]">{cmd.produit}</div>
                      <div className="text-[#1B2632]/70 mt-0.5">
                        Qté: <b>{cmd.quantite || 1}</b> · Prix: <span className="font-bold text-[#A35139]">{cmd.prix || 0}</span>
                      </div>
                    </td>

                    {/* STATUTS MULTIPLES (Confirmation, Livraison, Paiement) */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1 items-start">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">Conf:</span>
                          <StatutPill statut={cmd.statut_confirmation} listeStatutsDB={listeStatutsDB} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">Liv:</span>
                          <StatutPill statut={cmd.statut_livraison} listeStatutsDB={listeStatutsDB} />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">Pai:</span>
                          <StatutPill statut={cmd.statut_paiement} listeStatutsDB={listeStatutsDB} />
                        </div>
                      </div>
                    </td>

                    {/* COMMENTAIRES & NOTES — déplacée en dernière colonne */}
                    <td className="px-4 py-3 align-top max-w-[220px]">
                      {cmd.commentaire_1 && <div className="text-amber-900 italic mb-0.5" title="Commentaire 1">💬 {cmd.commentaire_1}</div>}
                      {cmd.commentaire_2 && <div className="text-purple-900 italic mb-0.5" title="Commentaire 2">💬 {cmd.commentaire_2}</div>}
                      {cmd.notes && <div className="text-gray-600 italic" title="Notes">📝 {cmd.notes}</div>}
                      {!cmd.commentaire_1 && !cmd.commentaire_2 && !cmd.notes && <span className="text-gray-400">-</span>}
                    </td>

                    <td className="px-4 py-3 align-top text-right">
                      <button
                        onClick={() => setDetail(cmd)} title="Voir le détail"
                        className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
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