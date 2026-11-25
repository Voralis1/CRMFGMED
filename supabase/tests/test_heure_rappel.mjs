// L'heure du rappel sous plusieurs fuseaux (lib/heureRappel.mjs). Ce test se
// relance lui-même dans chaque fuseau (le fuseau d'un processus Node se fixe
// au démarrage, variable TZ) :
//
//   node supabase/tests/test_heure_rappel.mjs
//
// Ce qu'il prouve : l'agent de Luanda et un manager ailleurs voient le MÊME
// instant (chacun sur sa montre), et ce qui part vers la base est cet instant
// en UTC, jamais l'heure brute du champ.
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const FUSEAUX = ['Africa/Luanda', 'Africa/Dakar', 'Africa/Bamako', 'Africa/Conakry', 'Africa/Libreville',
  'Africa/Brazzaville', 'Africa/Casablanca', 'Europe/Paris', 'America/New_York']

if (!process.env.FUSEAU_TEST) {
  let ok = 0, ko = 0
  const resultats = {}
  for (const tz of FUSEAUX) {
    const sortie = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, FUSEAU_TEST: tz }, encoding: 'utf8',
    })
    const r = JSON.parse(sortie)
    resultats[tz] = r
    for (const [nom, pass, extra] of r.checks) {
      pass ? ok++ : ko++
      console.log((pass ? 'PASS ' : 'FAIL ') + `[${tz}] ${nom}` + (pass ? '' : '  ' + extra))
    }
  }
  // Le même instant pour tous : l'agent de Luanda tape 18:00 le 27/10.
  const instant = resultats['Africa/Luanda'].saisi18h
  const pareil = (c, nom, extra = '') => { c ? ok++ : ko++; console.log((c ? 'PASS ' : 'FAIL ') + nom + (c ? '' : '  ' + extra)) }
  pareil('Luanda tape 18:00 → stocké 17:00 UTC', instant === '2026-10-27T17:00:00.000Z', instant)
  pareil('Dakar, Bamako, Conakry (UTC+0) lisent cet instant 17:00',
    ['Africa/Dakar', 'Africa/Bamako', 'Africa/Conakry'].every((tz) => resultats[tz].lu === '2026-10-27T17:00'))
  pareil('Libreville, Brazzaville (UTC+1) lisent 18:00, comme Luanda',
    ['Africa/Libreville', 'Africa/Brazzaville', 'Africa/Luanda'].every((tz) => resultats[tz].lu === '2026-10-27T18:00'))
  pareil('Paris (UTC+1 en hiver, le 27/10 = après le changement d\'heure) lit 18:00', resultats['Europe/Paris'].lu === '2026-10-27T18:00', resultats['Europe/Paris'].lu)
  pareil('« dans … » identique partout (même instant)', new Set(FUSEAUX.map((tz) => resultats[tz].relatif)).size === 1,
    JSON.stringify(FUSEAUX.map((tz) => resultats[tz].relatif)))
  console.log(`\n${ok} passed, ${ko} failed`)
  process.exit(ko ? 1 : 0)
} else {
  const H = await import('../../lib/heureRappel.mjs')
  const checks = []
  const check = (nom, c, extra = '') => checks.push([nom, !!c, String(extra)])

  // L'instant que l'agent de Luanda a choisi (18:00 chez lui).
  const INSTANT = '2026-10-27T17:00:00.000Z'
  const lu = H.versChampLocal(INSTANT)
  // Dans CE fuseau, taper l'heure lue et la renvoyer redonne le même instant.
  check('aller-retour champ → instant → champ : même instant', H.depuisChampLocal(lu) === INSTANT, H.depuisChampLocal(lu))
  check('ce qui part vers la base finit par Z (UTC), jamais l\'heure brute', /Z$/.test(H.depuisChampLocal('2026-10-27T18:00')))
  check('champ vide → rien', H.depuisChampLocal('') === '' && H.versChampLocal(null) === '')
  check('champ illisible → rien', H.depuisChampLocal('pas une date') === '')
  const MAINT = Date.parse('2026-10-27T15:00:00Z')
  const l = H.libelleRappel(INSTANT, MAINT)
  check('libellé : « dans 2 h »', l.relatif === 'dans 2 h', l.relatif)
  check('libellé : pas encore dû', l.du === false)
  const passe = H.libelleRappel('2026-10-27T14:50:00Z', MAINT)
  check('dix minutes passées : « dû depuis 10 min », dû', passe.relatif === 'dû depuis 10 min' && passe.du, JSON.stringify(passe))
  check('vingt-cinq minutes : « dans 25 min »', H.libelleRappel('2026-10-27T15:25:00Z', MAINT).relatif === 'dans 25 min')
  check('trois jours : « dans 3 j »', H.libelleRappel('2026-10-30T15:00:00Z', MAINT).relatif === 'dans 3 j')
  const b = H.bornesChamp(30, MAINT)
  check('bornes : min = maintenant, max = +30 jours, au format du champ',
    /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(b.min) && H.depuisChampLocal(b.min) === '2026-10-27T15:00:00.000Z'
      && H.depuisChampLocal(b.max) === '2026-11-26T15:00:00.000Z', JSON.stringify(b))

  // Pour la comparaison entre fuseaux (processus parent).
  const saisi18h = H.depuisChampLocal('2026-10-27T18:00')
  console.log(JSON.stringify({ checks, lu, relatif: l.relatif, saisi18h }))
}
