// L'intake générique, testé hors Deno sur de VRAIS payloads.
//
//   node supabase/tests/test_import_generique.mjs
//
// Node 22.18+ lit le TypeScript de _shared/import.ts directement (types
// retirés). Rien à installer : pas de base, un faux client Supabase en mémoire.
//
// Le test « plat comme avant » compare la nouvelle lecture à l'ANCIENNE,
// extraite de git au commit e174411 (avant ce changement), sur les mêmes
// payloads plats.
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'

const ICI = path.dirname(new URL(import.meta.url).pathname)
const RACINE = path.resolve(ICI, '../..')
const I = await import(path.join(RACINE, 'supabase/functions/_shared/import.ts'))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-ancien-'))
fs.writeFileSync(path.join(tmp, 'ancien.ts'),
  execSync('git show e174411:supabase/functions/_shared/import.ts', { cwd: RACINE }))
const ANCIEN = await import(path.join(tmp, 'ancien.ts'))

const charger = (f) => JSON.parse(fs.readFileSync(path.join(ICI, 'payloads', f), 'utf8'))
const WOO = charger('woocommerce_order.json')
const SHOPIFY = charger('shopify_order.json')

let ok = 0, ko = 0
const check = (nom, cond, extra = '') => {
  cond ? ok++ : ko++
  console.log((cond ? 'PASS ' : 'FAIL ') + nom + (cond ? '' : '  ← ' + extra))
}
const eq = (nom, recu, attendu) =>
  check(nom, JSON.stringify(recu) === JSON.stringify(attendu),
        `reçu ${JSON.stringify(recu)}, attendu ${JSON.stringify(attendu)}`)

// ---------------------------------------------------------------------------
console.log('\n— 1. WooCommerce, commande complète')
{
  const l = I.normaliser(WOO)
  eq('lead_id = id de la commande', l.lead_id, '727')
  eq('nom = billing prénom + nom (pas shipping)', l.client_nom, 'Aminata Diallo')
  eq('téléphone = billing.phone (pas shipping.phone)', l.client_telephone, '+221 77 123 45 67')
  eq('pays = billing.country ISO2', l.pays, 'SN')
  eq('ville = billing.city', l.ville_zone, 'Dakar')
  eq('adresse = billing.address_1', l.adresse, 'Sicap Liberté 6, villa 4412')
  eq('prix = total de la commande, tel qu\'écrit', l.prix, 31000)
  eq('notes = customer_note', l.notes, 'Appeler après 18h')
  eq('deux articles', l.articles?.length, 2)
  eq('article 1', l.articles?.[0], { produit: 'Crème Éclat 50ml', quantite: 2, prix: 12000, codes: ['CE-50', '93'] })
  eq('article 2 : sku vide sauté, product_id gardé', l.articles?.[1], { produit: 'Sérum Nuit', quantite: 1, prix: 5000, codes: ['22'] })
  eq('produit = texte joint', l.produit, 'Crème Éclat 50ml ×2 + Sérum Nuit ×1')
  eq('quantité = somme des articles', l.quantite, 3)
  check('aucun vendeur inventé', l.vendeur === undefined, l.vendeur)
}

// ---------------------------------------------------------------------------
console.log('\n— 2. Shopify, orders/create')
{
  const l = I.normaliser(SHOPIFY)
  eq('lead_id = id (pas order_number, pas customer.id)', l.lead_id, '5874120998912')
  eq('nom = billing_address.name, PAS le "#1001" de la racine', l.client_nom, 'Fatou Ndiaye')
  eq('téléphone = billing_address.phone (racine null, customer.phone ignoré)', l.client_telephone, '+221 76 555 44 33')
  eq('pays = "Senegal"', l.pays, 'Senegal')
  eq('pays_code = "SN" (deuxième chance)', l.pays_code, 'SN')
  eq('ville = billing (pas Thiès de customer.default_address)', l.ville_zone, 'Dakar')
  eq('adresse = billing_address.address1', l.adresse, 'Almadies, Route de Ngor')
  eq('prix = total_price (pas un "amount" de *_set)', l.prix, 29500)
  eq('notes = note', l.notes, 'Livrer au bureau')
  eq('article 1 : title, sku vide sauté → product_id puis variant_id',
     l.articles?.[0], { produit: 'Crème Éclat', quantite: 1, prix: 15000, codes: ['8123456789012', '44123456789012'] })
  eq('article 2', l.articles?.[1], { produit: 'Savon Karité', quantite: 2, prix: 6000, codes: ['SAV-KAR', '8123456789999', '44123456780000'] })
  eq('produit joint', l.produit, 'Crème Éclat ×1 + Savon Karité ×2')
  check('line_items[].vendor ne devient pas le vendeur (règle 4)', l.vendeur === undefined, l.vendeur)
}

// ---------------------------------------------------------------------------
console.log('\n— 3. Payloads plats : exactement comme avant')
const CHAMPS_ANCIENS = ['lead_id', 'client_nom', 'client_telephone', 'pays', 'pays_id', 'ville_zone',
  'adresse', 'produit', 'quantite', 'prix', 'vendeur', 'notes', 'commentaire_1', 'commentaire_2',
  'source_url', 'source_sheet']
const PLATS = [
  [{ nom: 'Awa', telephone: '+221771234567', pays: 'Sénégal', produit: 'Crème', prix: '15 000 CFA', quantite: '2', order_id: 'A-1' }, {}],
  [{ 'Nom client': 'Ibra', 'Téléphone ': '0612', 'PHONE': '0699', Ville: 'Dakar', Article: 'Savon', Montant: '1 250,50 DH' }, {}],
  [{ name: 'X', phone: '', tel: '0700', country_code: 'GA', city: 'Libreville', total: 9000 }, {}],
  [{ client_nom: 'Y', client_telephone: '011', pays_id: '00000000-0000-0000-0000-000000000001', notes: 'n', comment: 'c1', comment_2: 'c2', url: 'https://x', sheet: 'S' }, {}],
  [{ 'Numéro WhatsApp client': '+24101', telephone: '+24199', nom: 'Z' }, { client_telephone: 'Numéro WhatsApp client' }],
  [{ id: 99, nom: 'W', gsm: '+223', vendeur: 'v@x.com', qty: 3, amount: '12.5' }, {}],
  [{ 'Téléphone': '0611', telephone: '0622' }, {}],
]
for (const [p, m] of PLATS) {
  const a = ANCIEN.normaliser(p, m), n = I.normaliser(p, m)
  const diff = CHAMPS_ANCIENS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(n[k]))
  check(`identique à l'ancien : ${JSON.stringify(p).slice(0, 60)}…`, diff.length === 0,
        diff.map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(n[k])}`).join(', '))
}
{
  const n = I.normaliser({ nom: 'Awa', telephone: '1', produit: 'Crème', quantite: 2, code: 'CR-1', prix: 100 })
  eq('plat : un seul article, prix unitaire null (jamais calculé)', n.articles, [{ produit: 'Crème', quantite: 2, prix: null, codes: ['CR-1'] }])
  const sansNom = { first_name: 'Awa', last_name: 'Ba', telephone: '1' }
  eq('seul écart voulu : prénom + nom à plat, quand AUCUN nom n\'existe', [ANCIEN.normaliser(sansNom).client_nom, I.normaliser(sansNom).client_nom], [undefined, 'Awa Ba'])
  eq('… et un vrai nom reste prioritaire', I.normaliser({ name: 'Nom Complet', first_name: 'A', last_name: 'B' }).client_nom, 'Nom Complet')
}

// ---------------------------------------------------------------------------
console.log('\n— 4. Enveloppes')
{
  const dedans = { nom: 'Awa', telephone: '+221', pays: 'SN', produit: 'Crème' }
  eq('{"data": {...}} = le contenu', I.normaliser({ data: dedans }), I.normaliser(dedans))
  eq('{"payload": {"order": {...}}} : deux niveaux', I.normaliser({ payload: { order: dedans } }).client_telephone, '+221')
  eq('WooCommerce dans {"data": …}', I.normaliser({ data: WOO }).client_nom, 'Aminata Diallo')
  check('une enveloppe à liste n\'est PAS ouverte ({"leads": [...]})', Array.isArray(I.deballer({ leads: [dedans] }).racine.leads))
  check('une clé unique scalaire n\'est pas une enveloppe', I.deballer({ telephone: '1' }).racine.telephone === '1')
}

// ---------------------------------------------------------------------------
console.log('\n— 5. Mapping par source, chemins pointés')
{
  const app = {
    data: {
      ref_externe: 'APP-55',
      customer: { mobile: '+223 66 00 00 01', phone: '+223 00 00 00 00', full_name: 'Oumar Traoré' },
      lieu: { pays_iso: 'ML', ville: 'Bamako' },
      panier: [{ libelle: 'Huile Argan', nb: 3, sku: 'HA-1' }],
    },
  }
  const m = {
    client_telephone: 'customer.mobile', lead_id: 'ref_externe', pays: 'lieu.pays_iso',
    articles: 'panier',
  }
  const l = I.normaliser(app, m)
  eq('client_telephone: "customer.mobile" bat l\'alias phone', l.client_telephone, '+223 66 00 00 01')
  eq('lead_id par mapping', l.lead_id, 'APP-55')
  eq('pays par chemin', l.pays, 'ML')
  eq('ville trouvée seule (alias)', l.ville_zone, 'Bamako')
  eq('liste d\'articles désignée par le mapping', l.articles?.[0]?.codes, ['HA-1'])
  eq('chemin écrit AVEC l\'enveloppe : "data.customer.mobile"', I.normaliser(app, { client_telephone: 'data.customer.mobile' }).client_telephone, '+223 66 00 00 01')
  eq('chemin dans une liste : "line_items[1].sku"', I.normaliser(SHOPIFY, { notes: 'line_items[1].sku' }).notes, 'SAV-KAR')
  const p = I.normaliser({ ...app.data, panier: undefined, nom_article: 'Huile', quantite_x: '4' }, { produit: 'nom_article', quantite: 'quantite_x' })
  eq('mapping du produit : il gagne sur toute liste', [p.produit, p.quantite, p.articles?.length], ['Huile', 4, 1])
}

// ---------------------------------------------------------------------------
console.log('\n— 6. Collisions de feuilles')
{
  eq('billing.phone vide → shipping.phone', I.normaliser({ billing: { phone: '' }, shipping: { phone: '+2' } }).client_telephone, '+2')
  eq('shipping avant customer', I.normaliser({ customer: { phone: 'C' }, shipping: { phone: 'S' } }).client_telephone, 'S')
  eq('bloc acheteur avant la racine pour le téléphone', I.normaliser({ phone: 'R', billing: { phone: 'B' } }).client_telephone, 'B')
  check('customer.id ne devient JAMAIS lead_id', I.normaliser({ total: 5, customer: { id: 42, phone: '1' } }).lead_id === undefined)
  check('… même quand customer est la seule clé (pas une enveloppe)', I.normaliser({ customer: { id: 42, phone: '1' } }).lead_id === undefined)
  eq('racine avant profondeur pour la commande', I.normaliser({ meta: { total: 1 }, total: 2 }).prix, 2)
  eq('prénom de billing jamais collé au nom de shipping', I.normaliser({ billing: { first_name: 'A' }, shipping: { last_name: 'Z' } }).client_nom, 'A')
}

// ---------------------------------------------------------------------------
console.log('\n— 7. Pas de signature (retirée du produit le 20/10)')
const h = (o) => new Headers(o)
{
  check('import.ts n\'exporte plus de vérification de signature', I.verifierSignature === undefined)
  check('import.ts n\'exporte plus le compteur d\'échecs', I.noterEchecSignature === undefined)
  // Aucune ligne de CODE (hors commentaires) ne lit ou n'écrit une signature.
  const sansCommentaires = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const f of ['supabase/functions/_shared/import.ts', 'supabase/functions/import-commande/index.ts',
                   'supabase/functions/_shared/auth.ts', 'app/sources-import/page.js']) {
    const code = sansCommentaires(f)
    check(`${f} : aucun code ne touche à signature_* ni à noter_echec_signature`,
          !/signature_|noter_echec_signature|verifierSignature|reveler_secret_source|regler_signature_source|definir_secret_source|regenerer_secret_source/.test(code))
  }
}

// ---------------------------------------------------------------------------
console.log('\n— 8. Le jeton, trois façons')
{
  const T = 'fgm_' + 'a'.repeat(48)
  const req = (url, headers = {}) => new Request('https://x.supabase.co/functions/v1/import-commande' + url, { method: 'POST', headers })
  eq('x-import-token', I.jetonDepuisRequete(req('', { 'x-import-token': T })), T)
  eq('Authorization: Bearer fgm_…', I.jetonDepuisRequete(req('', { authorization: 'Bearer ' + T })), T)
  eq('Bearer JWT Supabase → pas un jeton de source (utilisateur connecté)', I.jetonDepuisRequete(req('', { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' })), null)
  eq('?token=', I.jetonDepuisRequete(req('?token=' + T + '&source=boutique')), T)
  eq('?key=&secret= (forme ShipLead)', I.jetonDepuisRequete(req('?key=' + T + '&secret=n-importe-quoi&source=shop')), T)
  eq('l\'en-tête passe avant l\'URL', I.jetonDepuisRequete(req('?token=autre', { 'x-import-token': T })), T)
  eq('rien → null', I.jetonDepuisRequete(req('?source=x')), null)
}

// ---------------------------------------------------------------------------
console.log('\n— 9. Produit au catalogue : code, puis nom sans accents, sinon rien')
const CATALOGUE = [
  { id: 'p1', product: 'Crème Éclat', code: 'CE-50' },
  { id: 'p2', product: 'Sérum Nuit', code: null },
  { id: 'p3', product: 'Savon Karité', code: '8123456789999' },
  { id: 'p4', product: 'Huile', code: 'H-1' },
  { id: 'p5', product: 'huile ', code: 'H-2' },
]
{
  const r = I.resoudreArticles([
    { produit: 'Nom inventé par la boutique', quantite: 2, prix: 1, codes: [' ce-50 '] },
    { produit: 'serum   nuit', quantite: 1, prix: null, codes: ['999'] },
    { produit: 'Savon', quantite: 2, prix: 6000, codes: ['SAV-KAR', '8123456789999'] },
    { produit: 'HUILE', quantite: 1, prix: null, codes: [] },
    { produit: 'Inconnu', quantite: 1, prix: null, codes: ['ZZ'] },
  ], CATALOGUE)
  eq('1. par code (casse, espaces) → nom EXACT du catalogue', r.articles[0], { produit: 'Crème Éclat', quantite: 2, prix: 1, code: 'CE-50' })
  eq('2. par nom sans accents ni espaces', r.articles[1], { produit: 'Sérum Nuit', quantite: 1, prix: null, code: null })
  eq('le code suivant est essayé quand le premier ne répond pas', r.articles[2].produit, 'Savon Karité')
  eq('deux produits au même nom → aucun n\'est pris', r.articles[3], { produit: 'HUILE', quantite: 1, prix: null, code: null })
  eq('3. inconnu : texte de la source gardé, code gardé', r.articles[4], { produit: 'Inconnu', quantite: 1, prix: null, code: 'ZZ' })
  eq('les inconnus sont nommés', r.inconnus, ['HUILE', 'Inconnu'])
  eq('texte joint sur les noms du catalogue', I.produitJoint(r.articles.slice(0, 2)), 'Crème Éclat ×2 + Sérum Nuit ×1')
}

// ---------------------------------------------------------------------------
console.log('\n— 10. importerLigne de bout en bout (faux Supabase)')
function fauxSupabase(base) {
  return {
    from(table) {
      const lignes = (base[table] ??= [])
      const filtres = []
      let op = 'select', charge, limite = null
      const executer = () => {
        if (op === 'insert') {
          // unique (tenant_id, coalesce(vendeur_id), coalesce(source_id), lead_id),
          // comme après lead_id_par_vendeur_source.sql (27/10)
          const memeCle = (r) => r.lead_id === charge.lead_id && r.tenant_id === charge.tenant_id &&
            (r.vendeur_id ?? null) === (charge.vendeur_id ?? null) && (r.source_id ?? null) === (charge.source_id ?? null)
          if (table === 'commandes' && lignes.some(memeCle)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint "commandes_lead_id_vendeur_source_key"' } }
          }
          const r = { id: crypto.randomUUID(), agent_id: null, ...charge }
          lignes.push(r)
          return { data: r, error: null }
        }
        let t = lignes.filter((r) => filtres.every(([k, v, mode]) => mode === 'in' ? v.includes(r[k] ?? null) : (r[k] ?? null) === v))
        if (limite !== null) t = t.slice(0, limite)
        if (op === 'update') { t.forEach((r) => Object.assign(r, charge)); return { data: null, error: null } }
        return { data: t, error: null }
      }
      const seul = () => { const r = executer(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data } }
      const b = {
        select: () => b,
        eq: (k, v) => { filtres.push([k, v]); return b },
        insert: (r) => { op = 'insert'; charge = r; return b },
        update: (r) => { op = 'update'; charge = r; return b },
        is: (k, v) => { filtres.push([k, v]); return b },
        in: (k, v) => { filtres.push([k, v, 'in']); return b },
        limit: (n) => { limite = n; return b },
        // Comme PostgREST : plus d'une ligne → erreur, data null.
        maybeSingle: async () => { const r = executer(); return Array.isArray(r.data) && r.data.length > 1 ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } } : seul() },
        single: async () => seul(),
        then: (ok, ko) => Promise.resolve(executer()).then(ok, ko),
      }
      return b
    },
  }
}
const TEN = 't-1'
const base = () => ({
  pays: [{ id: 'pays-sn', nom: 'Sénégal', code: 'SN', tenant_id: TEN }, { id: 'pays-ga', nom: 'Gabon', code: 'GA', tenant_id: TEN }],
  user_roles: [],
  produits: CATALOGUE.map((p) => ({ ...p, tenant_id: TEN })),
})
const ctx = { tenantId: TEN, sourceId: 'src-1', vendeurParDefaut: 'vendeur-1', origine: 'webhook', mapping: {}, etiquette: 'boutique-dakar', prefixeLead: 'SHOP1' }
{
  const db = base(), sb = fauxSupabase(db)
  const r = await I.importerLigne(sb, ctx, WOO)
  const c = db.commandes?.[0]
  eq('WooCommerce importé', r.statut, 'importe')
  eq('lead_id TEL QUEL (10/11, T18) : 727, sans préfixe de la source', [r.lead_id, c?.lead_id], ['727', '727'])
  eq('pays SN → Sénégal', c?.pays_id, 'pays-sn')
  eq('produit joint sur les noms du catalogue', c?.produit, 'Crème Éclat ×2 + Sérum Nuit ×1')
  eq('articles rangés', c?.articles, [
    { produit: 'Crème Éclat', quantite: 2, prix: 12000, code: 'CE-50' },
    { produit: 'Sérum Nuit', quantite: 1, prix: 5000, code: null },
  ])
  eq('quantité 3, prix 31000', [c?.quantite, c?.prix], [3, 31000])
  eq('adresse écrite (le livreur la lit)', c?.adresse, 'Sicap Liberté 6, villa 4412')
  eq('?source= → source_sheet', c?.source_sheet, 'boutique-dakar')
  eq('vendeur de la source', c?.vendeur_id, 'vendeur-1')
  eq('payload brut gardé tel quel', db.imports_bruts?.[0]?.payload?.billing?.first_name, 'Aminata')
  check('rien de non reconnu → pas de motif', db.imports_bruts?.[0]?.motif === null, db.imports_bruts?.[0]?.motif)

  const r2 = await I.importerLigne(sb, ctx, WOO)
  eq('WooCommerce ré-essaie : doublon (→ 200 deja_importe), pas d\'erreur', r2.statut, 'doublon')
  eq('… et aucune 2e commande', db.commandes.length, 1)

  const r3 = await I.importerLigne(sb, ctx, SHOPIFY)
  const s = db.commandes[1]
  eq('Shopify importé, "Senegal" sans accent → Sénégal', [r3.statut, s?.pays_id], ['importe', 'pays-sn'])
  eq('Shopify : Savon Karité trouvé par product_id', s?.articles?.[1]?.produit, 'Savon Karité')
  eq('Shopify : Crème Éclat trouvée par son nom (aucun code ne répond)', s?.articles?.[0], { produit: 'Crème Éclat', quantite: 1, prix: 15000, code: 'CE-50' })

  // Même commande, un article que le catalogue ne connaît pas.
  const autre = structuredClone(SHOPIFY)
  autre.id = 5874120998913
  autre.line_items[0].title = 'Lotion Inconnue'
  const r4 = await I.importerLigne(sb, ctx, autre)
  eq('article inconnu signalé sur le journal', db.imports_bruts[3]?.motif, 'Produit non reconnu : Lotion Inconnue')
  check('… mais le lead est importé quand même (un lead perdu = une commande perdue)', r4.statut === 'importe')
  check('… et l\'appelant n\'en apprend rien', r4.motif === undefined)
  eq('… l\'inconnu garde le texte de la source et son code', db.commandes[2]?.articles?.[0], { produit: 'Lotion Inconnue', quantite: 1, prix: 15000, code: '8123456789012' })
}
{
  const db = base(), sb = fauxSupabase(db)
  const r = await I.importerLigne(sb, { ...ctx, etiquette: null }, { nom: 'Awa', telephone: '+221 70', pays: 'Sénégal', produit: 'creme eclat', prix: '15000' })
  const c = db.commandes[0]
  eq('plat : importé', r.statut, 'importe')
  check('plat sans lead_id : clé AUTO-, jamais préfixée', c.lead_id.startsWith('AUTO-'), c.lead_id)
  eq('plat : nom corrigé sur le catalogue', c.produit, 'Crème Éclat')
  eq('plat : article', c.articles, [{ produit: 'Crème Éclat', quantite: 1, prix: null, code: 'CE-50' }])
  eq('plat : prix tel qu\'écrit, quantité 1', [c.prix, c.quantite], [15000, 1])
  eq('plat : pas d\'étiquette → source_sheet null', c.source_sheet, null)
}
{
  const db = base(), sb = fauxSupabase(db)
  const r = await I.importerLigne(sb, ctx, { nom: 'Sans produit', telephone: '1', pays: 'GA' })
  eq('sans produit : importé, articles null', [r.statut, db.commandes[0].articles, db.commandes[0].produit], ['importe', null, null])
}

// ---------------------------------------------------------------------------
console.log('\n— 11. lead_id : deux boutiques, deux entreprises')
{
  eq('cleExterne : numéro de la boutique gardé TEL QUEL, même avec un préfixe de source (10/11)', await I.cleExterne(TEN, { lead_id: '727' }, 'SHOP1'), '727')
  eq('cleExterne : sans source (saisie, Excel) → inchangé', await I.cleExterne(TEN, { lead_id: '727' }, null), '727')
  eq('cleExterne : un numéro qui porte un préfixe reste tel quel', await I.cleExterne(TEN, { lead_id: 'shop1-727' }, 'SHOP1'), 'shop1-727')
  eq('clesAnciennes : la forme d\'avant le 10/11 est cherchée aussi', I.clesAnciennes({ lead_id: '727' }, 'SHOP1'), ['SHOP1-727'])
  eq('clesAnciennes : déjà préfixé → rien de plus', I.clesAnciennes({ lead_id: 'shop1-727' }, 'SHOP1'), [])
  eq('clesAnciennes : "SHOP10-1" n\'est pas « déjà préfixé SHOP1 » (le tiret compte)', I.clesAnciennes({ lead_id: 'SHOP10-1' }, 'SHOP1'), ['SHOP1-SHOP10-1'])
  eq('clesAnciennes : sans préfixe de source → rien', I.clesAnciennes({ lead_id: '727' }, null), [])
  const auto = await I.cleExterne(TEN, { client_telephone: '1', produit: 'x' }, 'SHOP1')
  check('cleExterne : sans identifiant → AUTO- non préfixé', auto.startsWith('AUTO-'), auto)

  const db = base(), sb = fauxSupabase(db)
  db.pays.push({ id: 'pays-sn-b', nom: 'Sénégal', code: 'SN', tenant_id: 't-2' })
  const r1 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-1', prefixeLead: 'SHOP1' }, WOO)
  const r2 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-2', prefixeLead: 'SHOP2' }, WOO)
  eq('MÊME entreprise, deux boutiques, commande 727 chacune : deux commandes', [r1.statut, r2.statut, db.commandes.length], ['importe', 'importe', 2])
  eq('… toutes les deux « 727 » : l\'unicité vendeur + source les sépare', db.commandes.map((c) => c.lead_id), ['727', '727'])
  const r3 = await I.importerLigne(sb, { ...ctx, tenantId: 't-2', sourceId: 'src-3', prefixeLead: 'SHOP1' }, WOO)
  eq('AUTRE entreprise, même préfixe, même 727 : importé (unique par entreprise)', r3.statut, 'importe')
  const r4 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-2', prefixeLead: 'SHOP2' }, WOO)
  eq('ré-essai de la boutique 2 : doublon, pas une 4e commande', [r4.statut, r4.lead_id, db.commandes.length], ['doublon', '727', 3])
}

console.log('\n— 11 quater. T14 (10/11) : les produits du vendeur, puis ceux sans vendeur, jamais ceux d\'un autre')
{
  const cat = [
    { id: 'a1', product: 'ClearZal', code: 'clearzal', vendeur_id: 'v-A' },
    { id: 'b1', product: 'ClearZal', code: 'clearzal-b', vendeur_id: 'v-B' },
    { id: 's1', product: 'Commun', code: 'commun', vendeur_id: null },
    { id: 'b2', product: 'Commun B', code: 'commun', vendeur_id: 'v-B' },
  ]
  const lu = (codes, produit) => ({ codes, produit, quantite: 1, prix: null })
  eq('vendeur B, nom « ClearZal » (A et B l\'ont) → celui de B, sans ambiguïté', I.resoudreArticlesVendeur([lu([], 'ClearZal')], cat, 'v-B').articles[0].code, 'clearzal-b')
  eq('vendeur B, code « clearzal » (celui de A) → inconnu', I.resoudreArticlesVendeur([lu(['clearzal'], 'x')], cat, 'v-B').inconnus, ['x'])
  eq('vendeur A, code « commun » → le produit sans vendeur', I.resoudreArticlesVendeur([lu(['commun'], 'c')], cat, 'v-A').articles[0].produit, 'Commun')
  eq('vendeur B, code « commun » → le SIEN avant celui sans vendeur', I.resoudreArticlesVendeur([lu(['commun'], 'c')], cat, 'v-B').articles[0].produit, 'Commun B')
  eq('sans vendeur connu → tout le catalogue, comme avant', I.resoudreArticlesVendeur([lu(['clearzal-b'], 'x')], cat, null).articles[0].produit, 'ClearZal')
}

console.log('\n— 11 ter. T18 (10/11) : une commande reçue AVANT, avec le préfixe, renvoyée par la boutique')
{
  const db = base(), sb = fauxSupabase(db)
  // reçue le 05/11 : « SHOP1-727 » (l'ancienne règle)
  db.commandes = [{ id: 'ancienne', tenant_id: TEN, vendeur_id: 'vendeur-1', source_id: 'src-1', lead_id: 'SHOP1-727' }]
  const r = await I.importerLigne(sb, { ...ctx, sourceId: 'src-1', prefixeLead: 'SHOP1' }, WOO)
  eq('ré-envoi de 727 : « déjà importé » (trouvé sous SHOP1-727), pas une 2e commande', [r.statut, r.lead_id, db.commandes.length], ['doublon', 'SHOP1-727', 1])
  const autre = await I.importerLigne(sb, { ...ctx, sourceId: 'src-2', prefixeLead: 'SHOP2' }, WOO)
  eq('… mais la 727 d\'une AUTRE boutique est bien créée, « 727 »', [autre.statut, autre.lead_id, db.commandes.length], ['importe', '727', 2])
}

// ---------------------------------------------------------------------------
console.log('\n— 11 bis. Déjà vu ? Deux portées (27/10, lead_id_par_vendeur_source.sql)')
{
  // Un numéro de boutique est cherché comme l'index le juge : entreprise +
  // vendeur + source + numéro. Une clé AUTO- dans toute l'entreprise.
  const db = base(), sb = fauxSupabase(db)
  // Deux lignes portent DÉJÀ le texte exact « SHOP1-727 », chez d'autres :
  // le vendeur A par CSV (sans source) et le vendeur B par CSV.
  db.commandes = [
    { id: 'csv-a', tenant_id: TEN, lead_id: 'SHOP1-727', vendeur_id: 'vendeur-A', source_id: null },
    { id: 'csv-b', tenant_id: TEN, lead_id: 'SHOP1-727', vendeur_id: 'vendeur-B', source_id: null },
  ]
  const r1 = await I.importerLigne(sb, ctx, WOO)
  eq('n° de boutique pris ailleurs (autres vendeurs, sans source) : la commande ENTRE, rien n\'est avalé', [r1.statut, db.commandes.length], ['importe', 3])
  const r2 = await I.importerLigne(sb, ctx, WOO)
  eq('… le ré-essai de WooCommerce : déjà importé (200), pas un 400, pas une 4e commande', [r2.statut, db.commandes.length], ['doublon', 3])
  const r3 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-9' }, WOO)
  eq('même n° « SHOP1-727 », même vendeur, AUTRE source : entre (un vendeur, deux boutiques)', r3.statut, 'importe')
  const r4 = await I.importerLigne(sb, { ...ctx, vendeurParDefaut: 'vendeur-2' }, WOO)
  eq('même n°, même source, AUTRE vendeur : entre (portée exacte de l\'index)', r4.statut, 'importe')
  const r5 = await I.importerLigne(sb, { ...ctx, sourceId: null, prefixeLead: null }, { ...structuredClone(WOO), number: 'X1', id: 'X1' })
  const r6 = await I.importerLigne(sb, { ...ctx, sourceId: null, prefixeLead: null }, { ...structuredClone(WOO), number: 'X1', id: 'X1' })
  eq('sans source (source_id NULL) : cherché sur NULL, le renvoi est un doublon', [r5.statut, r6.statut], ['importe', 'doublon'])
}
{
  // AUTO- : toute l'entreprise, quelle que soit la boutique.
  const db = base(), sb = fauxSupabase(db)
  const flat = { nom: 'Awa', telephone: '+221 70 000', pays: 'Sénégal', produit: 'creme eclat', prix: '15000' }
  const a1 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-1' }, flat)
  const a2 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-2', vendeurParDefaut: 'vendeur-2' }, flat)
  eq('AUTO- : même client, même produit, même jour, AUTRE boutique et autre vendeur → doublon', [a1.statut, a2.statut, db.commandes.length], ['importe', 'doublon', 1])
  // Deux lignes portent la même clé AUTO- (deux boutiques au même instant) :
  db.commandes.push({ ...db.commandes[0], id: 'jumelle', source_id: 'src-2' })
  const a3 = await I.importerLigne(sb, { ...ctx, sourceId: 'src-1' }, flat)
  eq('… deux lignes portent déjà la clé : doublon quand même (plus de maybeSingle), pas de 400', [a3.statut, db.commandes.length], ['doublon', 2])
}

// ---------------------------------------------------------------------------
console.log('\n— 12. Clé + secret : l\'URL façon ShipLead / CodinAfrica (20/10)')
{
  const CLE = 'fgm_' + 'b'.repeat(48)
  const url = `https://x.supabase.co/functions/v1/import-commande?key=${CLE}&source=WooCommerce`
  const rq = (u, init = {}) => new Request(u, { method: 'POST', ...init })
  eq('?key= : la clé est lue comme jeton', I.jetonDepuisRequete(rq(url)), CLE)
  eq('?source=WooCommerce : étiquette lue', I.etiquetteDepuisRequete(rq(url)), 'WooCommerce')
  eq('?source= vide → null', I.etiquetteDepuisRequete(rq(url.replace('WooCommerce', '%20'))), null)
  eq('sans ?source= → null', I.etiquetteDepuisRequete(rq('https://x.co/f?key=' + CLE)), null)
  eq('étiquette coupée à 100', I.etiquetteDepuisRequete(rq('https://x.co/f?source=' + 'a'.repeat(300))).length, 100)
  check('?secret= dans l\'URL ne change pas la clé (ignoré)', I.jetonDepuisRequete(rq(url + '&secret=CODINAFRICA')) === CLE)

  const db = base(), sb = fauxSupabase(db)
  await I.importerLigne(sb, { ...ctx, etiquette: I.etiquetteDepuisRequete(rq(url)) }, WOO)
  eq('la commande porte source_sheet = "WooCommerce"', db.commandes[0]?.source_sheet, 'WooCommerce')

}

// ---------------------------------------------------------------------------
console.log('\n— 13. Secret API dans l\'URL (identifiants_api.sql)')
{
  const CLE = 'fgm_' + 'd'.repeat(48), SURL = 'fgu_' + 'e'.repeat(48)
  const rq = (qs) => new Request('https://x.supabase.co/functions/v1/import-commande?' + qs, { method: 'POST' })
  const exige = { secret_url: SURL, secret_url_requis: true }
  eq('exigé, bon secret → accepté', I.secretUrlValide(rq(`key=${CLE}&secret=${SURL}`), exige), true)
  eq('exigé, secret absent → refusé', I.secretUrlValide(rq(`key=${CLE}`), exige), false)
  eq('exigé, secret faux → refusé', I.secretUrlValide(rq(`key=${CLE}&secret=fgu_${'f'.repeat(48)}`), exige), false)
  eq('exigé, secret vide → refusé', I.secretUrlValide(rq(`key=${CLE}&secret=`), exige), false)
  eq('exigé, « CODINAFRICA » → refusé', I.secretUrlValide(rq(`key=${CLE}&secret=CODINAFRICA`), exige), false)
  eq('exigé, casse différente → refusé', I.secretUrlValide(rq(`key=${CLE}&secret=${SURL.toUpperCase()}`), exige), false)
  eq('exigé mais la source n\'en a pas → refusé (fermé)', I.secretUrlValide(rq(`secret=x`), { secret_url: null, secret_url_requis: true }), false)
  eq('non exigé (Zapier) : sans secret → accepté', I.secretUrlValide(rq(`key=${CLE}`), { secret_url: SURL, secret_url_requis: false }), true)
  // L'en-tête x-api-secret, au même titre que &secret= (comme la clé).
  const rqH = (qs, secret) => new Request('https://x.supabase.co/functions/v1/import-commande?' + qs,
    { method: 'POST', headers: { 'x-import-token': CLE, 'x-api-secret': secret } })
  eq('exigé, bon secret en EN-TÊTE x-api-secret → accepté', I.secretUrlValide(rqH('', SURL), exige), true)
  eq('exigé, en-tête faux → refusé', I.secretUrlValide(rqH('', 'fgu_' + 'f'.repeat(48)), exige), false)
  eq('exigé, en-tête vide et rien dans l\'URL → refusé', I.secretUrlValide(rqH('', '  '), exige), false)
  eq('exigé, en-tête vide mais bon &secret= → accepté', I.secretUrlValide(rqH(`secret=${SURL}`, ''), exige), true)
  eq('l\'en-tête passe en premier : en-tête faux + bon &secret= → refusé',
     I.secretUrlValide(rqH(`secret=${SURL}`, 'faux'), exige), false)
  eq('non exigé : secret faux → accepté quand même (non lu)', I.secretUrlValide(rq(`key=${CLE}&secret=n-importe`), { secret_url: SURL, secret_url_requis: false }), true)

  // sourceDeLaRequete sur un faux client : la lecture, le repli, le secret.
  // La ligne porte un secret de signature ET « Exiger la signature » allumé,
  // comme une source réglée avant le 20/10 : le faux client les rend même
  // s'ils ne sont pas demandés, pour prouver que le code les ignore.
  const SRC = { id: 'src-1', tenant_id: TEN, vendeur_id: 'vendeur-1', nom: 'b', type: 'webhook', mapping: {}, prefixe_lead: 'B',
                signature_entete: 'x-wc-webhook-signature', signature_algo: 'sha256', signature_encodage: 'base64',
                signature_prefixe: null, signature_secret: 'fgs_' + 'c'.repeat(48), signature_echecs: 0,
                limite_appels_minute: 60, limite_leads_minute: 600 }
  const faux = ({ colonnesAbsentes = false, tenant = 'actif', ligne = { ...SRC, secret_url: SURL, secret_url_requis: true } } = {}) => {
    const lectures = []
    return {
      lectures,
      from(table) {
        let cols = ''
        const chaine = {
          select(c) { cols = c; lectures.push({ table, cols }); return chaine },
          eq() { return chaine },
          async maybeSingle() {
            if (table === 'tenants') return { data: { statut: tenant }, error: null }
            if (colonnesAbsentes && cols.includes('secret_url')) {
              return { data: null, error: { code: '42703', message: 'column sources_import.secret_url does not exist' } }
            }
            if (!cols.includes('secret_url')) {
              const { secret_url, secret_url_requis, ...sans } = ligne
              return { data: sans, error: null }
            }
            return { data: ligne, error: null }
          },
        }
        return chaine
      },
    }
  }
  const avec = (qs) => rq(qs)
  let sb = faux()
  check('clé + bon secret → la source', (await I.sourceDeLaRequete(sb, avec(`key=${CLE}&secret=${SURL}`)))?.id === 'src-1')
  check('… lue avec secret_url et secret_url_requis', sb.lectures[0].cols.includes('secret_url_requis'))
  check('… et SANS aucune colonne signature_*', !sb.lectures.some((l) => /signature/.test(l.cols)), JSON.stringify(sb.lectures))
  eq('clé + secret faux → null, comme une clé inconnue', await I.sourceDeLaRequete(faux(), avec(`key=${CLE}&secret=faux`)), null)
  eq('clé sans secret → null', await I.sourceDeLaRequete(faux(), avec(`key=${CLE}`)), null)
  eq('pas de clé → null', await I.sourceDeLaRequete(faux(), avec(`secret=${SURL}`)), null)
  eq('entreprise suspendue, bon secret → null', await I.sourceDeLaRequete(faux({ tenant: 'suspendu' }), avec(`key=${CLE}&secret=${SURL}`)), null)
  sb = faux({ colonnesAbsentes: true })
  const repli = await I.sourceDeLaRequete(sb, avec(`key=${CLE}`))
  check('code déployé AVANT le SQL : repli sans les colonnes, la source passe sans secret',
        repli?.id === 'src-1' && repli.secret_url_requis === false && sb.lectures.length === 4, JSON.stringify(sb.lectures))
  // 21/10 : pays_defaut est lu par une requête À PART, pour que son absence ne
  // fasse jamais passer par le repli qui coupe la vérification du secret.
  check('pays_defaut lu à part, après la source', sb.lectures[3]?.cols === 'pays_defaut', JSON.stringify(sb.lectures))
  check('… et absent de la requête du jeton', !sb.lectures[0].cols.includes('pays_defaut'))
  // Même quota que pour une clé inconnue : la clé seule n'épuise pas la boutique.
  const q = I.quotaPour(await I.sourceDeLaRequete(faux(), avec(`key=${CLE}&secret=faux`)), new Headers({ 'x-forwarded-for': '9.9.9.9' }), 1)
  eq('secret faux → quota par IP, pas celui de la source', q.cle, 'ip:9.9.9.9')

  // De bout en bout, comme import-commande : source par la requête, puis
  // import. Un en-tête de signature FAUX est là, la ligne a un secret de
  // signature et l'exige — rien n'est vérifié, le lead entre.
  const importer = async (ligneSource, qs) => {
    const req = new Request('https://x.supabase.co/functions/v1/import-commande?' + qs,
      { method: 'POST', headers: { 'x-wc-webhook-signature': 'cette-signature-est-fausse' } })
    const src = await I.sourceDeLaRequete(faux({ ligne: ligneSource }), req)
    if (!src) return { src: null }
    const db = base(), sbImport = fauxSupabase(db)
    const r = await I.importerLigne(sbImport, {
      tenantId: src.tenant_id, sourceId: src.id, vendeurParDefaut: src.vendeur_id, origine: 'webhook',
      mapping: src.mapping ?? {}, etiquette: I.etiquetteDepuisRequete(req), prefixeLead: src.prefixe_lead,
    }, WOO)
    return { src, r, db }
  }
  let e2e = await importer({ ...SRC, secret_url: SURL, secret_url_requis: true }, `key=${CLE}&secret=${SURL}&source=WooCommerce`)
  check('BOUTIQUE (secret exigé), bon secret, signature fausse présente → importé',
        e2e.r?.statut === 'importe' && e2e.db.commandes.length === 1, JSON.stringify(e2e.r))
  check('… aucune écriture de compteur d\'échecs', !JSON.stringify(e2e.db.sources_import ?? []).includes('signature_echecs'))
  e2e = await importer({ ...SRC, secret_url: SURL, secret_url_requis: true }, `key=${CLE}&source=WooCommerce`)
  check('BOUTIQUE sans &secret= → refusée comme une clé inconnue (rien d\'importé)', e2e.src === null)
  e2e = await importer({ ...SRC, secret_url: SURL, secret_url_requis: false }, `key=${CLE}`)
  check('API DIRECTE (secret non exigé), la clé seule → importé', e2e.r?.statut === 'importe', JSON.stringify(e2e.r))

  // Tout en en-têtes (Postman, Zapier, script) : x-import-token + x-api-secret.
  const enTetes = async (ligneSource, entetes) => {
    const req = new Request('https://x.supabase.co/functions/v1/import-commande', { method: 'POST', headers: entetes })
    const src = await I.sourceDeLaRequete(faux({ ligne: ligneSource }), req)
    if (!src) return { src: null }
    const db = base()
    const r = await I.importerLigne(fauxSupabase(db), {
      tenantId: src.tenant_id, sourceId: src.id, vendeurParDefaut: src.vendeur_id, origine: 'webhook',
      mapping: {}, etiquette: null, prefixeLead: src.prefixe_lead,
    }, WOO)
    return { src, r }
  }
  const exigee = { ...SRC, secret_url: SURL, secret_url_requis: true }
  e2e = await enTetes(exigee, { 'x-import-token': CLE, 'x-api-secret': SURL })
  check('EN-TÊTES : x-import-token + x-api-secret, source qui exige le secret → importé', e2e.r?.statut === 'importe', JSON.stringify(e2e.r))
  e2e = await enTetes(exigee, { 'x-import-token': CLE })
  check('EN-TÊTES : x-import-token sans x-api-secret → refusé comme une clé inconnue', e2e.src === null)
  e2e = await enTetes(exigee, { authorization: `Bearer ${CLE}`, 'x-api-secret': SURL })
  check('EN-TÊTES : Bearer fgm_ + x-api-secret → importé', e2e.r?.statut === 'importe', JSON.stringify(e2e.r))
}

console.log('\n— 14. Le pays : champ du lead → pays par défaut de la source → refus (21/10)')
{
  const P = await import(path.join(RACINE, 'supabase/functions/_shared/pays.ts'))
  const L = [{ id: 'pays-ao', nom: 'Angola', code: 'AO' }, { id: 'pays-sn', nom: 'Sénégal', code: 'SN' }]
  eq('nom écrit → ce pays', P.resoudrePays({ liste: L, textes: ['Angola'] }).pays_id, 'pays-ao')
  eq('nom sans accent → Sénégal', P.resoudrePays({ liste: L, textes: ['senegal'] }).pays_id, 'pays-sn')
  eq('code ISO → ce pays', P.resoudrePays({ liste: L, textes: ['sn'] }).pays_id, 'pays-sn')
  eq('rien d\'écrit → le défaut', P.resoudrePays({ liste: L, defaut: 'pays-sn' }).pays_id, 'pays-sn')
  eq('écrit l\'emporte sur le défaut', P.resoudrePays({ liste: L, textes: ['Angola'], defaut: 'pays-sn' }).pays_id, 'pays-ao')
  check('écrit mais inconnu → refus, PAS le défaut', /introuvable/.test(P.resoudrePays({ liste: L, textes: ['Maroc'], defaut: 'pays-sn' }).motif ?? ''))
  check('ni écrit ni défaut → « Pays manquant »', /^Pays manquant/.test(P.resoudrePays({ liste: L }).motif ?? ''))
  check('une entreprise à UN pays ne devine plus rien', /^Pays manquant/.test(P.resoudrePays({ liste: [L[0]] }).motif ?? ''))
  check('défaut qui n\'est plus un pays de l\'entreprise → manquant', /^Pays manquant/.test(P.resoudrePays({ liste: L, defaut: 'pays-xx' }).motif ?? ''))
  check('pays_id d\'une autre entreprise → refus', /n'appartient pas/.test(P.resoudrePays({ liste: L, paysId: 'pays-xx' }).motif ?? ''))
  eq('motif propre à l\'appelant (écran)', P.resoudrePays({ liste: L, manquant: 'Choisissez le pays.' }).motif, 'Choisissez le pays.')
  check('import.ts réutilise le sansAccents de pays.ts', I.sansAccents === P.sansAccents)

  const sansPays = { order_id: 'P-1', nom: 'Awa', telephone: '+221771234567', ville: 'Dakar', produit: 'Crème', prix: '1000' }
  const passe = async (paysDefaut, lead = sansPays, pays = base().pays) => {
    const db = { ...base(), pays }, sb = fauxSupabase(db)
    const r = await I.importerLigne(sb, { ...ctx, paysDefaut }, lead)
    return { r, c: db.commandes?.[0] }
  }
  let x = await passe('pays-ga')
  eq('lead sans pays, source au Gabon → Gabon', [x.r.statut, x.c?.pays_id], ['importe', 'pays-ga'])
  x = await passe(null)
  check('lead sans pays, source sans défaut → refusé « Pays manquant »', x.r.statut === 'rejete' && /^Pays manquant/.test(x.r.motif ?? ''), JSON.stringify(x.r))
  x = await passe(null, sansPays, [base().pays[0]])
  check('… même quand l\'entreprise n\'a qu\'un pays (plus de défaut par le compte)', x.r.statut === 'rejete', JSON.stringify(x.r))
  x = await passe('pays-ga', { ...sansPays, pays: 'Sénégal' })
  eq('le pays du lead l\'emporte sur celui de la source', x.c?.pays_id, 'pays-sn')
  x = await passe(undefined, sansPays, [base().pays[0]])
  eq('colonne absente (déployé avant le SQL) : ancien repli, un seul pays', [x.r.statut, x.c?.pays_id], ['importe', 'pays-sn'])
}

console.log('\n— 15. Une seule table de noms pour l\'API et l\'écran (champs.ts, 21/10)')
{
  const C = await import(path.join(RACINE, 'supabase/functions/_shared/champs.ts'))
  const pt = I.normaliser({ Cliente: 'Maria', Telefone: '+244923', Cidade: 'Luanda', 'Endereço': 'Rua 5',
                            Produto: 'clearzal', Quantidade: '3', 'Preço': '58000', Loja: 'Loja Luanda' }, {})
  eq('en-têtes portugais lus par l\'API', [pt.client_nom, pt.client_telephone, pt.ville_zone, pt.adresse, pt.produit, pt.quantite, pt.prix, pt.source_sheet],
     ['Maria', '+244923', 'Luanda', 'Rua 5', 'clearzal', 3, 58000, 'Loja Luanda'])
  eq('« Montant à encaisser » = le prix', I.normaliser({ telephone: '1', 'Montant à encaisser': '45000' }, {}).prix, 45000)
  eq('« Localidade », « Town » = la ville', [I.normaliser({ telephone: '1', Localidade: 'Huambo' }, {}).ville_zone, I.normaliser({ telephone: '1', Town: 'Lobito' }, {}).ville_zone], ['Huambo', 'Lobito'])
  // Un prix d'ARTICLE n'est jamais le montant de la commande.
  check('« unit_price » à plat n\'est PAS le montant à encaisser', I.normaliser({ telephone: '1', unit_price: '7500', quantity: '2' }, {}).prix !== 7500)
  check('unit_price / prix_unitaire absents de NOMS.prix', !C.NOMS.prix.includes('unit_price') && !C.NOMS.prix.includes('prix_unitaire'))
  check('l\'ordre historique de l\'API est en tête de chaque liste',
    C.NOMS.prix.slice(0, 7).join() === 'prix,price,montant,total,amount,cod,total_price'
    && C.NOMS.ville_zone.slice(0, 5).join() === 'ville_zone,ville,city,zone,region')
  eq('cleNormalisee : accents et ponctuation', C.cleNormalisee(' Município (Angola) '), 'municipio_angola')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${ok} passés, ${ko} échoués`)
process.exit(ko ? 1 : 0)
