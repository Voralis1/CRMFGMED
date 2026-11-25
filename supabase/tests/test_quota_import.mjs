// Le quota de import-commande, testé hors Deno.
//
//   node supabase/tests/test_quota_import.mjs
//
// Node 22.18+ lit le TypeScript de _shared/import.ts directement. Pas de base :
// consommer_quota est remplacé par un faux `rpc` qui note ce qu'on lui passe.
// Ce qui n'est PAS testé ici : l'ordre des étapes dans index.ts (Deno.serve,
// pas exécutable sous Node) — il se relit, il ne se teste pas.
import fs from 'fs'
import path from 'path'

const ICI = path.dirname(new URL(import.meta.url).pathname)
const RACINE = path.resolve(ICI, '../..')
const I = await import(path.join(RACINE, 'supabase/functions/_shared/import.ts'))

const WOO = fs.readFileSync(path.join(ICI, 'payloads', 'woocommerce_order.json'), 'utf8')
const SHOPIFY = fs.readFileSync(path.join(ICI, 'payloads', 'shopify_order.json'), 'utf8')

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => {
  cond ? ok++ : ko++
  console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ← ' + extra))
}
const eq = (nom, recu, attendu) =>
  check(nom, JSON.stringify(recu) === JSON.stringify(attendu),
        `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`)

const H = (o = {}) => new Headers(o)
const SOURCE = { id: 'src-123', limite_appels_minute: 30, limite_leads_minute: 300 }
const lot = (n) => JSON.stringify({ leads: Array.from({ length: n }, (_, i) => ({ nom: 'x' + i, telephone: String(i) })) })

// Un faux client : `rpc` répond ce qu'on lui dit, et garde les appels.
const fauxRpc = (reponse) => {
  const appels = []
  return {
    appels,
    rpc: async (nom, params) => {
      appels.push({ nom, params })
      if (typeof reponse === 'function') return reponse(nom, params)
      return reponse
    },
  }
}
const ETAT_OK = { autorise: true, appels: 1, unites: 1, restant: 59, reset_dans: 42 }
const ETAT_REFUS = { autorise: false, appels: 61, unites: 61, restant: 0, reset_dans: 17 }

// Les console.error de consommerQuota sont attendus : on les tait.
const erreurs = []
const consoleError = console.error
console.error = (...a) => erreurs.push(a.join(' '))

// ---------------------------------------------------------------------------
console.log('\n— 1. Quelle clé, quelles limites')
{
  eq('jeton valide → src:<id> et les limites de LA source',
     I.quotaPour(SOURCE, H({ 'x-forwarded-for': '1.2.3.4' }), 5),
     { cle: 'src:src-123', unites: 5, maxAppels: 30, maxUnites: 300 })
  eq('source sans limites lues → 60 / 600, jamais illimitée',
     I.quotaPour({ id: 's', limite_appels_minute: null, limite_leads_minute: undefined }, H(), 1),
     { cle: 'src:s', unites: 1, maxAppels: 60, maxUnites: 600 })
  eq('limite à 0 ou négative → défaut (0 bloquerait la source pour toujours)',
     I.quotaPour({ id: 's', limite_appels_minute: 0, limite_leads_minute: -5 }, H(), 1).maxAppels, 60)
  eq('sans jeton valide → ip:<premier x-forwarded-for>, 20 / 20',
     I.quotaPour(null, H({ 'x-forwarded-for': ' 41.82.1.9 , 10.0.0.1, 172.16.0.2' }), 3),
     { cle: 'ip:41.82.1.9', unites: 3, maxAppels: 20, maxUnites: 20 })
  eq('IPv6', I.quotaPour(null, H({ 'x-forwarded-for': '2001:db8::1' }), 1).cle, 'ip:2001:db8::1')
  eq('en-tête absent → clé constante', I.quotaPour(null, H(), 1).cle, I.CLE_IP_INCONNUE)
  eq('en-tête vide → la même clé constante', I.quotaPour(null, H({ 'x-forwarded-for': '' }), 1).cle, I.CLE_IP_INCONNUE)
  eq('premier élément vide (", 1.2.3.4") → constante, pas le proxy',
     I.quotaPour(null, H({ 'x-forwarded-for': ' , 1.2.3.4' }), 1).cle, I.CLE_IP_INCONNUE)
  const a = I.quotaPour(null, H(), 1), b = I.quotaPour(null, H({ 'user-agent': 'autre' }), 1)
  check('deux requêtes sans IP partagent le même quota (la limite ne s\'éteint pas)',
        a.cle === b.cle && a.maxAppels === 20 && a.maxUnites === 20)
  eq('IP géante coupée à 64 caractères', I.ipClient(H({ 'x-forwarded-for': 'a'.repeat(500) })).length, 64)
}

// ---------------------------------------------------------------------------
console.log('\n— 2. Combien de leads dans la requête')
{
  eq('un lead plat → 1', I.compterLeads(JSON.stringify({ nom: 'A', telephone: '1' })), 1)
  eq('commande WooCommerce (2 articles) → 1 lead', I.compterLeads(WOO), 1)
  eq('commande Shopify → 1 lead', I.compterLeads(SHOPIFY), 1)
  eq('lot de 200 → 200, pas 1', I.compterLeads(lot(200)), 200)
  eq('lot de 37 → 37', I.compterLeads(lot(37)), 37)
  eq('{ commandes: [..3] } → 3', I.compterLeads(JSON.stringify({ commandes: [{}, {}, {}] })), 3)
  eq('tableau nu de 4 → 4', I.compterLeads(JSON.stringify([{}, {}, {}, {}])), 4)
  eq('enveloppe { data: { leads: [..5] } } → 5',
     I.compterLeads(JSON.stringify({ data: { leads: [{}, {}, {}, {}, {}] } })), 5)
  eq('JSON illisible → 1 (la tentative coûte quand même)', I.compterLeads('{pas du json'), 1)
  eq('corps vide → 1', I.compterLeads(''), 1)
  eq('lot vide → 1', I.compterLeads(JSON.stringify({ leads: [] })), 1)
  eq('5000 d\'un coup → plafonné à MAX_LOT', I.compterLeads(lot(5000)), I.MAX_LOT)
  // Le compteur et l'import lisent le corps avec la MÊME fonction.
  for (const [nom, texte] of [['lot 37', lot(37)], ['Woo', WOO], ['tableau', '[{},{}]']]) {
    eq(`compterLeads = lignesDuCorps (${nom})`, I.compterLeads(texte), I.lignesDuCorps(JSON.parse(texte)).lignes.length)
  }
  eq('lignesDuCorps : une commande seule passe ENTIÈRE, lot=false',
     [I.lignesDuCorps(JSON.parse(WOO)).lignes[0].id, I.lignesDuCorps(JSON.parse(WOO)).lot], [727, false])
  eq('lignesDuCorps : { leads: [1] } est un lot', I.lignesDuCorps({ leads: [{}] }).lot, true)
}

// ---------------------------------------------------------------------------
console.log('\n— 3. L\'appel à consommer_quota')
{
  const sb = fauxRpc({ data: [ETAT_OK], error: null })
  const r = await I.appliquerQuota(sb, SOURCE, H(), lot(200))
  eq('accepté → null (la requête continue)', r, null)
  eq('paramètres envoyés', sb.appels, [{ nom: 'consommer_quota', params: {
    p_cle: 'src:src-123', p_unites: 200, p_max_appels: 30, p_max_unites: 300, p_fenetre_sec: 60 } }])

  const sb2 = fauxRpc({ data: [ETAT_OK], error: null })
  await I.appliquerQuota(sb2, null, H({ 'x-forwarded-for': '9.9.9.9' }), lot(3))
  eq('sans jeton : ip, 20/20, unités = leads', sb2.appels[0].params,
     { p_cle: 'ip:9.9.9.9', p_unites: 3, p_max_appels: 20, p_max_unites: 20, p_fenetre_sec: 60 })

  const sb3 = fauxRpc({ data: ETAT_OK, error: null })
  eq('réponse objet (pas tableau) acceptée aussi', await I.consommerQuota(sb3, I.quotaPour(null, H(), 1)), ETAT_OK)
}

// ---------------------------------------------------------------------------
console.log('\n— 4. Compteur en panne → la requête PASSE')
{
  const cas = [
    ['fonction absente (PGRST202)', fauxRpc({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })],
    ['erreur SQL', fauxRpc({ data: null, error: { message: 'Clé de quota vide' } })],
    ['rpc qui lève', fauxRpc(() => { throw new Error('réseau coupé') })],
    ['rpc rejetée', fauxRpc(() => Promise.reject(new Error('timeout')))],
    ['réponse vide', fauxRpc({ data: [], error: null })],
    ['réponse sans autorise', fauxRpc({ data: [{ appels: 1 }], error: null })],
    ['client sans rpc', {}],
  ]
  for (const [nom, sb] of cas) {
    let r = 'exception'
    try { r = await I.appliquerQuota(sb, SOURCE, H(), lot(10)) } catch { /* noté ci-dessous */ }
    eq(`${nom} → null, pas d'exception`, r, null)
  }
  check('la panne est journalisée', erreurs.length >= cas.length, String(erreurs.length))
  check('le journal ne contient ni la clé ni l\'IP', !erreurs.some((e) => e.includes('src-123') || e.includes('src:')),
        erreurs.join(' | '))
}

// ---------------------------------------------------------------------------
console.log('\n— 5. Le refus : 429')
{
  const sb = fauxRpc({ data: [ETAT_REFUS], error: null })
  const r = await I.appliquerQuota(sb, SOURCE, H(), lot(1), { 'Access-Control-Allow-Origin': '*' })
  check('refusé → une Response', r instanceof Response)
  eq('statut 429', r.status, 429)
  eq('Retry-After = reset_dans', r.headers.get('Retry-After'), '17')
  eq('X-RateLimit-Limit = limite d\'appels de la source', r.headers.get('X-RateLimit-Limit'), '30')
  eq('X-RateLimit-Remaining = 0', r.headers.get('X-RateLimit-Remaining'), '0')
  eq('CORS conservé', r.headers.get('Access-Control-Allow-Origin'), '*')
  check('Retry-After lisible depuis un navigateur',
        (r.headers.get('Access-Control-Expose-Headers') ?? '').includes('Retry-After'))
  eq('JSON', r.headers.get('Content-Type'), 'application/json')
  const texte = await r.text()
  const corps = JSON.parse(texte)
  eq('corps : success=false + message simple', [corps.success, typeof corps.error, Object.keys(corps)],
     [false, 'string', ['success', 'error']])
  check('le message ne dit rien de l\'intérieur',
        !/src|ip:|quota_|consommer|api_quota|sources_import|unites|leads/i.test(texte), texte)

  // Refusé par le compteur de LEADS alors qu'il reste des appels.
  const sb2 = fauxRpc({ data: [{ autorise: false, appels: 3, unites: 650, restant: 57, reset_dans: 30 }], error: null })
  const r2 = await I.appliquerQuota(sb2, SOURCE, H(), lot(200))
  eq('refus par les leads : Remaining = 0 quand même', r2.headers.get('X-RateLimit-Remaining'), '0')

  eq('reset_dans absurde → Retry-After ≥ 1',
     I.reponse429({ ...ETAT_REFUS, reset_dans: 0 }, I.quotaPour(null, H(), 1)).headers.get('Retry-After'), '1')
  eq('IP : X-RateLimit-Limit = 20',
     I.reponse429(ETAT_REFUS, I.quotaPour(null, H(), 1)).headers.get('X-RateLimit-Limit'), '20')
}

// ---------------------------------------------------------------------------
console.log('\n— 6. Le ping WooCommerce')
{
  check('webhook_id=12 reconnu (index.ts y répond avant le quota)', I.estPingWebhook('webhook_id=12'))
  check('un lead JSON n\'est pas un ping', !I.estPingWebhook(WOO))
}

console.error = consoleError
console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
