// Le délai de prise en charge, DIT en français (02/11).
//
// L'écran ne laisse pas le lecteur assembler une médiane, une moyenne et quatre
// tranches : il lui dit ce qu'elles veulent dire, en une phrase par chiffre,
// au-dessus du détail. Les phrases sont faites des MÊMES chiffres que le
// détail (le jsonb de delai_prise_en_charge) : elles ne peuvent pas diverger.
//
// On écrit « appel enregistré », pas « appel » tout court : un agent qui ouvre
// le panneau et le referme sans enregistrer ne laisse aucune trace.

// Les phrases viennent de lib/langues (25/11) : la langue choisie, le
// français par défaut (mot pour mot l'ancien texte : les tests le vérifient).
import { traduire } from './langues/index.mjs'

// 7 → « 7 min » ; 125 → « 2 h 05 » ; 300 → « 5 h » ; 24480 → « 17 jours »
export function dureeEnMots(minutes) {
  if (minutes == null) return null
  const m = Math.round(Number(minutes))
  if (m < 1) return traduire('pd.moinsMinute')
  if (m < 60) return traduire('pd.min', { n: m })
  if (m < 1440) {
    const h = Math.floor(m / 60), r = m % 60
    return r && h < 3 ? traduire('pd.hMin', { h, m: String(r).padStart(2, '0') }) : traduire('pd.h', { h })
  }
  const j = Math.floor(m / 1440)
  return traduire('pd.jours', { n: j })
}

// Le tableau de bord n'en garde qu'une : combien attendent encore (02/11).
export function phraseAttenteCourte(enAttente) {
  const n = enAttente?.n ?? 0
  if (n === 0) return traduire('pd.aucunAttend')
  return traduire('pd.court', { n })
}

// Ceux qui attendent encore (toujours MAINTENANT).
export function phraseAttente(enAttente, sansAgent = 0) {
  const n = enAttente?.n ?? 0
  if (n === 0) return traduire('pd.aucunAttend')
  const age = dureeEnMots(enAttente.max_min)
  let s = traduire('pd.attente', { n, age })
  if (sansAgent > 0) {
    s += sansAgent === n
      ? traduire('pd.sansAgentTous', { n })
      : traduire('pd.dontSansAgent', { n: sansAgent })
  }
  return s
}

// Ceux qui ont été pris en charge (sur la période).
export function phrasePris(pris) {
  const n = pris?.n ?? 0
  if (n === 0) return traduire('pd.aucunPris')
  const tranches = pris.tranches || {}
  const longs = tranches.plus_3_h ?? 0
  if (n === 1) {
    return traduire('pd.seul', { duree: dureeEnMots(pris.mediane_min) })
  }
  let s = traduire('pd.moitie', { duree: dureeEnMots(pris.mediane_min) })
  if (longs > 0) s += traduire('pd.longs', { longs, n })
  else if ((tranches.moins_15_min ?? 0) === n) s += traduire('pd.tousRapides')
  else s += traduire('pd.aucunLong')
  return s
}

// Les deux phrases d'un résultat complet, l'attente d'abord.
export function phrasesDelai(donnees) {
  if (!donnees) return []
  const sans = (donnees.par_agent || []).find((a) => a.cle === 'sans')?.en_attente?.n ?? 0
  return [phraseAttente(donnees.en_attente, sans), phrasePris(donnees.pris_en_charge)]
}
