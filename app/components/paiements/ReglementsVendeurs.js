'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'

// Le relevé de paiement du vendeur. À ne pas confondre avec « Paiements »,
// qui suit l'argent encaissé par le livreur chez le client : ici c'est ce que
// l'entreprise reverse au vendeur.
//
// Les frais ne sont pas encore décidés, donc le net est égal au total des
// ventes. Les colonnes existent en base : le jour où les montants seront
// fixés, les relevés déjà payés garderont les leurs — un relevé recalculé
// après coup ne prouve plus rien.

const STATUTS = {
  en_attente: { label: 'En attente', classe: 'border-[#FFB162] text-[#8a5a1f] bg-[#FFB162]/10' },
  paye:       { label: 'Payé',       classe: 'border-green-500 text-green-700 bg-green-50' },
  annule:     { label: 'Annulé',     classe: 'border-red-400 text-red-700 bg-red-50' },
}
const METHODES = { especes: 'Espèces', virement: 'Virement', cheque: 'Chèque' }

function Statut({ valeur }) {
  const s = STATUTS[valeur] || { label: valeur || '—', classe: 'border-[#C9C1B1] text-[#1B2632]/60 bg-white' }
  return (
    <span className={`inline-block px-4 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap ${s.classe}`}>
      {s.label}
    </span>
  )
}

const jour = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—')
const jourHeure = (v) => (v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const sou = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Les dates partent vides : on règle d'abord TOUT ce qui attend. Pré-remplir
// la semaine passée écartait les livraisons du jour, la recherche ne trouvait
// rien, et on en concluait que l'écran ne marchait pas.

export default function ReglementsVendeurs() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId
  const peutGerer = hasPermission('gerer_reglements')

  const [releves, setReleves] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState({ texte: '', type: '' })

  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreVendeur, setFiltreVendeur] = useState('')

  // Combien de commandes livrées attendent d'être réglées. Sans ce chiffre,
  // l'écran dit « aucun relevé » et laisse croire qu'il n'y a rien à payer,
  // alors que des livraisons attendent.
  const [enAttenteDeReglement, setEnAttenteDeReglement] = useState(null)
  const [fiche, setFiche] = useState(null)
  const [lignes, setLignes] = useState([])

  const [modale, setModale] = useState(false)
  const [brouillon, setBrouillon] = useState({ vendeur_id: '', debut: '', fin: '', methode: 'especes' })
  // Combien de commandes attendent, vendeur par vendeur : on choisit en
  // sachant, au lieu d'essayer les vendeurs un par un.
  const [attenteParVendeur, setAttenteParVendeur] = useState({})
  const [candidates, setCandidates] = useState([])
  const [choisies, setChoisies] = useState([])
  const [rechercheEnCours, setRechercheEnCours] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)

  useEffect(() => {
    if (!authLoading && !permsLoading) {
      if (!user) router.replace('/')
      // la redirection est faite par la page
    }
  }, [user, authLoading, permsLoading, hasPermission, router])

  const charger = useCallback(async () => {
    if (!tenantKey) return
    setChargement(true)
    setErreur('')

    const { data, error } = await supabase
      .from('reglements')
      .select('*')
      .eq('tenant_id', tenantKey)
      .order('created_at', { ascending: false })

    if (error) { setErreur(error.message); setReleves([]); setChargement(false); return }
    setReleves(data || [])

    const { data: gens } = await supabase
      .from('user_roles').select('user_id, email, nom, role').eq('tenant_id', tenantKey)
    setPersonnel(gens || [])

    // `head: true` : on demande le compte, pas les lignes — inutile de
    // télécharger des commandes qu'on ne va qu'additionner.
    const { data: attente } = await supabase
      .from('v_commandes_a_regler')
      .select('vendeur_id')
      .eq('tenant_id', tenantKey)

    const parVendeur = {}
    for (const c of attente || []) {
      parVendeur[c.vendeur_id] = (parVendeur[c.vendeur_id] || 0) + 1
    }
    setAttenteParVendeur(parVendeur)
    setEnAttenteDeReglement((attente || []).length)

    setChargement(false)
  }, [tenantKey])

  useEffect(() => { if (tenantKey && !permsLoading) charger() }, [tenantKey, permsLoading, charger])

  const nomVendeur = useCallback((id) => {
    if (!id) return '—'
    const v = personnel.find((x) => x.user_id === id)
    return v ? (v.nom || v.email) : '—'
  }, [personnel])

  const sellers = useMemo(
    () => personnel.filter((p) => String(p.role || '').toLowerCase() === 'seller'),
    [personnel],
  )

  const affiches = useMemo(() => {
    const r = recherche.trim().toLowerCase()
    return releves.filter((x) => {
      if (r && !`${x.reference || ''} ${nomVendeur(x.vendeur_id)}`.toLowerCase().includes(r)) return false
      if (filtreStatut && x.statut !== filtreStatut) return false
      if (filtreVendeur && x.vendeur_id !== filtreVendeur) return false
      return true
    })
  }, [releves, recherche, filtreStatut, filtreVendeur, nomVendeur])

  // Les totaux ne sont pas additionnés entre devises : un total qui mélange
  // dirhams et dollars ne veut rien dire.
  const totaux = useMemo(() => {
    const parDevise = {}
    let commandes = 0
    for (const x of affiches) {
      const d = x.devise || '—'
      parDevise[d] = (parDevise[d] || 0) + Number(x.net_a_payer || 0)
      commandes += x.nb_commandes || 0
    }
    return { parDevise, commandes, nb: affiches.length }
  }, [affiches])

  function annonce(texte, type) {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 6000)
  }

  async function ouvrirFiche(r) {
    setFiche(r)
    setLignes([])
    const { data, error } = await supabase
      .from('reglements_commandes')
      .select('commande_id, montant, commandes(lead_id, client_nom, produit, quantite, prix, updated_at)')
      .eq('reglement_id', r.id)
    if (error) { annonce('Détail illisible : ' + error.message, 'erreur'); return }
    setLignes(data || [])
  }

  // ---------- établir un relevé ----------
  function ouvrirCreation() {
    setBrouillon({ vendeur_id: '', debut: '', fin: '', methode: 'especes' })
    setCandidates([])
    setChoisies([])
    setModale(true)
  }

  async function chercherCommandes() {
    if (!brouillon.vendeur_id) return annonce('Choisissez un vendeur.', 'erreur')
    setRechercheEnCours(true)

    // La vue ne renvoie que les commandes livrées qui ne sont dans aucun
    // relevé : impossible d'en reprendre une déjà payée.
    let requete = supabase
      .from('v_commandes_a_regler')
      .select('*')
      .eq('tenant_id', tenantKey)
      .eq('vendeur_id', brouillon.vendeur_id)

    // Dates vides = tout ce qui attend. C'est le cas le plus courant : on
    // règle ce qui n'a pas encore été réglé, quelle que soit sa date.
    if (brouillon.debut) requete = requete.gte('updated_at', brouillon.debut)
    if (brouillon.fin) requete = requete.lte('updated_at', `${brouillon.fin}T23:59:59`)

    const { data, error } = await requete.order('updated_at')

    setRechercheEnCours(false)
    if (error) return annonce('Recherche impossible : ' + error.message, 'erreur')

    setCandidates(data || [])
    setChoisies((data || []).map((c) => c.commande_id))
    if ((data || []).length === 0) {
      annonce(
        brouillon.debut || brouillon.fin
          ? "Aucune commande livrée à régler pour ce vendeur sur cette période. Essayez sans dates."
          : "Aucune commande livrée à régler pour ce vendeur.",
        'erreur',
      )
    }
  }

  const retenues = candidates.filter((c) => choisies.includes(c.commande_id))
  const totalRetenu = retenues.reduce((s, c) => s + Number(c.prix || 0) * (c.quantite || 1), 0)
  const deviseRetenue = retenues[0]?.devise || ''

  async function enregistrerReleve() {
    if (retenues.length === 0) return annonce('Aucune commande retenue.', 'erreur')

    // Deux devises dans un même relevé donneraient un total faux : on refuse
    // plutôt que d'additionner des monnaies différentes.
    const devises = [...new Set(retenues.map((c) => c.devise || '—'))]
    if (devises.length > 1) {
      return annonce(`Ces commandes sont en ${devises.join(' et ')} : faites un relevé par devise.`, 'erreur')
    }

    setEnregistrement(true)

    // `periode_debut` et `periode_fin` ne peuvent pas être vides en base. Si
    // on n'a pas saisi de dates, on prend celles des commandes retenues : le
    // relevé dit alors exactement ce qu'il couvre.
    const dates = retenues.map((c) => String(c.updated_at || '').slice(0, 10)).filter(Boolean).sort()
    const aujourdhui = new Date().toISOString().slice(0, 10)

    const { data, error } = await supabase.from('reglements').insert([{
      tenant_id: tenantKey,
      vendeur_id: brouillon.vendeur_id,
      periode_debut: brouillon.debut || dates[0] || aujourdhui,
      periode_fin: brouillon.fin || dates[dates.length - 1] || aujourdhui,
      methode: brouillon.methode,
      devise: devises[0] === '—' ? null : devises[0],
      nb_commandes: retenues.length,
      total_ventes: totalRetenu,
      net_a_payer: totalRetenu,   // pas de frais pour l'instant
      cree_par: user?.id,
    }]).select()

    if (error) { setEnregistrement(false); return annonce('Création refusée : ' + error.message, 'erreur') }

    const releveId = data[0].id
    const { error: errLignes } = await supabase.from('reglements_commandes').insert(
      retenues.map((c) => ({
        commande_id: c.commande_id,
        reglement_id: releveId,
        tenant_id: tenantKey,
        montant: Number(c.prix || 0) * (c.quantite || 1),
      })),
    )

    setEnregistrement(false)

    if (errLignes) {
      // Le relevé existe mais il est vide : le dire, sinon il traîne comme
      // une ligne à zéro que personne ne comprend.
      return annonce(
        'Relevé créé, mais ses commandes ont été refusées : ' + errLignes.message +
        ' — supprimez-le et recommencez.',
        'erreur',
      )
    }

    annonce(`Relevé établi : ${retenues.length} commande${retenues.length > 1 ? 's' : ''}.`, 'succes')
    setModale(false)
    charger()
  }

  async function marquerPaye(r) {
    if (!window.confirm(`Marquer ${r.reference} comme payé ?\n\nAprès cela, ses montants et ses commandes ne pourront plus changer.`)) return
    const { data, error } = await supabase
      .from('reglements').update({ statut: 'paye' })
      .eq('id', r.id).eq('tenant_id', tenantKey).select()
    if (error) return annonce('Refusé : ' + error.message, 'erreur')
    if (!data || data.length === 0) return annonce("Votre rôle ne permet pas de payer un relevé.", 'erreur')
    annonce('Relevé marqué payé.', 'succes')
    setFiche(null)
    charger()
  }

  async function supprimer(r) {
    if (!window.confirm(`Supprimer ${r.reference} ?\n\nSes commandes redeviendront disponibles pour un autre relevé.`)) return
    const { error } = await supabase.from('reglements').delete().eq('id', r.id).eq('tenant_id', tenantKey)
    if (error) return annonce('Suppression refusée : ' + error.message, 'erreur')
    annonce('Relevé supprimé.', 'succes')
    setFiche(null)
    charger()
  }

  if (authLoading || permsLoading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">Chargement...</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes popIn { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in { animation: popIn .18s ease-out; }
        .rg-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .rg-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        .rg-label { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(27,38,50,.55); margin-bottom:6px; }
        @media print {
          body * { visibility: hidden; }
          .zone-impression, .zone-impression * { visibility: visible; }
          .zone-impression { position: absolute; inset: 0; margin: 0; border: none; box-shadow: none; }
          .sans-impression { display: none !important; }
        }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4 sans-impression">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">Finance</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2632]">Paiements vendeurs</h1>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3 mt-2">
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-[#C9C1B1] shadow-sm w-full sm:w-[280px] focus-within:border-[#FFB162] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1B2632]/30 shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text" placeholder="Référence, vendeur..."
              value={recherche} onChange={(e) => setRecherche(e.target.value)}
              className="outline-none bg-transparent text-sm text-[#1B2632] font-medium w-full placeholder:text-[#1B2632]/30"
            />
          </div>

          <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}
            className="px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-sm font-semibold text-[#1B2632] outline-none cursor-pointer">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {sellers.length > 0 && (
            <select value={filtreVendeur} onChange={(e) => setFiltreVendeur(e.target.value)}
              className="px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-sm font-semibold text-[#1B2632] outline-none cursor-pointer">
              <option value="">Tous les vendeurs</option>
              {sellers.map((v) => <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>)}
            </select>
          )}

          {peutGerer && (
            <button onClick={ouvrirCreation}
              className="sm:ml-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm">
              <span className="text-lg leading-none">+</span> Établir un relevé
            </button>
          )}
        </div>
      </header>

      {message.texte && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium sans-impression ${
          message.type === 'succes' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>{message.texte}</div>
      )}

      {erreur && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-50 text-red-800 border border-red-200 sans-impression">
          <p className="font-bold mb-1">Lecture impossible</p>
          <p className="font-mono text-xs">{erreur}</p>
          <p className="mt-2 text-xs opacity-80">
            Si le message dit que la table n&apos;existe pas, le fichier
            <span className="font-mono"> reglements_vendeurs.sql </span>n&apos;a pas encore été lancé.
          </p>
        </div>
      )}

      {enAttenteDeReglement > 0 && (
        <div className="px-5 py-4 rounded-xl bg-[#FFB162]/15 border border-[#FFB162]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sans-impression">
          <span className="text-sm font-semibold text-[#8a5a1f]">
            {enAttenteDeReglement} commande{enAttenteDeReglement > 1 ? 's' : ''} livrée{enAttenteDeReglement > 1 ? 's' : ''}
            {' '}n&apos;{enAttenteDeReglement > 1 ? 'ont' : 'a'} pas encore été réglée{enAttenteDeReglement > 1 ? 's' : ''} à son vendeur.
          </span>
          {peutGerer && (
            <button onClick={ouvrirCreation}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors whitespace-nowrap">
              Établir un relevé
            </button>
          )}
        </div>
      )}

      {/* Le bandeau de totaux de ShipLead, mais une ligne par devise. */}
      <div className="bg-[#FFB162]/10 border-l-4 border-[#A35139] rounded-r-xl px-5 py-4 sans-impression">
        <p className="text-sm font-semibold text-[#1B2632]">
          {totaux.nb} relevé{totaux.nb > 1 ? 's' : ''} · {totaux.commandes} commande{totaux.commandes > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1">
          {Object.entries(totaux.parDevise).length === 0 ? (
            <span className="text-sm text-[#1B2632]/50">—</span>
          ) : (
            Object.entries(totaux.parDevise).map(([d, m]) => (
              <span key={d} className="text-lg font-bold text-[#1B2632]">
                {sou(m)} <span className="text-xs font-semibold text-[#1B2632]/50">{d}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden sans-impression">
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">Vendeur</th>
                <th className="px-5 py-4">Méthode</th>
                <th className="px-5 py-4 text-center">Commandes</th>
                <th className="px-5 py-4">Période</th>
                <th className="px-5 py-4">Date</th>
                <th className="px-5 py-4 text-right">Net à payer</th>
                <th className="px-5 py-4">Statut</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : affiches.length === 0 ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-[#1B2632]/60">
                  {releves.length > 0
                    ? 'Aucun relevé ne correspond à cette recherche.'
                    : enAttenteDeReglement > 0
                      ? `Aucun relevé établi pour l'instant — ${enAttenteDeReglement} commande${enAttenteDeReglement > 1 ? 's livrées attendent' : ' livrée attend'} d'être réglée${enAttenteDeReglement > 1 ? 's' : ''}.`
                      : "Aucun relevé établi. Les relevés se créent à partir des commandes livrées : il n'y en a aucune en attente."}
                </td></tr>
              ) : (
                affiches.map((r) => (
                  <tr key={r.id} className="hover:bg-[#EEE9DF]/40 transition-colors">
                    <td className="px-5 py-4 font-mono text-xs text-[#A35139] font-semibold whitespace-nowrap">{r.reference}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-[#1B2632] whitespace-nowrap">{nomVendeur(r.vendeur_id)}</td>
                    <td className="px-5 py-4 text-sm text-[#1B2632]/70 whitespace-nowrap">{METHODES[r.methode] || r.methode}</td>
                    <td className="px-5 py-4 text-center font-semibold text-[#1B2632]">{r.nb_commandes}</td>
                    <td className="px-5 py-4 text-sm text-[#1B2632]/70 whitespace-nowrap">
                      {jour(r.periode_debut)} → {jour(r.periode_fin)}
                    </td>
                    {/* Tant que le relevé n'est pas payé, il n'y a pas de date de
                        paiement : on montre la date d'établissement plutôt qu'un
                        tiret. Une colonne vide laisse croire à une donnée perdue. */}
                    <td className="px-5 py-4 text-sm whitespace-nowrap">
                      {r.date_paiement ? (
                        <>
                          <span className="text-[#1B2632]/80">{jourHeure(r.date_paiement)}</span>
                          <span className="block text-[11px] text-[#1B2632]/40">payé</span>
                        </>
                      ) : (
                        <>
                          <span className="text-[#1B2632]/60">{jourHeure(r.created_at)}</span>
                          <span className="block text-[11px] text-[#1B2632]/40">établi, pas encore payé</span>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-[#1B2632] whitespace-nowrap">
                      {sou(r.net_a_payer)} <span className="text-xs font-sans font-normal text-[#1B2632]/50">{r.devise || ''}</span>
                    </td>
                    <td className="px-5 py-4"><Statut valeur={r.statut} /></td>
                    <td className="px-5 py-4 text-right">
                      <button onClick={() => ouvrirFiche(r)} title="Voir le relevé"
                        className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[#1B2632]/50 hover:text-[#1B2632] hover:bg-[#EEE9DF] transition-colors">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- le relevé ---------- */}
      {fiche && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40 sans-impression" onClick={() => setFiche(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="zone-impression bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[1000px] my-8 pop-in">

              <div className="flex items-center gap-3 px-8 pt-7 pb-6 sans-impression">
                <button onClick={() => setFiche(null)} title="Retour"
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">Relevé de paiement</h2>
                <span className="ml-auto"><Statut valeur={fiche.statut} /></span>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-6">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <Ligne label="ID du relevé" valeur={fiche.reference} mono />
                  <Ligne label="Vendeur" valeur={nomVendeur(fiche.vendeur_id)} />
                  <Ligne label="Période" valeur={`${jour(fiche.periode_debut)} → ${jour(fiche.periode_fin)}`} />
                  <Ligne label="Méthode de paiement" valeur={METHODES[fiche.methode] || fiche.methode} />
                  <Ligne label="Établi le" valeur={jourHeure(fiche.created_at)} />
                  <Ligne
                    label="Date de paiement"
                    valeur={fiche.date_paiement ? jourHeure(fiche.date_paiement) : 'Pas encore payé'}
                  />
                  <Ligne label="Nombre de commandes" valeur={String(fiche.nb_commandes)} />
                </div>

                <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#A35139] font-bold">
                        <th className="px-4 py-3">Lead ID</th>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3">Produit</th>
                        <th className="px-4 py-3 text-center">Qté</th>
                        <th className="px-4 py-3">Livrée le</th>
                        <th className="px-4 py-3 text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C9C1B1]/30">
                      {lignes.length === 0 ? (
                        <tr><td colSpan="6" className="px-4 py-8 text-center text-[#1B2632]/50">Aucune commande rattachée.</td></tr>
                      ) : lignes.map((l) => (
                        <tr key={l.commande_id}>
                          <td className="px-4 py-3 font-mono text-xs text-[#A35139]">{l.commandes?.lead_id || '—'}</td>
                          <td className="px-4 py-3 text-[#1B2632]">{l.commandes?.client_nom || '—'}</td>
                          <td className="px-4 py-3 text-[#1B2632]">{l.commandes?.produit || '—'}</td>
                          <td className="px-4 py-3 text-center font-mono">{l.commandes?.quantite ?? 1}</td>
                          <td className="px-4 py-3 text-[#1B2632]/60 whitespace-nowrap">{jour(l.commandes?.updated_at)}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">{sou(l.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-dashed border-[#C9C1B1] font-bold text-[#1B2632]">
                        <td className="px-4 py-3" colSpan="3">Total</td>
                        <td className="px-4 py-3 text-center font-mono">
                          {lignes.reduce((s, l) => s + (l.commandes?.quantite || 1), 0)}
                        </td>
                        <td></td>
                        <td className="px-4 py-3 text-right font-mono">{sou(fiche.total_ventes)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex justify-end">
                  <div className="w-full sm:w-[340px] flex flex-col gap-2">
                    <LigneTotal label="Total des ventes" valeur={sou(fiche.total_ventes)} devise={fiche.devise} />
                    {/* Les frais restent à zéro tant qu'ils ne sont pas décidés.
                        On les montre quand même : le vendeur voit qu'on ne lui
                        retient rien, au lieu de se demander ce qui manque. */}
                    <LigneTotal label="Frais retenus" valeur={sou(
                      Number(fiche.frais_confirmation || 0) + Number(fiche.frais_livraison || 0) +
                      Number(fiche.frais_service || 0) + Number(fiche.frais_divers || 0),
                    )} devise={fiche.devise} />
                    <div className="flex justify-between items-baseline px-4 py-3 bg-[#EEE9DF] rounded-xl mt-1">
                      <span className="text-sm font-bold text-[#1B2632]">Net à payer</span>
                      <span className="text-xl font-bold text-[#1B2632] font-mono">
                        {sou(fiche.net_a_payer)} <span className="text-xs font-sans text-[#1B2632]/50">{fiche.devise || ''}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {fiche.note && (
                  <p className="text-sm text-[#1B2632]/70 italic border-t border-[#C9C1B1]/50 pt-4">{fiche.note}</p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3 px-8 py-5 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl sans-impression">
                <button onClick={() => window.print()}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Imprimer
                </button>
                {peutGerer && fiche.statut !== 'paye' && (
                  <>
                    <button onClick={() => supprimer(fiche)}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-red-700 border border-red-300 hover:bg-red-50 transition-colors">
                      Supprimer
                    </button>
                    <button onClick={() => marquerPaye(fiche)}
                      className="px-6 py-2.5 rounded-xl text-sm font-bold bg-green-600 text-white hover:bg-green-700 transition-colors">
                      Marquer payé
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---------- établir un relevé ---------- */}
      {modale && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setModale(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[900px] my-8 pop-in">

              <div className="flex items-center gap-3 px-8 pt-7 pb-6">
                <button onClick={() => setModale(false)} title="Retour"
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">Établir un relevé</h2>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-6">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label className="rg-label">Vendeur *</label>
                    <select className="rg-input" value={brouillon.vendeur_id}
                      onChange={(e) => { setBrouillon({ ...brouillon, vendeur_id: e.target.value }); setCandidates([]) }}>
                      <option value="">Choisir...</option>
                      {sellers.map((v) => (
                        <option key={v.user_id} value={v.user_id}>
                          {v.nom || v.email}
                          {attenteParVendeur[v.user_id] ? ` — ${attenteParVendeur[v.user_id]} à régler` : ' — rien à régler'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="rg-label">Du (facultatif)</label>
                    <input type="date" className="rg-input" value={brouillon.debut}
                      onChange={(e) => { setBrouillon({ ...brouillon, debut: e.target.value }); setCandidates([]) }} />
                  </div>
                  <div>
                    <label className="rg-label">Au (facultatif)</label>
                    <input type="date" className="rg-input" value={brouillon.fin}
                      onChange={(e) => { setBrouillon({ ...brouillon, fin: e.target.value }); setCandidates([]) }} />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                  <div className="sm:w-[200px]">
                    <label className="rg-label">Méthode</label>
                    <select className="rg-input" value={brouillon.methode}
                      onChange={(e) => setBrouillon({ ...brouillon, methode: e.target.value })}>
                      {Object.entries(METHODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <button onClick={chercherCommandes} disabled={rechercheEnCours}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors disabled:opacity-50">
                    {rechercheEnCours ? 'Recherche...' : 'Chercher les commandes livrées'}
                  </button>
                </div>

                {candidates.length > 0 && (
                  <>
                    <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto max-h-[320px] overflow-y-auto">
                      <table className="w-full min-w-[620px] text-left text-sm">
                        <thead className="sticky top-0 bg-[#F4F0E6]">
                          <tr className="text-[11px] uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                            <th className="px-4 py-3 w-10"></th>
                            <th className="px-4 py-3">Lead ID</th>
                            <th className="px-4 py-3">Client</th>
                            <th className="px-4 py-3">Produit</th>
                            <th className="px-4 py-3">Livrée le</th>
                            <th className="px-4 py-3 text-right">Montant</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {candidates.map((c) => {
                            const prise = choisies.includes(c.commande_id)
                            return (
                              <tr key={c.commande_id} className={prise ? '' : 'opacity-40'}>
                                <td className="px-4 py-2.5">
                                  <input type="checkbox" checked={prise} className="w-4 h-4 cursor-pointer accent-[#1B2632]"
                                    onChange={() => setChoisies((p) => prise ? p.filter((x) => x !== c.commande_id) : [...p, c.commande_id])} />
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs text-[#A35139]">{c.lead_id || '—'}</td>
                                <td className="px-4 py-2.5">{c.client_nom || '—'}</td>
                                <td className="px-4 py-2.5">{c.produit || '—'}</td>
                                <td className="px-4 py-2.5 text-[#1B2632]/60 whitespace-nowrap">{jour(c.updated_at)}</td>
                                <td className="px-4 py-2.5 text-right font-mono">
                                  {sou(Number(c.prix || 0) * (c.quantite || 1))} <span className="text-xs text-[#1B2632]/50">{c.devise || ''}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-[#EEE9DF] rounded-xl">
                      <span className="text-sm font-semibold text-[#1B2632]">
                        {retenues.length} commande{retenues.length > 1 ? 's' : ''} retenue{retenues.length > 1 ? 's' : ''}
                        {retenues.length !== candidates.length && ` sur ${candidates.length}`}
                      </span>
                      <span className="text-lg font-bold text-[#1B2632] font-mono">
                        {sou(totalRetenu)} <span className="text-xs font-sans text-[#1B2632]/50">{deviseRetenue}</span>
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3 px-8 py-5 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl">
                <button onClick={() => setModale(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  Annuler
                </button>
                <button onClick={enregistrerReleve} disabled={enregistrement || retenues.length === 0}
                  className="px-8 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors disabled:opacity-40">
                  {enregistrement ? 'Enregistrement...' : 'Établir le relevé'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Ligne({ label, valeur, mono }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[#1B2632]/45 w-[150px] shrink-0">{label}</span>
      <span className={`text-sm text-[#1B2632] ${mono ? 'font-mono font-semibold' : 'font-medium'}`}>{valeur || '—'}</span>
    </div>
  )
}

function LigneTotal({ label, valeur, devise }) {
  return (
    <div className="flex justify-between items-baseline px-4">
      <span className="text-sm text-[#1B2632]/60">{label}</span>
      <span className="text-sm font-mono font-semibold text-[#1B2632]">
        {valeur} <span className="text-xs text-[#1B2632]/40">{devise || ''}</span>
      </span>
    </div>
  )
}