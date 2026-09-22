// Mark a payment as cash collected (en_attente -> encaisse).
// Allowed: `declarer_encaissement` (livreur) or `valider_remise` (manager, admin) + super_admin.
// A livreur can only mark HIS OWN payments.
import {
  adminClient, assertTenant, getCaller, handle, HttpError, json, myLivreurId, readJson, requireAny,
} from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['declarer_encaissement', 'valider_remise'])

  const { paiement_id } = await readJson(req) as { paiement_id?: string }
  if (!paiement_id) throw new HttpError(400, 'paiement_id requis')

  const { data: paiement } = await sb
    .from('paiements')
    .select('id, commande_id, statut, tenant_id, livreur_id')
    .eq('id', paiement_id)
    .maybeSingle()
  if (!paiement) throw new HttpError(404, 'paiement introuvable')
  assertTenant(caller, paiement.tenant_id)

  if (caller.roleNom === 'livreur') {
    const monId = await myLivreurId(sb, caller)
    if (!monId || paiement.livreur_id !== monId) throw new HttpError(403, 'Ce paiement ne vous appartient pas')
  }

  if (paiement.statut !== 'en_attente') throw new HttpError(400, 'ce paiement n\'est pas en attente')

  const { error } = await sb
    .from('paiements')
    .update({ statut: 'encaisse', date_encaissement: new Date().toISOString() })
    .eq('id', paiement_id)
    .eq('statut', 'en_attente')
  if (error) throw new HttpError(400, error.message)

  await sb
    .from('commandes')
    .update({ statut_paiement: 'paye' })
    .eq('id', paiement.commande_id)
    .eq('tenant_id', paiement.tenant_id)

  return json({ status: 'ok', paiement_id })
}))