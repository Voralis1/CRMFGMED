// lib/phrasesDelai.mjs (02/11) — sans base : les phrases dites au-dessus du
// délai de prise en charge. Chaque phrase est faite des chiffres du résultat ;
// on vérifie le français (singulier/pluriel, zéro) et que chaque nombre dit
// est bien celui du détail.
// node supabase/tests/test_phrases_delai.mjs
import { dureeEnMots, phraseAttente, phraseAttenteCourte, phrasePris, phrasesDelai } from '../../lib/phrasesDelai.mjs'

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }
const tr = (a, b, c, d) => ({ moins_15_min: a, de_15_min_a_1_h: b, de_1_h_a_3_h: c, plus_3_h: d })

// durées en mots
check('0,4 min → moins d’une minute', dureeEnMots(0.4) === 'moins d’une minute')
check('7 min', dureeEnMots(7.2) === '7 min')
check('125 min → 2 h 05', dureeEnMots(125) === '2 h 05')
check('300 min → 5 h (pas de minutes au-delà de 3 h)', dureeEnMots(300) === '5 h')
check('1440 min → 1 jour', dureeEnMots(1440) === '1 jour')
check('24 480 min → 17 jours', dureeEnMots(24480) === '17 jours')
check('null → null', dureeEnMots(null) === null)

// l'attente
check('personne n’attend', phraseAttente({ n: 0 }) === 'Aucun lead n’attend : chacun a déjà un appel enregistré.')
check('78 leads, 17 jours', phraseAttente({ n: 78, max_min: 24480 }) === '78 leads n’ont toujours aucun appel enregistré. Le plus ancien attend depuis 17 jours.', phraseAttente({ n: 78, max_min: 24480 }))
check('1 lead : singulier', phraseAttente({ n: 1, max_min: 20 }) === '1 lead n’a toujours aucun appel enregistré. Il attend depuis 20 min.')
check('dont N sans agent', phraseAttente({ n: 77, max_min: 25776 }, 66) === '77 leads n’ont toujours aucun appel enregistré. Le plus ancien attend depuis 17 jours. Dont 66 sans agent : personne n’est chargé de les appeler.', phraseAttente({ n: 77, max_min: 25776 }, 66))
check('dont 1 sans agent : singulier', phraseAttente({ n: 5, max_min: 90 }, 1).endsWith('Dont 1 sans agent : personne n’est chargé de l’appeler.'))
check('tous sans agent', phraseAttente({ n: 3, max_min: 90 }, 3).endsWith('Aucun n’a d’agent : personne n’est chargé de les appeler.'))
check('le seul, sans agent', phraseAttente({ n: 1, max_min: 90 }, 1).endsWith('Il n’a pas d’agent : personne n’est chargé de l’appeler.'))

// la ligne du tableau de bord : le nombre, rien d'autre
check('tableau de bord : 77', phraseAttenteCourte({ n: 77, max_min: 24480 }) === '77 leads n’ont toujours aucun appel enregistré.')
check('tableau de bord : 1', phraseAttenteCourte({ n: 1 }) === '1 lead n’a toujours aucun appel enregistré.')
check('tableau de bord : 0', phraseAttenteCourte({ n: 0 }) === 'Aucun lead n’attend : chacun a déjà un appel enregistré.')
check('tableau de bord : même début que la phrase de Performances', phraseAttente({ n: 77, max_min: 24480 }, 66).startsWith(phraseAttenteCourte({ n: 77 })))

// les pris en charge
check('aucun sur la période', phrasePris({ n: 0 }) === 'Aucun lead entré dans la file sur cette période n’a encore d’appel enregistré.')
check('l’exemple : 7 min, 9 sur 25 > 3 h', phrasePris({ n: 25, mediane_min: 7, tranches: tr(14, 1, 1, 9) }) === 'La moitié des leads sont appelés en moins de 7 min. Mais 9 sur 25 ont attendu plus de 3 h.', phrasePris({ n: 25, mediane_min: 7, tranches: tr(14, 1, 1, 9) }))
check('aucun > 3 h', phrasePris({ n: 10, mediane_min: 20, tranches: tr(3, 5, 2, 0) }) === 'La moitié des leads sont appelés en moins de 20 min. Aucun n’a attendu plus de 3 h.')
check('tous < 15 min', phrasePris({ n: 4, mediane_min: 5, tranches: tr(4, 0, 0, 0) }) === 'La moitié des leads sont appelés en moins de 5 min. Tous en moins de 15 min.')
check('un seul', phrasePris({ n: 1, mediane_min: 42, tranches: tr(0, 1, 0, 0) }) === 'Le seul lead de la période a été appelé après 42 min.')

// le résultat complet de la base (la forme du jsonb), attente d'abord
const vrai = {
  pris_en_charge: { n: 27, moyenne_min: 1096.8, mediane_min: 18.2, max_min: 9000, tranches: tr(13, 3, 1, 10) },
  en_attente: { n: 77, mediane_min: 20160, max_min: 25776, tranches: tr(0, 0, 0, 77) },
  fermes_sans_prise_en_charge: 1,
  par_agent: [{ cle: 'a', agent: 'agnet', en_attente: { n: 11 } }, { cle: 'sans', agent: 'Sans agent', en_attente: { n: 66 } }],
}
const [a, p] = phrasesDelai(vrai)
check('phrasesDelai : l’attente d’abord', /^77 leads/.test(a), a)
check('phrasesDelai : le « sans agent » vient de par_agent', a.includes('Dont 66 sans agent'), a)
check('phrasesDelai : la médiane du détail', p.startsWith('La moitié des leads sont appelés en moins de 18 min.'), p)
check('phrasesDelai : la queue du détail (10 sur 27)', p.endsWith('Mais 10 sur 27 ont attendu plus de 3 h.'), p)
check('phrasesDelai : aucune donnée → aucune phrase', phrasesDelai(null).length === 0)
// chaque nombre dit est un nombre du détail
const nombres = (s) => (s.match(/\d+/g) || []).map(Number)
check('chaque nombre de la phrase d’attente vient du détail', nombres(a).every((x) => [77, 17, 66].includes(x)), JSON.stringify(nombres(a)))
check('chaque nombre de la phrase des pris en charge vient du détail', nombres(p).every((x) => [18, 10, 27, 3].includes(x)), JSON.stringify(nombres(p)))
check('jamais « premier appel » (ce n’est pas ce qui est mesuré)', !/premier appel/i.test(a + p))

console.log(`\n${ok} PASS, ${ko} FAIL`)
process.exit(ko ? 1 : 0)
