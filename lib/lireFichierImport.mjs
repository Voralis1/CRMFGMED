// Les octets d'un fichier d'import, prêts pour XLSX.read — UNE fois, pour
// l'aperçu ET pour l'import de l'écran Commandes.
//
// Le piège (vu le 27/10) : un CSV enregistré en UTF-8 SANS BOM — l'export CSV
// de Google Sheets, de LibreOffice, de la plupart des outils — est lu par
// SheetJS (0.18) comme du Latin-1. « Téléphone » arrive « TÃ©lÃ©phone »,
// « N° de commande » arrive « NÂ° de commande », et aucune en-tête française
// accentuée n'est reconnue. Les en-têtes anglaises n'avaient pas d'accent :
// le problème ne s'était jamais vu. Les VALEURS aussi étaient abîmées
// (« Luánda » → « LuÃ¡nda », un nom de client, une ville qui ne trouvait plus
// sa zone).
//
// La règle : un fichier texte qui est de l'UTF-8 valide est décodé en UTF-8
// avant SheetJS. Un fichier qui n'en est pas (Latin-1, Windows-1252 : un CSV
// d'Excel « CSV (séparateur : point-virgule) ») est laissé à SheetJS, qui le
// lit déjà juste. Un classeur (xlsx, xls, ods) aussi : il porte son encodage.
//
// Testé hors navigateur : supabase/tests/test_entetes_import.mjs.
import { CHAMPS_IMPORT } from './modeleImport.mjs'
import { cleNormalisee, NOMS } from '../supabase/functions/_shared/champs.ts'

export function preparerFichierImport(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets)
  const binaire =
    (o[0] === 0x50 && o[1] === 0x4b) ||                // zip : xlsx, ods
    (o[0] === 0xd0 && o[1] === 0xcf)                   // OLE : xls
  const bom =
    (o[0] === 0xef && o[1] === 0xbb && o[2] === 0xbf) || // UTF-8 avec BOM
    (o[0] === 0xff && o[1] === 0xfe) ||                  // UTF-16 LE
    (o[0] === 0xfe && o[1] === 0xff)                     // UTF-16 BE
  if (binaire || bom) return { data: o, type: 'array' }
  try {
    return { data: new TextDecoder('utf-8', { fatal: true }).decode(o), type: 'string' }
  } catch {
    return { data: o, type: 'array' }
  }
}

// Les en-têtes sont comparées sous la forme de cleNormalisee (champs.ts) :
// accents retirés, minuscules, tout ce qui n'est ni lettre ni chiffre → « _ ».
// D'abord les noms exacts de champs.ts (français, anglais, portugais), puis
// le repli par mot contenu (`mots`), propre au tableur.

// Quelle en-tête du fichier correspond à ce champ — ou null.
export function enteteDe(entetes, cle) {
  const champ = CHAMPS_IMPORT.find((c) => c.cle === cle)
  if (!champ) return null
  for (const nom of NOMS[champ.champ]) {
    const trouve = entetes.find((e) => cleNormalisee(e) === nom)
    if (trouve) return trouve
  }
  for (const mot of champ.mots) {
    const trouve = entetes.find((e) => cleNormalisee(e).includes(mot))
    if (trouve) return trouve
  }
  return null
}

export function lireChamp(L, cle) {
  const champ = CHAMPS_IMPORT.find((c) => c.cle === cle)
  if (!champ) return ''
  for (const nom of NOMS[champ.champ]) {
    const v = L[nom]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  for (const mot of champ.mots) {
    for (const k of Object.keys(L)) {
      if (!k.includes(mot)) continue
      const v = L[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return v
    }
  }
  return ''
}
