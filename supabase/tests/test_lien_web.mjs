// lib/lienWeb.mjs (16/11) — sans base : le lien de vérification d'un produit
// n'est accepté (et cliquable) que s'il est une adresse http(s) réelle
// (revue de sécurité 13/11, point 4).
// node supabase/tests/test_lien_web.mjs
import { estLienWeb } from '../../lib/lienWeb.mjs'

let ok = 0, ko = 0
const check = (nom, recu, attendu) => { const b = recu === attendu; b ? ok++ : ko++; console.log((b ? 'PASS ' : 'FAIL ') + nom + (b ? '' : `  reçu ${recu} attendu ${attendu}`)) }

// acceptés
check('https', estLienWeb('https://www.diabetica.com'), true)
check('http', estLienWeb('http://boutique.ma/produit?id=3'), true)
check('majuscules HTTPS', estLienWeb('HTTPS://Site.com'), true)
check('espaces autour', estLienWeb('  https://site.com  '), true)
check('sous-chemin + ancre', estLienWeb('https://shop.site.com/p/abc#avis'), true)

// refusés
check('httpps (VORALIS, prod 10/11)', estLienWeb('httpps://www.diabetica.com'), false)
check('javascript:', estLienWeb('javascript:alert(1)'), false)
check('JavaScript: en casse mélangée', estLienWeb('JavaScript:alert(1)'), false)
check('data:', estLienWeb('data:text/html,<b>x</b>'), false)
check('ftp', estLienWeb('ftp://site.com'), false)
check('sans schéma', estLienWeb('www.site.com'), false)
check('https sans domaine', estLienWeb('https://'), false)
check('domaine sans point', estLienWeb('https://localhost'), false)
check('texte libre', estLienWeb('voir le site'), false)
check('vide', estLienWeb(''), false)
check('null', estLienWeb(null), false)

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
