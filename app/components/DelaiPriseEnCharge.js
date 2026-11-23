'use client'

// Délai de PREMIÈRE PRISE EN CHARGE ENREGISTRÉE (02/11) — Performances et Dashboard.
//
// Tout est calculé par la base (delai_prise_en_charge.sql) : ici on affiche.
// Ce n'est PAS « le premier appel » : un agent qui ouvre le panneau et le
// referme sans enregistrer ne laisse aucune trace. Deux chiffres, et le
// premier est celui qu'on lit : combien attendent ENCORE, et depuis quand.
// Une moyenne seule mentirait (40 leads pris en 15 min, 60 qui dorment depuis
// trois jours : « 15 min »).
//
// Responsables seulement (manager, admin, ceo, super_admin) : la base refuse
// tout le monde d'autre, et les pages ne demandent rien pour les autres.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
// Ce que les chiffres veulent dire, en une phrase chacun (mêmes chiffres que le détail).
import { phrasesDelai, phraseAttenteCourte } from '../../lib/phrasesDelai.mjs'
import Link from 'next/link'

export const ROLES_DELAI = ['manager', 'admin', 'ceo', 'super_admin']

export function voitLeDelai(roleNom) {
  return ROLES_DELAI.includes(String(roleNom || '').toLowerCase())
}

// 9.5 → « 10 min » ; 125 → « 2 h 05 » ; 20160 → « 14 j »
export function formatDuree(minutes) {
  if (minutes == null) return '—'
  const m = Math.round(Number(minutes))
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
  const j = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return h ? `${j} j ${h} h` : `${j} j`
}

const TRANCHES = [
  { cle: 'moins_15_min', nom: '< 15 min', couleur: '#2C3B4D' },
  { cle: 'de_15_min_a_1_h', nom: '15 min – 1 h', couleur: '#7A8B99' },
  { cle: 'de_1_h_a_3_h', nom: '1 h – 3 h', couleur: '#FFB162' },
  { cle: 'plus_3_h', nom: '> 3 h', couleur: '#A35139' },
]

export function useDelaiPriseEnCharge(tenantId, debut, fin, actif) {
  const [etat, setEtat] = useState({ chargement: true, donnees: null, erreur: '' })
  useEffect(() => {
    if (!actif || !tenantId || !debut || !fin) return
    let fini = false
    setEtat((e) => ({ ...e, chargement: true }))
    supabase.rpc('delai_prise_en_charge', { p_tenant: tenantId, p_debut: debut, p_fin: fin })
      .then(({ data, error }) => {
        if (fini) return
        setEtat(error
          ? { chargement: false, donnees: null, erreur: error.message }
          : { chargement: false, donnees: data, erreur: '' })
      })
    return () => { fini = true }
  }, [tenantId, debut, fin, actif])
  return etat
}

// Les quatre tranches, une ligne chacune (23/11) : couleur, nom, nombre et
// part du total, alignés comme un petit tableau — avant, une légende tassée en
// police machine à écrire.
function Tranches({ resume }) {
  const total = resume?.n || 0
  return (
    <div className="flex flex-col gap-2.5" data-tranches>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-[#EEE9DF]">
        {total > 0 && TRANCHES.map((t) => (
          <div key={t.cle} style={{ width: `${(resume.tranches[t.cle] / total) * 100}%`, backgroundColor: t.couleur }} />
        ))}
      </div>
      <div className="flex flex-col divide-y divide-[#C9C1B1]/30">
        {TRANCHES.map((t) => {
          const n = Number(resume?.tranches?.[t.cle] ?? 0)
          return (
            <div key={t.cle} className="flex items-center gap-2.5 py-1.5 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.couleur }} />
              <span className="text-[#1B2632]/70 flex-1">{t.nom}</span>
              <span className="font-semibold text-[#1B2632] tabular-nums w-10 text-right">{n}</span>
              <span className="text-xs text-[#1B2632]/45 tabular-nums w-12 text-right">{total > 0 ? `${Math.round((100 * n) / total)} %` : '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Un chiffre et son nom, en carte (23/11).
function Chiffre({ valeur, nom, alerte }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-2xl font-bold tabular-nums ${alerte ? 'text-[#A35139]' : 'text-[#1B2632]'}`}>{valeur}</span>
      <span className="text-xs text-[#1B2632]/55">{nom}</span>
    </div>
  )
}

function BlocAttente({ resume }) {
  const n = resume?.n ?? 0
  return (
    <div className="flex flex-col gap-4 p-5 rounded-xl border border-[#C9C1B1] bg-white" data-bloc-attente>
      <div>
        <h3 className="text-sm font-bold text-[#1B2632]">En attente maintenant</h3>
        <p className="text-xs text-[#1B2632]/55 mt-0.5">Leads jamais pris en charge, à l&apos;instant présent (la période ne change rien ici).</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Chiffre valeur={n} nom={`lead${n > 1 ? 's' : ''} en attente`} alerte={n > 0} />
        <Chiffre valeur={n ? formatDuree(resume.max_min) : '—'} nom="le plus ancien attend" />
        <Chiffre valeur={n ? formatDuree(resume.mediane_min) : '—'} nom="attente médiane" />
      </div>
      <Tranches resume={resume} />
    </div>
  )
}

function BlocPris({ resume, fermes }) {
  const n = resume?.n ?? 0
  return (
    <div className="flex flex-col gap-4 p-5 rounded-xl border border-[#C9C1B1] bg-white" data-bloc-pris>
      <div>
        <h3 className="text-sm font-bold text-[#1B2632]">Pris en charge sur la période</h3>
        <p className="text-xs text-[#1B2632]/55 mt-0.5">Leads entrés dans la file pendant la période, et appelés depuis.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Chiffre valeur={n} nom={`lead${n > 1 ? 's' : ''} pris en charge`} />
        <Chiffre valeur={formatDuree(resume?.mediane_min)} nom="délai médian" />
        <Chiffre valeur={formatDuree(resume?.moyenne_min)} nom="délai moyen" />
      </div>
      <Tranches resume={resume} />
      {fermes > 0 && (
        <p className="text-xs text-[#1B2632]/55">{fermes} lead{fermes > 1 ? 's' : ''} fermé{fermes > 1 ? 's' : ''} sans appel enregistré (statut corrigé à la main) : pas comptés.</p>
      )}
    </div>
  )
}

// Le constat, au-dessus du détail : ce que le lecteur retient.
function Constat({ donnees }) {
  const [attente, pris] = phrasesDelai(donnees)
  return (
    <div className="flex flex-col gap-1.5" data-constat>
      <p className="text-base font-semibold text-[#A35139]">{attente}</p>
      <p className="text-base font-semibold text-[#1B2632]">{pris}</p>
    </div>
  )
}

const EXPLICATION = "Du moment où le lead entre dans la file (ou y revient : remonté, renvoyé en attente) au début du premier appel enregistré. Un panneau ouvert puis refermé sans enregistrer ne laisse pas de trace ; une action en masse et une correction depuis Commandes ne comptent pas."

// Performances : l'entreprise, puis chaque agent.
export function SectionDelai({ tenantId, debut, fin, roleNom }) {
  const actif = voitLeDelai(roleNom)
  // Médiane, moyenne, tranches : derrière « Détails », fermé (02/11) — le lecteur lit les deux phrases.
  const [details, setDetails] = useState(false)
  const { chargement, donnees, erreur } = useDelaiPriseEnCharge(tenantId, debut, fin, actif)
  if (!actif) return null
  return (
    <section className="bg-white border border-[#C9C1B1] rounded-2xl shadow-sm overflow-hidden flex flex-col" data-section-delai>
      <div className="p-6 border-b border-[#C9C1B1]/50 bg-[#EEE9DF]/20 flex flex-col gap-3">
        <h2 className="text-lg font-bold text-[#1B2632]">Délai de première prise en charge enregistrée</h2>
        {donnees && !erreur && !chargement && <Constat donnees={donnees} />}
      </div>
      {erreur ? (
        <p className="p-6 text-sm text-[#A35139]">Délai indisponible : {erreur}</p>
      ) : chargement || !donnees ? (
        <p className="p-6 text-sm text-[#1B2632]/60">Calcul en cours...</p>
      ) : (
        <>
          {/* Le tableau par agent, refait le 23/11 pour se lire comme celui des
              agents : noms de colonnes clairs, l'attente en pastille, la médiane
              toujours visible, et les quatre tranches en une petite barre de
              couleur (survol = le détail) au lieu de quatre colonnes de chiffres. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-[#C9C1B1]/50 text-xs uppercase text-[#1B2632]/60 font-semibold">
                  <th className="p-4">Agent</th>
                  <th className="p-4">En attente maintenant</th>
                  <th className="p-4 text-right">Pris en charge</th>
                  <th className="p-4 text-right">Délai médian</th>
                  {details && <th className="p-4 text-right">Délai moyen</th>}
                  <th className="p-4 w-[220px]">Rapidité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/30">
                {donnees.par_agent.map((a) => {
                  const tr = a.pris_en_charge.tranches || {}
                  const total = TRANCHES.reduce((n, t) => n + Number(tr[t.cle] || 0), 0)
                  return (
                    <tr key={a.cle} className={`hover:bg-[#EEE9DF]/20 transition ${a.cle === 'sans' ? 'bg-[#A35139]/[0.03]' : ''}`}>
                      <td className="p-4 font-medium text-[#1B2632]">{a.agent}</td>
                      <td className="p-4">
                        {a.en_attente.n > 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#A35139]/12 text-[#A35139] border border-[#A35139]/30 tabular-nums">
                              {a.en_attente.n} lead{a.en_attente.n > 1 ? 's' : ''}
                            </span>
                            <span className="text-xs text-[#1B2632]/60 whitespace-nowrap">depuis {formatDuree(a.en_attente.max_min)}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[#1B2632]/40">Personne n&apos;attend</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-semibold text-[#1B2632] tabular-nums">{a.pris_en_charge.n}</td>
                      <td className="p-4 text-right font-semibold text-[#1B2632] tabular-nums whitespace-nowrap">{formatDuree(a.pris_en_charge.mediane_min)}</td>
                      {details && <td className="p-4 text-right text-[#1B2632]/75 tabular-nums whitespace-nowrap">{formatDuree(a.pris_en_charge.moyenne_min)}</td>}
                      <td className="p-4">
                        {total > 0 ? (
                          <div title={TRANCHES.map((t) => `${t.nom} : ${tr[t.cle] || 0}`).join(' · ')}>
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-[#EEE9DF]">
                              {TRANCHES.map((t) => Number(tr[t.cle] || 0) > 0 && (
                                <div key={t.cle} style={{ width: `${(100 * Number(tr[t.cle])) / total}%`, backgroundColor: t.couleur }} />
                              ))}
                            </div>
                            <p className="text-[11px] text-[#1B2632]/55 mt-1 tabular-nums">
                              {Math.round((100 * Number(tr.moins_15_min || 0)) / total)} % en moins de 15 min
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-[#1B2632]/40">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-[#C9C1B1]/50 flex flex-wrap items-center justify-between gap-3">
            {/* La légende de la barre « Rapidité » (23/11). */}
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#1B2632]/60 order-2">
              {TRANCHES.map((t) => (
                <span key={t.cle} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.couleur }} />{t.nom}
                </span>
              ))}
            </span>
            <button type="button" onClick={() => setDetails((d) => !d)} aria-expanded={details}
              className="text-xs font-bold text-[#1B2632]/70 hover:text-[#1B2632] cursor-pointer" data-details>
              {details ? '▾ Détails' : '▸ Détails'}
            </button>
          </div>
          {details && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-6 pb-6">
              <BlocAttente resume={donnees.en_attente} />
              <BlocPris resume={donnees.pris_en_charge} fermes={donnees.fermes_sans_prise_en_charge} />
            </div>
          )}
          {/* Les explications vivent dans « Détails » (23/11) : toujours ouvertes,
              elles allongeaient la page pour un lecteur qui les connaît. */}
          {details && (
          <div className="mx-6 mb-6 px-4 py-3 rounded-xl bg-[#F4F0E6] text-xs text-[#1B2632]/70 flex flex-col gap-1.5">
            <p className="font-bold text-[#1B2632]/80">Comment c&apos;est compté</p>
            <p>• « En attente » est compté pour l&apos;agent à qui le lead est affecté ; « Pris en charge » pour celui qui a fait l&apos;appel.</p>
            <p>• {EXPLICATION}</p>
          </div>
          )}
        </>
      )}
    </section>
  )
}

// Dashboard (02/11) : UNE ligne — combien attendent encore — vers Performances,
// où se trouve le reste. Rien d'autre ici.
export function CarteDelai({ tenantId, debut, fin, roleNom }) {
  const actif = voitLeDelai(roleNom)
  const { chargement, donnees, erreur } = useDelaiPriseEnCharge(tenantId, debut, fin, actif)
  if (!actif || chargement || erreur || !donnees) return null
  return (
    <Link href="/performances" className="fg-card block text-base font-semibold text-[#A35139] hover:underline" data-carte-delai>
      {phraseAttenteCourte(donnees.en_attente)}
    </Link>
  )
}
