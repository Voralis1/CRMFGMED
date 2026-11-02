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

function Tranches({ resume }) {
  const total = resume?.n || 0
  return (
    <div className="flex flex-col gap-1.5" data-tranches>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-[#EEE9DF]">
        {total > 0 && TRANCHES.map((t) => (
          <div key={t.cle} style={{ width: `${(resume.tranches[t.cle] / total) * 100}%`, backgroundColor: t.couleur }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#1B2632]/70">
        {TRANCHES.map((t) => (
          <span key={t.cle} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.couleur }} />
            {t.nom} : <b className="font-mono text-[#1B2632]">{resume?.tranches?.[t.cle] ?? 0}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function BlocAttente({ resume }) {
  return (
    <div className="flex flex-col gap-3 p-5 rounded-xl border border-[#A35139]/30 bg-[#A35139]/[0.04]" data-bloc-attente>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#A35139]">Encore en attente — maintenant</p>
        <p className="text-[11px] text-[#1B2632]/55 mt-0.5">Toujours à l&apos;instant présent : la période choisie ne change pas ce chiffre.</p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold font-mono text-[#1B2632]">{resume?.n ?? 0}</span>
        <span className="text-sm text-[#1B2632]/70">lead{(resume?.n ?? 0) > 1 ? 's' : ''} jamais pris en charge</span>
      </div>
      {(resume?.n ?? 0) > 0 && (
        <p className="text-sm text-[#1B2632]/75">
          Le plus ancien attend depuis <b>{formatDuree(resume.max_min)}</b> · médiane <b>{formatDuree(resume.mediane_min)}</b>
        </p>
      )}
      <Tranches resume={resume} />
    </div>
  )
}

function BlocPris({ resume, fermes }) {
  return (
    <div className="flex flex-col gap-3 p-5 rounded-xl border border-[#C9C1B1] bg-white" data-bloc-pris>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#1B2632]/70">Pris en charge — sur la période</p>
        <p className="text-[11px] text-[#1B2632]/55 mt-0.5">Leads entrés dans la file pendant la période, et pris en charge depuis.</p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold font-mono text-[#1B2632]">{formatDuree(resume?.mediane_min)}</span>
        <span className="text-sm text-[#1B2632]/70">médiane · moyenne {formatDuree(resume?.moyenne_min)} · {resume?.n ?? 0} lead{(resume?.n ?? 0) > 1 ? 's' : ''}</span>
      </div>
      <Tranches resume={resume} />
      {fermes > 0 && (
        <p className="text-[11px] text-[#1B2632]/55">{fermes} fermé{fermes > 1 ? 's' : ''} sans prise en charge enregistrée (statut corrigé sans appel).</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#EEE9DF]/40 text-[11px] uppercase tracking-wider text-[#1B2632]/60">
                <tr>
                  <th className="px-5 py-3">Agent</th>
                  <th className="px-4 py-3 text-right">En attente</th>
                  <th className="px-4 py-3 text-right">Plus ancien</th>
                  <th className="px-4 py-3 text-right">Pris en charge</th>
                  {details && <th className="px-4 py-3 text-right">Médiane</th>}
                  {details && <th className="px-4 py-3 text-right">Moyenne</th>}
                  {details && TRANCHES.map((t) => <th key={t.cle} className="px-3 py-3 text-right">{t.nom}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9C1B1]/40">
                {donnees.par_agent.map((a) => (
                  <tr key={a.cle} className={a.cle === 'sans' ? 'bg-[#A35139]/[0.03]' : ''}>
                    <td className="px-5 py-3 font-semibold text-[#1B2632]">{a.agent}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-[#A35139]">{a.en_attente.n}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#1B2632]/75">{a.en_attente.n ? formatDuree(a.en_attente.max_min) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-[#1B2632]">{a.pris_en_charge.n}</td>
                    {details && <td className="px-4 py-3 text-right font-mono text-[#1B2632]/75">{formatDuree(a.pris_en_charge.mediane_min)}</td>}
                    {details && <td className="px-4 py-3 text-right font-mono text-[#1B2632]/75">{formatDuree(a.pris_en_charge.moyenne_min)}</td>}
                    {details && TRANCHES.map((t) => <td key={t.cle} className="px-3 py-3 text-right font-mono text-[#1B2632]/75">{a.pris_en_charge.tranches[t.cle]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-[#C9C1B1]/50">
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
          <div>
            <p className="px-5 py-3 text-[11px] text-[#1B2632]/55">
              « En attente » : l&apos;agent à qui le lead est affecté. « Pris en charge » : celui qui a enregistré la prise en charge.
            </p>
            <p className="px-5 pb-4 text-[11px] text-[#1B2632]/55">{EXPLICATION}</p>
          </div>
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
