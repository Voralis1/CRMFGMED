// Le point d'entrée des leads : boutique, landing page, formulaire, Zapier,
// ou n'importe quel outil capable de faire un POST.
//
//   POST /functions/v1/import-commande?token=<jeton>&source=<étiquette>
//   (ou en-tête x-import-token, ou Authorization: Bearer fgm_…)
//
//   un lead          { "nom": "...", "telephone": "...", "pays": "Maroc", ... }
//   ou plusieurs     { "leads": [ {...}, {...} ] }        (200 maximum)
//   ou une commande de boutique, imbriquée (WooCommerce, Shopify…), telle
//   quelle, même dans une enveloppe { "data": { ... } }
//
// Les noms de champs sont souples : `nom`/`name`/`client_nom`, `telephone`/
// `phone`/`tel`… et un JSON imbriqué est aplati avant d'être lu. Les règles
// sont dans `_shared/import.ts`, avec le mapping par source qui les bat toutes.
//
// DEUX FAÇONS D'ÊTRE AUTORISÉ :
//
//   1. le jeton d'UNE source, de l'une des trois façons (jetonDepuisRequete).
//      L'entreprise et le vendeur viennent du jeton, jamais du corps de la
//      requête. C'est la seule façon qui permette de couper une source sans
//      couper les autres. Si la source a un secret de signature, la signature
//      est vérifiée en plus.
//
//   2. utilisateur connecté avec `importer_csv` — l'import depuis l'écran.
//
// L'ancien `x-import-secret` a été retiré : il lisait `tenant_id` dans le
// corps, donc qui le détenait pouvait écrire dans n'importe quelle entreprise,
// et il a fuité. Il n'existe plus aucun chemin qui fasse confiance au corps
// pour choisir l'entreprise, sauf pour un super_admin connecté.
//
// Le jeton peut être dans l'URL : NE JAMAIS journaliser req.url (voir
// jetonDepuisRequete).
import {
  adminClient, getCaller, handle, HttpError, json, requireAny,
} from '../_shared/auth.ts'
import {
  Brut, ContexteImport, deballer, estPingWebhook, importerLot, jetonDepuisRequete, MAX_LOT,
  sourceDepuisJeton, verifierSignature,
} from '../_shared/import.ts'

function lireJson(texte: string): Record<string, unknown> {
  try {
    const body = JSON.parse(texte)
    return body && typeof body === 'object' ? body : {}
  } catch {
    throw new HttpError(400, 'Corps de requête JSON invalide')
  }
}

Deno.serve(handle(async (req) => {
  const sb = adminClient()

  // Les octets bruts d'abord : la signature se vérifie sur eux, pas sur un
  // JSON relu et ré-écrit.
  const octets = new Uint8Array(await req.arrayBuffer())
  const texte = new TextDecoder().decode(octets)

  // --- qui appelle ? (1) une source ------------------------------------------
  let ctx: ContexteImport | null = null

  const jeton = jetonDepuisRequete(req)
  if (jeton) {
    const source = await sourceDepuisJeton(sb, jeton)
    // Même réponse pour « jeton inconnu », « source coupée » et « entreprise
    // suspendue » : distinguer les trois dirait à un inconnu quels jetons
    // existent.
    if (!source) throw new HttpError(401, 'Jeton inconnu ou source désactivée')

    if (estPingWebhook(texte)) return json({ success: true, status: 'ping' })

    // Pas de secret sur la source : pas de vérification, on ne refuse pas.
    if (await verifierSignature(octets, req.headers, source) === false) {
      throw new HttpError(401, 'Signature invalide')
    }

    const etiquette = new URL(req.url).searchParams.get('source')?.trim().slice(0, 100) || null
    ctx = {
      tenantId: source.tenant_id,
      sourceId: source.id,
      vendeurParDefaut: source.vendeur_id,
      origine: source.type === 'google_sheet' ? 'google_sheet' : 'webhook',
      mapping: source.mapping ?? {},
      etiquette,
      prefixeLead: source.prefixe_lead,
    }
  }

  const corps = lireJson(texte)

  // --- un lead ou plusieurs ? ------------------------------------------------
  // L'enveloppe ({ "data": … }) est ouverte pour trouver la liste ; une
  // commande seule est passée ENTIÈRE, pour que imports_bruts garde ce qui
  // est arrivé et que le mapping puisse citer le chemin complet.
  const racine = deballer(corps).racine as Record<string, unknown>
  let lignes: Brut[]
  if (Array.isArray(racine)) lignes = racine as Brut[]
  else if (Array.isArray(racine.leads)) lignes = racine.leads as Brut[]
  else if (Array.isArray(racine.commandes)) lignes = racine.commandes as Brut[]
  else lignes = [corps as Brut]

  const lot = lignes.length > 1 || Array.isArray(racine) ||
              Array.isArray(racine.leads) || Array.isArray(racine.commandes)

  if (lignes.length === 0) throw new HttpError(400, 'Aucun lead dans la requête')
  if (lignes.length > MAX_LOT) {
    throw new HttpError(400, `${lignes.length} leads d'un coup : le maximum est ${MAX_LOT}`)
  }

  // --- qui appelle ? (2) un utilisateur connecté -----------------------------
  if (!ctx) {
    const caller = await getCaller(req, sb)
    requireAny(caller, ['importer_csv'])
    ctx = {
      tenantId: caller.isSuperAdmin && corps.tenant_id
        ? corps.tenant_id as string
        : caller.tenantId,
      sourceId: null,
      vendeurParDefaut: null,
      origine: 'manuel',
    }
  }

  const res = await importerLot(sb, ctx, lignes)

  // --- la réponse ------------------------------------------------------------
  // L'appelant n'apprend rien sur l'intérieur du CRM : ni identifiants, ni
  // entreprise, ni quel agent a pris le lead. `agent_found` dit seulement
  // qu'un agent a été trouvé pour ce pays.
  if (!lot) {
    const r = res.resultats[0]
    if (r.statut === 'rejete') {
      return json({ success: false, status: 'rejete', error: r.motif }, 400)
    }
    return json({
      success: true,
      status: r.statut === 'doublon' ? 'deja_importe' : 'ok',
      lead_id: r.lead_id,
      agent_found: r.agent_trouve ?? false,
      // conservé pour les intégrations écrites avant ce changement
      affecte: r.agent_trouve ?? false,
    })
  }

  return json({
    success: true,
    total: res.total,
    importes: res.importes,
    doublons: res.doublons,
    rejetes: res.rejetes,
    resultats: res.resultats.map((r) => ({
      status: r.statut, lead_id: r.lead_id, agent_found: r.agent_trouve ?? false, error: r.motif,
    })),
  })
}))