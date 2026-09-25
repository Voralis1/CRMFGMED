// Import one order (lead) — used by Google Sheets / external webhooks.
// Before: NO authentication, and the tenant_id came from the request, so anyone
// could inject orders into any company.
// Now two ways to call it:
//   1. Webhook (Google Sheets, API): header  x-import-secret: <IMPORT_SECRET>
//      Set the secret once with:  supabase secrets set IMPORT_SECRET=<long random string>
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

  // The country decides which agent gets the lead, so it must be right.
  // Accepted: pays_id (uuid), or `pays` / `pays_nom` / `pays_code` as plain text
  // ("Congo", "CG"...). If nothing is given and the company has a single country,
  // that one is used.
  const { data: paysTenant } = await sb
    .from('pays').select('id, nom, code').eq('tenant_id', tenantId)
  const listePays = paysTenant ?? []

  let pays_id: string | undefined = payload.pays_id
  const paysTexte = String(payload.pays ?? payload.pays_nom ?? payload.pays_code ?? '').trim()

  if (pays_id) {
    if (!listePays.some((p) => p.id === pays_id)) {
      throw new HttpError(400, 'Ce pays n\'appartient pas à cette entreprise')
    }
  } else if (paysTexte !== '') {
    const cherche = paysTexte.toLowerCase()
    const trouve = listePays.find((p) =>
      String(p.nom ?? '').trim().toLowerCase() === cherche ||
      String(p.code ?? '').trim().toLowerCase() === cherche
    )
    if (!trouve) {
      const dispo = listePays.map((p) => p.nom).join(', ')
      throw new HttpError(400, `Pays "${paysTexte}" introuvable. Pays disponibles : ${dispo}`)
    }
    pays_id = trouve.id
  } else if (listePays.length === 1) {
    pays_id = listePays[0].id
  } else {
    throw new HttpError(400, 'Le pays est requis (colonne "pays") : l\'entreprise a plusieurs pays')
  }

  const { data: existant } = await sb
    .from('commandes')
    .select('id')
    .eq('lead_id', lead_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (existant) return json({ status: 'deja_importe', lead_id })

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
    .select('id, lead_id, agent_id')
    .single()
  if (error) throw new HttpError(400, error.message)

  await sb.from('appels').insert({ commande_id: commande.id, statut: 'en_attente', tenant_id: tenantId })

  // The caller only gets what it needs to track its own rows. Never the internal
  // ids, the tenant, or who the agent is: the sheet lives outside the CRM.
  // `affecte` only says whether an agent was found for that country.
  return json({
    status: 'ok',
    lead_id: commande.lead_id,
    affecte: commande.agent_id !== null,
  })
}))