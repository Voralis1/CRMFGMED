// Les langues du CRM (25/11/2026). Ajouter une langue = un fichier de plus
// (copie de en.mjs, traduite) + une ligne ici. Rien d'autre à toucher.
import fr from './fr.mjs'
import en from './en.mjs'

export const LANGUES = [
  { code: 'fr', nom: 'Français', court: 'FR', locale: 'fr-FR', textes: fr },
  { code: 'en', nom: 'English', court: 'EN', locale: 'en-GB', textes: en },
]
export const LANGUE_DEFAUT = 'fr'
const parCode = Object.fromEntries(LANGUES.map((l) => [l.code, l]))

// La langue de l'écran, lisible hors de React (lib/messageErreur.mjs).
// Le fournisseur (app/context/LangueContext.js) la tient à jour.
let langueCourante = LANGUE_DEFAUT
export const langueActive = () => langueCourante
export function definirLangue(code) { langueCourante = parCode[code] ? code : LANGUE_DEFAUT }

// Le texte d'une clé : la langue demandée, sinon le français, sinon la clé.
// Pluriel : avec { n } ≤ 1, la clé « cle_1 » (le singulier) est prise si elle existe.
export function texteBrut(cle, code) {
  return parCode[code]?.textes[cle] ?? fr[cle]
}
export function traduire(cle, vars, code = langueCourante) {
  const singulier = vars && typeof vars.n === 'number' && Math.abs(vars.n) <= 1 ? texteBrut(cle + '_1', code) : undefined
  const brut = singulier ?? texteBrut(cle, code) ?? cle
  if (!vars) return brut
  return brut.replace(/\{(\w+)\}/g, (m, nom) => (vars[nom] !== undefined ? String(vars[nom]) : m))
}

export const localeDe = (code = langueCourante) => parCode[code]?.locale || 'fr-FR'
