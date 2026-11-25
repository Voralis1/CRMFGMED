// lib/texteNormalise.mjs (l'écran) contre public.texte_normalise (la base) :
// la même réponse sur chaque texte, sinon l'écran suggérerait un livreur que
// la base ne choisirait pas — ou l'inverse.
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import { texteNormalise } from '../../../lib/texteNormalise.mjs'
const R = new URL('../../', import.meta.url).pathname
const db = new PGlite()
let ok = 0, ko = 0
const check = (n, c, x = '') => { c ? ok++ : ko++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)) }

// unaccent_simple tel qu'en production (schéma réel), puis texte_normalise tel qu'entrepot_commande.sql le crée
// (sa seule définition depuis le 29/10 ; avant : zone_commande.sql).
const schema = fs.readFileSync(fs.readdirSync(R + 'migrations').map((f) => R + 'migrations/' + f)[0], 'utf8')
const unaccent = schema.match(/CREATE OR REPLACE FUNCTION public\.unaccent_simple[\s\S]*?\$function\$;/)[0]
await db.exec(unaccent)
const zone = fs.readFileSync(R + 'sql/entrepot_commande.sql', 'utf8')
await db.exec(zone.match(/create or replace function public\.texte_normalise[\s\S]*?\$\$;/)[0])

const essais = ['Luanda', 'luanda', 'LUANDA', '  Luanda  ', 'Luánda', 'LUÂNDA', 'Luanda   Sul', 'Luanda\tSul', 'Luanda\nSul',
  'Benguela', 'Ben', 'Anda', 'Kilamba Kiaxi ', 'Município', 'Endereço', 'Zango', 'Cidade de Luanda ', 'Ôndjiva', 'Ñ', 'Ç',
  'øslo', 'Łódź', 'Œuvre', 'ÿ', 'ß', '', '   ', null, '88', 'H588+H3', 'Hôtel', 'São Tomé', 'Brazzaville', 'Pointe-Noire', 'Ébolowa']
for (const e of essais) {
  const base = (await db.query('select public.texte_normalise($1) v', [e])).rows[0].v
  check(`« ${String(e).replace(/\s/g, '·')} » → ${JSON.stringify(base)}`, texteNormalise(e) === base, `écran : ${JSON.stringify(texteNormalise(e))}`)
}
console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko ? 1 : 0)
