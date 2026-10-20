'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

// « Mon API » : un seul écran — les identifiants de la source, puis comment
// s'en servir. Une source à la fois ; un sélecteur apparaît dès qu'il y en a
// plusieurs (on se fie au NOMBRE de sources, pas au rôle : la permission de
// tout gérer a déjà été donnée par erreur à un vendeur).
//
// La clé et le secret sont tirés par la base, jamais ici, et aucun n'arrive
// avec la liste ; chacun passe par sa fonction, au clic :
//   Clé API              identifiants_source        (affichée, comme ShipLead)
//   Secret API (URL)     reveler_secret_url         (mot de passe du compte)
//
// Pas de signature (retirée du produit le 20/10) ni de journal des leads
// refusés : imports_bruts continue de tout enregistrer, on ne l'affiche plus
// ici — il se lit dans l'éditeur SQL.
//
// Le ceo ouvre la page (il lit tout) mais ne voit pas les identifiants : lire
// un secret, ce n'est pas lire une donnée, c'est obtenir le droit de pousser
// des leads. La base le lui refuse de toute façon (source_geree).

const URL_FONCTION = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/import-commande`

// Les noms d'ALIAS (supabase/functions/_shared/import.ts), tels qu'un vendeur
// peut les écrire. Seul le téléphone est vraiment obligatoire : sans lui,
// personne ne peut appeler.
const CHAMPS = [
  { champ: 'telephone', autres: ['tel', 'phone', 'mobile', 'gsm', 'billing.phone'], obligatoire: 'oui' },
  { champ: 'nom', autres: ['name', 'client', 'full_name', 'first_name + last_name'], obligatoire: 'non' },
  { champ: 'pays', autres: ['country', 'country_code', 'billing.country'], note: 'nom ou code ISO', obligatoire: 'si vous livrez plusieurs pays' },
  { champ: 'ville', autres: ['city', 'zone', 'billing.city'], obligatoire: 'non' },
  { champ: 'adresse', autres: ['address', 'address_1', 'billing.address_1'], obligatoire: 'non' },
  { champ: 'produit', autres: ['product', 'article', 'line_items[].name'], obligatoire: 'non' },
  { champ: 'code', autres: ['sku', 'product_code'], note: 'reconnu avant le nom', obligatoire: 'non' },
  { champ: 'quantite', autres: ['qty', 'quantity'], obligatoire: 'non' },
  { champ: 'prix', autres: ['price', 'total', 'montant', 'total_price'], note: 'enregistré tel quel', obligatoire: 'non' },
  { champ: 'lead_id', autres: ['id', 'order_id', 'reference'], note: 'votre n° de commande', obligatoire: 'non' },
  { champ: 'notes', autres: ['note', 'commentaire', 'customer_note'], obligatoire: 'non' },
]

const VERT = '#2E7D53', AMBRE = '#C98A2B', BRIQUE = '#A35139'
const REPONSES = [
  { code: 200, couleur: VERT, corps: '{"status":"ok"}', sens: 'Le lead est entré. Un lead_id est renvoyé.' },
  { code: 200, couleur: AMBRE, corps: '{"status":"deja_importe"}', sens: 'Déjà reçu. Rien n’a été créé en double.' },
  { code: 400, couleur: BRIQUE, corps: '{"status":"rejete"}', sens: 'Téléphone manquant, pays inconnu, ou JSON illisible. Le motif est dans la réponse (error).' },
  { code: 401, couleur: BRIQUE, corps: '—', sens: 'Clé ou secret absent, faux, ou source coupée.' },
  { code: 429, couleur: BRIQUE, corps: '—', sens: 'Trop de requêtes. L’en-tête Retry-After dit quand revenir.' },
]

// Les composants du CRM, une fois.
const BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#C9C1B1] bg-white text-[#1B2632] hover:bg-[#EEE9DF]/70 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_PLEIN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#1B2632] bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40'
const BTN_DANGER = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#A35139]/40 bg-white text-[#A35139] hover:bg-[#A35139]/10 transition-colors cursor-pointer whitespace-nowrap'
const BTN_CLAIR = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed'
const CODE = 'font-mono text-xs bg-[#F4F0E6] border border-[#C9C1B1]/70 rounded-[5px] px-1.5 py-px'
const LABEL = 'text-[11px] font-bold uppercase tracking-[.06em] text-[#1B2632]/55'
const AIDE = 'text-xs text-[#1B2632]/55'
const CARTE = 'bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden'
const IDENT = 'border border-[#C9C1B1] rounded-xl px-3.5 py-3 bg-white flex flex-col gap-2'
const VALEUR = 'font-mono text-[13px] break-all min-w-0 flex-[1_1_220px] text-[#1B2632]'
const MASQUE = 'font-mono text-[13px] min-w-0 flex-[1_1_220px] tracking-[.12em] text-[#1B2632]/45'
const INPUT = 'border border-[#C9C1B1] rounded-lg px-2.5 py-1.5 text-[13px] bg-white text-[#1B2632] outline-none focus:border-[#1B2632]'

function Pastille({ couleur, children }) {
  return (
    <span className="inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-bold tabular-nums bg-white"
      style={{ color: couleur, border: `1px solid ${couleur}73` }}>
      {children}
    </span>
  )
}

function TeteCarte({ titre, children }) {
  return (
    <div className="px-5 pt-[18px] pb-3.5">
      <h2 className="text-xl font-bold text-[#A35139]">{titre}</h2>
      {children && <p className="mt-1 text-[13px] text-[#1B2632]/60">{children}</p>}
    </div>
  )
}

// Des étapes numérotées : l'ordre est celui des écrans de la boutique.
function Etapes({ items }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((contenu, i) => (
        <li key={i} className="grid grid-cols-[26px_1fr] gap-3 items-start">
          <span className="w-[26px] h-[26px] grid place-items-center rounded-full bg-[#C9D3DD] text-[#1B2632] text-xs font-bold tabular-nums">
            {i + 1}
          </span>
          <div className="text-sm leading-relaxed pt-0.5">{contenu}</div>
        </li>
      ))}
    </ol>
  )
}

export default function SourcesImportPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  // Ce que l'écran PROPOSE. Ce qui est permis, c'est la base qui le décide
  // (RLS de sources_import, peut_gerer_source dans chaque fonction).
  const peutGererTout = hasPermission('gerer_sources_import')
  const peutGererSiennes = hasPermission('gerer_mes_sources')
  const peutGerer = peutGererTout || peutGererSiennes

  const [sources, setSources] = useState([])
  const [sellers, setSellers] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState({ texte: '', type: '' })
  const [copie, setCopie] = useState('')

  const [sourceId, setSourceId] = useState(null)
  // { cle, secret_url_requis, secret_url_existe } — null tant que non chargé.
  const [identifiants, setIdentifiants] = useState(null)
  // true quand la base refuse (ceo, ou source qu'on ne gère pas).
  const [identifiantsRefuses, setIdentifiantsRefuses] = useState(false)
  // Le secret révélé : en mémoire seulement, il se remasque au rechargement
  // et quand on change de source.
  const [secretUrl, setSecretUrl] = useState(null)
  // Le mot de passe est-il demandé (formulaire ouvert dans la carte) ?
  const [demandeMdp, setDemandeMdp] = useState(false)
  const [motDePasse, setMotDePasse] = useState('')
  const [erreurMdp, setErreurMdp] = useState('')

  const [etiquette, setEtiquette] = useState('WooCommerce')
  const [onglet, setOnglet] = useState('woo')
  const [nouvelle, setNouvelle] = useState(null) // { nom, vendeur_id } : « Nouvelle source »
  const [enCours, setEnCours] = useState(false)

  const annonce = (texte, type = 'ok') => {
    setMessage({ texte, type })
    setTimeout(() => setMessage({ texte: '', type: '' }), 5000)
  }

  useEffect(() => {
    if (authLoading || permsLoading) return
    if (!user) router.replace('/')
    else if (!hasPermission('menu_sources_import')) router.replace('/dashboard')
  }, [user, authLoading, permsLoading, hasPermission, router])

  const charger = useCallback(async () => {
    if (!tenantId) return
    setChargement(true)
    setErreur('')
    try {
      const [s, v] = await Promise.all([
        // Liste explicite, jamais '*' : la base refuse les trois colonnes
        // secrètes à un utilisateur connecté, et '*' échouerait en entier.
        // Webhook seulement : aucune feuille Google n'existe (vérifié le
        // 20/10) et rien ne les lit plus (sync-sheets n'est pas déployé).
        supabase.from('sources_import')
          .select('id, nom, actif, vendeur_id, token_apercu, created_at')
          .eq('tenant_id', tenantId).eq('type', 'webhook')
          .order('created_at', { ascending: true }),
        peutGererTout
          ? supabase.from('user_roles').select('user_id, nom, email')
              .eq('tenant_id', tenantId).eq('role', 'seller')
          : Promise.resolve({ data: [], error: null }),
      ])
      if (s.error) throw new Error(s.error.message)
      const liste = s.data || []
      setSources(liste)
      setSellers(v.data || [])
      setSourceId((avant) => (liste.some((x) => x.id === avant) ? avant : liste[0]?.id ?? null))
    } catch (e) {
      setErreur(e?.message || 'Erreur de chargement')
    } finally {
      setChargement(false)
    }
  }, [tenantId, peutGererTout])

  useEffect(() => { charger() }, [charger])

  const chargerIdentifiants = useCallback(async (id) => {
    setIdentifiants(null)
    setIdentifiantsRefuses(false)
    if (!id) return
    // Sans droit de gestion, on ne demande même pas : la base refuserait.
    if (!peutGerer) { setIdentifiantsRefuses(true); return }
    const { data, error } = await supabase.rpc('identifiants_source', { p_source: id })
    if (error) { setIdentifiantsRefuses(true); return }
    setIdentifiants(data?.[0] ?? null)
  }, [peutGerer])

  // Changer de source remasque tout.
  useEffect(() => {
    setSecretUrl(null)
    setDemandeMdp(false)
    setMotDePasse('')
    setErreurMdp('')
    chargerIdentifiants(sourceId)
  }, [sourceId, chargerIdentifiants])

  const source = sources.find((x) => x.id === sourceId) || null

  const nomVendeur = (id) => {
    const v = sellers.find((x) => x.user_id === id)
    return v ? (v.nom || v.email) : null
  }

  async function copier(texte, quoi) {
    try {
      await navigator.clipboard.writeText(texte)
      setCopie(quoi)
      setTimeout(() => setCopie(''), 2000)
    } catch {
      annonce('Copie impossible : sélectionnez le texte et copiez-le à la main.', 'erreur')
    }
  }

  // --- créer ------------------------------------------------------------------
  // Jamais au chargement de la page : n'importe qui l'ouvre (manager, ceo,
  // responsable d'une autre entreprise), et une page qui crée des lignes en
  // étant regardée crée des déchets. Un bouton, un clic.
  async function creerMonApi() {
    setEnCours(true)
    const { data, error } = await supabase.rpc('creer_source_api', {
      p_tenant: tenantId, p_nom: 'Ma boutique', p_type: 'webhook',
      p_vendeur: user?.id, p_secret_requis: true,
    })
    setEnCours(false)
    if (error) return annonce('Création refusée : ' + error.message, 'erreur')
    await charger()
    if (data?.[0]?.id) setSourceId(data[0].id)
  }

  async function creerSource() {
    if (!nouvelle?.nom.trim()) return annonce('Donnez un nom à la source.', 'erreur')
    setEnCours(true)
    const { data, error } = await supabase.rpc('creer_source_api', {
      p_tenant: tenantId, p_nom: nouvelle.nom.trim(), p_type: 'webhook',
      p_vendeur: nouvelle.vendeur_id || null, p_secret_requis: true,
    })
    setEnCours(false)
    if (error) return annonce('Création refusée : ' + error.message, 'erreur')
    setNouvelle(null)
    annonce(`« ${data?.[0]?.nom ?? 'La source'} » est créée.`)
    await charger()
    if (data?.[0]?.id) setSourceId(data[0].id)
  }

  // --- couper, supprimer -------------------------------------------------------
  // Couper est LA coupure en un clic sur laquelle repose le choix d'une clé
  // lisible (identifiants_api.sql §1) : elle reste.
  async function basculerActif(s) {
    const { error } = await supabase.from('sources_import')
      .update({ actif: !s.actif }).eq('id', s.id).eq('tenant_id', tenantId)
    if (error) return annonce('Erreur : ' + error.message, 'erreur')
    annonce(s.actif ? `« ${s.nom} » est coupée : plus rien n'entre par elle.` : `« ${s.nom} » est réactivée.`)
    await charger()
  }

  async function supprimer(s) {
    if (!confirm(
      `Supprimer « ${s.nom} » ?\n\n` +
      'Les commandes déjà entrées par cette source sont conservées ; elles ' +
      'perdront seulement le lien vers elle. Pour arrêter une source sans rien ' +
      'perdre, préférez « Couper ».'
    )) return
    const { error } = await supabase.from('sources_import')
      .delete().eq('id', s.id).eq('tenant_id', tenantId)
    if (error) return annonce('Erreur : ' + error.message, 'erreur')
    annonce('Source supprimée.')
    await charger()
  }

  // --- le secret, derrière le mot de passe ----------------------------------
  // Vérifié PAR LA BASE (reveler_secret_url), jamais ici par
  // signInWithPassword : celui-ci ouvrirait une nouvelle session au passage,
  // et un échec ressemblerait à un problème de connexion.
  function demanderMotDePasse() {
    setDemandeMdp(true)
    setMotDePasse('')
    setErreurMdp('')
  }

  async function revelerSecretUrl() {
    if (!source) return
    setErreurMdp('')
    const { data, error } = await supabase.rpc('reveler_secret_url', { p_source: source.id, p_mot_de_passe: motDePasse })
    setMotDePasse('')
    if (error) return setErreurMdp('Erreur : ' + error.message)
    const r = data?.[0]
    if (r?.ok) {
      setSecretUrl(r.secret)
      setDemandeMdp(false)
    } else if (r?.reessayer_dans > 0) {
      setErreurMdp(`Trop d'essais. Réessayez dans ${r.reessayer_dans} s.`)
    } else {
      // Rien de plus : la base donne la même réponse pour « mauvais mot de
      // passe » et « source qu'on ne gère pas ».
      setErreurMdp('Mot de passe incorrect.')
    }
  }

  async function regenererIdentifiants() {
    if (!source || !confirm(
      `Régénérer la clé et le secret API de « ${source.nom} » ?\n\n` +
      'L\'URL actuelle cesse de fonctionner aussitôt : votre boutique n\'enverra ' +
      'plus rien tant que la nouvelle URL n\'y est pas collée.'
    )) return
    const { error } = await supabase.rpc('regenerer_identifiants_source', { p_source: source.id })
    if (error) return annonce('Erreur : ' + error.message, 'erreur')
    annonce('Nouveaux identifiants. Collez la nouvelle URL dans votre boutique.')
    setSecretUrl(null)
    await chargerIdentifiants(source.id)
  }

  // Le mot de passe, dans la carte même (pas de fenêtre).
  const formulaireMotDePasse = () => (
    <form className="border-t border-dashed border-[#C9C1B1] pt-2.5 flex gap-2 flex-wrap items-center"
      onSubmit={(e) => { e.preventDefault(); revelerSecretUrl() }}>
      <label className={LABEL} htmlFor="mdp">Mot de passe</label>
      <input id="mdp" type="password" autoComplete="current-password" autoFocus
        className={`${INPUT} flex-[1_1_180px] min-w-0`} placeholder="Votre mot de passe"
        value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
      <button type="submit" className={BTN_PLEIN} disabled={!motDePasse}>Afficher</button>
      <button type="button" className={BTN} onClick={() => { setDemandeMdp(false); setErreurMdp('') }}>Annuler</button>
      {erreurMdp && <span className="w-full text-xs font-semibold text-[#A35139]">{erreurMdp}</span>}
    </form>
  )

  if (authLoading || permsLoading || !hasPermission('menu_sources_import')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès...</div>
  }

  // L'URL, en morceaux pour teinter la clé et le secret.
  const etiquetteUrl = etiquette.trim()
  const cle = identifiants?.cle
  const urlComplete = cle && secretUrl
    ? `${URL_FONCTION}?key=${cle}&secret=${secretUrl}${etiquetteUrl ? '&source=' + encodeURIComponent(etiquetteUrl) : ''}`
    : null
  const plusieurs = sources.length > 1

  return (
    <div className="flex flex-col gap-5 w-full max-w-[980px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-14">

      <header>
        <p className="text-[11px] font-mono font-medium text-[#A35139] uppercase tracking-[.14em] mb-1">
          Entrée des leads
        </p>
        <h1 className="text-3xl font-bold text-[#1B2632]">Mon API</h1>
        <p className="mt-1.5 max-w-[62ch] text-sm text-[#1B2632]/60">
          Branchez votre boutique ou votre formulaire. Les leads arrivent directement dans
          le centre d&apos;appel, à votre nom.
        </p>
      </header>

      {message.texte && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${
          message.type === 'erreur'
            ? 'bg-[#A35139]/10 border-[#A35139]/30 text-[#A35139]'
            : 'bg-[#2E7D53]/10 border-[#2E7D53]/30 text-[#2E7D53]'
        }`}>
          {message.texte}
        </div>
      )}
      {erreur && (
        <div className="px-4 py-3 rounded-xl bg-[#A35139]/10 border border-[#A35139]/30 text-sm text-[#A35139] font-medium">
          {erreur}
        </div>
      )}

      {/* Plusieurs sources, ou un responsable : une source à la fois. */}
      {(plusieurs || peutGererTout) && !chargement && (
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 0 && (
            <>
              <label className={LABEL} htmlFor="choix-source">Source</label>
              <select id="choix-source" className={`${INPUT} min-w-[220px]`} value={sourceId ?? ''}
                onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                    {peutGererTout ? ` — ${nomVendeur(s.vendeur_id) || 'sans vendeur'}` : ''}
                    {s.actif ? '' : ' (coupée)'}
                  </option>
                ))}
              </select>
            </>
          )}
          {peutGererTout && source && (
            <button className={BTN_DANGER} onClick={() => supprimer(source)}>Supprimer</button>
          )}
          {peutGererTout && (nouvelle ? (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
              <input className={`${INPUT} w-44`} placeholder="Nom de la source" autoFocus
                value={nouvelle.nom} onChange={(e) => setNouvelle({ ...nouvelle, nom: e.target.value })} />
              <select className={INPUT} value={nouvelle.vendeur_id}
                onChange={(e) => setNouvelle({ ...nouvelle, vendeur_id: e.target.value })}>
                <option value="">Sans vendeur</option>
                {sellers.map((v) => <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>)}
              </select>
              <button className={BTN_PLEIN} onClick={creerSource} disabled={enCours}>Créer</button>
              <button className={BTN} onClick={() => setNouvelle(null)}>Annuler</button>
            </div>
          ) : (
            <button className={`${BTN} sm:ml-auto`} onClick={() => setNouvelle({ nom: '', vendeur_id: '' })}>
              + Nouvelle source
            </button>
          ))}
        </div>
      )}

      {chargement ? (
        <div className={`${CARTE} px-5 py-10 text-center text-sm text-[#1B2632]/60`}>Chargement...</div>
      ) : !source ? (
        // Pas de source : un vendeur a UN bouton ; sinon, une ligne.
        <section className={CARTE}>
          <TeteCarte titre="Identifiants API" />
          <div className="px-5 pb-5 flex flex-col gap-3 items-start">
            {peutGererSiennes && !peutGererTout ? (
              <>
                <p className="text-sm text-[#1B2632]/70">
                  Vous n&apos;avez pas encore d&apos;API. Créez-la : votre clé et votre secret
                  s&apos;affichent aussitôt ici.
                </p>
                <button className={BTN_PLEIN} onClick={creerMonApi} disabled={enCours}>
                  {enCours ? 'Création...' : 'Créer mon API'}
                </button>
              </>
            ) : peutGererTout ? (
              <p className="text-sm text-[#1B2632]/70">Aucune source. « + Nouvelle source » pour en créer une.</p>
            ) : (
              <p className="text-sm text-[#1B2632]/70">Aucune source pour l&apos;instant.</p>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* 1. Identifiants API */}
          <section className={CARTE}>
            <TeteCarte titre={<>Identifiants API {!source.actif && <span className="ml-2 align-middle"><Pastille couleur={BRIQUE}>Coupée</Pastille></span>}</>}>
              Ces deux valeurs authentifient vos requêtes. Elles ne changent pas tant que
              vous ne les régénérez pas.
            </TeteCarte>

            {identifiantsRefuses ? (
              <div className="px-5 pb-5">
                <p className="text-sm text-[#1B2632]/70">
                  Les identifiants ne sont visibles que par qui gère cette source.
                </p>
              </div>
            ) : !identifiants ? (
              <div className="px-5 pb-5"><p className={AIDE}>Chargement...</p></div>
            ) : (
              <>
                <div className="px-5 pb-5 flex flex-col gap-3.5">
                  <div className={IDENT}>
                    <span className={LABEL}>Clé API</span>
                    {cle ? (
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={VALEUR}>{cle}</span>
                        <button className={BTN} onClick={() => copier(cle, 'cle')}>
                          {copie === 'cle' ? 'Copié ✓' : 'Copier'}
                        </button>
                      </div>
                    ) : (
                      <p className="text-[13px] text-[#A35139]">
                        Cette clé a été créée avant l&apos;affichage des identifiants (••••{source.token_apercu}) :
                        « Régénérer les identifiants » en crée une affichable.
                      </p>
                    )}
                  </div>

                  <div className={IDENT}>
                    <span className={LABEL}>Secret API</span>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {secretUrl ? (
                        <>
                          <span className={VALEUR}>{secretUrl}</span>
                          <button className={BTN} onClick={() => copier(secretUrl, 'secret')}>
                            {copie === 'secret' ? 'Copié ✓' : 'Copier'}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={MASQUE}>••••••••••••••••••••••••••••••••</span>
                          {identifiants.secret_url_existe && !demandeMdp && (
                            <button className={BTN} onClick={demanderMotDePasse}>Révéler</button>
                          )}
                        </>
                      )}
                    </div>
                    <p className={AIDE}>
                      {secretUrl
                        ? 'Affiché. Il se remasque au rechargement de la page.'
                        : 'Masqué. Votre mot de passe est demandé pour l’afficher.'}
                    </p>
                    {demandeMdp && formulaireMotDePasse()}
                  </div>
                </div>

                {peutGerer && (
                  <div className="border-t border-[#C9C1B1]/55 bg-[#F4F0E6] px-5 py-3.5 flex flex-wrap items-center gap-3 justify-between">
                    <p className={`${AIDE} flex-[1_1_320px] min-w-0`}>
                      Régénérer remplace la clé <em>et</em> le secret. L&apos;ancienne paire cesse de
                      fonctionner aussitôt : votre boutique n&apos;enverra plus rien jusqu&apos;à ce que
                      la nouvelle URL y soit collée. Couper arrête la source sans rien changer.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button className={BTN} onClick={() => basculerActif(source)}>
                        {source.actif ? 'Couper' : 'Réactiver'}
                      </button>
                      <button className={BTN_DANGER} onClick={regenererIdentifiants}>Régénérer les identifiants</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* 2. L'URL — clé et secret teintés, pour les voir d'un coup d'œil */}
          {identifiants && cle && (
            <section className="bg-[#1B2632] text-white rounded-2xl px-5 py-[18px] flex flex-col gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[.06em] text-white/50">
                URL à coller dans votre boutique
              </span>
              <code className="font-mono text-[12.5px] break-all leading-relaxed">
                POST {URL_FONCTION}?<span className="text-[#9FD3B4]">key={cle}</span>&amp;<span className="text-[#F0B27A]">secret={secretUrl ?? '••••••••'}</span>
                {etiquetteUrl && <>&amp;source={encodeURIComponent(etiquetteUrl)}</>}
              </code>
              <div className="flex items-center gap-2.5 flex-wrap">
                <button className={BTN_CLAIR} disabled={!urlComplete} onClick={() => copier(urlComplete, 'url')}>
                  {copie === 'url' ? 'Copié ✓' : 'Copier l’URL complète'}
                </button>
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <code className="font-mono bg-white/10 rounded px-1.5 py-px text-white">source</code> =
                  <input className="bg-white/10 border border-white/15 rounded-lg px-2 py-1 text-xs text-white w-36 outline-none focus:border-white/40"
                    value={etiquette} onChange={(e) => setEtiquette(e.target.value)} placeholder="WooCommerce" />
                </label>
                <span className="text-xs text-white/50">l&apos;étiquette affichée sur vos commandes. Changez-la librement.</span>
              </div>
              {!secretUrl && (
                <p className="text-xs text-white/50">Révélez le secret API ci-dessus pour copier l&apos;URL complète.</p>
              )}
              <p className="text-xs text-white/50">
                Cette URL contient vos deux identifiants : ne la publiez nulle part et ne
                l&apos;envoyez pas par message.
              </p>
            </section>
          )}
        </>
      )}

      {/* 3. Brancher votre boutique */}
      <section className={CARTE}>
        <TeteCarte titre="Brancher votre boutique">
          Choisissez votre plateforme. L&apos;ordre des étapes est celui des écrans.
        </TeteCarte>
        <div className="px-5 pb-5 flex flex-col gap-3.5">
          <div className="flex gap-1.5 bg-[#F4F0E6] p-1 rounded-xl border border-[#C9C1B1]/60 w-fit max-w-full flex-wrap" role="tablist">
            {[['woo', 'WooCommerce'], ['shopify', 'Shopify'], ['direct', 'API directe']].map(([cleOnglet, nom]) => (
              <button key={cleOnglet} role="tab" aria-selected={onglet === cleOnglet} onClick={() => setOnglet(cleOnglet)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  onglet === cleOnglet ? 'bg-[#1B2632] text-white shadow-sm' : 'text-[#1B2632]/70 hover:text-[#1B2632]'
                }`}>
                {nom}
              </button>
            ))}
          </div>

          {onglet === 'woo' && (
            <Etapes items={[
              <><strong>WooCommerce → Réglages → Avancé → Webhooks</strong>, puis « Ajouter un webhook ».</>,
              <><strong>Nom</strong> : ce que vous voulez, par exemple <code className={CODE}>CRM FGMED</code>.</>,
              <><strong>État</strong> : <code className={CODE}>Actif</code>.</>,
              <><strong>Sujet</strong> : <code className={CODE}>Commande créée</code>. Chaque nouvelle commande
                nous arrive alors dans la seconde.</>,
              <><strong>URL de livraison</strong> : collez l&apos;URL complète ci-dessus, avec <code className={CODE}>key</code> et{' '}
                <code className={CODE}>secret</code>.</>,
              <><strong>Version de l&apos;API</strong> : <code className={CODE}>WP REST API Integration v3</code>.
                Enregistrez, puis passez une commande de test : elle doit apparaître dans le centre d&apos;appel.</>,
            ]} />
          )}

          {onglet === 'shopify' && (
            <Etapes items={[
              <><strong>Paramètres → Notifications → Webhooks</strong>, « Créer un webhook ».</>,
              <><strong>Événement</strong> : <code className={CODE}>Création de commande</code>, format{' '}
                <code className={CODE}>JSON</code>.</>,
              <><strong>URL</strong> : collez l&apos;URL complète ci-dessus (mettez <code className={CODE}>Shopify</code> comme
                étiquette <code className={CODE}>source</code> si vous voulez les distinguer).</>,
              <>Enregistrez, puis passez une commande de test : elle doit apparaître dans le centre
                d&apos;appel.</>,
            ]} />
          )}

          {onglet === 'direct' && (
            <div className="flex flex-col gap-2.5">
              <p className={AIDE}>Pour un formulaire, Zapier, Make ou un script. Un seul niveau de champs,
                en français ou en anglais.</p>
              <pre className="bg-[#F4F0E6] border border-[#C9C1B1] rounded-xl p-3.5 overflow-x-auto font-mono text-xs leading-relaxed text-[#1B2632]">
{`curl -X POST \\
  '${URL_FONCTION}?key=<clé>&secret=<secret>' \\
  -H 'content-type: application/json' \\
  -d '{
    "nom": "Ana Domingos",
    "telephone": "+244923111001",
    "pays": "Angola",
    "ville": "Luanda",
    "adresse": "Rua das Mangueiras 12",
    "produit": "Colontea",
    "quantite": 2,
    "prix": 15000
  }'`}
              </pre>
              <p className={AIDE}>Clé et secret peuvent aussi passer en en-têtes :{' '}
                <code className={CODE}>x-import-token</code> et <code className={CODE}>x-api-secret</code>.</p>
              <p className={AIDE}>Jusqu&apos;à 200 leads en un appel : envoyez{' '}
                <code className={CODE}>{'{"leads": [ … ]}'}</code>. Pratique pour rattraper un retard.</p>
            </div>
          )}
        </div>
      </section>

      {/* 4. Champs reconnus */}
      <section className={CARTE}>
        <TeteCarte titre="Champs reconnus">
          Les formats WooCommerce et Shopify sont lus automatiquement : vous n&apos;avez rien à
          mapper. Ce tableau sert aux envois manuels.
        </TeteCarte>
        <div className="overflow-x-auto border-t border-[#C9C1B1]/55">
          <table className="w-full min-w-[520px] text-left border-collapse">
            <thead>
              <tr className="bg-[#C9D3DD] text-[10.5px] uppercase tracking-[.07em] text-[#1B2632]/70 font-bold">
                <th className="px-4 py-2.5">Champ</th><th className="px-4 py-2.5">Autres noms acceptés</th><th className="px-4 py-2.5">Obligatoire</th>
              </tr>
            </thead>
            <tbody>
              {CHAMPS.map((c, i) => (
                <tr key={c.champ} className={i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'}>
                  <td className="px-4 py-2.5 text-[13px] align-top"><code className={CODE}>{c.champ}</code></td>
                  <td className="px-4 py-2.5 text-[13px] align-top">
                    {c.autres.map((a, j) => (
                      <Fragment key={a}>{j > 0 && ', '}<code className={CODE}>{a}</code></Fragment>
                    ))}
                    {c.note && <span className="text-[#1B2632]/55"> ({c.note})</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-[13px] align-top ${c.obligatoire === 'oui' ? 'font-semibold' : 'text-[#1B2632]/70'}`}>
                    {c.obligatoire}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Réponses */}
      <section className={CARTE}>
        <TeteCarte titre="Réponses">
          Une commande déjà reçue renvoie <code className={CODE}>200</code> et non une erreur : c&apos;est ce qui
          empêche WooCommerce de renvoyer la même commande indéfiniment.
        </TeteCarte>
        <div className="overflow-x-auto border-t border-[#C9C1B1]/55">
          <table className="w-full min-w-[520px] text-left border-collapse">
            <thead>
              <tr className="bg-[#C9D3DD] text-[10.5px] uppercase tracking-[.07em] text-[#1B2632]/70 font-bold">
                <th className="px-4 py-2.5">Code</th><th className="px-4 py-2.5">Corps</th><th className="px-4 py-2.5">Ce que ça veut dire</th>
              </tr>
            </thead>
            <tbody>
              {REPONSES.map((r, i) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'}>
                  <td className="px-4 py-2.5 align-top"><Pastille couleur={r.couleur}>{r.code}</Pastille></td>
                  <td className="px-4 py-2.5 text-[13px] align-top">{r.corps === '—' ? '—' : <code className={CODE}>{r.corps}</code>}</td>
                  <td className="px-4 py-2.5 text-[13px] align-top">{r.sens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}
