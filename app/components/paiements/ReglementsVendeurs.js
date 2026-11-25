'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../context/PermissionsContext'
import { LIBELLES_RELEVE } from '../../../lib/libellesStatuts.mjs'
// La période du relevé : le calendrier français des autres pages (20/11).
import PlageDates from '../PlageDates'
import { useMessages } from '../Messages'
import { messageErreur } from '../../../lib/messageErreur.mjs'
import { useLangue } from '../../context/LangueContext'
import { localeDe, traduire } from '../../../lib/langues/index.mjs'

// Le relevé de paiement du vendeur. À ne pas confondre avec « Paiements »,
// qui suit l'argent encaissé par le livreur chez le client : ici c'est ce que
// l'entreprise reverse au vendeur.
//
// Les frais ne sont pas encore décidés, donc le net est égal au total des
// ventes. Les colonnes existent en base : le jour où les montants seront
// fixés, les relevés déjà payés garderont les leurs — un relevé recalculé
// après coup ne prouve plus rien.

const STATUTS = {
  // Libellés anglais partagés (lib/libellesStatuts.mjs, 17/11).
  en_attente: { label: LIBELLES_RELEVE.en_attente, classe: 'border-[#FFB162] text-[#8a5a1f] bg-[#FFB162]/10' },
  paye:       { label: LIBELLES_RELEVE.paye,       classe: 'border-green-500 text-green-700 bg-green-50' },
  annule:     { label: LIBELLES_RELEVE.annule,     classe: 'border-red-400 text-red-700 bg-red-50' },
}
// Codes enregistrés → clés de texte (25/11) : l'écran affiche t(METHODES[code]).
const METHODES = { especes: 'meth.especes', virement: 'meth.virement', cheque: 'meth.cheque' }

// Les ajustements d'un relevé (retenues_releve.sql, 09/11). Le sens suit le
// type ; seule la correction le laisse choisir (la base fait la même règle).
const TYPES_AJUST = { penalite: 'ajust.penalite', remboursement: 'ajust.remboursement', correction: 'ajust.correction', autre: 'ajust.autre' }
const AJUST_VIDE = { type: 'penalite', montant: '', sens: '', note: '' }

// Le montant d'une commande dans un relevé = ce que le livreur a RÉELLEMENT
// encaissé (montant_encaisse, reglement_sur_encaisse.sql, sa décision 03/11) ;
// le prix seulement tant que la vue n'a pas cette colonne. JAMAIS prix ×
// quantité : le prix est déjà le total de la commande (offres dégressives :
// 3 unités = 58 000) — multiplier payait le vendeur trop (FG0000000197 :
// 174 000 au lieu de 58 000, REG-000003, 03/11).
const montantLigne = (c) => Number(c.montant_encaisse ?? c.prix ?? 0)

// Badge compact (20/11) : la couleur au point, le texte foncé.
const POINT_STATUT = { en_attente: '#FFB162', paye: '#2E7D53', annule: '#A35139' }
function Statut({ valeur }) {
  const s = STATUTS[valeur] || { label: valeur || '—' }
  const couleur = POINT_STATUT[valeur] || '#C9C1B1'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold text-[#1B2632] whitespace-nowrap"
      style={{ backgroundColor: `${couleur}22`, borderColor: `${couleur}66` }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: couleur }} />
      {s.label}
    </span>
  )
}

// Un montant négatif : le vendeur doit de l'argent (ses frais dépassent ses
// ventes). Écrit en rouge avec « dû par le vendeur » (20/11) — avant, rien ne
// le distinguait d'un montant à lui payer.
function Montant({ valeur, devise, grand }) {
  const n = Number(valeur || 0)
  return (
    <span className={`whitespace-nowrap ${n < 0 ? 'text-[#A35139]' : 'text-[#1B2632]'}`}>
      <span className={`font-mono font-bold ${grand ? 'text-xl' : ''}`}>{sou(valeur)}</span>{' '}
      <span className="text-xs font-sans font-normal opacity-60">{devise || ''}</span>
      {n < 0 && <span className="block text-[11px] font-sans font-semibold">{traduire('rel.duParVendeur')}</span>}
    </span>
  )
}

const jour = (v) => (v ? new Date(v).toLocaleDateString(localeDe()) : '—')
const jourHeure = (v) => (v ? new Date(v).toLocaleString(localeDe(), { dateStyle: 'short', timeStyle: 'short' }) : '—')
const sou = (n) => Number(n || 0).toLocaleString(localeDe(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Les dates partent vides : on règle d'abord TOUT ce qui attend. Pré-remplir
// la semaine passée écartait les livraisons du jour, la recherche ne trouvait
// rien, et on en concluait que l'écran ne marchait pas.

export default function ReglementsVendeurs() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()
  // Messages du CRM (24/11) au lieu des fenêtres du navigateur.
  const { annoncer, confirmer } = useMessages()
  // Les textes suivent la langue choisie (25/11).
  const { t, locale } = useLangue()

  const tenantKey = typeof tenantId === 'object' ? tenantId?.id : tenantId
  const peutGerer = hasPermission('gerer_reglements')
  // « Marquer payé » = la validation : admin et super admin (sa décision 09/11).
  // La base refuse aussi tout autre compte (reglements_garde).
  const peutPayer = hasPermission('payer_reglements')

  const [releves, setReleves] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')

  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreVendeur, setFiltreVendeur] = useState('')

  // Combien de commandes livrées attendent d'être réglées. Sans ce chiffre,
  // l'écran dit « aucun relevé » et laisse croire qu'il n'y a rien à payer,
  // alors que des livraisons attendent.
  const [enAttenteDeReglement, setEnAttenteDeReglement] = useState(null)
  const [fiche, setFiche] = useState(null)
  const [lignes, setLignes] = useState([])
  // Le bas du relevé (retenues_releve.sql, 09/11) : crédit d'expédition à la
  // main (date, kg, prix au kg et montant, TOUS tapés, un par relevé) et des
  // lignes d'ajustement.
  const [credit, setCredit] = useState({ date: '', poids: '', prix: '', montant: '', note: '' })
  const [creditEnCours, setCreditEnCours] = useState(false)
  const [ajustements, setAjustements] = useState([])
  const [nouvelAjust, setNouvelAjust] = useState(AJUST_VIDE)
  const [ajustEnCours, setAjustEnCours] = useState(false)
  // L'équivalent en MAD (11/11, P8, facultatif) : un taux tapé à la main.
  const [tauxMad, setTauxMad] = useState('')

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

    if (error) { setErreur(messageErreur(error)); setReleves([]); setChargement(false); return }
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

  // L'email de qui a établi / payé (sa décision 09/11). La base ne laisse
  // lire au vendeur que SON compte : pour lui, rien n'est trouvé, rien ne
  // s'affiche — les emails de l'équipe ne lui sont jamais montrés.
  const emailDe = useCallback((id) => {
    if (!id) return null
    return personnel.find((x) => x.user_id === id)?.email || null
  }, [personnel])

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

  // Le résumé du relevé PAR PRODUIT (sa demande 09/11, comme les factures
  // Storeino) : unités vendues, total, frais, paiement. Additionné depuis les
  // lignes (frais copiés à l'établissement) — rien n'est recalculé.
  const parProduit = useMemo(() => {
    const m = new Map()
    for (const l of lignes) {
      const nom = nomProduit(l)
      const x = m.get(nom) || { nom, qte: 0, total: 0, fc: 0, fl: 0, fu: 0, net: 0 }
      x.qte += qteLigne(l)
      x.total += Number(l.total_commande ?? l.montant ?? 0)
      x.fc += Number(l.frais_commande || 0)
      x.fl += Number(l.frais_livraison || 0)
      x.fu += Number(l.frais_upsell || 0)
      x.net += Number(l.net ?? l.montant ?? 0)
      m.set(nom, x)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [lignes])


  // Les bandeaux de la page et de la fiche sont remplacés par les annonces du
  // CRM (24/11) : elles passent au-dessus de la fenêtre du relevé.
  function annonce(texte, type) {
    annoncer(texte, type === 'succes' ? 'succes' : type === 'erreur' ? 'erreur' : 'info')
  }

  async function ouvrirFiche(r) {
    setFiche(r)
    setLignes([])
    setCredit({
      date: r.credit_expedition_date || '',
      poids: r.credit_expedition_poids != null ? String(r.credit_expedition_poids) : '',
      prix: r.credit_expedition_prix_kg != null ? String(r.credit_expedition_prix_kg) : '',
      montant: r.credit_expedition_poids != null ? String(r.credit_expedition) : '',
      note: r.credit_expedition_note || '',
    })
    setNouvelAjust(AJUST_VIDE)
    setTauxMad(r.taux_mad != null ? String(r.taux_mad) : '')
    chargerAjustements(r.id)
    // Les frais de chaque ligne sont COPIÉS par la base à l'établissement
    // (etablir_releve) : on les lit, on ne les recalcule jamais ici.
    const { data, error } = await supabase
      .from('reglements_commandes')
      .select('commande_id, montant, quantite, total_commande, frais_commande, frais_livraison, frais_upsell, net, commandes(lead_id, client_nom, produit, quantite, prix, updated_at, produits(product))')
      .eq('reglement_id', r.id)
    if (error) { annonce(t('rel.detailIllisible', { erreur: messageErreur(error) }), 'erreur'); return }
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
    if (!brouillon.vendeur_id) return annonce(t('rel.choisirVendeur'), 'erreur')
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
    if (error) return annonce(t('rel.rechercheImpossible', { erreur: messageErreur(error) }), 'erreur')

    setCandidates(data || [])
    setChoisies((data || []).map((c) => c.commande_id))
    if ((data || []).length === 0) {
      annonce(
        brouillon.debut || brouillon.fin
          ? t('rel.aucuneSurPeriode')
          : t('rel.aucunePourVendeur'),
        'erreur',
      )
    }
  }

  const retenues = candidates.filter((c) => choisies.includes(c.commande_id))
  const totalRetenu = retenues.reduce((s, c) => s + montantLigne(c), 0)
  const deviseRetenue = retenues[0]?.devise || ''

  async function enregistrerReleve() {
    if (retenues.length === 0) return annonce(t('rel.aucuneRetenue'), 'erreur')

    // Deux devises dans un même relevé donneraient un total faux : on refuse
    // plutôt que d'additionner des monnaies différentes.
    const devises = [...new Set(retenues.map((c) => c.devise || '—'))]
    if (devises.length > 1) {
      return annonce(`Ces commandes sont en ${devises.join(' et ')} : faites un relevé par devise.`, 'erreur')
    }

    setEnregistrement(true)

    // UN appel = une transaction (reglement_atomique.sql, 03/11) : le relevé ET
    // ses commandes, ou rien. Avant, la page créait le relevé puis ses lignes
    // en deux requêtes : une 2e ratée (ou un double clic) laissait un relevé
    // avec un total et aucune commande. La base vérifie chaque commande (livrée,
    // argent remis, de ce vendeur, dans aucun relevé), refuse deux devises, et
    // calcule elle-même le total (l'encaissé). Sans dates, la période = celles
    // des commandes retenues.
    const { data, error } = await supabase.rpc('etablir_releve', {
      p_tenant: tenantKey,
      p_vendeur: brouillon.vendeur_id,
      p_commandes: retenues.map((c) => c.commande_id),
      p_methode: brouillon.methode,
      p_debut: brouillon.debut || null,
      p_fin: brouillon.fin || null,
    })

    setEnregistrement(false)
    if (error) return annonce(t('rel.releveRefuse', { erreur: messageErreur(error) }), 'erreur')

    const r = data?.[0]
    annonce(t('rel.etabli', { ref: r?.reference || '', n: r?.nb_commandes ?? retenues.length }), 'succes')
    setModale(false)
    charger()
  }

  async function chargerAjustements(id) {
    const { data, error } = await supabase
      .from('reglements_ajustements')
      .select('id, type, montant, en_plus, note, cree_par, cree_le')
      .eq('reglement_id', id).order('cree_le')
    if (error) { setAjustements([]); return }
    setAjustements(data || [])
  }

  // Après chaque changement : l'en-tête recalculé par la base, les lignes, la liste.
  async function rechargerFiche(id) {
    const { data } = await supabase.from('reglements').select('*').eq('id', id).single()
    if (data) setFiche(data)
    await chargerAjustements(id)
    charger()
  }

  // Ce qui est tapé diffère de ce qui est enregistré : le bouton le montre, et
  // « Marquer payé » l'enregistre d'abord (rien de tapé n'est perdu, 05/11).
  const creditModifie = !!fiche && (
    credit.date !== (fiche.credit_expedition_date || '')
    || (credit.poids === '' ? fiche.credit_expedition_poids != null : Number(credit.poids) !== Number(fiche.credit_expedition_poids))
    || (credit.prix === '' ? fiche.credit_expedition_prix_kg != null : Number(credit.prix) !== Number(fiche.credit_expedition_prix_kg))
    || (credit.montant === '' ? fiche.credit_expedition_poids != null : Number(credit.montant) !== Number(fiche.credit_expedition))
    || credit.note.trim() !== (fiche.credit_expedition_note || '')
  )
  const creditSaisi = !!fiche && Number(fiche.credit_expedition || 0) > 0
  const ajustTape = nouvelAjust.montant !== '' || nouvelAjust.note.trim() !== ''

  // Tout est tapé (le montant n'est pas calculé, sa décision 09/11) ; la base
  // refuse un relevé payé et recalcule « à payer ». Tout vide = pas d'expédition.
  async function enregistrerCredit() {
    if (!fiche) return false
    const champs = [credit.date, credit.poids, credit.prix, credit.montant]
    const vide = champs.every((x) => x === '')
    const poids = Number(credit.poids), prix = Number(credit.prix), montant = Number(credit.montant)
    if (!vide) {
      if (champs.some((x) => x === '')) {
        annonce(t('rel.creditIncomplet'), 'erreur'); return false
      }
      if (![poids, prix, montant].every(Number.isFinite) || poids <= 0 || prix < 0 || montant < 0) {
        annonce(t('rel.creditInvalide'), 'erreur'); return false
      }
    }
    setCreditEnCours(true)
    const { error } = await supabase.rpc('fixer_credit_expedition', {
      p_reglement: fiche.id,
      p_date: vide ? null : credit.date,
      p_poids: vide ? null : poids,
      p_prix_kg: vide ? null : prix,
      p_montant: vide ? null : montant,
      p_note: credit.note,
    })
    setCreditEnCours(false)
    if (error) { annonce(t('rel.refuse', { erreur: messageErreur(error) }), 'erreur'); return false }
    annonce(vide ? t('rel.pasExpedition') : t('rel.creditEnregistreMsg'), 'succes')
    await rechargerFiche(fiche.id)
    return true
  }

  const tauxModifie = !!fiche && (tauxMad === '' ? fiche.taux_mad != null : Number(tauxMad) !== Number(fiche.taux_mad))

  // Le taux MAD : la base vérifie (> 0, relevé non payé, droits). Vide = enlevé.
  async function enregistrerTaux() {
    if (!fiche) return false
    // `taux`, pas `t` (25/11) : `t` est la fonction de traduction.
    const taux = tauxMad === '' ? null : Number(tauxMad)
    if (taux !== null && (!Number.isFinite(taux) || taux <= 0)) { annonce(t('rel.tauxInvalide'), 'erreur'); return false }
    const { error } = await supabase.rpc('fixer_taux_mad', { p_reglement: fiche.id, p_taux: taux })
    if (error) { annonce(t('rel.refuse', { erreur: messageErreur(error) }), 'erreur'); return false }
    annonce(taux === null ? t('rel.madRetire') : t('rel.tauxEnregistre'), 'succes')
    await rechargerFiche(fiche.id)
    return true
  }

  async function ajouterAjustement() {
    if (!fiche) return
    const a = nouvelAjust
    const montant = Number(a.montant)
    if (a.montant === '' || !Number.isFinite(montant) || montant <= 0) return annonce('Le montant doit être plus grand que 0.', 'erreur')
    if (!a.note.trim()) return annonce(t('rel.raisonAjust'), 'erreur')
    if (a.type === 'correction' && !a.sens) return annonce(t('rel.sensCorrection'), 'erreur')
    setAjustEnCours(true)
    const { error } = await supabase.rpc('ajouter_ajustement', {
      p_reglement: fiche.id, p_type: a.type, p_montant: montant,
      p_en_plus: a.type === 'correction' ? a.sens === 'plus' : null, p_note: a.note,
    })
    setAjustEnCours(false)
    if (error) return annonce(t('rel.refuse', { erreur: messageErreur(error) }), 'erreur')
    setNouvelAjust(AJUST_VIDE)
    annonce(t('rel.ajustAjoute'), 'succes')
    await rechargerFiche(fiche.id)
  }

  async function retirerAjustement(a) {
    if (!fiche || !(await confirmer({ titre: t('rel.retirerAjust'), message: t('rel.retirerAjustMsg', { type: TYPES_AJUST[a.type] ? t(TYPES_AJUST[a.type]) : a.type, note: a.note }), bouton: t('rel.retirer'), danger: true }))) return
    const { error } = await supabase.rpc('retirer_ajustement', { p_ajustement: a.id })
    if (error) return annonce(t('rel.refuse', { erreur: messageErreur(error) }), 'erreur')
    annonce(t('rel.ajustRetire'), 'succes')
    await rechargerFiche(fiche.id)
  }

  async function marquerPaye(r) {
    if (!(await confirmer({ titre: t('rel.marquerCommePaye'), message: t('rel.payeMsg', { ref: r.reference }), bouton: t('rel.marquerPaye') }))) return
    // Rien de ce qui est tapé n'est perdu au paiement : le crédit modifié part
    // d'abord ; un ajustement tapé mais pas ajouté arrête (on ne devine pas).
    if (ajustTape) return annonce(t('rel.ajustNonAjoute'), 'erreur')
    if (creditModifie && !(await enregistrerCredit())) return
    if (tauxModifie && !(await enregistrerTaux())) return
    const { data, error } = await supabase
      .from('reglements').update({ statut: 'paye' })
      .eq('id', r.id).eq('tenant_id', tenantKey).select()
    if (error) return annonce(t('rel.refuse', { erreur: messageErreur(error) }), 'erreur')
    if (!data || data.length === 0) return annonce(t('rel.rolePayer'), 'erreur')
    annonce(t('rel.marquePaye'), 'succes')
    setFiche(null)
    charger()
  }

  async function supprimer(r) {
    if (!(await confirmer({ titre: t('rel.supprimerReleve'), message: t('rel.supprimerMsg', { ref: r.reference }), bouton: t('rel.supprimer'), danger: true }))) return
    const { error } = await supabase.from('reglements').delete().eq('id', r.id).eq('tenant_id', tenantKey)
    if (error) return annonce(t('rel.suppressionRefusee', { erreur: messageErreur(error) }), 'erreur')
    annonce(t('rel.supprime'), 'succes')
    setFiche(null)
    charger()
  }

  if (authLoading || permsLoading) {
    return <div className="p-12 text-center text-[#1B2632]/60 font-medium">{t('rel.chargement')}</div>
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pt-4 px-4 sm:px-6 pb-10">
      <style>{`
        @keyframes popIn { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in { animation: popIn .18s ease-out; }
        .rg-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .rg-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        .cm-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .rg-label { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(27,38,50,.55); margin-bottom:6px; }
        @media print {
          body * { visibility: hidden; }
          .zone-impression, .zone-impression * { visibility: visible; }
          .zone-impression { position: absolute; inset: 0; margin: 0; border: none; box-shadow: none; }
          .sans-impression { display: none !important; }
        }
      `}</style>

      <header className="flex flex-col gap-3 border-b border-[#C9C1B1]/50 pb-4 sans-impression">
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
            <option value="">{t('rel.tousStatuts')}</option>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {sellers.length > 0 && (
            <select value={filtreVendeur} onChange={(e) => setFiltreVendeur(e.target.value)}
              className="px-4 py-2.5 bg-white border border-[#C9C1B1] rounded-xl text-sm font-semibold text-[#1B2632] outline-none cursor-pointer">
              <option value="">{t('rel.tousVendeurs')}</option>
              {sellers.map((v) => <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>)}
            </select>
          )}

          {/* Ce qui attend un relevé se lit sur le bouton qui le règle (20/11) :
              un compteur et une ligne courte, au lieu d'un bandeau au milieu. */}
          {peutGerer ? (
            <div className="sm:ml-auto flex items-center gap-3">
              {enAttenteDeReglement > 0 && (
                <span className="text-xs font-semibold text-[#8a5a1f] text-right leading-tight">
                  {t('rel.livreesARegler', { n: enAttenteDeReglement })}<br />{t('rel.aReglerMot')}
                </span>
              )}
              <button onClick={ouvrirCreation}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm">
                <span className="text-lg leading-none">+</span> Établir un relevé
                {enAttenteDeReglement > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#FFB162] text-[#1B2632] text-xs font-bold flex items-center justify-center">
                    {enAttenteDeReglement}
                  </span>
                )}
              </button>
            </div>
          ) : enAttenteDeReglement > 0 && (
            <span className="sm:ml-auto text-xs font-semibold text-[#8a5a1f]">
              {enAttenteDeReglement} commande{enAttenteDeReglement > 1 ? 's' : ''} livrée{enAttenteDeReglement > 1 ? 's' : ''} pas encore réglée{enAttenteDeReglement > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {erreur && (
        <div className="px-4 py-3 rounded-xl text-sm bg-red-50 text-red-800 border border-red-200 sans-impression">
          <p className="font-bold mb-1">{t('rel.lectureImpossible')}</p>
          <p className="font-mono text-xs">{erreur}</p>
          <p className="mt-2 text-xs opacity-80">
            {t('rel.lectureAide')}
          </p>
        </div>
      )}

      {/* Le bandeau « N commandes livrées pas encore réglées » est monté sur le
          bouton « Établir un relevé » (20/11). */}

      {/* Les totaux « À payer / Déjà payé » : retirés (sa décision 20/11) —
          le statut de chaque ligne suffit. */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden sans-impression">
        <div className="overflow-auto">
          <table className="w-full min-w-[820px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F4F0E6] border-b border-[#C9C1B1]/50 text-xs uppercase tracking-wider text-[#1B2632]/60 font-semibold shadow-[0_1px_0_#C9C1B1]">
                <th className="px-5 py-4">ID</th>
                <th className="px-5 py-4">{t('rel.vendeur')}</th>
                <th className="px-5 py-4 text-center">{t('rel.commandes')}</th>
                <th className="px-5 py-4">{t('rel.periode')}</th>
                <th className="px-5 py-4">{t('rel.date')}</th>
                <th className="px-5 py-4 text-right">{t('rel.netAPayer')}</th>
                <th className="px-5 py-4">{t('rel.statut')}</th>
                <th className="px-5 py-4 text-right sticky right-0 bg-[#F4F0E6]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9C1B1]/30">
              {chargement ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">{t('rel.chargement')}</td></tr>
              ) : affiches.length === 0 ? (
                <tr><td colSpan="8" className="px-6 py-12 text-center text-[#1B2632]/60">
                  {releves.length > 0
                    ? t('rel.aucunRecherche')
                    : enAttenteDeReglement > 0
                      ? t('rel.aucunEtabliAttente', { n: enAttenteDeReglement })
                      : t('rel.aucunEtabli')}
                </td></tr>
              ) : (
                affiches.map((r) => (
                  // La ligne entière ouvre le relevé (20/11).
                  <tr key={r.id} onClick={() => ouvrirFiche(r)} className="bg-white hover:bg-[#F3EFE7] transition-colors cursor-pointer">
                    <td className="px-5 py-4 font-mono text-xs text-[#A35139] font-semibold whitespace-nowrap">{r.reference}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-[#1B2632] whitespace-nowrap">{nomVendeur(r.vendeur_id)}</td>
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
                    <td className="px-5 py-4 text-right"><Montant valeur={r.net_a_payer} devise={r.devise} /></td>
                    <td className="px-5 py-4"><Statut valeur={r.statut} /></td>
                    <td className="px-5 py-4 text-right sticky right-0 bg-inherit" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => ouvrirFiche(r)} title={t('rel.voir')}
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
                <button onClick={() => setFiche(null)} title={t('rel.retour')}
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">{t('rel.releveTitre')}</h2>
                <span className="ml-auto"><Statut valeur={fiche.statut} /></span>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-6">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <Ligne label={t('rel.idReleve')} valeur={fiche.reference} mono />
                  <Ligne label={t('rel.vendeur')} valeur={nomVendeur(fiche.vendeur_id)} />
                  <Ligne label={t('rel.periode')} valeur={`${jour(fiche.periode_debut)} → ${jour(fiche.periode_fin)}`} />
                  <Ligne label={t('rel.methodePaiement')} valeur={METHODES[fiche.methode] ? t(METHODES[fiche.methode]) : fiche.methode} />
                  <Ligne label={t('rel.etabliLe')} valeur={jourHeure(fiche.created_at)} />
                  <Ligne
                    label={t('rel.datePaiement')}
                    valeur={fiche.date_paiement ? jourHeure(fiche.date_paiement) : t('rel.pasPaye')}
                  />
                  <Ligne label={t('rel.nbCommandes')} valeur={String(fiche.nb_commandes)} />
                  {emailDe(fiche.cree_par) && <Ligne label={t('rel.etabliPar')} valeur={emailDe(fiche.cree_par)} />}
                  {emailDe(fiche.paye_par) && <Ligne label={t('rel.payePar')} valeur={emailDe(fiche.paye_par)} />}
                </div>

                {/* Résumé par produit (sa décision 09/11 : plus de détail par lead —
                    un relevé de la semaine se lit par produit). */}
                <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#A35139] font-bold">
                        <th className="px-4 py-3">{t('rel.produit')}</th>
                        <th className="px-4 py-3 text-center">{t('rel.qteVendue')}</th>
                        <th className="px-4 py-3 text-right">{t('rel.totalVentes')}</th>
                        <th className="px-4 py-3 text-right">{t('rel.fraisConfirmation')}</th>
                        <th className="px-4 py-3 text-right">{t('rel.fraisLivraison')}</th>
                        <th className="px-4 py-3 text-right">{t('rel.upsell')}</th>
                        <th className="px-4 py-3 text-right">{t('rel.paiement')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C9C1B1]/30">
                      {parProduit.length === 0 ? (
                        <tr><td colSpan="7" className="px-4 py-6 text-center text-[#1B2632]/50">{t('rel.aucuneCommande')}</td></tr>
                      ) : parProduit.map((x) => (
                        <tr key={x.nom}>
                          <td className="px-4 py-3 font-semibold text-[#1B2632]">{x.nom}</td>
                          <td className="px-4 py-3 text-center font-mono">{x.qte}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(x.total)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#1B2632]/70">{sou(x.fc)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#1B2632]/70">{sou(x.fl)}</td>
                          <td className="px-4 py-3 text-right font-mono text-[#1B2632]/70">{sou(x.fu)}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">{sou(x.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {parProduit.length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-dashed border-[#C9C1B1] font-bold text-[#1B2632]">
                          <td className="px-4 py-3">{t('rel.total')}</td>
                          <td className="px-4 py-3 text-center font-mono">{parProduit.reduce((t, x) => t + x.qte, 0)}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(fiche.total_ventes)}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(fiche.frais_confirmation)}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(fiche.frais_livraison)}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(fiche.frais_upsell)}</td>
                          <td className="px-4 py-3 text-right font-mono">{sou(parProduit.reduce((t, x) => t + x.net, 0))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Retenues et ajustements (retenues_releve.sql) : visibles par tous,
                    vendeur compris ; ajout / retrait seulement avant « payé ». */}
                {(ajustements.length > 0 || (peutGerer && fiche.statut !== 'paye')) && (
                  <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto">
                    <div className="px-4 py-3 bg-[#F4F0E6] text-[11px] uppercase tracking-wider text-[#A35139] font-bold">{t('rel.ajustements')}</div>
                    {ajustements.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-[#1B2632]/50">{t('rel.aucunAjust')}</p>
                    ) : (
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <tbody className="divide-y divide-[#C9C1B1]/30">
                          {ajustements.map((a) => (
                            <tr key={a.id}>
                              <td className="px-4 py-2.5 font-semibold text-[#1B2632] whitespace-nowrap">{TYPES_AJUST[a.type] ? t(TYPES_AJUST[a.type]) : a.type}</td>
                              <td className="px-4 py-2.5 text-[#1B2632]">{a.note}</td>
                              <td className="px-4 py-2.5 text-xs text-[#1B2632]/50 whitespace-nowrap">
                                {emailDe(a.cree_par) ? `${emailDe(a.cree_par)} · ` : ''}{jourHeure(a.cree_le)}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${a.en_plus ? 'text-green-700' : 'text-[#A35139]'}`}>
                                {a.en_plus ? '+ ' : '− '}{sou(a.montant)}
                              </td>
                              {peutGerer && fiche.statut !== 'paye' && (
                                <td className="px-2 py-2.5 text-right sans-impression">
                                  <button onClick={() => retirerAjustement(a)} title={t('rel.retirer')}
                                    className="w-7 h-7 rounded-full text-[#A35139] hover:bg-[#A35139]/10">×</button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {peutGerer && fiche.statut !== 'paye' && (
                      <div className="grid grid-cols-1 sm:grid-cols-[150px_120px_1fr_auto] gap-2 p-3 border-t border-dashed border-[#C9C1B1] bg-[#faf9f7] sans-impression">
                        <select className="rg-input" value={nouvelAjust.type}
                          onChange={(e) => setNouvelAjust({ ...nouvelAjust, type: e.target.value, sens: '' })}>
                          {Object.entries(TYPES_AJUST).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                        </select>
                        <input type="number" min="0" step="any" className="rg-input" placeholder={t('rel.montant')} value={nouvelAjust.montant}
                          onChange={(e) => setNouvelAjust({ ...nouvelAjust, montant: e.target.value })} />
                        <div className="flex gap-2">
                          {nouvelAjust.type === 'correction' && (
                            <select className="rg-input !w-[170px]" value={nouvelAjust.sens}
                              onChange={(e) => setNouvelAjust({ ...nouvelAjust, sens: e.target.value })}>
                              <option value="">{t('rel.sens')}</option>
                              <option value="moins">{t('rel.retenue')}</option>
                              <option value="plus">{t('rel.rendue')}</option>
                            </select>
                          )}
                          <input type="text" className="rg-input" placeholder={t('rel.noteObl')} value={nouvelAjust.note}
                            onChange={(e) => setNouvelAjust({ ...nouvelAjust, note: e.target.value })} />
                        </div>
                        <button onClick={ajouterAjustement} disabled={ajustEnCours}
                          className="px-5 py-2 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-40">
                          {ajustEnCours ? '...' : 'Ajouter'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:justify-between gap-6">
                  {/* Crédit d'expédition : à la main (sa décision 09/11), 0 = aucun. */}
                  {peutGerer && fiche.statut !== 'paye' ? (
                    <div className="w-full sm:w-[360px] flex flex-col gap-2 p-4 bg-[#faf9f7] border border-dashed border-[#C9C1B1] rounded-xl sans-impression">
                      <label className="rg-label !mb-0">Crédit d&apos;expédition ({fiche.devise || ''})</label>
                      <input type="date" className="rg-input" value={credit.date} title={t('rel.dateExpedition')}
                        onChange={(e) => setCredit({ ...credit, date: e.target.value })} />
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" min="0" step="any" className="rg-input" placeholder={t('rel.poids')} value={credit.poids}
                          onChange={(e) => setCredit({ ...credit, poids: e.target.value })} />
                        <input type="number" min="0" step="any" className="rg-input" placeholder={t('rel.prixKg')} value={credit.prix}
                          onChange={(e) => setCredit({ ...credit, prix: e.target.value })} />
                      </div>
                      <input type="number" min="0" step="any" className="rg-input" placeholder={t('rel.montant')} value={credit.montant}
                        onChange={(e) => setCredit({ ...credit, montant: e.target.value })} />
                      <input type="text" className="rg-input" value={credit.note} placeholder={t('rel.noteTransport')}
                        onChange={(e) => setCredit({ ...credit, note: e.target.value })} />
                      <button onClick={enregistrerCredit} disabled={creditEnCours || !creditModifie}
                        className={`mt-1 px-5 py-2 rounded-xl text-sm font-bold transition-colors ${
                          creditModifie || !creditSaisi
                            ? 'bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-40'
                            : 'bg-green-50 text-green-800 border border-green-200'}`}>
                        {creditEnCours ? 'Enregistrement...'
                          : creditModifie || !creditSaisi ? t('rel.enregistrerCredit') : t('rel.creditEnregistre')}
                      </button>
                    </div>
                  ) : <div />}
                  <div className="w-full sm:w-[360px] flex flex-col gap-2">
                    <LigneTotal label={t('rel.totalVentes')} valeur={sou(fiche.total_ventes)} devise={fiche.devise} />
                    <LigneTotal label={t('rel.fraisCommande')} valeur={'− ' + sou(fiche.frais_confirmation)} devise={fiche.devise} />
                    <LigneTotal label={t('rel.fraisLivraison')} valeur={'− ' + sou(fiche.frais_livraison)} devise={fiche.devise} />
                    <LigneTotal label={t('rel.fraisUpsell')} valeur={'− ' + sou(fiche.frais_upsell)} devise={fiche.devise} />
                    {Number(fiche.frais_service || 0) > 0 && (
                      <LigneTotal label={t('rel.fraisService')} valeur={'− ' + sou(fiche.frais_service)} devise={fiche.devise} />
                    )}
                    <LigneTotal label={t('rel.creditExpedition')} valeur={'− ' + sou(fiche.credit_expedition)} devise={fiche.devise} />
                    {fiche.credit_expedition_poids != null && (
                      <p className="px-4 text-sm text-[#1B2632] text-right">
                        {fiche.credit_expedition_date && t('rel.expeditionDu', { date: jour(fiche.credit_expedition_date) })}
                        {Number(fiche.credit_expedition_poids).toLocaleString(locale)} kg × {sou(fiche.credit_expedition_prix_kg)} / kg
                        {fiche.credit_expedition_note && ` — ${fiche.credit_expedition_note}`}
                      </p>
                    )}
                    <LigneTotal label={t('rel.ajustements')}
                      valeur={(Number(fiche.frais_divers || 0) < 0 ? '+ ' : '− ') + sou(Math.abs(Number(fiche.frais_divers || 0)))} devise={fiche.devise} />
                    <LigneTotal label={t('rel.fraisTransfert', { pct: Number(fiche.frais_transfert_pct || 0).toLocaleString(locale) })}
                      valeur={'− ' + sou(fiche.frais_transfert)} devise={fiche.devise} />
                    <div className="flex justify-between items-baseline px-4 py-3 bg-[#EEE9DF] rounded-xl mt-1">
                      <span className="text-sm font-bold text-[#1B2632]">{t('rel.aPayer')}</span>
                      <span className="text-right"><Montant valeur={fiche.net_a_payer} devise={fiche.devise} grand /></span>
                    </div>
                    {fiche.taux_mad != null && (
                      // Une ligne (20/11) : le montant d'abord, le taux en petit.
                      <div className="flex justify-between items-baseline gap-3 px-4">
                        <span className="text-sm text-[#1B2632]/60 whitespace-nowrap">{t('rel.equivMad')}</span>
                        <span className="text-right">
                          <span className="text-base font-mono font-bold text-[#1B2632] whitespace-nowrap">≈ {sou(Number(fiche.net_a_payer || 0) * Number(fiche.taux_mad))} MAD</span>
                          <span className="block text-[11px] text-[#1B2632]/45">{t('rel.tauxMad', { taux: Number(fiche.taux_mad).toLocaleString(locale, { maximumFractionDigits: 6 }), devise: fiche.devise || '' })}</span>
                        </span>
                      </div>
                    )}
                    {/* L'équivalent MAD est pour information (sa décision 11/11) : il ne
                        change aucun montant, il reste modifiable même payé. */}
                    {peutGerer && (
                      <div className="flex items-center gap-2 px-4 sans-impression">
                        <label className="text-xs text-[#1B2632]/60 whitespace-nowrap">{t('rel.tauxMadFac')}</label>
                        <input type="number" min="0" step="any" className="rg-input !py-1.5" placeholder={t('rel.madPour1', { devise: fiche.devise || '' })}
                          value={tauxMad} onChange={(e) => setTauxMad(e.target.value)} />
                        <button onClick={enregistrerTaux} disabled={!tauxModifie}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1B2632] text-white disabled:opacity-30">OK</button>
                      </div>
                    )}
                  </div>
                </div>

                {fiche.note && (
                  <p className="text-sm text-[#1B2632]/70 italic border-t border-[#C9C1B1]/50 pt-4">{fiche.note}</p>
                )}
              </div>


              <div className="flex flex-col sm:flex-row justify-end gap-3 px-8 py-5 border-t border-[#C9C1B1]/50 bg-[#EEE9DF]/20 rounded-b-2xl sans-impression">
                <button onClick={() => window.print()}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors">
                  {t('rel.imprimer')}
                </button>
                {peutGerer && fiche.statut !== 'paye' && (
                  <>
                    <button onClick={() => supprimer(fiche)}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-red-700 border border-red-300 hover:bg-red-50 transition-colors">
                      {t('rel.supprimer')}
                    </button>
                    {peutPayer && (
                      <button onClick={() => marquerPaye(fiche)}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#2E7D53] text-white hover:bg-[#256946] transition-colors">
                        {t('rel.marquerPaye')}
                      </button>
                    )}
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
                <button onClick={() => setModale(false)} title={t('rel.retour')}
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <h2 className="text-2xl font-bold text-[#A35139]">{t('rel.etablirUn')}</h2>
              </div>

              <div className="px-8 pb-8 flex flex-col gap-6">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label className="rg-label">{t('rel.vendeurObl')}</label>
                    <select className="rg-input" value={brouillon.vendeur_id}
                      onChange={(e) => { setBrouillon({ ...brouillon, vendeur_id: e.target.value }); setCandidates([]) }}>
                      <option value="">{t('rel.choisir')}</option>
                      {sellers.map((v) => (
                        <option key={v.user_id} value={v.user_id}>
                          {v.nom || v.email}
                          {attenteParVendeur[v.user_id] ? t('rel.aRegler', { n: attenteParVendeur[v.user_id] }) : t('rel.rienARegler')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Une seule case « du → au » en français (20/11), au lieu de deux
                      champs mm/dd/yyyy. Mêmes valeurs AAAA-MM-JJ qu'avant. */}
                  <div className="sm:col-span-2">
                    <label className="rg-label">{t('rel.periodeFac')}</label>
                    <PlageDates etiquette="releve" du={brouillon.debut} au={brouillon.fin} placeholder={t('rel.toutesLivrees')}
                      onChange={(du, au) => { setBrouillon({ ...brouillon, debut: du, fin: au }); setCandidates([]) }} />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                  <div className="sm:w-[200px]">
                    <label className="rg-label">{t('rel.methode')}</label>
                    <select className="rg-input" value={brouillon.methode}
                      onChange={(e) => setBrouillon({ ...brouillon, methode: e.target.value })}>
                      {Object.entries(METHODES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                    </select>
                  </div>
                  <button onClick={chercherCommandes} disabled={rechercheEnCours}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors disabled:opacity-50">
                    {rechercheEnCours ? 'Recherche...' : t('rel.chercherLivrees')}
                  </button>
                </div>

                {candidates.length > 0 && (
                  <>
                    <div className="border border-[#C9C1B1] rounded-xl overflow-x-auto max-h-[320px] overflow-y-auto">
                      <table className="w-full min-w-[620px] text-left text-sm">
                        <thead className="sticky top-0 bg-[#F4F0E6]">
                          <tr className="text-[11px] uppercase tracking-wider text-[#1B2632]/60 font-semibold">
                            <th className="px-4 py-3 w-10"></th>
                            <th className="px-4 py-3">{t('rel.leadId')}</th>
                            <th className="px-4 py-3">{t('rel.client')}</th>
                            <th className="px-4 py-3">{t('rel.produit')}</th>
                            <th className="px-4 py-3">{t('rel.livreeLe')}</th>
                            <th className="px-4 py-3 text-right">{t('rel.montant')}</th>
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
                                  {sou(montantLigne(c))} <span className="text-xs text-[#1B2632]/50">{c.devise || ''}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-[#EEE9DF] rounded-xl">
                      <span className="text-sm font-semibold text-[#1B2632]">
                        {t('rel.retenues', { n: retenues.length })}
                        {retenues.length !== candidates.length && t('rel.surN', { n: candidates.length })}
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
                  {t('rel.annuler')}
                </button>
                <button onClick={enregistrerReleve} disabled={enregistrement || retenues.length === 0}
                  className="px-8 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors disabled:opacity-40">
                  {enregistrement ? 'Enregistrement...' : t('rel.etablir')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Le nom du produit du catalogue (produit_id) ; à défaut, le texte de la commande.
function nomProduit(l) {
  return l.commandes?.produits?.product || l.commandes?.produit || '—'
}

// La quantité copiée sur la ligne à l'établissement ; avant le 05/11 elle
// n'existait pas : on lit celle de la commande.
function qteLigne(l) {
  return Number(l.quantite ?? l.commandes?.quantite ?? 1) || 1
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