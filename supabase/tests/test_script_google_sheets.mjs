// Le code Apps Script généré pour « Mon API » → Google Sheets, exécuté HORS
// de Google : une fausse feuille, un faux CRM, de faux déclencheurs.
// Ce que ce test ne prouve pas (à essayer sur une vraie feuille) : que
// Google appelle bien les déclencheurs, l'écran d'autorisation, les quotas
// d'Apps Script.
//
//   node supabase/tests/test_script_google_sheets.mjs
import { genererScriptSheets, SECRET_A_REMPLIR, colonnesSheets } from '../../lib/scriptGoogleSheets.mjs'
import { CHAMPS_IMPORT } from '../../lib/modeleImport.mjs'
import { cleNormalisee } from '../functions/_shared/champs.ts'

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ' + extra)) }

const URL_F = 'https://exemple.supabase.co/functions/v1/import-commande'
const ENTETES = ['Order ID', 'Product', 'Customer', 'Phone number', 'City', 'Address', 'Quantities', 'Montant à encaisser', 'Store', 'Statut CRM']

// ENTETES : l'ANCIEN modèle, en anglais, volontairement — les feuilles déjà
// en place (le 27/10) ont ces en-têtes et doivent continuer à marcher sans
// qu'on y touche. Le modèle français est testé au §FR, en fin de fichier.

// ---- la fausse feuille ------------------------------------------------------
function feuille(nom, lignes) {
  const data = lignes.map((l) => [...l])
  const largeur = () => Math.max(0, ...data.map((l) => l.length))
  const affiche = (v) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v))
  const f = {
    data, ecritures: [],
    getName: () => nom,
    getLastColumn: () => largeur(),
    getRange: (row, col, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => data[row - 1 + i]?.[col - 1 + j] ?? '')),
      getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => affiche(data[row - 1 + i]?.[col - 1 + j] ?? ''))),
      getValue: () => data[row - 1]?.[col - 1] ?? '',
      setValue: (v) => { while (data.length < row) data.push([]); data[row - 1][col - 1] = v; f.ecritures.push([row, col, v]) },
    }),
  }
  return f
}
const plage = (f, debut, fin = debut) => ({ getSheet: () => f, getRow: () => debut, getLastRow: () => fin })
const statutDe = (f, ligne) => f.data[ligne - 1][ENTETES.indexOf('Statut CRM')]

// ---- le faux CRM et le faux Google --------------------------------------------
function environnement({ feuilles, reponses = [] }) {
  const appels = [], triggers = [], sommeils = []
  let verrouLibre = true
  const env = {
    SpreadsheetApp: { getActive: () => ({ getSheets: () => feuilles }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        appels.push({ url, opts })
        const r = reponses.length ? reponses.shift() : { code: 200, corps: { success: true, resultats: JSON.parse(opts.payload).leads?.map(() => ({ status: 'importe' })) } }
        if (r.reseau) throw new Error('DNS')
        return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.corps ?? {}), getHeaders: () => r.entetes ?? {} }
      },
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, t })),
      deleteTrigger: (x) => triggers.splice(triggers.indexOf(x.t), 1),
      newTrigger: (fn) => ({ forSpreadsheet: () => ({
        onEdit: () => ({ create: () => triggers.push({ fn, quoi: 'edit' }) }),
        onFormSubmit: () => ({ create: () => triggers.push({ fn, quoi: 'form' }) }),
      }) }),
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => { if (!verrouLibre) return false; verrouLibre = false; return true }, releaseLock: () => { verrouLibre = true } }) },
    Utilities: {
      sleep: (ms) => sommeils.push(ms),
      formatDate: (d, _tz, _f) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14),
    },
    console: { log: (...a) => env.journal.push(a.join(' ')) },
    journal: [], appels, triggers, sommeils,
  }
  return env
}
function charger(code, env) {
  const noms = ['SpreadsheetApp', 'UrlFetchApp', 'ScriptApp', 'LockService', 'Utilities', 'console']
  return new Function(...noms, `${code}\nreturn { installer, envoyerAuCRM };`)(...noms.map((n) => env[n]))
}
const code = genererScriptSheets({ urlFonction: URL_F, cle: 'fgm_CLE', secret: 'fgu_SECRET', nomSource: 'Ma boutique', date: new Date('2026-10-23') })
const ligneOk = (id = '727') => [id, 'colontea', 'Ana', '+244 923 111 001', 'Luanda', '', 2, 45000, 'Boutique']

// ---- 0. le code lui-même
check('le code généré se charge (syntaxe valide)', (() => { try { charger(code, environnement({ feuilles: [] })); return true } catch (e) { console.log(e); return false } })())
check('URL : ?source=google-sheet, ni key= ni secret=', code.includes(`${URL_F}?source=google-sheet`) && !/[?&](key|secret|token)=/.test(code))
check('clé et secret dans le code, en en-têtes x-import-token / x-api-secret', code.includes('"fgm_CLE"') && code.includes('"fgu_SECRET"') && code.includes('"x-import-token": CLE_API') && code.includes('"x-api-secret": SECRET_API'))
check('@OnlyCurrentDoc : l\'autorisation ne couvre que cette feuille', code.includes('/** @OnlyCurrentDoc */'))
check('le commentaire « pas de suivi des lignes » est dans le code', code.includes('Pas de suivi des lignes déjà envoyées'))
check('l\'avertissement sur les éditeurs de la feuille est dans le code', code.includes('toute personne qui peut MODIFIER cette'))
check('sans secret : le code porte le texte à remplacer', genererScriptSheets({ urlFonction: URL_F, cle: 'fgm_CLE', secret: null }).includes(SECRET_A_REMPLIR))
const requis = colonnesSheets().filter((c) => c.obligatoire).map((c) => c.nom).join(', ')
check('obligatoires = requisFeuille du modèle, en français', requis === 'N° de commande, Produit, Client, Téléphone, Ville, Quantité, Montant à encaisser', requis)
check('les colonnes sont celles du modèle CSV, dans son ordre', colonnesSheets().map((c) => c.nom).join() === CHAMPS_IMPORT.map((c) => c.nom).join())

// ---- 1. une ligne complète
let f = feuille('Commandes', [ENTETES, ligneOk()])
let env = environnement({ feuilles: [f] })
let s = charger(code, env)
s.envoyerAuCRM({ range: plage(f, 2) })
let corps = JSON.parse(env.appels[0]?.opts.payload ?? '{}')
check('ligne complète : un appel, en POST, JSON, en-têtes clé + secret', env.appels.length === 1 && env.appels[0].opts.method === 'post' &&
  env.appels[0].opts.contentType === 'application/json' && env.appels[0].opts.headers['x-import-token'] === 'fgm_CLE' && env.appels[0].opts.headers['x-api-secret'] === 'fgu_SECRET')
check('… corps { leads: [ … ] } avec les champs de l\'API', JSON.stringify(corps) === JSON.stringify({ leads: [{
  lead_id: 'GS-727', produit: 'colontea', client_nom: 'Ana', client_telephone: '+244 923 111 001', ville_zone: 'Luanda', quantite: 2, prix: 45000, source_sheet: 'Boutique' }] }), JSON.stringify(corps))
check('… Statut CRM = « importé »', statutDe(f, 2) === 'importé', statutDe(f, 2))

// ---- 2. les réponses du CRM
const avec = (resultat) => ({ code: 200, corps: { success: true, resultats: [resultat] } })
for (const [nom, rep, attendu] of [
  ['déjà reçue → « déjà importé »', avec({ status: 'doublon' }), 'déjà importé'],
  ['refus « Téléphone manquant » → « refusé : téléphone manquant »', avec({ status: 'rejete', error: 'Téléphone manquant' }), 'refusé : téléphone manquant'],
  ['401 → clé ou secret refusés', { code: 401, corps: { error: 'Jeton inconnu ou source désactivée' } }, 'refusé : clé ou secret API refusés (régénérés ?)'],
  ['400 de tout le lot → le motif', { code: 400, corps: { error: 'JSON illisible' } }, 'refusé : JSON illisible'],
  ['réseau coupé → « erreur réseau, réessayez »', { reseau: true }, 'erreur réseau, réessayez'],
  ['500 → « erreur du CRM (code 500), réessayez »', { code: 500, corps: {} }, 'erreur du CRM (code 500), réessayez'],
]) {
  f = feuille('Commandes', [ENTETES, ligneOk()]); env = environnement({ feuilles: [f], reponses: [rep] })
  charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
  check(nom, statutDe(f, 2) === attendu, statutDe(f, 2))
}

// ---- 3. 429 : attendre, réessayer une fois
f = feuille('Commandes', [ENTETES, ligneOk()])
env = environnement({ feuilles: [f], reponses: [{ code: 429, entetes: { 'Retry-After': '12' } }, avec({ status: 'importe' })] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('429 puis 200 : deux appels, attente = Retry-After (12 s), « importé »', env.appels.length === 2 && env.sommeils[0] === 12000 && statutDe(f, 2) === 'importé', JSON.stringify(env.sommeils))
f = feuille('Commandes', [ENTETES, ligneOk()])
env = environnement({ feuilles: [f], reponses: [{ code: 429, entetes: { 'retry-after': '90' } }, { code: 429 }] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('429 deux fois : UN seul nouvel essai, attente plafonnée à 30 s, « trop de requêtes, réessayez »',
  env.appels.length === 2 && env.sommeils[0] === 30000 && statutDe(f, 2) === 'trop de requêtes, réessayez', JSON.stringify([env.appels.length, env.sommeils, statutDe(f, 2)]))

// ---- 4. une ligne incomplète ne part pas
f = feuille('Commandes', [ENTETES, ['727', 'colontea', 'Ana', '+244923111001', 'Luanda', '', '', '', '']])
env = environnement({ feuilles: [f] }); charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('ligne sans montant ni quantité : rien n\'est envoyé', env.appels.length === 0)
check('… Statut CRM dit ce qui manque', statutDe(f, 2) === 'en attente : il manque Quantities, Montant à encaisser', statutDe(f, 2))
f.data[1][6] = 1; f.data[1][7] = 35000
charger(code, env).envoyerAuCRM({ range: plage(f, 2, 2) })
check('… complétée, elle part et devient « importé »', env.appels.length === 1 && statutDe(f, 2) === 'importé')
f = feuille('Commandes', [ENTETES, ['', 'colontea', 'Ana', '+244923111001', 'Luanda', '', 1, 35000, '']])
env = environnement({ feuilles: [f] }); charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('sans Order ID : rien n\'est envoyé, Statut CRM le dit', env.appels.length === 0 && statutDe(f, 2) === 'en attente : il manque Order ID', statutDe(f, 2))
f = feuille('Commandes', [ENTETES.filter((h) => h !== 'Montant à encaisser'), ['727', 'colontea', 'Ana', '+244923111001', 'Luanda', '', 1, '', '']])
env = environnement({ feuilles: [f] }); charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('colonne obligatoire absente de la feuille : rien n\'est envoyé, « (colonne absente) »', env.appels.length === 0 &&
  f.data[1][8] === 'en attente : il manque Montant à encaisser (colonne absente)', String(f.data[1][8]))

// ---- 5. plusieurs lignes, 50 au plus
const soixante = Array.from({ length: 60 }, (_, i) => ligneOk(String(1000 + i)))
f = feuille('Commandes', [ENTETES, ...soixante])
env = environnement({ feuilles: [f] }); charger(code, env).envoyerAuCRM({ range: plage(f, 2, 61) })
corps = JSON.parse(env.appels[0].opts.payload)
check('collage de 60 lignes : UN appel de 50 lignes', env.appels.length === 1 && corps.leads.length === 50 && corps.leads[49].lead_id === 'GS-1049')
check('… les 50 premières « importé », les 10 suivantes le disent', statutDe(f, 51) === 'importé' &&
  statutDe(f, 52) === 'non envoyé : plus de 50 lignes à la fois, retouchez une case de la ligne' && statutDe(f, 61).startsWith('non envoyé'), statutDe(f, 52))
f = feuille('Commandes', [ENTETES, ligneOk('1'), ['2', 'colontea', '', '+244923111002', 'Luanda', '', 1, 35000, ''], ligneOk('3')])
env = environnement({ feuilles: [f], reponses: [{ code: 200, corps: { resultats: [{ status: 'importe' }, { status: 'doublon' }] } }] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2, 4) })
check('trois lignes dont une incomplète : les deux complètes partent, chaque ligne a SON statut',
  JSON.parse(env.appels[0].opts.payload).leads.map((l) => l.lead_id).join() === 'GS-1,GS-3' &&
  statutDe(f, 2) === 'importé' && statutDe(f, 3) === 'en attente : il manque Customer' && statutDe(f, 4) === 'déjà importé',
  JSON.stringify([2, 3, 4].map((l) => statutDe(f, l))))

// ---- 6. ce qui n'envoie rien
f = feuille('Commandes', [ENTETES, ligneOk()]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 1) })
check('modifier la ligne 1 (en-têtes) : rien', env.appels.length === 0)
const notes = feuille('Notes', [['Titre', 'Texte'], ['a', 'b']]); env = environnement({ feuilles: [notes] })
charger(code, env).envoyerAuCRM({ range: plage(notes, 2) })
check('onglet sans colonne téléphone : rien, rien d\'écrit', env.appels.length === 0 && notes.ecritures.length === 0)
f = feuille('Commandes', [ENTETES, ligneOk(), ['', '', '', '', '', '', '', '', '', 'importé']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 3) })
check('ligne vidée : rien d\'envoyé, son ancien statut est effacé', env.appels.length === 0 && statutDe(f, 3) === '')
env = environnement({ feuilles: [] }); charger(code, env).envoyerAuCRM(undefined)
check('lancée à la main sans évènement : un message, rien d\'envoyé', env.appels.length === 0 && /exécutez « installer »/.test(env.journal.join()))

// ---- 7. sans colonne « Statut CRM »
const sansStatut = ENTETES.slice(0, -1)
f = feuille('Commandes', [sansStatut, ligneOk().slice(0, 9)]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('sans colonne Statut CRM : la ligne part, rien n\'est écrit dans la feuille', env.appels.length === 1 && f.ecritures.length === 0)

// ---- 8. valeurs de tableur
f = feuille('Commandes', [ENTETES, [727, 'colontea', 'Ana', 244923111001, 'Luanda', '', 3, 58000, '']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
corps = JSON.parse(env.appels[0].opts.payload).leads[0]
check('nombres : Order ID et téléphone en texte sans exposant, montant et quantité en nombres',
  corps.lead_id === 'GS-727' && corps.client_telephone === '244923111001' && corps.prix === 58000 && corps.quantite === 3, JSON.stringify(corps))
f = feuille('Commandes', [ENTETES, ['GS-12', 'colontea', 'Ana', '+244923111001', 'Luanda', '', 1, 35000, '']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('Order ID déjà « GS-12 » : pas de double préfixe', JSON.parse(env.appels[0].opts.payload).leads[0].lead_id === 'GS-12')
f = feuille('Commandes', [['ORDER ID', 'Produto', 'Cliente', 'Telefone', 'Cidade', 'Quantidade', 'Valor', 'statut crm'],
  ['9', 'colontea', 'Ana', '+244923111001', 'Luanda', 1, 35000, '']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('en-têtes en portugais / casse différente : reconnus (la table de champs.ts), statut écrit',
  env.appels.length === 1 && f.data[1][7] === 'importé', JSON.stringify(f.data[1]))

// ---- 9. Google Form
const H = ['Horodateur', 'Product', 'Customer', 'Phone number', 'City', 'Quantities', 'Montant à encaisser', 'Order ID', 'Statut CRM']
const quand = new Date('2026-10-23T14:30:05Z')
f = feuille('Réponses au formulaire 1', [H, [quand, 'colontea', 'Ana', '+244 923 111 001', 'Luanda', 1, 35000, '', '']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2), namedValues: {}, values: [] })
check('réponse de formulaire sans Order ID : un Order ID est fait (date + fin du téléphone)',
  JSON.parse(env.appels[0].opts.payload).leads[0].lead_id === 'GS-F20261023143005-1001', env.appels[0]?.opts.payload)
check('… écrit dans la colonne Order ID, statut « importé »', f.data[1][7] === 'F20261023143005-1001' && f.data[1][8] === 'importé', JSON.stringify(f.data[1]))
charger(code, env).envoyerAuCRM({ range: plage(f, 2) })
check('… la même ligne renvoyée plus tard (modification) : le MÊME Order ID',
  JSON.parse(env.appels[1].opts.payload).leads[0].lead_id === 'GS-F20261023143005-1001')
const H2 = H.filter((h) => h !== 'Order ID')
f = feuille('Réponses', [H2, [quand, 'colontea', 'Ana', '+244923111001', 'Luanda', 1, 35000, '']]); env = environnement({ feuilles: [f] })
charger(code, env).envoyerAuCRM({ range: plage(f, 2), namedValues: {} })
check('formulaire sans colonne Order ID : l\'Order ID est fait quand même, rien d\'écrit à sa place',
  env.appels.length === 1 && JSON.parse(env.appels[0].opts.payload).leads[0].lead_id.startsWith('GS-F2026') && f.ecritures.every(([, c]) => c === H2.length))

// ---- 10. installer
f = feuille('Commandes', [ENTETES, ligneOk()])
const ping = { code: 200, corps: { status: 'ping' } }
env = environnement({ feuilles: [f], reponses: [ping, ping] })
s = charger(code, env); s.installer()
check('installer : un ping (texte « webhook_id=0 ») avec les en-têtes', env.appels[0].opts.payload === 'webhook_id=0' && env.appels[0].opts.headers['x-api-secret'] === 'fgu_SECRET')
check('… pose « modification » ET « envoi de formulaire » sur envoyerAuCRM', env.triggers.map((t) => t.fn + ':' + t.quoi).join() === 'envoyerAuCRM:edit,envoyerAuCRM:form')
check('… dit ce qu\'il a trouvé', /toutes les colonnes obligatoires sont là/.test(env.journal.join()) && /Installation terminée/.test(env.journal.join()))
s.installer()
check('relancer installer : toujours deux déclencheurs, pas quatre', env.triggers.length === 2, env.triggers.length)
const erreurInstall = (cd, rep, fs = [feuille('Commandes', [ENTETES])]) => {
  const e = environnement({ feuilles: fs, reponses: rep ? [rep] : [] })
  try { charger(cd, e).installer(); return { msg: null, e } } catch (x) { return { msg: x.message, e } }
}
let r = erreurInstall(genererScriptSheets({ urlFonction: URL_F, cle: 'fgm_CLE', secret: null }), { code: 200 })
check('installer sans secret : erreur en clair, aucun appel, aucun déclencheur', /Le secret API manque/.test(r.msg || '') && r.e.appels.length === 0 && r.e.triggers.length === 0, r.msg)
r = erreurInstall(code, { code: 401, corps: {} })
check('installer, clé ou secret refusés : erreur en clair, aucun déclencheur', /refuse la clé ou le secret/.test(r.msg || '') && r.e.triggers.length === 0, r.msg)
r = erreurInstall(code, { code: 200, corps: {} }, [feuille('Notes', [['Titre']])])
check('installer, aucun onglet avec un téléphone : erreur en clair (« Téléphone »), aucun déclencheur', /Aucun onglet n'a de colonne « Téléphone »/.test(r.msg || '') && r.e.triggers.length === 0, r.msg)
r = erreurInstall(code, { code: 200, corps: {} }, [feuille('Commandes', [['Order ID', 'Phone number']])])
check('installer, colonnes obligatoires absentes : installé, mais le journal les nomme', r.msg === null &&
  /COLONNES ABSENTES : Produit, Client, Ville, Quantité, Montant à encaisser/.test(r.e.journal.join()), r.e.journal.join())

// ---- §FR. Les en-têtes françaises (27/10) — et l'anglais toujours accepté
const FR = ['N° de commande', 'Produit', 'Client', 'Téléphone', 'Ville', 'Adresse', 'Quantité', 'Montant à encaisser', 'Boutique', 'Statut CRM']
const envoyerAvec = (entetes, ligne) => {
  const f = feuille('Commandes', [entetes, ligne])
  const e = environnement({ feuilles: [f] })
  charger(code, e).envoyerAuCRM({ range: plage(f, 2) })
  return { f, e, lead: e.appels[0] ? JSON.parse(e.appels[0].opts.payload).leads[0] : null }
}
const attendu = { lead_id: 'GS-727', produit: 'colontea', client_nom: 'Ana', client_telephone: '+244 923 111 001', ville_zone: 'Luanda', quantite: 2, prix: 45000, source_sheet: 'Boutique' }
const memeLead = (l) => !!l && Object.entries(attendu).every(([k, v]) => l[k] === v)
check('le code montre les noms français (COLONNES[].nom)', FR.slice(0, 9).every((n) => code.includes(JSON.stringify(n))))
check('le texte du code ne cite plus « Order ID » que pour dire qu\'il reste accepté',
  (code.match(/Order ID/g) || []).length === 1 && /anciens noms anglais \(Order ID/.test(code))
let x = envoyerAvec(FR, ligneOk())
check('feuille aux en-têtes FRANÇAISES : la ligne part, mêmes champs', memeLead(x.lead), JSON.stringify(x.lead))
x = envoyerAvec(ENTETES, ligneOk())
check('feuille aux en-têtes ANGLAISES (l\'ancien modèle, sans y toucher) : la même ligne part', memeLead(x.lead), JSON.stringify(x.lead))
const SANS_ACCENT = ['N de commande', 'PRODUIT', 'client', 'Telephone', 'VILLE', 'adresse', 'Quantite', 'Montant a encaisser', 'boutique', 'statut crm']
x = envoyerAvec(SANS_ACCENT, ligneOk())
check('en-têtes sans accents ni majuscules (« Telephone », « Quantite », « N de commande ») : la même ligne part', memeLead(x.lead), JSON.stringify(x.lead))
const DECOMPOSE = FR.map((h) => h.normalize('NFD'))
x = envoyerAvec(DECOMPOSE, ligneOk())
check('accents décomposés (é = e + ◌́, copier-coller d\'un Mac) : la même ligne part', memeLead(x.lead), JSON.stringify(x.lead))
const MELANGE = ['Nº de commande', 'Product', 'Cliente', 'Phone', 'Cidade', 'Address', 'Quantidade', 'Montant à encaisser', 'Store', 'Statut CRM']
x = envoyerAvec(MELANGE, ligneOk())
check('mélange (Nº, anglais, portugais) : la même ligne part', memeLead(x.lead), JSON.stringify(x.lead))
x = envoyerAvec(ENTETES, ['727', 'colontea', 'Ana', '+244 923 111 001', 'Luanda', '', '', 45000, 'Boutique'])
check('feuille anglaise, case vide : signalée sous SON nom (« il manque Quantities »)', x.e.appels.length === 0 && x.f.data[1][9] === 'en attente : il manque Quantities', x.f.data[1][9])
x = envoyerAvec(FR, ['727', 'colontea', 'Ana', '+244 923 111 001', 'Luanda', '', '', 45000, 'Boutique'])
check('feuille française, case vide : « il manque Quantité »', x.f.data[1][9] === 'en attente : il manque Quantité', x.f.data[1][9])
x = envoyerAvec(['Telephone', 'Statut CRM'], ['+244 1'])
check('colonne absente : nommée en français, « (colonne absente) »', /N° de commande \(colonne absente\)/.test(x.f.data[1][1] || ''), x.f.data[1][1])
r = erreurInstall(code, { code: 200, corps: {} }, [feuille('Commandes', [ENTETES])])
check('installer sur une feuille anglaise : rien d\'absent', r.msg === null && /toutes les colonnes obligatoires sont là/.test(r.e.journal.join()), r.e.journal.join())
r = erreurInstall(code, { code: 200, corps: {} }, [feuille('Commandes', [SANS_ACCENT])])
check('installer sur une feuille française sans accents : rien d\'absent', r.msg === null && /toutes les colonnes obligatoires sont là/.test(r.e.journal.join()), r.e.journal.join())

// normaliser_ (dans le code généré) = cleNormalisee (champs.ts) : LA MÊME
// normalisation des deux côtés, pas une comparaison de chaînes.
const normaliser = new Function(`${code}\nreturn normaliser_;`)()
const essais = [...FR, ...ENTETES, ...SANS_ACCENT, ...DECOMPOSE, ...MELANGE, 'Téléphone (WhatsApp)', '  N°  de   commande ', 'QUANTITÉ', 'Montant\u00a0à encaisser', 'Endereço', 'Telemóvel', 'Município', 'Ünïcödé', '', '123']
const diff = essais.filter((t) => normaliser(t) !== cleNormalisee(t))
check(`normaliser_ du code = cleNormalisee de champs.ts (${essais.length} en-têtes)`, diff.length === 0, JSON.stringify(diff))

console.log(`\n${ok} passed, ${ko} failed`)
process.exit(ko ? 1 : 0)
