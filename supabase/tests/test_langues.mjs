// lib/langues (25/11) — sans base : chaque langue a toutes les clés du français,
// les {variables} sont les mêmes, le pluriel et le repli marchent.
// node supabase/tests/test_langues.mjs
import { LANGUES, traduire } from '../../lib/langues/index.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${JSON.stringify(attendu)}`)) }
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

const fr = LANGUES.find((l) => l.code === 'fr').textes
for (const l of LANGUES.filter((x) => x.code !== 'fr')) {
  // les phrases-clés (erreurs.ts) n'existent qu'en traduction : on ne les exige pas en français
  const manquantes = Object.keys(fr).filter((k) => !k.endsWith('_1') && !(k in l.textes))
  check(`${l.code} : toutes les clés du français`, manquantes.join(', '), '')
  const variablesDiff = Object.keys(fr).filter((k) => k in l.textes && vars(fr[k]) !== vars(l.textes[k]))
  check(`${l.code} : mêmes {variables}`, variablesDiff.join(', '), '')
  const vides = Object.entries(l.textes).filter(([, v]) => !String(v).trim()).map(([k]) => k)
  check(`${l.code} : aucun texte vide`, vides.join(', '), '')
}
check('variable remplacée', traduire('lot.dejaAinsi', { n: 4 }, 'fr'), '4 déjà ainsi')
check('singulier (n = 1)', traduire('lot.traitees', { action: 'Suppression', n: 1 }, 'fr'), 'Suppression : 1 commande traitée')
check('pluriel (n = 3)', traduire('lot.traitees', { action: 'Suppression', n: 3 }, 'fr'), 'Suppression : 3 commandes traitées')
check('anglais', traduire('nav.commandes', null, 'en'), 'Orders')
check('clé absente → français', traduire('err.inconnue', null, 'xx'), 'Une erreur est survenue')
check('clé inconnue → la clé', traduire('pas.une.cle', null, 'en'), 'pas.une.cle')
check('phrase Postgres traduite', traduire('Cet élément existe déjà.', null, 'en'), 'This item already exists.')
check('phrase Postgres en français', traduire('Cet élément existe déjà.', null, 'fr'), 'Cet élément existe déjà.')

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
