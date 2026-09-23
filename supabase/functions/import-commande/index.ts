// Import one order (lead) — used by Google Sheets / external webhooks.
// Before: NO authentication, and the tenant_id came from the request, so anyone
// could inject orders into any company.
// Now two ways to call it:
//   1. Webhook (Google Sheets, API): header  x-import-secret: <IMPORT_SECRET>
//      Set the secret once with:  npx supabase secrets set IMPORT_SECRET=<long random string>
//      tenant_id is taken from the body and must be an active tenant.
//   2. Logged-in user with permission `importer_csv`: the order goes into HIS tenant.
import {
  adminClient, getCaller, handle, HttpError, json, readJson, requireAny,
} from '../_shared/auth.ts'

function secretValide(req: Request): boolean {
  const attendu = Deno.env.get('IMPORT_SECRET')
  const recu = req.headers.get('x-import-secret')
  return !!attendu && attendu.length >= 16 && recu === attendu
}

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  // deno-lint-ignore no-explicit-any
  const payload = await readJson(req) as Record<string, any>

  let tenantId: string | undefined
  let viaWebhook = false

  if (secretValide(req)) {
    viaWebhook = true
    tenantId = payload.tenant_id
    if (!tenantId) throw new HttpError(400, 'tenant_id requis')
    const { data: t } = await sb.from('tenants').select('statut').eq('id', tenantId).maybeSingle()
    if (!t || t.statut !== 'actif') throw new HttpError(400, 'Entreprise introuvable ou suspendue')
  } else {
    const caller = await getCaller(req, sb)
    requireAny(caller, ['importer_csv'])
    tenantId = caller.isSuperAdmin && payload.tenant_id ? payload.tenant_id : caller.tenantId
  }

  const {
    client_nom, client_telephone, produit, ville_zone, source_url, statut_confirmation,
    notes, commentaire_1, commentaire_2, whatsapp_tracking, whatsapp_followup, quantite, source_sheet, prix,
  } = payload

  if (!client_telephone) throw new HttpError(400, 'telephone requis')

  const lead_id = payload.lead_id ||
    `LEAD-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`

  // pays_id is NOT NULL in commandes: take it from the body, or the tenant's only country.
  let pays_id = payload.pays_id
  if (!pays_id) {
    const { data: pays } = await sb.from('pays').select('id').eq('tenant_id', tenantId).limit(2)
    if (pays?.length === 1) pays_id = pays[0].id
    else throw new HttpError(400, 'pays_id requis (l\'entreprise a plusieurs pays ou aucun)')
  }

  const { data: existant } = await sb
    .from('commandes')
    .select('id')
    .eq('lead_id', lead_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (existant) return json({ status: 'deja_importe', id: existant.id })

  const { data: commande, error } = await sb
    .from('commandes')
    .insert({
      lead_id,
      client_nom,
      client_telephone,
      produit,
      pays_id,
      ville_zone,
      source_url,
      // null = "à traiter" in the call center (the call center tab filters on null)
      statut_confirmation: statut_confirmation || null,
      notes,
      commentaire_1,
      commentaire_2,
      whatsapp_tracking,
      whatsapp_followup,
      quantite: Math.max(1, parseInt(quantite) || 1),
      prix: Math.max(0, parseFloat(prix) || 0),
      source_sheet,
      source: payload.source || (viaWebhook ? 'google_sheet' : 'manuel'),
      tenant_id: tenantId,
    })
    .select()
    .single()
  if (error) throw new HttpError(400, error.message)

  await sb.from('appels').insert({ commande_id: commande.id, statut: 'en_attente', tenant_id: tenantId })

  return json({ status: 'ok', commande })
}))