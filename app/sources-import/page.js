'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../context/PermissionsContext'

// Les portes par lesquelles les leads entrent dans le CRM : une boutique, une
// landing page, une feuille Google. Chacune a SON jeton — couper l'une ne coupe
// pas les autres, et l'entreprise comme le vendeur viennent du jeton, jamais du
// corps de la requête.

const TYPES = [
  { cle: 'webhook', nom: 'Webhook (boutique, formulaire, Zapier)' },
  { cle: 'google_sheet', nom: 'Feuille Google' },
]

const STATUTS_JOURNAL = {
  recu:    { label: 'Reçu',    couleur: '#6B7A8C' },
  importe: { label: 'Importé', couleur: '#2E7D53' },
  doublon: { label: 'Doublon', couleur: '#C98A2B' },
  rejete:  { label: 'Rejeté',  couleur: '#A35139' },
}

const URL_FONCTION = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/import-commande`

// Le jeton est tiré dans le navigateur, et SEULE son empreinte part en base.
// Même en lisant la table, personne ne peut reconstituer un jeton : il n'existe
// qu'une fois, dans la fenêtre qui vient de le créer.
function nouveauJeton() {
  const octets = new Uint8Array(32)
  crypto.getRandomValues(octets)
  return [...octets].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function empreinte(jeton) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const quand = (d) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function SourcesImportPage() {
  const { user, tenantId, loading: authLoading } = useAuth()
  const { hasPermission, loading: permsLoading } = usePermissions()
  const router = useRouter()

  // Deux droits distincts : le responsable gère les sources de toute
  // l'entreprise, le vendeur seulement les siennes. La base applique déjà la
  // règle (RLS) ; l'écran ne fait qu'arrêter de proposer ce qui serait refusé.
  const peutGererTout = hasPermission('gerer_sources_import')
  const peutGererSiennes = hasPermission('gerer_mes_sources')
  const peutGerer = peutGererTout || peutGererSiennes

  const [sources, setSources] = useState([])
  const [sellers, setSellers] = useState([])
  const [journal, setJournal] = useState([])
  const [filtreJournal, setFiltreJournal] = useState('')
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState('')
  const [message, setMessage] = useState({ texte: '', type: '' })

  const [modale, setModale] = useState(false)
  const [brouillon, setBrouillon] = useState({
    nom: '', type: 'webhook', vendeur_id: '', spreadsheet_id: '', onglet: 'Feuille 1',
  })
  const [enregistrement, setEnregistrement] = useState(false)

  // Le jeton fraîchement créé, montré UNE SEULE FOIS.
  const [jetonAffiche, setJetonAffiche] = useState(null)
  const [copie, setCopie] = useState(false)
  const [detailJournal, setDetailJournal] = useState(null)

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
      const [s, v, j] = await Promise.all([
        supabase.from('sources_import').select('*').eq('tenant_id', tenantId)
          .order('created_at', { ascending: false }),
        peutGererTout
          ? supabase.from('user_roles').select('user_id, nom, email')
              .eq('tenant_id', tenantId).eq('role', 'seller')
          : Promise.resolve({ data: [], error: null }),
        supabase.from('imports_bruts')
          .select('id, created_at, statut, motif, cle_externe, payload, source_id')
          .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
      ])
      if (s.error) throw new Error(s.error.message)
      setSources(s.data || [])
      setSellers(v.data || [])
      setJournal(j.data || [])
    } catch (e) {
      setErreur(e?.message || 'Erreur de chargement')
    } finally {
      setChargement(false)
    }
  }, [tenantId, peutGererTout])

  useEffect(() => { charger() }, [charger])

  const nomVendeur = (id) => {
    if (!id) return null
    const v = sellers.find((x) => x.user_id === id)
    return v ? (v.nom || v.email) : null
  }
  const nomSource = (id) => sources.find((s) => s.id === id)?.nom || null

  const journalFiltre = useMemo(
    () => (filtreJournal ? journal.filter((j) => j.statut === filtreJournal) : journal),
    [journal, filtreJournal],
  )

  const compteurs = useMemo(() => {
    const c = { recu: 0, importe: 0, doublon: 0, rejete: 0 }
    for (const j of journal) if (c[j.statut] !== undefined) c[j.statut]++
    return c
  }, [journal])

  function ouvrirCreation() {
    setBrouillon({ nom: '', type: 'webhook', vendeur_id: '', spreadsheet_id: '', onglet: 'Feuille 1' })
    setModale(true)
  }

  async function creerSource() {
    if (!brouillon.nom.trim()) return annonce('Donnez un nom à la source.', 'erreur')
    if (brouillon.type === 'google_sheet' && !brouillon.spreadsheet_id.trim()) {
      return annonce('L\'identifiant de la feuille est obligatoire.', 'erreur')
    }

    setEnregistrement(true)
    const jeton = nouveauJeton()
    const { data, error } = await supabase.from('sources_import').insert([{
      tenant_id: tenantId,
      nom: brouillon.nom.trim(),
      type: brouillon.type,
      // Un vendeur ne choisit pas : la source est à lui, point. La policy
      // `with check` refuserait de toute façon toute autre valeur.
      vendeur_id: peutGererTout ? (brouillon.vendeur_id || null) : user?.id,
      token_hash: await empreinte(jeton),
      token_apercu: jeton.slice(-4),
      spreadsheet_id: brouillon.type === 'google_sheet' ? brouillon.spreadsheet_id.trim() : null,
      onglet: brouillon.type === 'google_sheet' ? (brouillon.onglet.trim() || 'Feuille 1') : null,
      created_by: user?.id || null,
    }]).select().single()
    setEnregistrement(false)

    if (error) return annonce('Enregistrement refusé : ' + error.message, 'erreur')

    setModale(false)
    setJetonAffiche({ jeton, nom: data.nom })
    await charger()
  }

  async function regenererJeton(s) {
    if (!confirm(
      `Remplacer le jeton de « ${s.nom} » ?\n\n` +
      'L\'ancien cessera de fonctionner immédiatement. Tout ce qui l\'utilise ' +
      'encore (boutique, script, Zapier) sera refusé tant que le nouveau jeton ' +
      'n\'y est pas collé.'
    )) return

    const jeton = nouveauJeton()
    const { error } = await supabase.from('sources_import')
      .update({ token_hash: await empreinte(jeton), token_apercu: jeton.slice(-4) })
      .eq('id', s.id).eq('tenant_id', tenantId)
    if (error) return annonce('Erreur : ' + error.message, 'erreur')

    setJetonAffiche({ jeton, nom: s.nom })
    await charger()
  }

  async function basculerActif(s) {
    const { error } = await supabase.from('sources_import')
      .update({ actif: !s.actif }).eq('id', s.id).eq('tenant_id', tenantId)
    if (error) return annonce('Erreur : ' + error.message, 'erreur')
    annonce(s.actif ? `« ${s.nom} » est coupée.` : `« ${s.nom} » est réactivée.`)
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

  async function copier(texte) {
    try {
      await navigator.clipboard.writeText(texte)
      setCopie(true)
      setTimeout(() => setCopie(false), 2500)
    } catch {
      annonce('Copie impossible : sélectionnez le jeton et copiez-le à la main.', 'erreur')
    }
  }

  if (authLoading || permsLoading || !hasPermission('menu_sources_import')) {
    return <div className="p-20 text-center text-sm text-[#1B2632]/60 font-medium">Vérification des accès...</div>
  }

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto pt-4 sm:pt-16 px-4 sm:px-6 pb-10">

      <style>{`
        .si-label { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(27,38,50,.55); margin-bottom:6px; }
        .si-input { width:100%; border:1px solid #C9C1B1; border-radius:10px; padding:9px 11px; font-size:14px; outline:none; background:#fff; color:#1B2632; }
        .si-input:focus { border-color:#1B2632; box-shadow:0 0 0 2px rgba(27,38,50,.05); }
        @keyframes popInSi { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .pop-in-si { animation: popInSi .18s ease-out; }
      `}</style>

      <header className="flex justify-between items-start flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono font-medium text-[#A35139] uppercase tracking-widest mb-1">
            Entrée des leads
          </p>
          <h1 className="text-3xl font-bold text-[#1B2632]">
            {peutGererTout ? 'Sources d\u2019import' : 'Mon intégration'}
          </h1>
          {!peutGererTout && (
            <p className="text-sm text-[#1B2632]/55 mt-1">
              Générez votre jeton et branchez votre boutique ou votre formulaire.
              Les leads arrivent directement dans le centre d&apos;appel.
            </p>
          )}
        </div>
        {peutGerer && (
          <button onClick={ouvrirCreation}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors shadow-sm cursor-pointer">
            <span className="text-lg leading-none">+</span> Nouvelle source
          </button>
        )}
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

      {/* L'adresse à donner aux intégrations. */}
      <div className="bg-[#1B2632] text-white rounded-2xl px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-1.5">
          Adresse à donner aux intégrations
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <code className="font-mono text-sm break-all">POST {URL_FONCTION}</code>
          <button onClick={() => copier(URL_FONCTION)}
            className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors cursor-pointer">
            Copier
          </button>
        </div>
        <p className="text-[11px] text-white/45 mt-2">
          Avec l&apos;en-tête <code className="font-mono">x-import-token: &lt;le jeton de la source&gt;</code>
        </p>
      </div>

      {/* Les sources */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-5">
          <h2 className="text-2xl font-bold text-[#A35139]">Sources</h2>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead>
              <tr className="bg-[#C9D3DD] text-[11px] uppercase tracking-wider text-[#1B2632]/70 font-bold">
                <th className="px-5 py-3.5">Nom</th>
                <th className="px-5 py-3.5">Type</th>
                {peutGererTout && <th className="px-5 py-3.5">Vendeur</th>}
                <th className="px-5 py-3.5">Jeton</th>
                <th className="px-5 py-3.5">État</th>
                <th className="px-5 py-3.5">Dernière activité</th>
                {peutGerer && <th className="px-5 py-3.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {chargement ? (
                <tr><td colSpan={(peutGererTout ? 6 : 5) + (peutGerer ? 1 : 0)} className="px-5 py-12 text-center text-[#1B2632]/60">Chargement...</td></tr>
              ) : sources.length === 0 ? (
                <tr><td colSpan={(peutGererTout ? 6 : 5) + (peutGerer ? 1 : 0)} className="px-5 py-12 text-center text-[#1B2632]/60">
                  Aucune source. Créez-en une pour qu&apos;un vendeur puisse envoyer ses leads.
                </td></tr>
              ) : sources.map((s, i) => (
                <tr key={s.id} className={i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'}>
                  <td className="px-5 py-4">
                    <span className="font-semibold text-[#1B2632]">{s.nom}</span>
                    {s.type === 'google_sheet' && s.spreadsheet_id && (
                      <span className="block text-[11px] font-mono text-[#1B2632]/45 mt-0.5 break-all">
                        {s.spreadsheet_id} · {s.onglet}
                      </span>
                    )}
                    {s.derniere_erreur && (
                      <span className="block text-[11px] text-[#A35139] mt-0.5">{s.derniere_erreur}</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-[#1B2632]/80 whitespace-nowrap">
                    {s.type === 'google_sheet' ? 'Feuille Google' : 'Webhook'}
                  </td>
                  {peutGererTout && (
                    <td className="px-5 py-4 text-sm text-[#1B2632]/80">
                      {nomVendeur(s.vendeur_id) || (
                        <span className="text-[#1B2632]/35">Aucun — visible des responsables seuls</span>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-4 font-mono text-sm text-[#1B2632]/70 whitespace-nowrap">
                    {s.token_apercu ? `••••${s.token_apercu}` : '—'}
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold bg-white"
                      style={{
                        color: s.actif ? '#2E7D53' : '#A35139',
                        border: `1px solid ${s.actif ? '#2E7D5366' : '#A3513966'}`,
                      }}>
                      {s.actif ? 'Active' : 'Coupée'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#1B2632]/70 whitespace-nowrap">
                    {quand(s.derniere_sync || s.created_at)}
                  </td>
                  {peutGerer && (
                    <td className="px-5 py-4">
                      <div className="flex gap-2 justify-end flex-wrap">
                        <button onClick={() => basculerActif(s)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#C9C1B1] bg-white text-[#1B2632] hover:bg-[#EEE9DF]/60 transition-colors cursor-pointer">
                          {s.actif ? 'Couper' : 'Réactiver'}
                        </button>
                        <button onClick={() => regenererJeton(s)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#C9C1B1] bg-white text-[#1B2632] hover:bg-[#EEE9DF]/60 transition-colors cursor-pointer">
                          Nouveau jeton
                        </button>
                        <button onClick={() => supprimer(s)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#A35139]/40 bg-white text-[#A35139] hover:bg-[#A35139]/10 transition-colors cursor-pointer">
                          Supprimer
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Le journal : ce qui est entré, et ce qui a été refusé */}
      <div className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-5 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-[#A35139]">Ce qui est arrivé</h2>
          <div className="flex gap-1.5 bg-[#F4F0E6] p-1 rounded-xl border border-[#C9C1B1]/60">
            <button onClick={() => setFiltreJournal('')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                filtreJournal === '' ? 'bg-[#1B2632] text-white shadow-sm' : 'text-[#1B2632]/70 hover:text-[#1B2632]'
              }`}>
              Tout ({journal.length})
            </button>
            {Object.entries(STATUTS_JOURNAL).map(([cle, s]) => (
              <button key={cle} onClick={() => setFiltreJournal(cle)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  filtreJournal === cle ? 'bg-[#1B2632] text-white shadow-sm' : 'text-[#1B2632]/70 hover:text-[#1B2632]'
                }`}>
                {s.label} ({compteurs[cle]})
              </button>
            ))}
          </div>
          <span className="text-xs text-[#1B2632]/45 ml-auto">100 dernières entrées</span>
        </div>

        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full min-w-[800px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#C9D3DD] text-[11px] uppercase tracking-wider text-[#1B2632]/70 font-bold">
                <th className="px-5 py-3.5">Quand</th>
                <th className="px-5 py-3.5">Source</th>
                <th className="px-5 py-3.5">Clé</th>
                <th className="px-5 py-3.5">Résultat</th>
                <th className="px-5 py-3.5">Détail</th>
              </tr>
            </thead>
            <tbody>
              {journalFiltre.length === 0 ? (
                <tr><td colSpan="5" className="px-5 py-12 text-center text-[#1B2632]/60">
                  Rien à afficher.
                </td></tr>
              ) : journalFiltre.map((j, i) => {
                const st = STATUTS_JOURNAL[j.statut] || { label: j.statut, couleur: '#6B7A8C' }
                return (
                  <tr key={j.id} className={i % 2 === 1 ? 'bg-[#F7F9FB]' : 'bg-white'}>
                    <td className="px-5 py-3.5 text-sm text-[#1B2632]/70 whitespace-nowrap">{quand(j.created_at)}</td>
                    <td className="px-5 py-3.5 text-sm text-[#1B2632]/80">
                      {nomSource(j.source_id) || <span className="text-[#1B2632]/35">—</span>}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#1B2632]/70">{j.cle_externe || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-white whitespace-nowrap"
                        style={{ color: st.couleur, border: `1px solid ${st.couleur}66` }}>
                        {st.label}
                      </span>
                      {j.motif && <span className="block text-[11px] text-[#A35139] mt-1">{j.motif}</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => setDetailJournal(j)}
                        className="text-xs font-semibold text-[#A35139] hover:underline cursor-pointer">
                        Voir la donnée reçue
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nouvelle source */}
      {modale && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setModale(false)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[560px] my-8 pop-in-si">
              <div className="px-7 pt-6 pb-5 border-b border-[#C9C1B1]/50">
                <h2 className="text-xl font-bold text-[#1B2632]">Nouvelle source</h2>
              </div>

              <div className="px-7 py-6 flex flex-col gap-5">
                <div>
                  <label className="si-label">Nom</label>
                  <input className="si-input" value={brouillon.nom}
                    onChange={(e) => setBrouillon({ ...brouillon, nom: e.target.value })}
                    placeholder="Ex : Landing page Karim" />
                </div>

                <div>
                  <label className="si-label">Type</label>
                  <select className="si-input" value={brouillon.type}
                    onChange={(e) => setBrouillon({ ...brouillon, type: e.target.value })}>
                    {TYPES.map((t) => <option key={t.cle} value={t.cle}>{t.nom}</option>)}
                  </select>
                </div>

                {peutGererTout ? (
                  <div>
                    <label className="si-label">Vendeur</label>
                    <select className="si-input" value={brouillon.vendeur_id}
                      onChange={(e) => setBrouillon({ ...brouillon, vendeur_id: e.target.value })}>
                      <option value="">Aucun — les responsables seuls verront ces leads</option>
                      {sellers.map((v) => (
                        <option key={v.user_id} value={v.user_id}>{v.nom || v.email}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[#1B2632]/45 mt-1.5">
                      Tout lead entrant par cette source lui appartiendra, sans que la
                      requête ait à le dire — donc sans qu&apos;elle puisse l&apos;attribuer à un autre.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-[#1B2632]/45 -mt-2">
                    Les leads entrés par cette source vous seront attribués automatiquement.
                  </p>
                )}

                {brouillon.type === 'google_sheet' && (
                  <>
                    <div>
                      <label className="si-label">Identifiant de la feuille</label>
                      <input className="si-input font-mono text-xs" value={brouillon.spreadsheet_id}
                        onChange={(e) => setBrouillon({ ...brouillon, spreadsheet_id: e.target.value })}
                        placeholder="1AbC...xYz" />
                      <p className="text-[11px] text-[#1B2632]/45 mt-1.5">
                        C&apos;est la partie du lien entre <code className="font-mono">/d/</code> et
                        <code className="font-mono"> /edit</code>.
                      </p>
                    </div>
                    <div>
                      <label className="si-label">Onglet</label>
                      <input className="si-input" value={brouillon.onglet}
                        onChange={(e) => setBrouillon({ ...brouillon, onglet: e.target.value })}
                        placeholder="Feuille 1" />
                    </div>
                  </>
                )}
              </div>

              <div className="px-7 py-5 border-t border-[#C9C1B1]/50 flex justify-end gap-3">
                <button onClick={() => setModale(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white text-[#1B2632] border border-[#C9C1B1] hover:bg-[#EEE9DF]/50 transition-colors cursor-pointer">
                  Annuler
                </button>
                <button onClick={creerSource} disabled={enregistrement}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] disabled:opacity-50 transition-colors cursor-pointer">
                  {enregistrement ? 'Création...' : 'Créer et générer le jeton'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Le jeton, montré une seule fois */}
      {jetonAffiche && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/50 backdrop-blur-[2px] z-40" />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[640px] my-8 pop-in-si">
              <div className="px-7 pt-6 pb-4">
                <h2 className="text-xl font-bold text-[#1B2632]">Le jeton de « {jetonAffiche.nom} »</h2>
                <p className="text-sm text-[#A35139] font-semibold mt-1.5">
                  Copiez-le maintenant : il ne sera plus jamais affiché.
                </p>
              </div>

              <div className="px-7 pb-2">
                <div className="bg-[#1B2632] rounded-xl px-4 py-4">
                  <code className="font-mono text-sm text-white break-all select-all">{jetonAffiche.jeton}</code>
                </div>
                <button onClick={() => copier(jetonAffiche.jeton)}
                  className="mt-3 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#A35139] text-white hover:bg-[#8a422d] transition-colors cursor-pointer">
                  {copie ? 'Copié ✓' : 'Copier le jeton'}
                </button>
                <p className="text-[11px] text-[#1B2632]/50 mt-3">
                  Seule son empreinte est enregistrée : même en lisant la base, personne
                  ne peut le retrouver. Perdu, il ne se récupère pas — il faut en générer
                  un nouveau, ce qui invalide l&apos;ancien.
                </p>
              </div>

              <div className="px-7 py-5">
                <p className="si-label">À coller dans l&apos;intégration</p>
                <pre className="bg-[#F4F0E6] border border-[#C9C1B1] rounded-xl p-4 text-[11px] font-mono text-[#1B2632] overflow-x-auto whitespace-pre">
{`POST ${URL_FONCTION}
content-type: application/json
x-import-token: ${jetonAffiche.jeton}

{"nom":"...","telephone":"...","pays":"...",
 "ville":"...","produit":"...","quantite":1}`}
                </pre>
              </div>

              <div className="px-7 py-5 border-t border-[#C9C1B1]/50 flex justify-end">
                <button onClick={() => { setJetonAffiche(null); setCopie(false) }}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white hover:bg-[#2C3B4D] transition-colors cursor-pointer">
                  J&apos;ai copié le jeton
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* La donnée brute d'une ligne du journal */}
      {detailJournal && (
        <>
          <div className="fixed inset-0 bg-[#1B2632]/40 backdrop-blur-[2px] z-40" onClick={() => setDetailJournal(null)} />
          <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
            <div className="bg-white rounded-2xl border border-[#C9C1B1] shadow-2xl w-full max-w-[640px] my-8 pop-in-si">
              <div className="px-7 pt-6 pb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[#1B2632]">Donnée reçue</h2>
                  <p className="text-xs text-[#1B2632]/55 mt-1">
                    {quand(detailJournal.created_at)} · {nomSource(detailJournal.source_id) || 'source inconnue'}
                  </p>
                </div>
                <button onClick={() => setDetailJournal(null)}
                  className="w-9 h-9 rounded-full bg-[#C9C1B1]/50 text-[#1B2632] hover:bg-[#C9C1B1] transition-colors flex items-center justify-center shrink-0 cursor-pointer">
                  ✕
                </button>
              </div>
              {detailJournal.motif && (
                <div className="px-7 pb-3">
                  <p className="px-4 py-3 rounded-xl bg-[#A35139]/10 border border-[#A35139]/30 text-sm text-[#A35139] font-medium">
                    {detailJournal.motif}
                  </p>
                </div>
              )}
              <div className="px-7 pb-7">
                <pre className="bg-[#F4F0E6] border border-[#C9C1B1] rounded-xl p-4 text-xs font-mono text-[#1B2632] overflow-x-auto">
{JSON.stringify(detailJournal.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}