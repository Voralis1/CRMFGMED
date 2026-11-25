// lib/rechercheOr.mjs (17/11) — sans base : la recherche texte dans un filtre
// « or » de PostgREST — valeur entre guillemets, " et \ échappés, jokers
// % et * retirés (revue de sécurité 13/11, point 6).
// node supabase/tests/test_recherche_or.mjs
import { motifContient, orContient } from '../../lib/rechercheOr.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${JSON.stringify(recu)} attendu ${JSON.stringify(attendu)}`)) }

check('texte simple', motifContient('Ali'), '"%Ali%"')
check('guillemet échappé', motifContient('Ali"'), '"%Ali\\"%"')
check('antislash échappé', motifContient('a\\b'), '"%a\\\\b%"')
check('les deux', motifContient('"\\'), '"%\\"\\\\%"')
check('virgule gardée', motifContient('Ali, Rabat'), '"%Ali, Rabat%"')
check('parenthèses gardées', motifContient('Ali (Rabat)'), '"%Ali (Rabat)%"')
check('point / deux-points gardés', motifContient('M. A:1'), '"%M. A:1%"')
check('% retiré (joker)', motifContient('50%'), '"%50%"')
check('* retiré (joker)', motifContient('a*b'), '"%ab%"')
check('espaces autour retirés', motifContient('  Ali  '), '"%Ali%"')
check('accents', motifContient('Luánda'), '"%Luánda%"')
check('vide', motifContient(''), '')
check('que des jokers', motifContient('%*'), '')
check('null', motifContient(null), '')

check('or sur 2 colonnes', orContient(['client_nom', 'lead_id'], 'Ali"'), 'client_nom.ilike."%Ali\\"%",lead_id.ilike."%Ali\\"%"')
check('or vide', orContient(['client_nom'], '  '), '')

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
