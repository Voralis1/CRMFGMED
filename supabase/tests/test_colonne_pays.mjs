// La colonne Country de l'import de fichier (21/10), hors navigateur :
// l'aperçu (analyserColonnePays) et le pays de chaque ligne (resoudrePays).
// 22/10 : la colonne est RETIRÉE de l'écran Commandes (le pays vient de
// l'entrepôt ou du pays choisi). Les fonctions restent dans pays.ts (l'API
// utilise resoudrePays) ; les deux derniers contrôles vérifient l'absence.
//
//   node supabase/tests/test_colonne_pays.mjs
import fs from 'fs'
import path from 'path'
const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const P = await import(path.join(RACINE, 'supabase/functions/_shared/pays.ts'))
const C = await import(path.join(RACINE, 'supabase/functions/_shared/champs.ts'))

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }
const eq = (nom, recu, attendu) => check(nom, JSON.stringify(recu) === JSON.stringify(attendu), `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`)

// Les pays d'UNE entreprise. Le Mali existe dans lib/paysMonde.js, pas ici.
const LISTE = [
  { id: 'ao', nom: 'Angola', code: 'AO' },
  { id: 'cg', nom: 'Congo', code: 'CG' },
  { id: 'sn', nom: 'Sénégal', code: 'SN' },
]
// Ce que fait l'écran pour une ligne : sa cellule Country, sinon le pays
// choisi en haut (ECRAN), sinon refus.
const ligne = (cellule, ecran) => P.resoudrePays({ liste: LISTE, textes: [cellule], defaut: ecran, manquant: 'pays manquant' })

console.log('\n— les noms de colonne')
for (const h of ['Country', 'Pays', 'País', 'Pais', 'COUNTRY ']) {
  check(`« ${h} » est la colonne pays`, C.NOMS.pays.includes(C.cleNormalisee(h)))
}
const page = fs.readFileSync(path.join(RACINE, 'app/commandes/page.js'), 'utf8')
check('22/10 : Country n\'est plus une colonne de CHAMPS_IMPORT (modèle, aide, aperçu)', !/nom: 'Country'/.test(page))
check('… ni dans EXEMPLE_IMPORT', !/'Country':/.test(page))

console.log('\n— colonne remplie')
let a = P.analyserColonnePays(['Angola', 'Angola', 'Congo'], LISTE)
eq('valeurs distinctes et lignes', a.valeurs.map((v) => [v.valeur, v.lignes, v.pays_nom]), [['Angola', 2, 'Angola'], ['Congo', 1, 'Congo']])
eq('rien d\'inconnu → pas de blocage', a.inconnues.length, 0)
eq('la ligne garde SON pays, quel que soit l\'écran', ligne('Congo', 'ao').pays_id, 'cg')

console.log('\n— colonne vide')
a = P.analyserColonnePays(['', '  ', ''], LISTE)
eq('trois cellules vides comptées', [a.vides, a.valeurs.length, a.inconnues.length], [3, 0, 0])
eq('cellule vide → le pays de l\'écran', ligne('', 'ao').pays_id, 'ao')

console.log('\n— fichier mélangé')
a = P.analyserColonnePays(['Congo', '', 'CG', ''], LISTE)
eq('Congo et CG sont deux valeurs, un seul pays', a.valeurs.map((v) => [v.valeur, v.pays_id]), [['Congo', 'cg'], ['CG', 'cg']])
eq('… deux vides', a.vides, 2)
eq('lignes : Congo, écran, Congo, écran', ['Congo', '', 'CG', ''].map((x) => ligne(x, 'ao').pays_id), ['cg', 'ao', 'cg', 'ao'])

console.log('\n— code à deux lettres')
eq('« AO » → Angola', ligne('AO', null).pays_id, 'ao')
eq('« ao » → Angola (casse ignorée)', ligne('ao', null).pays_id, 'ao')

console.log('\n— nom accentué')
eq('« Sénégal » → Sénégal', ligne('Sénégal', null).pays_id, 'sn')
eq('« senegal » → Sénégal', ligne('senegal', null).pays_id, 'sn')
eq('« SENEGAL » à l\'aperçu → reconnu', P.analyserColonnePays(['SENEGAL'], LISTE).inconnues.length, 0)

console.log('\n— valeur mal écrite : l\'aperçu bloque')
a = P.analyserColonnePays([...Array(12).fill('Angloa'), 'Angola'], LISTE)
eq('« Angloa » (12 lignes) : pays inconnu', a.inconnues.map((v) => [v.valeur, v.lignes, v.pays_id]), [['Angloa', 12, null]])
check('→ au moins une inconnue : Importer désactivé', a.inconnues.length > 0)
check('… et la ligne, si elle passait, serait refusée — pas mise au pays de l\'écran', !ligne('Angloa', 'ao').pays_id)

console.log('\n— pays que l\'entreprise n\'a pas')
a = P.analyserColonnePays(['Mali', 'ML'], LISTE)
eq('Mali et ML inconnus (lib/paysMonde.js n\'est jamais consulté)', a.inconnues.map((v) => v.valeur), ['Mali', 'ML'])
check('une faute de frappe ne fabrique pas une commande d\'un autre pays', !ligne('Mali', 'ao').pays_id)

console.log('\n— ni pays dans la ligne, ni choix à l\'écran')
const r = ligne('', null)
check('ligne refusée : « pays manquant »', !r.pays_id && r.motif === 'pays manquant', JSON.stringify(r))

console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
