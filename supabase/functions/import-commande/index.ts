// Le point d'entrée des leads : boutique, landing page, formulaire, Zapier,
// ou n'importe quel outil capable de faire un POST.
//
//   POST /functions/v1/import-commande
//   x-import-token: <le jeton de la source>
//
//   un lead          { "nom": "...", "telephone": "...", "pays": "Maroc", ... }
//   ou plusieurs     { "leads": [ {...}, {...} ] }        (200 maximum)
//
// Les noms de champs sont souples : `nom`/`name`/`client_nom`, `telephone`/
// `phone`/`tel`… La liste complète est dans `_shared/import.ts`.
//
// TROIS FAÇONS D'ÊTRE AUTORISÉ, de la meilleure à la plus ancienne :
//
//   1. `x-import-token`  — le jeton d'UNE source. L'entreprise et le vendeur
//      viennent du jeton, jamais du corps de la requête. C'est la seule façon
//      qui permette de couper une source sans couper les autres.
//
//   2. `x-import-secret` — l'ancien secret unique, conservé le temps que les
//      intégrations existantes basculent. Il lit `tenant_id` dans le corps, ce
//      qui veut dire que qui le détient peut écrire dans n'importe quelle
//      entreprise. À RETIRER une fois les sources migrées.
//
//   3. utilisateur connecté avec `importer_csv` — l'import depuis l'écran.
import {
  adminClient, getCaller, handle, HttpError, json, readJson, requireAny,
} from '../_shared/auth.ts'
import {
  Brut, ContexteImport, importerLot, MAX_LOT, sourceDepuisJeton,
} from '../_shared/import.ts'

function secretLegacyValide(req: Request): boolean {
  const attendu = Deno.env.get('IMPORT_SECRET')
  const recu = req.headers.get('x-import-secret')
  return !!attendu && attendu.length >= 16 && recu === attendu
}

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const corps = await readJson(req) as Record<string, unknown>

  // --- un lead ou plusieurs ? ------------------------------------------------
  let lignes: Brut[]
  if (Array.isArray(corps)) lignes = corps as Brut[]
  else if (Array.isArray(corps.leads)) lignes = corps.leads as Brut[]
  else if (Array.isArray(corps.commandes)) lignes = corps.commandes as Brut[]
  else lignes = [corps as Brut]

  const lot = lignes.length > 1 || Array.isArray(corps) ||
              Array.isArray(corps.leads) || Array.isArray(corps.commandes)

  if (lignes.length === 0) throw new HttpError(400, 'Aucun lead dans la requête')
  if (lignes.length > MAX_LOT) {
    throw new HttpError(400, `${lignes.length} leads d'un coup : le maximum est ${MAX_LOT}`)
  }

  // --- qui appelle ? ---------------------------------------------------------
  let ctx: ContexteImport

  const jeton = req.headers.get('x-import-token')
  if (jeton) {
    const source = await sourceDepuisJeton(sb, jeton)
    // Même réponse pour « jeton inconnu », « source coupée » et « entreprise
    // suspendue » : distinguer les trois dirait à un inconnu quels jetons
    // existent.
    if (!source) throw new HttpError(401, 'Jeton inconnu ou source désactivée')
    ctx = {
      tenantId: source.tenant_id,
      sourceId: source.id,
      vendeurParDefaut: source.vendeur_id,
      origine: source.type === 'google_sheet' ? 'google_sheet' : 'webhook',
      mapping: source.mapping ?? {},
    }
  } else if (secretLegacyValide(req)) {
    const tenantId = corps.tenant_id as string | undefined
    if (!tenantId) throw new HttpError(400, 'tenant_id requis')
    const { data: t } = await sb.from('tenants').select('statut').eq('id', tenantId).maybeSingle()
    if (!t || t.statut !== 'actif') throw new HttpError(400, 'Entreprise introuvable ou suspendue')
    ctx = { tenantId, sourceId: null, vendeurParDefaut: null, origine: 'google_sheet' }
  } else {
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