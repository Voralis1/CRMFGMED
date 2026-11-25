'use client'

// Le bouton de langue (25/11/2026) : FR | EN, dans la barre du haut et sur la
// page de connexion. Un clic et tout le CRM change.

import { useLangue } from '../context/LangueContext'

export default function ChoixLangue({ className = '' }) {
  const { langue, setLangue, langues, t } = useLangue()
  return (
    <div role="group" aria-label={t('langue.choisir')} title={t('langue.choisir')}
      className={`flex items-center bg-white rounded-2xl border border-[#C9C1B1]/40 shadow-sm p-1 shrink-0 ${className}`}>
      {langues.map((l) => {
        const actif = l.code === langue
        return (
          <button key={l.code} type="button" onClick={() => setLangue(l.code)} aria-pressed={actif} title={l.nom}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              actif ? 'bg-[#1B2632] text-white' : 'text-[#1B2632]/60 hover:text-[#1B2632] hover:bg-[#EEE9DF]'}`}>
            {l.court}
          </button>
        )
      })}
    </div>
  )
}
