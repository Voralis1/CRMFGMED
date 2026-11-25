// La règle « pas de confirmation sans adresse » de confirmer-appel, hors Deno.
//
//   node supabase/tests/test_confirmer_appel.mjs
//
// Node 22.18+ lit le TypeScript de _shared/appel.ts directement.
import path from 'path'
const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const A = await import(path.join(RACINE, 'supabase/functions/_shared/appel.ts'))

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }

// Les sept statuts tels qu'en production (statuts_standard.sql), pays_id vide.
const S = (nom, declenche) => ({ nom, code: nom.toLowerCase(), pays_id: null, declenche_assignation: declenche })
const SEPT = [S('Confirmed', true), S('Cancelled', false), S('Double', false), S('Test', false),
              S('Spam', false), S('Unreached', false), S('Reminder', false)]
const AO = 'pays-angola', CG = 'pays-congo'

check('Confirmed sans adresse → refusé', A.adresseManquante(SEPT, 'Confirmed', AO, null))
check('Confirmed, adresse vide → refusé', A.adresseManquante(SEPT, 'Confirmed', AO, ''))
check('Confirmed, adresse faite d\'espaces → refusé', A.adresseManquante(SEPT, 'Confirmed', AO, '   \n '))
check('Confirmed par son code (confirmed) → refusé aussi', A.adresseManquante(SEPT, 'confirmed', AO, ''))
check('Confirmed avec un repère → accepté', !A.adresseManquante(SEPT, 'Confirmed', AO, 'près du marché Kinaxixi, maison bleue'))
check('Confirmed avec une rue → accepté', !A.adresseManquante(SEPT, 'Confirmed', AO, 'Rua 17 de Setembro 42'))

for (const s of ['Cancelled', 'Spam', 'Double', 'Test', 'Unreached', 'Reminder']) {
  check(`${s} sans adresse → JAMAIS bloqué`, !A.adresseManquante(SEPT, s, AO, null))
}

// C'est le drapeau qui décide, pas le mot.
const RENOMME = [{ nom: 'Validé', code: 'valide', pays_id: null, declenche_assignation: true }, S('Confirmed', false)]
check('statut renommé qui déclenche l\'assignation → bloqué', A.adresseManquante(RENOMME, 'Validé', AO, ''))
check('« Confirmed » sans le drapeau → pas bloqué', !A.adresseManquante(RENOMME, 'Confirmed', AO, ''))

// Un statut propre à un pays ne vaut que pour ce pays.
const PAYS = [{ nom: 'Livrable', code: 'livrable', pays_id: CG, declenche_assignation: true }]
check('statut du Congo, commande du Congo → bloqué', A.adresseManquante(PAYS, 'Livrable', CG, ''))
check('statut du Congo, commande d\'Angola → pas bloqué', !A.adresseManquante(PAYS, 'Livrable', AO, ''))

check('statut inconnu → pas bloqué (rien ne part au livreur)', !A.adresseManquante(SEPT, 'Nimporte', AO, ''))
check('statuts illisibles (liste vide) → pas bloqué', !A.adresseManquante([], 'Confirmed', AO, ''))
check('le message dit quoi faire', /Ajoutez l'adresse avant de confirmer/.test(A.MESSAGE_ADRESSE_MANQUANTE))

// --- Le rappel (27/10) : une heure, à venir, à 30 jours au plus -------------
const AVEC_RAPPEL = [...SEPT.filter((x) => x.nom !== 'Reminder'),
  { nom: 'Reminder', code: 'reminder', pays_id: null, declenche_assignation: false, necessite_rappel: true }]
const MAINTENANT = Date.parse('2026-10-27T12:00:00Z')
const R = (date, statut = 'Reminder', liste = AVEC_RAPPEL) => A.rappelRefuse(liste, statut, AO, date, MAINTENANT)
check('Reminder sans heure → refusé, le message dit pourquoi', /sans elles, le lead ne remonte jamais/.test(R(null) || ''), R(null))
check('Reminder, heure vide → refusé', R('  ') !== null)
check('Reminder à 18:00 Luanda (17:00Z) → accepté', R('2026-10-27T17:00:00.000Z') === null)
check('… écrit avec le décalage (+01:00) → accepté', R('2026-10-27T18:00+01:00') === null)
check('heure SANS fuseau (la base la lirait en UTC) → refusée', /illisible/.test(R('2026-10-27T18:00') || ''), R('2026-10-27T18:00'))
check('texte illisible → refusé', /illisible/.test(R('demain matin') || ''))
check('dans le passé (11:00Z) → refusé, « déjà passée »', /déjà passée/.test(R('2026-10-27T11:00:00Z') || ''), R('2026-10-27T11:00:00Z'))
check('1 minute de retard (horloges décalées) → accepté', R('2026-10-27T11:59:00Z') === null)
check('29 jours → accepté', R('2026-11-25T12:00:00Z') === null)
check('31 jours → refusé, « 30 jours au plus »', /30 jours au plus/.test(R('2026-11-27T13:00:00Z') || ''), R('2026-11-27T13:00:00Z'))
check('2031 → refusé', R('2031-01-01T10:00:00Z') !== null)
for (const st of ['Confirmed', 'Unreached', 'Cancelled', 'Spam']) {
  check(`${st} sans heure → jamais bloqué par le rappel`, R(null, st) === null)
}
check('par le DRAPEAU : « Reminder » sans necessite_rappel → pas d\'heure exigée', R(null, 'Reminder', SEPT) === null)
check('… un statut renommé « À rappeler » avec le drapeau → heure exigée',
  A.rappelRefuse([{ nom: 'À rappeler', code: 'a_rappeler', pays_id: null, declenche_assignation: false, necessite_rappel: true }], 'À rappeler', AO, null, MAINTENANT) !== null)
check('demandeRappel par le code aussi (reminder)', A.demandeRappel(AVEC_RAPPEL, 'reminder', AO))

console.log(`\n${ok} passed, ${ko} failed`)
