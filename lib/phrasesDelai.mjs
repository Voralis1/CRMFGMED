// Le délai de prise en charge, DIT en français (02/11).
//
// L'écran ne laisse pas le lecteur assembler une médiane, une moyenne et quatre
// tranches : il lui dit ce qu'elles veulent dire, en une phrase par chiffre,
// au-dessus du détail. Les phrases sont faites des MÊMES chiffres que le
// détail (le jsonb de delai_prise_en_charge) : elles ne peuvent pas diverger.
//
// On écrit « appel enregistré », pas « appel » tout court : un agent qui ouvre
// le panneau et le referme sans enregistrer ne laisse aucune trace.

const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un)

// 7 → « 7 min » ; 125 → « 2 h 05 » ; 300 → « 5 h » ; 24480 → « 17 jours »
export function dureeEnMots(minutes) {
  if (minutes == null) return null
  const m = Math.round(Number(minutes))
  if (m < 1) return 'moins d’une minute'
  if (m < 60) return `${m} min`
  if (m < 1440) {
    const h = Math.floor(m / 60), r = m % 60
    return r && h < 3 ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`
  }
  const j = Math.floor(m / 1440)
  return `${j} ${pluriel(j, 'jour', 'jours')}`
}

// Le tableau de bord n'en garde qu'une : combien attendent encore (02/11).
export function phraseAttenteCourte(enAttente) {
  const n = enAttente?.n ?? 0
  if (n === 0) return 'Aucun lead n’attend : chacun a déjà un appel enregistré.'
  return n === 1 ? '1 lead n’a toujours aucun appel enregistré.' : `${n} leads n’ont toujours aucun appel enregistré.`
}

// Ceux qui attendent encore (toujours MAINTENANT).
export function phraseAttente(enAttente, sansAgent = 0) {
  const n = enAttente?.n ?? 0
  if (n === 0) return 'Aucun lead n’attend : chacun a déjà un appel enregistré.'
  const age = dureeEnMots(enAttente.max_min)
  let s = n === 1
    ? `1 lead n’a toujours aucun appel enregistré. Il attend depuis ${age}.`
    : `${n} leads n’ont toujours aucun appel enregistré. Le plus ancien attend depuis ${age}.`
  if (sansAgent > 0) {
    s += sansAgent === n
      ? (n === 1 ? ' Il n’a pas d’agent : personne n’est chargé de l’appeler.' : ' Aucun n’a d’agent : personne n’est chargé de les appeler.')
      : ` Dont ${sansAgent} sans agent : personne n’est chargé de ${pluriel(sansAgent, 'l’appeler', 'les appeler')}.`
  }
  return s
}

// Ceux qui ont été pris en charge (sur la période).
export function phrasePris(pris) {
  const n = pris?.n ?? 0
  if (n === 0) return 'Aucun lead entré dans la file sur cette période n’a encore d’appel enregistré.'
  const t = pris.tranches || {}
  const longs = t.plus_3_h ?? 0
  if (n === 1) {
    return `Le seul lead de la période a été appelé après ${dureeEnMots(pris.mediane_min)}.`
  }
  let s = `La moitié des leads sont appelés en moins de ${dureeEnMots(pris.mediane_min)}.`
  if (longs > 0) s += ` Mais ${longs} sur ${n} ont attendu plus de 3 h.`
  else if ((t.moins_15_min ?? 0) === n) s += ' Tous en moins de 15 min.'
  else s += ' Aucun n’a attendu plus de 3 h.'
  return s
}

// Les deux phrases d'un résultat complet, l'attente d'abord.
export function phrasesDelai(donnees) {
  if (!donnees) return []
  const sans = (donnees.par_agent || []).find((a) => a.cle === 'sans')?.en_attente?.n ?? 0
  return [phraseAttente(donnees.en_attente, sans), phrasePris(donnees.pris_en_charge)]
}
