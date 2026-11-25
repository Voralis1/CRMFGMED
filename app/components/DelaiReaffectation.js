'use client'

// T21 (13/11, reaffectation_delai.sql) : le délai avant qu'un lead « En attente »
// que son agent n'a pas ouvert (« Traiter ») passe à un autre agent du pays.
// Réglé par l'entreprise elle-même (sa décision 13/11) : admin et manager
// (fixer_delai_reaffectation refuse les autres) ; le ceo le lit.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useLangue } from '../context/LangueContext'
import { messageErreur } from '../../lib/messageErreur.mjs'

export default function DelaiReaffectation({ tenantId, peutModifier }) {
  const { t } = useLangue()
  const [actuel, setActuel] = useState(null)
  const [saisie, setSaisie] = useState('')
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    supabase.from('tenants').select('delai_reaffectation_minutes').eq('id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (error) { setErreur(messageErreur(error)); return }
        const d = data?.delai_reaffectation_minutes ?? 60
        setActuel(d); setSaisie(String(d))
      })
  }, [tenantId])

  async function enregistrer(e) {
    e.preventDefault()
    setMessage(''); setErreur('')
    const minutes = Number(saisie)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
      setErreur(t('delai.invalide'))
      return
    }
    setEnCours(true)
    const { error } = await supabase.rpc('fixer_delai_reaffectation', { p_tenant: tenantId, p_minutes: minutes })
    setEnCours(false)
    if (error) { setErreur(messageErreur(error)); return }
    setActuel(minutes)
    setMessage(t('delai.enregistre'))
  }

  return (
    <div className="bg-white p-8 rounded-2xl border border-[#C9C1B1] shadow-sm">
      <div className="mb-4 border-b border-[#C9C1B1]/50 pb-4">
        <h2 className="text-xl font-bold text-[#1B2632]">{t('delai.titre')}</h2>
        <p className="text-sm text-[#1B2632]/60 mt-1">
          {t('delai.aide')}
        </p>
      </div>
      <form onSubmit={enregistrer} className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-[#1B2632]/70 uppercase tracking-wide">{t('delai.minutes')}
          <input type="number" min="5" max="480" step="1" value={saisie}
            onChange={(e) => { setSaisie(e.target.value); setMessage(''); setErreur('') }}
            disabled={!peutModifier || actuel === null}
            className="fg-input block mt-1.5 w-32" />
        </label>
        {peutModifier && (
          <button type="submit" disabled={enCours || actuel === null || String(actuel) === saisie}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-[#1B2632] text-white disabled:opacity-40">
            {enCours ? t('commun.enregistrement') : t('commun.enregistrer')}
          </button>
        )}
        <span className="text-xs text-[#1B2632]/50 pb-3">{t('delai.defaut')}</span>
      </form>
      {message && <p className="text-xs text-green-700 mt-2">{message}</p>}
      {erreur && <p className="text-xs text-[#A35139] mt-2">{erreur}</p>}
    </div>
  )
}
