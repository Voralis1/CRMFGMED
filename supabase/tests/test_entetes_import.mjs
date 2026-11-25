// Les en-têtes de colonnes (27/10) : le français est ce qu'on MONTRE et
// GÉNÈRE, l'anglais de l'ancien modèle et le portugais restent ACCEPTÉS.
// Sans base, sans navigateur : le vrai SheetJS du dépôt, les vraies fonctions
// de l'écran Commandes (lib/lireFichierImport.mjs), la vraie table de noms.
//
//   node supabase/tests/test_entetes_import.mjs
import fs from 'fs'
import { createRequire } from 'module'
import { CHAMPS_IMPORT, CONSIGNES_IMPORT, EXEMPLE_IMPORT, ANCIENNES_ENTETES, nomColonne } from '../../lib/modeleImport.mjs'
import { preparerFichierImport, enteteDe, lireChamp } from '../../lib/lireFichierImport.mjs'
import { NOMS, cleNormalisee } from '../functions/_shared/champs.ts'
const XLSX = createRequire(import.meta.url)('xlsx')
const R = new URL('../../', import.meta.url).pathname

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }

const FR = ['N° de commande', 'Produit', 'Client', 'Téléphone', 'Ville', 'Adresse', 'Quantité', 'Montant à encaisser', 'Boutique']

// ---- 1. Ce qu'on montre : une seule constante, en français
console.log('\n— 1. Le modèle montré')
check('les colonnes du modèle, dans l\'ordre', CHAMPS_IMPORT.map((c) => c.nom).join(' | ') === FR.join(' | '), CHAMPS_IMPORT.map((c) => c.nom).join(' | '))
check('pas de colonne pays dans le modèle', !CHAMPS_IMPORT.some((c) => /pays|country/i.test(c.nom) || c.champ === 'pays'))
check('l\'exemple a une valeur (ou un vide voulu) pour chaque colonne, sous son nom français',
  CHAMPS_IMPORT.every((c) => c.nom in EXEMPLE_IMPORT) && Object.keys(EXEMPLE_IMPORT).length === CHAMPS_IMPORT.length)
check('les consignes citent les colonnes par leur nom français',
  CONSIGNES_IMPORT.every((c) => FR.includes(c.titre)), CONSIGNES_IMPORT.map((c) => c.titre).join())
const anglais = /\b(Order ID|Product|Customer|Phone number|City|Address|Quantities|Store)\b/
// (Le texte de la consigne « Ville » cite City parmi les noms reconnus : voulu.)
check('aucun nom anglais dans ce qui est montré (noms, titres, exemple)',
  ![...CHAMPS_IMPORT.map((c) => c.nom), ...CONSIGNES_IMPORT.map((c) => c.titre), ...Object.keys(EXEMPLE_IMPORT)].some((t) => anglais.test(t)))
check('nomColonne(\'telephone\') = « Téléphone »', nomColonne('telephone') === 'Téléphone')

// ---- 2. La table de noms : chaque nom montré ET chaque ancien nom y est
console.log('\n— 2. champs.ts')
for (const c of CHAMPS_IMPORT) {
  check(`« ${c.nom} » est un nom de champs.ts (${c.champ})`, NOMS[c.champ].includes(cleNormalisee(c.nom)), cleNormalisee(c.nom))
}
ANCIENNES_ENTETES.forEach((h, i) => {
  check(`ancien « ${h} » toujours accepté, pour le même champ`, NOMS[CHAMPS_IMPORT[i].champ].includes(cleNormalisee(h)), cleNormalisee(h))
})
for (const c of CHAMPS_IMPORT) {
  const ailleurs = Object.entries(NOMS).filter(([k, v]) => k !== c.champ && v.includes(cleNormalisee(c.nom))).map(([k]) => k)
  check(`« ${c.nom} » n'est le nom d'aucun autre champ`, ailleurs.length === 0, ailleurs.join())
}

// ---- 3. L'écran Commandes : des fichiers réels, lus comme la page les lit
console.log('\n— 3. Import de fichier (lib/lireFichierImport.mjs)')
const lire = (octets) => {
  const { data, type } = preparerFichierImport(new Uint8Array(octets))
  const classeur = XLSX.read(data, { type })
  const feuille = classeur.Sheets[classeur.SheetNames[0]]
  const entetes = (XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '' })[0] || []).map((x) => String(x).trim())
  const lignes = XLSX.utils.sheet_to_json(feuille, { defval: '' }).map((ligne) => {
    const L = {}; for (const k in ligne) L[cleNormalisee(k)] = ligne[k]; return L
  })
  return { entetes, lignes }
}
const csv = (entetes, sep = ';') => entetes.join(sep) + '\n' + ['727', 'colontea', 'Aminata Diallo', '+244 923 111 001', 'Luánda', '', '2', '45000', 'Ma boutique'].join(sep) + '\n'
const attendu = { order_id: '727', produit: 'colontea', client: 'Aminata Diallo', telephone: '+244 923 111 001', ville: 'Luánda', quantite: 2, prix: 45000, store: 'Ma boutique' }
const tout = (r, nom) => {
  const manquent = CHAMPS_IMPORT.filter((c) => c.cle !== 'adresse' && !enteteDe(r.entetes, c.cle)).map((c) => c.nom)
  const L = r.lignes[0] || {}
  const faux = Object.entries(attendu).filter(([k, v]) => String(lireChamp(L, k)) !== String(v)).map(([k]) => `${k}=${lireChamp(L, k)}`)
  check(nom, manquent.length === 0 && faux.length === 0, `non reconnues : ${manquent.join(', ')} ; lues : ${faux.join(', ')} ; en-têtes : ${r.entetes.join(' | ')}`)
}
const bom = (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b])
tout(lire(Buffer.from(csv(FR), 'utf8')), 'CSV UTF-8 SANS BOM (export Google Sheets / LibreOffice), en-têtes françaises')
tout(lire(bom(Buffer.from(csv(FR), 'utf8'))), 'CSV UTF-8 avec BOM')
tout(lire(Buffer.from(csv(FR), 'latin1')), 'CSV Latin-1 / Windows-1252 (Excel « CSV point-virgule »)')
tout(lire(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv(FR, '\t'), 'utf16le')])), 'texte Unicode UTF-16 (Excel « Texte Unicode »)')
tout(lire(Buffer.from(csv(ANCIENNES_ENTETES, ','), 'utf8')), 'CSV aux en-têtes ANGLAISES de l\'ancien modèle')
tout(lire(Buffer.from(csv(['N de commande', 'PRODUIT', 'client', 'Telephone', 'VILLE', 'adresse', 'Quantite', 'Montant a encaisser', 'boutique']), 'utf8')), 'en-têtes sans accents ni majuscules')
tout(lire(Buffer.from(csv(FR.map((h) => h.normalize('NFD'))), 'utf8')), 'accents décomposés (NFD)')
tout(lire(Buffer.from(csv(['Nº de commande', 'Produto', 'Cliente', 'Telefone', 'Cidade', 'Endereço', 'Quantidade', 'Valor', 'Loja']), 'utf8')), 'en-têtes portugaises (et « Nº »)')
tout(lire(Buffer.from(csv(['Numéro de commande', 'Product', 'Client', 'Phone number', 'Ville', 'Address', 'Quantities', 'Montant à encaisser', 'Store']), 'utf8')), 'mélange français / anglais, « Numéro de commande »')
const classeur = (entetes) => {
  const c = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(c, XLSX.utils.aoa_to_sheet([entetes, ['727', 'colontea', 'Aminata Diallo', '+244 923 111 001', 'Luánda', '', 2, 45000, 'Ma boutique']]), 'Commandes')
  return XLSX.write(c, { type: 'buffer', bookType: 'xlsx' })
}
tout(lire(classeur(FR)), 'xlsx, en-têtes françaises (le modèle téléchargé)')
tout(lire(classeur(ANCIENNES_ENTETES)), 'xlsx, en-têtes anglaises (un ancien modèle rempli)')

// Le piège qui a motivé le décodage : sans lui, un CSV UTF-8 sans BOM rate
// « N° de commande » (lu « NÂ° de commande » : un numéro est inventé, la
// commande revient en double au prochain import) et abîme les valeurs
// (« Luánda »). « TÃ©lÃ©phone », lui, était rattrapé par le mot « phone ».
const brut = XLSX.read(new Uint8Array(Buffer.from(csv(FR), 'utf8')), { type: 'array' })
const brutes = XLSX.utils.sheet_to_json(brut.Sheets[brut.SheetNames[0]], { header: 1 })
check('(témoin) SheetJS seul, UTF-8 sans BOM : « N° de commande » non reconnu, « Luánda » abîmé — d\'où preparerFichierImport',
  enteteDe(brutes[0], 'order_id') === null && brutes[1][4] !== 'Luánda', brutes[0].join(' | ') + ' / ' + brutes[1][4])
const ascii = Buffer.from('Order ID,Phone number,City,Quantities,Unit price\n0012,244923111001,Luanda,2,"35,000"\n', 'utf8')
const avant = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(ascii), { type: 'array' }).Sheets.Sheet1, { header: 1 })
const apres = (() => { const { data, type } = preparerFichierImport(new Uint8Array(ascii)); return XLSX.utils.sheet_to_json(XLSX.read(data, { type }).Sheets.Sheet1, { header: 1 }) })()
check('un CSV sans accent est lu exactement comme avant (nombres, « 35,000 »)', JSON.stringify(avant) === JSON.stringify(apres), JSON.stringify(apres))
check('(rappel) l\'ancien en-tête « Unit price » reste lu comme montant', String(lireChamp(lire(ascii).lignes[0], 'prix')) === '35000')

// ---- 4. API_COMMANDES.md : les en-têtes françaises d'abord, les autres acceptées
console.log('\n— 4. API_COMMANDES.md')
const doc = fs.readFileSync(R + 'API_COMMANDES.md', 'utf8')
const section = doc.slice(doc.indexOf('### Une feuille Google : les en-têtes'), doc.indexOf('Votre numéro de commande est enregistré'))
for (const c of CHAMPS_IMPORT) {
  const ligne = section.split('\n').find((l) => l.startsWith(`| **${c.nom}** |`))
  check(`doc : « ${c.nom} » en premier, en gras`, !!ligne)
  if (!ligne) continue
  const autres = [...ligne.split('|')[2].matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const inconnus = autres.filter((a) => !NOMS[c.champ].includes(cleNormalisee(a)) && !c.mots.some((m) => cleNormalisee(a).includes(m)))
  check(`doc : chaque nom « aussi accepté » pour ${c.nom} l'est vraiment`, autres.length > 0 && inconnus.length === 0, inconnus.join())
}

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko ? 1 : 0)
