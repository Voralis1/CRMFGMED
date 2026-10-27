// L'heure d'un rappel, entre le champ de l'écran et la base — UNE copie, pour
// le Centre d'appel et Commandes. Sans dépendance : testée hors navigateur,
// sous plusieurs fuseaux (supabase/tests/test_heure_rappel.mjs).
//
// CE QUI EST STOCKÉ : un INSTANT (timestamptz, en UTC dans la base).
//   L'agent tape une heure LOCALE dans <input type="datetime-local"> (« 18:00 »,
//   sans fuseau). Le navigateur sait dans quel fuseau il est : depuisChampLocal
//   en fait un instant ISO avec « Z ». Luanda (UTC+1), 18:00 → « …T17:00:00.000Z ».
//
// CE QUI EST AFFICHÉ : cet instant, dans le fuseau de CELUI QUI REGARDE.
//   L'agent à Luanda revoit 18:00 ; un manager à Dakar (UTC+0) voit 17:00 —
//   la même seconde, lue sur sa montre. « Dans 2 h » est le même pour les deux.
//
// Ne jamais envoyer la valeur brute du champ : la base est en UTC et lirait
// « 18:00 » comme 18:00 UTC, soit 19:00 à Luanda. confirmer-appel refuse
// d'ailleurs une heure sans fuseau (_shared/appel.ts).

const deux = (n) => String(n).padStart(2, '0')

// Instant → valeur du champ datetime-local, dans le fuseau du navigateur.
export function versChampLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}`
}

// Valeur du champ (heure locale, sans fuseau) → instant ISO en UTC. '' si vide
// ou illisible.
export function depuisChampLocal(valeur) {
  if (!valeur) return ''
  // « AAAA-MM-JJTHH:MM » sans fuseau est lu comme heure LOCALE par Date.
  const d = new Date(valeur)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

// Les bornes du champ : maintenant → maintenant + maxJours (les mêmes que
// confirmer-appel ; le serveur revérifie).
export function bornesChamp(maxJours, maintenant = Date.now()) {
  return {
    min: versChampLocal(new Date(maintenant).toISOString()),
    max: versChampLocal(new Date(maintenant + maxJours * 24 * 3600 * 1000).toISOString()),
  }
}

// « Rappel à 18:00 » (aujourd'hui), « Rappel demain à 09:30 », « Rappel le
// 29/10 à 18:00 » — et « dans 2 h », « dans 25 min », « à l'instant »,
// « dû depuis 10 min ».
export function libelleRappel(iso, maintenant = Date.now()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ecartJours = Math.round((jour(d) - jour(new Date(maintenant))) / (24 * 3600 * 1000))
  const quand = ecartJours === 0 ? `à ${heure}`
    : ecartJours === 1 ? `demain à ${heure}`
    : `le ${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${heure}`

  const min = Math.round((d.getTime() - maintenant) / 60000)
  const duree = (m) => (m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} j`)
  const relatif = min > 0 ? `dans ${duree(min)}` : min === 0 ? 'à l’instant' : `dû depuis ${duree(-min)}`
  return { texte: `Rappel ${quand}`, relatif, du: min <= 0 }
}
