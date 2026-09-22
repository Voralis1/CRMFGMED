// Save the result of a call on an order (confirmed, cancelled, reminder...).
// Allowed: permission `traiter_appel` (agent, manager, admin) + super_admin.
// An agent can only treat orders assigned to him (or not yet assigned).
import {
  adminClient, assertTenant, getCaller, handle, HttpError, json, myAgentId, readJson, requireAny,
} from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['traiter_appel'])

  // deno-lint-ignore no-explicit-any
  const payload = await readJson(req) as Record<string, any>
  const {
    commande_id, statut, notes, date_rappel, source,
    client_nom, client_telephone, ville_zone, zone_id, pays_id, produit, quantite, prix,
  } = payload

  if (!commande_id || !statut || typeof statut !== 'string') {
    throw new HttpError(400, 'commande_id et statut requis')
  }

  const { data: commande } = await sb
    .from('commandes')
    .select('id, tenant_id, agent_id')
    .eq('id', commande_id)
    .maybeSingle()
  if (!commande) throw new HttpError(404, 'Commande introuvable')
  assertTenant(caller, commande.tenant_id)

  const agentId = await myAgentId(sb, caller, commande.tenant_id)

  if (caller.roleNom === 'agent') {
    if (!agentId) throw new HttpError(403, 'Aucun profil agent pour ce compte')
    if (commande.agent_id && commande.agent_id !== agentId) {
      throw new HttpError(403, 'Cette commande est assignée à un autre agent')
    }
  }

  const estRappel = statut.toLowerCase().includes('rappel') || statut.toLowerCase().includes('reminder')

  // 1. Log the call
  const { data: appel, error: erreurAppel } = await sb
    .from('appels')
    .insert({
      commande_id,
      agent_id: agentId,
      statut,
      tenant_id: commande.tenant_id,
      notes: notes || null,
      date_rappel: estRappel ? (date_rappel || null) : null,
    })
    .select()
    .single()
  if (erreurAppel) throw new HttpError(400, erreurAppel.message)

  // 2. Update the order (only fields that were actually sent)
  // deno-lint-ignore no-explicit-any
  const maj: Record<string, any> = {
    statut_confirmation: statut,
    updated_at: new Date().toISOString(),
  }
  if (source !== undefined) maj.source = source || null
  if (client_nom !== undefined) maj.client_nom = client_nom
  if (client_telephone) maj.client_telephone = client_telephone
  if (ville_zone !== undefined) maj.ville_zone = ville_zone
  if (zone_id !== undefined) maj.zone_id = zone_id || null
  if (pays_id) maj.pays_id = pays_id // pays_id is NOT NULL in the table: never send null
  if (produit !== undefined) maj.produit = produit
  if (quantite !== undefined) maj.quantite = Math.max(1, parseInt(quantite) || 1)
  if (prix !== undefined) maj.prix = Math.max(0, parseFloat(prix) || 0)
  // An agent who treats an unassigned lead takes it.
  if (caller.roleNom === 'agent' && !commande.agent_id) maj.agent_id = agentId

  const { error: erreurCommande } = await sb
    .from('commandes')
    .update(maj)
    .eq('id', commande_id)
    .eq('tenant_id', commande.tenant_id)
  if (erreurCommande) throw new HttpError(400, erreurCommande.message)

  return json({ status: 'ok', appel })
}))