'use client'

// UNE période, UN contrôle (29/10) : un champ qui affiche « du → au » et
// ouvre un calendrier. Premier clic = début, second clic = fin (avant le
// début : les deux s'échangent ; le même jour deux fois : un seul jour).
// Comme « Action date Range » / « Date Range » de ShipLead.
// Rien n'est pré-rempli (CLAUDE.md §11 : une période par défaut a déjà
// caché des livraisons du jour).
// Valeurs : 'AAAA-MM-JJ' ou '' — les dates du jour LOCAL, comme un
// <input type="date">.
import { useEffect, useRef, useState } from 'react'

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const versTexte = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const depuisTexte = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const affiche = (t) => { const d = depuisTexte(t); return d ? d.toLocaleDateString('fr-FR') : '' }

export default function PlageDates({ du, au, onChange, placeholder = 'Choisir une période', etiquette }) {
  const [ouvert, setOuvert] = useState(false)
  const [mois, setMois] = useState(() => depuisTexte(du) || new Date())
  // Le premier clic d'une nouvelle période, tant que le second n'est pas fait.
  const [debutEnCours, setDebutEnCours] = useState(null)
  const boite = useRef(null)

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e) => { if (boite.current && !boite.current.contains(e.target)) setOuvert(false) }
    const echap = (e) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('mousedown', dehors)
    document.addEventListener('keydown', echap)
    return () => { document.removeEventListener('mousedown', dehors); document.removeEventListener('keydown', echap) }
  }, [ouvert])

  function ouvrir() {
    setMois(depuisTexte(du) || new Date())
    setDebutEnCours(null)
    setOuvert((o) => !o)
  }

  function choisir(jour) {
    const t = versTexte(jour)
    if (!debutEnCours) {
      setDebutEnCours(t)
      onChange(t, '')
      return
    }
    const [a, b] = t < debutEnCours ? [t, debutEnCours] : [debutEnCours, t]
    setDebutEnCours(null)
    onChange(a, b)
    setOuvert(false)
  }

  // Les cases du mois : lundi en premier.
  const premier = new Date(mois.getFullYear(), mois.getMonth(), 1)
  const decalage = (premier.getDay() + 6) % 7
  const nbJours = new Date(mois.getFullYear(), mois.getMonth() + 1, 0).getDate()
  const cases = [...Array(decalage).fill(null), ...Array.from({ length: nbJours }, (_, i) => new Date(mois.getFullYear(), mois.getMonth(), i + 1))]
  const aujourdhui = versTexte(new Date())

  const texte = du && au ? `${affiche(du)} → ${affiche(au)}` : du ? `${affiche(du)} → …` : ''

  return (
    <div className="relative" ref={boite} data-plage-dates={etiquette || ''}>
      <button type="button" onClick={ouvrir}
        className="cm-input flex items-center gap-2 text-left cursor-pointer">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-[#1B2632]/50">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className={`flex-1 truncate ${texte ? 'text-[#1B2632]' : 'text-[#1B2632]/35'}`}>{texte || placeholder}</span>
        {(du || au) && (
          <span role="button" tabIndex={0} aria-label="Effacer la période"
            onClick={(e) => { e.stopPropagation(); setDebutEnCours(null); onChange('', '') }}
            className="text-[#1B2632]/40 hover:text-[#A35139] text-xs px-1">✕</span>
        )}
      </button>

      {ouvert && (
        <div className="absolute z-30 left-0 mt-1 w-[280px] max-w-[calc(100vw-2rem)] bg-white border border-[#C9C1B1] rounded-xl shadow-xl p-3" data-calendrier>
          <div className="flex items-center justify-between mb-2">
            <button type="button" aria-label="Mois précédent" onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}
              className="w-8 h-8 rounded-lg hover:bg-[#EEE9DF] text-[#1B2632]">‹</button>
            <span className="text-sm font-bold text-[#1B2632]">{MOIS[mois.getMonth()]} {mois.getFullYear()}</span>
            <button type="button" aria-label="Mois suivant" onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}
              className="w-8 h-8 rounded-lg hover:bg-[#EEE9DF] text-[#1B2632]">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-bold text-[#1B2632]/45 mb-1">
            {JOURS.map((j, i) => <span key={i}>{j}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cases.map((jour, i) => {
              if (!jour) return <span key={`v${i}`} />
              const t = versTexte(jour)
              const debut = debutEnCours || du
              const fin = debutEnCours ? '' : au
              const borne = t === debut || t === fin
              const dedans = debut && fin && t > debut && t < fin
              return (
                <button key={t} type="button" onClick={() => choisir(jour)} data-jour={t}
                  className={`h-8 rounded-md text-xs transition-colors ${
                    borne ? 'bg-[#1B2632] text-white font-bold'
                      : dedans ? 'bg-[#FFB162]/30 text-[#1B2632]'
                        : 'hover:bg-[#EEE9DF] text-[#1B2632]'
                  } ${t === aujourdhui && !borne ? 'ring-1 ring-[#A35139]/50' : ''}`}>
                  {jour.getDate()}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-[#1B2632]/50 mt-2">
            {debutEnCours ? 'Choisissez le dernier jour.' : 'Choisissez le premier jour, puis le dernier.'}
          </p>
        </div>
      )}
    </div>
  )
}
